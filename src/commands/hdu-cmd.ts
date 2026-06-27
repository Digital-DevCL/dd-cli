/**
 * Namespace `dd-cli hdu` (S5-2) — operaciones sobre HDUs del context repo
 * del cliente.
 *
 * Sub-comandos cubiertos en v0.7.0:
 *   hdu new <título>                crear draft
 *   hdu list [--client] [--status]  listar
 *   hdu show <HDU-id>                detalle + historial
 *   hdu assign <HDU-id> --to=<email>
 *   hdu claim <HDU-id>               auto-asignación
 *   hdu approve <HDU-id>             atajo Tech Lead
 *   hdu close <HDU-id>               in-review → done
 *   hdu cancel <HDU-id> --reason=
 *   hdu index                        regenera _index.yml
 *
 * Operan sobre el cache local del cliente. La publicación al remoto
 * es vía `dd-cli pull-context <slug>` (futuro: `dd-cli hdu push`).
 *
 * D-8: skill /devflow-ia:hdu-board (Sprint 5b) los compone para la cara humana.
 */
import { existsSync } from 'node:fs';
import { confirm, input } from '@inquirer/prompts';
import { getClient, getClientCacheDir } from '../types/registry.js';
import {
  HDU_STATUSES, HDU_PRIORITIES,
  type HduStatus, type HduPriority,
  HduFrontmatterSchema,
  parseHduFile, serializeHdu,
  listHdus, loadHdu, saveHdu,
  regenerateHduIndex, loadHduIndex,
  appendTransition, readTransitions,
  canHduTransitionTo, legalNextStatuses,
  getHdusDir, getHduFilePath,
  type Hdu,
} from '../types/hdu.js';
import { isJsonMode, emitJson, jsonSuccess, jsonError, type JsonModeOpts } from '../utils/json-output.js';
import { DEV_TYPES } from '../types/dev-type.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold } from '../utils/output.js';

const isTTY = process.stdout.isTTY;

export interface HduCommandOpts extends JsonModeOpts {
  client?: string;
}

/**
 * Resuelve el directorio del context repo de un cliente.
 */
function resolveCacheDir(clientSlug: string): { ok: true; cacheDir: string } | { ok: false; error: { code: 'CLIENT_NOT_REGISTERED' | 'CONTEXT_CACHE_MISSING'; message: string; context: Record<string, unknown> } } {
  const entry = getClient(clientSlug);
  if (!entry) {
    return {
      ok: false,
      error: {
        code: 'CLIENT_NOT_REGISTERED',
        message: `Cliente "${clientSlug}" no registrado en esta máquina.`,
        context: { slug: clientSlug },
      },
    };
  }
  const cacheDir = getClientCacheDir(clientSlug);
  if (!existsSync(cacheDir)) {
    return {
      ok: false,
      error: {
        code: 'CONTEXT_CACHE_MISSING',
        message: `Cache local no encontrada para "${clientSlug}".`,
        context: { slug: clientSlug, cache_dir: cacheDir },
      },
    };
  }
  return { ok: true, cacheDir };
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[áéíóúñ]/g, c => ({ á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ñ: 'n' }[c] ?? c))
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ── hdu new ─────────────────────────────────────────────────────────

export interface HduNewOpts extends HduCommandOpts {
  app?: string;             // apps_affected (puede repetirse)
  priority?: HduPriority;
  devType?: string;          // dev_type sugerido
  createdBy?: string;        // email
  assignedTo?: string;       // email
  direct?: boolean;          // S7-7: si está, status=approved + via=direct-commit
  reason?: string;            // requerido si --direct
}

export async function runHduNew(title: string, opts: HduNewOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);

  if (!title || title.trim().length === 0) {
    const e = { code: 'INVALID_INPUT' as const, message: 'Falta el título. Uso: dd-cli hdu new "<título>" --client=<slug>' };
    if (jsonMode) emitJson(jsonError({ command: 'hdu new', ...e }));
    printErr(e.message);
    return 3;
  }

  if (!opts.client) {
    const e = { code: 'INVALID_INPUT' as const, message: 'Falta --client=<slug>. Uso: dd-cli hdu new "<título>" --client=<slug>' };
    if (jsonMode) emitJson(jsonError({ command: 'hdu new', ...e }));
    printErr(e.message);
    return 3;
  }

  const r = resolveCacheDir(opts.client);
  if (!r.ok) {
    if (jsonMode) emitJson(jsonError({ command: 'hdu new', ...r.error }));
    printErr(r.error.message);
    return 2;
  }
  const { cacheDir } = r;

  // Calcular el próximo ID
  const index = regenerateHduIndex(cacheDir);
  const nextId = `HDU-${index.next_hdu_id}`;
  const slug = slugify(title);
  const filename = `${nextId}-${slug}.md`;
  const now = new Date().toISOString();

  const apps = opts.app ? [opts.app] : [];
  const devType = (DEV_TYPES as readonly string[]).includes(opts.devType ?? '') ? opts.devType : undefined;

  // S7-7: --direct requiere --reason explícito (audit trail) y crea directamente
  // en 'approved' sin pasar por draft. Útil para hotfix donde no hay TL disponible.
  if (opts.direct && !opts.reason) {
    const e = {
      code: 'INVALID_INPUT' as const,
      message: '--direct requiere --reason explícito para audit trail.',
      recovery_hints: ['Ejemplo: --direct --reason="hotfix prod incidente #123"'],
    };
    if (jsonMode) emitJson(jsonError({ command: 'hdu new', ...e }));
    printErr(e.message);
    return 3;
  }

  const initialStatus = opts.direct ? 'approved' : 'draft';
  const createdBy = opts.createdBy ?? 'unknown@local';
  const directReason = opts.direct ? opts.reason! : null;

  const hdu: Hdu = {
    filename,
    frontmatter: HduFrontmatterSchema.parse({
      id: nextId,
      title,
      status: initialStatus,
      dev_type: devType,
      dev_type_locked: opts.direct ?? false,
      dev_type_source: opts.direct ? 'direct-commit' : undefined,
      priority: opts.priority ?? 'media',
      apps_affected: apps,
      assigned_to: opts.assignedTo ?? null,
      created_by: createdBy,
      created_at: now,
      approved_by: opts.direct ? createdBy : null,
      approved_at: opts.direct ? now : null,
      sprint: null,
      tags: opts.direct ? ['direct-commit'] : [],
    }),
    body: `## Como\n(perfil del usuario)\n\n## Quiero\n(qué funcionalidad)\n\n## Para\n(qué valor de negocio)\n\n## Criterios de aceptación\n- [ ] Dado X, cuando Y, entonces Z\n\n## Notas técnicas\n(contexto para el dev)\n`,
  };

  saveHdu(cacheDir, hdu);

  // Append a transitions log
  if (opts.direct) {
    // Una sola transición: null → approved
    appendTransition(cacheDir, {
      ts: now,
      hdu: nextId,
      from: null,
      to: 'approved',
      by: createdBy,
      reason: directReason,
      via: 'direct-commit',
    });
  } else {
    appendTransition(cacheDir, {
      ts: now,
      hdu: nextId,
      from: null,
      to: 'draft',
      by: createdBy,
      reason: 'created',
      via: 'cli',
    });
  }

  // Regenerar index
  regenerateHduIndex(cacheDir);

  if (jsonMode) {
    emitJson(jsonSuccess('hdu new', {
      id: nextId,
      title,
      filename,
      path: getHduFilePath(cacheDir, nextId, slug),
      status: 'draft',
    }, `dd-cli hdu approve ${nextId} --client=${opts.client}`));
  }

  printOk(`HDU creada: ${bold(nextId)} · ${title}`);
  printDim(`  ${getHdusDir(cacheDir)}/${filename}`);
  console.log('');
  printInfo('Próximo: editar el archivo + dd-cli hdu approve cuando esté lista');
  return 0;
}

// ── hdu list ────────────────────────────────────────────────────────

export interface HduListOpts extends HduCommandOpts {
  status?: string;
  mine?: boolean;
  user?: string;             // email para filtrar mine
}

export async function runHduList(opts: HduListOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);

  if (!opts.client) {
    const e = { code: 'INVALID_INPUT' as const, message: 'Falta --client=<slug>.' };
    if (jsonMode) emitJson(jsonError({ command: 'hdu list', ...e }));
    printErr(e.message);
    return 3;
  }

  const r = resolveCacheDir(opts.client);
  if (!r.ok) {
    if (jsonMode) emitJson(jsonError({ command: 'hdu list', ...r.error }));
    printErr(r.error.message);
    return 2;
  }

  let hdus = listHdus(r.cacheDir);

  if (opts.status) {
    if (!(HDU_STATUSES as readonly string[]).includes(opts.status)) {
      const e = { code: 'INVALID_INPUT' as const, message: `--status=${opts.status} no es válido. Opciones: ${HDU_STATUSES.join(', ')}` };
      if (jsonMode) emitJson(jsonError({ command: 'hdu list', ...e }));
      printErr(e.message);
      return 3;
    }
    hdus = hdus.filter(h => h.frontmatter.status === opts.status);
  }

  if (opts.mine && opts.user) {
    hdus = hdus.filter(h => h.frontmatter.assigned_to === opts.user);
  }

  if (jsonMode) {
    emitJson(jsonSuccess('hdu list', {
      client: opts.client,
      total: hdus.length,
      hdus: hdus.map(h => ({
        id: h.frontmatter.id,
        title: h.frontmatter.title,
        status: h.frontmatter.status,
        priority: h.frontmatter.priority,
        assigned_to: h.frontmatter.assigned_to,
        apps_affected: h.frontmatter.apps_affected,
        dev_type: h.frontmatter.dev_type,
      })),
    }));
  }

  console.log('');
  if (hdus.length === 0) {
    printDim('  (ninguna HDU)');
    return 0;
  }
  for (const h of hdus) {
    const fm = h.frontmatter;
    console.log(`  ${bold(fm.id.padEnd(10))} ${fm.status.padEnd(13)} ${fm.priority.padEnd(8)} ${fm.title}`);
    if (fm.apps_affected.length > 0 || fm.assigned_to) {
      const parts: string[] = [];
      if (fm.apps_affected.length > 0) parts.push(fm.apps_affected.join(', '));
      if (fm.assigned_to) parts.push(`→ ${fm.assigned_to}`);
      printDim(`    ${parts.join(' · ')}`);
    }
  }
  console.log('');
  printDim(`  Total: ${hdus.length}`);
  return 0;
}

// ── hdu show ────────────────────────────────────────────────────────

export interface HduShowOpts extends HduCommandOpts {}

export async function runHduShow(hduId: string, opts: HduShowOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);

  if (!hduId || !opts.client) {
    const e = { code: 'INVALID_INPUT' as const, message: 'Uso: dd-cli hdu show <HDU-id> --client=<slug>' };
    if (jsonMode) emitJson(jsonError({ command: 'hdu show', ...e }));
    printErr(e.message);
    return 3;
  }

  const r = resolveCacheDir(opts.client);
  if (!r.ok) {
    if (jsonMode) emitJson(jsonError({ command: 'hdu show', ...r.error }));
    printErr(r.error.message);
    return 2;
  }

  const hdus = listHdus(r.cacheDir);
  const hdu = hdus.find(h => h.frontmatter.id === hduId);
  if (!hdu) {
    const e = {
      code: 'HDU_NOT_FOUND' as const,
      message: `HDU "${hduId}" no existe en el contexto de ${opts.client}.`,
      recovery_hints: [`Listar: dd-cli hdu list --client=${opts.client}`],
    };
    if (jsonMode) emitJson(jsonError({ command: 'hdu show', ...e }));
    printErr(e.message);
    return 2;
  }

  const transitions = readTransitions(r.cacheDir).filter(t => t.hdu === hduId);

  if (jsonMode) {
    emitJson(jsonSuccess('hdu show', {
      ...hdu.frontmatter,
      body: hdu.body,
      transitions,
    }));
  }

  const fm = hdu.frontmatter;
  console.log('');
  console.log(`  ${bold(fm.id)} · ${fm.title}`);
  console.log(`  ${fm.status.padEnd(13)} ${fm.priority.padEnd(8)} ${fm.dev_type ?? '(sin dev_type)'}`);
  if (fm.apps_affected.length > 0) printDim(`  apps: ${fm.apps_affected.join(', ')}`);
  if (fm.assigned_to) printDim(`  asignada a: ${fm.assigned_to}`);
  if (fm.sprint) printDim(`  sprint: ${fm.sprint}`);
  console.log('');
  console.log(hdu.body);
  if (transitions.length > 0) {
    console.log('');
    console.log(bold('  Historial:'));
    for (const t of transitions) {
      printDim(`    ${t.ts}  ${t.from ?? '(none)'} → ${t.to}  por ${t.by}${t.reason ? ' · ' + t.reason : ''}`);
    }
  }
  return 0;
}

// ── hdu transition helper ───────────────────────────────────────────

interface TransitionOptsBase extends HduCommandOpts {
  by?: string;            // email del actor
  reason?: string;
}

async function transitionHdu(
  command: string,
  hduId: string,
  toStatus: HduStatus,
  opts: TransitionOptsBase,
  mutator?: (hdu: Hdu) => void
): Promise<number> {
  const jsonMode = isJsonMode(opts);

  if (!hduId || !opts.client) {
    const e = { code: 'INVALID_INPUT' as const, message: `Uso: dd-cli ${command} <HDU-id> --client=<slug>` };
    if (jsonMode) emitJson(jsonError({ command, ...e }));
    printErr(e.message);
    return 3;
  }

  const r = resolveCacheDir(opts.client);
  if (!r.ok) {
    if (jsonMode) emitJson(jsonError({ command, ...r.error }));
    printErr(r.error.message);
    return 2;
  }

  const hdus = listHdus(r.cacheDir);
  const hdu = hdus.find(h => h.frontmatter.id === hduId);
  if (!hdu) {
    const e = {
      code: 'HDU_NOT_FOUND' as const,
      message: `HDU "${hduId}" no existe.`,
      recovery_hints: [`Listar: dd-cli hdu list --client=${opts.client}`],
    };
    if (jsonMode) emitJson(jsonError({ command, ...e }));
    printErr(e.message);
    return 2;
  }

  const fromStatus = hdu.frontmatter.status;

  if (fromStatus === toStatus) {
    if (jsonMode) {
      emitJson(jsonSuccess(command, { id: hduId, no_change: true, status: toStatus }));
    }
    printDim(`HDU ${hduId} ya está en ${toStatus}, nada que hacer.`);
    return 0;
  }

  if (!canHduTransitionTo(fromStatus, toStatus)) {
    const e = {
      code: 'INVALID_INPUT' as const,
      message: `Transición ilegal: ${fromStatus} → ${toStatus}. Legales desde ${fromStatus}: ${legalNextStatuses(fromStatus).join(', ')}.`,
      context: { from: fromStatus, to: toStatus, legal: legalNextStatuses(fromStatus) },
    };
    if (jsonMode) emitJson(jsonError({ command, ...e }));
    printErr(e.message);
    return 3;
  }

  hdu.frontmatter.status = toStatus;
  if (mutator) mutator(hdu);
  saveHdu(r.cacheDir, hdu);
  const now = new Date().toISOString();
  appendTransition(r.cacheDir, {
    ts: now,
    hdu: hduId,
    from: fromStatus,
    to: toStatus,
    by: opts.by ?? hdu.frontmatter.assigned_to ?? 'unknown@local',
    reason: opts.reason ?? null,
    via: 'cli',
  });
  regenerateHduIndex(r.cacheDir);

  if (jsonMode) {
    emitJson(jsonSuccess(command, {
      id: hduId,
      from: fromStatus,
      to: toStatus,
      status: toStatus,
    }));
  }

  printOk(`${hduId}: ${fromStatus} → ${bold(toStatus)}`);
  return 0;
}

// ── Sub-comandos de transición ──────────────────────────────────────

export async function runHduStart(hduId: string, opts: TransitionOptsBase = {}): Promise<number> {
  return transitionHdu('hdu start', hduId, 'in-progress', opts);
}

export async function runHduReview(hduId: string, opts: TransitionOptsBase = {}): Promise<number> {
  return transitionHdu('hdu review', hduId, 'in-review', opts);
}

export async function runHduApprove(hduId: string, opts: TransitionOptsBase = {}): Promise<number> {
  // F-01: advertir si la HDU no tiene criterios de aceptación con Gherkin
  if (opts.client && hduId) {
    const r = resolveCacheDir(opts.client);
    if (r.ok) {
      try {
        const hdu = listHdus(r.cacheDir).find(h => h.frontmatter.id === hduId);
        if (hdu) {
          const body = hdu.body ?? '';
          const hasGherkin = /##\s*Criterios/i.test(body) &&
            /(Dado|Cuando|Entonces|Given|When|Then)/i.test(body);
          const hasPendingDevType = !hdu.frontmatter.dev_type ||
            hdu.frontmatter.dev_type === 'pending';

          if (!hasGherkin) {
            printWarn('⚠  Esta HDU no tiene criterios de aceptación con Gherkin.');
            printDim('   Sin criterios, el SPEC quedará incompleto. Completalos con: /devflow-ia:enrich-us');
            if (!opts.yes && isTTY) {
              const proceed = await confirm({ message: '¿Aprobar igual?', default: false });
              if (!proceed) {
                printInfo('Aprobación cancelada. Completá los criterios primero.');
                return 1;
              }
            }
          }
          if (hasPendingDevType) {
            printWarn('⚠  dev_type está en "pending". El dev no sabrá qué journey seguir.');
            printDim('   Definilo con: /devflow-ia:design-hdu');
          }
        }
      } catch { /* si no se puede leer, transitionHdu maneja el error */ }
    }
  }

  return transitionHdu('hdu approve', hduId, 'approved', opts, (hdu) => {
    hdu.frontmatter.approved_by = opts.by ?? hdu.frontmatter.approved_by;
    hdu.frontmatter.approved_at = new Date().toISOString();
    if (opts.by) hdu.frontmatter.dev_type_source = 'tech-lead-approval';
  });
}

export async function runHduClose(hduId: string, opts: TransitionOptsBase = {}): Promise<number> {
  return transitionHdu('hdu close', hduId, 'done', opts);
}

export async function runHduCancel(hduId: string, opts: TransitionOptsBase = {}): Promise<number> {
  if (!opts.reason) {
    if (!isTTY) {
      const e = { code: 'INVALID_INPUT' as const, message: '--reason es obligatorio para cancelar.' };
      if (isJsonMode(opts)) emitJson(jsonError({ command: 'hdu cancel', ...e }));
      printErr(e.message);
      return 3;
    }
    opts.reason = await input({ message: 'Razón de cancelación:' });
  }
  return transitionHdu('hdu cancel', hduId, 'cancelled', opts);
}

// ── hdu assign / claim ──────────────────────────────────────────────

export interface HduAssignOpts extends HduCommandOpts {
  to: string;             // email
  by?: string;
}

export async function runHduAssign(hduId: string, opts: HduAssignOpts): Promise<number> {
  const jsonMode = isJsonMode(opts);

  if (!hduId || !opts.client || !opts.to) {
    const e = { code: 'INVALID_INPUT' as const, message: 'Uso: dd-cli hdu assign <HDU-id> --client=<slug> --to=<email>' };
    if (jsonMode) emitJson(jsonError({ command: 'hdu assign', ...e }));
    printErr(e.message);
    return 3;
  }

  const r = resolveCacheDir(opts.client);
  if (!r.ok) {
    if (jsonMode) emitJson(jsonError({ command: 'hdu assign', ...r.error }));
    printErr(r.error.message);
    return 2;
  }

  const hdus = listHdus(r.cacheDir);
  const hdu = hdus.find(h => h.frontmatter.id === hduId);
  if (!hdu) {
    const e = { code: 'HDU_NOT_FOUND' as const, message: `HDU "${hduId}" no existe.` };
    if (jsonMode) emitJson(jsonError({ command: 'hdu assign', ...e }));
    printErr(e.message);
    return 2;
  }

  const previous = hdu.frontmatter.assigned_to;
  hdu.frontmatter.assigned_to = opts.to;
  saveHdu(r.cacheDir, hdu);
  regenerateHduIndex(r.cacheDir);

  if (jsonMode) {
    emitJson(jsonSuccess('hdu assign', {
      id: hduId,
      previous_assignee: previous,
      assigned_to: opts.to,
    }));
  }

  printOk(`${hduId} asignada a ${opts.to}${previous ? ' (antes: ' + previous + ')' : ''}`);
  return 0;
}

export interface HduClaimOpts extends HduCommandOpts {
  user: string;
}

export async function runHduClaim(hduId: string, opts: HduClaimOpts): Promise<number> {
  return runHduAssign(hduId, { ...opts, to: opts.user });
}

// ── hdu pin ────────────────────────────────────────────────────────
// S7-7: Tech Lead fuerza una asignación + sobreescribe el scoring de hdu next.
// Reusa la lógica de assign pero agrega un tag `pinned-by-tl` y reason
// obligatoria para audit. La skill /devflow-ia:hdu-board usa esto cuando
// el TL quiere asignar fuera del orden recomendado por el scoring.

export interface HduPinOpts extends HduCommandOpts {
  to: string;             // email del dev pinneado
  by: string;             // email del TL (obligatorio para audit)
  reason: string;          // razón del pin
}

export async function runHduPin(hduId: string, opts: HduPinOpts): Promise<number> {
  const jsonMode = isJsonMode(opts);

  if (!hduId || !opts.client || !opts.to || !opts.by || !opts.reason) {
    const e = {
      code: 'INVALID_INPUT' as const,
      message: 'Uso: dd-cli hdu pin <HDU-id> --client=<slug> --to=<email> --by=<email-tl> --reason="..."',
      recovery_hints: [
        '--reason es obligatorio: el pin sobreescribe el scoring y queda en audit',
      ],
    };
    if (jsonMode) emitJson(jsonError({ command: 'hdu pin', ...e }));
    printErr(e.message);
    return 3;
  }

  const r = resolveCacheDir(opts.client);
  if (!r.ok) {
    if (jsonMode) emitJson(jsonError({ command: 'hdu pin', ...r.error }));
    printErr(r.error.message);
    return 2;
  }

  const hdus = listHdus(r.cacheDir);
  const hdu = hdus.find(h => h.frontmatter.id === hduId);
  if (!hdu) {
    const e = { code: 'HDU_NOT_FOUND' as const, message: `HDU "${hduId}" no existe.` };
    if (jsonMode) emitJson(jsonError({ command: 'hdu pin', ...e }));
    printErr(e.message);
    return 2;
  }

  const previous = hdu.frontmatter.assigned_to;
  hdu.frontmatter.assigned_to = opts.to;
  if (!hdu.frontmatter.tags.includes('pinned-by-tl')) {
    hdu.frontmatter.tags.push('pinned-by-tl');
  }
  saveHdu(r.cacheDir, hdu);

  // Pin queda en el transitions log con via:cli (no es transición de estado,
  // pero el log de transitions también acepta reasignaciones para audit).
  appendTransition(r.cacheDir, {
    ts: new Date().toISOString(),
    hdu: hduId,
    from: hdu.frontmatter.status,
    to: hdu.frontmatter.status,  // mismo estado, lo importante es el reason
    by: opts.by,
    reason: `pinned to ${opts.to}: ${opts.reason}${previous ? ` (era ${previous})` : ''}`,
    via: 'cli',
  });

  regenerateHduIndex(r.cacheDir);

  if (jsonMode) {
    emitJson(jsonSuccess('hdu pin', {
      id: hduId,
      previous_assignee: previous,
      pinned_to: opts.to,
      by: opts.by,
      reason: opts.reason,
    }));
  }

  printOk(`${hduId} pinneada a ${opts.to} por ${opts.by}${previous ? ` (antes: ${previous})` : ''}`);
  printDim(`  razón: ${opts.reason}`);
  return 0;
}

// ── hdu index ──────────────────────────────────────────────────────

export async function runHduIndexCmd(opts: HduCommandOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);

  if (!opts.client) {
    const e = { code: 'INVALID_INPUT' as const, message: 'Falta --client=<slug>.' };
    if (jsonMode) emitJson(jsonError({ command: 'hdu index', ...e }));
    printErr(e.message);
    return 3;
  }

  const r = resolveCacheDir(opts.client);
  if (!r.ok) {
    if (jsonMode) emitJson(jsonError({ command: 'hdu index', ...r.error }));
    printErr(r.error.message);
    return 2;
  }

  const index = regenerateHduIndex(r.cacheDir);

  if (jsonMode) {
    emitJson(jsonSuccess('hdu index', {
      client: opts.client,
      next_hdu_id: index.next_hdu_id,
      total_hdus: index.hdus.length,
      generated_at: index.generated_at,
    }));
  }

  printOk(`_index.yml regenerado: ${index.hdus.length} HDUs, próximo ID: HDU-${index.next_hdu_id}`);
  return 0;
}
