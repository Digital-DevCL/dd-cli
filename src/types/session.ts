/**
 * Schema de .devflow/session.json — validado con zod.
 *
 * Referencia: manual-implementacion/dd-cli-spec.md §4
 */
import { z } from 'zod';
import { DEV_TYPES } from './dev-type.js';

export const DevTypeSchema = z.enum(DEV_TYPES);

export const DevTypeSourceSchema = z.enum([
  'business-brief',
  'tech-lead-approval',
  'inherited',
  'reclassify',
]);

export const FlowStateSchema = z.enum([
  'not_started',
  'started',
  'repo_mapped',
  'baseline_ready',
  'spec_ready',
  'change_active',
  'ended',
]);
export type FlowState = z.infer<typeof FlowStateSchema>;

const TaskStatus = z.enum(['pending', 'in_progress', 'done', 'blocked']);

const TaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: TaskStatus,
  completed_at: z.string().nullable(),
});
export type Task = z.infer<typeof TaskSchema>;

const BlockerSchema = z.object({
  task_id: z.string(),
  reason: z.string(),
  reported_at: z.string(),
  resolved_at: z.string().nullable(),
  resolution: z.string().nullable(),
});
export type Blocker = z.infer<typeof BlockerSchema>;

const AnomalySchema = z.object({
  type: z.enum([
    'stale_session',
    'long_open_session',
    'stuck_in_started',
    'no_spec_after_30min',
    'missing_repo_context',
    'missing_baseline',
  ]),
  detected_at: z.string(),
  acknowledged: z.boolean(),
  details: z.string(),
});
export type Anomaly = z.infer<typeof AnomalySchema>;

const VendorSchema = z.object({
  name: z.string(),
  api_version: z.string(),
  docs_url: z.string().optional(),
  sandbox_url: z.string().optional(),
});
export type Vendor = z.infer<typeof VendorSchema>;

export const SessionStateSchema = z.object({
  // Identificación
  feature_id: z.string().nullable(),
  feature_name: z.string().nullable(),
  session_id: z.string(),

  // Tiempos
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  last_heartbeat: z.string().nullable(),

  // Modo
  mode: z.enum(['local', 'platform']),
  platform_url: z.string().nullable(),
  unclosed: z.boolean().default(false),

  // dev_type machinery
  dev_type: DevTypeSchema.nullable(),
  dev_type_subtype: z.string().max(40).nullable(),
  dev_type_source: DevTypeSourceSchema,
  dev_type_rationale: z.string().max(300),
  dev_type_locked: z.boolean().default(false),
  dev_type_locked_at: z.string().nullable(),
  dev_type_reclassified_from: DevTypeSchema.nullable().optional(),

  // Contexto del repo
  apps_affected: z.array(z.string()).default([]),
  repo_context_path: z.string().nullable(),
  baseline_path: z.string().nullable(),
  legacy_system: z.string().nullable(),
  vendor: VendorSchema.nullable(),

  // Enforcement
  enforcement_rules: z.array(z.string()).default([]),

  // Estado del flujo
  flow_state: FlowStateSchema,
  active_change: z.string().nullable(),

  // Tasks y blockers
  tasks: z.array(TaskSchema).default([]),
  blockers: z.array(BlockerSchema).default([]),

  // RAG (platform only)
  rag_context_snapshot: z.array(z.string()).nullable(),

  // Diagnóstico
  anomalies: z.array(AnomalySchema).default([]),

  // Metadata
  cli_version: z.string(),
  schema_version: z.literal(2),
});

export type SessionState = z.infer<typeof SessionStateSchema>;

/**
 * Estado inicial al `dd-cli init` — sin sesión activa.
 */
export function createInitialSession(cliVersion: string): SessionState {
  return {
    feature_id: null,
    feature_name: null,
    session_id: 'sess-init',
    started_at: null,
    ended_at: null,
    last_heartbeat: null,
    mode: 'local',
    platform_url: null,
    unclosed: false,
    dev_type: null,
    dev_type_subtype: null,
    dev_type_source: 'business-brief',
    dev_type_rationale: '',
    dev_type_locked: false,
    dev_type_locked_at: null,
    apps_affected: [],
    repo_context_path: null,
    baseline_path: null,
    legacy_system: null,
    vendor: null,
    enforcement_rules: [],
    flow_state: 'not_started',
    active_change: null,
    tasks: [],
    blockers: [],
    rag_context_snapshot: null,
    anomalies: [],
    cli_version: cliVersion,
    schema_version: 2,
  };
}
