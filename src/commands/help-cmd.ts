/**
 * `dd-cli help` — help contextual según flow_state.
 *
 * Cambia según dónde está el dev. Sin sesión muestra setup.
 * Con sesión muestra solo los comandos relevantes para esa etapa.
 * --all muestra todos.
 */
import { getProjectRoot } from '../utils/paths.js';
import { loadSession } from '../utils/session-io.js';
import { detectFlowState } from '../flow-state/detect.js';
import { getStageContext } from '../flow-state/flow-stages.js';

const isTTY = process.stdout.isTTY;
const bold  = (s: string) => isTTY ? `\x1b[1m${s}\x1b[0m` : s;
const cyan  = (s: string) => isTTY ? `\x1b[36m${s}\x1b[0m` : s;
const dim   = (s: string) => isTTY ? `\x1b[90m${s}\x1b[0m` : s;

interface HelpEntry {
  cmd: string;
  desc: string;
}

const ALL_COMMANDS: HelpEntry[] = [
  { cmd: 'dd-cli init',                desc: 'Configura el proyecto (skills + hooks + CLAUDE.md)' },
  { cmd: 'dd-cli start-session <id>',  desc: 'Inicia una sesión de trabajo sobre una HDU' },
  { cmd: 'dd-cli end-session',         desc: 'Cierra la sesión (normalmente lo hace la skill /end-session)' },
  { cmd: 'dd-cli status',              desc: 'Tu viaje actual: pasos completados y pendientes' },
  { cmd: 'dd-cli next',                desc: 'Atajo: ¿qué tipeo ahora?' },
  { cmd: 'dd-cli statusline',          desc: '1 línea para la statusLine de Claude Code (uso interno)' },
  { cmd: 'dd-cli heartbeat',           desc: 'Señal de vida (llamado por hooks automáticamente)' },
  { cmd: 'dd-cli reclassify',         desc: 'Cambia el dev_type (solo Tech Lead, post-lock)' },
  { cmd: 'dd-cli doctor',              desc: 'Verifica que el entorno esté bien configurado' },
  { cmd: 'dd-cli skills list',         desc: 'Lista las 19 skills instaladas con modelo' },
  { cmd: 'dd-cli skills verify',       desc: 'Verifica que ninguna skill fue modificada localmente' },
  { cmd: 'dd-cli skills install',      desc: 'Reinstala skills (útil tras actualizar dd-cli)' },
];

function printCommands(entries: HelpEntry[]): void {
  const maxLen = Math.max(...entries.map(e => e.cmd.length));
  for (const { cmd, desc } of entries) {
    console.log(`  ${cyan(cmd.padEnd(maxLen + 2))} ${dim(desc)}`);
  }
}

export function runHelp(opts: { all?: boolean } = {}): number {
  let projectRoot: string;
  try {
    projectRoot = getProjectRoot();
  } catch {
    projectRoot = process.cwd();
  }

  if (opts.all) {
    console.log(`\n${bold('Todos los comandos de dd-cli')}\n`);
    printCommands(ALL_COMMANDS);
    console.log('');
    return 0;
  }

  const session = (() => { try { return loadSession(projectRoot); } catch { return null; } })();
  const flowState = session ? detectFlowState({ projectRoot, session }) : 'not_started';
  const ctx = session?.dev_type ? getStageContext(session, flowState) : null;

  // Sin sesión activa
  if (!session || !session.started_at) {
    console.log(`\n${bold('Empezando en este proyecto')}\n`);
    printCommands([
      { cmd: 'dd-cli init',               desc: 'Primera vez: configura el proyecto' },
      { cmd: 'dd-cli start-session <id>', desc: 'Inicia sesión con el ID de tu HDU' },
      { cmd: 'dd-cli status',             desc: 'Ver estado actual' },
    ]);
    console.log('');
    return 0;
  }

  // Con sesión — mostrar comandos relevantes para el estado actual
  const stageName = ctx?.currentStage?.id ?? '?';
  const devType = session.dev_type ?? '?';
  console.log(`\n${bold(`Estás en: ${stageName}`)} ${dim(`(paso ${ctx?.currentIndex ?? '?'}/${ctx?.total ?? '?'} · ${devType})`)}\n`);

  const contextual: HelpEntry[] = [
    { cmd: 'dd-cli status',     desc: 'Ver progreso completo del viaje' },
    { cmd: 'dd-cli next',       desc: '¿Qué tipeo ahora?' },
  ];

  if (flowState === 'change_active') {
    contextual.push({ cmd: 'dd-cli heartbeat',   desc: 'Actualizar estado (lo hacen los hooks solos)' });
  }

  if (session.ended_at) {
    contextual.push({ cmd: 'dd-cli start-session <id>', desc: 'Iniciar nueva sesión' });
  } else {
    contextual.push({ cmd: 'dd-cli end-session',  desc: 'Cerrar sesión al terminar el día' });
  }

  printCommands(contextual);

  if (ctx?.nextStage) {
    console.log('');
    console.log(dim(`Cuando termines este paso, en Claude Code ejecuta: ${ctx.nextStage.command}`));
  }

  console.log('');
  console.log(dim(`Ver todos los comandos: dd-cli help --all`));
  console.log('');
  return 0;
}
