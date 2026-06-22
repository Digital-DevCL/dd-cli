/**
 * `dd-cli doctor --for=<dev_type>` — valida precondiciones del tipo.
 *
 * Referencia: dd-cli-spec.md §3.6.2
 */
import type { DevType } from '../types/dev-type.js';
import type { SessionState } from '../types/session.js';
import { evaluateRules, formatDoctorOutput, partition } from '../enforcement/evaluator.js';
import { enforcementRuleIdsForDevType } from '../enforcement/rules.js';

export interface DoctorInput {
  projectRoot: string;
  session: SessionState;
  /** Si se pasa, evalúa contra ese tipo (hipotético). Si no, usa el de session. */
  forType?: DevType;
}

export interface DoctorOutput {
  text: string;
  exitCode: number;
}

/**
 * Ejecuta el chequeo de precondiciones para el dev_type indicado (o el de session).
 *
 * Exit code:
 *   0 = OK (todas las reglas pasan)
 *   2 = al menos una regla con severity=block falla
 */
export function doctor({ projectRoot, session, forType }: DoctorInput): DoctorOutput {
  const targetType = forType ?? session.dev_type;

  if (!targetType) {
    return {
      text: 'No hay dev_type para validar. Usa --for=<tipo> o inicia una sesión.',
      exitCode: 1,
    };
  }

  const ruleIds = enforcementRuleIdsForDevType(targetType);
  const results = evaluateRules({ projectRoot, session, ruleIds });
  const { blockers } = partition(results);

  return {
    text: formatDoctorOutput(results, targetType),
    exitCode: blockers.length > 0 ? 2 : 0,
  };
}
