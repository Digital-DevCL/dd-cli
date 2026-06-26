/**
 * Schema de `.devflow-context/catalog.yml` — catálogo de apps del cliente (S1-2).
 *
 * Resuelve A-4 del rediseño: "la fuente de verdad del catálogo es markdown,
 * frágil por diseño". Migramos a YAML canónico; el markdown queda como vista
 * derivada que se regenera con `dd-cli context render` (Sprint 2 S2-5).
 *
 * Apéndice B.2 del doc rediseño.
 *
 * Backward-compat: si el catálogo es markdown viejo (app-catalog.md),
 * `loadCatalog` lo parsea con el hot-fix de B-1 y produce el mismo shape.
 */
import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { APP_TYPES, APP_ORIGINS } from './project-config.js';
import { DEV_TYPES } from './dev-type.js';
import { writeWithAudit, parseAuditedFile } from '../utils/audit.js';

// ── Subschemas ───────────────────────────────────────────────────────

export const APP_STATUSES = ['prod', 'qa', 'dev', 'deprecated', 'inactive', 'empty', 'unknown'] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

export const APP_ROLES = ['provider', 'consumer', 'portal', 'standalone', 'data-layer', 'integration', 'unknown'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const CatalogAppSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Debe ser kebab-case'),
  name: z.string().min(1),
  type: z.enum(APP_TYPES),
  role: z.enum(APP_ROLES).default('standalone'),
  auth_profile: z.string().nullable().default(null),
  ci_cd_profile: z.string().nullable().default(null),
  repo: z.string().nullable().default(null),
  branch: z.string().default('main'),
  status: z.enum(APP_STATUSES).default('unknown'),
  app_origin: z.enum(APP_ORIGINS).default('legacy-app'),
  template_origin: z.string().nullable().default(null),
  preferred_dev_types: z.array(z.enum(DEV_TYPES)).default([]),
  tags: z.array(z.string()).default([]),
  notes: z.string().nullable().default(null),
});

export type CatalogApp = z.infer<typeof CatalogAppSchema>;

// ── Schema principal ────────────────────────────────────────────────

export const CatalogSchema = z.object({
  schema_version: z.literal('1.0').default('1.0'),
  apps: z.array(CatalogAppSchema).default([]),
});

export type Catalog = z.infer<typeof CatalogSchema>;

// ── Paths ────────────────────────────────────────────────────────────

const CATALOG_DIR = '.devflow-context';
const CATALOG_YAML = 'catalog.yml';
const CATALOG_MARKDOWN_LEGACY = 'app-catalog.md';

export function getCatalogYamlPath(contextRepoRoot: string): string {
  return path.join(contextRepoRoot, CATALOG_DIR, CATALOG_YAML);
}

export function getCatalogMarkdownPath(contextRepoRoot: string): string {
  return path.join(contextRepoRoot, CATALOG_DIR, CATALOG_MARKDOWN_LEGACY);
}

export function hasCatalog(contextRepoRoot: string): boolean {
  return existsSync(getCatalogYamlPath(contextRepoRoot))
      || existsSync(getCatalogMarkdownPath(contextRepoRoot));
}

// ── I/O ──────────────────────────────────────────────────────────────

/**
 * Lee el catálogo del context repo.
 * Prefiere catalog.yml; si no existe, parsea app-catalog.md (backward-compat).
 * Retorna null si no hay ninguno.
 */
export function loadCatalog(contextRepoRoot: string): Catalog | null {
  const yamlPath = getCatalogYamlPath(contextRepoRoot);
  if (existsSync(yamlPath)) {
    const raw = readFileSync(yamlPath, 'utf-8');
    // S7-2: si tiene audit header, parsear solo el body
    const audited = parseAuditedFile(raw);
    const yamlContent = audited.header ? audited.body : raw;
    const parsed = yaml.load(yamlContent);
    const result = CatalogSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`catalog.yml inválido en ${yamlPath}:\n${result.error.message}`);
    }
    return result.data;
  }

  const mdPath = getCatalogMarkdownPath(contextRepoRoot);
  if (existsSync(mdPath)) {
    const apps = parseMarkdownCatalog(readFileSync(mdPath, 'utf-8'));
    return CatalogSchema.parse({ apps });
  }

  return null;
}

export interface SaveCatalogOpts {
  generated_by?: string;       // S7-2: si está, agrega audit header
  cli_version?: string;
}

export function saveCatalog(contextRepoRoot: string, catalog: Catalog, opts: SaveCatalogOpts = {}): void {
  const dir = path.join(contextRepoRoot, CATALOG_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const validated = CatalogSchema.parse(catalog);
  const yamlStr = yaml.dump(validated, { indent: 2, lineWidth: 120 });
  const content = opts.generated_by && opts.cli_version
    ? writeWithAudit({
        generated_by: opts.generated_by,
        cli_version: opts.cli_version,
        body: yamlStr,
      })
    : yamlStr;
  writeFileSync(getCatalogYamlPath(contextRepoRoot), content, 'utf-8');
}

// ── Backward-compat: parser de markdown legacy ──────────────────────

/**
 * Parsea el markdown legacy `app-catalog.md` al shape de Catalog.
 *
 * Schema del skill /init-context (8 columnas):
 *   | slug | tipo | app_origin | auth-profile | repo | ci_cd | estado | preferred_dev_types |
 *
 * El hot-fix de B-1 ya tolera backticks. Acá generalizamos al parser
 * canónico y los campos faltantes (name, role, etc.) usan defaults.
 *
 * NOTA: la columna 5 (ci_cd) del skill viejo era boolean (Sí/No), no el
 * nombre del profile. Si parece boolean, marcamos `ci_cd_profile: null`
 * para que el cliente lo complete via `dd-cli client gaps --resolve`.
 */
export function parseMarkdownCatalog(content: string): CatalogApp[] {
  const stripBackticks = (s: string) => s.replace(/^`+/, '').replace(/`+$/, '').trim();
  const looksLikeBoolean = (s: string) => /^(sí|si|no|yes|true|false|✓|✗|—|-)?$/i.test(s.trim());

  const apps: CatalogApp[] = [];
  for (const line of content.split('\n')) {
    if (!/^\|\s*[`a-z0-9]/i.test(line)) continue;
    if (/^\|\s*-+/.test(line)) continue;

    const cols = line.split('|').map(c => stripBackticks(c.trim())).filter(Boolean);
    if (cols.length < 4) continue;

    const firstCol = (cols[0] ?? '').toLowerCase();
    if (firstCol === 'slug' || firstCol === 'app') continue;

    const slug = cols[0] ?? '';
    if (!/^[a-z0-9-]+$/.test(slug)) continue;

    const rawType = cols[1] ?? '';
    const type = (APP_TYPES as readonly string[]).includes(rawType)
      ? rawType
      : 'bff';

    const rawOrigin = cols[2] ?? 'legacy-app';
    const app_origin = (APP_ORIGINS as readonly string[]).includes(rawOrigin)
      ? rawOrigin
      : 'legacy-app';

    const rawCiCd = cols[5] ?? '';
    const ci_cd_profile = looksLikeBoolean(rawCiCd) ? null : rawCiCd;

    const rawStatus = (cols[6] ?? '').toLowerCase();
    const status: AppStatus = (APP_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as AppStatus)
      : 'unknown';

    const preferred_dev_types = (cols[7] ?? '')
      .split(',')
      .map(s => stripBackticks(s))
      .filter(s => (DEV_TYPES as readonly string[]).includes(s)) as CatalogApp['preferred_dev_types'];

    apps.push(CatalogAppSchema.parse({
      slug,
      name: slug,                                      // sin display name en md viejo
      type,
      role: 'standalone',
      auth_profile: cols[3] || null,
      ci_cd_profile,
      repo: cols[4] || null,
      branch: 'main',
      status,
      app_origin,
      preferred_dev_types,
      tags: [],
      notes: null,
    }));
  }
  return apps;
}

// ── Render: catalog.yml → app-catalog.md (vista derivada, Sprint 2 S2-5) ──

/**
 * Regenera el markdown derivado desde el YAML canónico.
 * Lo invocará `dd-cli context render` en Sprint 2. Acá ya queda la lógica
 * porque depende del schema y conviene tenerla en el mismo módulo.
 */
export function renderCatalogMarkdown(catalog: Catalog): string {
  const apps = catalog.apps;
  const lines: string[] = [];

  lines.push('# App catalog');
  lines.push('');
  lines.push('Generado por dd-cli context render — no editar a mano (editá catalog.yml).');
  lines.push('');
  lines.push('| slug | tipo | app_origin | auth-profile | repo | ci_cd_profile | estado | preferred_dev_types |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const app of apps) {
    const cells = [
      '`' + app.slug + '`',
      app.type,
      app.app_origin,
      app.auth_profile ?? '—',
      app.repo ?? '—',
      app.ci_cd_profile ?? '—',
      app.status,
      app.preferred_dev_types.join(', ') || '—',
    ];
    lines.push('| ' + cells.join(' | ') + ' |');
  }
  lines.push('');
  return lines.join('\n');
}
