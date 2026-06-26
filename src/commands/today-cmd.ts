/**
 * `dd-cli today [--user=<email>]` (S6-3) — ritual matutino del dev.
 *
 * Vista del día (sección 4.2 del rediseño, P-2):
 *   - Sesión activa o pendiente (de qué HDU, qué paso, cuánto tiempo).
 *   - Queue: HDUs aprobadas asignadas al dev en todos los clientes.
 *   - Alertas: cliente con cache stale, HDUs estancadas en mis asignaciones.
 *
 * Bajo D-8 esta es la cara directa; la skill /devflow-ia:daily-standup
 * lo invoca conversacionalmente. Cero argumento required — usa
 * --user si lo pasás, sino sugiere a quién filtrar.
 */
import { existsSync } from 'node:fs';
import { loadRegistry, getClientCacheDir } from '../types/registry.js';
import { listHdus } from '../types/hdu.js';
import { readClientState } from '../utils/client-state.js';
import { loadSession } from '../utils/session-io.js';
import { findDevFlowProjectRoot } from '../utils/paths.js';
import { isJsonMode, emitJson, jsonSuccess, type JsonModeOpts } from '../utils/json-output.js';
import { printOk, printInfo, printDim, bold, ok, warn, dim, devTypeBadge } from '../utils/output.js';

export interface TodayOpts extends JsonModeOpts {
  user?: string;             // email del dev (filtra mine)
}

interface TodayHduEntry {
  id: string;
  client: string;
  title: string;
  priority: string;
  dev_type: string | null;
  apps_affected: string[];
}

interface TodayAlert {
  level: 'info' | 'warn' | 'err';
  message: string;
  action?: string;
}

interface TodayOutput {
  date: string;
  user: string | null;
  active_session: { feature_id: string; dev_type: string; duration_minutes: number; cwd: string } | null;
  queue: TodayHduEntry[];
  alerts: TodayAlert[];
}

function ageInHours(iso: string | null | undefined): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

export async function runToday(opts: TodayOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);
  const user = opts.user ?? null;
  const registry = loadRegistry();

  // ── 1. Sesión activa en el CWD ─────────────────────────────────────
  let activeSession: TodayOutput['active_session'] = null;
  const projectRoot = findDevFlowProjectRoot();
  if (projectRoot) {
    try {
      const session = loadSession(projectRoot);
      if (session?.started_at && !session.ended_at) {
        const startedMs = new Date(session.started_at).getTime();
        const durationMin = Math.floor((Date.now() - startedMs) / 60_000);
        activeSession = {
          feature_id: session.feature_id ?? 'unknown',
          dev_type: session.dev_type ?? 'unknown',
          duration_minutes: durationMin,
          cwd: projectRoot,
        };
      }
    } catch { /* */ }
  }

  // ── 2. Queue: HDUs aprobadas asignadas al user across clients ──────
  const queue: TodayHduEntry[] = [];
  for (const entry of Object.values(registry.clients)) {
    const cacheDir = getClientCacheDir(entry.slug);
    if (!existsSync(cacheDir)) continue;
    let hdus;
    try { hdus = listHdus(cacheDir); } catch { continue; }
    for (const h of hdus) {
      const fm = h.frontmatter;
      if (fm.status !== 'approved') continue;
      if (user && fm.assigned_to !== user) continue;
      if (!user && fm.assigned_to) continue; // sin user, mostramos solo las sin asignar
      queue.push({
        id: fm.id,
        client: entry.slug,
        title: fm.title,
        priority: fm.priority,
        dev_type: fm.dev_type ?? null,
        apps_affected: fm.apps_affected,
      });
    }
  }

  // Ordenar por prioridad
  const priorityOrder: Record<string, number> = { 'crítica': 4, 'alta': 3, 'media': 2, 'baja': 1 };
  queue.sort((a, b) => (priorityOrder[b.priority] ?? 0) - (priorityOrder[a.priority] ?? 0));

  // ── 3. Alertas ─────────────────────────────────────────────────────
  const alerts: TodayAlert[] = [];
  for (const entry of Object.values(registry.clients)) {
    const lastSync = entry.last_synced;
    if (ageInHours(lastSync) > 7 * 24) {
      alerts.push({
        level: 'warn',
        message: `Contexto de ${entry.slug} stale (${Math.floor(ageInHours(lastSync) / 24)}d sin sync)`,
        action: `dd-cli pull-context ${entry.slug}`,
      });
    }
    // HDUs in-progress del user sin transición > 3d (heurística simple)
    if (user) {
      const cacheDir = getClientCacheDir(entry.slug);
      if (!existsSync(cacheDir)) continue;
      let hdus;
      try { hdus = listHdus(cacheDir); } catch { continue; }
      for (const h of hdus) {
        if (h.frontmatter.status !== 'in-progress') continue;
        if (h.frontmatter.assigned_to !== user) continue;
        // Sin transitions log filtering por simplicidad. Solo flag.
        alerts.push({
          level: 'info',
          message: `${h.frontmatter.id} (${entry.slug}) en in-progress`,
          action: `dd-cli hdu show ${h.frontmatter.id} --client=${entry.slug}`,
        });
      }
    }
  }

  const output: TodayOutput = {
    date: new Date().toISOString().split('T')[0] ?? '',
    user,
    active_session: activeSession,
    queue,
    alerts,
  };

  if (jsonMode) {
    emitJson(jsonSuccess('today', output));
  }

  // ── Render humano ──────────────────────────────────────────────────
  console.log('');
  console.log(`  ${bold('Today')}    ${dim(new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }))}`);
  if (user) printDim(`  ${user}`);
  console.log('');

  // Sesión activa
  if (activeSession) {
    console.log(bold('  SESIÓN ACTIVA'));
    const hrs = Math.floor(activeSession.duration_minutes / 60);
    const mins = activeSession.duration_minutes % 60;
    const durStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    console.log(`    ${devTypeBadge(activeSession.dev_type)} ${bold(activeSession.feature_id)}  ${dim('· ' + durStr)}`);
    printDim(`    cwd: ${activeSession.cwd}`);
    console.log('');
  } else if (projectRoot) {
    printDim('  Sin sesión activa en este repo (dd-cli start-session <HDU-id>)');
    console.log('');
  }

  // Queue
  if (queue.length > 0) {
    console.log(bold(`  TU QUEUE (${queue.length} HDUs aprobadas)`));
    for (const h of queue.slice(0, 10)) {
      const prio = h.priority.padEnd(8);
      console.log(`    ${bold(h.id.padEnd(10))} ${prio} ${dim(h.client.padEnd(15))} ${h.title}`);
    }
    if (queue.length > 10) printDim(`    ... y ${queue.length - 10} más`);
    console.log('');
  } else if (user) {
    printDim('  Sin HDUs aprobadas asignadas a vos.');
    printInfo('  Para ver el backlog: dd-cli hdu list --client=<slug> --status=approved');
    console.log('');
  }

  // Alertas
  if (alerts.length > 0) {
    console.log(bold('  ALERTAS'));
    for (const a of alerts) {
      const icon = a.level === 'warn' ? warn('⚠') : a.level === 'err' ? warn('✗') : ok('·');
      console.log(`    ${icon} ${a.message}`);
      if (a.action) printDim(`       → ${a.action}`);
    }
    console.log('');
  }

  return 0;
}
