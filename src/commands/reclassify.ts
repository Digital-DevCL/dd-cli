/**
 * `dd-cli reclassify --to=<type> --reason="<texto>"` — cambia dev_type post-lock.
 *
 * Disponible en ambos modos:
 *   - modo local: el CLI confía en el usuario (MVP, sin verificación de rol real)
 *     y genera audit-log local (ver reclassify-cmd.ts).
 *   - modo platform: la plataforma verifica el rol real del caller y genera
 *     audit-log server-side + notificación al negocio si lead-time delta >20%.
 *
 * Referencia: dd-cli-spec.md §3.6.1
 */
import type { DevType } from '../types/dev-type.js';
import type { SessionState } from '../types/session.js';
import { enforcementRuleIdsForDevType } from '../enforcement/rules.js';

export interface ReclassifyInput {
  session: SessionState;
  newType: DevType;
  reason: string;
  force?: boolean;
  callerRole?: 'tech-lead' | 'admin' | 'dev' | 'pmo';
}

export type ReclassifyError =
  | 'REASON_TOO_SHORT'
  | 'NO_SESSION'
  | 'INSUFFICIENT_ROLE'
  | 'SAME_TYPE'
  | 'LEAD_TIME_DELTA_TOO_HIGH';

export interface ReclassifyResult {
  ok: boolean;
  updatedSession?: SessionState;
  error?: ReclassifyError;
  message: string;
}

const MIN_REASON_CHARS = 30;

export function reclassify(input: ReclassifyInput): ReclassifyResult {
  if (!input.session.started_at) {
    return {
      ok: false,
      error: 'NO_SESSION',
      message: 'No hay sesión activa para reclasificar.',
    };
  }

  if (input.reason.trim().length < MIN_REASON_CHARS) {
    return {
      ok: false,
      error: 'REASON_TOO_SHORT',
      message: `Justificación requiere al menos ${MIN_REASON_CHARS} caracteres.`,
    };
  }

  if (input.callerRole !== 'tech-lead' && input.callerRole !== 'admin') {
    return {
      ok: false,
      error: 'INSUFFICIENT_ROLE',
      message: 'Solo Tech Lead o admin pueden reclassify después del lock.',
    };
  }

  if (input.session.dev_type === input.newType) {
    return {
      ok: false,
      error: 'SAME_TYPE',
      message: `El tipo ya es ${input.newType}. Nada que reclasificar.`,
    };
  }

  const now = new Date().toISOString();

  const updated: SessionState = {
    ...input.session,
    dev_type: input.newType,
    dev_type_subtype: null, // reset al cambiar tipo
    dev_type_source: 'reclassify',
    dev_type_rationale: input.reason,
    dev_type_locked: true,
    dev_type_locked_at: now,
    dev_type_reclassified_from: input.session.dev_type ?? undefined,
    // Recalcular enforcement_rules
    enforcement_rules: enforcementRuleIdsForDevType(input.newType),
  };

  return {
    ok: true,
    updatedSession: updated,
    message: `Reclasificación aplicada: ${input.session.dev_type} → ${input.newType}. La plataforma generará audit-log y evaluará delta de lead-time.`,
  };
}
