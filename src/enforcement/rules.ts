/**
 * Catálogo de enforcement rules.
 *
 * Cada regla aplica a un subset de dev_type y la evalúa una o más skills.
 *
 * Referencia: skills/ENFORCEMENT.md (14 reglas documentadas)
 */
import type { DevType } from '../types/dev-type.js';
import type { SessionState } from '../types/session.js';

export type Severity = 'block' | 'warn' | 'audit';

export interface EvaluationContext {
  projectRoot: string;
  session: SessionState;
  fileExists: (relPath: string) => boolean;
}

export interface EvaluationResult {
  rule_id: string;
  passed: boolean;
  severity: Severity;
  message: string;
}

export interface EnforcementRule {
  id: string;
  applies_to: DevType[];
  severity: Severity;
  evaluate(ctx: EvaluationContext): EvaluationResult;
}

const ALL_TYPES: DevType[] = [
  'greenfield',
  'brownfield-feature',
  'brownfield-refactor',
  'modernizacion',
  'integracion-externa',
];

const NON_GREENFIELD: DevType[] = [
  'brownfield-feature',
  'brownfield-refactor',
  'modernizacion',
  'integracion-externa',
];

export const RULES: Record<string, EnforcementRule> = {
  REQUIRE_REPO_CONTEXT_MD: {
    id: 'REQUIRE_REPO_CONTEXT_MD',
    applies_to: NON_GREENFIELD,
    severity: 'block',
    evaluate: ({ session, fileExists }) => {
      const ok = fileExists('.ai/REPO-CONTEXT.md');
      return {
        rule_id: 'REQUIRE_REPO_CONTEXT_MD',
        passed: ok,
        severity: 'block',
        message: ok
          ? '.ai/REPO-CONTEXT.md presente'
          : `Esta HDU es ${session.dev_type} y requiere mapeo del repo existente. Ejecuta \`/init-repo-context\` antes de \`/new-spec\`.`,
      };
    },
  },

  REQUIRE_BASELINE_MD: {
    id: 'REQUIRE_BASELINE_MD',
    applies_to: ['brownfield-refactor'],
    severity: 'block',
    evaluate: ({ session }) => {
      const ok = session.baseline_path !== null;
      return {
        rule_id: 'REQUIRE_BASELINE_MD',
        passed: ok,
        severity: 'block',
        message: ok
          ? `.ai/BASELINE-* presente (${session.baseline_path})`
          : 'Refactor sin baseline no garantiza no-regresión. Ejecuta `/capture-baseline <modulo>` antes de `/new-spec`. Si no hay tests previos, el skill registra el caso explícitamente.',
      };
    },
  },

  BLOCK_NEW_APP: {
    id: 'BLOCK_NEW_APP',
    applies_to: NON_GREENFIELD,
    severity: 'warn',  // E-01: era 'block', era falso positivo — es un recordatorio, no un bloqueo
    evaluate: ({ session }) => {
      // Solo avisa si el dev intenta usar /new-app en brownfield.
      // No puede detectarse desde session state → siempre pasa; el aviso
      // queda en la skill /new-app que ya tiene la lógica de rechazo.
      return {
        rule_id: 'BLOCK_NEW_APP',
        passed: true,
        severity: 'warn',
        message: `Esta HDU es ${session.dev_type}. Usa el repo existente. /new-app solo aplica a greenfield.`,
      };
    },
  },

  REQUIRE_LEGACY_SYSTEM_FIELD: {
    id: 'REQUIRE_LEGACY_SYSTEM_FIELD',
    applies_to: ['modernizacion'],
    severity: 'block',
    evaluate: ({ session }) => {
      const ok =
        session.legacy_system !== null && session.legacy_system.trim() !== '';
      return {
        rule_id: 'REQUIRE_LEGACY_SYSTEM_FIELD',
        passed: ok,
        severity: 'block',
        message: ok
          ? `legacy_system: ${session.legacy_system}`
          : 'Modernización requiere identificar el sistema legacy a reemplazar. Completá el campo `legacy_system` en la HDU.',
      };
    },
  },

  REQUIRE_VENDOR_FIELD: {
    id: 'REQUIRE_VENDOR_FIELD',
    applies_to: ['integracion-externa'],
    severity: 'block',
    evaluate: ({ session }) => {
      const v = session.vendor;
      const ok =
        v !== null &&
        typeof v.name === 'string' &&
        v.name.length > 0 &&
        typeof v.api_version === 'string' &&
        v.api_version.length > 0;
      return {
        rule_id: 'REQUIRE_VENDOR_FIELD',
        passed: ok,
        severity: 'block',
        message: ok
          ? `vendor: ${v.name} v${v.api_version}`
          : 'Integración externa requiere identificar el vendor y la versión de API. Completá los campos `vendor` en la HDU.',
      };
    },
  },

  OPSX_PROPOSE_REQUIRE_NO_FUNCTIONAL_CHANGE_SECTION: {
    id: 'OPSX_PROPOSE_REQUIRE_NO_FUNCTIONAL_CHANGE_SECTION',
    applies_to: ['brownfield-refactor'],
    severity: 'warn',
    evaluate: () => {
      // La evalúa /opsx:propose leyendo el proposal.md después de generarlo.
      // En la evaluación de precondiciones (antes), no aplica.
      return {
        rule_id: 'OPSX_PROPOSE_REQUIRE_NO_FUNCTIONAL_CHANGE_SECTION',
        passed: true,
        severity: 'warn',
        message: 'Validada por /opsx:propose tras generar proposal.md',
      };
    },
  },

  OPSX_PROPOSE_SUGGEST_ANTI_CORRUPTION_LAYER: {
    id: 'OPSX_PROPOSE_SUGGEST_ANTI_CORRUPTION_LAYER',
    applies_to: ['integracion-externa'],
    severity: 'warn',
    evaluate: () => ({
      rule_id: 'OPSX_PROPOSE_SUGGEST_ANTI_CORRUPTION_LAYER',
      passed: true,
      severity: 'warn',
      message: 'Validada por /opsx:propose tras generar design.md',
    }),
  },

  RELEASE_CHECK_VALIDATE_CONTRACTS: {
    id: 'RELEASE_CHECK_VALIDATE_CONTRACTS',
    applies_to: ['brownfield-refactor'],
    severity: 'block',
    evaluate: () => ({
      rule_id: 'RELEASE_CHECK_VALIDATE_CONTRACTS',
      passed: true,
      severity: 'block',
      message: 'Validada por /release-check(R) en el MR — diff contratos vs BASELINE',
    }),
  },

  RELEASE_CHECK_VALIDATE_PARITY: {
    id: 'RELEASE_CHECK_VALIDATE_PARITY',
    applies_to: ['modernizacion'],
    severity: 'block',
    evaluate: () => ({
      rule_id: 'RELEASE_CHECK_VALIDATE_PARITY',
      passed: true,
      severity: 'block',
      message: 'Validada por /release-check(M) en el MR — matriz paridad',
    }),
  },

  RELEASE_CHECK_VALIDATE_INTEGRATION_SECURITY: {
    id: 'RELEASE_CHECK_VALIDATE_INTEGRATION_SECURITY',
    applies_to: ['integracion-externa'],
    severity: 'block',
    evaluate: () => ({
      rule_id: 'RELEASE_CHECK_VALIDATE_INTEGRATION_SECURITY',
      passed: true,
      severity: 'block',
      message: 'Validada por /release-check(I) en el MR — credenciales/firmas/idempotencia',
    }),
  },

  COMMIT_TRAILER_DEVFLOW_TYPE: {
    id: 'COMMIT_TRAILER_DEVFLOW_TYPE',
    applies_to: ALL_TYPES,
    severity: 'block',
    evaluate: () => ({
      rule_id: 'COMMIT_TRAILER_DEVFLOW_TYPE',
      passed: true,
      severity: 'block',
      message: 'Validada por CI/CD pipeline — cada commit del MR incluye trailer DevFlow-Type',
    }),
  },

  MOVE_TO_SPRINT_REQUIRES_DEV_TYPE: {
    id: 'MOVE_TO_SPRINT_REQUIRES_DEV_TYPE',
    applies_to: ALL_TYPES,
    severity: 'block',
    evaluate: ({ session }) => {
      const ok = session.dev_type !== null;
      return {
        rule_id: 'MOVE_TO_SPRINT_REQUIRES_DEV_TYPE',
        passed: ok,
        severity: 'block',
        message: ok
          ? `dev_type: ${session.dev_type}`
          : 'Esta HDU no tiene dev_type definido. Volver al portal de negocio o pedir al PMO que lo complete antes de planificar.',
      };
    },
  },
};

/**
 * Devuelve las reglas aplicables a un dev_type dado.
 */
export function rulesForDevType(devType: DevType): EnforcementRule[] {
  return Object.values(RULES).filter((r) => r.applies_to.includes(devType));
}

/**
 * Genera los enforcement_rules[] para meter en session.json.
 * El CLI los persiste y las skills los leen para saber qué chequear.
 */
export function enforcementRuleIdsForDevType(devType: DevType): string[] {
  return rulesForDevType(devType).map((r) => r.id);
}
