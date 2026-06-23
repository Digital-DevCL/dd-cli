/**
 * @devflow-ia/cli — exports públicos.
 * Permite que otras herramientas (skills, tests, plataforma) consuman
 * la lógica core sin invocar el binario.
 */
export * from './types/dev-type.js';
export * from './types/session.js';
export * from './flow-state/detect.js';
export * from './enforcement/rules.js';
export * from './enforcement/evaluator.js';
export * from './utils/paths.js';
export * from './utils/session-io.js';

export const CLI_VERSION = '0.3.0';
