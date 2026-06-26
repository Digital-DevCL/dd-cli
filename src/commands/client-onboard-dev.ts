/**
 * `dd-cli client onboard-dev <slug>` — setup en máquina nueva (S4-3).
 *
 * Para un dev nuevo del equipo que necesita arrancar a programar contra
 * un cliente ya onboardeado por el consultor. Diferencia clave con
 * `client new`:
 *   - new:        consultor, crea el repo en provider, scope api/repo.
 *   - onboard-dev: dev del equipo, NO crea repos, scope read-only.
 *
 * Pasos:
 *   1. Pide token read-only del dev (no compartir el PAT del consultor).
 *   2. Valida con scope `read` mínimo (read_api en GitLab, repo:read
 *      o public_repo en GitHub).
 *   3. Clona el context repo a ~/.devflow/clients/<slug>/.
 *   4. Registra en registry.yml + credentials.yml local.
 *   5. Verifica que skills + statusline estén instalados (sugiere `init`
 *      si no).
 *   6. state.json → ACTIVE (el dev arranca trabajando).
 *
 * Sección 4.6 del rediseño + decisión D-7 del Apéndice (cada dev su
 * propio token, no se comparte el del consultor).
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { input, password, confirm } from '@inquirer/prompts';
import { registerClient, getClientCacheDir } from '../types/registry.js';
import { setClientCredentials, type GitHost } from '../types/credentials.js';
import { createProvider } from '../providers/factory.js';
import type { ProviderType } from '../providers/types.js';
import { loadContextRepoMarker } from '../types/context-repo.js';
import { getClaudeSkillsDir } from '../utils/paths.js';
import { recordCommandResult } from '../utils/client-state.js';
import { isJsonMode, emitJson, jsonSuccess, jsonError, type JsonModeOpts } from '../utils/json-output.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold } from '../utils/output.js';

export interface ClientOnboardDevOpts extends JsonModeOpts {
  contextUrl?: string;
  gitToken?: string;
  yes?: boolean;
}

const isTTY = process.stdout.isTTY;

function runGit(cmd: string, cwd?: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function embedTokenInUrl(url: string, token: string, provider: ProviderType): string {
  try {
    const u = new URL(url);
    if (provider === 'github') {
      u.username = 'x-access-token';
      u.password = token;
    } else {
      u.username = 'oauth2';
      u.password = token;
    }
    return u.toString();
  } catch {
    return url;
  }
}

interface OnboardDevResult {
  slug: string;
  context_url: string;
  cache_dir: string;
  skills_installed: boolean;
  state: 'ACTIVE';
}

export async function runClientOnboardDev(slug: string, opts: ClientOnboardDevOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);

  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    const e = {
      code: 'INVALID_INPUT' as const,
      message: 'Falta el slug o no es kebab-case. Uso: dd-cli client onboard-dev <slug>',
    };
    if (jsonMode) emitJson(jsonError({ command: 'client onboard-dev', ...e }));
    printErr(e.message);
    return 3;
  }

  if (!jsonMode) console.log(bold(`\nSetup local para ${slug}\n`));

  // ── Datos mínimos ─────────────────────────────────────────────────
  let contextUrl = opts.contextUrl;
  let gitToken = opts.gitToken;

  if (!contextUrl && !isTTY) {
    const e = {
      code: 'INVALID_INPUT' as const,
      message: 'En modo no interactivo se necesita --context-url y --git-token.',
      recovery_hints: [
        `Ejemplo: dd-cli client onboard-dev ${slug} --context-url=https://... --git-token=glpat-...`,
      ],
    };
    if (jsonMode) emitJson(jsonError({ command: 'client onboard-dev', ...e }));
    printErr(e.message);
    return 3;
  }

  if (!contextUrl) {
    contextUrl = await input({
      message: 'URL del context repo del cliente (te la pasa el consultor):',
      validate: (v) => /^https?:\/\//.test(v) || 'Debe ser una URL http(s) al repo de contexto',
    });
  }

  if (!gitToken) {
    printInfo('Necesitás un PAT propio (NO el del consultor) con scope read-only:');
    printDim('  GitLab: read_repository');
    printDim('  GitHub: repo:read o public_repo si el repo es público');
    gitToken = await password({
      message: 'Tu token API (read-only):',
      mask: '*',
      validate: (v) => v.trim().length > 0 || 'Es obligatorio',
    });
  }

  // ── Inferir provider desde URL del context repo ──────────────────
  const provider: ProviderType = /github/i.test(contextUrl) ? 'github' : 'gitlab';
  const baseUrl = provider === 'github' ? 'https://api.github.com' : 'https://gitlab.com';
  // Group/org se infiere del path del contextUrl
  let group: string;
  try {
    const u = new URL(contextUrl);
    const parts = u.pathname.replace(/^\/|\.git$/g, '').split('/');
    group = parts[0] ?? '';
    if (!group) throw new Error('Sin group');
  } catch {
    const e = {
      code: 'INVALID_INPUT' as const,
      message: 'No pude inferir el group/org desde la URL del context repo.',
      recovery_hints: ['Verificá que la URL tenga el formato https://<host>/<group>/<slug>-devflow-context.git'],
    };
    if (jsonMode) emitJson(jsonError({ command: 'client onboard-dev', ...e }));
    printErr(e.message);
    return 3;
  }

  // ── Validar token con scope mínimo (read) ─────────────────────────
  const creds = {
    git_token: gitToken,
    git_host: provider as GitHost,
    git_base_url: baseUrl,
    git_group: group,
  };
  const providerInstance = createProvider(creds, { type: provider, base_url: baseUrl, group_or_org: group });
  if (!jsonMode) printInfo(`Validando token contra ${provider} / ${group} ...`);
  const tokenCheck = await providerInstance.validateToken({ required_for: ['read'] });
  if (!tokenCheck.valid) {
    const e = {
      code: 'TOKEN_INVALID' as const,
      message: tokenCheck.message,
      context: { provider, group },
      recovery_hints: ['Generá un PAT con scope read-only en tu cuenta'],
    };
    if (jsonMode) emitJson(jsonError({ command: 'client onboard-dev', ...e }));
    printErr(e.message);
    return 1;
  }
  if (tokenCheck.scopes_missing.length > 0) {
    const e = {
      code: 'TOKEN_INSUFFICIENT_SCOPE' as const,
      message: `Al token le faltan scopes: ${tokenCheck.scopes_missing.join(', ')}`,
      context: {
        provider,
        scopes_present: tokenCheck.scopes_present,
        scopes_missing: tokenCheck.scopes_missing,
      },
    };
    if (jsonMode) emitJson(jsonError({ command: 'client onboard-dev', ...e }));
    printErr(e.message);
    return 2;
  }
  if (!jsonMode) printOk(`Token válido — usuario ${tokenCheck.user ?? 'desconocido'}`);

  // ── Clone ─────────────────────────────────────────────────────────
  const cacheDir = getClientCacheDir(slug);
  const cloneUrl = embedTokenInUrl(contextUrl, gitToken, provider);

  if (existsSync(cacheDir)) {
    try {
      runGit('git pull --ff-only', cacheDir);
      if (!jsonMode) printDim(`Cache local ya existía, pull OK: ${cacheDir}`);
    } catch {
      if (!jsonMode) printWarn('Pull falló; re-clonando ...');
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }
  if (!existsSync(cacheDir)) {
    const parentDir = path.dirname(cacheDir);
    if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
    try {
      runGit(`git clone "${cloneUrl}" "${cacheDir}"`);
      if (!jsonMode) printOk(`Cache local: ${cacheDir}`);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const errObj = {
        code: 'GIT_CLONE_FAILED' as const,
        message: `git clone falló: ${errMsg}`,
        context: { url: contextUrl, cache_dir: cacheDir },
        recovery_hints: ['Verificá que el token tenga acceso al context repo'],
      };
      if (jsonMode) emitJson(jsonError({ command: 'client onboard-dev', ...errObj }));
      printErr(errObj.message);
      return 1;
    }
  }

  // ── Leer nombre del marcador (si existe) ──────────────────────────
  let clientName = slug;
  try {
    const marker = loadContextRepoMarker(cacheDir);
    if (marker) clientName = marker.client.name;
  } catch { /* sin marcador, ok */ }

  // ── Registrar local ──────────────────────────────────────────────
  registerClient({
    slug,
    name: clientName,
    context_url: contextUrl,
    local_cache: cacheDir,
    last_synced: new Date().toISOString(),
  });
  setClientCredentials(slug, creds);
  if (!jsonMode) printOk('Cliente registrado en esta máquina (~/.devflow/registry.yml + credentials.yml)');

  // ── Verificar skills + statusline ────────────────────────────────
  const skillsDir = getClaudeSkillsDir();
  const skillsInstalled = existsSync(skillsDir);
  if (!skillsInstalled && !jsonMode) {
    printWarn('Las skills DevFlow IA NO están instaladas en esta máquina.');
    printDim('  Para instalarlas: dd-cli skills install');
    printDim('  Para statusline:  dd-cli install');
  } else if (!jsonMode) {
    printOk('Skills DevFlow IA instaladas');
  }

  // ── State → ACTIVE ───────────────────────────────────────────────
  // El dev arranca trabajando, no pasa por discover/publish (eso es del consultor)
  try {
    recordCommandResult(slug, 'client onboard-dev', {
      success: true,
      state: 'READY',
      nextSafe: `cd <repo-de-codigo> && dd-cli init --client=${slug}`,
    });
  } catch { /* state machine puede rechazar — no crítico */ }

  const result: OnboardDevResult = {
    slug,
    context_url: contextUrl,
    cache_dir: cacheDir,
    skills_installed: skillsInstalled,
    state: 'ACTIVE',
  };

  if (jsonMode) {
    emitJson(jsonSuccess('client onboard-dev', result, `cd <repo-de-codigo> && dd-cli init --client=${slug}`));
  }

  console.log('');
  printOk(`${bold(clientName)} listo en esta máquina.`);
  console.log('');
  printInfo('Cuando vayas a programar:');
  printDim(`  cd <repo-de-codigo>`);
  printDim(`  dd-cli init --client=${slug}`);
  printDim(`  dd-cli start-session <HDU-id>`);
  return 0;
}
