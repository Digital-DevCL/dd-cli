/**
 * `dd-cli status` — diagnóstico de la sesión activa.
 *
 * Referencia: dd-cli-spec.md §3.2 (status)
 *
 * Muestra: feature, dev_type (locked?), flow_state, change activo, tasks, modo,
 *          apps_affected, anomalías detectadas, siguiente paso esperado.
 */
import type { SessionState } from '../types/session.js';
import { detectFlowState, suggestedNextStep } from '../flow-state/detect.js';
import { evaluateRules, partition } from '../enforcement/evaluator.js';

export interface StatusInput {
  projectRoot: string;
  session: SessionState;
}

export interface StatusOutput {
  lines: string[];
  exitCode: number;
}

/**
 * Genera el output multi-línea de `dd-cli status`.
 * Devuelve también el exit code:
 *   0 = ok
 *   1 = sin sesión activa
 *   2 = anomalías detectadas (block)
 */
export function statusOutput({ projectRoot, session }: StatusInput): StatusOutput {
  const lines: string[] = [];

  if (!session.started_at) {
    lines.push('Sin sesión activa.');
    lines.push('Para empezar: dd-cli start-session <feature-id>');
    return { lines, exitCode: 1 };
  }

  // Recalcular flow_state real (filesystem es la verdad)
  const actualFlowState = detectFlowState({ projectRoot, session });

  lines.push('Estado de sesión');
  lines.push(`  Feature:    ${session.feature_id ?? '?'} · ${session.feature_name ?? ''}`);
  if (session.dev_type) {
    const lockTag = session.dev_type_locked
      ? `locked desde ${session.dev_type_locked_at}, fuente: ${session.dev_type_source}`
      : `sin lock, fuente: ${session.dev_type_source}`;
    lines.push(`  Tipo:       ⬢ ${session.dev_type}  (${lockTag})`);
  } else {
    lines.push('  Tipo:       ⚠ no definido');
  }
  lines.push(`  Estado:     ${actualFlowState}`);
  if (session.active_change) {
    const total = session.tasks.length;
    const done = session.tasks.filter((t) => t.status === 'done').length;
    lines.push(`  Change:     ${session.active_change} (${done}/${total} tasks)`);
  }
  lines.push(`  Modo:       ${session.mode === 'platform' ? '● platform' : 'local'}`);
  if (session.apps_affected.length > 0) {
    lines.push(`  Apps:       ${session.apps_affected.join(', ')}`);
  }

  // Evaluar enforcement_rules y mostrar anomalías
  const results = evaluateRules({ projectRoot, session });
  const { blockers, warnings } = partition(results);

  if (blockers.length > 0 || warnings.length > 0) {
    lines.push('');
    lines.push('⚠ Anomalías detectadas:');
    for (const b of blockers) {
      lines.push(`  → ${b.message}`);
    }
    for (const w of warnings) {
      lines.push(`  → ${w.message}`);
    }
  }

  // Sugerir siguiente paso
  lines.push('');
  lines.push(`Siguiente paso esperado: ${suggestedNextStep(actualFlowState, session.dev_type)}`);

  const exitCode = blockers.length > 0 ? 2 : 0;
  return { lines, exitCode };
}
