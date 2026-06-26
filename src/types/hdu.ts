/**
 * Schema de HDUs (S5-1) y log de transiciones (S5-5).
 *
 * Las HDUs viven en `<cliente>-devflow-context/hdus/` (decisión H-1 del
 * rediseño). Una HDU es un archivo markdown con frontmatter YAML
 * estructurado + cuerpo en prosa libre.
 *
 * Apéndice B.5, B.6, B.7 del doc rediseño.
 *
 * El log de transiciones es append-only (.jsonl). Cada cambio de status
 * genera una línea con timestamp. Es event-sourcing puro — `dd-cli stats`
 * deriva todas las métricas desde acá. Forward-compat con la app web
 * futura: misma estructura, sin migración.
 */
import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { DEV_TYPES } from './dev-type.js';

// ── Enums ────────────────────────────────────────────────────────────

export const HDU_STATUSES = ['draft', 'approved', 'in-progress', 'in-review', 'done', 'cancelled'] as const;
export type HduStatus = (typeof HDU_STATUSES)[number];

export const HDU_PRIORITIES = ['baja', 'media', 'alta', 'crítica'] as const;
export type HduPriority = (typeof HDU_PRIORITIES)[number];

// ── Schema ──────────────────────────────────────────────────────────

export const HduFrontmatterSchema = z.object({
  id: z.string().regex(/^HDU-(\d+|LOCAL-[a-z0-9-]+)$/, 'Debe ser HDU-NNN o HDU-LOCAL-<slug>'),
  title: z.string().min(1),
  status: z.enum(HDU_STATUSES).default('draft'),
  dev_type: z.enum(DEV_TYPES).optional(),
  dev_type_locked: z.boolean().default(false),
  dev_type_source: z.string().optional(),
  priority: z.enum(HDU_PRIORITIES).default('media'),
  apps_affected: z.array(z.string()).default([]),
  assigned_to: z.string().email().nullable().default(null),
  created_by: z.string().email().optional(),
  created_at: z.string(),
  approved_by: z.string().email().nullable().default(null),
  approved_at: z.string().nullable().default(null),
  sprint: z.string().nullable().default(null),
  lead_time_estimated_days: z.number().int().min(0).nullable().default(null),
  references: z.array(z.string()).default([]),  // ej: HDU-123 (HDU previa cancelled)
  tags: z.array(z.string()).default([]),
});

export type HduFrontmatter = z.infer<typeof HduFrontmatterSchema>;

export interface Hdu {
  frontmatter: HduFrontmatter;
  body: string;
  filename: string;
}

// ── Transitions log (event sourcing — H-4, B.7 del rediseño) ────────

export const HduTransitionSchema = z.object({
  ts: z.string(),
  hdu: z.string(),
  from: z.enum(HDU_STATUSES).nullable(),
  to: z.enum(HDU_STATUSES),
  by: z.string(),                       // email del actor o "system" para CI jobs
  reason: z.string().nullable().default(null),
  via: z.enum(['cli', 'pr-merge', 'ci-job', 'direct-commit']).default('cli'),
});
export type HduTransition = z.infer<typeof HduTransitionSchema>;

// ── Index (derivado, regenerable — H-1) ─────────────────────────────

export const HduIndexEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(HDU_STATUSES),
  dev_type: z.enum(DEV_TYPES).optional(),
  priority: z.enum(HDU_PRIORITIES),
  apps_affected: z.array(z.string()),
  assigned_to: z.string().email().nullable(),
  sprint: z.string().nullable(),
  created_at: z.string(),
});
export type HduIndexEntry = z.infer<typeof HduIndexEntrySchema>;

export const HduIndexSchema = z.object({
  schema_version: z.literal('1.0').default('1.0'),
  generated_at: z.string(),
  next_hdu_id: z.number().int().min(1).default(1),
  hdus: z.array(HduIndexEntrySchema).default([]),
});
export type HduIndex = z.infer<typeof HduIndexSchema>;

// ── Paths ───────────────────────────────────────────────────────────

const HDUS_DIR = 'hdus';
const TRANSITIONS_FILE = '_transitions.jsonl';
const INDEX_FILE = '_index.yml';

export function getHdusDir(contextRepoRoot: string): string {
  return path.join(contextRepoRoot, HDUS_DIR);
}

export function getHduTransitionsPath(contextRepoRoot: string): string {
  return path.join(getHdusDir(contextRepoRoot), TRANSITIONS_FILE);
}

export function getHduIndexPath(contextRepoRoot: string): string {
  return path.join(getHdusDir(contextRepoRoot), INDEX_FILE);
}

export function getHduFilePath(contextRepoRoot: string, id: string, slug: string): string {
  return path.join(getHdusDir(contextRepoRoot), `${id}-${slug}.md`);
}

// ── I/O: HDU files ──────────────────────────────────────────────────

/**
 * Parsea un archivo HDU (frontmatter YAML + body markdown).
 * Tira con mensaje claro si el frontmatter no valida.
 */
export function parseHduFile(content: string, filename: string): Hdu {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`HDU "${filename}" no tiene frontmatter YAML válido.`);
  }
  const fmRaw = yaml.load(match[1] ?? '');
  const result = HduFrontmatterSchema.safeParse(fmRaw);
  if (!result.success) {
    throw new Error(`Frontmatter inválido en "${filename}":\n${result.error.message}`);
  }
  return {
    frontmatter: result.data,
    body: match[2] ?? '',
    filename,
  };
}

export function serializeHdu(hdu: Hdu): string {
  const fm = HduFrontmatterSchema.parse(hdu.frontmatter);
  const yamlStr = yaml.dump(fm, { indent: 2, lineWidth: 120 });
  return `---\n${yamlStr}---\n${hdu.body}`;
}

export function loadHdu(contextRepoRoot: string, filename: string): Hdu {
  const fullPath = path.join(getHdusDir(contextRepoRoot), filename);
  const content = readFileSync(fullPath, 'utf-8');
  return parseHduFile(content, filename);
}

export function saveHdu(contextRepoRoot: string, hdu: Hdu): void {
  const dir = getHdusDir(contextRepoRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const content = serializeHdu(hdu);
  writeFileSync(path.join(dir, hdu.filename), content, 'utf-8');
}

/**
 * Lista todas las HDUs del context repo. Ignora _index.yml, _transitions.jsonl
 * y cualquier otro archivo que empiece con `_`.
 */
export function listHdus(contextRepoRoot: string): Hdu[] {
  const dir = getHdusDir(contextRepoRoot);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
  return files
    .map(f => {
      try {
        return loadHdu(contextRepoRoot, f);
      } catch {
        return null;
      }
    })
    .filter((h): h is Hdu => h !== null);
}

// ── I/O: Transitions log ────────────────────────────────────────────

/**
 * Append-only — nunca reescribir el archivo histórico. Cada llamada
 * agrega una línea nueva.
 */
export function appendTransition(contextRepoRoot: string, transition: HduTransition): void {
  const dir = getHdusDir(contextRepoRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const validated = HduTransitionSchema.parse(transition);
  const line = JSON.stringify(validated) + '\n';
  appendFileSync(getHduTransitionsPath(contextRepoRoot), line, 'utf-8');
}

/**
 * Lee todas las transiciones del log.
 * Útil para `dd-cli stats` y para reconstruir el historial de una HDU.
 */
export function readTransitions(contextRepoRoot: string): HduTransition[] {
  const p = getHduTransitionsPath(contextRepoRoot);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf-8')
    .split('\n')
    .filter(l => l.trim().length > 0)
    .map(l => {
      try {
        return HduTransitionSchema.parse(JSON.parse(l));
      } catch {
        return null;
      }
    })
    .filter((t): t is HduTransition => t !== null);
}

// ── I/O: Index ──────────────────────────────────────────────────────

export function loadHduIndex(contextRepoRoot: string): HduIndex {
  const p = getHduIndexPath(contextRepoRoot);
  if (!existsSync(p)) {
    return HduIndexSchema.parse({
      generated_at: new Date().toISOString(),
      hdus: [],
    });
  }
  const raw = readFileSync(p, 'utf-8');
  const parsed = yaml.load(raw);
  const result = HduIndexSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`_index.yml inválido en ${p}:\n${result.error.message}`);
  }
  return result.data;
}

export function saveHduIndex(contextRepoRoot: string, index: HduIndex): void {
  const dir = getHdusDir(contextRepoRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const validated = HduIndexSchema.parse(index);
  writeFileSync(getHduIndexPath(contextRepoRoot), yaml.dump(validated, { indent: 2 }), 'utf-8');
}

/**
 * Regenera el index desde los archivos HDU. Idempotente.
 * Calcula `next_hdu_id` = max(HDU-N existentes) + 1.
 */
export function regenerateHduIndex(contextRepoRoot: string): HduIndex {
  const hdus = listHdus(contextRepoRoot);
  const ids = hdus
    .map(h => h.frontmatter.id.match(/^HDU-(\d+)/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map(m => Number.parseInt(m[1] ?? '0', 10));
  const nextHduId = ids.length > 0 ? Math.max(...ids) + 1 : 1;

  const index: HduIndex = {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    next_hdu_id: nextHduId,
    hdus: hdus.map(h => HduIndexEntrySchema.parse({
      id: h.frontmatter.id,
      title: h.frontmatter.title,
      status: h.frontmatter.status,
      dev_type: h.frontmatter.dev_type,
      priority: h.frontmatter.priority,
      apps_affected: h.frontmatter.apps_affected,
      assigned_to: h.frontmatter.assigned_to,
      sprint: h.frontmatter.sprint,
      created_at: h.frontmatter.created_at,
    })),
  };

  saveHduIndex(contextRepoRoot, index);
  return index;
}

// ── Máquina de estados ──────────────────────────────────────────────

const HDU_TRANSITIONS: Record<HduStatus, HduStatus[]> = {
  'draft':       ['approved', 'cancelled'],
  'approved':    ['in-progress', 'cancelled', 'draft'],         // rollback a draft posible
  'in-progress': ['in-review', 'approved', 'cancelled'],         // pausar = approved nuevamente
  'in-review':   ['done', 'in-progress', 'cancelled'],           // rechazar = volver a in-progress
  'done':        [],                                              // terminal
  'cancelled':   [],                                              // terminal
};

export function canHduTransitionTo(from: HduStatus, to: HduStatus): boolean {
  return HDU_TRANSITIONS[from]?.includes(to) ?? false;
}

export function legalNextStatuses(from: HduStatus): HduStatus[] {
  return [...(HDU_TRANSITIONS[from] ?? [])];
}
