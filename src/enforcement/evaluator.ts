/**
 * Evaluador de enforcement rules.
 *
 * Usado por skills (vía MCP) y por `dd-cli doctor --for=<type>`.
 *
 * Referencia: skills/ENFORCEMENT.md
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { SessionState } from '../types/session.js';
import { RULES, rulesForDevType } from './rules.js';
import type { EvaluationContext, EvaluationResult } from './rules.js';

export interface EvaluateOptions {
  projectRoot: string;
  session: SessionState;
  /** Si se pasa, solo evalúa estas reglas. Si no, usa todas las que aplican al dev_type. */
  ruleIds?: string[];
}

/**
 * Evalúa las reglas aplicables al dev_type de la sesión (o el subset indicado).
 * Devuelve resultado por regla — el caller decide qué hacer con block/warn/audit.
 */
export function evaluateRules({
  projectRoot,
  session,
  ruleIds,
}: EvaluateOptions): EvaluationResult[] {
  const ctx: EvaluationContext = {
    projectRoot,
    session,
    fileExists: (relPath: string) => existsSync(path.join(projectRoot, relPath)),
  };

  let rulesToEvaluate;
  if (ruleIds && ruleIds.length > 0) {
    rulesToEvaluate = ruleIds
      .map((id) => RULES[id])
      .filter((r): r is NonNullable<typeof r> => r !== undefined);
  } else if (session.dev_type) {
    rulesToEvaluate = rulesForDevType(session.dev_type);
  } else {
    return [];
  }

  return rulesToEvaluate.map((r) => r.evaluate(ctx));
}

/**
 * Particiona los resultados por severidad.
 */
export function partition(results: EvaluationResult[]): {
  blockers: EvaluationResult[];
  warnings: EvaluationResult[];
  audits: EvaluationResult[];
} {
  return {
    blockers: results.filter((r) => !r.passed && r.severity === 'block'),
    warnings: results.filter((r) => !r.passed && r.severity === 'warn'),
    audits: results.filter((r) => r.severity === 'audit'),
  };
}

/**
 * Formatea los resultados como output para `dd-cli doctor --for=<type>`.
 */
export function formatDoctorOutput(
  results: EvaluationResult[],
  devType: SessionState['dev_type']
): string {
  const lines: string[] = [];
  lines.push(`Validación para dev_type: ${devType ?? '(no definido)'}`);
  for (const r of results) {
    const icon = r.passed ? '✓' : r.severity === 'block' ? '✗' : '⚠';
    lines.push(`  ${icon} ${r.rule_id} — ${r.message}`);
  }
  const { blockers } = partition(results);
  if (blockers.length === 0) {
    lines.push('');
    lines.push('Resultado: ✓ Todas las precondiciones OK');
  } else {
    lines.push('');
    lines.push(`Resultado: ${blockers.length} regla(s) violada(s)`);
  }
  return lines.join('\n');
}
