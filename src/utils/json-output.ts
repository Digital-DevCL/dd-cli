/**
 * Contrato JSON estructurado del CLI (S1-9, D-7 Parte 3, D-8 Parte 3).
 *
 * Toda salida `--json` o con env `DEVFLOW_CLAUDE_MODE=1` cumple este shape.
 * Lo consumen:
 *   - Las skills (vía Claude leyendo el JSON entre invocaciones).
 *   - CI / scripts / power users.
 *   - Tests E2E.
 *
 * Diseño:
 *   - `cli_version` permite a la skill saber con qué versión está hablando.
 *   - `code` (en errores) es estable; ver `error-codes.ts`.
 *   - `recovery_hints` están en español y siempre incluyen un comando concreto.
 *   - `next_safe_command` sugiere el siguiente paso seguro (puede ser null si terminó).
 */
import type { ErrorCode } from './error-codes.js';
import { exitCodeFor } from './error-codes.js';
import { CLI_VERSION } from '../index.js';

export interface JsonSuccess<T = unknown> {
  status: 'success';
  command: string;
  cli_version: string;
  data: T;
  next_safe_command?: string | null;
}

export interface JsonError {
  status: 'error';
  command: string;
  cli_version: string;
  code: ErrorCode;
  message: string;
  context?: Record<string, unknown>;
  recovery_hints?: string[];
  next_safe_command?: string | null;
}

export type JsonOutput<T = unknown> = JsonSuccess<T> | JsonError;

export interface JsonModeOpts {
  json?: boolean;
}

/**
 * Detecta si el comando debe emitir JSON estructurado.
 * Triggers: flag `--json` (explícito) o env `DEVFLOW_CLAUDE_MODE=1` (Claude lo setea).
 */
export function isJsonMode(opts?: JsonModeOpts): boolean {
  if (opts?.json) return true;
  if (process.env.DEVFLOW_CLAUDE_MODE === '1') return true;
  return false;
}

/**
 * Emite output JSON y termina con exit code apropiado.
 * Para éxito: exit 0. Para error: exit code según `exitCodeFor(code)`.
 *
 * No retorna — termina el proceso. Si se necesita lógica post-output,
 * usar `formatJson` directamente.
 */
export function emitJson<T>(output: JsonOutput<T>): never {
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  const code = output.status === 'success' ? 0 : exitCodeFor(output.code);
  process.exit(code);
}

/**
 * Variante que sólo formatea, sin terminar el proceso.
 * Útil para tests o cuando hay limpieza pendiente.
 */
export function formatJson<T>(output: JsonOutput<T>): string {
  return JSON.stringify(output, null, 2);
}

// ── Builders convenientes ────────────────────────────────────────────

export function jsonSuccess<T>(
  command: string,
  data: T,
  nextSafeCommand?: string | null
): JsonSuccess<T> {
  return {
    status: 'success',
    command,
    cli_version: CLI_VERSION,
    data,
    ...(nextSafeCommand !== undefined ? { next_safe_command: nextSafeCommand } : {}),
  };
}

export function jsonError(opts: {
  command: string;
  code: ErrorCode;
  message: string;
  context?: Record<string, unknown>;
  recovery_hints?: string[];
  next_safe_command?: string | null;
}): JsonError {
  return {
    status: 'error',
    command: opts.command,
    cli_version: CLI_VERSION,
    code: opts.code,
    message: opts.message,
    ...(opts.context ? { context: opts.context } : {}),
    ...(opts.recovery_hints ? { recovery_hints: opts.recovery_hints } : {}),
    ...(opts.next_safe_command !== undefined ? { next_safe_command: opts.next_safe_command } : {}),
  };
}
