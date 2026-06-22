/**
 * Etapas numeradas del flujo por dev_type.
 *
 * Cada dev_type define un viaje de N pasos. Las skills/comandos son los
 * "checkpoints" que el dev visita. El CLI muestra paso actual + próximo
 * en statusline, status narrativo, y comando next.
 *
 * Referencia: wireframes/cli-ux-decisiones.md (tabla "Flujos por dev_type")
 */
import type { DevType } from '../types/dev-type.js';
import type { FlowState, SessionState } from '../types/session.js';

export interface FlowStage {
  /** Índice 1-based (paso 1, 2, ...) */
  index: number;
  /** ID del comando/skill (`/init-repo-context`, `start-session`, etc.) */
  id: string;
  /** Etiqueta humana para mostrar */
  label: string;
  /** Una línea pedagógica que explica para qué sirve este paso */
  rationale: string;
  /** Comando exacto que el dev debe tipear (en Claude Code o terminal) */
  command: string;
  /** Dónde se tipea: 'claude' (slash command) o 'terminal' (dd-cli) */
  invokeIn: 'claude' | 'terminal';
}

/**
 * Genera la receta de stages para un dev_type.
 * El paso 1 siempre es start-session (terminal).
 * El paso final siempre es end-session.
 */
export function stagesForDevType(devType: DevType): FlowStage[] {
  switch (devType) {
    case 'greenfield':
      return [
        stage(1, 'start-session', 'Iniciar sesión', 'Registra la HDU que vas a trabajar y arranca el flujo.', 'dd-cli start-session <HDU-id>', 'terminal'),
        stage(2, '/new-spec', 'Generar SPEC maestra', 'Claude entrevista al dev y produce el documento técnico de la feature.', '/new-spec', 'claude'),
        stage(3, '/new-app', 'Scaffolding inicial', 'Crea el esqueleto de la app nueva desde los templates del cliente.', '/new-app', 'claude'),
        stage(4, '/derive-spec', 'Derivar spec por app', 'Si la feature toca varias apps, divide el SPEC para cada una.', '/derive-spec', 'claude'),
        stage(5, '/opsx:propose', 'Proponer cambio', 'Claude diseña la implementación (proposal + design + tasks).', '/opsx:propose <change-name>', 'claude'),
        stage(6, '/opsx:apply', 'Implementar', 'Claude programa task por task siguiendo el plan aprobado.', '/opsx:apply', 'claude'),
        stage(7, '/release-check', 'Revisión pre-merge', 'Verifica que el código cumple el SPEC antes de abrir el MR.', '/release-check', 'claude'),
        stage(8, '/end-session', 'Cerrar sesión', 'Commit + push + resumen. Cierra el ciclo y notifica al equipo.', '/end-session', 'claude'),
      ];

    case 'brownfield-feature':
      return [
        stage(1, 'start-session', 'Iniciar sesión', 'Registra la HDU que vas a trabajar y arranca el flujo.', 'dd-cli start-session <HDU-id>', 'terminal'),
        stage(2, '/init-repo-context', 'Mapear el repo', 'Claude analiza el código existente y crea un resumen estructurado.', '/init-repo-context', 'claude'),
        stage(3, '/new-spec', 'Generar SPEC maestra', 'Con el repo ya entendido, Claude redacta el SPEC sin re-preguntar lo conocido.', '/new-spec', 'claude'),
        stage(4, '/derive-spec', 'Derivar spec por app', 'Si la feature toca varias apps, divide el SPEC para cada una.', '/derive-spec', 'claude'),
        stage(5, '/opsx:propose', 'Proponer cambio', 'Claude diseña la implementación (proposal + design + tasks).', '/opsx:propose <change-name>', 'claude'),
        stage(6, '/opsx:apply', 'Implementar', 'Claude programa task por task siguiendo el plan aprobado.', '/opsx:apply', 'claude'),
        stage(7, '/release-check', 'Revisión pre-merge', 'Verifica que el código cumple el SPEC antes de abrir el MR.', '/release-check', 'claude'),
        stage(8, '/end-session', 'Cerrar sesión', 'Commit + push + resumen. Cierra el ciclo y notifica al equipo.', '/end-session', 'claude'),
      ];

    case 'brownfield-refactor':
      return [
        stage(1, 'start-session', 'Iniciar sesión', 'Registra la HDU de refactor que vas a trabajar.', 'dd-cli start-session <HDU-id>', 'terminal'),
        stage(2, '/init-repo-context', 'Mapear el repo', 'Claude analiza el código existente y crea un resumen estructurado.', '/init-repo-context', 'claude'),
        stage(3, '/map-service', 'Diagrama del módulo', 'Mermaid de la arquitectura interna del módulo a refactorizar.', '/map-service <modulo>', 'claude'),
        stage(4, '/capture-baseline', 'Capturar baseline', 'Snapshot de tests, métricas y contratos públicos antes de tocar nada.', '/capture-baseline <modulo>', 'claude'),
        stage(5, '/new-spec', 'Generar SPEC del refactor', 'Con baseline en mano, Claude redacta el plan de no-regresión.', '/new-spec', 'claude'),
        stage(6, '/opsx:propose', 'Proponer refactor', 'Diseño con sección obligatoria "no functional change".', '/opsx:propose <change-name>', 'claude'),
        stage(7, '/opsx:apply', 'Implementar refactor', 'Cambios task por task con re-ejecución de golden tests.', '/opsx:apply', 'claude'),
        stage(8, '/release-check', 'Validar contratos', 'Diff de API pública contra baseline + golden tests pasan.', '/release-check', 'claude'),
        stage(9, '/end-session', 'Cerrar sesión', 'Commit + push + resumen del refactor.', '/end-session', 'claude'),
      ];

    case 'modernizacion':
      return [
        stage(1, 'start-session', 'Iniciar sesión', 'Registra la HDU de modernización del sistema legacy.', 'dd-cli start-session <HDU-id>', 'terminal'),
        stage(2, '/init-repo-context', 'Mapear el legacy', 'Claude analiza el sistema legacy (--on=<legacy-path> si está aparte).', '/init-repo-context --on=<legacy-path>', 'claude'),
        stage(3, '/trace-flow', 'Trazar flujos cross-service', 'Diagrama de comunicación del legacy + drawio editable.', '/trace-flow --scope=<dominio>', 'claude'),
        stage(4, '/map-service', 'Diagrama por servicio', 'Diagrama interno de cada servicio del legacy a reemplazar.', '/map-service <servicio>', 'claude'),
        stage(5, '/new-spec', 'Generar SPEC de modernización', 'Matriz de paridad + plan rollback + rampa de tráfico.', '/new-spec', 'claude'),
        stage(6, '/derive-spec', 'Derivar por app target', 'Spec específico para cada app que reemplaza al legacy.', '/derive-spec', 'claude'),
        stage(7, '/opsx:propose', 'Proponer modernización', 'Diseño con cohabitación legacy/nuevo durante rampa.', '/opsx:propose <change-name>', 'claude'),
        stage(8, '/opsx:apply', 'Implementar', 'Cambios task por task; el legacy sigue corriendo en paralelo.', '/opsx:apply', 'claude'),
        stage(9, '/release-check', 'Validar paridad', 'Shadow testing + feature flag de rampa configurado.', '/release-check', 'claude'),
      ];

    case 'integracion-externa':
      return [
        stage(1, 'start-session', 'Iniciar sesión', 'Registra la HDU de integración con vendor externo.', 'dd-cli start-session <HDU-id>', 'terminal'),
        stage(2, '/init-repo-context', 'Mapear el repo', 'Solo si la integración vive sobre app existente. Salteable si es greenfield.', '/init-repo-context', 'claude'),
        stage(3, '/new-spec', 'Generar SPEC de integración', 'Vendor + auth + rate limits + idempotencia + webhooks + sandbox.', '/new-spec', 'claude'),
        stage(4, '/derive-spec', 'Derivar adaptador', 'Spec del adaptador anti-corrupción en la app destino.', '/derive-spec', 'claude'),
        stage(5, '/opsx:propose', 'Proponer integración', 'Diseño con port-adapter / anti-corruption layer.', '/opsx:propose <change-name>', 'claude'),
        stage(6, '/opsx:apply', 'Implementar', 'Cambios task por task con retries + idempotencia + manejo de errores.', '/opsx:apply', 'claude'),
        stage(7, '/release-check', 'Validar seguridad', 'Credenciales NO en código + firma webhooks + idempotencia OK.', '/release-check', 'claude'),
        stage(8, '/end-session', 'Cerrar sesión', 'Commit + push + resumen de la integración.', '/end-session', 'claude'),
      ];
  }
}

function stage(
  index: number,
  id: string,
  label: string,
  rationale: string,
  command: string,
  invokeIn: 'claude' | 'terminal'
): FlowStage {
  return { index, id, label, rationale, command, invokeIn };
}

/**
 * Mapea (dev_type, flow_state) → índice del stage actual (1-based).
 * Retorna null si no hay sesión o no hay dev_type.
 *
 * Reglas:
 *   not_started     → null
 *   started         → paso 1 (start-session ya hecho, lo siguiente es el paso 2)
 *                     ...pero presentamos paso 1 como ✅ y paso 2 como actual
 *   repo_mapped     → varía por dev_type (después del init-repo-context)
 *   baseline_ready  → solo brownfield-refactor (después del capture-baseline)
 *   spec_ready      → después de /new-spec
 *   change_active   → durante /opsx:apply
 *   ended           → último paso
 */
export function currentStageIndex(
  devType: DevType,
  flowState: FlowState
): number | null {
  const stages = stagesForDevType(devType);
  const total = stages.length;

  if (flowState === 'not_started') return null;
  if (flowState === 'ended') return total;

  // Mapeo flow_state → índice "esperado siguiente" (1-based)
  // El "current step" es lo que el dev ESTÁ por hacer ahora.
  switch (devType) {
    case 'greenfield':
      // started → paso 2 (/new-spec)
      if (flowState === 'started') return 2;
      // spec_ready → paso 3 (/new-app) o /derive-spec según multi-app... pero default paso 3
      if (flowState === 'spec_ready') return 3;
      // change_active → paso 6 (/opsx:apply)
      if (flowState === 'change_active') return 6;
      break;

    case 'brownfield-feature':
      if (flowState === 'started') return 2; // /init-repo-context
      if (flowState === 'repo_mapped') return 3; // /new-spec
      if (flowState === 'spec_ready') return 4; // /derive-spec
      if (flowState === 'change_active') return 6; // /opsx:apply
      break;

    case 'brownfield-refactor':
      if (flowState === 'started') return 2; // /init-repo-context
      if (flowState === 'repo_mapped') return 3; // /map-service
      if (flowState === 'baseline_ready') return 5; // /new-spec
      if (flowState === 'spec_ready') return 6; // /opsx:propose
      if (flowState === 'change_active') return 7; // /opsx:apply
      break;

    case 'modernizacion':
      if (flowState === 'started') return 2; // /init-repo-context --on
      if (flowState === 'repo_mapped') return 3; // /trace-flow
      if (flowState === 'spec_ready') return 6; // /derive-spec
      if (flowState === 'change_active') return 8; // /opsx:apply
      break;

    case 'integracion-externa':
      if (flowState === 'started') return 2; // /init-repo-context (opc.) o /new-spec
      if (flowState === 'repo_mapped') return 3; // /new-spec
      if (flowState === 'spec_ready') return 4; // /derive-spec
      if (flowState === 'change_active') return 6; // /opsx:apply
      break;
  }
  return null;
}

export interface StageContext {
  total: number;
  currentIndex: number | null;
  currentStage: FlowStage | null;
  nextStage: FlowStage | null;
  stages: FlowStage[];
}

/**
 * Devuelve el contexto completo de stages para el dev: total, actual, próximo, lista entera.
 * Útil para statusline + status narrativo + next.
 */
export function getStageContext(session: SessionState, flowState: FlowState): StageContext | null {
  if (!session.dev_type) return null;
  const stages = stagesForDevType(session.dev_type);
  const total = stages.length;
  const currentIndex = currentStageIndex(session.dev_type, flowState);

  let currentStage: FlowStage | null = null;
  let nextStage: FlowStage | null = null;

  if (currentIndex !== null) {
    currentStage = stages[currentIndex - 1] ?? null;
    nextStage = stages[currentIndex] ?? null;
  }

  return { total, currentIndex, currentStage, nextStage, stages };
}

/**
 * Marca el estado de cada stage para presentación visual.
 *   'done'    → ya pasamos (índice < current)
 *   'current' → el dev está acá (índice === current)
 *   'pending' → todavía no llegamos (índice > current)
 */
export type StageStatus = 'done' | 'current' | 'pending';

export function stageStatus(stageIndex: number, currentIndex: number | null, flowState: FlowState): StageStatus {
  if (flowState === 'ended') {
    return 'done';
  }
  if (currentIndex === null) return 'pending';
  if (stageIndex < currentIndex) return 'done';
  if (stageIndex === currentIndex) return 'current';
  return 'pending';
}
