/**
 * Detecta patterns de arquitectura a partir de archivos leídos via API.
 *
 * No clona repos. Opera solo sobre el contenido de archivos
 * obtenidos con GitApiClient.readFile().
 *
 * Detecta: stack, auth, portales MFE, templates base, CI/CD stages, DB.
 */
import type { RepoMeta, FileContent } from './git-api.js';
import type { AppType, AppOrigin } from '../types/project-config.js';

// ── Tipos de resultado ────────────────────────────────────────

export type AuthPattern =
  | 'custom-jwt'
  | 'portal-embedded'
  | 'oauth2-oidc'
  | 'api-key-internal'
  | 'none-public'
  | 'unknown';

export interface RepoAnalysis {
  slug: string;
  display_name: string;
  stack: {
    language: string | null;
    framework: string | null;
    db: string | null;
    node_version: string | null;
    php_version: string | null;
  };
  app_type: AppType;
  app_origin: AppOrigin;
  auth_pattern: AuthPattern;
  is_template: boolean;
  is_portal_shell: boolean;
  is_mfe: boolean;
  ci_stages: string[];
  k8s_namespace: string | null;
  last_active_days: number;
  inactive: boolean;  // sin push en > 12 meses
}

export interface DiscoveryResult {
  repos: RepoAnalysis[];
  auth_profiles_detected: AuthPattern[];
  templates_detected: string[];          // slugs de repos que son templates base
  portal_shell: string | null;           // slug del repo portal principal
  mfes: string[];                        // slugs de microfrontends
  ci_template: string | null;            // stage pattern común
  dbs_detected: string[];
  active_repos: number;
  inactive_repos: number;
  summary: string;                       // párrafo legible para confirmar con el consultor
}

// ── Heurísticas de stack ──────────────────────────────────────

function detectStack(files: Record<string, FileContent>): RepoAnalysis['stack'] {
  const pkg = files['package.json'];
  const composer = files['composer.json'];
  const pom = files['pom.xml'];
  const requirements = files['requirements.txt'];
  const gemfile = files['Gemfile'];

  if (pkg?.found) {
    try {
      const json = JSON.parse(pkg.content);
      const deps = { ...json.dependencies, ...json.devDependencies };
      const scripts = json.scripts ?? {};
      const enginesNode = json.engines?.node ?? null;

      let framework: string | null = null;
      if (deps['@nestjs/core']) framework = 'nestjs';
      else if (deps['express']) framework = 'express';
      else if (deps['fastify']) framework = 'fastify';
      else if (deps['@angular/core']) framework = 'angular';
      else if (deps['react']) framework = 'react';
      else if (deps['next']) framework = 'nextjs';
      else if (deps['vue']) framework = 'vue';

      let db: string | null = null;
      if (deps['typeorm'] || deps['@nestjs/typeorm']) db = 'typeorm';
      if (deps['pg'] || deps['pg-promise']) db = db ? `${db}+postgresql` : 'postgresql';
      if (deps['oracledb']) db = db ? `${db}+oracle` : 'oracle';
      if (deps['mysql2'] || deps['mysql']) db = db ? `${db}+mysql` : 'mysql';
      if (deps['mongoose'] || deps['mongodb']) db = db ? `${db}+mongodb` : 'mongodb';

      return {
        language: 'typescript/javascript',
        framework,
        db,
        node_version: enginesNode,
        php_version: null,
      };
    } catch { /* ignorar parse errors */ }
  }

  if (composer?.found) {
    try {
      const json = JSON.parse(composer.content);
      const require = json.require ?? {};
      let framework: string | null = null;
      if (require['laravel/framework']) framework = 'laravel';
      else if (require['symfony/symfony']) framework = 'symfony';

      let db: string | null = null;
      // Laravel usa Eloquent — la DB se detecta por la config, no por composer
      if (framework === 'laravel') db = 'eloquent'; // asumir, confirmar

      const phpVersion = json.require?.['php']?.replace(/[^0-9.]/g, '') ?? null;
      return { language: 'php', framework, db, node_version: null, php_version: phpVersion };
    } catch { /* ignorar */ }
  }

  if (pom?.found) {
    const hasSpring = pom.content.includes('spring-boot');
    return {
      language: 'java',
      framework: hasSpring ? 'spring-boot' : 'java',
      db: pom.content.includes('postgresql') ? 'postgresql' : null,
      node_version: null,
      php_version: null,
    };
  }

  if (requirements?.found) {
    const hasDjango = requirements.content.includes('Django');
    const hasFastAPI = requirements.content.includes('fastapi');
    return {
      language: 'python',
      framework: hasFastAPI ? 'fastapi' : hasDjango ? 'django' : null,
      db: requirements.content.includes('psycopg') ? 'postgresql' : null,
      node_version: null,
      php_version: null,
    };
  }

  if (gemfile?.found) {
    const hasRails = gemfile.content.includes("'rails'");
    return { language: 'ruby', framework: hasRails ? 'rails' : null, db: null, node_version: null, php_version: null };
  }

  return { language: null, framework: null, db: null, node_version: null, php_version: null };
}

// ── Heurísticas de auth ───────────────────────────────────────

function detectAuth(files: Record<string, FileContent>, repoSlug: string): AuthPattern {
  const allContent = Object.values(files).map(f => f.content).join('\n').toLowerCase();

  // Portal embedded: usa messageBus, postMessage, sessionStorage con token heredado
  if (allContent.includes('messagebus') || allContent.includes('postmessage') ||
      allContent.includes('portal-bridge') || allContent.includes('portalauthservice')) {
    return 'portal-embedded';
  }

  // OAuth2/OIDC: keycloak, azure, auth0, oidc
  if (allContent.includes('keycloak') || allContent.includes('azure-ad') ||
      allContent.includes('auth0') || allContent.includes('openidconnect') ||
      allContent.includes('oauth2') || allContent.includes('oidc')) {
    return 'oauth2-oidc';
  }

  // Custom JWT: jwt propio
  if (allContent.includes('jsonwebtoken') || allContent.includes('jwtservice') ||
      allContent.includes('@nestjs/jwt') || allContent.includes('jwt_secret') ||
      allContent.includes('passport-jwt') || allContent.includes('tymon/jwt-auth')) {
    return 'custom-jwt';
  }

  // API key internal: x-api-key header, api_key config
  if (allContent.includes('x-api-key') || allContent.includes('apikey') ||
      allContent.includes('api-key-guard') || allContent.includes('apikeyguard')) {
    return 'api-key-internal';
  }

  // Sin auth: landing, docs, estáticos
  if (repoSlug.includes('landing') || repoSlug.includes('docs') ||
      repoSlug.includes('static') || repoSlug.includes('public')) {
    return 'none-public';
  }

  return 'unknown';
}

// ── Heurísticas de CI/CD ──────────────────────────────────────

function detectCiStages(ciFile: FileContent): string[] {
  if (!ciFile.found) return [];
  const stageMatch = ciFile.content.match(/^stages:\s*\n((?:\s+-\s+\S+\n?)+)/m);
  if (!stageMatch) return [];
  return (stageMatch[1] ?? '')
    .split('\n')
    .map(l => l.replace(/^\s+-\s+/, '').trim())
    .filter(Boolean);
}

function detectK8sNamespace(ciFile: FileContent): string | null {
  if (!ciFile.found) return null;
  const match = ciFile.content.match(/NAMESPACE[:\s=]+["']?([a-z0-9-]+)["']?/i);
  return match?.[1] ?? null;
}

// ── Heurísticas de tipo de app ────────────────────────────────

function detectAppType(
  files: Record<string, FileContent>,
  stack: RepoAnalysis['stack'],
  repoSlug: string
): AppType {
  const pkg = files['package.json'];
  if (pkg?.found) {
    try {
      const json = JSON.parse(pkg.content);
      const deps = { ...json.dependencies, ...json.devDependencies };
      // Shell / portal
      if (deps['single-spa'] || deps['@angular-architects/module-federation']) return 'frontend-mfe';
      if (stack.framework === 'angular' || stack.framework === 'react' || stack.framework === 'vue') return 'frontend-app';
      if (stack.framework === 'nestjs' && repoSlug.includes('bff')) return 'bff';
      if (stack.framework === 'nestjs') return repoSlug.includes('api') ? 'api-rest' : 'microservice';
    } catch { /* ignorar */ }
  }
  if (stack.framework === 'laravel') return repoSlug.includes('api') ? 'api-rest' : 'microservice';
  if (stack.framework === 'spring-boot') return 'microservice';
  if (repoSlug.includes('worker') || repoSlug.includes('job') || repoSlug.includes('cron')) return 'worker';
  return 'microservice'; // default
}

// ── Función principal ─────────────────────────────────────────

export function analyzeRepo(
  meta: RepoMeta,
  files: Record<string, FileContent>
): RepoAnalysis {
  const stack = detectStack(files);
  const auth = detectAuth(files, meta.slug);
  const ciFile = files['.gitlab-ci.yml'] ?? files['.github/workflows/ci.yml'] ?? { path: '', content: '', found: false };
  const ciStages = detectCiStages(ciFile);
  const k8sNamespace = detectK8sNamespace(ciFile);
  const appType = detectAppType(files, stack, meta.slug);

  const lastPushDate = meta.last_push ? new Date(meta.last_push) : null;
  const lastActiveDays = lastPushDate
    ? Math.floor((Date.now() - lastPushDate.getTime()) / 86_400_000)
    : 9999;

  // ¿Es un repo template? Si el nombre incluye "template" o "base" o "starter"
  const isTemplate = /template|base|starter|scaffold/i.test(meta.slug);

  // ¿Es el portal shell?
  const isPortalShell = meta.slug.includes('shell') || meta.slug.includes('portal') ||
    (files['package.json']?.content ?? '').includes('single-spa');

  // ¿Es MFE?
  const isMfe = appType === 'frontend-mfe' || meta.slug.includes('mfe');

  return {
    slug: meta.slug,
    display_name: meta.name,
    stack,
    app_type: appType,
    app_origin: lastActiveDays < 180 && !meta.archived ? 'legacy-app' : 'legacy-app', // siempre legacy hasta confirmar
    auth_pattern: auth,
    is_template: isTemplate,
    is_portal_shell: isPortalShell,
    is_mfe: isMfe,
    ci_stages: ciStages,
    k8s_namespace: k8sNamespace,
    last_active_days: lastActiveDays,
    inactive: lastActiveDays > 365 || meta.archived,
  };
}

export function synthesizeDiscovery(analyses: RepoAnalysis[]): DiscoveryResult {
  const active = analyses.filter(a => !a.inactive);
  const inactive = analyses.filter(a => a.inactive);

  const authPatterns = [...new Set(active.map(a => a.auth_pattern).filter(p => p !== 'unknown'))];
  const templates = active.filter(a => a.is_template).map(a => a.slug);
  const portal = active.find(a => a.is_portal_shell)?.slug ?? null;
  const mfes = active.filter(a => a.is_mfe).map(a => a.slug);
  const dbs = [...new Set(active.map(a => a.stack.db).filter(Boolean))] as string[];

  // CI template: el stage pattern más común entre repos activos con CI
  const withCi = active.filter(a => a.ci_stages.length > 0);
  const ciTemplate = withCi.length > 0
    ? withCi[0]?.ci_stages.join(' → ') ?? null
    : null;

  const summary = [
    `Encontré ${analyses.length} repos en total (${active.length} activos, ${inactive.length} sin actividad en >1 año).`,
    authPatterns.length > 0 ? `Patrones de auth detectados: ${authPatterns.join(', ')}.` : '',
    templates.length > 0 ? `Templates base identificados: ${templates.join(', ')}.` : '',
    portal ? `Portal shell principal: ${portal}.` : '',
    mfes.length > 0 ? `Microfrontends: ${mfes.length} (${mfes.slice(0, 3).join(', ')}${mfes.length > 3 ? '...' : ''}).` : '',
    dbs.length > 0 ? `Bases de datos: ${dbs.join(', ')}.` : '',
  ].filter(Boolean).join(' ');

  return {
    repos: analyses,
    auth_profiles_detected: authPatterns,
    templates_detected: templates,
    portal_shell: portal,
    mfes,
    ci_template: ciTemplate,
    dbs_detected: dbs,
    active_repos: active.length,
    inactive_repos: inactive.length,
    summary,
  };
}
