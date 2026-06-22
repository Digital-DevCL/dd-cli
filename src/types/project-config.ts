/**
 * Schema de .devflow/config.yml — identidad del repo de código.
 *
 * Este archivo se commitea en git. Define a qué cliente pertenece este repo,
 * qué tipo de app es, y cómo conectarse al contexto del cliente.
 *
 * Referencia: _Empresa/Productos/DevFlow-IA/guia-contexto-configuracion.md
 */
import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { DEV_TYPES, type DevType } from './dev-type.js';

// ── App types ────────────────────────────────────────────────────────

export const APP_TYPES = [
  'microservice',
  'bff',
  'api-rest',
  'frontend-app',
  'frontend-mfe',
  'worker',
  'library',
] as const;
export type AppType = (typeof APP_TYPES)[number];

export const APP_ORIGINS = ['greenfield-app', 'legacy-app', 'external-app'] as const;
export type AppOrigin = (typeof APP_ORIGINS)[number];

// ── Schema ───────────────────────────────────────────────────────────

export const ProjectConfigSchema = z.object({
  client: z.object({
    slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Debe ser kebab-case'),
    name: z.string().min(1),
    context_url: z.string().url('Debe ser una URL de GitHub/GitLab'),
  }),

  app: z.object({
    slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Debe ser kebab-case'),
    type: z.enum(APP_TYPES),
    auth_profile: z.string().min(1),
    ci_cd_profile: z.string().min(1),
    app_origin: z.enum(APP_ORIGINS).default('legacy-app'),
    preferred_dev_types: z.array(z.enum(DEV_TYPES)).default([]),
  }),

  devflow: z.object({
    mode: z.enum(['local', 'platform']).default('local'),
    platform_url: z.string().url().nullable().default(null),
  }).default({ mode: 'local', platform_url: null }),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

// ── I/O ──────────────────────────────────────────────────────────────

const CONFIG_FILENAME = 'config.yml';

export function getProjectConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', CONFIG_FILENAME);
}

export function loadProjectConfig(projectRoot: string): ProjectConfig | null {
  const configPath = getProjectConfigPath(projectRoot);
  if (!existsSync(configPath)) return null;

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = yaml.load(raw);
  const result = ProjectConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `config.yml inválido en ${configPath}:\n${result.error.message}`
    );
  }
  return result.data;
}

export function saveProjectConfig(projectRoot: string, config: ProjectConfig): void {
  const devflowDir = path.join(projectRoot, '.devflow');
  if (!existsSync(devflowDir)) mkdirSync(devflowDir, { recursive: true });

  const validated = ProjectConfigSchema.parse(config);
  const yamlStr = yaml.dump(validated, { indent: 2, lineWidth: 120 });
  writeFileSync(getProjectConfigPath(projectRoot), yamlStr, 'utf-8');
}

export function hasProjectConfig(projectRoot: string): boolean {
  return existsSync(getProjectConfigPath(projectRoot));
}

// ── Template para generar config.yml inicial ─────────────────────────

export function buildProjectConfig(opts: {
  clientSlug: string;
  clientName: string;
  contextUrl: string;
  appSlug: string;
  appType: AppType;
  authProfile: string;
  ciCdProfile: string;
  appOrigin?: AppOrigin;
  preferredDevTypes?: DevType[];
}): ProjectConfig {
  return ProjectConfigSchema.parse({
    client: {
      slug: opts.clientSlug,
      name: opts.clientName,
      context_url: opts.contextUrl,
    },
    app: {
      slug: opts.appSlug,
      type: opts.appType,
      auth_profile: opts.authProfile,
      ci_cd_profile: opts.ciCdProfile,
      app_origin: opts.appOrigin ?? 'legacy-app',
      preferred_dev_types: opts.preferredDevTypes ?? [],
    },
    devflow: { mode: 'local', platform_url: null },
  });
}
