/**
 * `dd-cli statusline` — output de 1 línea para Claude Code.
 *
 * Se invoca por Claude Code via `.claude/settings.json` (statusLine config).
 * Debe correr en <200ms y devolver una sola línea en stdout.
 *
 * Después del S10: lee desde getFlowState() en lugar de computar individualmente.
 *
 * Formato sesión activa:
 *   HDU-128 · paso 2/8: /init-repo-context → /new-spec · 5m  ⬢ brownfield-feature
 * Caso C (fuera de proyecto):
 *   DevFlow IA · iprsa · 3 HDUs · 1 activa
 * Caso D (context repo):
 *   DevFlow IA · context: iprsa · 3 HDUs · 1 activa
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { findDevFlowProjectRoot } from '../utils/paths.js';
import { loadSession } from '../utils/session-io.js';
import { devTypeBadge } from '../utils/output.js';
import { CLI_VERSION } from '../index.js';
import { getFlowState } from '../flow-state/engine.js';
import { loadRegistry, getClientCacheDir } from '../types/registry.js';

// ── Helpers de formato ────────────────────────────────────────────────

function fmtDuration(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return '?';
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtDurationBetween(a: string, b: string): string {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (Number.isNaN(ms) || ms < 0) return '?';
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function blockerHint(message: string): string {
  if (message.includes('REPO-CONTEXT')) return 'falta REPO-CONTEXT.md';
  if (message.includes('BASELINE')) return 'falta BASELINE.md';
  if (message.includes('legacy_system')) return 'falta legacy_system';
  if (message.includes('vendor')) return 'falta vendor';
  return 'precondición pendiente';
}

function isContextRepo(cwd: string): string | null {
  if (!existsSync(path.join(cwd, '.devflow-context', '.context-repo.yml'))) return null;
  try {
    const registry = loadRegistry();
    for (const [slug] of Object.entries(registry.clients)) {
      if (getClientCacheDir(slug) === cwd) return slug;
    }
    return path.basename(cwd).replace(/-devflow-context$/, '') || null;
  } catch { return null; }
}

// ── Función principal ─────────────────────────────────────────────────

export function runStatusline(): string {
  // Caso D — context repo del cliente (TL/PMO)
  const contextSlug = isContextRepo(process.cwd());
  if (contextSlug) {
    try {
      const state = getFlowState();
      const client = state.clients.find(c => c.slug === contextSlug);
      const counts = client?.hdu_counts;
      const parts = [`DevFlow IA · context: ${contextSlug}`];
      if (counts) {
        parts.push(`${counts.total} HDUs`);
        if (counts.in_progress > 0) parts.push(`${counts.in_progress} activa${counts.in_progress > 1 ? 's' : ''}`);
        else if (counts.approved > 0) parts.push(`${counts.approved} lista${counts.approved > 1 ? 's' : ''}`);
      }
      return parts.join(' · ');
    } catch { return `DevFlow IA · context: ${contextSlug}`; }
  }

  // Caso B/A — dentro de un repo DevFlow con o sin sesión
  const projectRoot = findDevFlowProjectRoot();
  if (!projectRoot) {
    // Caso C — fuera de proyecto: resumen cross-cliente desde el motor
    try {
      const state = getFlowState();
      if (state.clients.length === 0) {
        return `DevFlow IA · v${CLI_VERSION} · sin cliente · dd-cli register-client`;
      }
      if (state.clients.length === 1) {
        const c = state.clients[0]!;
        const parts = [`DevFlow IA · ${c.slug}`];
        const counts = c.hdu_counts;
        if (counts.total > 0) {
          parts.push(`${counts.total} HDUs`);
          if (counts.in_progress > 0) parts.push(`${counts.in_progress} activa${counts.in_progress > 1 ? 's' : ''}`);
          else if (counts.approved > 0) parts.push(`${counts.approved} lista${counts.approved > 1 ? 's' : ''}`);
          else parts.push('dd-cli hdu list');
        } else {
          parts.push('✓ · dd-cli hdu list');
        }
        return parts.join(' · ');
      }
      const activos = state.clients.filter(c => c.hdu_counts.in_progress > 0).length;
      return `DevFlow IA · ${state.clients.length} clientes${activos > 0 ? ` · ${activos} activo${activos > 1 ? 's' : ''}` : ''}`;
    } catch { return `DevFlow IA · v${CLI_VERSION} ready`; }
  }

  let session;
  try { session = loadSession(projectRoot); }
  catch { return 'DevFlow IA · session.json inválido · revisa .devflow/'; }

  if (!session?.started_at) {
    return 'DevFlow IA · sin sesión · ejecuta: dd-cli start-session <HDU-id>';
  }

  if (session.ended_at) {
    const badge = devTypeBadge(session.dev_type);
    const dur = fmtDurationBetween(session.started_at, session.ended_at);
    return `✓ ${session.feature_id ?? '?'} cerrada · ${dur}  ${badge}`;
  }

  // Sesión activa — usar el motor para obtener journey + blockers
  try {
    const state = getFlowState({ projectRoot });
    const s = state.session;
    if (!s) return `${session.feature_id ?? '?'} · iniciando...`;

    const feature = s.hdu_id ?? '?';
    const badge = devTypeBadge(s.dev_type);
    const dur = fmtDuration(s.started_at ?? '');

    // Bloqueante → mostrar hint
    if (s.blockers.length > 0 && s.journey) {
      const hint = blockerHint(s.blockers[0]!);
      return `⚠ ${feature} · paso ${s.journey.current_step}/${s.journey.total_steps} · ${hint} · ${dur}  ${badge}`;
    }

    // Normal con journey
    if (s.journey?.current_skill) {
      const next = s.journey.next_skill ?? 'fin';
      return `${feature} · paso ${s.journey.current_step}/${s.journey.total_steps}: ${s.journey.current_skill} → ${next} · ${dur}  ${badge}`;
    }

    return `${feature} · iniciada hace ${dur} · sin tipo definido  ⬢ ?`;
  } catch {
    // Fallback si el motor falla
    return `${session.feature_id ?? '?'} · ${fmtDuration(session.started_at)} ⬢ ?`;
  }
}
