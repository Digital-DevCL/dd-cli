/**
 * `dd-cli client refresh <slug>` — re-discovery + diff inteligente (S4-1).
 *
 * Flujo del loop de mantenimiento (sección 4.5 del rediseño):
 *   1. Re-corre client discover para obtener un snapshot fresco.
 *   2. Compara contra el catalog.yml actual del context repo.
 *   3. Reporta el diff: + nuevas apps, ~ modificadas, - removidas.
 *   4. Si hay cambios → propone aplicarlos (escribir al catalog.yml +
 *      avanzar state a DRAFT). Sin --apply: dry-run.
 *   5. Si no hay cambios → reporta "al día" + state queda igual.
 *
 * D-8: este comando es kernel. La skill /devflow-ia:client-refresh
 * lo invocará en Sprint 4.5 con conversación humana.
 */
import { existsSync } from 'node:fs';
import { getClient, getClientCacheDir } from '../types/registry.js';
import { getClientCredentials } from '../types/credentials.js';
import { createProvider } from '../providers/factory.js';
import { analyzeRepo, synthesizeDiscovery, type DiscoveryResult } from '../discovery/pattern-detector.js';
import { loadCatalog, saveCatalog, type Catalog, type CatalogApp, CatalogSchema, CatalogAppSchema } from '../types/catalog.js';
import { CLI_VERSION } from '../index.js';
import { runContextRender } from './context-render.js';
import { recordCommandResult, readClientState } from '../utils/client-state.js';
import { isJsonMode, emitJson, jsonSuccess, jsonError, type JsonModeOpts } from '../utils/json-output.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold } from '../utils/output.js';

export interface ClientRefreshOpts extends JsonModeOpts {
  /** Persistir el diff al catalog.yml. Sin esto: dry-run. */
  apply?: boolean;
  /** Concurrencia de file reads. Default 5. */
  concurrency?: number;
}

interface AppDiff {
  slug: string;
  change: 'added' | 'modified' | 'removed';
  before?: Partial<CatalogApp>;
  after?: Partial<CatalogApp>;
  changed_fields?: string[];
}

interface RefreshOutput {
  slug: string;
  applied: boolean;
  discovery_summary: string;
  diff: AppDiff[];
  total_changes: number;
  no_changes: boolean;
}

/**
 * Convierte un repo del discovery JSON en una entrada del catálogo.
 * Mismo mapeo que /init-context v0.6 hace al onboardear.
 */
function discoveryRepoToCatalogApp(repo: DiscoveryResult['repos'][number]): CatalogApp {
  // Mapeo de auth_pattern detectado → slug del profile.
  // En refresh respetamos un mismo slug por pattern; el consultor puede renombrar después.
  const authProfile = repo.auth_pattern === 'unknown' ? null : repo.auth_pattern;

  return CatalogAppSchema.parse({
    slug: repo.slug,
    name: repo.display_name || repo.slug,
    type: repo.app_type,
    role: repo.is_portal_shell ? 'portal' : repo.is_template ? 'standalone' : 'standalone',
    auth_profile: authProfile,
    ci_cd_profile: null,             // refresh no decide profiles — los humanos lo hacen
    repo: null,                       // se podría reconstruir desde provider.url
    branch: 'main',
    status: repo.inactive ? 'inactive' : 'unknown',
    app_origin: 'legacy-app',
    template_origin: null,
    preferred_dev_types: [],
    tags: repo.is_template ? ['template'] : [],
    notes: null,
  });
}

/**
 * Genera el diff entre el catálogo actual y el snapshot fresco del discovery.
 */
function computeDiff(current: CatalogApp[], next: CatalogApp[]): AppDiff[] {
  const diffs: AppDiff[] = [];
  const currentBySlug = new Map(current.map(a => [a.slug, a]));
  const nextBySlug = new Map(next.map(a => [a.slug, a]));

  // Nuevas
  for (const [slug, app] of nextBySlug) {
    if (!currentBySlug.has(slug)) {
      diffs.push({ slug, change: 'added', after: app });
    }
  }

  // Removidas
  for (const [slug, app] of currentBySlug) {
    if (!nextBySlug.has(slug)) {
      diffs.push({ slug, change: 'removed', before: app });
    }
  }

  // Modificadas (solo campos derivados del discovery — type, status, auth_profile, role)
  const watchedFields: Array<keyof CatalogApp> = ['type', 'status', 'auth_profile', 'role'];
  for (const [slug, before] of currentBySlug) {
    const after = nextBySlug.get(slug);
    if (!after) continue;
    const changed: string[] = [];
    for (const f of watchedFields) {
      if (JSON.stringify(before[f]) !== JSON.stringify(after[f])) changed.push(String(f));
    }
    if (changed.length > 0) {
      diffs.push({
        slug,
        change: 'modified',
        before: Object.fromEntries(changed.map(f => [f, before[f as keyof CatalogApp]])),
        after: Object.fromEntries(changed.map(f => [f, after[f as keyof CatalogApp]])),
        changed_fields: changed,
      });
    }
  }

  return diffs;
}

/**
 * Aplica el diff al catálogo, preservando campos editados por humanos
 * (notes, tags custom, preferred_dev_types, ci_cd_profile, repo).
 */
function applyDiffToCatalog(current: Catalog, next: CatalogApp[], diff: AppDiff[]): Catalog {
  const currentBySlug = new Map(current.apps.map(a => [a.slug, a]));
  const apps: CatalogApp[] = [];

  for (const fresh of next) {
    const existing = currentBySlug.get(fresh.slug);
    if (existing) {
      // Modificación: fusionar campos automáticos (del discovery) con
      // campos editados a mano (los preservamos del current).
      apps.push({
        ...fresh,
        // Preservar lo editado a mano:
        name: existing.name && existing.name !== fresh.slug ? existing.name : fresh.name,
        ci_cd_profile: existing.ci_cd_profile,
        repo: existing.repo,
        preferred_dev_types: existing.preferred_dev_types.length > 0 ? existing.preferred_dev_types : fresh.preferred_dev_types,
        tags: [...new Set([...existing.tags, ...fresh.tags])],
        notes: existing.notes ?? fresh.notes,
        // Status mantiene el del discovery solo si dejó de existir (inactive),
        // si no, preservar el editado a mano (puede haber sido marcado deprecated).
        status: fresh.status === 'inactive' ? 'inactive' : existing.status,
      });
    } else {
      apps.push(fresh);
    }
  }

  // Apps removidas no aparecen en `next`; las dejamos fuera del catálogo nuevo.
  // (Si el consultor quería conservarlas como deprecated, eso ya estaba en current.)

  return CatalogSchema.parse({ ...current, apps });
}

export async function runClientRefresh(slug: string, opts: ClientRefreshOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);

  if (!slug) {
    const e = { code: 'INVALID_INPUT' as const, message: 'Falta el slug. Uso: dd-cli client refresh <slug>' };
    if (jsonMode) emitJson(jsonError({ command: 'client refresh', ...e }));
    printErr(e.message);
    return 3;
  }

  const entry = getClient(slug);
  if (!entry) {
    const e = {
      code: 'CLIENT_NOT_REGISTERED' as const,
      message: `Cliente "${slug}" no registrado.`,
      recovery_hints: [`Registrá el cliente primero: dd-cli client new ${slug}`],
    };
    if (jsonMode) emitJson(jsonError({ command: 'client refresh', ...e }));
    printErr(e.message);
    return 2;
  }

  const creds = getClientCredentials(slug);
  if (!creds) {
    const e = {
      code: 'TOKEN_MISSING' as const,
      message: `No hay credenciales API para "${slug}".`,
      recovery_hints: [`Agregalas: dd-cli register-client ${slug} --git-token=<PAT> --git-group=<grupo> --force`],
    };
    if (jsonMode) emitJson(jsonError({ command: 'client refresh', ...e }));
    printErr(e.message);
    return 2;
  }

  const cacheDir = getClientCacheDir(slug);
  if (!existsSync(cacheDir)) {
    const e = {
      code: 'CONTEXT_CACHE_MISSING' as const,
      message: `Cache local no encontrada: ${cacheDir}`,
      recovery_hints: [`Sincronizá: dd-cli pull-context ${slug}`],
    };
    if (jsonMode) emitJson(jsonError({ command: 'client refresh', ...e }));
    printErr(e.message);
    return 2;
  }

  const currentCatalog = loadCatalog(cacheDir) ?? CatalogSchema.parse({ apps: [] });

  if (!jsonMode) {
    console.log(bold(`\nRefresh de ${slug}\n`));
    printInfo(`Re-corriendo discovery contra ${creds.git_host}/${creds.git_group} ...`);
  }

  // ── Re-correr discovery (igual lógica que client-discover) ──────
  const provider = createProvider(creds);
  const tokenCheck = await provider.validateToken({ required_for: ['read'] });
  if (!tokenCheck.valid) {
    const e = {
      code: 'TOKEN_INVALID' as const,
      message: tokenCheck.message,
      context: { provider: provider.type },
      recovery_hints: [`Regenerá el token: dd-cli register-client ${slug} --git-token=<nuevo> --force`],
    };
    if (jsonMode) emitJson(jsonError({ command: 'client refresh', ...e }));
    printErr(e.message);
    return 1;
  }

  let discovery: DiscoveryResult;
  try {
    const repos = await provider.listGroupRepos();
    const concurrency = Math.max(1, Math.min(opts.concurrency ?? 5, 20));
    const analyses = [];
    for (const meta of repos) {
      const lastActiveDays = meta.last_push
        ? Math.floor((Date.now() - new Date(meta.last_push).getTime()) / 86_400_000)
        : 9999;
      const veryInactive = meta.archived || lastActiveDays > 365;
      if (veryInactive) {
        analyses.push(analyzeRepo(meta, {}));
        continue;
      }
      const files = await readKeyFiles(provider, provider.type === 'gitlab' ? meta.id : meta.slug, meta.default_branch, concurrency);
      analyses.push(analyzeRepo(meta, files));
    }
    discovery = synthesizeDiscovery(analyses);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    const errObj = {
      code: 'NETWORK_ERROR' as const,
      message: `Discovery falló: ${errMsg}`,
      context: { provider: provider.type },
      recovery_hints: ['Verificá conectividad y validez del token'],
    };
    if (jsonMode) emitJson(jsonError({ command: 'client refresh', ...errObj }));
    printErr(errObj.message);
    return 1;
  }

  // ── Mapeo + diff ─────────────────────────────────────────────────
  const freshApps = discovery.repos.map(discoveryRepoToCatalogApp);
  const diff = computeDiff(currentCatalog.apps, freshApps);
  const noChanges = diff.length === 0;

  // ── Reporte humano del diff ──────────────────────────────────────
  if (!jsonMode) {
    console.log('');
    printOk(`Discovery completo (${discovery.repos.length} repos)`);
    printDim('  ' + discovery.summary);
    console.log('');

    if (noChanges) {
      printOk('No hay cambios — el catálogo está al día.');
    } else {
      printInfo(`Diff (${diff.length} cambios):`);
      for (const d of diff) {
        if (d.change === 'added') {
          console.log(`  + ${d.slug}  (${d.after?.type ?? '?'} · ${d.after?.auth_profile ?? 'sin auth'})`);
        } else if (d.change === 'removed') {
          console.log(`  - ${d.slug}`);
        } else {
          console.log(`  ~ ${d.slug}  (${d.changed_fields?.join(', ')})`);
        }
      }
    }
    console.log('');
  }

  // ── Apply o dry-run ──────────────────────────────────────────────
  let applied = false;
  if (opts.apply && !noChanges) {
    const merged = applyDiffToCatalog(currentCatalog, freshApps, diff);
    saveCatalog(cacheDir, merged, {
      generated_by: 'dd-cli client refresh',
      cli_version: CLI_VERSION,
    });
    // Regenerar markdown derivado
    try { await runContextRender(cacheDir, { json: true }); } catch { /* no crítico */ }
    applied = true;
    if (!jsonMode) {
      printOk('Catálogo actualizado en cache local.');
      printDim('  Para publicar: dd-cli client publish ' + slug);
    }
  } else if (!noChanges && !jsonMode) {
    printInfo('Dry-run. Para aplicar: dd-cli client refresh ' + slug + ' --apply');
  }

  // ── State machine: si hubo cambios y aplicamos, avanzar a DRAFT.
  // Si no hubo cambios, mantener (READY → READY o ACTIVE → ACTIVE).
  const existingState = readClientState(slug)?.state;
  let nextState: 'DRAFT' | undefined;
  if (applied) {
    if (existingState === 'READY' || existingState === 'ACTIVE' || existingState === 'NEEDS_REFRESH') {
      nextState = 'DRAFT';
    }
  }
  recordCommandResult(slug, 'client refresh', {
    success: true,
    state: nextState,
    nextSafe: applied ? `dd-cli client publish ${slug}` : null,
  });

  const output: RefreshOutput = {
    slug,
    applied,
    discovery_summary: discovery.summary,
    diff,
    total_changes: diff.length,
    no_changes: noChanges,
  };

  if (jsonMode) {
    emitJson(jsonSuccess('client refresh', output, applied ? `dd-cli client publish ${slug}` : null));
  }

  return 0;
}

// ── Helper duplicado de client-discover.ts ──────────────────────────
// Mantener sincronizado con la lista de archivos del pattern-detector.

const DISCOVERY_FILES: string[] = [
  'package.json', 'composer.json', 'pom.xml', 'requirements.txt', 'Gemfile',
  '.gitlab-ci.yml', '.github/workflows/ci.yml',
  'config/sso.php', 'config/auth.php',
  'src/auth/index.ts', 'src/main.ts',
  'app/Http/Kernel.php',
];

async function readKeyFiles(
  provider: ReturnType<typeof createProvider>,
  repoIdOrSlug: string | number,
  branch: string,
  concurrency: number
): Promise<Record<string, { path: string; content: string; found: boolean }>> {
  const result: Record<string, { path: string; content: string; found: boolean }> = {};
  const queue = [...DISCOVERY_FILES];
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const file = queue.shift();
      if (!file) return;
      try {
        result[file] = await provider.readFile(repoIdOrSlug, file, branch);
      } catch {
        result[file] = { path: file, content: '', found: false };
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return result;
}
