/**
 * `dd-cli help-ctx` — help contextual según flow_state.
 *
 * Sin sesión: apunta al punto de entrada único (/devflow-ia:start-work).
 * Con sesión: muestra el paso actual + próximo, según el journey real
 *             (flow-stages.ts) del dev_type activo.
 * --all: en vez de un listado plano de comandos, muestra las skills
 *        agrupadas por rol y en orden de flujo — mismo contenido que
 *        `docs/guia-flujo-roles.md`, condensado para terminal. Mantenerlos
 *        sincronizados si se agregan/reordenan skills.
 */
import { getProjectRoot } from '../utils/paths.js';
import { loadSession } from '../utils/session-io.js';
import { detectFlowState } from '../flow-state/detect.js';
import { getStageContext } from '../flow-state/flow-stages.js';

const isTTY = process.stdout.isTTY;
const bold  = (s: string) => isTTY ? `\x1b[1m${s}\x1b[0m` : s;
const cyan  = (s: string) => isTTY ? `\x1b[36m${s}\x1b[0m` : s;
const dim   = (s: string) => isTTY ? `\x1b[90m${s}\x1b[0m` : s;

interface FlowItem {
  cmd: string;
  desc: string;
}

interface FlowGroup {
  title: string;
  items: FlowItem[];
}

interface RoleFlow {
  role: string;
  groups: FlowGroup[];
}

// Espejo condensado de docs/guia-flujo-roles.md — orden de ejecución real.
const ROLE_FLOWS: RoleFlow[] = [
  {
    role: 'Consultor Digital-Dev — onboarding de cliente (una vez por cliente)',
    groups: [
      {
        title: '',
        items: [
          { cmd: '/devflow-ia:client-onboard', desc: 'Orquesta new → discover → publish' },
        ],
      },
    ],
  },
  {
    role: 'Tech Lead / PMO — por épica o feature',
    groups: [
      {
        title: 'Crear HDUs (Claude Code)',
        items: [
          { cmd: '/devflow-ia:capture-req', desc: 'Brief crudo → estandarizado + dev_type sugerido' },
          { cmd: '/devflow-ia:enrich-us',   desc: 'Agrega edge cases, criterios de aceptación, riesgos' },
          { cmd: '/devflow-ia:design-hdu',  desc: 'Genera el archivo HDU formal (Gherkin + estimación)' },
        ],
      },
      {
        title: 'Gestionar (terminal)',
        items: [
          { cmd: 'dd-cli hdu approve <id>', desc: 'Aprueba la HDU' },
          { cmd: 'dd-cli hdu assign <id>',  desc: 'Asigna al dev' },
        ],
      },
      {
        title: 'Board y métricas (Claude Code)',
        items: [
          { cmd: '/devflow-ia:hdu-board',    desc: 'Gestión conversacional del board' },
          { cmd: '/devflow-ia:stats-review', desc: 'Interpreta throughput y lead time' },
        ],
      },
    ],
  },
  {
    role: 'Dev — por HDU asignada',
    groups: [
      {
        title: 'Cada mañana (Claude Code)',
        items: [
          { cmd: '/devflow-ia:daily-standup', desc: 'Qué tengo hoy + inbox + alertas' },
        ],
      },
      {
        title: 'Arrancar — punto de entrada único (Claude Code)',
        items: [
          { cmd: '/devflow-ia:start-work', desc: 'Detecta dónde estás (máquina/repo/HDU) y te lleva hasta start-session' },
        ],
      },
      {
        title: 'Trabajar la HDU (Claude Code, en orden — varía por dev_type)',
        items: [
          { cmd: '/init-repo-context → /new-spec → /opsx:propose → /opsx:apply → /release-check → /end-session', desc: 'Genérico. Con sesión activa, dd-cli status muestra tu journey exacto.' },
        ],
      },
      {
        title: 'Cerrar la HDU (terminal)',
        items: [
          { cmd: 'dd-cli hdu review <id>', desc: 'in-progress → in-review (abre MR)' },
          { cmd: 'dd-cli hdu close <id>',  desc: 'in-review → done (post-merge)' },
        ],
      },
      {
        title: 'Al final del día (Claude Code)',
        items: [
          { cmd: '/devflow-ia:end-day', desc: 'Cierra sesión + sugiere commit + estado de la HDU' },
        ],
      },
    ],
  },
];

function printRoleFlows(): void {
  for (const { role, groups } of ROLE_FLOWS) {
    console.log('');
    console.log(bold(role.toUpperCase()));
    for (const group of groups) {
      if (group.title) console.log(`  ${dim(group.title + ':')}`);
      const CAP = 70;
      const maxLen = Math.min(Math.max(...group.items.map(i => i.cmd.length)), CAP);
      for (const { cmd, desc } of group.items) {
        if (cmd.length > CAP) {
          console.log(`    ${cyan(cmd)}`);
          console.log(`      ${dim(desc)}`);
        } else {
          console.log(`    ${cyan(cmd.padEnd(maxLen + 2))} ${dim(desc)}`);
        }
      }
    }
  }
  console.log('');
  console.log(dim('Regla de oro: lo que toca el context repo termina con `dd-cli client publish`.'));
  console.log(dim('              lo que es código termina con `/end-session` o `/end-day`.'));
  console.log('');
  console.log(dim('Guía completa (por rol, con más contexto): dd-cli guide roles'));
}

export function runHelp(opts: { all?: boolean } = {}): number {
  let projectRoot: string;
  try {
    projectRoot = getProjectRoot();
  } catch {
    projectRoot = process.cwd();
  }

  if (opts.all) {
    console.log(`\n${bold('DevFlow IA — skills por rol, en orden de flujo')}`);
    printRoleFlows();
    console.log('');
    return 0;
  }

  const session = (() => { try { return loadSession(projectRoot); } catch { return null; } })();
  const flowState = session ? detectFlowState({ projectRoot, session }) : 'not_started';
  const ctx = session?.dev_type ? getStageContext(session, flowState) : null;

  // Sin sesión activa
  if (!session || !session.started_at) {
    console.log(`\n${bold('Sin sesión activa en este proyecto')}\n`);
    console.log(`  ${cyan('/devflow-ia:start-work')}   ${dim('Punto de entrada único — en Claude Code')}`);
    console.log(`  ${cyan('dd-cli status')}            ${dim('Ver estado actual')}`);
    console.log('');
    console.log(dim(`Skills por rol, en orden de flujo: dd-cli help-ctx --all`));
    console.log('');
    return 0;
  }

  // Con sesión — mostrar el paso actual + próximo del journey real
  const stageName = ctx?.currentStage?.id ?? '?';
  const devType = session.dev_type ?? '?';
  console.log(`\n${bold(`Estás en: ${stageName}`)} ${dim(`(paso ${ctx?.currentIndex ?? '?'}/${ctx?.total ?? '?'} · ${devType})`)}\n`);

  console.log(`  ${cyan('dd-cli status')}   ${dim('Ver progreso completo del viaje')}`);
  console.log(`  ${cyan('dd-cli next')}     ${dim('¿Qué tipeo ahora?')}`);
  console.log(`  ${cyan('dd-cli watch')}    ${dim('Barra de estado en vivo, en otro pane')}`);

  if (session.ended_at) {
    console.log(`  ${cyan('/devflow-ia:start-work')}   ${dim('Iniciar nueva HDU')}`);
  } else {
    console.log(`  ${cyan('dd-cli end-session')}      ${dim('Cerrar sesión al terminar el día')}`);
  }

  if (ctx?.nextStage) {
    console.log('');
    console.log(dim(`Cuando termines este paso: ${ctx.nextStage.command}`));
  }

  console.log('');
  console.log(dim(`Skills por rol, en orden de flujo: dd-cli help-ctx --all`));
  console.log('');
  return 0;
}
