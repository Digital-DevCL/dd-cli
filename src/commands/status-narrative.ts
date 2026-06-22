/**
 * Vista narrativa de `dd-cli status` — junior-friendly.
 *
 * Muestra:
 *   ╭─ Tu viaje en HDU-128 ──╮
 *   │ ✅ start-session        │
 *   │ 🔵 /init-repo-context  │  ← estás acá
 *   │ ⚪ /new-spec            │
 *   │  ...                   │
 *   ╰────────────────────────╯
 *   ⏱ Llevas 18 min
 *
 *   💡 Tu siguiente paso es...
 *      Tipea: /comando
 *
 * Referencia: wireframes/cli-ux-decisiones.md §Mejora 2
 */
import { getProjectRoot } from '../utils/paths.js';
import { loadSession, SessionIOError } from '../utils/session-io.js';
import { detectFlowState } from '../flow-state/detect.js';
import { getStageContext, stageStatus } from '../flow-state/flow-stages.js';
import { evaluateRules, partition } from '../enforcement/evaluator.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { getDevflowDir } from '../utils/paths.js';
import { printErr, printWarn, bold } from '../utils/output.js';
import type { FlowStage } from '../flow-state/flow-stages.js';
import type { EvaluationResult } from '../enforcement/rules.js';

const isTTY = process.stdout.isTTY;
const c = {
  green:   (s: string) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  cyan:    (s: string) => isTTY ? `\x1b[36m${s}\x1b[0m` : s,
  dim:     (s: string) => isTTY ? `\x1b[90m${s}\x1b[0m` : s,
  bold:    (s: string) => isTTY ? `\x1b[1m${s}\x1b[0m` : s,
  yellow:  (s: string) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
  orange:  (s: string) => isTTY ? `\x1b[38;5;208m${s}\x1b[0m` : s,
  magenta: (s: string) => isTTY ? `\x1b[35m${s}\x1b[0m` : s,
  teal:    (s: string) => isTTY ? `\x1b[38;5;43m${s}\x1b[0m` : s,
};

function devTypeBadgeColored(devType: string): string {
  const map: Record<string, (s: string) => string> = {
    'greenfield': c.green,
    'brownfield-feature': c.cyan,
    'brownfield-refactor': c.orange,
    'modernizacion': c.magenta,
    'integracion-externa': c.teal,
  };
  const fn = map[devType] ?? c.dim;
  return fn(`⬢ ${devType}`);
}

function formatDuration(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return '?';
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function stageIcon(status: ReturnType<typeof stageStatus>): string {
  if (status === 'done')    return isTTY ? '\x1b[32m✅\x1b[0m' : '✅';
  if (status === 'current') return isTTY ? '\x1b[36m🔵\x1b[0m' : '▶';
  return isTTY ? '\x1b[90m⚪\x1b[0m' : '○';
}

/** Mensajes humanos por ID de regla — estructura: qué → cómo → por qué */
export const HUMAN_BLOCKERS: Record<string, { title: string; steps: string[]; why: string; command: string }> = {
  REQUIRE_REPO_CONTEXT_MD: {
    title: 'Falta un paso antes de continuar',
    steps: [
      'Abre Claude Code en este repo',
      'Tipea: /init-repo-context',
      'Claude va a analizar el repo y crear un resumen',
      'Después puedes ejecutar /new-spec sin problema',
    ],
    why: 'Sin entender el código existente, Claude podría proponer soluciones que rompen lo que ya funciona.',
    command: '/init-repo-context',
  },
  REQUIRE_BASELINE_MD: {
    title: 'Falta capturar el estado inicial del código',
    steps: [
      'Abre Claude Code en este repo',
      'Tipea: /capture-baseline <modulo> (ej: /capture-baseline cobranza)',
      'Claude va a guardar los tests, métricas y contratos actuales',
      'Esto protege que el refactor no rompa nada funcionando',
    ],
    why: 'Sin un baseline, no puedes demostrar que el refactor no rompió nada. Es el contrato de no-regresión.',
    command: '/capture-baseline <modulo>',
  },
  REQUIRE_LEGACY_SYSTEM_FIELD: {
    title: 'La HDU de modernización necesita el nombre del sistema legacy',
    steps: [
      'Vuelve al portal de DevFlow IA (portal negocio o backlog)',
      'Edita la HDU y completa el campo "Sistema legacy"',
      'Guarda y vuelve acá',
    ],
    why: 'Sin saber qué sistema reemplazás, Claude no puede armar la matriz de paridad funcional.',
    command: '(completar en la APP)',
  },
  REQUIRE_VENDOR_FIELD: {
    title: 'La HDU de integración necesita el nombre del vendor',
    steps: [
      'Vuelve al portal de DevFlow IA',
      'Edita la HDU y completa "Vendor", "API version" y la URL de documentación',
      'Guarda y vuelve acá',
    ],
    why: 'Sin saber el vendor, Claude no puede hacer las preguntas correctas sobre rate limits, idempotencia y autenticación.',
    command: '(completar en la APP)',
  },
};

function renderBlocker(blocker: EvaluationResult): string[] {
  const human = HUMAN_BLOCKERS[blocker.rule_id];
  const lines: string[] = [];

  lines.push(`\n${isTTY ? '\x1b[31m🛑\x1b[0m' : '🛑'}  ${c.bold(human?.title ?? 'Precondición pendiente')}\n`);

  if (human) {
    human.steps.forEach((step, i) => {
      lines.push(`    ${c.dim(`${i + 1}.`)} ${step}`);
    });
    lines.push('');
    lines.push(`    ${c.dim('💬 ¿Por qué?')} ${c.dim(human.why)}`);
  } else {
    lines.push(`    ${blocker.message}`);
  }

  return lines;
}

export interface StatusNarrativeOptions {
  raw?: boolean;
  quiet?: boolean;
  json?: boolean;
}

export function runStatusNarrative(opts: StatusNarrativeOptions = {}): number {
  const projectRoot = getProjectRoot();

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
    if (opts.quiet) return 1;
    if (opts.json) { console.log(JSON.stringify({ status: 'no_session' })); return 1; }
    console.log(`Sin sesión activa.\nPara empezar: dd-cli start-session <feature-id>`);
    return 1;
  }

  if (opts.raw || opts.json) {
    const flowState = detectFlowState({ projectRoot, session });
    const results = evaluateRules({ projectRoot, session });
    const data = { session, flow_state: flowState, enforcement: results };
    if (opts.json) { console.log(JSON.stringify(data, null, 2)); } else { console.log(JSON.stringify(data, null, 2)); }
    return 0;
  }

  // ── Vista narrativa ──────────────────────────────────────
  const flowState = detectFlowState({ projectRoot, session });
  const ctx = session.dev_type ? getStageContext(session, flowState) : null;

  // Mostrar transición reciente si la hay (celebración de hito)
  const lastTransition = popLastTransition(projectRoot);
  if (lastTransition) {
    const match = lastTransition.match(/flow_state: (\S+) → (\S+)/);
    if (match) {
      const [, from, to] = match;
      const stepMsg = ctx ? `Pasaste al paso ${ctx.currentIndex ?? '?'}/${ctx.total}` : 'Progresaste';
      console.log(`\n🎉  ${c.bold(`¡${stepMsg}!`)}  ${c.dim(`${from} → ${to}`)}\n`);
    }
  }

  // Cabecera
  const featureLabel = `${session.feature_id ?? '?'} · ${session.feature_name ?? ''}`;
  const boxWidth = Math.max(featureLabel.length + 12, 46);
  const title = `Tu viaje en ${featureLabel}`;
  const hrLine = '─'.repeat(boxWidth);

  console.log('');
  console.log(`╭${hrLine}╮`);
  console.log(`│  ${c.bold(title)}${' '.repeat(Math.max(0, boxWidth - title.length - 2))}│`);
  console.log(`│  ${c.dim(devTypeBadgeColored(session.dev_type ?? '?'))}${' '.repeat(Math.max(0, boxWidth - (session.dev_type?.length ?? 1) - 4))}│`);
  console.log(`╞${hrLine}╡`);

  if (ctx) {
    ctx.stages.forEach((stage: FlowStage) => {
      const sStatus = stageStatus(stage.index, ctx.currentIndex, flowState);
      const icon = stageIcon(sStatus);
      const isCurrentFlag = sStatus === 'current' ? c.dim('  ← estás acá') : '';
      const label = sStatus === 'current' ? c.bold(stage.id) : sStatus === 'done' ? c.dim(stage.id) : stage.id;
      const line = `│  ${icon}  ${label}${isCurrentFlag}`;
      const paddedLine = line + ' '.repeat(Math.max(0, boxWidth - stripAnsi(line).length + 2)) + '│';
      console.log(paddedLine);
    });
  } else {
    console.log(`│  ${c.dim('(sin tipo definido — ejecuta dd-cli start-session)')}  │`);
  }

  console.log(`╞${hrLine}╡`);
  const duration = session.started_at ? `Llevas ${formatDuration(session.started_at)} en esta sesión` : '';
  const dLine = `│  ⏱  ${c.dim(duration)}`;
  console.log(dLine + ' '.repeat(Math.max(0, boxWidth - stripAnsi(dLine).length + 2)) + '│');
  console.log(`╰${hrLine}╯`);

  // Bloqueantes
  const results = evaluateRules({ projectRoot, session });
  const { blockers, warnings } = partition(results);

  for (const b of blockers) {
    renderBlocker(b).forEach((line) => console.log(line));
  }
  for (const w of warnings) {
    console.log(`\n${c.yellow('⚠')}  ${w.message}`);
  }

  // Next step sugerido (solo si no hay bloqueantes)
  if (blockers.length === 0 && ctx?.currentStage) {
    const stage = ctx.currentStage;
    console.log('');
    console.log(`💡  ${c.bold(`Tu siguiente paso es: ${stage.id}`)}`);
    console.log('');
    console.log(`    ${c.dim(stage.rationale)}`);
    console.log('');

    if (stage.invokeIn === 'claude') {
      console.log(`    En Claude Code, tipea:`);
      console.log(`        ${c.cyan(stage.command)}`);
    } else {
      console.log(`    En tu terminal, ejecuta:`);
      console.log(`        ${c.cyan(stage.command)}`);
    }
  }

  console.log('');
  return blockers.length > 0 ? 2 : 0;
}

/** Remueve códigos ANSI para calcular longitud real de la línea */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Lee la última transición no-acknowledged de transitions.log.
 * La marca como acknowledged escribiendo transitions.ack con el timestamp.
 */
function popLastTransition(projectRoot: string): string | null {
  const logPath = path.join(getDevflowDir(projectRoot), 'transitions.log');
  const ackPath = path.join(getDevflowDir(projectRoot), 'transitions.ack');

  if (!existsSync(logPath)) return null;

  const lines = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
  if (lines.length === 0) return null;

  const lastLine = lines[lines.length - 1]!;
  const lastAck = existsSync(ackPath) ? readFileSync(ackPath, 'utf-8').trim() : '';

  if (lastAck === lastLine) return null; // ya fue mostrada

  writeFileSync(ackPath, lastLine, 'utf-8');
  return lastLine;
}
