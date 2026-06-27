/**
 * `dd-cli today [--user=<email>]` (S6-3) — ritual matutino del dev.
 *
 * Post-S10: delega toda la recolección a getFlowState() del motor.
 * Este archivo solo renderiza el output humano y emite el JSON.
 */
import { getFlowState } from '../flow-state/engine.js';
import { isJsonMode, emitJson, jsonSuccess, type JsonModeOpts } from '../utils/json-output.js';
import { printInfo, printDim, bold, ok, warn, dim, devTypeBadge } from '../utils/output.js';

export interface TodayOpts extends JsonModeOpts {
  user?: string;
}

export async function runToday(opts: TodayOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);
  const user = opts.user ?? null;

  const state = getFlowState({ user: user ?? undefined });

  // ── JSON mode ─────────────────────────────────────────────────────
  if (jsonMode) {
    emitJson(jsonSuccess('today', {
      date: new Date().toISOString().split('T')[0] ?? '',
      user,
      active_session: state.session
        ? {
            feature_id: state.session.hdu_id ?? 'unknown',
            dev_type: state.session.dev_type ?? 'unknown',
            duration_minutes: state.session.duration_minutes,
            cwd: state.session.project_root,
          }
        : null,
      queue: state.queue.approved,
      alerts: state.alerts.map(a => ({ level: a.level, message: a.message, action: a.action })),
    }));
    return 0;
  }

  // ── Render humano ─────────────────────────────────────────────────
  console.log('');
  console.log(`  ${bold('Today')}    ${dim(new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }))}`);
  if (user) printDim(`  ${user}`);
  console.log('');

  // Sesión activa
  if (state.session?.active) {
    const s = state.session;
    const hrs = Math.floor(s.duration_minutes / 60);
    const mins = s.duration_minutes % 60;
    const durStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    console.log(bold('  SESIÓN ACTIVA'));
    console.log(`    ${devTypeBadge(s.dev_type)} ${bold(s.hdu_id ?? '?')}  ${dim('· ' + durStr)}`);
    if (s.journey) {
      printDim(`    paso ${s.journey.current_step}/${s.journey.total_steps}: ${s.journey.current_skill ?? '?'} → ${s.journey.next_skill ?? 'fin'}`);
    }
    printDim(`    cwd: ${s.project_root}`);
    console.log('');
  } else {
    printDim('  Sin sesión activa. Ejecutá: /devflow-ia:pick-next o dd-cli start-session <HDU-id>');
    console.log('');
  }

  // Queue
  const approved = state.queue.approved;
  const inProgress = state.queue.in_progress;
  const allQueue = [...inProgress, ...approved];

  if (allQueue.length > 0) {
    console.log(bold(`  TU QUEUE (${allQueue.length} HDU${allQueue.length > 1 ? 's' : ''})`));
    for (const h of allQueue.slice(0, 10)) {
      const prio = h.priority.padEnd(8);
      const statusTag = inProgress.some(i => i.id === h.id) ? dim('[activa] ') : '';
      console.log(`    ${bold(h.id.padEnd(10))} ${prio} ${dim(h.client.padEnd(15))} ${statusTag}${h.title}`);
    }
    if (allQueue.length > 10) printDim(`    ... y ${allQueue.length - 10} más`);
    if (state.queue.next_suggested) {
      printDim(`    → Sugerida: ${state.queue.next_suggested}  (dd-cli hdu next --explain)`);
    }
    console.log('');
  } else if (user) {
    printDim('  Sin HDUs asignadas. Pedile al TL que te asigne o: dd-cli hdu list --status=approved');
    console.log('');
  }

  // Alertas del motor
  if (state.alerts.length > 0) {
    console.log(bold('  ALERTAS'));
    for (const a of state.alerts) {
      const icon = a.level === 'warn' ? warn('⚠') : a.level === 'err' ? warn('✗') : ok('·');
      console.log(`    ${icon} ${a.message}`);
      if (a.action) printDim(`       → ${a.action}`);
    }
    console.log('');
  }

  // Hint del motor
  if (state.hints.length > 0) {
    printInfo(`  ${state.hints[0]!.text}`);
    console.log('');
  }

  return 0;
}
