#!/usr/bin/env node
/**
 * lint-skills.js — valida que las skills del bundle cumplen el contrato.
 *
 * Verifica por cada .md en skills/ (excluyendo meta-files):
 *   1. Tiene frontmatter YAML con campos obligatorios v0.2.0
 *   2. Campo `model` es opus | sonnet | haiku
 *   3. No contiene voseo porteño
 *
 * Salida:
 *   0 → todo OK
 *   1 → hay errores
 */
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const META_FILES = new Set([
  'AUDIT.md', 'CUSTOMIZATION.md', 'ENFORCEMENT.md',
  'DISENO_INIT_CONTEXT.md', 'PLAN.md',
]);

const REQUIRED_FRONTMATTER = ['name', 'origin', 'license', 'managed-by', 'version', 'model'];
const VALID_MODELS = new Set(['opus', 'sonnet', 'haiku']);
const VOSEO_PATTERNS = [/ejecutá/g, /tipeá/g, /hacé\b/g, /abrí\b/g, /levantá/g, /Llevás/g, /podés/g, /tenés/g, /cerrá/g, /volvé/g, /retomá/g, /Guardá/g, /completá/g, /Editá/g];

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([\w-]+):\s*(.+)/);
    if (m) fm[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return fm;
}

function lintFile(filePath, relPath) {
  const errors = [];
  const content = readFileSync(filePath, 'utf-8');

  // 1. Frontmatter
  const fm = parseFrontmatter(content);
  if (!fm) {
    errors.push(`Sin frontmatter YAML`);
    return { relPath, errors };
  }

  for (const field of REQUIRED_FRONTMATTER) {
    if (!fm[field]) errors.push(`Falta campo: ${field}`);
  }

  if (fm.model && !VALID_MODELS.has(fm.model)) {
    errors.push(`model="${fm.model}" no válido (debe ser opus | sonnet | haiku)`);
  }

  // 2. Voseo
  for (const pattern of VOSEO_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) errors.push(`Voseo detectado: "${matches[0]}" (${matches.length} ocurrencias)`);
  }

  return { relPath, errors };
}

function scanDir(srcDir, relBase = '') {
  const results = [];
  for (const entry of readdirSync(srcDir)) {
    const srcPath = path.join(srcDir, entry);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      results.push(...scanDir(srcPath, path.join(relBase, entry)));
    } else if (entry.endsWith('.md') && !META_FILES.has(entry)) {
      results.push(lintFile(srcPath, path.join(relBase, entry)));
    }
  }
  return results;
}

const skillsDir = path.resolve(__dirname, '..', '..', 'skills');
if (!existsSync(skillsDir)) {
  console.error(`✗ No se encontró skills/ en: ${skillsDir}`);
  process.exit(1);
}

const results = scanDir(skillsDir);
const withErrors = results.filter(r => r.errors.length > 0);

if (withErrors.length === 0) {
  console.log(`✓ ${results.length} skills validadas — sin errores`);
  process.exit(0);
} else {
  console.error(`✗ ${withErrors.length} de ${results.length} skills con errores:\n`);
  for (const { relPath, errors } of withErrors) {
    console.error(`  ${relPath}`);
    for (const e of errors) console.error(`    - ${e}`);
  }
  process.exit(1);
}
