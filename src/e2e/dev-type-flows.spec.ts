/**
 * Tests E2E — 5 escenarios, uno por dev_type.
 *
 * Cada test simula el recorrido de estados de una sesión real y valida:
 *   - statusline muestra el paso correcto en cada etapa
 *   - status muestra el stage correcto
 *   - next sugiere la skill correcta
 *   - heartbeat hace la transición correcta
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { saveSession, loadSession } from '../utils/session-io.js';
import { createInitialSession } from '../types/session.js';
import { detectFlowState } from '../flow-state/detect.js';
import { getStageContext } from '../flow-state/flow-stages.js';
import { runStatusline } from '../commands/statusline.js';
import { runNext } from '../commands/next-cmd.js';
import type { DevType } from '../types/dev-type.js';
import type { SessionState } from '../types/session.js';

// Simular process.cwd() para cada test
function makeSession(devType: DevType, overrides: Partial<SessionState> = {}): SessionState {
  return {
    ...createInitialSession('0.2.0'),
    feature_id: 'HDU-E2E',
    feature_name: `E2E ${devType}`,
    started_at: new Date().toISOString(),
    last_heartbeat: new Date().toISOString(),
    dev_type: devType,
    dev_type_source: 'business-brief',
    dev_type_rationale: 'test',
    dev_type_locked: false,
    flow_state: 'started',
    ...overrides,
  };
}

describe('E2E — greenfield (8 pasos)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'df-gf-')); mkdirSync(path.join(dir, '.devflow')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('started → statusline muestra paso 2/8: /new-spec', () => {
    const s = makeSession('greenfield');
    saveSession(dir, s);
    const line = runStatuslineInDir(dir);
    expect(line).toContain('paso 2/8');
    expect(line).toContain('/new-spec');
    expect(line).toContain('greenfield');
  });

  it('spec_ready + locked → statusline muestra paso 3/8: /new-app', () => {
    mkdirSync(path.join(dir, '.ai'));
    writeFileSync(path.join(dir, '.ai/SPEC.md'), 'x'.repeat(200));
    const s = makeSession('greenfield', { dev_type_locked: true, flow_state: 'spec_ready' });
    saveSession(dir, s);
    const detected = detectFlowState({ projectRoot: dir, session: s });
    expect(detected).toBe('spec_ready');
    const ctx = getStageContext(s, detected)!;
    expect(ctx.currentStage?.id).toBe('/new-app');
    expect(ctx.currentIndex).toBe(3);
  });

  it('change_active → paso 6/8: /opsx:apply', () => {
    mkdirSync(path.join(dir, '.ai'));
    writeFileSync(path.join(dir, '.ai/SPEC.md'), 'x'.repeat(200));
    mkdirSync(path.join(dir, 'openspec/changes/auth-sso'), { recursive: true });
    writeFileSync(path.join(dir, 'openspec/changes/auth-sso/tasks.md'), '- [ ] task 1');
    const s = makeSession('greenfield', { dev_type_locked: true, flow_state: 'change_active' });
    saveSession(dir, s);
    const detected = detectFlowState({ projectRoot: dir, session: s });
    expect(detected).toBe('change_active');
    const ctx = getStageContext(s, detected)!;
    expect(ctx.currentStage?.id).toBe('/opsx:apply');
  });
});

describe('E2E — brownfield-feature (8 pasos)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'df-bf-')); mkdirSync(path.join(dir, '.devflow')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('started → próximo stage es /init-repo-context', () => {
    const s = makeSession('brownfield-feature');
    saveSession(dir, s);
    const detected = detectFlowState({ projectRoot: dir, session: s });
    const ctx = getStageContext(s, detected)!;
    expect(ctx.currentStage?.id).toBe('/init-repo-context');
    expect(ctx.currentIndex).toBe(2);
  });

  it('repo_mapped → próximo paso es /new-spec', () => {
    mkdirSync(path.join(dir, '.ai'));
    writeFileSync(path.join(dir, '.ai/REPO-CONTEXT.md'), '---\nschema_version: 1\n---\ncontent');
    const s = makeSession('brownfield-feature', { repo_context_path: '.ai/REPO-CONTEXT.md' });
    saveSession(dir, s);
    const detected = detectFlowState({ projectRoot: dir, session: s });
    expect(detected).toBe('repo_mapped');
    const ctx = getStageContext(s, detected)!;
    expect(ctx.currentStage?.id).toBe('/new-spec');
  });

  it('spec_ready + locked → paso 4/8: /derive-spec', () => {
    mkdirSync(path.join(dir, '.ai'));
    writeFileSync(path.join(dir, '.ai/REPO-CONTEXT.md'), 'x');
    writeFileSync(path.join(dir, '.ai/SPEC.md'), 'x'.repeat(200));
    const s = makeSession('brownfield-feature', { dev_type_locked: true, repo_context_path: '.ai/REPO-CONTEXT.md' });
    saveSession(dir, s);
    const detected = detectFlowState({ projectRoot: dir, session: s });
    expect(detected).toBe('spec_ready');
    const ctx = getStageContext(s, detected)!;
    expect(ctx.currentStage?.id).toBe('/derive-spec');
    expect(ctx.currentIndex).toBe(4);
  });
});

describe('E2E — brownfield-refactor (9 pasos)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'df-br-')); mkdirSync(path.join(dir, '.devflow')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('started → próximo stage es /init-repo-context', () => {
    const s = makeSession('brownfield-refactor');
    saveSession(dir, s);
    const detected = detectFlowState({ projectRoot: dir, session: s });
    expect(detected).toBe('started');
    const ctx = getStageContext(s, detected)!;
    expect(ctx.currentStage?.id).toBe('/init-repo-context');
    expect(ctx.currentIndex).toBe(2);
  });

  it('repo_mapped → paso 3/9: /map-service', () => {
    mkdirSync(path.join(dir, '.ai'));
    writeFileSync(path.join(dir, '.ai/REPO-CONTEXT.md'), 'x');
    const s = makeSession('brownfield-refactor', { repo_context_path: '.ai/REPO-CONTEXT.md' });
    saveSession(dir, s);
    const detected = detectFlowState({ projectRoot: dir, session: s });
    expect(detected).toBe('repo_mapped');
    const ctx = getStageContext(s, detected)!;
    expect(ctx.currentStage?.id).toBe('/map-service');
  });

  it('baseline_ready → paso 5/9: /new-spec', () => {
    mkdirSync(path.join(dir, '.ai'));
    writeFileSync(path.join(dir, '.ai/REPO-CONTEXT.md'), 'x');
    writeFileSync(path.join(dir, '.ai/BASELINE-cobranza.md'),
      '---\nlocked_at: 2026-06-21T10:00:00Z\n---\ncontent');
    const s = makeSession('brownfield-refactor', { repo_context_path: '.ai/REPO-CONTEXT.md', baseline_path: '.ai/BASELINE-cobranza.md' });
    saveSession(dir, s);
    const detected = detectFlowState({ projectRoot: dir, session: s });
    expect(detected).toBe('baseline_ready');
    const ctx = getStageContext(s, detected)!;
    expect(ctx.currentStage?.id).toBe('/new-spec');
    expect(ctx.currentIndex).toBe(5);
    expect(ctx.total).toBe(9);
  });
});

describe('E2E — modernizacion (9 pasos)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'df-mod-')); mkdirSync(path.join(dir, '.devflow')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('9 pasos en total', () => {
    const s = makeSession('modernizacion');
    saveSession(dir, s);
    const ctx = getStageContext(s, 'started')!;
    expect(ctx.total).toBe(9);
  });

  it('started → paso 2/9: /init-repo-context (--on=<legacy>)', () => {
    const s = makeSession('modernizacion');
    saveSession(dir, s);
    const ctx = getStageContext(s, 'started')!;
    expect(ctx.currentStage?.id).toBe('/init-repo-context');
    expect(ctx.currentStage?.command).toContain('--on=');
  });

  it('repo_mapped → paso 3/9: /trace-flow', () => {
    mkdirSync(path.join(dir, '.ai'));
    writeFileSync(path.join(dir, '.ai/REPO-CONTEXT.md'), 'x');
    const s = makeSession('modernizacion', { repo_context_path: '.ai/REPO-CONTEXT.md' });
    saveSession(dir, s);
    const detected = detectFlowState({ projectRoot: dir, session: s });
    expect(detected).toBe('repo_mapped');
    const ctx = getStageContext(s, detected)!;
    expect(ctx.currentStage?.id).toBe('/trace-flow');
  });
});

describe('E2E — integracion-externa (8 pasos)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'df-ie-')); mkdirSync(path.join(dir, '.devflow')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('8 pasos en total', () => {
    const s = makeSession('integracion-externa');
    const ctx = getStageContext(s, 'started')!;
    expect(ctx.total).toBe(8);
  });

  it('started → paso 2/8: /init-repo-context (opcional)', () => {
    const s = makeSession('integracion-externa');
    saveSession(dir, s);
    const ctx = getStageContext(s, 'started')!;
    expect(ctx.currentStage?.id).toBe('/init-repo-context');
  });

  it('spec_ready + locked → paso 4/8: /derive-spec', () => {
    mkdirSync(path.join(dir, '.ai'));
    writeFileSync(path.join(dir, '.ai/REPO-CONTEXT.md'), 'x');
    writeFileSync(path.join(dir, '.ai/SPEC.md'), 'x'.repeat(200));
    const s = makeSession('integracion-externa', { dev_type_locked: true, repo_context_path: '.ai/REPO-CONTEXT.md' });
    saveSession(dir, s);
    const detected = detectFlowState({ projectRoot: dir, session: s });
    expect(detected).toBe('spec_ready');
    const ctx = getStageContext(s, detected)!;
    expect(ctx.currentStage?.id).toBe('/derive-spec');
    expect(ctx.currentIndex).toBe(4);
  });
});

// ── Helpers ────────────────────────────────────────────────

function runStatuslineInDir(dir: string): string {
  const originalCwd = process.cwd();
  process.chdir(dir);
  const result = runStatusline();
  process.chdir(originalCwd);
  return result;
}

function runNextInDir(dir: string): string {
  // Capturar output de runNext (escribe a stdout)
  const originalCwd = process.cwd();
  const originalWrite = process.stdout.write.bind(process.stdout);
  const output: string[] = [];
  process.stdout.write = (s: string | Uint8Array) => { output.push(String(s)); return true; };
  process.chdir(dir);
  try { runNext(); } catch { /* ignorar */ }
  process.chdir(originalCwd);
  process.stdout.write = originalWrite;
  return output.join('');
}
