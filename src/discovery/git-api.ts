/**
 * Wrapper para GitLab API v4 y GitHub REST API.
 *
 * Usado por /init-context v2 para enumerar repos y leer archivos
 * sin necesidad de clonar — solo metadata + archivos clave.
 */
import type { ClientCredentials, GitHost } from '../types/credentials.js';

export interface RepoMeta {
  id: string | number;
  slug: string;               // kebab-case name
  name: string;               // display name
  description: string;
  url: string;                // clone URL https
  ssh_url: string;
  default_branch: string;
  last_push: string;          // ISO 8601
  language: string | null;    // lenguaje detectado por el servidor
  size_kb: number;
  topics: string[];
  archived: boolean;
  ci_config_path: string | null;  // path al archivo CI si es personalizado
}

export interface FileContent {
  path: string;
  content: string;            // decodificado de base64
  found: boolean;
}

// ── GitLab ──────────────────────────────────────────────────

async function gitlabRequest(
  creds: ClientCredentials,
  endpoint: string,
  params: Record<string, string> = {}
): Promise<unknown> {
  const url = new URL(`${creds.git_base_url}/api/v4/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const response = await fetch(url.toString(), {
    headers: {
      'PRIVATE-TOKEN': creds.git_token,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function listGitLabRepos(creds: ClientCredentials): Promise<RepoMeta[]> {
  const encodedGroup = encodeURIComponent(creds.git_group);
  const projects = await gitlabRequest(
    creds,
    `groups/${encodedGroup}/projects`,
    {
      per_page: '100',
      include_subgroups: 'true',
      with_shared: 'false',
      order_by: 'last_activity_at',
      sort: 'desc',
    }
  ) as Array<Record<string, unknown>>;

  return projects.map((p) => ({
    id: p['id'] as number,
    slug: (p['path'] as string) ?? '',
    name: (p['name'] as string) ?? '',
    description: (p['description'] as string) ?? '',
    url: (p['http_url_to_repo'] as string) ?? '',
    ssh_url: (p['ssh_url_to_repo'] as string) ?? '',
    default_branch: (p['default_branch'] as string) ?? 'main',
    last_push: (p['last_activity_at'] as string) ?? '',
    language: null, // GitLab no retorna lenguaje en el listado del grupo
    size_kb: (p['statistics'] as Record<string, number>)?.['repository_size'] ?? 0,
    topics: (p['topics'] as string[]) ?? [],
    archived: (p['archived'] as boolean) ?? false,
    ci_config_path: (p['ci_config_path'] as string | null) ?? null,
  }));
}

async function readGitLabFile(
  creds: ClientCredentials,
  projectId: string | number,
  filePath: string,
  branch: string = 'main'
): Promise<FileContent> {
  try {
    const encoded = encodeURIComponent(filePath);
    const data = await gitlabRequest(
      creds,
      `projects/${projectId}/repository/files/${encoded}`,
      { ref: branch }
    ) as Record<string, string>;

    const content = Buffer.from(data['content'] ?? '', 'base64').toString('utf-8');
    return { path: filePath, content, found: true };
  } catch {
    return { path: filePath, content: '', found: false };
  }
}

// ── GitHub ──────────────────────────────────────────────────

async function githubRequest(
  creds: ClientCredentials,
  endpoint: string,
  params: Record<string, string> = {}
): Promise<unknown> {
  const baseUrl = creds.git_base_url === 'https://gitlab.com'
    ? 'https://api.github.com'
    : creds.git_base_url;
  const url = new URL(`${baseUrl}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${creds.git_token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function listGitHubRepos(creds: ClientCredentials): Promise<RepoMeta[]> {
  const repos = await githubRequest(
    creds,
    `orgs/${creds.git_group}/repos`,
    { per_page: '100', sort: 'pushed', direction: 'desc' }
  ) as Array<Record<string, unknown>>;

  return repos.map((r) => ({
    id: r['id'] as number,
    slug: (r['name'] as string) ?? '',
    name: (r['full_name'] as string) ?? '',
    description: (r['description'] as string) ?? '',
    url: (r['clone_url'] as string) ?? '',
    ssh_url: (r['ssh_url'] as string) ?? '',
    default_branch: (r['default_branch'] as string) ?? 'main',
    last_push: (r['pushed_at'] as string) ?? '',
    language: (r['language'] as string | null) ?? null,
    size_kb: (r['size'] as number) ?? 0,
    topics: (r['topics'] as string[]) ?? [],
    archived: (r['archived'] as boolean) ?? false,
    ci_config_path: null,
  }));
}

async function readGitHubFile(
  creds: ClientCredentials,
  repoSlug: string,
  filePath: string,
  branch: string = 'main'
): Promise<FileContent> {
  try {
    const data = await githubRequest(
      creds,
      `repos/${creds.git_group}/${repoSlug}/contents/${filePath}`,
      { ref: branch }
    ) as Record<string, string>;

    const content = Buffer.from(data['content'] ?? '', 'base64').toString('utf-8');
    return { path: filePath, content, found: true };
  } catch {
    return { path: filePath, content: '', found: false };
  }
}

// ── Interface pública unificada ─────────────────────────────

export class GitApiClient {
  constructor(private readonly creds: ClientCredentials) {}

  get host(): GitHost { return this.creds.git_host; }

  async listRepos(): Promise<RepoMeta[]> {
    if (this.creds.git_host === 'github') {
      return listGitHubRepos(this.creds);
    }
    return listGitLabRepos(this.creds);
  }

  /**
   * Lee un archivo de un repo via API (sin clonar).
   * Retorna { found: false } si no existe.
   */
  async readFile(
    repoIdOrSlug: string | number,
    filePath: string,
    branch: string = 'main'
  ): Promise<FileContent> {
    if (this.creds.git_host === 'github') {
      return readGitHubFile(this.creds, String(repoIdOrSlug), filePath, branch);
    }
    return readGitLabFile(this.creds, repoIdOrSlug, filePath, branch);
  }

  /**
   * Lee múltiples archivos candidatos y retorna el primero encontrado.
   * Útil para detección de stack (package.json O composer.json O pom.xml).
   */
  async readFirstFound(
    repoIdOrSlug: string | number,
    candidates: string[],
    branch: string = 'main'
  ): Promise<FileContent> {
    for (const candidate of candidates) {
      const result = await this.readFile(repoIdOrSlug, candidate, branch);
      if (result.found) return result;
    }
    return { path: candidates[0] ?? '', content: '', found: false };
  }
}

export function createGitApiClient(creds: ClientCredentials): GitApiClient {
  return new GitApiClient(creds);
}
