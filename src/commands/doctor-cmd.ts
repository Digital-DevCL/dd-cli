/**
 * `dd-cli doctor [--for=<tipo>]`
 *
 * Valida que el entorno esté configurado y que las precondiciones
 * del dev_type activo (o del tipo indicado) se cumplan.
 *
 * Usa mensajes humanos — no jerga técnica de enforcement rules.
 */
import { existsSync } from 'node:fs';
import { getProjectRoot, getClaudeHome, getClaudeSkillsDir, isClaudeCodeInstalled } from '../utils/paths.js';
import { loadSession, SessionIOError } from '../utils/session-io.js';
import { doctor } from './doctor.js';
import { DEV_TYPES, type DevType } from '../types/dev-type.js';
import { printOk, printWarn, printErr, printDim, bold } from '../utils/output.js';

export interface DoctorCmdOptions {
  forType?: string;
}

const isTTY = process.stdout.isTTY;
const dim   = (s: string) => isTTY ? `\x1b[90m${s}\x1b[0m` : s;
const green = (s: string) => isTTY ? `\x1b[32m${s}\x1b[0m` : s;

export function runDoctorCmd(opts: DoctorCmdOptions = {}): number {
  const projectRoot = getProjectRoot();

  console.log(`\n${bold('Diagnóstico del entorno DevFlow IA')}\n`);

  // Sistema
  console.log(`${dim('Sistema:')}`);
  if (isClaudeCodeInstalled()) {
    printOk(`Claude Code detectado en ${getClaudeHome()}`);
  } else {
    printErr(`Claude Code no encontrado en ${getClaudeHome()}`);
    printDim(`  Instala Claude Code: https://claude.com/claude-code`);
  }

  const skillsDir = getClaudeSkillsDir();
  if (existsSync(skillsDir)) {
    printOk(`Skills instaladas en ${skillsDir}`);
  } else {
    printWarn(`Skills no instaladas`);
    printDim(`  Ejecuta: dd-cli init`);
  }

  const settingsPath = `${projectRoot}/.claude/settings.json`;
  if (existsSync(settingsPath)) {
    printOk(`.claude/settings.json con hooks presente`);
  } else {
    printWarn(`.claude/settings.json no encontrado`);
    printDim(`  Ejecuta: dd-cli init`);
  }

  // Sesión
  console.log('');
  console.log(`${dim('Proyecto:')}`);

  let session;
  try {
    session = loadSession(projectRoot);
  } catch (e) {
    if (e instanceof SessionIOError) {
      printErr(e.message);
      return 2;
    }
    throw e;
  }

  if (!session || !session.started_at) {
    printWarn(`Sin sesión activa`);
    printDim(`  Ejecuta: dd-cli start-session <HDU-id>`);
  } else {
    printOk(`Sesión activa: ${session.feature_id} · ${session.dev_type ?? '?'}`);
  }

  // Precondiciones del tipo
  const targetType = opts.forType ?? session?.dev_type ?? null;

  if (targetType) {
    if (!DEV_TYPES.includes(targetType as DevType)) {
      printErr(`--for debe ser uno de: ${DEV_TYPES.join(', ')}`);
      return 2;
    }

    console.log('');
    const label = opts.forType ? `Precondiciones para ${targetType}` : `Precondiciones del tipo activo (${targetType})`;
    console.log(`${dim(label + ':')}`);

    const result = doctor({
      projectRoot,
      session: session ?? {
        feature_id: null, feature_name: null, session_id: 'doctor',
        started_at: new Date().toISOString(), ended_at: null, last_heartbeat: null,
        mode: 'local', platform_url: null, unclosed: false,
        dev_type: targetType as DevType, dev_type_subtype: null,
        dev_type_source: 'business-brief', dev_type_rationale: '',
        dev_type_locked: false, dev_type_locked_at: null,
        apps_affected: [], repo_context_path: null, baseline_path: null,
        legacy_system: null, vendor: null,
        enforcement_rules: [], flow_state: 'started', active_change: null,
        tasks: [], blockers: [], rag_context_snapshot: null, anomalies: [],
        cli_version: '0.2.0', schema_version: 2,
      },
      forType: targetType as DevType,
    });

    // Mostrar resultados con mensajes humanos
    for (const line of result.text.split('\n').slice(1)) {
      if (line.includes('✓')) {
        console.log(`  ${green('✓')} ${line.replace(/\s*✓\s*/,'').trim()}`);
      } else if (line.includes('✗')) {
        const msg = line.replace(/\s*✗\s*/, '').trim();
        console.log(`  ${isTTY ? '\x1b[31m✗\x1b[0m' : '✗'} ${humanizeRuleId(msg)}`);
      }
    }

    if (result.exitCode === 0) {
      console.log('');
      printOk(`Todas las precondiciones OK para ${targetType}`);
      printDim(`  Puedes ejecutar /new-spec`);
    } else {
      console.log('');
      printWarn(`Hay precondiciones pendientes — ejecuta dd-cli next para ver qué falta`);
    }
  }

  console.log('');
  return 0;
}

function humanizeRuleId(technicalMsg: string): string {
  if (technicalMsg.includes('REPO-CONTEXT') || technicalMsg.includes('REPO_CONTEXT')) {
    return 'Falta mapear el repo existente → ejecuta /init-repo-context en Claude Code';
  }
  if (technicalMsg.includes('BASELINE')) {
    return 'Falta capturar el baseline del módulo → ejecuta /capture-baseline en Claude Code';
  }
  if (technicalMsg.includes('legacy_system')) {
    return 'Falta identificar el sistema legacy → completa la HDU en la APP';
  }
  if (technicalMsg.includes('vendor')) {
    return 'Falta identificar el vendor → completa la HDU en la APP';
  }
  return technicalMsg;
}
