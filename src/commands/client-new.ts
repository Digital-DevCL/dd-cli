/**
 * `dd-cli client new <slug>` — onboarding inicial de un cliente (S3-1).
 *
 * Un solo comando que pregunta lo mínimo y resuelve todo lo accesorio:
 *   1. Pide datos del cliente (nombre, provider, group/org, token).
 *   2. Valida el token con scopes mínimos para create_repo + branch_protection.
 *   3. Si el context repo no existe en el provider → lo crea (private + README).
 *   4. Aplica branch protection a main (configurable con --no-branch-protection).
 *   5. Clona el repo a ~/.devflow/clients/<slug>/.
 *   6. Registra el cliente en registry.yml + credentials.yml.
 *   7. Escribe el marcador .devflow-context/.context-repo.yml.
 *   8. state.json del cliente → REGISTERED.
 *
 * Idempotente: si el cliente ya está registrado, repite los pasos que
 * todavía no se completaron (re-validar token, re-clonar si falta cache, etc).
 *
 * Bajo D-8: este comando es kernel. La skill /devflow-ia:client-onboard lo
 * invoca con flags y narra al usuario. Bajo D-2 (Apéndice D), soporta modo
 * interactivo (default) y --non-interactive con --git-token + --git-group.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { input, password, select, confirm } from '@inquirer/prompts';
import {
  getClient,
  getClientCacheDir,
  registerClient,
  updateLastSynced,
} from '../types/registry.js';
import { setClientCredentials, type GitHost } from '../types/credentials.js';
import { createProvider, inferProviderType } from '../providers/factory.js';
import type { ProviderType } from '../providers/types.js';
import { saveContextRepoMarker, getContextRepoMarkerPath } from '../types/context-repo.js';
import { CLI_VERSION } from '../index.js';
import { recordCommandResult } from '../utils/client-state.js';
import { isJsonMode, emitJson, jsonSuccess, jsonError, type JsonModeOpts } from '../utils/json-output.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold } from '../utils/output.js';

export interface ClientNewOpts extends JsonModeOpts {
  name?: string;
  provider?: ProviderType;
  baseUrl?: string;
  group?: string;
  gitToken?: string;
  noBranchProtection?: boolean;
  yes?: boolean;        // bypass confirmaciones (CI / scripts)
}

const isTTY = process.stdout.isTTY;

function runGit(cmd: string, cwd?: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function defaultBaseUrlFor(type: ProviderType): string {
  // Guardar el clone URL, no el API URL — factory.ts hace la conversión (P-04)
  return type === 'github' ? 'https://github.com' : 'https://gitlab.com';
}

function contextRepoNameFor(slug: string): string {
  return `${slug}-devflow-context`;
}

interface ClientNewResult {
  slug: string;
  name: string;
  provider: ProviderType;
  base_url: string;
  group_or_org: string;
  context_repo_url: string;
  cache_dir: string;
  context_repo_created: boolean;
  branch_protection_applied: boolean;
  state: 'REGISTERED';
}

export async function runClientNew(slug: string, opts: ClientNewOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);

  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    const err = {
      code: 'INVALID_INPUT' as const,
      message: 'Falta el slug del cliente o no es kebab-case. Uso: dd-cli client new <slug>',
      recovery_hints: ['El slug debe ser kebab-case: minúsculas, números y guiones.'],
    };
    if (jsonMode) emitJson(jsonError({ command: 'client new', ...err }));
    printErr(err.message);
    return 3;
  }

  const existingClient = getClient(slug);
  if (existingClient && !opts.yes && !jsonMode && isTTY) {
    const proceed = await confirm({
      message: `El cliente "${slug}" ya está registrado. ¿Continuar e intentar reparar lo que falte?`,
      default: false,
    });
    if (!proceed) {
      printDim('Cancelado.');
      return 0;
    }
  }

  // ── 1. Recolectar datos ───────────────────────────────────────────
  if (!jsonMode) console.log(bold(`\nOnboarding del cliente: ${slug}\n`));

  let name: string | undefined = opts.name;
  let provider: ProviderType | undefined = opts.provider;
  let baseUrl: string | undefined = opts.baseUrl;
  let group: string | undefined = opts.group;
  let gitToken: string | undefined = opts.gitToken;

  // Modo no-interactivo: todos los datos deben venir como opts
  const needsInteractive =
    !name || !provider || !baseUrl || !group || !gitToken;

  if (needsInteractive && !isTTY) {
    const err = {
      code: 'INVALID_INPUT' as const,
      message: 'En modo no interactivo se necesitan --name, --provider, --base-url, --group y --git-token.',
      recovery_hints: [
        `Ejemplo: dd-cli client new ${slug} --name="X" --provider=gitlab --base-url=https://gitlab.com --group=foo --git-token=glpat-...`,
      ],
    };
    if (jsonMode) emitJson(jsonError({ command: 'client new', ...err }));
    printErr(err.message);
    return 3;
  }

  if (!name) {
    name = await input({
      message: 'Nombre completo del cliente:',
      default: slug,
      validate: (v) => v.trim().length > 0 || 'El nombre es obligatorio',
    });
  }
  if (!provider) {
    provider = await select<ProviderType>({
      message: 'Plataforma git:',
      choices: [
        { name: 'GitLab (cloud o self-hosted)', value: 'gitlab' },
        { name: 'GitHub (cloud o Enterprise)', value: 'github' },
      ],
      default: 'gitlab',
    });
  }
  if (!baseUrl) {
    baseUrl = await input({
      message: 'URL base (cloud o self-hosted):',
      default: defaultBaseUrlFor(provider),
      validate: (v) => /^https?:\/\//.test(v) || 'Debe ser una URL http(s)',
    });
  }
  if (!group) {
    group = await input({
      message: provider === 'github' ? 'Org / usuario:' : 'Group:',
      validate: (v) => v.trim().length > 0 || 'Es obligatorio',
    });
  }
  if (!gitToken) {
    gitToken = await password({
      message: 'Token API (PAT con scope api/repo):',
      mask: '*',
      validate: (v) => v.trim().length > 0 || 'El token es obligatorio',
    });
  }

  // ── 2. Validar token ──────────────────────────────────────────────
  const providerCreds = {
    git_token: gitToken,
    git_host: provider as GitHost,
    git_base_url: baseUrl,
    git_group: group,
  };
  const tempProvider = createProvider(providerCreds, {
    type: provider,
    base_url: baseUrl,
    group_or_org: group,
  });

  if (!jsonMode) printInfo(`Validando token contra ${provider} / ${group} ...`);
  const tokenCheck = await tempProvider.validateToken({
    required_for: opts.noBranchProtection
      ? ['read', 'create_repo']
      : ['read', 'create_repo', 'branch_protection'],
  });
  if (!tokenCheck.valid) {
    const err = {
      code: 'TOKEN_INVALID' as const,
      message: tokenCheck.message,
      context: { provider, group_or_org: group },
      recovery_hints: ['Regenerá el token con scope `api` (GitLab) o `repo` (GitHub).'],
    };
    if (jsonMode) emitJson(jsonError({ command: 'client new', ...err }));
    printErr(err.message);
    return 1;
  }
  if (tokenCheck.scopes_missing.length > 0) {
    const err = {
      code: 'TOKEN_INSUFFICIENT_SCOPE' as const,
      message: `Al token le faltan scopes: ${tokenCheck.scopes_missing.join(', ')}.`,
      context: {
        provider,
        scopes_present: tokenCheck.scopes_present,
        scopes_missing: tokenCheck.scopes_missing,
      },
      recovery_hints: [
        provider === 'gitlab'
          ? 'GitLab: regenerá el PAT con scope `api`.'
          : 'GitHub: PAT classic con `repo` o fine-grained con Administration:Write.',
      ],
    };
    if (jsonMode) emitJson(jsonError({ command: 'client new', ...err }));
    printErr(err.message);
    printInfo('Para continuar igual: agregá --no-branch-protection si no querés ese scope.');
    return 2;
  }
  if (!jsonMode) {
    printOk(`Token válido — usuario ${tokenCheck.user ?? 'desconocido'}`);
    if (tokenCheck.is_admin_of_group === false) {
      printWarn(`No sos admin/Maintainer de ${group} — la creación del repo puede fallar.`);
    }
  }

  // ── 3. Crear context repo si no existe ────────────────────────────
  const repoName = contextRepoNameFor(slug);
  const existingRepos = await tempProvider.listGroupRepos();
  const existingContextRepo = existingRepos.find(r => r.slug === repoName);

  let contextRepoUrl: string;
  let contextRepoCreated = false;
  let repoIdOrSlug: string | number;

  if (existingContextRepo) {
    contextRepoUrl = existingContextRepo.url;
    repoIdOrSlug = provider === 'gitlab' ? existingContextRepo.id : existingContextRepo.slug;
    if (!jsonMode) printDim(`Context repo ya existe: ${contextRepoUrl}`);
  } else {
    if (!jsonMode) printInfo(`Creando context repo ${group}/${repoName} ...`);
    try {
      const created = await tempProvider.createRepo!({
        name: repoName,
        description: `DevFlow IA context repository for ${name}`,
        visibility: 'private',
        initialize_with_readme: true,
        default_branch: 'main',
      });
      contextRepoUrl = created.url;
      repoIdOrSlug = provider === 'gitlab' ? created.id : created.slug;
      contextRepoCreated = true;
      if (!jsonMode) printOk(`Context repo creado: ${contextRepoUrl}`);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const err = {
        code: 'INTERNAL_ERROR' as const,
        message: `No se pudo crear el repo en ${provider}: ${errMsg}`,
        context: { provider, group_or_org: group, repo_name: repoName },
        recovery_hints: [
          'Verificá que sos admin/Maintainer del group',
          `Verificá que el repo "${repoName}" no exista ya (si existe, dd-cli client new lo detecta y reutiliza)`,
        ],
      };
      if (jsonMode) emitJson(jsonError({ command: 'client new', ...err }));
      printErr(err.message);
      return 1;
    }
  }

  // ── 4. Branch protection ──────────────────────────────────────────
  let branchProtectionApplied = false;
  if (!opts.noBranchProtection) {
    try {
      await tempProvider.setBranchProtection!(repoIdOrSlug, {
        branch: 'main',
        require_pull_request: false,  // primer publish va directo a main (D-1)
        allow_force_push: false,
      });
      branchProtectionApplied = true;
      if (!jsonMode) printOk('Branch protection aplicada a main (sin require PR para el primer publish)');
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (!jsonMode) printWarn(`No se pudo aplicar branch protection: ${errMsg}`);
      // No fallamos — el cliente queda funcional sin branch protection.
    }
  }

  // ── 5. Clone local ────────────────────────────────────────────────
  const cacheDir = getClientCacheDir(slug);
  // Construir URL con token embebido para clone (https con basic auth)
  const cloneUrl = embedTokenInUrl(contextRepoUrl, gitToken, provider);

  if (existsSync(cacheDir)) {
    // Si ya existe, hacer pull (idempotente)
    try {
      runGit('git pull --ff-only', cacheDir);
      if (!jsonMode) printDim(`Cache local ya existía, pull OK: ${cacheDir}`);
    } catch {
      // Si pull falla, podría ser un cache de un repo viejo — borrar y re-clonar
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
      const err = {
        code: 'GIT_CLONE_FAILED' as const,
        message: `git clone falló: ${errMsg}`,
        context: { url: contextRepoUrl, cache_dir: cacheDir },
        recovery_hints: ['Verificá que el token tenga acceso al repo recién creado.'],
      };
      if (jsonMode) emitJson(jsonError({ command: 'client new', ...err }));
      printErr(err.message);
      return 1;
    }
  }

  // ── 6. Registrar en registry + credentials ────────────────────────
  registerClient({
    slug,
    name,
    context_url: contextRepoUrl,
    local_cache: cacheDir,
    last_synced: new Date().toISOString(),
  });
  setClientCredentials(slug, providerCreds);
  if (!jsonMode) printOk('Registry + credentials guardados (~/.devflow/)');

  // ── 7. Escribir marcador .context-repo.yml ────────────────────────
  try {
    const markerPath = getContextRepoMarkerPath(cacheDir);
    if (!existsSync(markerPath) || opts.yes) {
      saveContextRepoMarker(cacheDir, {
        kind: 'context-repo' as const,
        schema_version: '1.1',
        client: { slug, name },
        provider: { type: provider, base_url: baseUrl, group_or_org: group },
        generated_by: '/devflow-ia:client-onboard',
        last_generated_at: new Date().toISOString(),
        cli_version: CLI_VERSION,
      });
      // Commit + push del marcador
      try {
        runGit('git add .devflow-context/.context-repo.yml', cacheDir);
        runGit(`git -c commit.gpgsign=false commit -m "chore: devflow context marker for ${slug}"`, cacheDir);
        runGit('git push origin HEAD', cacheDir);
        if (!jsonMode) printOk('Marcador .context-repo.yml escrito + pusheado');
      } catch {
        if (!jsonMode) printDim('Marcador escrito en local; push se hará en client publish');
      }
    }
  } catch (e) {
    // Marcador es nice-to-have; no falla el comando.
    if (!jsonMode) printWarn(`No se pudo escribir el marcador: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 8. State.json → REGISTERED ────────────────────────────────────
  recordCommandResult(slug, 'client new', {
    success: true,
    state: 'REGISTERED',
    nextSafe: `dd-cli client discover ${slug}`,
  });

  // ── Output final ──────────────────────────────────────────────────
  const result: ClientNewResult = {
    slug,
    name,
    provider,
    base_url: baseUrl,
    group_or_org: group,
    context_repo_url: contextRepoUrl,
    cache_dir: cacheDir,
    context_repo_created: contextRepoCreated,
    branch_protection_applied: branchProtectionApplied,
    state: 'REGISTERED',
  };

  if (jsonMode) {
    emitJson(jsonSuccess('client new', result, `dd-cli client discover ${slug}`));
  }

  console.log('');
  printOk(`Cliente ${bold(slug)} registrado. Estado: REGISTERED.`);
  console.log('');
  printInfo('Próximo paso:');
  printDim(`  dd-cli client discover ${slug}`);
  printDim(`  # o desde Claude: /devflow-ia:client-onboard ${slug}`);
  return 0;
}

/**
 * Embed el token en la URL HTTPS para que `git clone` no pida credenciales.
 * GitLab: oauth2:<token>@host  (también funciona con tokens deploy)
 * GitHub: x-access-token:<token>@host
 */
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

// Re-export para evitar warning de unused import en algunos entornos
export const _internal = { os, path };
