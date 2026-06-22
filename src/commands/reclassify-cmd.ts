/**
 * `dd-cli reclassify --to=<tipo> --reason="<texto>"`
 *
 * Cambia el dev_type después del lock. Solo Tech Lead (en MVP: sin verificación
 * de rol — se delega al usuario final). Genera audit log local.
 *
 * Referencia: dd-cli-spec.md §3.6.1
 */
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import * as path from 'node:path';
import { getProjectRoot, getDevflowDir } from '../utils/paths.js';
import { loadSession, saveSession, SessionIOError } from '../utils/session-io.js';
import { reclassify } from './reclassify.js';
import { enforcementRuleIdsForDevType } from '../enforcement/rules.js';
import { printOk, printWarn, printErr, printDim, bold } from '../utils/output.js';
import { DEV_TYPES, type DevType } from '../types/dev-type.js';

export interface ReclassifyCmdOptions {
  to: string;
  reason: string;
}

const isTTY = process.stdout.isTTY;
const dim = (s: string) => isTTY ? `\x1b[90m${s}\x1b[0m` : s;
const orange = (s: string) => isTTY ? `\x1b[38;5;208m${s}\x1b[0m` : s;

export function runReclassifyCmd(opts: ReclassifyCmdOptions): number {
  if (!DEV_TYPES.includes(opts.to as DevType)) {
    printErr(`--to debe ser uno de: ${DEV_TYPES.join(', ')}`);
    return 2;
  }

  const projectRoot = getProjectRoot();

  let session;
  try {
    session = loadSession(projectRoot);
  } catch (e) {
    if (e instanceof SessionIOError) { printErr(e.message); return 2; }
    throw e;
  }

  if (!session || !session.started_at) {
    printErr('No hay sesión activa para reclassify.');
    return 1;
  }

  // En modo local no verificamos rol (es una decisión del Tech Lead en la APP)
  const result = reclassify({
    session,
    newType: opts.to as DevType,
    reason: opts.reason,
    callerRole: 'tech-lead', // MVP: confiamos en el usuario
  });

  if (!result.ok) {
    switch (result.error) {
      case 'REASON_TOO_SHORT':
        printErr('La justificación necesita al menos 30 caracteres.');
        printDim(`  Escribe una razón más descriptiva del cambio: --reason="<texto>"`);
        break;
      case 'SAME_TYPE':
        printWarn(`El tipo ya es ${session.dev_type}. Nada que cambiar.`);
        break;
      default:
        printErr(result.message);
    }
    return 1;
  }

  const updated = result.updatedSession!;

  // Actualizar enforcement_rules según el nuevo tipo
  updated.enforcement_rules = enforcementRuleIdsForDevType(updated.dev_type!);
  saveSession(projectRoot, updated);

  // Audit log local
  const auditLine = `${new Date().toISOString()}  HDU ${session.feature_id}  ${session.dev_type} → ${updated.dev_type}  reason: ${opts.reason}`;
  try {
    appendFileSync(path.join(getDevflowDir(projectRoot), 'audit.log'), auditLine + '\n', 'utf-8');
  } catch { /* silencioso */ }

  console.log('');
  printOk(`Reclasificación aplicada`);
  console.log(`  ${dim('Anterior:')}  ${orange(`⬢ ${session.dev_type}`)}`);
  console.log(`  ${dim('Nuevo:')}     ⬢ ${updated.dev_type}`);
  console.log(`  ${dim('Razón:')}     ${opts.reason}`);
  console.log('');
  printDim(`Audit log guardado en .devflow/audit.log`);
  printDim(`Nota: en modo platform el Tech Lead confirma este cambio en la APP.`);
  console.log('');
  return 0;
}
