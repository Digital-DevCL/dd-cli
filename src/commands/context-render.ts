/**
 * `dd-cli context render [path]` (S2-5).
 *
 * Regenera las vistas markdown derivadas desde los YAMLs canónicos del
 * context repo. Idempotente: si el markdown ya está al día, no escribe.
 *
 * Resuelve A-4 del rediseño: "la fuente de verdad del catálogo es markdown,
 * frágil por diseño". Ahora YAML es la fuente y MD se regenera con este
 * comando como vista derivada.
 *
 * Vistas regeneradas:
 *   .devflow-context/catalog.yml → .devflow-context/app-catalog.md
 *
 * Sprint 3 podría extender este comando para regenerar también CLAUDE.md,
 * READMEs por auth-profile, etc. — hoy nos quedamos con el catálogo, que
 * es la fricción documentada en B-1.
 *
 * Output JSON estructurado (S1-9 / D-7/D-8).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  loadCatalog,
  renderCatalogMarkdown,
  getCatalogYamlPath,
  getCatalogMarkdownPath,
} from '../types/catalog.js';
import { isContextRepo } from '../types/context-repo.js';
import { isJsonMode, emitJson, jsonSuccess, jsonError, type JsonModeOpts } from '../utils/json-output.js';
import { printOk, printErr, printInfo, printDim, bold } from '../utils/output.js';

export interface ContextRenderOpts extends JsonModeOpts {
  /** Forzar reescritura aunque el contenido sea idéntico. */
  force?: boolean;
  /** No tocar disco; solo reportar qué se regeneraría. */
  dryRun?: boolean;
}

interface RenderStep {
  type: 'catalog-md';
  from: string;
  to: string;
  action: 'written' | 'unchanged' | 'would-write' | 'skipped';
  reason?: string;
}

export async function runContextRender(repoPathArg: string | undefined, opts: ContextRenderOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);
  const repoRoot = path.resolve(repoPathArg ?? process.cwd());

  if (!existsSync(repoRoot)) {
    const err = {
      code: 'INVALID_INPUT' as const,
      message: `El path "${repoRoot}" no existe.`,
      recovery_hints: ['Corré desde un context repo o pasá un path válido.'],
    };
    if (jsonMode) emitJson(jsonError({ command: 'context render', ...err }));
    printErr(err.message);
    return 3;
  }

  if (!isContextRepo(repoRoot)) {
    const err = {
      code: 'CONTEXT_REPO_INVALID' as const,
      message: 'El directorio no parece ser un context repo (no hay .devflow-context/).',
      context: { repo_root: repoRoot },
      recovery_hints: [
        'Validá primero: dd-cli context validate',
        'Si todavía no existe el context repo: /devflow-ia:client-onboard (Sprint 3)',
      ],
    };
    if (jsonMode) emitJson(jsonError({ command: 'context render', ...err }));
    printErr(err.message);
    return 3;
  }

  const steps: RenderStep[] = [];

  // ── Render catalog.yml → app-catalog.md ───────────────────────────
  const yamlPath = getCatalogYamlPath(repoRoot);
  const mdPath = getCatalogMarkdownPath(repoRoot);

  if (!existsSync(yamlPath)) {
    steps.push({
      type: 'catalog-md',
      from: yamlPath,
      to: mdPath,
      action: 'skipped',
      reason: 'No hay catalog.yml — nada que renderizar. Corré `dd-cli client migrate <slug>` si tenés app-catalog.md viejo.',
    });
  } else {
    try {
      const catalog = loadCatalog(repoRoot);
      if (!catalog) {
        steps.push({ type: 'catalog-md', from: yamlPath, to: mdPath, action: 'skipped', reason: 'catalog.yml vacío' });
      } else {
        const next = renderCatalogMarkdown(catalog);
        const current = existsSync(mdPath) ? readFileSync(mdPath, 'utf-8') : '';

        if (current === next && !opts.force) {
          steps.push({ type: 'catalog-md', from: yamlPath, to: mdPath, action: 'unchanged' });
        } else if (opts.dryRun) {
          steps.push({ type: 'catalog-md', from: yamlPath, to: mdPath, action: 'would-write' });
        } else {
          writeFileSync(mdPath, next, 'utf-8');
          steps.push({ type: 'catalog-md', from: yamlPath, to: mdPath, action: 'written' });
        }
      }
    } catch (e) {
      const errMsg = e instanceof Error ? (e.message.split('\n')[0] ?? e.message) : String(e);
      const err = {
        code: 'CATALOG_PARSE_ERROR' as const,
        message: `catalog.yml inválido: ${errMsg}`,
        context: { repo_root: repoRoot, yaml_path: yamlPath },
        recovery_hints: [
          'Validá schema: dd-cli context validate',
          `Revisá ${yamlPath} a mano`,
        ],
      };
      if (jsonMode) emitJson(jsonError({ command: 'context render', ...err }));
      printErr(err.message);
      return 3;
    }
  }

  // ── Reportar ──────────────────────────────────────────────────────
  if (jsonMode) {
    emitJson(jsonSuccess('context render', {
      repo_root: repoRoot,
      steps,
      written: steps.some(s => s.action === 'written'),
      dry_run: !!opts.dryRun,
    }));
  }

  console.log('');
  console.log(bold(`Render de vistas derivadas: ${repoRoot}`));
  console.log('');
  for (const step of steps) {
    const target = path.relative(repoRoot, step.to);
    switch (step.action) {
      case 'written':      printOk(`  ${target} ← regenerado`); break;
      case 'would-write':  printInfo(`  ${target} ← cambiaría (dry-run)`); break;
      case 'unchanged':    printDim(`  ${target} sin cambios`); break;
      case 'skipped':      printDim(`  ${target} omitido (${step.reason ?? 'sin razón'})`); break;
    }
  }
  return 0;
}
