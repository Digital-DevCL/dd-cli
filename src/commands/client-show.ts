/**
 * `dd-cli client show <slug>` — dashboard de un cliente (S3-5).
 *
 * Read-only. Una sola pantalla que muestra todo (sección 4.3 del rediseño):
 *   - Identidad: badge de estado + nombre + slug + industria + equipo
 *   - Context repo: URL + último sync + schema version
 *   - Stack: backend + frontend + db + infra
 *   - Apps: contador con detalle por tipo y status
 *   - Auth profiles + CI/CD profiles
 *   - Actividad reciente (state + último comando)
 *   - Acciones sugeridas (siguiente paso según state)
 *
 * Bajo D-8 / D-5: lee solo cache local. Si está stale, muestra warning.
 * Acciones sugeridas son comandos copiables.
 */
import { existsSync } from 'node:fs';
import { getClient, getClientCacheDir } from '../types/registry.js';
import { loadStackConfig } from '../types/stack-config.js';
import { loadCatalog } from '../types/catalog.js';
import { loadContextRepoMarker } from '../types/context-repo.js';
import { readClientState, suggestedCommandFor, type ClientStateName } from '../utils/client-state.js';
import { isJsonMode, emitJson, jsonSuccess, jsonError, type JsonModeOpts } from '../utils/json-output.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold, ok, warn, err, dim } from '../utils/output.js';

export interface ClientShowOpts extends JsonModeOpts {}

interface ShowOutput {
  slug: string;
  name: string;
  state: ClientStateName | 'UNKNOWN';
  context_url: string;
  last_synced: string | null;
  stale: boolean;
  provider: { type: string; base_url: string; group_or_org: string } | null;
  stack: {
    backend: string | null;
    frontend: string | null;
    databases: string[];
    infra: string | null;
    cicd_platform: string | null;
  } | null;
  apps_count: number;
  apps_by_type: Record<string, number>;
  apps_by_status: Record<string, number>;
  auth_profiles: string[];
  cicd_profiles: string[];
  last_command: string | null;
  last_command_at: string | null;
  next_safe_command: string | null;
  suggested_actions: string[];
}

function ageInHours(iso: string | null): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

/**
 * Enmascara credenciales embebidas en URLs `https://user:token@host/...`.
 * Importante: el output de show es público (Claude lo lee), no podemos filtrar PATs.
 */
function maskCredentials(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = '***';
      u.password = '';
    }
    return u.toString();
  } catch {
    return url.replace(/\/\/[^@]+@/, '//***@');
  }
}

function formatAge(iso: string | null): string {
  if (!iso) return 'nunca';
  const h = ageInHours(iso);
  if (h < 1) return 'hace minutos';
  if (h < 24) return `hace ${Math.floor(h)}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

function stateBadgeColor(state: ClientStateName | 'UNKNOWN'): (s: string) => string {
  switch (state) {
    case 'READY':
    case 'ACTIVE':         return ok;
    case 'NEEDS_REFRESH':  return warn;
    case 'REGISTERED':
    case 'DISCOVERED':
    case 'DRAFT':          return warn;
    default:               return err;
  }
}

export async function runClientShow(slug: string, opts: ClientShowOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);

  if (!slug) {
    const e = {
      code: 'INVALID_INPUT' as const,
      message: 'Falta el slug. Uso: dd-cli client show <slug>',
    };
    if (jsonMode) emitJson(jsonError({ command: 'client show', ...e }));
    printErr(e.message);
    return 3;
  }

  const entry = getClient(slug);
  if (!entry) {
    const e = {
      code: 'CLIENT_NOT_REGISTERED' as const,
      message: `Cliente "${slug}" no registrado.`,
      recovery_hints: [
        `Ver clientes registrados: dd-cli client list`,
        `Registrar nuevo: dd-cli client new ${slug}`,
      ],
    };
    if (jsonMode) emitJson(jsonError({ command: 'client show', ...e }));
    printErr(e.message);
    return 2;
  }

  const cacheDir = getClientCacheDir(slug);
  const cacheExists = existsSync(cacheDir);
  const state = readClientState(slug);
  const stateName: ClientStateName | 'UNKNOWN' = state?.state ?? 'UNKNOWN';
  const isStale = ageInHours(entry.last_synced) > 24;

  // Cargar artefactos (best-effort)
  let stackConfig: ReturnType<typeof loadStackConfig> = null;
  let catalog: ReturnType<typeof loadCatalog> = null;
  let marker: ReturnType<typeof loadContextRepoMarker> = null;
  if (cacheExists) {
    try { stackConfig = loadStackConfig(cacheDir); } catch { /* silently */ }
    try { catalog = loadCatalog(cacheDir); } catch { /* silently */ }
    try { marker = loadContextRepoMarker(cacheDir); } catch { /* silently */ }
  }

  // Agregaciones
  const apps = catalog?.apps ?? [];
  const appsByType: Record<string, number> = {};
  const appsByStatus: Record<string, number> = {};
  const authProfiles = new Set<string>();
  const cicdProfiles = new Set<string>();
  for (const a of apps) {
    appsByType[a.type] = (appsByType[a.type] ?? 0) + 1;
    appsByStatus[a.status] = (appsByStatus[a.status] ?? 0) + 1;
    if (a.auth_profile) authProfiles.add(a.auth_profile);
    if (a.ci_cd_profile && a.ci_cd_profile !== '[por-confirmar]') cicdProfiles.add(a.ci_cd_profile);
  }

  // Acciones sugeridas
  const suggestedActions: string[] = [];
  const cmd = suggestedCommandFor(stateName === 'UNKNOWN' ? 'REGISTERED' : stateName, slug);
  if (cmd) suggestedActions.push(cmd);
  if (isStale) suggestedActions.push(`dd-cli pull-context ${slug}    # cache stale (${formatAge(entry.last_synced)})`);
  if (!cacheExists) suggestedActions.push(`dd-cli pull-context ${slug}    # cache no existe`);

  const output: ShowOutput = {
    slug,
    name: stackConfig?.client.name ?? marker?.client.name ?? entry.name ?? slug,
    state: stateName,
    context_url: maskCredentials(entry.context_url),
    last_synced: entry.last_synced ?? null,
    stale: isStale,
    provider: marker?.provider
      ? { type: marker.provider.type, base_url: marker.provider.base_url, group_or_org: marker.provider.group_or_org }
      : null,
    stack: stackConfig
      ? {
          backend: stackConfig.stack.backend_framework,
          frontend: stackConfig.stack.frontend_framework,
          databases: stackConfig.stack.databases,
          infra: stackConfig.stack.infra,
          cicd_platform: stackConfig.stack.cicd_platform,
        }
      : null,
    apps_count: apps.length,
    apps_by_type: appsByType,
    apps_by_status: appsByStatus,
    auth_profiles: [...authProfiles],
    cicd_profiles: [...cicdProfiles],
    last_command: state?.last_command ?? null,
    last_command_at: state?.last_command_at ?? null,
    next_safe_command: state?.next_safe_command ?? cmd ?? null,
    suggested_actions: suggestedActions,
  };

  if (jsonMode) {
    emitJson(jsonSuccess('client show', output, cmd));
  }

  // ── Output humano ────────────────────────────────────────────────
  const badgeFn = stateBadgeColor(stateName);
  console.log('');
  console.log(`  ${bold(output.name)}    ${badgeFn('● ' + stateName)}`);
  console.log(`  ${dim(slug)}`);
  if (stackConfig?.client.industry) console.log(`  ${dim(stackConfig.client.industry)}`);
  if (stackConfig?.client.primary_contact) console.log(`  ${dim('Contacto: ' + stackConfig.client.primary_contact)}`);
  console.log('');

  // Context repo
  console.log(bold('  CONTEXT REPO'));
  console.log(`    ${maskCredentials(entry.context_url)}`);
  console.log(`    ${dim('último sync:    ' + formatAge(entry.last_synced))}${isStale ? '  ' + warn('⚠ stale') : '  ' + ok('✓')}`);
  if (marker) console.log(`    ${dim('schema:         v' + marker.schema_version)}`);
  console.log('');

  // Stack
  if (stackConfig) {
    console.log(bold('  STACK'));
    console.log(`    ${'backend'.padEnd(11)}${stackConfig.stack.backend_framework}`);
    console.log(`    ${'frontend'.padEnd(11)}${stackConfig.stack.frontend_framework}`);
    if (stackConfig.stack.databases.length > 0) {
      console.log(`    ${'db'.padEnd(11)}${stackConfig.stack.databases.join(', ')}`);
    }
    console.log(`    ${'infra'.padEnd(11)}${stackConfig.stack.infra}`);
    console.log(`    ${'ci/cd'.padEnd(11)}${stackConfig.stack.cicd_platform}`);
    console.log('');
  } else if (cacheExists) {
    printDim('  STACK no configurado — falta .devflow-context/stack.yml');
    console.log('');
  }

  // Apps
  if (apps.length > 0) {
    console.log(bold(`  APPS (${apps.length})`));
    for (const [type, count] of Object.entries(appsByType)) {
      console.log(`    ${('· ' + type).padEnd(20)}${count}`);
    }
    console.log('');
  }

  // Profiles
  if (authProfiles.size > 0 || cicdProfiles.size > 0) {
    console.log(bold('  PROFILES'));
    if (authProfiles.size > 0) console.log(`    auth        ${[...authProfiles].slice(0, 3).join(', ')}${authProfiles.size > 3 ? ', ...' : ''}`);
    if (cicdProfiles.size > 0) console.log(`    ci/cd       ${[...cicdProfiles].slice(0, 3).join(', ')}${cicdProfiles.size > 3 ? ', ...' : ''}`);
    console.log('');
  }

  // Actividad
  if (state) {
    console.log(bold('  ACTIVIDAD'));
    console.log(`    último comando: ${state.last_command} (${formatAge(state.last_command_at)})`);
    console.log('');
  }

  // Acciones sugeridas
  if (suggestedActions.length > 0) {
    console.log(bold('  ACCIONES SUGERIDAS'));
    for (const action of suggestedActions) console.log(`    → ${action}`);
    console.log('');
  }

  return 0;
}
