/**
 * `dd-cli hdu next --client=<slug> --user=<email>` (S5-3) — sugiere la próxima HDU.
 *
 * Scoring por factores (D-13 del Apéndice D del rediseño):
 *   1. Prioridad         (crítica > alta > media > baja)
 *   2. App match         (apps que el dev tocó recientemente)
 *   3. Continuidad       (mismo dev_type que la última cerrada por el dev)
 *   4. Membership sprint (HDUs del sprint actual ganan)
 *   5. Antigüedad        (HDUs viejas suben para evitar starvation)
 *
 * --explain muestra el breakdown numérico. Output JSON con todos los
 * scores para que /devflow-ia:pick-next pueda interpretarlos.
 */
import { existsSync } from 'node:fs';
import { getClient, getClientCacheDir } from '../types/registry.js';
import {
  listHdus, readTransitions,
  type Hdu, type HduPriority,
} from '../types/hdu.js';
import { isJsonMode, emitJson, jsonSuccess, jsonError, type JsonModeOpts } from '../utils/json-output.js';
import { printOk, printErr, printDim, printInfo, bold } from '../utils/output.js';

export interface HduNextOpts extends JsonModeOpts {
  client?: string;
  user?: string;             // email del dev (para mine + continuidad)
  explain?: boolean;
}

interface ScoreBreakdown {
  priority: number;
  app_match: number;
  dev_type_continuity: number;
  in_active_sprint: number;
  age: number;
  total: number;
}

interface ScoredHdu {
  hdu: Hdu;
  breakdown: ScoreBreakdown;
}

const PRIORITY_SCORE: Record<HduPriority, number> = {
  'crítica': 100,
  'alta': 50,
  'media': 20,
  'baja': 5,
};

function recentAppsForUser(transitions: ReturnType<typeof readTransitions>, user: string, hdus: Hdu[]): Set<string> {
  // Las HDUs que el user trabajó recientemente (heurística: cualquier transición
  // donde aparece como `by` en los últimos 60 días).
  const cutoff = Date.now() - 60 * 86_400_000;
  const recentHduIds = new Set<string>();
  for (const t of transitions) {
    if (t.by !== user) continue;
    if (new Date(t.ts).getTime() < cutoff) continue;
    recentHduIds.add(t.hdu);
  }
  const apps = new Set<string>();
  for (const h of hdus) {
    if (!recentHduIds.has(h.frontmatter.id)) continue;
    for (const a of h.frontmatter.apps_affected) apps.add(a);
  }
  return apps;
}

function lastClosedDevTypeForUser(transitions: ReturnType<typeof readTransitions>, user: string, hdus: Hdu[]): string | null {
  // Última HDU cerrada por el dev → su dev_type.
  const sorted = [...transitions].sort((a, b) => b.ts.localeCompare(a.ts));
  for (const t of sorted) {
    if (t.to !== 'done' || t.by !== user) continue;
    const h = hdus.find(x => x.frontmatter.id === t.hdu);
    if (h?.frontmatter.dev_type) return h.frontmatter.dev_type;
  }
  return null;
}

function scoreHdu(
  hdu: Hdu,
  ctx: {
    user: string;
    userApps: Set<string>;
    lastDevType: string | null;
    activeSprint: string | null;
  }
): ScoreBreakdown {
  const fm = hdu.frontmatter;

  // 1. Prioridad
  const priority = PRIORITY_SCORE[fm.priority];

  // 2. App match (15 puntos si alguna apps_affected coincide con userApps)
  const app_match = fm.apps_affected.some(a => ctx.userApps.has(a)) ? 15 : 0;

  // 3. Continuidad dev_type (10 puntos si misma que la última cerrada)
  const dev_type_continuity = (fm.dev_type && fm.dev_type === ctx.lastDevType) ? 10 : 0;

  // 4. Sprint activo (8 puntos si en el sprint actual)
  const in_active_sprint = (fm.sprint && ctx.activeSprint && fm.sprint === ctx.activeSprint) ? 8 : 0;

  // 5. Antigüedad — 1 punto cada 5 días desde creación, máximo 20
  const ageDays = (Date.now() - new Date(fm.created_at).getTime()) / 86_400_000;
  const age = Math.min(20, Math.floor(ageDays / 5));

  return {
    priority, app_match, dev_type_continuity, in_active_sprint, age,
    total: priority + app_match + dev_type_continuity + in_active_sprint + age,
  };
}

export async function runHduNext(opts: HduNextOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);

  if (!opts.client) {
    const e = { code: 'INVALID_INPUT' as const, message: 'Falta --client=<slug>.' };
    if (jsonMode) emitJson(jsonError({ command: 'hdu next', ...e }));
    printErr(e.message);
    return 3;
  }
  if (!opts.user) {
    const e = { code: 'INVALID_INPUT' as const, message: 'Falta --user=<email>. El scoring necesita saber qué dev está consultando.' };
    if (jsonMode) emitJson(jsonError({ command: 'hdu next', ...e }));
    printErr(e.message);
    return 3;
  }

  const entry = getClient(opts.client);
  if (!entry) {
    const e = {
      code: 'CLIENT_NOT_REGISTERED' as const,
      message: `Cliente "${opts.client}" no registrado.`,
    };
    if (jsonMode) emitJson(jsonError({ command: 'hdu next', ...e }));
    printErr(e.message);
    return 2;
  }
  const cacheDir = getClientCacheDir(opts.client);
  if (!existsSync(cacheDir)) {
    const e = {
      code: 'CONTEXT_CACHE_MISSING' as const,
      message: `Cache local no encontrada para ${opts.client}.`,
    };
    if (jsonMode) emitJson(jsonError({ command: 'hdu next', ...e }));
    printErr(e.message);
    return 2;
  }

  const allHdus = listHdus(cacheDir);
  const transitions = readTransitions(cacheDir);

  // Candidatas: status approved + sin asignar O asignada a user
  const candidates = allHdus.filter(h => {
    if (h.frontmatter.status !== 'approved') return false;
    if (!h.frontmatter.assigned_to) return true;
    return h.frontmatter.assigned_to === opts.user;
  });

  if (candidates.length === 0) {
    if (jsonMode) {
      emitJson(jsonSuccess('hdu next', {
        client: opts.client,
        user: opts.user,
        candidates: 0,
        recommendation: null,
      }));
    }
    printDim('  No hay HDUs aprobadas disponibles para vos.');
    printInfo('Para ver el backlog: dd-cli hdu list --client=' + opts.client + ' --status=approved');
    return 0;
  }

  const userApps = recentAppsForUser(transitions, opts.user, allHdus);
  const lastDevType = lastClosedDevTypeForUser(transitions, opts.user, allHdus);
  // Sprint activo: por ahora null (la lógica de sprints es S7-5, diferida).
  const activeSprint: string | null = null;

  const ctx = { user: opts.user, userApps, lastDevType, activeSprint };
  const scored: ScoredHdu[] = candidates
    .map(hdu => ({ hdu, breakdown: scoreHdu(hdu, ctx) }))
    .sort((a, b) => b.breakdown.total - a.breakdown.total);

  const top = scored[0]!;

  if (jsonMode) {
    emitJson(jsonSuccess('hdu next', {
      client: opts.client,
      user: opts.user,
      candidates: scored.length,
      recommendation: {
        id: top.hdu.frontmatter.id,
        title: top.hdu.frontmatter.title,
        priority: top.hdu.frontmatter.priority,
        dev_type: top.hdu.frontmatter.dev_type,
        apps_affected: top.hdu.frontmatter.apps_affected,
        breakdown: top.breakdown,
      },
      all_candidates: scored.map(s => ({
        id: s.hdu.frontmatter.id,
        title: s.hdu.frontmatter.title,
        score: s.breakdown.total,
        breakdown: opts.explain ? s.breakdown : undefined,
      })),
    }, `dd-cli hdu claim ${top.hdu.frontmatter.id} --client=${opts.client} --user=${opts.user}`));
  }

  const fm = top.hdu.frontmatter;
  console.log('');
  console.log(`Te sugiero: ${bold(fm.id)} · ${fm.title}`);
  printDim(`  prioridad: ${fm.priority}    dev_type: ${fm.dev_type ?? '(sin)'}`);
  if (fm.apps_affected.length > 0) printDim(`  apps: ${fm.apps_affected.join(', ')}`);
  console.log('');

  if (opts.explain) {
    console.log(bold('  Score breakdown:'));
    printDim(`    prioridad:              ${top.breakdown.priority}`);
    printDim(`    app match:              ${top.breakdown.app_match}`);
    printDim(`    continuidad dev_type:   ${top.breakdown.dev_type_continuity}`);
    printDim(`    sprint activo:          ${top.breakdown.in_active_sprint}`);
    printDim(`    antigüedad:             ${top.breakdown.age}`);
    printDim(`    total:                  ${top.breakdown.total}`);
    console.log('');
    if (scored.length > 1) {
      console.log(bold(`  Otras ${scored.length - 1} candidatas:`));
      for (const s of scored.slice(1, 4)) {
        printDim(`    ${s.hdu.frontmatter.id} (${s.breakdown.total}): ${s.hdu.frontmatter.title}`);
      }
      console.log('');
    }
  }

  printInfo('Para arrancar:');
  printDim(`  dd-cli hdu claim ${fm.id} --client=${opts.client} --user=${opts.user}`);
  printDim(`  dd-cli start-session ${fm.id}`);
  return 0;
}
