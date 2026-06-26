/**
 * Tests del schema HDU + transitions log (S5-1, S5-5).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  HduFrontmatterSchema,
  parseHduFile,
  serializeHdu,
  appendTransition,
  readTransitions,
  loadHdu,
  saveHdu,
  listHdus,
  regenerateHduIndex,
  loadHduIndex,
  canHduTransitionTo,
  legalNextStatuses,
  getHdusDir,
  getHduTransitionsPath,
  type Hdu,
} from './hdu.js';

describe('HduFrontmatterSchema', () => {
  it('acepta HDU mínima válida', () => {
    const r = HduFrontmatterSchema.safeParse({
      id: 'HDU-128',
      title: 'Auth SSO portal',
      created_at: '2026-06-20T10:00:00Z',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBe('draft');
      expect(r.data.priority).toBe('media');
    }
  });

  it('acepta IDs locales HDU-LOCAL-<slug>', () => {
    const r = HduFrontmatterSchema.safeParse({
      id: 'HDU-LOCAL-abc123-mi-feature',
      title: 'X',
      created_at: '2026-06-20T10:00:00Z',
    });
    expect(r.success).toBe(true);
  });

  it('rechaza ID con formato inválido', () => {
    expect(HduFrontmatterSchema.safeParse({
      id: 'WRONG-001',
      title: 'X',
      created_at: '2026-06-20T10:00:00Z',
    }).success).toBe(false);
  });

  it('rechaza status no enum', () => {
    expect(HduFrontmatterSchema.safeParse({
      id: 'HDU-1',
      title: 'X',
      status: 'finalized',
      created_at: '2026-06-20T10:00:00Z',
    }).success).toBe(false);
  });

  it('rechaza email inválido en assigned_to', () => {
    expect(HduFrontmatterSchema.safeParse({
      id: 'HDU-1',
      title: 'X',
      assigned_to: 'no-es-email',
      created_at: '2026-06-20T10:00:00Z',
    }).success).toBe(false);
  });
});

describe('parseHduFile / serializeHdu round-trip', () => {
  it('round-trip preserva frontmatter y body', () => {
    const original = `---
id: HDU-128
title: Auth SSO portal
status: approved
dev_type: brownfield-feature
priority: alta
apps_affected:
  - pdr-bff-cuentas
  - pdr-mfe-portal
created_at: '2026-06-20T10:00:00Z'
---

## Como
Usuario nuevo del portal.

## Quiero
Login con mi cuenta corporativa.
`;
    const hdu = parseHduFile(original, 'HDU-128-auth.md');
    expect(hdu.frontmatter.id).toBe('HDU-128');
    expect(hdu.frontmatter.status).toBe('approved');
    expect(hdu.frontmatter.apps_affected).toContain('pdr-bff-cuentas');
    expect(hdu.body).toContain('## Como');

    const reserialized = serializeHdu(hdu);
    const reparsed = parseHduFile(reserialized, 'HDU-128-auth.md');
    expect(reparsed.frontmatter).toEqual(hdu.frontmatter);
  });

  it('tira mensaje claro si no hay frontmatter', () => {
    expect(() => parseHduFile('# Sin frontmatter', 'x.md')).toThrow(/frontmatter YAML/);
  });
});

describe('HDU I/O (filesystem)', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'hdu-test-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('save + load round-trip', () => {
    const hdu: Hdu = {
      filename: 'HDU-1-test.md',
      frontmatter: HduFrontmatterSchema.parse({
        id: 'HDU-1',
        title: 'Test',
        created_at: new Date().toISOString(),
      }),
      body: '## Como\nUsuario\n',
    };
    saveHdu(tmpRoot, hdu);
    expect(existsSync(path.join(getHdusDir(tmpRoot), 'HDU-1-test.md'))).toBe(true);
    const loaded = loadHdu(tmpRoot, 'HDU-1-test.md');
    expect(loaded.frontmatter.id).toBe('HDU-1');
  });

  it('listHdus ignora _index.yml y _transitions.jsonl', () => {
    mkdirSync(getHdusDir(tmpRoot), { recursive: true });
    writeFileSync(path.join(getHdusDir(tmpRoot), '_index.yml'), 'schema_version: 1.0\n', 'utf-8');
    writeFileSync(path.join(getHdusDir(tmpRoot), '_transitions.jsonl'), '{}\n', 'utf-8');
    saveHdu(tmpRoot, {
      filename: 'HDU-1-test.md',
      frontmatter: HduFrontmatterSchema.parse({ id: 'HDU-1', title: 'X', created_at: new Date().toISOString() }),
      body: '',
    });
    const list = listHdus(tmpRoot);
    expect(list).toHaveLength(1);
    expect(list[0]?.frontmatter.id).toBe('HDU-1');
  });

  it('listHdus skip archivos con frontmatter inválido', () => {
    mkdirSync(getHdusDir(tmpRoot), { recursive: true });
    writeFileSync(path.join(getHdusDir(tmpRoot), 'broken.md'), '# Sin frontmatter', 'utf-8');
    saveHdu(tmpRoot, {
      filename: 'HDU-1-valid.md',
      frontmatter: HduFrontmatterSchema.parse({ id: 'HDU-1', title: 'X', created_at: new Date().toISOString() }),
      body: '',
    });
    expect(listHdus(tmpRoot)).toHaveLength(1);
  });
});

describe('Transitions log (append-only)', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'hdu-trans-test-'));
    mkdirSync(getHdusDir(tmpRoot), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('appendTransition agrega líneas sin reescribir', () => {
    appendTransition(tmpRoot, {
      ts: '2026-06-20T10:00:00Z',
      hdu: 'HDU-1',
      from: null,
      to: 'draft',
      by: 'pmo@cliente.cl',
      reason: 'creada',
      via: 'cli',
    });
    appendTransition(tmpRoot, {
      ts: '2026-06-21T11:00:00Z',
      hdu: 'HDU-1',
      from: 'draft',
      to: 'approved',
      by: 'tl@cliente.cl',
      reason: null,
      via: 'pr-merge',
    });
    const transitions = readTransitions(tmpRoot);
    expect(transitions).toHaveLength(2);
    expect(transitions[0]?.to).toBe('draft');
    expect(transitions[1]?.via).toBe('pr-merge');
  });

  it('readTransitions ignora líneas malformadas', () => {
    writeFileSync(getHduTransitionsPath(tmpRoot), '{"valid":true}\nNOT JSON\n{"ts":"x"}\n', 'utf-8');
    // El parser estricto rechazará la línea sin shape correcta, pero no debe tirar
    const transitions = readTransitions(tmpRoot);
    expect(Array.isArray(transitions)).toBe(true);
  });

  it('readTransitions retorna [] si no existe el archivo', () => {
    expect(readTransitions(tmpRoot)).toEqual([]);
  });
});

describe('regenerateHduIndex', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'hdu-idx-test-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('genera index con next_hdu_id correcto', () => {
    const create = (n: number) => saveHdu(tmpRoot, {
      filename: `HDU-${n}-test.md`,
      frontmatter: HduFrontmatterSchema.parse({
        id: `HDU-${n}`,
        title: `Test ${n}`,
        created_at: new Date().toISOString(),
      }),
      body: '',
    });
    create(1); create(2); create(5);
    const index = regenerateHduIndex(tmpRoot);
    expect(index.hdus).toHaveLength(3);
    expect(index.next_hdu_id).toBe(6);
  });

  it('genera index vacío si no hay HDUs', () => {
    const index = regenerateHduIndex(tmpRoot);
    expect(index.hdus).toHaveLength(0);
    expect(index.next_hdu_id).toBe(1);
  });

  it('saveHduIndex + loadHduIndex round-trip', () => {
    saveHdu(tmpRoot, {
      filename: 'HDU-1-x.md',
      frontmatter: HduFrontmatterSchema.parse({ id: 'HDU-1', title: 'X', created_at: new Date().toISOString() }),
      body: '',
    });
    const idx = regenerateHduIndex(tmpRoot);
    const loaded = loadHduIndex(tmpRoot);
    expect(loaded.next_hdu_id).toBe(idx.next_hdu_id);
    expect(loaded.hdus[0]?.id).toBe('HDU-1');
  });
});

describe('Máquina de estados HDU', () => {
  it('happy path completo es legal', () => {
    expect(canHduTransitionTo('draft', 'approved')).toBe(true);
    expect(canHduTransitionTo('approved', 'in-progress')).toBe(true);
    expect(canHduTransitionTo('in-progress', 'in-review')).toBe(true);
    expect(canHduTransitionTo('in-review', 'done')).toBe(true);
  });

  it('cancelar es legal desde cualquier estado pre-terminal', () => {
    expect(canHduTransitionTo('draft', 'cancelled')).toBe(true);
    expect(canHduTransitionTo('approved', 'cancelled')).toBe(true);
    expect(canHduTransitionTo('in-progress', 'cancelled')).toBe(true);
    expect(canHduTransitionTo('in-review', 'cancelled')).toBe(true);
  });

  it('done y cancelled son terminales', () => {
    expect(canHduTransitionTo('done', 'in-progress')).toBe(false);
    expect(canHduTransitionTo('done', 'draft')).toBe(false);
    expect(canHduTransitionTo('cancelled', 'draft')).toBe(false);
  });

  it('rollbacks legales', () => {
    expect(canHduTransitionTo('approved', 'draft')).toBe(true);
    expect(canHduTransitionTo('in-progress', 'approved')).toBe(true);  // pausar
    expect(canHduTransitionTo('in-review', 'in-progress')).toBe(true);  // rechazar review
  });

  it('legalNextStatuses lista los siguientes', () => {
    const next = legalNextStatuses('draft');
    expect(next).toContain('approved');
    expect(next).toContain('cancelled');
    expect(next).not.toContain('done');
  });
});
