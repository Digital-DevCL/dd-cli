/**
 * Telemetría local opt-in (S7-1 / R-5 del rediseño).
 *
 * Decisión: default OFF, opt-in explícito vía `dd-cli telemetry enable`.
 * Solo escribe a ~/.devflow/telemetry.jsonl (append-only, local). NUNCA
 * envía datos a ningún servidor.
 *
 * Privacidad:
 *   - NO graba tokens, secrets, ni credenciales.
 *   - NO graba emails completos — solo el hash sha256 truncado (8 chars).
 *   - NO graba URLs específicas — solo el host/provider.
 *   - NO graba contenido de archivos generados.
 *   - SÍ graba: timestamp, command, exit_code, duration_ms, optional anon args.
 *
 * Útil para que el consultor o cliente:
 *   - Mida cuánto se usa el método (frecuencia de start-session, etc).
 *   - Detecte errores recurrentes (qué códigos tirando más).
 *   - Genere reportes locales con `dd-cli telemetry report`.
 *
 * Para forensics: el archivo es legible con cualquier tool jsonl.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import { getDevflowGlobalDir } from '../types/registry.js';

// ── Config ──────────────────────────────────────────────────────────

export const TelemetryConfigSchema = z.object({
  enabled: z.boolean().default(false),
  scope: z.literal('local').default('local'),  // futuro: 'remote' cuando exista plataforma
  enabled_at: z.string().nullable().default(null),
});
export type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>;

export const TelemetryEventSchema = z.object({
  ts: z.string(),
  command: z.string(),
  exit_code: z.number().int(),
  duration_ms: z.number().int().nonnegative(),
  args: z.record(z.string(), z.unknown()).optional(),
  user_hash: z.string().optional(),       // 8-char sha256 del email (si disponible)
  client_slug: z.string().optional(),
  error_code: z.string().optional(),       // código del JSON error si hubo
});
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;

// ── Paths ───────────────────────────────────────────────────────────

export function getTelemetryConfigPath(): string {
  return path.join(getDevflowGlobalDir(), 'telemetry.config.yml');
}
export function getTelemetryEventsPath(): string {
  return path.join(getDevflowGlobalDir(), 'telemetry.jsonl');
}

// ── Config I/O ──────────────────────────────────────────────────────

export function loadTelemetryConfig(): TelemetryConfig {
  const p = getTelemetryConfigPath();
  if (!existsSync(p)) {
    return TelemetryConfigSchema.parse({});
  }
  try {
    const raw = readFileSync(p, 'utf-8');
    const parsed = yaml.load(raw);
    return TelemetryConfigSchema.parse(parsed);
  } catch {
    return TelemetryConfigSchema.parse({});
  }
}

export function saveTelemetryConfig(config: TelemetryConfig): void {
  const p = getTelemetryConfigPath();
  const dir = path.dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const validated = TelemetryConfigSchema.parse(config);
  writeFileSync(p, yaml.dump(validated, { indent: 2 }), 'utf-8');
}

export function isTelemetryEnabled(): boolean {
  return loadTelemetryConfig().enabled;
}

// ── Sanitización de PII ─────────────────────────────────────────────

/**
 * Hash truncado para emails — preserva poder distinguir entre devs sin
 * exponer la identidad real en el log.
 */
export function hashUser(email: string | undefined | null): string | undefined {
  if (!email) return undefined;
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 8);
}

/**
 * Filtra args para sacar potenciales secrets. Cualquier argumento que
 * matchee patrones de token/secret se reemplaza por '[redacted]'.
 */
const SECRET_PATTERNS = [
  /^(git[-_]?token|token|secret|password|pwd|key|api[-_]?key|pat)$/i,
];

export function sanitizeArgs(args: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!args) return undefined;
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (SECRET_PATTERNS.some(p => p.test(k))) {
      safe[k] = '[redacted]';
    } else if (typeof v === 'string' && (v.startsWith('glpat-') || v.startsWith('ghp_') || v.startsWith('github_pat_'))) {
      safe[k] = '[redacted-token]';
    } else if (typeof v === 'string' && v.length > 100) {
      safe[k] = v.slice(0, 80) + '...[truncated]';
    } else {
      safe[k] = v;
    }
  }
  return safe;
}

// ── Append event ────────────────────────────────────────────────────

/**
 * Append a un evento de telemetría. NO-OP si está deshabilitada.
 *
 * Esta función es segura para llamar desde cualquier comando — si la
 * telemetría está OFF, no abre archivos ni hace I/O.
 */
export function recordTelemetry(event: Omit<TelemetryEvent, 'ts'>): void {
  if (!isTelemetryEnabled()) return;

  const p = getTelemetryEventsPath();
  const dir = path.dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const full = TelemetryEventSchema.parse({
    ts: new Date().toISOString(),
    ...event,
    args: sanitizeArgs(event.args),
  });
  try {
    appendFileSync(p, JSON.stringify(full) + '\n', 'utf-8');
  } catch {
    // Silenciar — telemetría nunca debe romper el flujo del usuario.
  }
}

// ── Read events ─────────────────────────────────────────────────────

export function readTelemetryEvents(): TelemetryEvent[] {
  const p = getTelemetryEventsPath();
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf-8')
    .split('\n')
    .filter(l => l.trim().length > 0)
    .map(l => {
      try {
        return TelemetryEventSchema.parse(JSON.parse(l));
      } catch {
        return null;
      }
    })
    .filter((e): e is TelemetryEvent => e !== null);
}

// ── Stats helpers para `dd-cli telemetry report` ────────────────────

export interface TelemetryStats {
  total_events: number;
  by_command: Record<string, number>;
  by_exit_code: Record<string, number>;
  by_error_code: Record<string, number>;
  avg_duration_ms: number;
  events_per_day: Record<string, number>;
  active_days: number;
  file_size_bytes: number;
  oldest_event: string | null;
  newest_event: string | null;
}

export function computeTelemetryStats(events: TelemetryEvent[]): TelemetryStats {
  const byCmd: Record<string, number> = {};
  const byExit: Record<string, number> = {};
  const byErr: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  let totalDuration = 0;

  for (const e of events) {
    byCmd[e.command] = (byCmd[e.command] ?? 0) + 1;
    byExit[String(e.exit_code)] = (byExit[String(e.exit_code)] ?? 0) + 1;
    if (e.error_code) byErr[e.error_code] = (byErr[e.error_code] ?? 0) + 1;
    const day = e.ts.split('T')[0] ?? '';
    byDay[day] = (byDay[day] ?? 0) + 1;
    totalDuration += e.duration_ms;
  }

  const sorted = [...events].sort((a, b) => a.ts.localeCompare(b.ts));
  const oldest = sorted[0]?.ts ?? null;
  const newest = sorted[sorted.length - 1]?.ts ?? null;

  const p = getTelemetryEventsPath();
  const fileSize = existsSync(p) ? statSync(p).size : 0;

  return {
    total_events: events.length,
    by_command: byCmd,
    by_exit_code: byExit,
    by_error_code: byErr,
    avg_duration_ms: events.length === 0 ? 0 : Math.round(totalDuration / events.length),
    events_per_day: byDay,
    active_days: Object.keys(byDay).length,
    file_size_bytes: fileSize,
    oldest_event: oldest,
    newest_event: newest,
  };
}
