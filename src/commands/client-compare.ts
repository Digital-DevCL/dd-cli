/**
 * `dd-cli client compare <slugA> <slugB> [--aspect=stack|auth|cicd|all]` (S7-4).
 *
 * Compara dos clientes en un aspecto específico. Útil cuando:
 *   - Empezás un cliente nuevo y querés ver qué patrones ya usaste antes.
 *   - Querés alinear stack/auth/cicd entre clientes similares.
 *   - El consultor quiere reportar consistencia cross-cliente.
 *
 * Aspectos soportados:
 *   stack   — backend, frontend, db, infra, cicd_platform
 *   auth    — auth profiles distintos en cada catalog
 *   cicd    — cicd profiles + variantes detectadas
 *   apps    — overlap por tipo de app (microservice vs frontend, etc)
 *   all     — todos los anteriores
 *
 * Output JSON estructurado para que /devflow-ia:client-board lo
 * consuma en futuras evoluciones.
 */
import { existsSync } from 'node:fs';
import { getClient, getClientCacheDir } from '../types/registry.js';
import { loadStackConfig } from '../types/stack-config.js';
import { loadCatalog } from '../types/catalog.js';
import { isJsonMode, emitJson, jsonSuccess, jsonError, type JsonModeOpts } from '../utils/json-output.js';
import { printOk, printWarn, printErr, printDim, bold } from '../utils/output.js';

export interface ClientCompareOpts extends JsonModeOpts {
  aspect?: string;       // stack | auth | cicd | apps | all
}

interface CompareSection<T> {
  shared: T[];
  only_a: T[];
  only_b: T[];
}

function diffSets<T>(a: T[], b: T[]): CompareSection<T> {
  const setA = new Set(a);
  const setB = new Set(b);
  return {
    shared: [...setA].filter(x => setB.has(x)),
    only_a: [...setA].filter(x => !setB.has(x)),
    only_b: [...setB].filter(x => !setA.has(x)),
  };
}

export async function runClientCompare(slugA: string, slugB: string, opts: ClientCompareOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);

  if (!slugA || !slugB) {
    const e = { code: 'INVALID_INPUT' as const, message: 'Uso: dd-cli client compare <slugA> <slugB> [--aspect=stack|auth|cicd|apps|all]' };
    if (jsonMode) emitJson(jsonError({ command: 'client compare', ...e }));
    printErr(e.message);
    return 3;
  }

  const aspect = opts.aspect ?? 'all';
  if (!['stack', 'auth', 'cicd', 'apps', 'all'].includes(aspect)) {
    const e = {
      code: 'INVALID_INPUT' as const,
      message: `--aspect=${aspect} inválido. Usá: stack | auth | cicd | apps | all`,
    };
    if (jsonMode) emitJson(jsonError({ command: 'client compare', ...e }));
    printErr(e.message);
    return 3;
  }

  for (const slug of [slugA, slugB]) {
    const entry = getClient(slug);
    if (!entry) {
      const e = {
        code: 'CLIENT_NOT_REGISTERED' as const,
        message: `Cliente "${slug}" no registrado.`,
        recovery_hints: [`dd-cli client list para ver los registrados`],
      };
      if (jsonMode) emitJson(jsonError({ command: 'client compare', ...e }));
      printErr(e.message);
      return 2;
    }
    if (!existsSync(getClientCacheDir(slug))) {
      const e = {
        code: 'CONTEXT_CACHE_MISSING' as const,
        message: `Cache local no encontrada para "${slug}".`,
        recovery_hints: [`dd-cli pull-context ${slug}`],
      };
      if (jsonMode) emitJson(jsonError({ command: 'client compare', ...e }));
      printErr(e.message);
      return 2;
    }
  }

  const cacheA = getClientCacheDir(slugA);
  const cacheB = getClientCacheDir(slugB);
  const stackA = (() => { try { return loadStackConfig(cacheA); } catch { return null; } })();
  const stackB = (() => { try { return loadStackConfig(cacheB); } catch { return null; } })();
  const catalogA = (() => { try { return loadCatalog(cacheA); } catch { return null; } })();
  const catalogB = (() => { try { return loadCatalog(cacheB); } catch { return null; } })();

  const sections: Record<string, unknown> = {};

  // ── Stack ──────────────────────────────────────────────────────────
  if (aspect === 'stack' || aspect === 'all') {
    sections['stack'] = {
      a: stackA ? {
        backend: stackA.stack.backend_framework,
        frontend: stackA.stack.frontend_framework,
        databases: stackA.stack.databases,
        infra: stackA.stack.infra,
        cicd_platform: stackA.stack.cicd_platform,
      } : null,
      b: stackB ? {
        backend: stackB.stack.backend_framework,
        frontend: stackB.stack.frontend_framework,
        databases: stackB.stack.databases,
        infra: stackB.stack.infra,
        cicd_platform: stackB.stack.cicd_platform,
      } : null,
      databases_diff: stackA && stackB
        ? diffSets(stackA.stack.databases, stackB.stack.databases)
        : null,
    };
  }

  // ── Auth profiles ──────────────────────────────────────────────────
  if (aspect === 'auth' || aspect === 'all') {
    const authA = [...new Set((catalogA?.apps ?? []).map(a => a.auth_profile).filter(Boolean) as string[])];
    const authB = [...new Set((catalogB?.apps ?? []).map(a => a.auth_profile).filter(Boolean) as string[])];
    sections['auth'] = {
      a: authA,
      b: authB,
      diff: diffSets(authA, authB),
    };
  }

  // ── CI/CD profiles ─────────────────────────────────────────────────
  if (aspect === 'cicd' || aspect === 'all') {
    const cicdA = [...new Set((catalogA?.apps ?? []).map(a => a.ci_cd_profile).filter(p => Boolean(p) && p !== '[por-confirmar]') as string[])];
    const cicdB = [...new Set((catalogB?.apps ?? []).map(a => a.ci_cd_profile).filter(p => Boolean(p) && p !== '[por-confirmar]') as string[])];
    sections['cicd'] = {
      a: cicdA,
      b: cicdB,
      diff: diffSets(cicdA, cicdB),
    };
  }

  // ── Apps por tipo ──────────────────────────────────────────────────
  if (aspect === 'apps' || aspect === 'all') {
    const countByType = (cat: ReturnType<typeof loadCatalog>): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const app of cat?.apps ?? []) {
        out[app.type] = (out[app.type] ?? 0) + 1;
      }
      return out;
    };
    sections['apps'] = {
      a: countByType(catalogA),
      b: countByType(catalogB),
      total_a: catalogA?.apps.length ?? 0,
      total_b: catalogB?.apps.length ?? 0,
    };
  }

  if (jsonMode) {
    emitJson(jsonSuccess('client compare', {
      a: slugA,
      b: slugB,
      aspect,
      sections,
    }));
  }

  // ── Render humano ──────────────────────────────────────────────────
  console.log('');
  console.log(`  ${bold(slugA)}  ${bold('vs')}  ${bold(slugB)}    (aspect: ${aspect})`);
  console.log('');

  if (sections['stack']) {
    const s = sections['stack'] as { a: any; b: any; databases_diff: CompareSection<string> | null };
    console.log(bold('  STACK'));
    if (!s.a || !s.b) {
      printDim(`  (uno de los clientes no tiene stack.yml)`);
    } else {
      console.log(`    backend       ${s.a.backend}`);
      console.log(`                  ${s.b.backend}    ${s.a.backend === s.b.backend ? '✓ igual' : '⚠ distinto'}`);
      console.log(`    frontend      ${s.a.frontend}`);
      console.log(`                  ${s.b.frontend}    ${s.a.frontend === s.b.frontend ? '✓ igual' : '⚠ distinto'}`);
      console.log(`    infra         ${s.a.infra}`);
      console.log(`                  ${s.b.infra}    ${s.a.infra === s.b.infra ? '✓ igual' : '⚠ distinto'}`);
      console.log(`    cicd          ${s.a.cicd_platform}`);
      console.log(`                  ${s.b.cicd_platform}    ${s.a.cicd_platform === s.b.cicd_platform ? '✓ igual' : '⚠ distinto'}`);
      if (s.databases_diff) {
        if (s.databases_diff.shared.length > 0) printDim(`    DBs compartidas: ${s.databases_diff.shared.join(', ')}`);
        if (s.databases_diff.only_a.length > 0) printDim(`    Solo en ${slugA}: ${s.databases_diff.only_a.join(', ')}`);
        if (s.databases_diff.only_b.length > 0) printDim(`    Solo en ${slugB}: ${s.databases_diff.only_b.join(', ')}`);
      }
    }
    console.log('');
  }

  if (sections['auth']) {
    const s = sections['auth'] as { a: string[]; b: string[]; diff: CompareSection<string> };
    console.log(bold('  AUTH PROFILES'));
    if (s.diff.shared.length > 0) printDim(`    compartidos: ${s.diff.shared.join(', ')}`);
    if (s.diff.only_a.length > 0) printDim(`    solo en ${slugA}: ${s.diff.only_a.join(', ')}`);
    if (s.diff.only_b.length > 0) printDim(`    solo en ${slugB}: ${s.diff.only_b.join(', ')}`);
    if (s.a.length === 0 && s.b.length === 0) printDim('    (ninguno tiene auth profiles definidos)');
    console.log('');
  }

  if (sections['cicd']) {
    const s = sections['cicd'] as { a: string[]; b: string[]; diff: CompareSection<string> };
    console.log(bold('  CI/CD PROFILES'));
    if (s.diff.shared.length > 0) printDim(`    compartidos: ${s.diff.shared.join(', ')}`);
    if (s.diff.only_a.length > 0) printDim(`    solo en ${slugA}: ${s.diff.only_a.join(', ')}`);
    if (s.diff.only_b.length > 0) printDim(`    solo en ${slugB}: ${s.diff.only_b.join(', ')}`);
    if (s.a.length === 0 && s.b.length === 0) printDim('    (ninguno tiene ci_cd profiles concretos)');
    console.log('');
  }

  if (sections['apps']) {
    const s = sections['apps'] as { a: Record<string, number>; b: Record<string, number>; total_a: number; total_b: number };
    console.log(bold('  APPS'));
    console.log(`    total         ${slugA}: ${s.total_a}     ${slugB}: ${s.total_b}`);
    const types = new Set([...Object.keys(s.a), ...Object.keys(s.b)]);
    for (const type of types) {
      const ca = s.a[type] ?? 0;
      const cb = s.b[type] ?? 0;
      printDim(`    ${type.padEnd(15)}  ${ca.toString().padStart(3)}  ${cb.toString().padStart(3)}`);
    }
    console.log('');
  }

  return 0;
}
