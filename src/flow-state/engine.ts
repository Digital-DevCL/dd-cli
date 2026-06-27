/**
 * Motor de estado unificado de DevFlow IA — v1.
 *
 * getFlowState() es la fuente única para toda superficie:
 *   - statusline         → lee actor + session.journey + alerts
 *   - dd-cli today       → lee queue + alerts + session
 *   - dd-cli status      → lee session + hints
 *   - dd-cli serve       → serializa el objeto completo como JSON para la app web
 *
 * Contrato: el schema está versionado. La app web depende de `schema_version: 'v1'`.
 * Cambios breaking incrementan la versión.
 *
 * Regla de diseño: este archivo solo COMPONE. La lógica real vive en:
 *   - detectFlowState()    (flow-state/detect.ts)
 *   - getStageContext()    (flow-state/flow-stages.ts)
 *   - evaluateRules()      (enforcement/evaluator.ts)
 *   - listHdus()           (types/hdu.ts)
 *   - loadSession()        (utils/session-io.ts)
 *   - getUnclosedSessions  (utils/global-sessions.ts)
 */
import { existsSync } from 'node:fs';
import { loadRegistry, getClientCacheDir } from '../types/registry.js';
import { loadSession } from '../utils/session-io.js';
import { findDevFlowProjectRoot } from '../utils/paths.js';
import { readClientState } from '../utils/client-state.js';
import { detectFlowState } from './detect.js';
import { getStageContext } from './flow-stages.js';
import { evaluateRules, partition } from '../enforcement/evaluator.js';
import { listHdus } from '../types/hdu.js';
import { getUnclosedSessionsElsewhere } from '../utils/global-sessions.js';

// ── Tipos del contrato público ────────────────────────────────────────

export interface EngineAlert {
  kind: string;
  level: 'info' | 'warn' | 'err';
  message: string;
  action?: string;
  client?: string;
  hdu?: string;
}

export interface EngineHint {
  for: string;
  text: string;
}

export interface EngineQueueItem {
  id: string;
  client: string;
  title: string;
  priority: string;
  dev_type: string | null;
  apps_affected: string[];
}

export interface EngineClientSummary {
  slug: string;
  name: string;
  state: string;
  hdu_counts: {
    total: number;
    in_progress: number;
    approved: number;
    done: number;
  };
}

export interface EngineSession {
  active: boolean;
  hdu_id: string | null;
  feature_name: string | null;
  dev_type: string | null;
  flow_state: string | null;
  journey: {
    current_step: number;
    total_steps: number;
    current_skill: string | null;
    next_skill: string | null;
  } | null;
  started_at: string | null;
  duration_minutes: number;
  project_root: string;
  blockers: string[];
}

export interface FlowStateOutput {
  schema_version: 'v1';
  generated_at: string;
  actor: {
    user: string | null;
    active_client: string | null;
  };
  session: EngineSession | null;
  clients: EngineClientSummary[];
  queue: {
    in_progress: EngineQueueItem[];
    approved: EngineQueueItem[];
    next_suggested: string | null;
  };
  alerts: EngineAlert[];
  hints: EngineHint[];
}

// ── Opciones ──────────────────────────────────────────────────────────

export interface GetFlowStateOptions {
  user?: string;
  projectRoot?: string;  // si no se pasa, busca desde CWD
}

// ── Función principal ─────────────────────────────────────────────────

export function getFlowState(opts: GetFlowStateOptions = {}): FlowStateOutput {
  const now = new Date().toISOString();
  const projectRoot = opts.projectRoot ?? findDevFlowProjectRoot() ?? '';
  const registry = loadRegistry();
  const alerts: EngineAlert[] = [];
  const hints: EngineHint[] = [];

  // ── Sesión activa ─────────────────────────────────────────────────
  let session: EngineSession | null = null;
  let activeClient: string | null = null;

  if (projectRoot) {
    try {
      const raw = loadSession(projectRoot);
      if (raw?.started_at && !raw.ended_at) {
        const flowState = detectFlowState({ projectRoot, session: raw });
        const stageCtx = raw.dev_type ? getStageContext(raw, flowState) : null;
        const ruleResults = evaluateRules({ projectRoot, session: raw });
        const { blockers } = partition(ruleResults);

        const startedMs = new Date(raw.started_at).getTime();
        const durationMin = Number.isNaN(startedMs)
          ? 0
          : Math.floor((Date.now() - startedMs) / 60_000);

        session = {
          active: true,
          hdu_id: raw.feature_id ?? null,
          feature_name: raw.feature_name ?? null,
          dev_type: raw.dev_type ?? null,
          flow_state: flowState,
          journey: stageCtx
            ? {
                current_step: stageCtx.currentIndex,
                total_steps: stageCtx.total,
                current_skill: stageCtx.currentStage?.id ?? null,
                next_skill: stageCtx.nextStage?.id ?? null,
              }
            : null,
          started_at: raw.started_at,
          duration_minutes: durationMin,
          project_root: projectRoot,
          blockers: blockers.map(b => b.message),
        };

        // Intentar inferir el cliente desde el nombre del feature
        // (heurística: client slug puede estar en feature_id o en la carpeta)
        activeClient = raw.feature_id?.split('-')[0] ?? null;

        if (blockers.length > 0) {
          alerts.push({
            kind: 'session_blocker',
            level: 'warn',
            message: `Precondición pendiente: ${blockers[0]!.message.slice(0, 80)}`,
            client: activeClient ?? undefined,
            hdu: raw.feature_id ?? undefined,
          });
        }
      }
    } catch { /* sesión inaccesible — no es fatal */ }
  }

  // ── Sesiones unclosed cross-cliente ──────────────────────────────
  const unclosed = getUnclosedSessionsElsewhere(projectRoot);
  for (const s of unclosed) {
    const daysAgo = Math.floor((Date.now() - new Date(s.started_at).getTime()) / 86_400_000);
    alerts.push({
      kind: 'unclosed_session',
      level: 'warn',
      message: `Sesión sin cerrar: ${s.feature_id}${s.client ? ' (' + s.client + ')' : ''} — hace ${daysAgo}d`,
      action: `cd ${s.project_root} && dd-cli end-session`,
      client: s.client,
      hdu: s.feature_id,
    });
  }

  // ── Estado de clientes ────────────────────────────────────────────
  const clients: EngineClientSummary[] = [];
  const inProgressItems: EngineQueueItem[] = [];
  const approvedItems: EngineQueueItem[] = [];

  const priorityOrder: Record<string, number> = { 'crítica': 4, 'alta': 3, 'media': 2, 'baja': 1 };

  for (const entry of Object.values(registry.clients)) {
    const cacheDir = getClientCacheDir(entry.slug);
    const clientState = readClientState(entry.slug);

    let hdus: ReturnType<typeof listHdus> = [];
    if (existsSync(cacheDir)) {
      try { hdus = listHdus(cacheDir); } catch { /* */ }
    }

    const counts = {
      total: hdus.length,
      in_progress: hdus.filter(h => h.frontmatter.status === 'in-progress').length,
      approved: hdus.filter(h => h.frontmatter.status === 'approved').length,
      done: hdus.filter(h => h.frontmatter.status === 'done').length,
    };

    clients.push({
      slug: entry.slug,
      name: entry.name || entry.slug,
      state: clientState?.state ?? 'UNKNOWN',
      hdu_counts: counts,
    });

    // Construir queue filtrando por user si se pasó
    for (const h of hdus) {
      const fm = h.frontmatter;
      if (opts.user && fm.assigned_to !== opts.user) continue;

      const item: EngineQueueItem = {
        id: fm.id,
        client: entry.slug,
        title: fm.title,
        priority: fm.priority,
        dev_type: fm.dev_type ?? null,
        apps_affected: fm.apps_affected,
      };

      if (fm.status === 'in-progress') inProgressItems.push(item);
      if (fm.status === 'approved') approvedItems.push(item);
    }

    // Alerta de contexto stale (>7 días sin sync)
    if (entry.last_synced) {
      const ageH = (Date.now() - new Date(entry.last_synced).getTime()) / 3_600_000;
      if (ageH > 7 * 24) {
        alerts.push({
          kind: 'stale_context',
          level: 'warn',
          message: `Contexto de ${entry.slug} desactualizado (${Math.floor(ageH / 24)}d sin sync)`,
          action: `dd-cli pull-context ${entry.slug}`,
          client: entry.slug,
        });
      }
    }
  }

  // Ordenar por prioridad
  approvedItems.sort((a, b) => (priorityOrder[b.priority] ?? 0) - (priorityOrder[a.priority] ?? 0));

  // Sugerir próxima HDU (primera approved con mayor prioridad)
  const nextSuggested = approvedItems[0]?.id ?? null;

  // ── Hints ─────────────────────────────────────────────────────────
  if (!session) {
    if (approvedItems.length > 0) {
      hints.push({ for: 'next-action', text: `Tomá la próxima HDU: /devflow-ia:pick-next` });
    } else {
      hints.push({ for: 'next-action', text: 'Sin sesión activa. Ejecutá: dd-cli start-session <HDU-id>' });
    }
  } else if (session.journey) {
    hints.push({
      for: 'next-action',
      text: `Próximo paso: ${session.journey.next_skill ?? 'revisar el SPEC'}`,
    });
  }

  return {
    schema_version: 'v1',
    generated_at: now,
    actor: {
      user: opts.user ?? null,
      active_client: activeClient,
    },
    session,
    clients,
    queue: {
      in_progress: inProgressItems,
      approved: approvedItems,
      next_suggested: nextSuggested,
    },
    alerts,
    hints,
  };
}
