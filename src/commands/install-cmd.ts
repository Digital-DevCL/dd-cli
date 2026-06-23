/**
 * `dd-cli install` — configura la statusline DevFlow IA globalmente en Claude Code.
 *
 * Edita `~/.claude/settings.json` agregando:
 *   "statusLine": { "type": "command", "command": "dd-cli statusline" }
 *
 * La statusline está diseñada para ser inteligente según contexto:
 *   - Fuera de proyecto DevFlow → branding minimal "DevFlow IA · vX.Y.Z ready"
 *   - Dentro de proyecto sin sesión → "DevFlow IA · sin sesión · ..."
 *   - Sesión activa → info completa (HDU, paso N/M, tiempo, dev_type)
 *
 * Por eso es seguro instalarla globalmente.
 *
 * Flags:
 *   --force   Sobrescribe statusLine existente
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  getClaudeHome,
  getClaudeGlobalSettingsPath,
  isClaudeCodeInstalled,
} from '../utils/paths.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold } from '../utils/output.js';

export interface InstallOptions {
  force?: boolean;
}

const STATUSLINE_COMMAND = 'dd-cli statusline';

function readGlobalSettings(): Record<string, unknown> {
  const settingsPath = getClaudeGlobalSettingsPath();
  if (!existsSync(settingsPath)) return {};
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    throw new Error(
      `${settingsPath} existe pero no es JSON válido. Corrígelo manualmente o usa --force.`
    );
  }
}

function writeGlobalSettings(settings: Record<string, unknown>): void {
  const settingsPath = getClaudeGlobalSettingsPath();
  const dir = path.dirname(settingsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

export async function runInstall(opts: InstallOptions = {}): Promise<number> {
  console.log(bold('\nDevFlow IA — install (global)\n'));

  if (!isClaudeCodeInstalled()) {
    printErr(`Claude Code no detectado en ${getClaudeHome()}`);
    printInfo('Instala Claude Code primero: https://claude.com/claude-code');
    return 2;
  }

  let settings: Record<string, unknown>;
  try {
    settings = readGlobalSettings();
  } catch (e) {
    if (!opts.force) {
      printErr(e instanceof Error ? e.message : String(e));
      return 2;
    }
    settings = {};
  }

  const existing = settings.statusLine as
    | { type?: string; command?: string }
    | undefined;
  const alreadyOurs =
    existing?.type === 'command' && existing.command === STATUSLINE_COMMAND;

  if (alreadyOurs && !opts.force) {
    printInfo('La statusline DevFlow IA ya está instalada globalmente.');
    printDim(`  ${getClaudeGlobalSettingsPath()}`);
    return 0;
  }

  if (existing && !alreadyOurs && !opts.force) {
    printWarn('Ya hay una statusLine configurada en tu settings.json global:');
    printDim(`  ${JSON.stringify(existing)}`);
    printInfo('Usa --force para reemplazarla con la de DevFlow IA.');
    return 1;
  }

  settings.statusLine = {
    type: 'command',
    command: STATUSLINE_COMMAND,
  };

  writeGlobalSettings(settings);

  printOk('Statusline DevFlow IA instalada globalmente.');
  printDim(`  ${getClaudeGlobalSettingsPath()}`);
  console.log('');
  printInfo('Reinicia Claude Code para verla. Comportamiento por contexto:');
  printDim('  · Fuera de un proyecto DevFlow → "DevFlow IA · vX.Y.Z ready"');
  printDim('  · Proyecto sin sesión          → "DevFlow IA · sin sesión · ..."');
  printDim('  · Sesión activa                → "HDU-X · paso N/M: ... · Tm  ⬢ tipo"');
  return 0;
}

export async function runUninstall(): Promise<number> {
  console.log(bold('\nDevFlow IA — uninstall (global)\n'));

  if (!existsSync(getClaudeGlobalSettingsPath())) {
    printInfo('No hay settings.json global; nada que desinstalar.');
    return 0;
  }

  let settings: Record<string, unknown>;
  try {
    settings = readGlobalSettings();
  } catch (e) {
    printErr(e instanceof Error ? e.message : String(e));
    return 2;
  }

  const existing = settings.statusLine as
    | { type?: string; command?: string }
    | undefined;
  const isOurs =
    existing?.type === 'command' && existing.command === STATUSLINE_COMMAND;

  if (!isOurs) {
    printInfo('La statusline global no pertenece a DevFlow IA — no la toco.');
    if (existing) printDim(`  Actual: ${JSON.stringify(existing)}`);
    return 0;
  }

  delete settings.statusLine;
  writeGlobalSettings(settings);
  printOk('Statusline DevFlow IA removida de tu settings.json global.');
  return 0;
}
