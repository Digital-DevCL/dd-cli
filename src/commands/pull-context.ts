/**
 * `dd-cli pull-context [slug]`
 *
 * Actualiza la cache local del contexto del cliente.
 * Hace git pull en ~/.devflow/clients/<slug>/
 *
 * B-2 fix — acepta `slug` como argumento posicional opcional.
 *   Sin arg: lee `.devflow/config.yml` del CWD (comportamiento anterior).
 *   Con arg: usa el registry (~/.devflow/registry.yml) — funciona desde cualquier dir.
 *
 * Lo usa el dev cuando el Tech Lead avisa que hay actualizaciones
 * en el catálogo de apps, auth profiles o CI/CD profiles.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { getProjectRoot } from '../utils/paths.js';
import { loadProjectConfig } from '../types/project-config.js';
import { getClient, getClientCacheDir, updateLastSynced } from '../types/registry.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold } from '../utils/output.js';

function runGit(cmd: string, cwd: string): string {
  return execSync(cmd, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

export function runPullContext(slugArg?: string): number {
  let slug: string;
  let context_url: string;
  let appSlugFromLocalConfig: string | undefined;

  if (slugArg) {
    // Modo explícito — buscar en el registry global
    const entry = getClient(slugArg);
    if (!entry) {
      printErr(`Cliente "${slugArg}" no registrado en ~/.devflow/registry.yml.`);
      printInfo('Primero registra el cliente:');
      printDim(`  dd-cli register-client ${slugArg} --context-url=<url>`);
      return 2;
    }
    slug = entry.slug;
    context_url = entry.context_url;
  } else {
    // Modo implícito — leer config.yml del proyecto en CWD
    const projectRoot = getProjectRoot();
    const config = loadProjectConfig(projectRoot);
    if (!config) {
      printErr('No se encontró .devflow/config.yml en este proyecto.');
      printInfo('Opciones:');
      printDim('  • Conectar el repo al cliente: dd-cli init --client=<slug>');
      printDim('  • Sync explícito sin estar en un repo: dd-cli pull-context <slug>');
      return 2;
    }
    slug = config.client.slug;
    context_url = config.client.context_url;
    appSlugFromLocalConfig = config.app.slug;
  }

  const cacheDir = getClientCacheDir(slug);

  console.log(bold(`\nActualizando contexto del cliente: ${slug}\n`));
  printDim(`  Cache: ${cacheDir}`);
  printDim(`  Fuente: ${context_url}`);
  console.log('');

  // Si no hay cache, clonar
  if (!existsSync(cacheDir)) {
    printInfo('Cache local no encontrada. Clonando...');
    try {
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

    // Verificar si hay cambios en la app de este repo (sólo si invocado desde un repo)
    if (appSlugFromLocalConfig) {
      try {
        const diff = runGit(
          `git diff ${beforeHash}..HEAD -- .devflow-context/app-catalog.md`,
          cacheDir
        );
        if (diff.includes(`+| ${appSlugFromLocalConfig}`) || diff.includes(`-| ${appSlugFromLocalConfig}`)) {
          console.log('');
          printWarn(`La entrada de "${appSlugFromLocalConfig}" en app-catalog.md cambió.`);
          printInfo('Revisa si necesitas actualizar .devflow/config.yml');
        }
      } catch { /* ignorar */ }
    }

    return 0;
  } catch (e) {
    printErr(`Error al actualizar: ${e instanceof Error ? e.message : String(e)}`);
    printDim('  Verifica tu conexión y acceso al repo del contexto.');
    return 1;
  }
}
