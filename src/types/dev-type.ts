/**
 * Tipos de desarrollo soportados por DevFlow IA.
 * Enum cerrado — agregar tipo requiere bump minor del CLI + actualización de
 * ENFORCEMENT.md y de las skills.
 *
 * Referencia: _Empresa/Productos/DevFlow-IA/MAPA_METODO.md §5.1
 */
export const DEV_TYPES = [
  'greenfield',
  'brownfield-feature',
  'brownfield-refactor',
  'modernizacion',
  'integracion-externa',
] as const;

export type DevType = (typeof DEV_TYPES)[number];

/**
 * Origen del valor de dev_type. Se guarda en session.json para audit-log.
 */
export type DevTypeSource =
  | 'business-brief' // PMO eligió en portal negocio
  | 'tech-lead-approval' // Tech Lead lo cambió al aprobar HDU
  | 'inherited' // heredado del app-catalog (single-app)
  | 'reclassify'; // post-lock vía dd-cli reclassify

/**
 * Metadata completa del dev_type asociada a una feature.
 * Vive en HDU.dev_type_meta y se replica en session.json al start-session.
 */
export interface DevTypeMeta {
  dev_type: DevType;
  dev_type_subtype: string | null; // texto libre, max 40 chars
  dev_type_source: DevTypeSource;
  dev_type_rationale: string; // max 300 chars, requerido
  dev_type_locked: boolean;
  dev_type_locked_at: string | null; // ISO 8601 al momento del lock
  dev_type_reclassified_from?: DevType; // si hubo reclasificación
}

/**
 * Origen del codebase de una app. Diferente de dev_type (que vive en la HDU).
 * Vive en app-catalog.md.
 */
export const APP_ORIGINS = ['greenfield-app', 'legacy-app', 'external-app'] as const;
export type AppOrigin = (typeof APP_ORIGINS)[number];

/**
 * Type guards
 */
export function isDevType(value: unknown): value is DevType {
  return typeof value === 'string' && (DEV_TYPES as readonly string[]).includes(value);
}

export function isAppOrigin(value: unknown): value is AppOrigin {
  return typeof value === 'string' && (APP_ORIGINS as readonly string[]).includes(value);
}

/**
 * Helpers de categorización
 */
export function isBrownfield(type: DevType): boolean {
  return type === 'brownfield-feature' || type === 'brownfield-refactor';
}

export function requiresRepoContext(type: DevType): boolean {
  return type !== 'greenfield';
  // integracion-externa puede no requerirlo si es app nueva,
  // pero el enforcement granular se hace en evaluator.ts
}

export function requiresBaseline(type: DevType): boolean {
  return type === 'brownfield-refactor';
}
