/**
 * State.json por cliente — fuente que Claude lee entre invocaciones
 * (D-7 Parte 3 / D-8 Parte 3 del rediseño).
 *
 * Vive en `~/.devflow/clients/<slug>/state.json` y se actualiza después
 * de cada comando que muta state del cliente. La skill `/devflow-ia:client-onboard`
 * y `/devflow-ia:troubleshoot` lo consumen para saber dónde estamos.
 *
 * Las máquinas de estado seguibles son las de D-3 / sección 4.0:
 *   REGISTERED → DISCOVERED → DRAFT → READY → ACTIVE → NEEDS_REFRESH
 */
import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { ERROR_CODES } from './error-codes.js';
import { getClientCacheDir, getDevflowGlobalDir } from '../types/registry.js';

// ── Schema ────────────────────────────────────────────────────────────

export const CLIENT_STATES = [
  'REGISTERED',
  'DISCOVERED',
  'DRAFT',
  'READY',
  'ACTIVE',
  'NEEDS_REFRESH',
] as const;
export type ClientStateName = (typeof CLIENT_STATES)[number];

/**
 * Máquina de estados explícita del cliente (S3-7, D-3 Parte 3 del rediseño).
 *
 *   (unknown)
 *      │  dd-cli client new
 *      ▼
 *   REGISTERED
 *      │  dd-cli client discover
 *      ▼
 *   DISCOVERED
 *      │  /devflow-ia:client-review (opcional, involucra LLM)
 *      ▼
 *   DRAFT
 *      │  dd-cli client publish
 *      ▼
 *   READY
 *      │  devs hacen dd-cli init --client=<slug>
 *      ▼
 *   ACTIVE
 *      │  pasa tiempo / hay commits upstream
 *      ▼
 *   NEEDS_REFRESH
 *      │  dd-cli client refresh
 *      ▼
 *   ACTIVE (vuelve)
 *
 * Las transiciones explícitas (mover state después de un comando) están en
 * STATE_TRANSITIONS. Las "regresiones" (READY → DISCOVERED tras un refresh
 * que cambia el contexto) también son válidas y se permiten explícitamente.
 */
const STATE_TRANSITIONS: Record<ClientStateName, ClientStateName[]> = {
  REGISTERED:    ['DISCOVERED', 'DRAFT'],            // discover → DISCOVERED; review → DRAFT
  DISCOVERED:    ['DRAFT', 'READY', 'DISCOVERED'],   // review → DRAFT; publish skip review → READY; re-discover idempotente
  DRAFT:         ['READY', 'DRAFT', 'DISCOVERED'],   // publish → READY; re-review → DRAFT; rollback a discovery
  READY:         ['ACTIVE', 'NEEDS_REFRESH', 'DRAFT', 'DISCOVERED'], // init → ACTIVE; refresh → DRAFT/DISCOVERED; rollback
  ACTIVE:        ['NEEDS_REFRESH', 'ACTIVE', 'READY'],
  NEEDS_REFRESH: ['DRAFT', 'DISCOVERED', 'READY', 'ACTIVE'],         // refresh → DRAFT; sync sin cambios → READY
};

/**
 * Valida si una transición de estado es legal.
 * Si `from` es `undefined`, solo se acepta llegar a REGISTERED (cliente nuevo).
 */
export function canTransitionTo(from: ClientStateName | undefined, to: ClientStateName): boolean {
  if (from === undefined) return to === 'REGISTERED';
  if (from === to) return STATE_TRANSITIONS[from].includes(to); // idempotente solo si está declarado
  return STATE_TRANSITIONS[from].includes(to);
}

/**
 * Sugiere el próximo estado natural del flujo de onboarding desde un estado dado.
 * Útil para `next_safe_command` y la skill /troubleshoot.
 */
export function nextNaturalState(from: ClientStateName | undefined): ClientStateName {
  if (from === undefined) return 'REGISTERED';
  const happyPath: Record<ClientStateName, ClientStateName> = {
    REGISTERED:    'DISCOVERED',
    DISCOVERED:    'DRAFT',
    DRAFT:         'READY',
    READY:         'ACTIVE',
    ACTIVE:        'ACTIVE',
    NEEDS_REFRESH: 'DRAFT',
  };
  return happyPath[from];
}

/**
 * Mapeo de cada estado al comando CLI sugerido para avanzar.
 * Permite que cualquier comando emita un `next_safe_command` coherente.
 */
export function suggestedCommandFor(state: ClientStateName, slug: string): string | null {
  switch (state) {
    case 'REGISTERED':    return `dd-cli client discover ${slug}`;
    case 'DISCOVERED':    return `dd-cli client publish ${slug}    # o /devflow-ia:client-review`;
    case 'DRAFT':         return `dd-cli client publish ${slug}`;
    case 'READY':         return `cd <repo-de-codigo> && dd-cli init --client=${slug}`;
    case 'ACTIVE':        return null;
    case 'NEEDS_REFRESH': return `dd-cli client refresh ${slug}`;
  }
}

export const PROVIDERS = ['gitlab', 'github'] as const;

const ClientStateErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  context: z.record(z.string(), z.unknown()).optional(),
  recovery_hints: z.array(z.string()).optional(),
}).passthrough();

export const ClientStateSchema = z.object({
  schema_version: z.literal('1.0').default('1.0'),
  slug: z.string(),
  state: z.enum(CLIENT_STATES),
  provider: z.enum(PROVIDERS).optional(),
  last_command: z.string(),
  last_command_at: z.string(),
  last_error: ClientStateErrorSchema.nullable().default(null),
  draft_path: z.string().optional(),
  open_gaps: z.number().int().nonnegative().optional(),
  next_safe_command: z.string().nullable().optional(),
});

export type ClientState = z.infer<typeof ClientStateSchema>;

// ── Paths ─────────────────────────────────────────────────────────────

export function getClientStatePath(slug: string): string {
  // state.json vive en el directorio del cliente al mismo nivel que la cache,
  // pero NO dentro de la cache git (sería commiteable y no debe serlo).
  return path.join(getDevflowGlobalDir(), 'clients', `${slug}.state.json`);
}

/**
 * Legacy fallback — antes de S2-3 algunas implementaciones podrían poner el
 * state.json dentro del cacheDir. Probamos ambos.
 */
function getStateCandidates(slug: string): string[] {
  return [
    getClientStatePath(slug),
    path.join(getClientCacheDir(slug), '..', `${slug}.state.json`),
  ];
}

// ── I/O ───────────────────────────────────────────────────────────────

export function readClientState(slug: string): ClientState | null {
  for (const candidate of getStateCandidates(slug)) {
    if (!existsSync(candidate)) continue;
    try {
      const raw = readFileSync(candidate, 'utf-8');
      const parsed = JSON.parse(raw);
      const result = ClientStateSchema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // Continúa con el siguiente candidato
    }
  }
  return null;
}

export function writeClientState(state: ClientState): void {
  const statePath = getClientStatePath(state.slug);
  mkdirSync(path.dirname(statePath), { recursive: true });
  const validated = ClientStateSchema.parse(state);
  writeFileSync(statePath, JSON.stringify(validated, null, 2) + '\n', 'utf-8');
}

/**
 * Actualiza el state.json del cliente fusionando un patch sobre el estado actual.
 * Si no existe, requiere `state` y `slug` mínimos en el patch para inicializar.
 *
 * Valida las transiciones de estado (S3-7). Si el patch incluye `state` y la
 * transición no es legal, tira con mensaje claro. Pasá `{ allowAnyTransition: true }`
 * como segundo arg de la función contenedora para casos legítimos de override
 * (ej: migración legacy).
 */
export function updateClientState(
  slug: string,
  patch: Partial<Omit<ClientState, 'slug'>>,
  opts: { allowAnyTransition?: boolean } = {}
): ClientState {
  const existing = readClientState(slug);
  const now = new Date().toISOString();

  // Validación de transición
  if (patch.state && !opts.allowAnyTransition) {
    const fromState = existing?.state;
    if (!canTransitionTo(fromState, patch.state)) {
      throw new Error(
        `Transición de estado inválida para "${slug}": ${fromState ?? '(none)'} → ${patch.state}. ` +
        `Transiciones legales desde ${fromState ?? '(none)'}: ${
          fromState ? STATE_TRANSITIONS[fromState].join(', ') : 'REGISTERED'
        }.`
      );
    }
  }

  const base = existing ?? {
    schema_version: '1.0' as const,
    slug,
    state: 'REGISTERED' as const,
    last_command: 'unknown',
    last_command_at: now,
    last_error: null,
  };

  const merged = {
    ...base,
    ...patch,
    slug,                                       // slug es inmutable
    last_command_at: patch.last_command_at ?? now,
  };

  const parsed = ClientStateSchema.parse(merged);
  writeClientState(parsed);
  return parsed;
}

/**
 * Conveniencia: registra el resultado de un comando.
 * Llamar al final de cada comando que muta state.
 */
export function recordCommandResult(
  slug: string,
  command: string,
  result: { success: true; state?: ClientState['state']; nextSafe?: string | null }
    | { success: false; error: NonNullable<ClientState['last_error']>; nextSafe?: string | null }
): void {
  if (result.success) {
    updateClientState(slug, {
      last_command: command,
      last_error: null,
      ...(result.state ? { state: result.state } : {}),
      ...(result.nextSafe !== undefined ? { next_safe_command: result.nextSafe } : {}),
    });
  } else {
    updateClientState(slug, {
      last_command: command,
      last_error: result.error,
      ...(result.nextSafe !== undefined ? { next_safe_command: result.nextSafe } : {}),
    });
  }
}
