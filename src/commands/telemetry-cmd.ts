/**
 * `dd-cli telemetry {enable|disable|status|report|purge}` (S7-1 / R-5).
 *
 * Default OFF. Solo escribe local. Nunca envía datos a un servidor.
 */
import { existsSync, statSync, unlinkSync } from 'node:fs';
import { confirm } from '@inquirer/prompts';
import {
  loadTelemetryConfig, saveTelemetryConfig,
  readTelemetryEvents, computeTelemetryStats,
  getTelemetryConfigPath, getTelemetryEventsPath,
  TelemetryConfigSchema,
} from '../utils/telemetry.js';
import { isJsonMode, emitJson, jsonSuccess, jsonError, type JsonModeOpts } from '../utils/json-output.js';
import { printOk, printErr, printInfo, printDim, bold } from '../utils/output.js';

const isTTY = process.stdout.isTTY;

export interface TelemetryEnableOpts extends JsonModeOpts {
  local?: boolean;       // requerido — confirma scope local explícito
}

export async function runTelemetryEnable(opts: TelemetryEnableOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);

  if (!opts.local) {
    const e = {
      code: 'INVALID_INPUT' as const,
      message: 'Telemetría requiere flag explícito --local para confirmar que NO se enviará a ningún servidor.',
      recovery_hints: [
        'dd-cli telemetry enable --local',
        'La telemetría es 100% local. Vive en ~/.devflow/telemetry.jsonl',
      ],
    };
    if (jsonMode) emitJson(jsonError({ command: 'telemetry enable', ...e }));
    printErr(e.message);
    return 3;
  }

  saveTelemetryConfig(TelemetryConfigSchema.parse({
    enabled: true,
    scope: 'local',
    enabled_at: new Date().toISOString(),
  }));

  if (jsonMode) {
    emitJson(jsonSuccess('telemetry enable', { enabled: true, scope: 'local' }));
  }

  printOk('Telemetría local habilitada.');
  printDim(`  Eventos en: ${getTelemetryEventsPath()}`);
  printDim(`  Config en:  ${getTelemetryConfigPath()}`);
  console.log('');
  printInfo('Para desactivar: dd-cli telemetry disable');
  printInfo('Para ver el reporte: dd-cli telemetry report');
  return 0;
}

export async function runTelemetryDisable(opts: JsonModeOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);
  saveTelemetryConfig(TelemetryConfigSchema.parse({
    enabled: false,
    scope: 'local',
    enabled_at: null,
  }));

  if (jsonMode) {
    emitJson(jsonSuccess('telemetry disable', { enabled: false }));
  }
  printOk('Telemetría deshabilitada. Los eventos existentes se preservan.');
  printDim('  Para borrarlos: dd-cli telemetry purge');
  return 0;
}

export async function runTelemetryStatus(opts: JsonModeOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);
  const config = loadTelemetryConfig();
  const eventsPath = getTelemetryEventsPath();
  const eventsExists = existsSync(eventsPath);
  const fileSize = eventsExists ? statSync(eventsPath).size : 0;
  const events = eventsExists ? readTelemetryEvents() : [];

  if (jsonMode) {
    emitJson(jsonSuccess('telemetry status', {
      enabled: config.enabled,
      scope: config.scope,
      enabled_at: config.enabled_at,
      total_events: events.length,
      file_size_bytes: fileSize,
      events_path: eventsPath,
    }));
  }

  console.log('');
  console.log(bold('  Telemetría'));
  console.log(`    estado:    ${config.enabled ? '🟢 habilitada' : '⚪ deshabilitada'}`);
  console.log(`    scope:     ${config.scope}`);
  if (config.enabled_at) console.log(`    desde:     ${config.enabled_at}`);
  console.log(`    eventos:   ${events.length}`);
  console.log(`    archivo:   ${fileSize > 0 ? `${(fileSize / 1024).toFixed(1)} KB` : '(vacío)'}`);
  console.log('');
  if (!config.enabled) {
    printDim('  Para habilitar: dd-cli telemetry enable --local');
  }
  return 0;
}

export interface TelemetryReportOpts extends JsonModeOpts {
  period?: string;             // '30d' | 'all'
}

export async function runTelemetryReport(opts: TelemetryReportOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);
  const events = readTelemetryEvents();

  // Filtrar por período
  const periodStr = opts.period ?? '30d';
  let filtered = events;
  if (periodStr !== 'all') {
    const match = periodStr.match(/^(\d+)d$/);
    if (!match) {
      const e = { code: 'INVALID_INPUT' as const, message: `--period=${periodStr} inválido. Usá Nd o 'all'.` };
      if (jsonMode) emitJson(jsonError({ command: 'telemetry report', ...e }));
      printErr(e.message);
      return 3;
    }
    const cutoff = Date.now() - Number(match[1]) * 86_400_000;
    filtered = events.filter(e => new Date(e.ts).getTime() >= cutoff);
  }

  const stats = computeTelemetryStats(filtered);

  if (jsonMode) {
    emitJson(jsonSuccess('telemetry report', {
      period: periodStr,
      ...stats,
    }));
  }

  console.log('');
  console.log(bold(`  Reporte de telemetría (${periodStr})`));
  console.log('');
  if (stats.total_events === 0) {
    printDim('  No hay eventos en el período.');
    printDim('  ¿La telemetría está activa? dd-cli telemetry status');
    return 0;
  }

  console.log(`  Eventos totales:   ${stats.total_events}`);
  console.log(`  Días activos:      ${stats.active_days}`);
  console.log(`  Avg duration:      ${stats.avg_duration_ms} ms`);
  console.log(`  Archivo:           ${(stats.file_size_bytes / 1024).toFixed(1)} KB`);
  console.log('');

  console.log(bold('  Por comando'));
  const sortedCmds = Object.entries(stats.by_command).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [cmd, count] of sortedCmds) {
    console.log(`    ${cmd.padEnd(28)} ${count}`);
  }
  if (Object.keys(stats.by_command).length > 10) {
    printDim(`    ... y ${Object.keys(stats.by_command).length - 10} comandos más`);
  }
  console.log('');

  console.log(bold('  Por exit code'));
  for (const [code, count] of Object.entries(stats.by_exit_code).sort()) {
    console.log(`    exit ${code}: ${count}`);
  }
  console.log('');

  if (Object.keys(stats.by_error_code).length > 0) {
    console.log(bold('  Errores por código (top 10)'));
    const sortedErrs = Object.entries(stats.by_error_code).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [code, count] of sortedErrs) {
      console.log(`    ${code.padEnd(28)} ${count}`);
    }
    console.log('');
  }

  return 0;
}

export interface TelemetryPurgeOpts extends JsonModeOpts {
  yes?: boolean;
}

export async function runTelemetryPurge(opts: TelemetryPurgeOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);
  const p = getTelemetryEventsPath();
  if (!existsSync(p)) {
    if (jsonMode) emitJson(jsonSuccess('telemetry purge', { purged: false, reason: 'no events file' }));
    printDim('No hay archivo de eventos para borrar.');
    return 0;
  }

  if (!opts.yes && isTTY) {
    const confirmed = await confirm({
      message: `Borrar todos los eventos de telemetría en ${p}?`,
      default: false,
    });
    if (!confirmed) {
      printDim('Cancelado.');
      return 0;
    }
  } else if (!opts.yes && !isTTY) {
    const e = { code: 'INVALID_INPUT' as const, message: 'En modo no interactivo, --yes es obligatorio.' };
    if (jsonMode) emitJson(jsonError({ command: 'telemetry purge', ...e }));
    printErr(e.message);
    return 3;
  }

  const sizeBefore = statSync(p).size;
  unlinkSync(p);

  if (jsonMode) {
    emitJson(jsonSuccess('telemetry purge', { purged: true, bytes_freed: sizeBefore }));
  }
  printOk(`Eventos de telemetría borrados (${(sizeBefore / 1024).toFixed(1)} KB liberados).`);
  return 0;
}
