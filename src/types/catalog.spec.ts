/**
 * Tests del Catalog (S1-2) — schema YAML canónico + parser backward-compat.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  CatalogSchema,
  CatalogAppSchema,
  loadCatalog,
  saveCatalog,
  hasCatalog,
  parseMarkdownCatalog,
  renderCatalogMarkdown,
  getCatalogYamlPath,
  getCatalogMarkdownPath,
} from './catalog.js';

describe('Catalog schema', () => {
  it('acepta una app mínima con defaults', () => {
    const result = CatalogAppSchema.safeParse({
      slug: 'mapa-cementerio',
      name: 'Mapa Cementerio',
      type: 'frontend-app',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe('standalone');
      expect(result.data.branch).toBe('main');
      expect(result.data.status).toBe('unknown');
      expect(result.data.app_origin).toBe('legacy-app');
      expect(result.data.preferred_dev_types).toEqual([]);
    }
  });

  it('rechaza slug con mayúsculas', () => {
    const r = CatalogAppSchema.safeParse({ slug: 'Foo', name: 'X', type: 'bff' });
    expect(r.success).toBe(false);
  });

  it('rechaza tipo inválido', () => {
    const r = CatalogAppSchema.safeParse({ slug: 'foo', name: 'X', type: 'serverless-fn' });
    expect(r.success).toBe(false);
  });

  it('acepta catalog completo', () => {
    const r = CatalogSchema.safeParse({
      apps: [
        { slug: 'core-auth', name: 'Core Auth', type: 'microservice', role: 'provider' },
        { slug: 'portal-web', name: 'Portal Web', type: 'frontend-app', role: 'portal' },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.apps).toHaveLength(2);
  });
});

describe('Catalog I/O', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'catalog-test-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('hasCatalog retorna false cuando no hay nada', () => {
    expect(hasCatalog(tmpRoot)).toBe(false);
  });

  it('saveCatalog + loadCatalog round-trip', () => {
    const cat = CatalogSchema.parse({
      apps: [
        { slug: 'iprsa-sso', name: 'IPRSA SSO', type: 'microservice', role: 'provider' },
        { slug: 'portal-web', name: 'Portal Web', type: 'frontend-app', role: 'portal', auth_profile: 'iprsa-sso' },
      ],
    });
    saveCatalog(tmpRoot, cat);
    expect(hasCatalog(tmpRoot)).toBe(true);

    const loaded = loadCatalog(tmpRoot);
    expect(loaded?.apps).toHaveLength(2);
    expect(loaded?.apps[0]?.slug).toBe('iprsa-sso');
    expect(loaded?.apps[1]?.auth_profile).toBe('iprsa-sso');
  });

  it('loadCatalog tira con mensaje claro si YAML es inválido', () => {
    const yamlPath = getCatalogYamlPath(tmpRoot);
    mkdirSync(path.dirname(yamlPath), { recursive: true });
    writeFileSync(yamlPath, 'apps:\n  - slug: 123\n    type: invalid\n', 'utf-8');
    expect(() => loadCatalog(tmpRoot)).toThrow(/catalog\.yml inválido/);
  });

  it('backward-compat: lee app-catalog.md si no hay yml', () => {
    const md = `# App catalog

| slug | tipo | app_origin | auth-profile | repo | ci_cd | estado | preferred_dev_types |
|---|---|---|---|---|---|---|---|
| \`core-auth\` | microservice | legacy-app | iprsa-sso | gitlab.com/iprsa-group/core-auth | sí | prod | brownfield-feature, brownfield-refactor |
| \`portal-web\` | frontend-app | legacy-app | iprsa-sso | gitlab.com/iprsa-group/portal-web | sí | qa | brownfield-feature |
`;
    const mdPath = getCatalogMarkdownPath(tmpRoot);
    mkdirSync(path.dirname(mdPath), { recursive: true });
    writeFileSync(mdPath, md, 'utf-8');

    const loaded = loadCatalog(tmpRoot);
    expect(loaded?.apps).toHaveLength(2);
    expect(loaded?.apps[0]?.slug).toBe('core-auth');
    expect(loaded?.apps[0]?.type).toBe('microservice');
    expect(loaded?.apps[0]?.auth_profile).toBe('iprsa-sso');
    // El "sí" en ci_cd column del skill viejo se trata como null (no es el nombre del profile)
    expect(loaded?.apps[0]?.ci_cd_profile).toBeNull();
    expect(loaded?.apps[0]?.status).toBe('prod');
    expect(loaded?.apps[0]?.preferred_dev_types).toContain('brownfield-feature');
  });
});

describe('parseMarkdownCatalog', () => {
  it('ignora header y separator', () => {
    const md = `| slug | tipo | app_origin | auth-profile | repo | ci_cd | estado | preferred_dev_types |
|---|---|---|---|---|---|---|---|
| \`core-auth\` | microservice | legacy-app | iprsa-sso | repo | sí | prod | brownfield-feature |
`;
    const apps = parseMarkdownCatalog(md);
    expect(apps).toHaveLength(1);
    expect(apps[0]?.slug).toBe('core-auth');
  });

  it('descarta filas con slug inválido', () => {
    const md = `| BadSlug | bff | legacy-app | jwt | repo | sí | prod | brownfield-feature |
| good-slug | bff | legacy-app | jwt | repo | sí | prod | brownfield-feature |
`;
    const apps = parseMarkdownCatalog(md);
    expect(apps).toHaveLength(1);
    expect(apps[0]?.slug).toBe('good-slug');
  });

  it('preserva el nombre del ci_cd_profile cuando no es boolean', () => {
    const md = `| \`foo\` | bff | legacy-app | jwt | repo | gitlab-laravel-k8s | prod | brownfield-feature |
`;
    const apps = parseMarkdownCatalog(md);
    expect(apps[0]?.ci_cd_profile).toBe('gitlab-laravel-k8s');
  });
});

describe('renderCatalogMarkdown', () => {
  it('genera markdown válido con header + filas', () => {
    const cat = CatalogSchema.parse({
      apps: [
        {
          slug: 'iprsa-sso',
          name: 'IPRSA SSO',
          type: 'microservice',
          role: 'provider',
          auth_profile: 'iprsa-sso',
          ci_cd_profile: 'gitlab-laravel-k8s',
          status: 'prod',
          preferred_dev_types: ['brownfield-feature'],
        },
      ],
    });
    const md = renderCatalogMarkdown(cat);
    expect(md).toContain('# App catalog');
    expect(md).toContain('| `iprsa-sso` |');
    expect(md).toContain('| microservice |');
    expect(md).toContain('| brownfield-feature |');
  });

  it('round-trip yaml → md → parser preserva los campos básicos', () => {
    const cat = CatalogSchema.parse({
      apps: [
        {
          slug: 'core-auth',
          name: 'Core Auth',
          type: 'microservice',
          auth_profile: 'iprsa-sso',
          ci_cd_profile: 'gitlab-laravel-k8s',
          app_origin: 'legacy-app',
          status: 'prod',
          preferred_dev_types: ['brownfield-feature', 'brownfield-refactor'],
        },
      ],
    });
    const md = renderCatalogMarkdown(cat);
    const reparsed = parseMarkdownCatalog(md);
    expect(reparsed).toHaveLength(1);
    expect(reparsed[0]?.slug).toBe('core-auth');
    expect(reparsed[0]?.type).toBe('microservice');
    expect(reparsed[0]?.auth_profile).toBe('iprsa-sso');
    expect(reparsed[0]?.ci_cd_profile).toBe('gitlab-laravel-k8s');
  });
});
