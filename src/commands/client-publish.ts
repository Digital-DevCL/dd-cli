/**
 * `dd-cli client publish <slug>` — cierre del flujo onboarding (S3-4).
 *
 * Pre-condición esperada (DRAFT o DISCOVERED):
 *   - El context repo local en ~/.devflow/clients/<slug>/ tiene los artefactos
 *     listos: stack.yml + catalog.yml + auth-profiles/ + cicd-profiles/.
 *   - Idealmente la skill /devflow-ia:client-onboard ya los generó.
 *
 * Pasos:
 *   1. Validar cliente registrado + cache existente.
 *   2. context validate → si hay errores, abortar con recovery hints.
 *   3. context render → regenerar markdown derivado (app-catalog.md).
 *   4. Detectar si hay cambios staged/unstaged.
 *   5. git add + commit + push origin main.
 *   6. updateLastSynced + state.json → READY.
 *
 * Idempotente: si no hay cambios para publicar, lo reporta y termina con éxito.
 *
 * D-1: el primer publish (REGISTERED/DISCOVERED → READY) push directo a main.
 * Sprint 4 implementará PR-flow para refresh y refresh-publish.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getClient, getClientCacheDir, updateLastSynced } from '../types/registry.js';
import { validateContextRepo } from './context-validate.js';
import { runContextRender } from './context-render.js';
import { recordCommandResult, readClientState } from '../utils/client-state.js';
import { isJsonMode, emitJson, jsonSuccess, jsonError, type JsonModeOpts } from '../utils/json-output.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold } from '../utils/output.js';

export interface ClientPublishOpts extends JsonModeOpts {
  /** No pushear al remoto, solo commit local. */
  noPush?: boolean;
  /** Forzar publicación aunque context validate reporte warnings. */
  ignoreWarnings?: boolean;
}

interface PublishStep {
  type: 'validate' | 'render' | 'commit' | 'push' | 'sync';
  action: 'ok' | 'skipped' | 'failed' | 'no-changes';
  detail?: string;
}

function runGit(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

export async function runClientPublish(slug: string, opts: ClientPublishOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);

  if (!slug) {
    const err = {
      code: 'INVALID_INPUT' as const,
      message: 'Falta el slug del cliente. Uso: dd-cli client publish <slug>',
    };
    if (jsonMode) emitJson(jsonError({ command: 'client publish', ...err }));
    printErr(err.message);
    return 3;
  }

  const entry = getClient(slug);
  if (!entry) {
    const err = {
      code: 'CLIENT_NOT_REGISTERED' as const,
      message: `Cliente "${slug}" no registrado.`,
      context: { slug },
      recovery_hints: [
        `Registrá el cliente primero: dd-cli client new ${slug}`,
      ],
      next_safe_command: `dd-cli client new ${slug}`,
    };
    if (jsonMode) emitJson(jsonError({ command: 'client publish', ...err }));
    printErr(err.message);
    return 2;
  }

  const cacheDir = getClientCacheDir(slug);
  if (!existsSync(cacheDir)) {
    const err = {
      code: 'CONTEXT_CACHE_MISSING' as const,
      message: `Cache local no encontrada: ${cacheDir}`,
      context: { slug, cache_dir: cacheDir },
      recovery_hints: [`Re-clonar: dd-cli pull-context ${slug}`],
    };
    if (jsonMode) emitJson(jsonError({ command: 'client publish', ...err }));
    printErr(err.message);
    return 2;
  }

  const steps: PublishStep[] = [];

  // ── 1. Validar ─────────────────────────────────────────────────────
  const findings = validateContextRepo(cacheDir);
  const errors = findings.filter(f => f.level === 'err');
  const warnings = findings.filter(f => f.level === 'warn');

  if (errors.length > 0) {
    steps.push({ type: 'validate', action: 'failed', detail: `${errors.length} errores` });
    const err = {
      code: 'CONTEXT_REPO_INVALID' as const,
      message: `Context repo inválido: ${errors.length} errores. No se puede publicar.`,
      context: { errors: errors.map(e => ({ rule: e.rule, message: e.message })) },
      recovery_hints: [
        `Revisá los errores: dd-cli context validate ${cacheDir}`,
        'Editá los archivos a mano o re-corré /devflow-ia:client-onboard',
      ],
    };
    if (jsonMode) emitJson(jsonError({ command: 'client publish', ...err }));
    printErr(err.message);
    return 3;
  }
  if (warnings.length > 0 && !opts.ignoreWarnings && !jsonMode) {
    printWarn(`${warnings.length} warnings detectados:`);
    for (const w of warnings.slice(0, 5)) printDim(`  ${w.rule}: ${w.message}`);
    if (warnings.length > 5) printDim(`  ... y ${warnings.length - 5} más`);
    printDim('Tipá Ctrl-C para abortar, o re-corré con --ignore-warnings para continuar.');
  }
  steps.push({ type: 'validate', action: 'ok', detail: `${findings.filter(f => f.level === 'ok').length} OK, ${warnings.length} warnings` });

  // ── 2. Render markdown derivado ──────────────────────────────────
  try {
    await runContextRender(cacheDir, { json: true /* silenciar output */ });
    steps.push({ type: 'render', action: 'ok' });
  } catch (e) {
    // Solo loggeamos; render no es crítico para el push
    steps.push({ type: 'render', action: 'failed', detail: e instanceof Error ? e.message : String(e) });
  }

  // ── 3. Detectar cambios ──────────────────────────────────────────
  let hasChanges = false;
  try {
    const status = runGit('git status --porcelain', cacheDir);
    hasChanges = status.trim().length > 0;
  } catch (e) {
    const err = {
      code: 'INTERNAL_ERROR' as const,
      message: `git status falló: ${e instanceof Error ? e.message : String(e)}`,
      context: { cache_dir: cacheDir },
    };
    if (jsonMode) emitJson(jsonError({ command: 'client publish', ...err }));
    printErr(err.message);
    return 1;
  }

  // ── 4. Commit + push ─────────────────────────────────────────────
  if (!hasChanges) {
    steps.push({ type: 'commit', action: 'no-changes' });
    if (!jsonMode) printDim('No hay cambios para publicar.');
  } else {
    try {
      runGit('git add .', cacheDir);
      const commitMsg = `feat: publish context for ${slug}\n\nGenerado por dd-cli client publish (S3-4).`;
      runGit(`git -c commit.gpgsign=false commit -m "${commitMsg}"`, cacheDir);
      steps.push({ type: 'commit', action: 'ok' });
      if (!jsonMode) printOk('Commit creado');
    } catch (e) {
      const err = {
        code: 'INTERNAL_ERROR' as const,
        message: `git commit falló: ${e instanceof Error ? e.message : String(e)}`,
        context: { cache_dir: cacheDir },
      };
      if (jsonMode) emitJson(jsonError({ command: 'client publish', ...err }));
      printErr(err.message);
      return 1;
    }

    if (!opts.noPush) {
      try {
        runGit('git push origin HEAD', cacheDir);
        steps.push({ type: 'push', action: 'ok' });
        if (!jsonMode) printOk(`Push a ${entry.context_url}`);
      } catch (e) {
        steps.push({ type: 'push', action: 'failed', detail: e instanceof Error ? e.message : String(e) });
        const err = {
          code: 'GIT_PUSH_FAILED' as const,
          message: `git push falló: ${e instanceof Error ? e.message : String(e)}`,
          context: { context_url: entry.context_url },
          recovery_hints: [
            'Verificá permisos del token (scope `api` o `repo`)',
            'Si branch protection bloquea, considerá --no-branch-protection en client new',
          ],
        };
        if (jsonMode) emitJson(jsonError({ command: 'client publish', ...err }));
        printErr(err.message);
        return 1;
      }
    } else {
      steps.push({ type: 'push', action: 'skipped', detail: '--no-push' });
    }
  }

  // ── 5. Sync registry + state ─────────────────────────────────────
  updateLastSynced(slug);
  steps.push({ type: 'sync', action: 'ok' });

  // Avanza el state: REGISTERED/DISCOVERED/DRAFT → READY
  // (la máquina de estados de S3-7 valida transiciones legales)
  const existingState = readClientState(slug)?.state;
  try {
    recordCommandResult(slug, 'client publish', {
      success: true,
      state: 'READY',
      nextSafe: 'cd <repo-de-codigo> && dd-cli init --client=' + slug,
    });
  } catch (e) {
    // Si la transición no es legal, no fallamos el publish — sólo loggeamos.
    if (!jsonMode) printDim(`Estado actual: ${existingState ?? 'unknown'} (no se pudo avanzar a READY)`);
  }

  if (jsonMode) {
    emitJson(jsonSuccess('client publish', {
      slug,
      cache_dir: cacheDir,
      context_url: entry.context_url,
      steps,
      state: 'READY',
    }, `cd <repo-de-codigo> && dd-cli init --client=${slug}`));
  }

  console.log('');
  printOk(`Cliente ${bold(slug)} → ${bold('READY')}`);
  console.log('');
  printInfo('Para que un dev arranque a programar:');
  printDim(`  cd <repo-de-codigo>`);
  printDim(`  dd-cli init --client=${slug}`);
  printDim(`  dd-cli start-session <HDU-id>`);
  return 0;
}
