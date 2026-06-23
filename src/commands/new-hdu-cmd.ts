/**
 * `dd-cli new-hdu <título>` — crea una HDU desde el template y lanza Claude
 * con la skill /devflow-ia:design-hdu para refinarla interactivamente.
 *
 * Pensado para correr el método completo sin la APP de DevFlow IA: el dev (o
 * Tech Lead) puede generar HDUs directamente desde el CLI.
 *
 * Convención:
 *   - Las HDUs viven en docs/hdus/HDU-NNN-<slug>.md
 *   - IDs son numéricos correlativos (001, 002, ...). Calculados leyendo
 *     los archivos existentes.
 *   - El template precarga el frontmatter y el esqueleto; Claude completa.
 */
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { findDevFlowProjectRoot, getProjectRoot } from '../utils/paths.js';
import { renderTemplate, getTemplatePath } from '../utils/templates.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold } from '../utils/output.js';

export interface NewHduOptions {
  type?: string; // dev_type opcional sugerido por el dev
  noClaude?: boolean; // no lanzar claude (útil para tests)
}

const HDU_DIR = path.join('docs', 'hdus');

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 60);
}

function pad(n: number): string {
  return n.toString().padStart(3, '0');
}

function nextHduId(hduDir: string): string {
  if (!existsSync(hduDir)) return '001';
  const entries = readdirSync(hduDir).filter((f) => f.endsWith('.md'));
  let max = 0;
  for (const entry of entries) {
    const match = entry.match(/^HDU-(\d+)/);
    if (match) {
      const n = parseInt(match[1]!, 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return pad(max + 1);
}

function getGitUser(projectRoot: string): string {
  try {
    return execSync('git config user.name', {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
      .trim()
      || (process.env['USER'] ?? 'unknown');
  } catch {
    return process.env['USER'] ?? 'unknown';
  }
}

function launchClaude(opts: { hduPath: string; skill: string }): void {
  printInfo(`Lanzando Claude Code con ${bold(opts.skill)}...`);
  printDim(`  Archivo: ${opts.hduPath}`);
  console.log('');
  try {
    const child = spawn('claude', [], {
      stdio: 'inherit',
      env: {
        ...process.env,
        DEVFLOW_INITIAL_SKILL: opts.skill,
        DEVFLOW_HDU_PATH: opts.hduPath,
      },
    });
    child.on('error', (err) => {
      printWarn(`No pude lanzar 'claude' automáticamente: ${err.message}`);
      printInfo('Abre Claude Code manualmente y ejecuta:');
      printDim(`  ${opts.skill}  (sobre ${opts.hduPath})`);
    });
  } catch (e) {
    printWarn(`No pude lanzar 'claude' automáticamente: ${e instanceof Error ? e.message : e}`);
    printInfo('Abre Claude Code manualmente y ejecuta:');
    printDim(`  ${opts.skill}  (sobre ${opts.hduPath})`);
  }
}

export async function runNewHdu(title: string, opts: NewHduOptions = {}): Promise<number> {
  if (!title || title.trim().length < 5) {
    printErr('Falta el título de la HDU. Uso: dd-cli new-hdu "<título>"');
    return 2;
  }

  const projectRoot = findDevFlowProjectRoot() ?? getProjectRoot();
  if (!findDevFlowProjectRoot()) {
    printWarn('No estás en un proyecto DevFlow IA (no encuentro .devflow/).');
    printInfo('Ejecuta primero: dd-cli init  (o dd-cli init --client=<slug>)');
    return 2;
  }

  const hduDir = path.join(projectRoot, HDU_DIR);
  if (!existsSync(hduDir)) mkdirSync(hduDir, { recursive: true });

  const id = nextHduId(hduDir);
  const slug = slugify(title.trim());
  const fileName = `HDU-${id}-${slug}.md`;
  const hduPath = path.join(hduDir, fileName);
  const hduPathRel = path.relative(projectRoot, hduPath);

  const templatePath = getTemplatePath('HDU.md.template');
  if (!templatePath) {
    printErr('No encontré HDU.md.template en el paquete.');
    printDim('  Esperado en <package>/templates/ o <monorepo>/templates/');
    return 2;
  }

  const today = new Date().toISOString().slice(0, 10);
  const content = renderTemplate(templatePath, {
    ID: id,
    TITLE: title.trim(),
    DATE: today,
    USER: getGitUser(projectRoot),
  });

  if (existsSync(hduPath)) {
    printErr(`Ya existe ${hduPathRel}. Cambia el título o borra el archivo.`);
    return 1;
  }
  writeFileSync(hduPath, content, 'utf-8');

  console.log(bold(`\nDevFlow IA — nueva HDU\n`));
  printOk(`Creada: ${hduPathRel}`);
  printDim(`  ID:       HDU-${id}`);
  printDim(`  Título:   ${title.trim()}`);
  if (opts.type) printDim(`  Sugerido: ${opts.type} (Tech Lead aprueba en design-hdu)`);
  console.log('');

  if (opts.noClaude) {
    printInfo('Próximo paso (manual): abre Claude Code y ejecuta:');
    printDim(`  /devflow-ia:design-hdu  (sobre ${hduPathRel})`);
    console.log('');
    return 0;
  }

  launchClaude({
    hduPath: hduPathRel,
    skill: '/devflow-ia:design-hdu',
  });
  return 0;
}
