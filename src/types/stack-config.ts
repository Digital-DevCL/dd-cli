/**
 * Schema de `.devflow-context/stack.yml` — master config del cliente (S1-1).
 *
 * Resuelve D-6 de Parte 1 del rediseño y la decisión arquitectónica central:
 * dos schemas distintos compartían `.devflow/config.yml`. Ahora:
 *   - `.devflow/config.yml`           → ProjectConfig (identidad repo↔cliente)
 *   - `.devflow-context/stack.yml`    → StackConfig (master config del cliente)
 *
 * Vive en el context repo. Lo escribe `/devflow-ia:client-onboard` (Sprint 3)
 * y `dd-cli client migrate` (S1-10). Lo leen las skills, el `init-client`
 * para defaults, y el dashboard `client show`.
 *
 * Apéndice B.3 del doc rediseño.
 */
import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';

// ── Subschemas ───────────────────────────────────────────────────────

export const StackInfraSchema = z.object({
  backend_framework: z.string().min(1),
  frontend_framework: z.string().min(1),
  databases: z.array(z.string()).min(1),
  infra: z.string().min(1),                       // ej: "Kubernetes"
  k8s_namespaces: z.record(z.string(), z.string()).optional(),
  cicd_platform: z.string().min(1),                // ej: "GitLab CI", "GitHub Actions"
  identity_provider: z.string().nullable().default(null),
  container_registry: z.string().nullable().default(null),
  base_domain: z.string().nullable().default(null),
});

export const NamingSchema = z.object({
  feature_id_pattern: z.string().default('HDU-{n}'),
  branch_pattern: z.string().default('feature/{feature_id}-{slug}'),
  spec_filename: z.string().default('SPEC-{slug}.md'),
  epic_filename: z.string().default('EPIC-{slug}.md'),
});

export const DefaultsSchema = z.object({
  acceptance_format: z.enum(['gherkin', 'checklist', 'narrative']).default('gherkin'),
  story_format: z.enum(['como-quiero-para', 'user-story', 'free']).default('como-quiero-para'),
  sprint_duration_weeks: z.number().int().min(1).max(8).default(2),
  main_branch: z.string().default('main'),
  qa_branch: z.string().default('develop'),
});

export const StackTemplatesSchema = z.object({
  fullstack: z.string().nullable().default(null),  // ej: "iprsa-group/laravel-fullstack-template"
  api: z.string().nullable().default(null),
}).passthrough();                                  // permite templates custom adicionales

export const StackDevflowSchema = z.object({
  mode: z.enum(['local', 'platform']).default('local'),
  url: z.string().url().nullable().default(null),
});

// ── Schema principal ────────────────────────────────────────────────

export const StackConfigSchema = z.object({
  schema_version: z.literal('1.0').default('1.0'),
  client: z.object({
    slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Debe ser kebab-case'),
    name: z.string().min(1),
    industry: z.string().nullable().default(null),
    team_size: z.number().int().nonnegative().nullable().default(null),
    primary_contact: z.string().nullable().default(null),
  }),
  stack: StackInfraSchema,
  naming: NamingSchema.default({} as z.input<typeof NamingSchema>),
  defaults: DefaultsSchema.default({} as z.input<typeof DefaultsSchema>),
  templates: StackTemplatesSchema.default({} as z.input<typeof StackTemplatesSchema>),
  devflow: StackDevflowSchema.default({} as z.input<typeof StackDevflowSchema>),
});

export type StackConfig = z.infer<typeof StackConfigSchema>;

// ── Paths ────────────────────────────────────────────────────────────

const STACK_DIR = '.devflow-context';
const STACK_FILENAME = 'stack.yml';

export function getStackConfigPath(contextRepoRoot: string): string {
  return path.join(contextRepoRoot, STACK_DIR, STACK_FILENAME);
}

export function hasStackConfig(contextRepoRoot: string): boolean {
  return existsSync(getStackConfigPath(contextRepoRoot));
}

// ── I/O ──────────────────────────────────────────────────────────────

export function loadStackConfig(contextRepoRoot: string): StackConfig | null {
  const p = getStackConfigPath(contextRepoRoot);
  if (!existsSync(p)) return null;

  const raw = readFileSync(p, 'utf-8');
  const parsed = yaml.load(raw);
  const result = StackConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`stack.yml inválido en ${p}:\n${result.error.message}`);
  }
  return result.data;
}

export function saveStackConfig(contextRepoRoot: string, config: StackConfig): void {
  const stackDir = path.join(contextRepoRoot, STACK_DIR);
  if (!existsSync(stackDir)) mkdirSync(stackDir, { recursive: true });

  const validated = StackConfigSchema.parse(config);
  const yamlStr = yaml.dump(validated, { indent: 2, lineWidth: 120 });
  writeFileSync(getStackConfigPath(contextRepoRoot), yamlStr, 'utf-8');
}

// ── Backward-compat: detectar legacy .devflow/config.yml master ──────

/**
 * Heurística para detectar el config.yml "master" legacy.
 *
 * El ProjectConfig nuevo (.devflow/config.yml) tiene `client + app + devflow`.
 * El master legacy (también `.devflow/config.yml` pero en context repo) tiene
 * `project + naming + defaults + stack + devflow + templates`.
 *
 * Si vemos `stack` o `project` en el top-level, asumimos legacy.
 */
export function looksLikeLegacyMasterConfig(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return false;
  const obj = parsed as Record<string, unknown>;
  return 'stack' in obj || 'project' in obj || 'naming' in obj || 'templates' in obj;
}
