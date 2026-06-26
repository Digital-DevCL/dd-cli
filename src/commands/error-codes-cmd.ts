/**
 * `dd-cli error-codes` (S4-8) — lista los códigos de error estables y exit codes
 * de la convención R-4 del rediseño.
 *
 * Es el contrato de errores que las skills y CI pueden consumir.
 * El JSON output es estable; agregar códigos al final, nunca renombrar.
 */
import { ERROR_CODES, exitCodeFor, type ErrorCode } from '../utils/error-codes.js';
import { isJsonMode, emitJson, jsonSuccess, type JsonModeOpts } from '../utils/json-output.js';
import { bold, printDim } from '../utils/output.js';

export interface ErrorCodesOpts extends JsonModeOpts {}

const EXIT_CODE_CATEGORIES: Record<1 | 2 | 3, string> = {
  1: 'Operacional (red, permisos, archivo no encontrado)',
  2: 'Precondición no cumplida (configuración, registro)',
  3: 'Validación (schema, input mal formado)',
};

export async function runErrorCodes(opts: ErrorCodesOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);

  // Agrupar por exit code
  const byExitCode: Record<1 | 2 | 3, ErrorCode[]> = { 1: [], 2: [], 3: [] };
  for (const code of ERROR_CODES) {
    byExitCode[exitCodeFor(code)].push(code);
  }

  if (jsonMode) {
    emitJson(jsonSuccess('error-codes', {
      exit_codes: {
        0: 'Éxito completo',
        1: EXIT_CODE_CATEGORIES[1],
        2: EXIT_CODE_CATEGORIES[2],
        3: EXIT_CODE_CATEGORIES[3],
      },
      total: ERROR_CODES.length,
      by_exit_code: byExitCode,
      codes: ERROR_CODES.map(code => ({
        code,
        exit_code: exitCodeFor(code),
      })),
    }));
  }

  console.log('');
  console.log(bold('Convención de exit codes (R-4 del rediseño)'));
  console.log('');
  console.log('  0  Éxito completo');
  for (const code of [1, 2, 3] as const) {
    console.log(`  ${code}  ${EXIT_CODE_CATEGORIES[code]}`);
  }
  console.log('');

  console.log(bold(`Códigos de error estables (${ERROR_CODES.length})`));
  console.log('');
  console.log('Estos códigos son contrato — son consumidos por las skills');
  console.log('y por integraciones de CI. Estables entre versiones del CLI.');
  console.log('');

  for (const exitCode of [3, 2, 1] as const) {
    if (byExitCode[exitCode].length === 0) continue;
    console.log(bold(`  Exit ${exitCode} — ${EXIT_CODE_CATEGORIES[exitCode]}`));
    for (const code of byExitCode[exitCode]) {
      console.log(`    ${code}`);
    }
    console.log('');
  }

  printDim('Para output JSON: dd-cli error-codes --json');
  return 0;
}
