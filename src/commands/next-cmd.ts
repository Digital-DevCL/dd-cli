/**
 * `dd-cli next` — atajo minimalista "qué tipeo ahora".
 *
 * Output:
 *   Tu siguiente paso es: /skill
 *
 *   ¿Por qué? <rationale en 1 línea>
 *   → Abre Claude Code y tipea: /skill
 *
 * Referencia: wireframes/cli-ux-decisiones.md §Mejora 3
 */
import { getProjectRoot } from '../utils/paths.js';
import { loadSession, SessionIOError } from '../utils/session-io.js';
import { detectFlowState } from '../flow-state/detect.js';
import { getStageContext } from '../flow-state/flow-stages.js';
import { evaluateRules, partition } from '../enforcement/evaluator.js';
import { HUMAN_BLOCKERS } from './status-narrative.js';
import { bold } from '../utils/output.js';
import { printErr } from '../utils/output.js';

const isTTY = process.stdout.isTTY;
const cyan = (s: string) => isTTY ? `\x1b[36m${s}\x1b[0m` : s;
const dim  = (s: string) => isTTY ? `\x1b[90m${s}\x1b[0m` : s;

export function runNext(): number {
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
    console.log(`Tu siguiente paso es: ${cyan('dd-cli start-session <HDU-id>')}`);
    console.log('');
    console.log(dim('¿Por qué? No hay sesión activa en este proyecto.'));
    console.log(`→ En tu terminal, ejecuta: ${cyan('dd-cli start-session <HDU-id>')}`);
    return 1;
  }

  // Si hay bloqueantes, mostrar el primero
  const flowState = detectFlowState({ projectRoot, session });
  const results = evaluateRules({ projectRoot, session });
  const { blockers } = partition(results);

  if (blockers.length > 0) {
    const b = blockers[0]!;
    const human = HUMAN_BLOCKERS[b.rule_id];
    if (human) {
      console.log(`Tu siguiente paso es: ${bold(human.command === '(completar en la APP)' ? 'completar campos en la APP' : human.command)}`);
      console.log('');
      console.log(dim(`¿Por qué? ${human.why}`));
      if (human.command !== '(completar en la APP)') {
        console.log(`→ En Claude Code, tipea: ${cyan(human.command)}`);
      }
    } else {
      console.log(`Tu siguiente paso es: ${bold('resolver precondición pendiente')}`);
      console.log('');
      console.log(dim(b.message));
    }
    return 2;
  }

  // Sin bloqueantes → siguiente stage del flujo
  const ctx = session.dev_type ? getStageContext(session, flowState) : null;

  if (!ctx || !ctx.currentStage) {
    console.log(`Tu siguiente paso es: ${cyan('dd-cli start-session <HDU-id>')}`);
    console.log('');
    console.log(dim('¿Por qué? La sesión existe pero el dev_type no está definido.'));
    return 1;
  }

  const stage = ctx.currentStage;

  console.log(`Tu siguiente paso es: ${bold(stage.id)}`);
  console.log('');
  console.log(dim(`¿Por qué? ${stage.rationale}`));
  console.log('');

  if (stage.invokeIn === 'claude') {
    console.log(`→ En Claude Code, tipea: ${cyan(stage.command)}`);
  } else {
    console.log(`→ En tu terminal, ejecuta: ${cyan(stage.command)}`);
  }

  return 0;
}
