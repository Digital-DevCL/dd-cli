/**
 * Tests del StackConfig (S1-1) — schema y I/O del master config del cliente.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  StackConfigSchema,
  loadStackConfig,
  saveStackConfig,
  hasStackConfig,
  getStackConfigPath,
  looksLikeLegacyMasterConfig,
} from './stack-config.js';

describe('StackConfig schema', () => {
  it('acepta una config mínima válida (con defaults)', () => {
    const result = StackConfigSchema.safeParse({
      client: { slug: 'iprsa', name: 'Inmobiliaria Reñaca S.A.' },
      stack: {
        backend_framework: 'Laravel 12',
        frontend_framework: 'Livewire 3',
        databases: ['PostgreSQL 16'],
        infra: 'Kubernetes',
        cicd_platform: 'GitLab CI',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // Defaults aplicados
      expect(result.data.naming.feature_id_pattern).toBe('HDU-{n}');
      expect(result.data.defaults.sprint_duration_weeks).toBe(2);
      expect(result.data.devflow.mode).toBe('local');
    }
  });

  it('rechaza slug con mayúsculas', () => {
    const result = StackConfigSchema.safeParse({
      client: { slug: 'Iprsa', name: 'X' },
      stack: {
        backend_framework: 'X', frontend_framework: 'X',
        databases: ['X'], infra: 'X', cicd_platform: 'X',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rechaza databases vacío', () => {
    const result = StackConfigSchema.safeParse({
      client: { slug: 'iprsa', name: 'X' },
      stack: {
        backend_framework: 'X', frontend_framework: 'X',
        databases: [], infra: 'X', cicd_platform: 'X',
      },
    });
    expect(result.success).toBe(false);
  });

  it('permite k8s_namespaces opcional', () => {
    const r = StackConfigSchema.safeParse({
      client: { slug: 'iprsa', name: 'X' },
      stack: {
        backend_framework: 'X', frontend_framework: 'X',
        databases: ['Postgres'], infra: 'Kubernetes', cicd_platform: 'GitLab CI',
        k8s_namespaces: { qa: 'ipr-qa', prod: 'ipr-prod' },
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.stack.k8s_namespaces).toEqual({ qa: 'ipr-qa', prod: 'ipr-prod' });
    }
  });

  it('templates.passthrough permite templates custom', () => {
    const r = StackConfigSchema.safeParse({
      client: { slug: 'iprsa', name: 'X' },
      stack: {
        backend_framework: 'X', frontend_framework: 'X',
        databases: ['Postgres'], infra: 'X', cicd_platform: 'X',
      },
      templates: {
        fullstack: 'iprsa-group/laravel-fullstack-template',
        worker: 'iprsa-group/queue-worker-template',
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      const tpl = r.data.templates as Record<string, unknown>;
      expect(tpl['worker']).toBe('iprsa-group/queue-worker-template');
    }
  });
});

describe('StackConfig I/O', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'stack-config-test-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('hasStackConfig retorna false cuando no existe', () => {
    expect(hasStackConfig(tmpRoot)).toBe(false);
  });

  it('saveStackConfig + loadStackConfig round-trip', () => {
    const config = StackConfigSchema.parse({
      client: { slug: 'iprsa', name: 'Inmobiliaria Reñaca S.A.', industry: 'Parques Cementerios' },
      stack: {
        backend_framework: 'Laravel 12',
        frontend_framework: 'Livewire 3',
        databases: ['PostgreSQL 16'],
        infra: 'Kubernetes',
        k8s_namespaces: { qa: 'ipr-qa', prod: 'ipr-prod' },
        cicd_platform: 'GitLab CI',
        identity_provider: 'core-auth',
        base_domain: 'iprsa.cl',
      },
    });

    saveStackConfig(tmpRoot, config);
    expect(hasStackConfig(tmpRoot)).toBe(true);

    const loaded = loadStackConfig(tmpRoot);
    expect(loaded?.client.slug).toBe('iprsa');
    expect(loaded?.stack.k8s_namespaces).toEqual({ qa: 'ipr-qa', prod: 'ipr-prod' });
    expect(loaded?.stack.identity_provider).toBe('core-auth');
  });

  it('loadStackConfig tira con mensaje claro si el YAML es inválido', () => {
    const stackPath = getStackConfigPath(tmpRoot);
    mkdirSync(path.dirname(stackPath), { recursive: true });
    writeFileSync(stackPath, 'client:\n  slug: 123\nstack: invalid\n', 'utf-8');
    expect(() => loadStackConfig(tmpRoot)).toThrow(/stack\.yml inválido/);
  });

  it('loadStackConfig retorna null si no existe', () => {
    expect(loadStackConfig(tmpRoot)).toBeNull();
  });
});

describe('looksLikeLegacyMasterConfig', () => {
  it('detecta legacy si hay `stack` en top-level', () => {
    expect(looksLikeLegacyMasterConfig({ stack: {} })).toBe(true);
  });

  it('detecta legacy si hay `project`', () => {
    expect(looksLikeLegacyMasterConfig({ project: {} })).toBe(true);
  });

  it('detecta legacy si hay `naming` o `templates`', () => {
    expect(looksLikeLegacyMasterConfig({ naming: {} })).toBe(true);
    expect(looksLikeLegacyMasterConfig({ templates: {} })).toBe(true);
  });

  it('no detecta legacy en ProjectConfig nuevo', () => {
    expect(looksLikeLegacyMasterConfig({ client: {}, app: {}, devflow: {} })).toBe(false);
  });

  it('retorna false para valores no-objeto', () => {
    expect(looksLikeLegacyMasterConfig(null)).toBe(false);
    expect(looksLikeLegacyMasterConfig('string')).toBe(false);
    expect(looksLikeLegacyMasterConfig(123)).toBe(false);
  });
});
