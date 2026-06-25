/**
 * Códigos de error estables del CLI.
 *
 * Contrato bajo D-7 (sección 4.8) y D-8 (Parte 3) del rediseño:
 * los códigos son estables entre versiones y las skills + Claude los
 * mapean a recovery hints conversacionales. Agregar códigos nuevos
 * al final de la lista correspondiente; no renombrar ni reusar.
 *
 * Convención: SCREAMING_SNAKE_CASE. Prefijo por dominio cuando aplica.
 */

export const ERROR_CODES = [
  // ── Genéricos ───────────────────────────────────────────────────────
  'INTERNAL_ERROR',
  'NOT_IMPLEMENTED',
  'INVALID_INPUT',
  'PERMISSION_DENIED',
  'NETWORK_ERROR',

  // ── Proyecto / config local ─────────────────────────────────────────
  'PROJECT_NOT_INITIALIZED',
  'CONFIG_INVALID',
  'CONFIG_MISSING',

  // ── Cliente / registry / cache ──────────────────────────────────────
  'CLIENT_NOT_REGISTERED',
  'CLIENT_ALREADY_REGISTERED',
  'CONTEXT_CACHE_MISSING',
  'CONTEXT_CACHE_STALE',
  'CONTEXT_REPO_EMPTY',
  'REGISTRY_INVALID',

  // ── Provider / git ──────────────────────────────────────────────────
  'TOKEN_MISSING',
  'TOKEN_INVALID',
  'TOKEN_INSUFFICIENT_SCOPE',
  'PROVIDER_NOT_SUPPORTED',
  'GIT_CLONE_FAILED',
  'GIT_PULL_FAILED',
  'GIT_PUSH_FAILED',

  // ── Schema / catalog / context ──────────────────────────────────────
  'CATALOG_PARSE_ERROR',
  'CATALOG_NOT_FOUND',
  'CONTEXT_REPO_INVALID',
  'STACK_CONFIG_MISSING',

  // ── Sesión / flujo ──────────────────────────────────────────────────
  'SESSION_NOT_STARTED',
  'SESSION_ALREADY_ACTIVE',
  'SESSION_INVALID',
  'PRECONDITION_NOT_MET',

  // ── HDU (futuro Sprint 5) ───────────────────────────────────────────
  'HDU_NOT_FOUND',
  'HDU_ID_COLLISION',
  'HDU_ALREADY_CLAIMED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Mapeo de exit code por dominio (referencia R-4 del doc).
 *   0 = éxito
 *   1 = error operacional (red, permisos, archivo no encontrado)
 *   2 = error de configuración / precondición no cumplida
 *   3 = error de schema / validación
 */
export function exitCodeFor(code: ErrorCode): 1 | 2 | 3 {
  switch (code) {
    case 'CONFIG_INVALID':
    case 'REGISTRY_INVALID':
    case 'CONTEXT_REPO_INVALID':
    case 'CATALOG_PARSE_ERROR':
    case 'INVALID_INPUT':
    case 'SESSION_INVALID':
      return 3;

    case 'PROJECT_NOT_INITIALIZED':
    case 'CONFIG_MISSING':
    case 'CLIENT_NOT_REGISTERED':
    case 'CONTEXT_CACHE_MISSING':
    case 'STACK_CONFIG_MISSING':
    case 'CATALOG_NOT_FOUND':
    case 'TOKEN_MISSING':
    case 'TOKEN_INSUFFICIENT_SCOPE':
    case 'SESSION_NOT_STARTED':
    case 'PRECONDITION_NOT_MET':
    case 'HDU_NOT_FOUND':
      return 2;

    default:
      return 1;
  }
}
