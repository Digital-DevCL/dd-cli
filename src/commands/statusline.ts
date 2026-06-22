/**
 * `dd-cli statusline` — output de 1 línea para Claude Code.
 *
 * Se invoca por Claude Code via `.claude/settings.json` (statusLine config).
 * Debe correr en <200ms y devolver una sola línea en stdout.
 *
 * Formato:
 *   HDU-128 · paso 2/8: /init-repo-context → /new-spec · 5m  ⬢ brownfield-feature
 *
 * Estados especiales:
 *   - Sin sesión: "DevFlow IA · sin sesión · ejecuta: dd-cli start-session <HDU-id>"
 *   - Sesión recién creada (sin started_at): igual
 *   - Sesión ended: "✓ HDU-128 cerrada · 3h 42m  ⬢ brownfield-feature"
 *   - Anomalía: "⚠ HDU-128 · paso 2/8 · falta REPO-CONTEXT.md · → /init-repo-context"
 */
import { getProjectRoot } from '../utils/paths.js';
import { loadSession } from '../utils/session-io.js';
import { detectFlowState } from '../flow-state/detect.js';
import { getStageContext } from '../flow-state/flow-stages.js';
import { evaluateRules, partition } from '../enforcement/evaluator.js';
import { devTypeBadge } from '../utils/output.js';

function formatDuration(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  if (Number.isNaN(start) || now < start) return '?';
  const ms = now - start;
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function runStatusline(): string {
  let projectRoot: string;
  try {
    projectRoot = getProjectRoot();
  } catch {
    return 'DevFlow IA';
  }

  let session;
  try {
    session = loadSession(projectRoot);
  } catch {
    return 'DevFlow IA · session.json inválido · revisa .devflow/';
  }

  // Sin sesión
  if (!session || !session.started_at) {
    return 'DevFlow IA · sin sesión · ejecuta: dd-cli start-session <HDU-id>';
  }

  // Sesión cerrada
  if (session.ended_at) {
    const feature = session.feature_id ?? '?';
    const duration =
      session.started_at && session.ended_at
        ? formatDurationBetween(session.started_at, session.ended_at)
        : '?';
    const badge = devTypeBadge(session.dev_type);
    return `✓ ${feature} cerrada · ${duration}  ${badge}`;
  }

  // Sesión activa: recalcular flow_state, ver stages, evaluar anomalías
  const flowState = detectFlowState({ projectRoot, session });
  const ctx = session.dev_type ? getStageContext(session, flowState) : null;
  const duration = formatDuration(session.started_at);
  const feature = session.feature_id ?? '?';
  const badge = devTypeBadge(session.dev_type);

  // Anomalías bloqueantes presentes → mostrarlas
  const results = evaluateRules({ projectRoot, session });
  const { blockers } = partition(results);

  if (blockers.length > 0 && ctx?.currentStage) {
    const blocker = blockers[0]!;
    const hint = extractBlockerHint(blocker.message);
    return `⚠ ${feature} · paso ${ctx.currentIndex}/${ctx.total} · ${hint} · ${duration}  ${badge}`;
  }

  // Caso normal con dev_type + stage info
  if (ctx?.currentStage) {
    const current = ctx.currentStage.id;
    const next = ctx.nextStage?.id ?? 'fin';
    return `${feature} · paso ${ctx.currentIndex}/${ctx.total}: ${current} → ${next} · ${duration}  ${badge}`;
  }

  // Sesión sin dev_type todavía (raro)
  return `${feature} · iniciada hace ${duration} · sin tipo definido  ⬢ ?`;
}

function formatDurationBetween(startedAt: string, endedAt: string): string {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '?';
  const ms = end - start;
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

/**
 * Extrae un "hint" corto del mensaje completo de la regla.
 * Ej: "Esta HDU es brownfield-feature y requiere mapeo del repo existente..."
 *     → "falta REPO-CONTEXT.md"
 */
function extractBlockerHint(message: string): string {
  if (message.includes('REPO-CONTEXT')) return 'falta REPO-CONTEXT.md';
  if (message.includes('BASELINE')) return 'falta BASELINE.md';
  if (message.includes('legacy_system')) return 'falta legacy_system';
  if (message.includes('vendor')) return 'falta vendor';
  if (message.includes('greenfield')) return 'tipo no compatible con /new-app';
  return 'precondición pendiente';
}
