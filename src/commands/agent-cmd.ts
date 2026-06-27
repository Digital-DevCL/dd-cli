/**
 * `dd-cli agent` — namespace de agentes IA de DevFlow.
 *
 * Primer agente: `dd-cli agent doc-writer run`
 *   - Lee commits recientes del repo actual
 *   - Invoca Claude API con el prompt del doc-writer
 *   - Genera/actualiza README.md + CHANGELOG.md
 *   - Commitea con identidad del bot (configurable vía DEVFLOW_BOT_EMAIL / DEVFLOW_BOT_NAME)
 *   - Registra métricas: tokens, archivos tocados, aceptación
 *
 * Variables de entorno:
 *   ANTHROPIC_API_KEY   — requerida para llamar la API
 *   DEVFLOW_BOT_EMAIL   — identidad del bot en commits (default: dd-doc-writer@devflow.ia)
 *   DEVFLOW_BOT_NAME    — nombre del bot (default: dd-doc-writer)
 *   DEVFLOW_BOT_DRY_RUN — si "1", muestra output pero no commitea
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { getDevflowGlobalDir } from '../types/registry.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold } from '../utils/output.js';

// ── Config ────────────────────────────────────────────────────────────

const BOT_EMAIL = process.env['DEVFLOW_BOT_EMAIL'] ?? 'dd-doc-writer@devflow.ia';
const BOT_NAME  = process.env['DEVFLOW_BOT_NAME']  ?? 'dd-doc-writer';
const DRY_RUN   = process.env['DEVFLOW_BOT_DRY_RUN'] === '1';

const MODEL = 'claude-sonnet-4-6' as const;
const MAX_TOKENS = 4096;
const METRICS_FILE = path.join(getDevflowGlobalDir(), 'agent-metrics.jsonl');

// ── Tipos ─────────────────────────────────────────────────────────────

interface AgentMetric {
  ts: string;
  agent: string;
  repo: string;
  commits_analyzed: number;
  files_written: string[];
  tokens_input: number;
  tokens_output: number;
  accepted: boolean | null;   // null = no confirmado aún
  dry_run: boolean;
}

// ── Helpers git ────────────────────────────────────────────────────────

function git(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function getRecentCommits(cwd: string, since: string, count = 20): string[] {
  try {
    const log = git(
      `git log --oneline --no-merges --since="${since}" --max-count=${count}`,
      cwd
    );
    return log ? log.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

function getDiffSummary(cwd: string, since: string): string {
  try {
    // archivos cambiados
    const files = git(`git diff --name-only HEAD~5..HEAD 2>/dev/null || git diff --name-only HEAD 2>/dev/null`, cwd);
    // stat
    const stat = git(`git diff --stat HEAD~5..HEAD 2>/dev/null || echo ""`, cwd);
    return `Archivos cambiados:\n${files}\n\nResumen:\n${stat}`.slice(0, 3000);
  } catch {
    return '(no se pudo obtener diff)';
  }
}

function readFileSafe(filePath: string): string {
  if (!existsSync(filePath)) return '';
  try { return readFileSync(filePath, 'utf-8').slice(0, 4000); }
  catch { return ''; }
}

// ── Prompt del doc-writer ─────────────────────────────────────────────

function buildPrompt(opts: {
  repoName: string;
  commits: string[];
  diffSummary: string;
  existingReadme: string;
  existingChangelog: string;
}): string {
  return `Eres dd-doc-writer, el agente de documentación de DevFlow IA.

Repositorio: ${opts.repoName}

## Commits recientes
${opts.commits.slice(0, 15).join('\n')}

## Cambios en el código
${opts.diffSummary}

## README.md actual (primeros 4000 chars)
${opts.existingReadme || '(vacío — crear desde cero)'}

## CHANGELOG.md actual (primeros 2000 chars)
${opts.existingChangelog || '(vacío)'}

---

## Tu tarea

1. **Actualizar el README.md** — mantener o mejorar la sección de descripción y la sección de instalación/uso si los commits indican cambios. No borrar secciones existentes. Si el README está vacío, crear uno desde cero con: título, descripción, instalación, uso básico, contribución.

2. **Actualizar el CHANGELOG.md** — agregar una nueva entrada "## [Unreleased]" (o la más reciente) con los cambios detectados en los commits. Formato: Keep a Changelog (https://keepachangelog.com). Solo incluir cambios reales; no inventar.

## Output

Devuelve EXACTAMENTE el siguiente JSON (sin markdown extra):

\`\`\`json
{
  "readme_updated": true,
  "readme_content": "<contenido completo del README.md>",
  "changelog_updated": true,
  "changelog_content": "<contenido completo del CHANGELOG.md>",
  "summary": "<1-2 oraciones explicando qué cambió>"
}
\`\`\`

Si no hay cambios necesarios en un archivo, devuelve el contenido original y pon false en el campo *_updated.`;
}

// ── Métricas ──────────────────────────────────────────────────────────

function recordMetric(m: AgentMetric): void {
  try {
    const dir = path.dirname(METRICS_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(METRICS_FILE, JSON.stringify(m) + '\n', { flag: 'a', encoding: 'utf-8' });
  } catch { /* métricas no son críticas */ }
}

// ── Comando principal ─────────────────────────────────────────────────

export interface DocWriterRunOpts {
  since?: string;    // fecha desde (git --since), default: 7d
  noCommit?: boolean;
  json?: boolean;
}

export async function runAgentDocWriter(cwd: string, opts: DocWriterRunOpts = {}): Promise<number> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    printErr('Falta ANTHROPIC_API_KEY. Exportá la variable antes de correr el agente.');
    return 2;
  }

  const since = opts.since ?? '7 days ago';
  const repoName = path.basename(cwd);

  console.log(bold(`\n🤖 dd-doc-writer  ·  ${repoName}\n`));
  printDim(`  Analizando commits desde: ${since}`);
  if (DRY_RUN || opts.noCommit) printWarn('  Modo dry-run — no se commitearán cambios');
  console.log('');

  // 1. Recolectar contexto
  const commits = getRecentCommits(cwd, since);
  if (commits.length === 0) {
    printInfo('Sin commits nuevos desde ' + since + '. Nada que documentar.');
    return 0;
  }
  printDim(`  ${commits.length} commits encontrados`);

  const diffSummary = getDiffSummary(cwd, since);
  const existingReadme   = readFileSafe(path.join(cwd, 'README.md'));
  const existingChangelog = readFileSafe(path.join(cwd, 'CHANGELOG.md'));

  // 2. Llamar Claude API
  printDim('  Invocando Claude API...');
  const client = new Anthropic({ apiKey });
  const prompt = buildPrompt({ repoName, commits, diffSummary, existingReadme, existingChangelog });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (e) {
    printErr(`Claude API falló: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  const rawText = response.content
    .filter(b => b.type === 'text')
    .map(b => b.type === 'text' ? b.text : '')
    .join('');

  // 3. Parsear el JSON del response
  let result: {
    readme_updated: boolean;
    readme_content: string;
    changelog_updated: boolean;
    changelog_content: string;
    summary: string;
  };

  try {
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/) ?? rawText.match(/({[\s\S]*})/);
    result = JSON.parse(jsonMatch?.[1] ?? rawText);
  } catch {
    printErr('El agente devolvió una respuesta malformada. Guardando raw en .devflow/agent-last-output.txt');
    try {
      writeFileSync(path.join(cwd, '.devflow', 'agent-last-output.txt'), rawText, 'utf-8');
    } catch { /* */ }
    return 1;
  }

  const filesWritten: string[] = [];

  // 4. Escribir archivos
  if (result.readme_updated && result.readme_content) {
    if (!DRY_RUN && !opts.noCommit) {
      writeFileSync(path.join(cwd, 'README.md'), result.readme_content, 'utf-8');
      filesWritten.push('README.md');
    }
    printOk('README.md actualizado');
    if (DRY_RUN) printDim(result.readme_content.slice(0, 300) + '...');
  }

  if (result.changelog_updated && result.changelog_content) {
    if (!DRY_RUN && !opts.noCommit) {
      writeFileSync(path.join(cwd, 'CHANGELOG.md'), result.changelog_content, 'utf-8');
      filesWritten.push('CHANGELOG.md');
    }
    printOk('CHANGELOG.md actualizado');
  }

  if (filesWritten.length === 0 && !DRY_RUN) {
    printInfo('Sin cambios de documentación necesarios.');
    return 0;
  }

  // 5. Commit con identidad del bot
  if (!DRY_RUN && !opts.noCommit && filesWritten.length > 0) {
    try {
      git('git add README.md CHANGELOG.md', cwd);
      git(
        `git -c user.email="${BOT_EMAIL}" -c user.name="${BOT_NAME}" -c commit.gpgsign=false` +
        ` commit -m "docs: ${result.summary.slice(0, 72)}" -m "Generado por ${BOT_NAME} (DevFlow IA)"`,
        cwd
      );
      printOk(`Commit por ${BOT_NAME}: ${result.summary.slice(0, 60)}`);
    } catch (e) {
      printWarn(`Commit falló: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 6. Métricas
  recordMetric({
    ts: new Date().toISOString(),
    agent: 'doc-writer',
    repo: cwd,
    commits_analyzed: commits.length,
    files_written: filesWritten,
    tokens_input: response.usage.input_tokens,
    tokens_output: response.usage.output_tokens,
    accepted: null,
    dry_run: DRY_RUN || (opts.noCommit ?? false),
  });

  console.log('');
  printDim(`  Tokens: ${response.usage.input_tokens} input · ${response.usage.output_tokens} output`);
  printDim(`  Costo estimado: ~$${((response.usage.input_tokens * 3 + response.usage.output_tokens * 15) / 1_000_000).toFixed(4)} USD`);

  return 0;
}

export async function runAgentMetrics(): Promise<number> {
  if (!existsSync(METRICS_FILE)) {
    printInfo('Sin métricas aún. Corré: dd-cli agent doc-writer run');
    return 0;
  }
  const lines = readFileSync(METRICS_FILE, 'utf-8').trim().split('\n').filter(Boolean);
  const metrics: AgentMetric[] = lines.map(l => JSON.parse(l));

  console.log(bold('\n📊 Métricas del agente dd-doc-writer\n'));
  console.log(`  Runs totales:        ${metrics.length}`);
  const dryRuns = metrics.filter(m => m.dry_run).length;
  console.log(`  Dry runs:            ${dryRuns}`);
  const totalInputTokens  = metrics.reduce((s, m) => s + m.tokens_input, 0);
  const totalOutputTokens = metrics.reduce((s, m) => s + m.tokens_output, 0);
  const estimatedCost = (totalInputTokens * 3 + totalOutputTokens * 15) / 1_000_000;
  console.log(`  Tokens input total:  ${totalInputTokens.toLocaleString()}`);
  console.log(`  Tokens output total: ${totalOutputTokens.toLocaleString()}`);
  console.log(`  Costo estimado:      $${estimatedCost.toFixed(4)} USD`);
  const filesWritten = metrics.flatMap(m => m.files_written);
  const uniqueFiles = [...new Set(filesWritten)];
  console.log(`  Archivos tocados:    ${uniqueFiles.join(', ') || 'ninguno'}`);
  console.log('');
  return 0;
}
