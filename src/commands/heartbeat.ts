/**
 * `dd-cli heartbeat [--silent] [--on-stop]`
 *
 * Llamado automáticamente por los hooks de Claude Code en cada tool use.
 * Nunca debe fallar — cualquier error se loguea y el proceso sale 0.
 *
 * Hace:
 *   1. Recalcula flow_state vía detectFlowState()
 *   2. Si cambió → persiste + escribe transición a .devflow/transitions.log
 *   3. Detecta anomalías y las agrega a session.anomalies[]
 *   4. Actualiza last_heartbeat
 *   5. --on-stop: marca unclosed=true si flow_state no es "ended"
 */
import { existsSync, appendFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { getProjectRoot, getDevflowDir } from '../utils/paths.js';
import { loadSession, saveSession } from '../utils/session-io.js';
import { detectFlowState } from '../flow-state/detect.js';
import type { FlowState, SessionState, Anomaly } from '../types/session.js';

export interface HeartbeatOptions {
  silent?: boolean;
  onStop?: boolean;
}

function log(msg: string, silent: boolean): void {
  if (!silent) console.log(msg);
}

function safeLog(projectRoot: string, line: string): void {
  try {
    const dir = getDevflowDir(projectRoot);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, 'heartbeat.log'), line + '\n', 'utf-8');
  } catch { /* silencioso */ }
}

function safeLogTransition(projectRoot: string, from: FlowState, to: FlowState): void {
  try {
    const dir = getDevflowDir(projectRoot);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const line = `${new Date().toISOString()}  flow_state: ${from} → ${to}`;
    appendFileSync(path.join(dir, 'transitions.log'), line + '\n', 'utf-8');
  } catch { /* silencioso */ }
}

function detectAnomalies(session: SessionState): Anomaly[] {
  const now = Date.now();
  const anomalies: Anomaly[] = [];

  if (!session.started_at) return anomalies;

  // Sesión sin actividad >2h
  if (session.last_heartbeat) {
    const lastMs = now - new Date(session.last_heartbeat).getTime();
    if (lastMs > 2 * 3_600_000 && session.flow_state !== 'ended') {
      anomalies.push({
        type: 'stale_session',
        detected_at: new Date().toISOString(),
        acknowledged: false,
        details: `Sin heartbeat hace ${Math.floor(lastMs / 60_000)} min`,
      });
    }
  }

  // Sesión abierta >8h sin cerrar
  const openMs = now - new Date(session.started_at).getTime();
  if (openMs > 8 * 3_600_000 && !session.ended_at) {
    anomalies.push({
      type: 'long_open_session',
      detected_at: new Date().toISOString(),
      acknowledged: false,
      details: `Sesión lleva ${Math.floor(openMs / 3_600_000)}h abierta`,
    });
  }

  // flow_state=started por >30min sin SPEC
  if (session.flow_state === 'started') {
    if (openMs > 30 * 60_000) {
      anomalies.push({
        type: 'stuck_in_started',
        detected_at: new Date().toISOString(),
        acknowledged: false,
        details: 'Más de 30 min en estado "started" sin generar SPEC',
      });
    }
  }

  return anomalies;
}

export async function runHeartbeat(opts: HeartbeatOptions = {}): Promise<void> {
  const { silent = false, onStop = false } = opts;

  let projectRoot: string;
  try {
    projectRoot = getProjectRoot();
  } catch {
    return; // fuera de un proyecto con .devflow — salir silenciosamente
  }

  let session;
  try {
    session = loadSession(projectRoot);
  } catch (e) {
    safeLog(projectRoot, `[heartbeat] ERROR loading session: ${String(e)}`);
    return;
  }

  if (!session || !session.started_at) {
    return; // sin sesión activa, nada que hacer
  }

  if (session.ended_at) {
    return; // sesión ya cerrada
  }

  try {
    const previousFlowState = session.flow_state;
    const newFlowState = detectFlowState({ projectRoot, session });
    const now = new Date().toISOString();

    let changed = false;
    const updated = { ...session, last_heartbeat: now };

    // Transición de flow_state
    if (newFlowState !== previousFlowState) {
      updated.flow_state = newFlowState;
      safeLogTransition(projectRoot, previousFlowState, newFlowState);
      log(`[DevFlow IA] Progresaste: ${previousFlowState} → ${newFlowState}`, silent);
      changed = true;
    }

    // Anomalías nuevas
    const newAnomalies = detectAnomalies(updated);
    if (newAnomalies.length > 0) {
      const existingTypes = new Set(session.anomalies.map((a) => a.type));
      const toAdd = newAnomalies.filter((a) => !existingTypes.has(a.type));
      if (toAdd.length > 0) {
        updated.anomalies = [...session.anomalies, ...toAdd];
        changed = true;
      }
    }

    // --on-stop: marcar sesión sin cerrar
    if (onStop && session.flow_state !== 'ended') {
      updated.unclosed = true;
      changed = true;
      safeLog(projectRoot, `[heartbeat] Stop detectado sin /end-session (flow_state=${session.flow_state})`);
    }

    if (changed) {
      saveSession(projectRoot, updated);
    } else {
      // Solo actualizar last_heartbeat (escritura mínima)
      saveSession(projectRoot, updated);
    }
  } catch (e) {
    safeLog(projectRoot, `[heartbeat] ERROR: ${String(e)}`);
    // Nunca propagar — el hook debe ser silencioso
  }
}
