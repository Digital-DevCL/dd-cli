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
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import {
  getClientCacheDir,
  registerClient,
  updateLastSynced,
  loadRegistry,
} from '../types/registry.js';
import {
  setClientCredentials,
  type GitHost,
} from '../types/credentials.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold } from '../utils/output.js';

export interface RegisterClientOptions {
  contextUrl: string;
  name?: string;
  force?: boolean;
  // Git API credentials (para discovery en /init-context v2)
  gitToken?: string;
  gitHost?: string;
  gitGroup?: string;
  gitBaseUrl?: string;
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

/**
 * B-5 fix — leer el nombre real del cliente desde el context repo recién clonado.
 * Orden de prioridad:
 *   1. .devflow-context/stack.yml → client.name (forward-compat con S1-1)
 *   2. .devflow-context/.context-repo.yml → client.name (forward-compat con S2-3)
 *   3. CLAUDE.md primer heading H1
 *   4. README.md primer heading H1
 *   5. Fallback: deriveNameFromUrl(contextUrl)
 */
function readClientName(cacheDir: string, contextUrl: string): string {
  // 1. stack.yml (forward-compat)
  const stackYmlPath = path.join(cacheDir, '.devflow-context', 'stack.yml');
  if (existsSync(stackYmlPath)) {
    try {
      const parsed = yaml.load(readFileSync(stackYmlPath, 'utf-8')) as Record<string, unknown> | null;
      const client = parsed?.client as Record<string, unknown> | undefined;
      const name = client?.name;
      if (typeof name === 'string' && name.trim()) return name.trim();
    } catch { /* skip */ }
  }

  // 2. .context-repo.yml (forward-compat con marcador de S2-3)
  const contextRepoYmlPath = path.join(cacheDir, '.devflow-context', '.context-repo.yml');
  if (existsSync(contextRepoYmlPath)) {
    try {
      const parsed = yaml.load(readFileSync(contextRepoYmlPath, 'utf-8')) as Record<string, unknown> | null;
      const client = parsed?.client as Record<string, unknown> | undefined;
      const name = client?.name;
      if (typeof name === 'string' && name.trim()) return name.trim();
    } catch { /* skip */ }
  }

  // 3 + 4. Markdown H1 de CLAUDE.md o README.md
  for (const filename of ['CLAUDE.md', 'README.md']) {
    const mdPath = path.join(cacheDir, filename);
    if (existsSync(mdPath)) {
      try {
        const content = readFileSync(mdPath, 'utf-8');
        const h1 = content.match(/^#\s+(.+?)\s*$/m);
        if (h1 && h1[1]?.trim()) return h1[1].trim();
      } catch { /* skip */ }
    }
  }

  // 5. Fallback
  return deriveNameFromUrl(contextUrl);
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
    rmSync(cacheDir, { recursive: true, force: true });
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

  // B-5 fix — leer nombre real del context repo recién clonado.
  // Si opts.name fue provisto explícitamente, gana sobre lo leído del repo.
  const clientName = opts.name ?? readClientName(cacheDir, opts.contextUrl);

  // Registrar en registry.yml
  registerClient({
    slug,
    name: clientName,
    context_url: opts.contextUrl,
    local_cache: cacheDir,
    last_synced: new Date().toISOString(),
  });

  printOk(`Cliente registrado en ~/.devflow/registry.yml`);

  // Guardar credenciales git si se proveyeron
  if (opts.gitToken && opts.gitGroup) {
    const host = (opts.gitHost ?? 'gitlab') as GitHost;
    const baseUrl = opts.gitBaseUrl ??
      (host === 'github' ? 'https://api.github.com' : 'https://gitlab.com');
    setClientCredentials(slug, {
      git_token: opts.gitToken,
      git_host: host,
      git_base_url: baseUrl,
      git_group: opts.gitGroup,
    });
    printOk(`Credenciales git guardadas en ~/.devflow/credentials.yml (chmod 600)`);
    printDim(`  Host: ${host}  ·  Grupo: ${opts.gitGroup}`);
  } else if (opts.gitToken || opts.gitGroup) {
    printWarn(`Para guardar credenciales git se necesitan tanto --git-token como --git-group`);
  }

  // Mostrar resumen del catálogo si existe
  const catalogPath = path.join(cacheDir, '.devflow-context', 'app-catalog.md');
  if (existsSync(catalogPath)) {
    const content = readFileSync(catalogPath, 'utf-8');
    // B-1 hot-fix — contar filas de datos (tolerante a backticks).
    let appCount = 0;
    for (const line of content.split('\n')) {
      if (!/^\|\s*[`a-z0-9]/i.test(line)) continue;
      if (/^\|\s*-+/.test(line)) continue;
      const firstCol = line.split('|')[1]?.trim().replace(/^`+|`+$/g, '').toLowerCase() ?? '';
      if (firstCol === 'slug' || firstCol === 'app') continue;
      appCount++;
    }
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
