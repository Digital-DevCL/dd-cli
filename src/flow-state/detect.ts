/**
 * Algoritmo detectFlowState() — máquina de estados del flujo de DevFlow IA.
 *
 * El heartbeat de dd-cli llama esta función en cada tool use de Claude Code.
 * Evalúa el filesystem y devuelve el flow_state vigente.
 *
 * Referencia: manual-implementacion/dd-cli-spec.md §5
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { globbySync } from 'globby';
import type { SessionState, FlowState } from '../types/session.js';
import { requiresRepoContext, requiresBaseline } from '../types/dev-type.js';

export interface DetectFlowStateOptions {
  projectRoot: string;
  session: SessionState;
}

/**
 * Detecta el flow_state vigente leyendo session.json + filesystem.
 * Es la fuente de verdad: el dev NO actualiza flow_state manualmente.
 */
export function detectFlowState({
  projectRoot,
  session,
}: DetectFlowStateOptions): FlowState {
  // 1) Sesión cerrada
  if (session.ended_at) return 'ended';

  // 2) Sesión no iniciada
  if (!session.started_at) return 'not_started';

  const devType = session.dev_type;
  const needsRepoContext = devType !== null && requiresRepoContext(devType);
  const needsBaseline = devType !== null && requiresBaseline(devType);

  // 3) Spec + lock presente → estados terminales
  const specPath = path.join(projectRoot, '.ai/SPEC.md');
  const hasSpec = existsSync(specPath) && statSync(specPath).size > 100;
  const isLocked = session.dev_type_locked === true;

  if (hasSpec && isLocked) {
    const changes = globbySync('openspec/changes/*/tasks.md', { cwd: projectRoot });
    if (changes.length > 0) return 'change_active';
    return 'spec_ready';
  }

  // 4) Estados intermedios según dev_type
  if (needsBaseline) {
    const baselineFiles = globbySync('.ai/BASELINE-*.md', { cwd: projectRoot });
    const hasLockedBaseline = baselineFiles.some((f) =>
      hasLockedFrontmatter(path.join(projectRoot, f))
    );
    if (hasLockedBaseline) return 'baseline_ready';

    // Aún falta baseline → si ya tiene REPO-CONTEXT, queda en repo_mapped
    const repoContextPath = path.join(projectRoot, '.ai/REPO-CONTEXT.md');
    if (existsSync(repoContextPath)) return 'repo_mapped';

    return 'started';
  }

  if (needsRepoContext) {
    const repoContextPath = path.join(projectRoot, '.ai/REPO-CONTEXT.md');
    if (existsSync(repoContextPath)) return 'repo_mapped';
    return 'started';
  }

  // greenfield: salta repo_mapped y baseline_ready
  return 'started';
}

/**
 * Lee el frontmatter YAML de un BASELINE.md y verifica si tiene locked_at != null.
 */
function hasLockedFrontmatter(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  const content = readFileSync(filePath, 'utf-8');
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return false;
  const frontmatter = fmMatch[1] ?? '';
  // Búsqueda simple: locked_at: <valor no-null>
  const lockedAtMatch = frontmatter.match(/^locked_at:\s*(.+)$/m);
  if (!lockedAtMatch) return false;
  const value = (lockedAtMatch[1] ?? '').trim();
  return value !== 'null' && value !== '' && value !== '~';
}

/**
 * Devuelve el siguiente paso esperado dado (flow_state, dev_type).
 * Usado por `dd-cli status` y `dd-cli watch`.
 *
 * Referencia: dd-cli-spec.md §5 (tabla "Mensajes contextuales por estado y dev_type")
 */
export function suggestedNextStep(
  flowState: FlowState,
  devType: SessionState['dev_type']
): string {
  if (flowState === 'not_started') {
    return 'Ejecuta `dd-cli start-session <feature-id>` para iniciar una sesión';
  }

  if (flowState === 'started') {
    if (!devType || devType === 'greenfield') {
      return 'Ejecuta `/new-spec` para generar SPEC maestra';
    }
    if (devType === 'modernizacion') {
      return 'Ejecuta `/init-repo-context --on=<legacy-path>` para mapear sistema legacy';
    }
    if (devType === 'integracion-externa') {
      return 'Si tocás app existente: `/init-repo-context`. Si es greenfield: `/new-spec` directo';
    }
    // brownfield-*
    return 'Ejecuta `/init-repo-context` para mapear el repo existente';
  }

  if (flowState === 'repo_mapped') {
    if (devType === 'brownfield-feature') {
      return 'Ejecuta `/new-spec` — la entrevista será breve gracias a REPO-CONTEXT';
    }
    if (devType === 'brownfield-refactor') {
      return 'Ejecuta `/map-service` + `/capture-baseline` antes de `/new-spec`';
    }
    if (devType === 'modernizacion') {
      return 'Ejecuta `/trace-flow` + `/map-service` antes de `/new-spec`';
    }
    if (devType === 'integracion-externa') {
      return 'Ejecuta `/new-spec(I)` — con info del vendor en HDU';
    }
  }

  if (flowState === 'baseline_ready') {
    return 'BASELINE listo. Ejecuta `/new-spec(R)` con plan de no-regresión';
  }

  if (flowState === 'spec_ready') {
    return 'Ejecuta `/opsx:propose <change-name>` para diseñar el cambio';
  }

  if (flowState === 'change_active') {
    return 'Continúa tasks con `/opsx:apply`';
  }

  return 'Sesión cerrada. Para retomar: `dd-cli start-session <feature-id>`';
}
