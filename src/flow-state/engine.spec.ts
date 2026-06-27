/**
 * Tests del motor de estado unificado (S10).
 *
 * Escenarios cubiertos:
 *   - Sin sesión, sin clientes → output mínimo pero estructurado
 *   - Con sesión activa (greenfield) → session poblada correctamente
 *   - Sesión cerrada → session null
 *   - Schema version invariante
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { saveSession } from '../utils/session-io.js';
import { createInitialSession } from '../types/session.js';
import type { SessionState } from '../types/session.js';

// ── Helper ────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'engine-spec-'));
  mkdirSync(path.join(dir, '.devflow'), { recursive: true });
  return dir;
}

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    ...createInitialSession('0.8.0'),
    feature_id: 'HDU-1',
    feature_name: 'Test feature',
    session_id: 'sess-test-1',
    started_at: new Date().toISOString(),
    last_heartbeat: new Date().toISOString(),
    ...overrides,
  };
}

// ── Schema invariants ─────────────────────────────────────────────────

describe('getFlowState — schema', () => {
  it('schema_version siempre es v1', async () => {
    const { getFlowState } = await import('./engine.js');
    expect(getFlowState().schema_version).toBe('v1');
  });

  it('generated_at es ISO válido', async () => {
    const { getFlowState } = await import('./engine.js');
    const { generated_at } = getFlowState();
    expect(new Date(generated_at).getTime()).toBeGreaterThan(0);
  });

  it('estructura tiene todas las claves requeridas', async () => {
    const { getFlowState } = await import('./engine.js');
    const s = getFlowState();
    expect(s).toHaveProperty('actor');
    expect(s).toHaveProperty('clients');
    expect(s).toHaveProperty('queue');
    expect(s).toHaveProperty('alerts');
    expect(s).toHaveProperty('hints');
    expect(Array.isArray(s.queue.in_progress)).toBe(true);
    expect(Array.isArray(s.queue.approved)).toBe(true);
  });
});

// ── Sin sesión ────────────────────────────────────────────────────────

describe('getFlowState — sin sesión activa', () => {
  it('session es null en projectRoot inexistente', async () => {
    const { getFlowState } = await import('./engine.js');
    expect(getFlowState({ projectRoot: '/tmp/__no_existe__' }).session).toBeNull();
  });

  it('hints incluye next-action', async () => {
    const { getFlowState } = await import('./engine.js');
    const s = getFlowState({ projectRoot: '/tmp/__no_existe__' });
    expect(s.hints.some(h => h.for === 'next-action')).toBe(true);
  });
});

// ── Con sesión activa ─────────────────────────────────────────────────

describe('getFlowState — sesión activa greenfield', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    saveSession(tmpDir, makeSession({
      dev_type: 'greenfield',
      dev_type_locked: false,
      flow_state: 'started',
    }));
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('session.active es true', async () => {
    const { getFlowState } = await import('./engine.js');
    expect(getFlowState({ projectRoot: tmpDir }).session?.active).toBe(true);
  });

  it('session.hdu_id coincide con feature_id', async () => {
    const { getFlowState } = await import('./engine.js');
    expect(getFlowState({ projectRoot: tmpDir }).session?.hdu_id).toBe('HDU-1');
  });

  it('session.dev_type es greenfield', async () => {
    const { getFlowState } = await import('./engine.js');
    expect(getFlowState({ projectRoot: tmpDir }).session?.dev_type).toBe('greenfield');
  });

  it('hints incluye próximo paso', async () => {
    const { getFlowState } = await import('./engine.js');
    const s = getFlowState({ projectRoot: tmpDir });
    expect(s.hints.some(h => h.for === 'next-action')).toBe(true);
  });

  it('duration_minutes >= 0', async () => {
    const { getFlowState } = await import('./engine.js');
    const dur = getFlowState({ projectRoot: tmpDir }).session?.duration_minutes ?? -1;
    expect(dur).toBeGreaterThanOrEqual(0);
  });
});

// ── Sesión cerrada ────────────────────────────────────────────────────

describe('getFlowState — sesión cerrada', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    const now = new Date().toISOString();
    saveSession(tmpDir, makeSession({ started_at: now, ended_at: now, flow_state: 'ended' }));
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('session es null si ended_at está seteado', async () => {
    const { getFlowState } = await import('./engine.js');
    expect(getFlowState({ projectRoot: tmpDir }).session).toBeNull();
  });
});

// ── Queue ─────────────────────────────────────────────────────────────

describe('getFlowState — queue', () => {
  it('queue.approved es array', async () => {
    const { getFlowState } = await import('./engine.js');
    expect(Array.isArray(getFlowState().queue.approved)).toBe(true);
  });

  it('queue.in_progress es array', async () => {
    const { getFlowState } = await import('./engine.js');
    expect(Array.isArray(getFlowState().queue.in_progress)).toBe(true);
  });

  it('next_suggested es null o string', async () => {
    const { getFlowState } = await import('./engine.js');
    const ns = getFlowState().queue.next_suggested;
    expect(ns === null || typeof ns === 'string').toBe(true);
  });
});
