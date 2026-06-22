/**
 * `dd-cli skills list|verify|install` — gestión de skills bundleadas.
 */
import { existsSync, readdirSync, statSync, readFileSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getClaudeSkillsDir } from '../utils/paths.js';
import { printOk, printWarn, printErr, printDim, bold } from '../utils/output.js';
import { runInit } from './init.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const META_FILES = new Set([
  'AUDIT.md', 'CUSTOMIZATION.md', 'ENFORCEMENT.md', 'DISENO_INIT_CONTEXT.md', 'PLAN.md',
]);

type ModelHint = 'opus' | 'sonnet' | 'haiku' | '?';

interface SkillMeta {
  relPath: string;
  name: string;
  category: string;
  model: ModelHint;
  version: string;
  origin: string;
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fm: Record<string, string> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const m = line.match(/^([\w-]+):\s*(.+)/);
    if (m) fm[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, '');
  }
  return fm;
}

function sha256File(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function collectSkills(dir: string, relBase = ''): SkillMeta[] {
  const skills: SkillMeta[] = [];
  if (!existsSync(dir)) return skills;
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const st = statSync(fullPath);
    if (st.isDirectory()) {
      skills.push(...collectSkills(fullPath, path.join(relBase, entry)));
    } else if (entry.endsWith('.md') && !META_FILES.has(entry)) {
      const content = readFileSync(fullPath, 'utf-8');
      const fm = parseFrontmatter(content);
      skills.push({
        relPath: path.join(relBase, entry),
        name: fm['name'] ?? entry.replace('.md', ''),
        category: fm['category'] ?? '?',
        model: (fm['model'] as ModelHint) ?? '?',
        version: fm['version'] ?? '?',
        origin: fm['origin'] ?? '?',
      });
    }
  }
  return skills;
}

function resolveChecksumsPath(): string | null {
  // dist/commands/ → dist/ → package root
  const pkgRoot = path.resolve(__dirname, '..', '..');
  const candidate = path.join(pkgRoot, 'skills.checksums');
  return existsSync(candidate) ? candidate : null;
}

function loadChecksums(): Record<string, string> {
  const p = resolveChecksumsPath();
  if (!p) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return {};
  }
}

function resolveDistSkillsDir(): string | null {
  const pkgRoot = path.resolve(__dirname, '..', '..');
  const candidate = path.join(pkgRoot, 'dist', 'skills');
  return existsSync(candidate) ? candidate : null;
}

// ── Subcomandos ────────────────────────────────────────────

export function runSkillsList(): number {
  const skillsDir = getClaudeSkillsDir();

  if (!existsSync(skillsDir)) {
    printWarn(`Skills no instaladas en ${skillsDir}`);
    printDim(`  Ejecuta: dd-cli init`);
    return 1;
  }

  const versionFile = path.join(skillsDir, '.version');
  const version = existsSync(versionFile) ? readFileSync(versionFile, 'utf-8').trim() : '?';
  const skills = collectSkills(skillsDir);

  console.log(`\nSkills instaladas en ${skillsDir} (v${version})\n`);

  const byOrigin: Record<string, SkillMeta[]> = {};
  for (const s of skills) {
    const key = s.origin.includes('OpenSpec') ? 'OpenSpec (adaptado)' : 'Digital-Dev';
    (byOrigin[key] ??= []).push(s);
  }

  const modelIcon: Record<string, string> = { opus: '⬛', sonnet: '⬜', haiku: '▪', '?': '·' };

  for (const [origin, list] of Object.entries(byOrigin)) {
    console.log(`  ${bold(origin)}:`);
    for (const s of list) {
      const icon = modelIcon[s.model] ?? '·';
      const name = s.name.padEnd(26);
      console.log(`    ${icon} /${name} ${printDimInline(s.category.padEnd(12))} ${printDimInline(s.model)}`);
    }
    console.log('');
  }

  console.log(printDimInline(`Total: ${skills.length} skills  ·  opus ⬛  sonnet ⬜  haiku ▪`));
  return 0;
}

export function runSkillsVerify(): number {
  const skillsDir = getClaudeSkillsDir();
  const checksums = loadChecksums();

  if (Object.keys(checksums).length === 0) {
    printWarn('No se encontró skills.checksums. Ejecuta npm run build:full para generarlo.');
    return 1;
  }

  const skills = collectSkills(skillsDir);
  let ok = 0;
  let modified = 0;

  for (const s of skills) {
    const expected = checksums[s.relPath];
    if (!expected) {
      printWarn(`${s.relPath}: no está en checksums (skill nueva?)`);
      continue;
    }
    const actual = sha256File(path.join(skillsDir, s.relPath!));
    if (actual === expected) {
      ok++;
    } else {
      printWarn(`${s.relPath}: modificada localmente`);
      printDim(`  Restaurar: dd-cli skills install --force`);
      modified++;
    }
  }

  if (modified === 0) {
    printOk(`${ok} skills verificadas — todas coinciden con checksums`);
    return 0;
  }
  return 2;
}

export async function runSkillsInstall(opts: { force?: boolean } = {}): Promise<number> {
  return runInit({ force: !!opts.force, skipHooks: true });
}

function printDimInline(s: string): string {
  return process.stdout.isTTY ? `\x1b[90m${s}\x1b[0m` : s;
}
