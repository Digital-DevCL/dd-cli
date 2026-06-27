/**
 * GitLabProvider — implementación de GitProvider para GitLab cloud y self-hosted.
 *
 * Scope: API v4 (https://docs.gitlab.com/ee/api/).
 * Auth: PAT con header PRIVATE-TOKEN.
 *
 * Permisos esperados (ver sección 4.7 del doc rediseño):
 *   read_api          listGroupRepos + readFile
 *   api               createRepo + setBranchProtection + createPullRequest + configureWebhook
 *   write_repository  push (incluido en `api`)
 */
import type {
  GitProvider,
  ProviderType,
  RepoMeta,
  FileContent,
  TokenValidation,
  ValidateTokenOpts,
  CreateRepoOpts,
  BranchProtectionRules,
  CreatePullRequestOpts,
  PullRequestRef,
  WebhookOpts,
} from './types.js';
import { ProviderError, NotImplementedError } from './types.js';

export interface GitLabProviderOpts {
  base_url: string;              // ej: https://gitlab.com o https://gitlab.empresa.cl
  group: string;                 // path del group
  token: string;
}

export class GitLabProvider implements GitProvider {
  readonly type: ProviderType = 'gitlab';
  readonly base_url: string;
  readonly group_or_org: string;
  private readonly token: string;

  constructor(opts: GitLabProviderOpts) {
    this.base_url = opts.base_url.replace(/\/$/, '');
    this.group_or_org = opts.group;
    this.token = opts.token;
  }

  // ── HTTP helpers ──────────────────────────────────────────────────

  private async request(
    endpoint: string,
    params: Record<string, string> = {},
    init?: RequestInit
  ): Promise<unknown> {
    const url = new URL(`${this.base_url}/api/v4/${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const response = await fetch(url.toString(), {
      ...init,
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ProviderError(
        `GitLab API ${response.status} en ${endpoint}: ${body.slice(0, 300)}`,
        { provider: 'gitlab', status: response.status, body }
      );
    }
    return response.json();
  }

  // ── validateToken ─────────────────────────────────────────────────

  /**
   * Mapeo de operación → scopes mínimos requeridos (sección 4.7).
   * GitLab `api` incluye casi todo; `read_api` es solo lectura.
   */
  private requiredScopesFor(op: NonNullable<ValidateTokenOpts['required_for']>[number]): string[] {
    switch (op) {
      case 'read':              return ['read_api'];
      case 'write':             return ['api'];
      case 'create_repo':       return ['api'];
      case 'branch_protection': return ['api'];
      case 'webhook':           return ['api'];
    }
  }

  async validateToken(opts: ValidateTokenOpts = {}): Promise<TokenValidation> {
    let user: string | null = null;
    let scopes_present: string[] = [];
    let is_admin_of_group: boolean | null = null;
    let message = '';

    try {
      // 1. Identidad del token
      const tokenInfo = await this.request('personal_access_tokens/self') as {
        user_id?: number;
        scopes?: string[];
      };
      scopes_present = tokenInfo.scopes ?? [];

      if (tokenInfo.user_id) {
        const userResp = await this.request(`users/${tokenInfo.user_id}`) as { username?: string };
        user = userResp.username ?? null;
      }
      message = 'Token válido';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        valid: false, user: null, scopes_present: [], scopes_missing: [],
        is_admin_of_group: null,
        message: `Token inválido o sin acceso a la API: ${msg}`,
      };
    }

    // 2. Acceso al group + nivel de membership (50 = Maintainer, 40 = Owner)
    try {
      const groupResp = await this.request(`groups/${encodeURIComponent(this.group_or_org)}`) as {
        full_path?: string;
      };
      if (groupResp.full_path) {
        // Si responde el group, verificar membership
        try {
          const members = await this.request(
            `groups/${encodeURIComponent(this.group_or_org)}/members/all`,
            { query: user ?? '' }
          ) as Array<{ username: string; access_level: number }>;
          const me = members.find(m => m.username === user);
          if (me) is_admin_of_group = me.access_level >= 40;
        } catch {
          // membership query falló, dejamos null
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message = `Token válido pero sin acceso al group ${this.group_or_org}: ${msg}`;
    }

    // 3. Calcular scopes faltantes según required_for
    const required = new Set<string>();
    for (const op of opts.required_for ?? []) {
      for (const s of this.requiredScopesFor(op)) required.add(s);
    }
    const scopes_missing = [...required].filter(s => !scopes_present.includes(s));

    return {
      valid: true,
      user,
      scopes_present,
      scopes_missing,
      is_admin_of_group,
      message,
    };
  }

  // ── listGroupRepos ────────────────────────────────────────────────

  async listGroupRepos(): Promise<RepoMeta[]> {
    // P-02: intentar group primero; si es namespace personal cae a users/{name}/projects
    const encodedGroup = encodeURIComponent(this.group_or_org);
    let projects: Array<Record<string, unknown>>;
    try {
      projects = await this.request(
        `groups/${encodedGroup}/projects`,
        {
          per_page: '100',
          include_subgroups: 'true',
          with_shared: 'false',
          order_by: 'last_activity_at',
          sort: 'desc',
        }
      ) as Array<Record<string, unknown>>;
    } catch {
      projects = await this.request(
        `users/${encodedGroup}/projects`,
        { per_page: '100', order_by: 'last_activity_at', sort: 'desc' }
      ) as Array<Record<string, unknown>>;
    }

    return projects.map((p) => ({
      id: p['id'] as number,
      slug: (p['path'] as string) ?? '',
      name: (p['name'] as string) ?? '',
      description: (p['description'] as string) ?? '',
      url: (p['http_url_to_repo'] as string) ?? '',
      ssh_url: (p['ssh_url_to_repo'] as string) ?? '',
      default_branch: (p['default_branch'] as string) ?? 'main',
      last_push: (p['last_activity_at'] as string) ?? '',
      language: null,
      size_kb: (p['statistics'] as Record<string, number> | undefined)?.['repository_size'] ?? 0,
      topics: (p['topics'] as string[]) ?? [],
      archived: (p['archived'] as boolean) ?? false,
      ci_config_path: (p['ci_config_path'] as string | null) ?? null,
    }));
  }

  // ── readFile / readFirstFound ─────────────────────────────────────

  async readFile(
    repoIdOrSlug: string | number,
    filePath: string,
    ref: string = 'main'
  ): Promise<FileContent> {
    try {
      const encoded = encodeURIComponent(filePath);
      const data = await this.request(
        `projects/${repoIdOrSlug}/repository/files/${encoded}`,
        { ref }
      ) as Record<string, string>;

      const content = Buffer.from(data['content'] ?? '', 'base64').toString('utf-8');
      return { path: filePath, content, found: true };
    } catch {
      return { path: filePath, content: '', found: false };
    }
  }

  async readFirstFound(
    repoIdOrSlug: string | number,
    candidates: string[],
    ref: string = 'main'
  ): Promise<FileContent> {
    for (const candidate of candidates) {
      const result = await this.readFile(repoIdOrSlug, candidate, ref);
      if (result.found) return result;
    }
    return { path: candidates[0] ?? '', content: '', found: false };
  }

  // ── Write side (Sprint 3 — implementado) ─────────────────────────

  /**
   * Crea un proyecto en GitLab dentro del group del provider.
   * Mapeo de visibility: 'private' → GitLab "private", 'internal' → "internal",
   * 'public' → "public".
   */
  async createRepo(opts: CreateRepoOpts): Promise<RepoMeta> {
    // P-03: resolver namespace vía /namespaces?search= para soportar grupos Y usuarios personales
    type NsResult = { id?: number; kind?: string; path?: string };
    const nsResults = await this.request(
      `namespaces`,
      { search: this.group_or_org }
    ) as NsResult[];
    const ns = nsResults.find(n => n.path === this.group_or_org) ?? nsResults[0];
    if (!ns?.id) {
      throw new ProviderError(
        `No se pudo resolver el namespace "${this.group_or_org}" en GitLab.`,
        { provider: 'gitlab' }
      );
    }
    const group = { id: ns.id };

    const body = {
      name: opts.name,
      path: opts.name,
      namespace_id: group.id,
      description: opts.description ?? '',
      visibility: opts.visibility ?? 'private',
      initialize_with_readme: opts.initialize_with_readme ?? true,
      default_branch: opts.default_branch ?? 'main',
    };

    const created = await this.request('projects', {}, {
      method: 'POST',
      body: JSON.stringify(body),
    }) as Record<string, unknown>;

    return {
      id: created['id'] as number,
      slug: (created['path'] as string) ?? opts.name,
      name: (created['name'] as string) ?? opts.name,
      description: (created['description'] as string) ?? '',
      url: (created['http_url_to_repo'] as string) ?? '',
      ssh_url: (created['ssh_url_to_repo'] as string) ?? '',
      default_branch: (created['default_branch'] as string) ?? body.default_branch,
      last_push: (created['last_activity_at'] as string) ?? new Date().toISOString(),
      language: null,
      size_kb: 0,
      topics: (created['topics'] as string[]) ?? [],
      archived: false,
      ci_config_path: null,
    };
  }

  /**
   * Configura branch protection en GitLab.
   * GitLab usa access levels: 40 = Maintainer, 30 = Developer.
   * Sin protección previa: crea. Con protección previa: reemplaza (idempotente).
   */
  async setBranchProtection(repoIdOrSlug: string | number, rules: BranchProtectionRules): Promise<void> {
    // GitLab requiere unprotect antes de re-protect (idempotencia)
    try {
      await this.request(
        `projects/${repoIdOrSlug}/protected_branches/${encodeURIComponent(rules.branch)}`,
        {},
        { method: 'DELETE' }
      );
    } catch {
      // OK si no estaba protegida — seguimos
    }

    const allowForce = rules.allow_force_push ?? false;
    const requirePR = rules.require_pull_request ?? true;
    // Sin PR: developers pueden push directo (30). Con PR: solo maintainers (40).
    const pushLevel = requirePR ? 40 : 30;
    const mergeLevel = 40;

    await this.request(
      `projects/${repoIdOrSlug}/protected_branches`,
      {},
      {
        method: 'POST',
        body: JSON.stringify({
          name: rules.branch,
          push_access_level: pushLevel,
          merge_access_level: mergeLevel,
          allow_force_push: allowForce,
        }),
      }
    );
  }

  async createPullRequest(_repo: string | number, _opts: CreatePullRequestOpts): Promise<PullRequestRef> {
    throw new NotImplementedError('gitlab', 'createPullRequest (createMergeRequest)');
  }

  async configureWebhook(_repo: string | number, _opts: WebhookOpts): Promise<void> {
    throw new NotImplementedError('gitlab', 'configureWebhook');
  }
}
