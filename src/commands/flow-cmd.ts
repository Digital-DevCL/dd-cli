/**
 * `dd-cli flow` — guía visual del flujo DevFlow IA por dev_type.
 *
 * Modos:
 *   dd-cli flow                       → viaje del dev_type de la sesión activa
 *   dd-cli flow --type=greenfield     → viaje hipotético de un tipo
 *   dd-cli flow --all                 → los 5 tipos resumidos
 *
 * Si hay sesión activa, marca el paso actual con un indicador.
 * Si no hay sesión, todos los pasos aparecen como pendientes.
 */
import { isDevType, DEV_TYPES, type DevType } from '../types/dev-type.js';
import { stagesForDevType, currentStageIndex, type FlowStage } from '../flow-state/flow-stages.js';
import { detectFlowState } from '../flow-state/detect.js';
import { findDevFlowProjectRoot } from '../utils/paths.js';
import { loadSession } from '../utils/session-io.js';
import {
  bold,
  dim,
  ok,
  info,
  printErr,
  printInfo,
  printDim,
  devTypeBadge,
} from '../utils/output.js';

export interface FlowOptions {
  type?: string;
  all?: boolean;
}

const STAGE_GROUPS: Array<{ label: string; matches: (s: FlowStage) => boolean }> = [
  { label: 'CAPTURA & DISEÑO',  matches: (s) => s.id === 'start-session' },
  { label: 'MAPEO DEL REPO',    matches: (s) => s.id === '/init-repo-context' || s.id === '/map-service' || s.id === '/trace-flow' || s.id === '/capture-baseline' },
  { label: 'SPEC',              matches: (s) => s.id === '/new-spec' || s.id === '/derive-spec' || s.id === '/new-app' },
  { label: 'CONSTRUCCIÓN SDD',  matches: (s) => s.id.startsWith('/opsx:') },
  { label: 'RELEASE',           matches: (s) => s.id === '/release-check' || s.id === '/end-session' },
];

function groupForStage(s: FlowStage): string {
  for (const g of STAGE_GROUPS) if (g.matches(s)) return g.label;
  return 'OTROS';
}

function statusIcon(stageIndex: number, currentIndex: number | null): string {
  if (currentIndex === null) return '⬜';
  if (stageIndex < currentIndex) return ok('✅');
  if (stageIndex === currentIndex) return info('🔵');
  return '⬜';
}

interface ResolvedContext {
  devType: DevType;
  source: 'session' | 'flag';
  currentIndex: number | null;
  featureId: string | null;
  featureName: string | null;
}

function resolveContext(opts: FlowOptions): ResolvedContext | { error: string } {
  // Prioridad: --type explícito > sesión activa
  if (opts.type) {
    if (!isDevType(opts.type)) {
      return { error: `dev_type inválido: "${opts.type}". Válidos: ${DEV_TYPES.join(', ')}` };
    }
    return {
      devType: opts.type,
      source: 'flag',
      currentIndex: null,
      featureId: null,
      featureName: null,
    };
  }

  const projectRoot = findDevFlowProjectRoot();
  if (!projectRoot) {
    return {
      error:
        'No estoy en un proyecto DevFlow IA y no diste --type.\n' +
        '  Prueba: dd-cli flow --type=brownfield-feature  (o --all)',
    };
  }

  let session;
  try {
    session = loadSession(projectRoot);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  if (!session || !session.dev_type) {
    return {
      error:
        'No hay sesión activa con dev_type. Opciones:\n' +
        '  · dd-cli flow --type=<tipo>  para ver un tipo hipotético\n' +
        '  · dd-cli flow --all          para ver los 5 tipos\n' +
        '  · dd-cli start-session <HDU> para arrancar una sesión',
    };
  }

  const flowState = detectFlowState({ projectRoot, session });
  return {
    devType: session.dev_type,
    source: 'session',
    currentIndex: currentStageIndex(session.dev_type, flowState),
    featureId: session.feature_id ?? null,
    featureName: session.feature_name ?? null,
  };
}

function renderFlow(ctx: ResolvedContext): void {
  const stages = stagesForDevType(ctx.devType);
  const total = stages.length;

  const headerTitle = `Flujo DevFlow IA · ${ctx.devType}`;
  const subtitle = ctx.source === 'session'
    ? `${ctx.featureId ?? '?'}${ctx.featureName ? ' · ' + ctx.featureName : ''}`
    : '(vista hipotética — sin sesión activa)';

  console.log('');
  console.log(bold(headerTitle));
  console.log(dim(subtitle));
  console.log(dim(devTypeBadge(ctx.devType)));
  console.log('');

  // Agrupar stages por etapa visual
  let lastGroup = '';
  for (const s of stages) {
    const grp = groupForStage(s);
    if (grp !== lastGroup) {
      if (lastGroup !== '') console.log('');
      console.log(bold(`  ${grp}`));
      lastGroup = grp;
    }
    const icon = statusIcon(s.index, ctx.currentIndex);
    const idCol = s.id.padEnd(22);
    const whereCol = s.invokeIn === 'claude' ? dim('(claude)') : dim('(terminal)');
    const youAreHere =
      ctx.currentIndex !== null && s.index === ctx.currentIndex ? '  ' + info('← estás acá') : '';
    console.log(`    ${icon}  ${idCol} ${whereCol}${youAreHere}`);
    if (s.rationale) {
      console.log(`        ${dim(s.rationale)}`);
    }
  }

  console.log('');
  console.log(dim(`Total: ${total} pasos`));

  if (ctx.source === 'session' && ctx.currentIndex !== null) {
    const next = stages[ctx.currentIndex - 1];
    if (next) {
      const where = next.invokeIn === 'claude' ? 'Claude Code' : 'la terminal';
      console.log('');
      printInfo(`Tu próximo paso: ejecuta ${bold(next.command)} en ${where}.`);
    }
  } else if (ctx.source === 'flag') {
    console.log('');
    printDim('Esta es una vista hipotética. Para arrancar:');
    printDim('  dd-cli start-session <HDU-id>');
  }
  console.log('');
}

function renderAll(): void {
  console.log('');
  console.log(bold('Flujos DevFlow IA — los 5 dev_types\n'));
  for (const type of DEV_TYPES) {
    const stages = stagesForDevType(type);
    console.log(bold(devTypeBadge(type)) + dim(`  · ${stages.length} pasos`));
    const summary = stages.map((s) => s.id).join(' → ');
    console.log(`  ${dim(summary)}`);
    console.log('');
  }
  printDim('Para ver el detalle de uno: dd-cli flow --type=<tipo>');
  console.log('');
}

export function runFlow(opts: FlowOptions = {}): number {
  if (opts.all) {
    renderAll();
    return 0;
  }

  const ctx = resolveContext(opts);
  if ('error' in ctx) {
    printErr(ctx.error);
    return 1;
  }
  renderFlow(ctx);
  return 0;
}
