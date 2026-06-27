/**
 * Registro global de sesiones activas en ~/.devflow/active-sessions.json
 *
 * Permite detectar sesiones unclosed en proyectos distintos al actual (S-01/S-02).
 * Liviano: solo escribe al inicio/cierre de sesión; nunca pollea red.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { getDevflowGlobalDir } from '../types/registry.js';

export interface GlobalSessionEntry {
  project_root: string;
  feature_id: string;
  client?: string;
  started_at: string;
  ended_at?: string;
}

function getPath(): string {
  return path.join(getDevflowGlobalDir(), 'active-sessions.json');
}

function read(): Record<string, GlobalSessionEntry> {
  const p = getPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, GlobalSessionEntry>;
  } catch {
    return {};
  }
}

function write(data: Record<string, GlobalSessionEntry>): void {
  const dir = getDevflowGlobalDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getPath(), JSON.stringify(data, null, 2), 'utf-8');
}

export function registerGlobalSession(
  projectRoot: string,
  featureId: string,
  startedAt: string,
  client?: string
): void {
  const sessions = read();
  sessions[projectRoot] = { project_root: projectRoot, feature_id: featureId, started_at: startedAt, client };
  write(sessions);
}

export function closeGlobalSession(projectRoot: string): void {
  const sessions = read();
  if (sessions[projectRoot]) {
    sessions[projectRoot]!.ended_at = new Date().toISOString();
    write(sessions);
  }
}

/** Devuelve sesiones abiertas en proyectos distintos al CWD dado. */
export function getUnclosedSessionsElsewhere(currentProjectRoot: string): GlobalSessionEntry[] {
  const sessions = read();
  return Object.values(sessions).filter(
    s => s.project_root !== currentProjectRoot && !s.ended_at
  );
}
