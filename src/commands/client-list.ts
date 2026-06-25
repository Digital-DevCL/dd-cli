/**
 * `dd-cli client list` y `dd-cli home` (S3-6).
 *
 * client list: tabla con todos los clientes registrados, estado actual,
 *   contadores de apps, último sync.
 *
 * home: dashboard del operador. Resumen de todos los clientes + sistema
 *   (CLI version, skills, Claude Code) + actividad del día.
 *
 * Bajo D-8 / D-5: read-only sobre cache local. Sin llamadas remotas.
 */
import { existsSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { loadRegistry, getClientCacheDir } from '../types/registry.js';
import { loadCatalog } from '../types/catalog.js';
import { readClientState, type ClientStateName } from '../utils/client-state.js';
import { loadSession } from '../utils/session-io.js';
import {
  getClaudeSkillsDir,
  isClaudeCodeInstalled,
  findDevFlowProjectRoot,
} from '../utils/paths.js';
import { CLI_VERSION } from '../index.js';
import { isJsonMode, emitJson, jsonSuccess, type JsonModeOpts } from '../utils/json-output.js';
import { printOk, printWarn, printInfo, printDim, bold, ok, warn, err, dim } from '../utils/output.js';

export interface ClientListOpts extends JsonModeOpts {}
export interface HomeOpts extends JsonModeOpts {}

interface ClientListEntry {
  slug: string;
  name: string;
  state: ClientStateName | 'UNKNOWN';
  apps_count: number;
  last_synced: string | null;
  stale: boolean;
}

function ageInHours(iso: string | null): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}
function formatAge(iso: string | null): string {
  if (!iso) return 'nunca';
  const h = ageInHours(iso);
  if (h < 1) return 'hace minutos';
  if (h < 24) return `hace ${Math.floor(h)}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

function badgeForState(state: ClientStateName | 'UNKNOWN'): string {
  switch (state) {
    case 'READY':
    case 'ACTIVE':         return ok('●');
    case 'NEEDS_REFRESH':  return warn('⚠');
    case 'REGISTERED':
    case 'DISCOVERED':
    case 'DRAFT':          return warn('⚙');
    default:               return err('✗');
  }
}

function listClients(): ClientListEntry[] {
  const registry = loadRegistry();
  return Object.values(registry.clients).map(entry => {
    const cacheDir = getClientCacheDir(entry.slug);
    const state = readClientState(entry.slug);
    let appsCount = 0;
    if (existsSync(cacheDir)) {
      try {
        const catalog = loadCatalog(cacheDir);
        appsCount = catalog?.apps.length ?? 0;
      } catch { /* */ }
    }
    return {
      slug: entry.slug,
      name: entry.name,
      state: state?.state ?? 'UNKNOWN',
      apps_count: appsCount,
      last_synced: entry.last_synced ?? null,
      stale: ageInHours(entry.last_synced) > 24,
    };
  });
}

export async function runClientList(opts: ClientListOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);
  const clients = listClients();

  if (jsonMode) {
    emitJson(jsonSuccess('client list', { clients, total: clients.length }));
  }

  console.log('');
  if (clients.length === 0) {
    printWarn('Ningún cliente registrado.');
    printInfo('Registrar el primero: dd-cli client new <slug>');
    console.log('');
    return 0;
  }

  for (const c of clients) {
    const badge = badgeForState(c.state);
    const sync = c.stale ? warn(formatAge(c.last_synced)) : dim(formatAge(c.last_synced));
    const stateLabel = c.state.padEnd(14);
    const appsLabel = `${c.apps_count} apps`.padEnd(10);
    console.log(`  ${badge}  ${bold(c.slug.padEnd(20))}${stateLabel}${appsLabel}${sync}`);
  }

  console.log('');
  printDim(`  Total: ${clients.length} clientes · ${clients.reduce((s, c) => s + c.apps_count, 0)} apps catalogadas`);
  printDim(`  → dd-cli client show <slug>      detalle por cliente`);
  console.log('');
  return 0;
}

export async function runHome(opts: HomeOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);
  const clients = listClients();

  // Sistema
  const skillsDir = getClaudeSkillsDir();
  const skillsCount = existsSync(skillsDir)
    ? readdirSync(skillsDir).filter(f => f.endsWith('.md')).length
    : 0;
  const claudeOk = isClaudeCodeInstalled();

  // Sesión activa (si hay)
  let activeSession: { feature_id: string; dev_type: string; step: number } | null = null;
  const projectRoot = findDevFlowProjectRoot();
  if (projectRoot) {
    try {
      const session = loadSession(projectRoot);
      if (session?.started_at && !session.ended_at) {
        activeSession = {
          feature_id: session.feature_id ?? '?',
          dev_type: session.dev_type ?? '?',
          step: 0, // S6 calculará esto bien
        };
      }
    } catch { /* */ }
  }

  // Buckets
  const byState: Record<string, number> = {};
  for (const c of clients) byState[c.state] = (byState[c.state] ?? 0) + 1;

  if (jsonMode) {
    emitJson(jsonSuccess('home', {
      cli_version: CLI_VERSION,
      skills_count: skillsCount,
      claude_code: claudeOk,
      clients_total: clients.length,
      clients_by_state: byState,
      clients,
      active_session: activeSession,
    }));
  }

  console.log('');
  console.log(bold(`  DevFlow IA   · ${new Date().toLocaleDateString('es-CL')}`));
  console.log('');

  // Clientes
  console.log(bold(`  TUS CLIENTES (${clients.length})`));
  if (clients.length === 0) {
    printDim('    (ninguno)');
    printInfo('    Registrar el primero: dd-cli client new <slug>');
  } else {
    for (const c of clients) {
      const badge = badgeForState(c.state);
      console.log(`    ${badge} ${bold(c.slug.padEnd(15))}${c.state.padEnd(14)}${dim(formatAge(c.last_synced))}`);
    }
  }
  console.log('');

  // Actividad
  if (activeSession) {
    console.log(bold('  ACTIVIDAD'));
    console.log(`    sesión activa: ${activeSession.feature_id} · ${activeSession.dev_type}`);
    console.log('');
  }

  // Sistema
  console.log(bold('  SISTEMA'));
  console.log(`    CLI v${CLI_VERSION}        ${ok('✓')}`);
  console.log(`    Skills ${skillsCount}          ${skillsCount > 0 ? ok('✓') : warn('⚠')}`);
  console.log(`    Claude Code      ${claudeOk ? ok('✓') : err('✗')}`);
  console.log('');

  return 0;
}
