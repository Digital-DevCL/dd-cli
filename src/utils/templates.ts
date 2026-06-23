/**
 * Helpers de renderizado de templates `.template` bundleados con el CLI.
 *
 * Convención: reemplaza `{{VAR}}` por valores literales. Sin lógica condicional.
 * Si necesitas branching, usa varios templates o resuélvelo en el caller.
 */
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resuelve dónde están los templates bundleados.
 * Misma estrategia que skills (resolveSkillsSourceDir): primero el paquete
 * instalado, luego el monorepo en desarrollo.
 */
export function resolveTemplatesDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));

  // dist/utils/templates.js → ../../templates (paquete en producción)
  const bundled = path.resolve(here, '..', '..', 'templates');
  if (existsSync(bundled)) return bundled;

  // dist/utils/templates.js → ../../../templates (modo dev monorepo)
  const monorepo = path.resolve(here, '..', '..', '..', 'templates');
  if (existsSync(monorepo)) return monorepo;

  return null;
}

export function getTemplatePath(name: string): string | null {
  const dir = resolveTemplatesDir();
  if (!dir) return null;
  const full = path.join(dir, name);
  return existsSync(full) ? full : null;
}

/**
 * Lee un template y reemplaza todas las `{{VAR}}` por los valores dados.
 * Variables no provistas se dejan tal cual (útil para que el dev pueda
 * detectar placeholders sin completar).
 */
export function renderTemplate(templatePath: string, vars: Record<string, string>): string {
  let content = readFileSync(templatePath, 'utf-8');
  for (const [key, value] of Object.entries(vars)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }
  return content;
}
