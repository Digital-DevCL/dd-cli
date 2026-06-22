/**
 * Lectura/escritura validada de .devflow/session.json
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { SessionStateSchema, type SessionState } from '../types/session.js';
import { getSessionPath, getDevflowDir } from './paths.js';

export class SessionIOError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'SessionIOError';
  }
}

/**
 * Lee y valida session.json. Devuelve null si no existe.
 * Lanza SessionIOError si el archivo existe pero es inválido.
 */
export function loadSession(projectRoot: string): SessionState | null {
  const sessionPath = getSessionPath(projectRoot);
  if (!existsSync(sessionPath)) return null;

  let rawContent: string;
  try {
    rawContent = readFileSync(sessionPath, 'utf-8');
  } catch (err) {
    throw new SessionIOError(`No se pudo leer ${sessionPath}`, err);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    throw new SessionIOError(`session.json no es JSON válido`, err);
  }

  const result = SessionStateSchema.safeParse(parsed);
  if (!result.success) {
    throw new SessionIOError(
      `session.json no cumple el schema (v2):\n${result.error.message}`,
      result.error
    );
  }
  return result.data;
}

/**
 * Persiste session.json. Crea .devflow/ si no existe.
 */
export function saveSession(projectRoot: string, session: SessionState): void {
  const devflowDir = getDevflowDir(projectRoot);
  if (!existsSync(devflowDir)) {
    mkdirSync(devflowDir, { recursive: true });
  }
  const sessionPath = getSessionPath(projectRoot);

  // Validar antes de escribir para no dejar archivos corruptos
  const result = SessionStateSchema.safeParse(session);
  if (!result.success) {
    throw new SessionIOError(
      `No se puede guardar session — no cumple schema:\n${result.error.message}`,
      result.error
    );
  }

  writeFileSync(sessionPath, JSON.stringify(result.data, null, 2) + '\n', 'utf-8');
}

/**
 * Devuelve true si .devflow/session.json existe.
 */
export function hasSession(projectRoot: string): boolean {
  return existsSync(getSessionPath(projectRoot));
}
