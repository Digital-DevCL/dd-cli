/**
 * `dd-cli end-session` — cierra la sesión activa.
 *
 * En MVP solo actualiza estado local (ended_at, flow_state=ended).
 * El commit + push lo hace la skill /end-session de Claude Code.
 *
 * Flags futuros (post-MVP):
 *   --no-commit (default true en MVP — siempre skip git)
 *   --message <msg>
 */
import { getProjectRoot } from '../utils/paths.js';
import { loadSession, saveSession, SessionIOError } from '../utils/session-io.js';
import { closeGlobalSession } from '../utils/global-sessions.js';
import { printOk, printWarn, printErr, printDim, bold } from '../utils/output.js';

export interface EndSessionOptions {
  noCommit?: boolean;
  message?: string;
}

function formatDuration(startedAt: string, endedAt: string): string {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '?';
  const ms = end - start;
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export async function runEndSession(opts: EndSessionOptions = {}): Promise<number> {
  const projectRoot = getProjectRoot();

  let session;
  try {
    session = loadSession(projectRoot);
  } catch (e) {
    if (e instanceof SessionIOError) {
      printErr(e.message);
      return 2;
    }
    throw e;
  }

  if (!session) {
    printWarn('No hay sesión activa para cerrar.');
    return 1;
  }

  if (!session.started_at) {
    printWarn('La sesión existe pero nunca fue iniciada (started_at vacío).');
    return 1;
  }

  if (session.ended_at) {
    printWarn(`La sesión ya estaba cerrada (ended_at: ${session.ended_at})`);
    return 1;
  }

  const now = new Date().toISOString();
  const updated = {
    ...session,
    ended_at: now,
    flow_state: 'ended' as const,
    unclosed: false,
    last_heartbeat: now,
  };

  saveSession(projectRoot, updated);
  closeGlobalSession(projectRoot);

  console.log(bold(`\nSesión cerrada\n`));
  printOk(`Feature: ${updated.feature_id ?? '?'} · ${updated.feature_name ?? ''}`);
  printOk(`Duración: ${formatDuration(updated.started_at!, now)}`);
  const total = updated.tasks.length;
  const done = updated.tasks.filter((t) => t.status === 'done').length;
  if (total > 0) {
    printOk(`Tasks: ${done}/${total} completadas`);
  }
  if (updated.blockers.length > 0) {
    printWarn(`${updated.blockers.length} blocker(s) activos sin resolver`);
  }

  // En MVP nunca hace commit
  if (opts.noCommit === false || opts.message) {
    printDim(`\n(commit/push delegado a la skill /end-session de Claude Code)`);
  }

  return 0;
}
