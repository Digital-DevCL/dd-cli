/**
 * `dd-cli start-session <feature-id>` — entrypoint completo (interactivo).
 *
 * En modo local pide:
 *   - feature_name (si no viene como flag)
 *   - dev_type (dropdown 5 tipos)
 *   - subtype opcional
 *   - apps_affected
 *   - rationale
 *   - legacy_system (si dev_type=modernizacion)
 *   - vendor (si dev_type=integracion-externa)
 *
 * Construye SessionState con enforcement_rules y persiste.
 */
import { input, select } from '@inquirer/prompts';
import { getProjectRoot } from '../utils/paths.js';
import { loadSession, saveSession, hasSession, SessionIOError } from '../utils/session-io.js';
import { DEV_TYPES, type DevType } from '../types/dev-type.js';
import { CLI_VERSION } from '../index.js';
import { buildStartSessionState } from './start-session.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold } from '../utils/output.js';

export interface StartSessionCmdOptions {
  featureName?: string;
  type?: string;
  rationale?: string;
  apps?: string;
  yes?: boolean;
}

const DEV_TYPE_DESCRIPTIONS: Record<DevType, string> = {
  'greenfield': 'App o módulo completamente nuevo, sin código previo',
  'brownfield-feature': 'Feature nueva sobre una app existente',
  'brownfield-refactor': 'Mejora técnica sin cambio funcional (deuda, performance)',
  'modernizacion': 'Reemplazo de un sistema legacy con paridad funcional',
  'integracion-externa': 'Conectar con SaaS / API de tercero (webhooks, OAuth, ETL)',
};

export async function runStartSession(
  featureId: string,
  opts: StartSessionCmdOptions = {}
): Promise<number> {
  if (!featureId) {
    printErr('Falta el feature-id. Uso: dd-cli start-session <HDU-id>');
    return 2;
  }

  const projectRoot = getProjectRoot();

  // Si NO existe .devflow/ → init no fue corrido
  if (!hasSession(projectRoot)) {
    printErr(`Este proyecto no tiene .devflow/. Ejecuta primero: dd-cli init`);
    return 2;
  }

  // Si ya hay sesión activa → advertir
  let existing;
  try {
    existing = loadSession(projectRoot);
  } catch (e) {
    if (e instanceof SessionIOError) {
      printErr(e.message);
      return 2;
    }
    throw e;
  }

  if (existing && existing.started_at && !existing.ended_at) {
    printWarn(`Ya tienes una sesión activa: ${existing.feature_id ?? '?'}`);
    printInfo(`Cierra la anterior con: dd-cli end-session`);
    printInfo(`O retoma con: /resume-session (dentro de Claude Code)`);
    return 1;
  }

  // ── Entrevista interactiva ───────────────────────────────
  console.log(bold(`\nNueva sesión — ${featureId}\n`));

  const useInteractive = !opts.yes && process.stdout.isTTY;

  let featureName: string;
  let devType: DevType;
  let subtype: string;
  let appsAffectedRaw: string;
  let rationale: string;
  let legacySystem: string | undefined;
  let vendorName: string | undefined;
  let vendorApiVersion: string | undefined;

  if (useInteractive) {
    featureName = await input({
      message: 'Nombre de la feature:',
      default: opts.featureName,
      validate: (v: string) => v.trim().length > 0 || 'Requerido',
    });

    devType = await select<DevType>({
      message: 'Tipo de desarrollo:',
      choices: DEV_TYPES.map((t) => ({
        name: `${t.padEnd(22)}  ${DEV_TYPE_DESCRIPTIONS[t]}`,
        value: t,
      })),
      default: (opts.type as DevType) ?? 'brownfield-feature',
    });

    subtype = await input({
      message: 'Subtipo (opcional, ≤40 chars):',
      default: '',
      validate: (v: string) => v.length <= 40 || 'Máximo 40 caracteres',
    });

    appsAffectedRaw = await input({
      message: 'Apps afectadas (separadas por coma):',
      default: opts.apps ?? '',
    });

    rationale = await input({
      message: 'Justificación corta (≤300 chars):',
      default: opts.rationale,
      validate: (v: string) => {
        if (v.trim().length < 10) {
          return 'Mínimo 10 caracteres — ayuda al equipo entender por qué este tipo';
        }
        if (v.length > 300) return 'Máximo 300 caracteres';
        return true;
      },
    });

    if (devType === 'modernizacion') {
      legacySystem = await input({
        message: 'Sistema legacy a reemplazar:',
        validate: (v: string) => v.trim().length > 0 || 'Requerido para modernización',
      });
    }

    if (devType === 'integracion-externa') {
      vendorName = await input({
        message: 'Vendor (ej: TOKU, Stripe, Auth0):',
        validate: (v: string) => v.trim().length > 0 || 'Requerido para integración externa',
      });
      vendorApiVersion = await input({
        message: 'Versión de API del vendor:',
        validate: (v: string) => v.trim().length > 0 || 'Requerido para integración externa',
      });
    }
  } else {
    // Modo no-interactivo: usar flags
    if (!opts.featureName || !opts.type || !opts.rationale) {
      printErr(
        `Modo no-interactivo: faltan flags. Requeridos: --feature-name, --type, --rationale`
      );
      return 2;
    }
    if (!DEV_TYPES.includes(opts.type as DevType)) {
      printErr(`--type debe ser uno de: ${DEV_TYPES.join(', ')}`);
      return 2;
    }
    featureName = opts.featureName;
    devType = opts.type as DevType;
    subtype = '';
    appsAffectedRaw = opts.apps ?? '';
    rationale = opts.rationale;
  }

  // ── Construir SessionState ───────────────────────────────
  const appsArray = appsAffectedRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const vendor =
    devType === 'integracion-externa' && vendorName
      ? {
          name: vendorName.trim(),
          api_version: (vendorApiVersion ?? '').trim(),
        }
      : undefined;

  const { session, warnings } = buildStartSessionState(
    {
      featureId,
      featureName,
      mode: 'local',
      devType,
      devTypeSubtype: subtype || undefined,
      devTypeRationale: rationale,
      appsAffected: appsArray,
      legacySystem,
      vendor,
    },
    CLI_VERSION
  );

  saveSession(projectRoot, session);

  for (const w of warnings) printWarn(w);

  // ── Output al dev ────────────────────────────────────────
  console.log('');
  printOk(`Sesión iniciada`);
  console.log(`  ${labelPad('Feature:')}  ${session.feature_id} · ${session.feature_name}`);
  console.log(`  ${labelPad('Tipo:')}     ⬢ ${session.dev_type}  ${dimColor(`(fuente: ${session.dev_type_source})`)}`);
  console.log(`  ${labelPad('Modo:')}     ${session.mode}`);
  if (session.legacy_system) {
    console.log(`  ${labelPad('Legacy:')}   ${session.legacy_system}`);
  }
  if (session.vendor) {
    console.log(`  ${labelPad('Vendor:')}   ${session.vendor.name} v${session.vendor.api_version}`);
  }
  if (session.apps_affected.length > 0) {
    console.log(`  ${labelPad('Apps:')}     ${session.apps_affected.join(', ')}`);
  }

  console.log('');
  printInfo(`Próximo paso: ejecuta ${bold('dd-cli next')} para ver qué viene`);
  printDim(`(o levanta la barra de estado en otro pane: dd-cli watch)`);

  return 0;
}

function labelPad(s: string): string {
  return s.padEnd(10);
}

function dimColor(s: string): string {
  return process.stdout.isTTY ? `\x1b[90m${s}\x1b[0m` : s;
}
