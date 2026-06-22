/**
 * `dd-cli pull-context`
 *
 * Actualiza la cache local del contexto del cliente.
 * Hace git pull en ~/.devflow/clients/<slug>/
 *
 * Lo usa el dev cuando el Tech Lead avisa que hay actualizaciones
 * en el catálogo de apps, auth profiles o CI/CD profiles.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getProjectRoot } from '../utils/paths.js';
import { loadProjectConfig } from '../types/project-config.js';
import { getClientCacheDir, updateLastSynced } from '../types/registry.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold } from '../utils/output.js';

function runGit(cmd: string, cwd: string): string {
  return execSync(cmd, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

export function runPullContext(): number {
  const projectRoot = getProjectRoot();

  // Leer config.yml del proyecto
  const config = loadProjectConfig(projectRoot);
  if (!config) {
    printErr('No se encontró .devflow/config.yml en este proyecto.');
    printInfo('¿Olvidaste conectar el repo al cliente?');
    printDim('  dd-cli init --client=<slug>');
    return 2;
  }

  const { slug, context_url } = config.client;
  const cacheDir = getClientCacheDir(slug);

  console.log(bold(`\nActualizando contexto del cliente: ${slug}\n`));
  printDim(`  Cache: ${cacheDir}`);
  printDim(`  Fuente: ${context_url}`);
  console.log('');

  // Si no hay cache, clonar
  if (!existsSync(cacheDir)) {
    printInfo('Cache local no encontrada. Clonando...');
    try {
      const { mkdirSync } = require('node:fs');
      const path = require('node:path');
      mkdirSync(path.dirname(cacheDir), { recursive: true });
      execSync(`git clone "${context_url}" "${cacheDir}"`, { stdio: 'pipe' });
      updateLastSynced(slug);
      printOk('Contexto clonado correctamente');
      return 0;
    } catch (e) {
      printErr(`Error al clonar: ${e instanceof Error ? e.message : String(e)}`);
      printDim('  Verifica que tienes acceso al repo del contexto.');
      return 1;
    }
  }

  // Obtener estado antes del pull
  let beforeHash = '';
  try {
    beforeHash = runGit('git rev-parse HEAD', cacheDir);
  } catch { /* ignorar */ }

  // Pull
  try {
    const pullOutput = runGit('git pull', cacheDir);

    if (pullOutput.includes('Already up to date')) {
      printOk('El contexto ya está actualizado — no hay cambios');
      updateLastSynced(slug);
      return 0;
    }

    printOk('Contexto actualizado');
    updateLastSynced(slug);

    // Mostrar qué cambió
    if (beforeHash) {
      try {
        const log = runGit(`git log ${beforeHash}..HEAD --oneline`, cacheDir);
        if (log) {
          console.log('');
          printDim('Cambios recibidos:');
          log.split('\n').forEach(l => printDim(`  ${l}`));
        }
      } catch { /* ignorar */ }
    }

    // Verificar si hay cambios en la app de este repo
    try {
      const appSlug = config.app.slug;
      const diff = runGit(
        `git diff ${beforeHash}..HEAD -- .devflow-context/app-catalog.md`,
        cacheDir
      );
      if (diff.includes(`+| ${appSlug}`) || diff.includes(`-| ${appSlug}`)) {
        console.log('');
        printWarn(`La entrada de "${appSlug}" en app-catalog.md cambió.`);
        printInfo('Revisa si necesitas actualizar .devflow/config.yml');
      }
    } catch { /* ignorar */ }

    return 0;
  } catch (e) {
    printErr(`Error al actualizar: ${e instanceof Error ? e.message : String(e)}`);
    printDim('  Verifica tu conexión y acceso al repo del contexto.');
    return 1;
  }
}
