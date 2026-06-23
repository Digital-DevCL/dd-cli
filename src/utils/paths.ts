/**
 * Utilidades de paths del proyecto y de la instalación global de Claude Code.
 */
import { existsSync, statSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Detecta el root del proyecto actual.
 * Estrategia: buscar `.devflow/` ascendiendo, o si no existe, buscar `package.json` / `.git`.
 */
export function getProjectRoot(startDir: string = process.cwd()): string {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (current !== root) {
    if (existsSync(path.join(current, '.devflow'))) {
      return current;
    }
    current = path.dirname(current);
  }

  // Si no encontró .devflow/, devuelve cwd (sesión nueva)
  return path.resolve(startDir);
}

/**
 * Busca `.devflow/session.json` ascendiendo desde `startDir` y retorna el root.
 * NO confunde con `~/.devflow/` (config global del CLI), ya que solo se considera
 * "proyecto DevFlow" si tiene `session.json`.
 *
 * Retorna null si no hay proyecto DevFlow en la jerarquía.
 *
 * Útil para statusline + install (debemos saber si estamos REALMENTE dentro de un
 * proyecto DevFlow o en un repo cualquiera).
 */
export function findDevFlowProjectRoot(startDir: string = process.cwd()): string | null {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;
  const home = path.resolve(os.homedir());

  while (current !== root) {
    // Excluir el home dir — `~/.devflow/` es config global, no un proyecto.
    if (current !== home) {
      const sessionFile = path.join(current, '.devflow', 'session.json');
      if (existsSync(sessionFile)) {
        return current;
      }
    }
    current = path.dirname(current);
  }
  return null;
}

/**
 * `true` si el path indicado (o cwd por default) está dentro de un proyecto DevFlow IA.
 */
export function isDevFlowProject(startDir: string = process.cwd()): boolean {
  return findDevFlowProjectRoot(startDir) !== null;
}

/**
 * Path del settings.json GLOBAL de Claude Code (~/.claude/settings.json).
 */
export function getClaudeGlobalSettingsPath(): string {
  return path.join(getClaudeHome(), 'settings.json');
}

export function getSessionPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'session.json');
}

export function getDevflowDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow');
}

export function getHeartbeatLogPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'heartbeat.log');
}

/**
 * Path donde Claude Code lee skills y settings.
 */
export function getClaudeHome(): string {
  return path.join(os.homedir(), '.claude');
}

export function getClaudeSkillsDir(): string {
  // Claude Code lee slash commands desde ~/.claude/commands/
  // El subdirectorio devflow-ia agrupa las skills del método
  return path.join(getClaudeHome(), 'commands', 'devflow-ia');
}

export function getClaudeCommandsDir(): string {
  return path.join(getClaudeHome(), 'commands');
}

export function getProjectClaudeDir(projectRoot: string): string {
  return path.join(projectRoot, '.claude');
}

export function getProjectClaudeSettingsPath(projectRoot: string): string {
  return path.join(projectRoot, '.claude', 'settings.json');
}

/**
 * Verifica que Claude Code esté instalado (existe `~/.claude/`).
 */
export function isClaudeCodeInstalled(): boolean {
  const dir = getClaudeHome();
  return existsSync(dir) && statSync(dir).isDirectory();
}
