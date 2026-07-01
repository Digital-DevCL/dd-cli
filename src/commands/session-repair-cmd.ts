/**
 * `dd-cli session repair` — repara `.devflow/session.json` cuando no cumple el schema.
 *
 * Sin esto, un `session.json` inválido bricka el CLI entero: 14 comandos
 * (start-session, status, next, watch, statusline, doctor, end-session...)
 * llaman `loadSession()` y todos lanzan la misma excepción cruda.
 *
 * Cobertura intencionalmente acotada al patrón real observado en pruebas
 * (edición manual de `dev_type_source` fuera del enum, ej. tras un reclassify
 * hecho a mano). Otros issues del schema se reportan pero no se auto-reparan.
 */
import { confirm } from '@inquirer/prompts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SessionStateSchema } from '../types/session.js';
import { getSessionPath } from '../utils/paths.js';
import { getProjectRoot } from '../utils/paths.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold } from '../utils/output.js';

export interface SessionRepairCmdOptions {
  yes?: boolean;
}

export async function runSessionRepairCmd(
  opts: SessionRepairCmdOptions = {}
): Promise<number> {
  const projectRoot = getProjectRoot();
  const sessionPath = getSessionPath(projectRoot);

  if (!existsSync(sessionPath)) {
    printErr(`No existe ${sessionPath}. No hay nada que reparar.`);
    return 2;
  }

  let rawContent: string;
  try {
    rawContent = readFileSync(sessionPath, 'utf-8');
  } catch (e) {
    printErr(`No se pudo leer ${sessionPath}: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    printErr(`${sessionPath} no es JSON válido — no se puede auto-reparar.`);
    printDim(`  Restaurá desde un backup o corré: dd-cli start-session <HDU-id> (recrea desde cero)`);
    return 2;
  }

  const initialResult = SessionStateSchema.safeParse(parsed);
  if (initialResult.success) {
    printOk(`${sessionPath} ya cumple el schema. Nada que reparar.`);
    return 0;
  }

  console.log(bold(`\nsession.json no cumple el schema — diagnosticando...\n`));

  const raw = parsed as Record<string, unknown>;
  const patched: Record<string, unknown> = { ...raw };
  const applied: { field: string; before: unknown; after: unknown }[] = [];
  const unrepairable: string[] = [];

  for (const issue of initialResult.error.issues) {
    const field = issue.path.join('.');

    if (field === 'dev_type_source' && issue.code === 'invalid_enum_value') {
      const before = raw.dev_type_source;
      const after = raw.dev_type_locked === true ? 'reclassify' : 'business-brief';
      patched.dev_type_source = after;
      applied.push({ field, before, after });
      continue;
    }

    unrepairable.push(`  ✗ ${field || '(raíz)'}: ${issue.message}`);
  }

  if (applied.length === 0) {
    printErr(`No hay reparación automática conocida para estos errores:`);
    for (const line of unrepairable) console.log(line);
    printDim(`  Corregí ${sessionPath} a mano o volvé a iniciar sesión con: dd-cli start-session <HDU-id>`);
    return 1;
  }

  const finalResult = SessionStateSchema.safeParse(patched);

  console.log(`Cambios propuestos:`);
  for (const c of applied) {
    console.log(`  ${c.field}:  ${bold(String(c.before))}  →  ${bold(String(c.after))}`);
  }

  if (!finalResult.success) {
    console.log('');
    printWarn(`Estos cambios no bastan — quedan errores sin reparación automática:`);
    for (const line of unrepairable) console.log(line);
    printDim(`  Corregí el resto a mano en ${sessionPath}`);
    return 1;
  }

  if (unrepairable.length > 0) {
    console.log('');
    printWarn(`Hay otros errores que esta reparación no toca:`);
    for (const line of unrepairable) console.log(line);
  }

  if (!opts.yes) {
    console.log('');
    const proceed = await confirm({
      message: `¿Aplicar estos cambios a ${sessionPath}?`,
      default: true,
    });
    if (!proceed) {
      printInfo('Reparación cancelada.');
      return 1;
    }
  }

  const backupPath = `${sessionPath}.bak`;
  writeFileSync(backupPath, rawContent, 'utf-8');
  writeFileSync(sessionPath, JSON.stringify(finalResult.data, null, 2) + '\n', 'utf-8');

  console.log('');
  printOk(`session.json reparado`);
  printDim(`  Backup del original en ${backupPath}`);
  return 0;
}
