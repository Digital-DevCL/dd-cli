/**
 * `dd-cli register-client <slug> --context-url=<github-url>`
 *
 * Registra un cliente en ~/.devflow/registry.yml y clona su repo de contexto
 * a ~/.devflow/clients/<slug>/
 *
 * Lo ejecuta el consultor Digital-Dev o el Tech Lead del cliente,
 * una vez por máquina.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import {
  getClientCacheDir,
  registerClient,
  updateLastSynced,
  loadRegistry,
} from '../types/registry.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold } from '../utils/output.js';

export interface RegisterClientOptions {
  contextUrl: string;
  name?: string;
  force?: boolean;
}

function runGit(cmd: string, cwd?: string): string {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (e: unknown) {
    const err = e as { stderr?: string; message?: string };
    throw new Error(err.stderr?.trim() || err.message || String(e));
  }
}

function deriveNameFromUrl(url: string): string {
  // https://github.com/digital-dev/iprsa-devflow-context.git → iprsa-devflow-context
  const base = url.replace(/\.git$/, '').split('/').pop() ?? url;
  return base.replace(/-devflow-context$/, '');
}

export async function runRegisterClient(
  slug: string,
  opts: RegisterClientOptions
): Promise<number> {
  if (!slug) {
    printErr('Falta el slug del cliente. Uso: dd-cli register-client <slug> --context-url=<url>');
    return 2;
  }

  const cacheDir = getClientCacheDir(slug);
  const registry = loadRegistry();
  const alreadyExists = !!registry.clients[slug];

  console.log(bold(`\nRegistrando cliente: ${slug}\n`));

  // Si ya existe y no --force, solo actualizar (git pull)
  if (alreadyExists && !opts.force) {
    printInfo(`El cliente "${slug}" ya está registrado. Actualizando cache...`);
    return syncClient(slug, cacheDir, opts.contextUrl);
  }

  // Clone
  const parentDir = path.dirname(cacheDir);
  if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });

  if (existsSync(cacheDir) && opts.force) {
    printDim(`  Sobreescribiendo cache existente en ${cacheDir}`);
  }

  if (!existsSync(cacheDir)) {
    printInfo(`Clonando repo de contexto...`);
    printDim(`  ${opts.contextUrl}`);
    printDim(`  → ${cacheDir}`);

    try {
      runGit(`git clone "${opts.contextUrl}" "${cacheDir}"`);
      printOk(`Repo clonado`);
    } catch (e) {
      printErr(`Error al clonar: ${e instanceof Error ? e.message : String(e)}`);
      printDim(`  Verifica que la URL es correcta y tienes acceso al repo.`);
      return 1;
    }
  }

  // Leer nombre del cliente del repo (del README o del CLAUDE.md si tiene)
  const clientName = opts.name ?? deriveNameFromUrl(opts.contextUrl);

  // Registrar en registry.yml
  registerClient({
    slug,
    name: clientName,
    context_url: opts.contextUrl,
    local_cache: cacheDir,
    last_synced: new Date().toISOString(),
  });

  printOk(`Cliente registrado en ~/.devflow/registry.yml`);

  // Mostrar resumen del catálogo si existe
  const catalogPath = path.join(cacheDir, '.devflow-context', 'app-catalog.md');
  if (existsSync(catalogPath)) {
    const content = require('node:fs').readFileSync(catalogPath, 'utf-8');
    const appLines = content.match(/^\| [a-z]/gm) ?? [];
    const appCount = appLines.length;
    if (appCount > 0) {
      printOk(`App catalog: ${appCount} apps encontradas`);
    }
  }

  console.log('');
  printInfo(`Próximo paso para conectar un repo de código a este cliente:`);
  console.log(`    dd-cli init --client=${slug}`);
  console.log('');
  return 0;
}

function syncClient(slug: string, cacheDir: string, contextUrl: string): number {
  if (!existsSync(cacheDir)) {
    printWarn(`Cache local no encontrada. Clonando de nuevo...`);
    try {
      const parentDir = path.dirname(cacheDir);
      if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
      runGit(`git clone "${contextUrl}" "${cacheDir}"`);
    } catch (e) {
      printErr(`Error al clonar: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  } else {
    try {
      runGit('git pull', cacheDir);
    } catch (e) {
      printErr(`Error al actualizar: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  }

  updateLastSynced(slug);
  printOk(`Cache actualizada (${slug})`);

  // Mostrar últimos cambios
  try {
    const log = runGit('git log --oneline -3', cacheDir);
    if (log) {
      printDim(`\nÚltimos cambios:`);
      log.split('\n').forEach(l => printDim(`  ${l}`));
    }
  } catch { /* opcional */ }

  return 0;
}
