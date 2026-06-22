/**
 * `dd-cli start-session <feature-id>` — inicia sesión con dev_type.
 *
 * Referencia: dd-cli-spec.md §3.2
 *
 * Comportamiento:
 *   - Modo platform: llama devflow_get_feature() → recibe dev_type + enforcement_rules
 *   - Modo local: pide dev_type interactivo (dropdown) si no se pasa por flag
 *   - Escribe session.json
 */
import type { DevType } from '../types/dev-type.js';
import type { SessionState } from '../types/session.js';
import { enforcementRuleIdsForDevType } from '../enforcement/rules.js';

export interface StartSessionInput {
  featureId: string;
  featureName?: string;
  mode: 'local' | 'platform';

  // Si modo=platform, estos se cargan vía devflow_get_feature
  devType?: DevType;
  devTypeSubtype?: string;
  devTypeRationale?: string;
  appsAffected?: string[];
  legacySystem?: string;
  vendor?: { name: string; api_version: string; docs_url?: string; sandbox_url?: string };

  // Flags
  forceTypeInteractive?: boolean;
}

export interface StartSessionResult {
  session: SessionState;
  warnings: string[];
}

/**
 * Construye el SessionState inicial. NO escribe a disco (eso lo hace el caller).
 * Validación posterior con flow-state/detect.ts para determinar flow_state correcto.
 */
export function buildStartSessionState(
  input: StartSessionInput,
  cliVersion: string,
  now: () => string = () => new Date().toISOString()
): StartSessionResult {
  const warnings: string[] = [];

  if (input.mode === 'local' && !input.devType) {
    warnings.push(
      'Modo local sin dev_type especificado. Se requiere flag --type=<tipo> o entrevista interactiva (no implementada en este stub).'
    );
  }

  // Si modo=platform y devType no fue provisto, indicar al caller que debe
  // llamar primero a devflow_get_feature().
  if (input.mode === 'platform' && !input.devType) {
    warnings.push(
      'Modo platform: llamar primero devflow_get_feature() para obtener dev_type'
    );
  }

  const enforcementRules = input.devType
    ? enforcementRuleIdsForDevType(input.devType)
    : [];

  const session: SessionState = {
    feature_id: input.featureId,
    feature_name: input.featureName ?? null,
    session_id: `sess-${now()}`,
    started_at: now(),
    ended_at: null,
    last_heartbeat: now(),
    mode: input.mode,
    platform_url: null,
    unclosed: false,
    dev_type: input.devType ?? null,
    dev_type_subtype: input.devTypeSubtype ?? null,
    dev_type_source: input.mode === 'platform' ? 'tech-lead-approval' : 'business-brief',
    dev_type_rationale: input.devTypeRationale ?? '',
    dev_type_locked: false, // LOCK ocurre en /new-spec → devflow_save_spec
    dev_type_locked_at: null,
    apps_affected: input.appsAffected ?? [],
    repo_context_path: null,
    baseline_path: null,
    legacy_system: input.legacySystem ?? null,
    vendor: input.vendor ?? null,
    enforcement_rules: enforcementRules,
    flow_state: 'started',
    active_change: null,
    tasks: [],
    blockers: [],
    rag_context_snapshot: null,
    anomalies: [],
    cli_version: cliVersion,
    schema_version: 2,
  };

  return { session, warnings };
}
