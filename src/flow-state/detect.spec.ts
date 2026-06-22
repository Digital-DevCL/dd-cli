import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { detectFlowState, suggestedNextStep } from './detect.js';
import { createInitialSession, type SessionState } from '../types/session.js';
import type { DevType } from '../types/dev-type.js';

function makeSession(overrides: Partial<SessionState>): SessionState {
  const base = createInitialSession('0.2.0');
  return { ...base, ...overrides };
}

describe('detectFlowState', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'devflow-test-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('devuelve not_started si nunca arrancó', () => {
    const session = makeSession({ started_at: null });
    expect(detectFlowState({ projectRoot, session })).toBe('not_started');
  });

  it('devuelve ended si la sesión tiene ended_at', () => {
    const session = makeSession({
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
    });
    expect(detectFlowState({ projectRoot, session })).toBe('ended');
  });

  it('greenfield: started → spec_ready si .ai/SPEC.md existe + locked', () => {
    mkdirSync(path.join(projectRoot, '.ai'));
    writeFileSync(path.join(projectRoot, '.ai/SPEC.md'), 'x'.repeat(200));
    const session = makeSession({
      started_at: new Date().toISOString(),
      dev_type: 'greenfield',
      dev_type_locked: true,
    });
    expect(detectFlowState({ projectRoot, session })).toBe('spec_ready');
  });

  it('greenfield: salta repo_mapped (sin REPO-CONTEXT)', () => {
    const session = makeSession({
      started_at: new Date().toISOString(),
      dev_type: 'greenfield',
    });
    expect(detectFlowState({ projectRoot, session })).toBe('started');
  });

  it('brownfield-feature: started si no hay REPO-CONTEXT', () => {
    const session = makeSession({
      started_at: new Date().toISOString(),
      dev_type: 'brownfield-feature',
    });
    expect(detectFlowState({ projectRoot, session })).toBe('started');
  });

  it('brownfield-feature: repo_mapped si REPO-CONTEXT existe pero sin SPEC locked', () => {
    mkdirSync(path.join(projectRoot, '.ai'));
    writeFileSync(path.join(projectRoot, '.ai/REPO-CONTEXT.md'), 'x');
    const session = makeSession({
      started_at: new Date().toISOString(),
      dev_type: 'brownfield-feature',
    });
    expect(detectFlowState({ projectRoot, session })).toBe('repo_mapped');
  });

  it('brownfield-refactor: queda en started sin REPO-CONTEXT', () => {
    const session = makeSession({
      started_at: new Date().toISOString(),
      dev_type: 'brownfield-refactor',
    });
    expect(detectFlowState({ projectRoot, session })).toBe('started');
  });

  it('brownfield-refactor: repo_mapped con REPO-CONTEXT pero sin BASELINE locked', () => {
    mkdirSync(path.join(projectRoot, '.ai'));
    writeFileSync(path.join(projectRoot, '.ai/REPO-CONTEXT.md'), 'x');
    const session = makeSession({
      started_at: new Date().toISOString(),
      dev_type: 'brownfield-refactor',
    });
    expect(detectFlowState({ projectRoot, session })).toBe('repo_mapped');
  });

  it('brownfield-refactor: baseline_ready con BASELINE locked', () => {
    mkdirSync(path.join(projectRoot, '.ai'));
    writeFileSync(path.join(projectRoot, '.ai/REPO-CONTEXT.md'), 'x');
    writeFileSync(
      path.join(projectRoot, '.ai/BASELINE-cobranza.md'),
      `---\nlocked_at: 2026-06-19T14:30:00Z\n---\n# baseline`
    );
    const session = makeSession({
      started_at: new Date().toISOString(),
      dev_type: 'brownfield-refactor',
    });
    expect(detectFlowState({ projectRoot, session })).toBe('baseline_ready');
  });

  it('brownfield-refactor: queda repo_mapped si BASELINE existe pero NO locked', () => {
    mkdirSync(path.join(projectRoot, '.ai'));
    writeFileSync(path.join(projectRoot, '.ai/REPO-CONTEXT.md'), 'x');
    writeFileSync(
      path.join(projectRoot, '.ai/BASELINE-cobranza.md'),
      `---\nlocked_at: null\n---\n# baseline`
    );
    const session = makeSession({
      started_at: new Date().toISOString(),
      dev_type: 'brownfield-refactor',
    });
    expect(detectFlowState({ projectRoot, session })).toBe('repo_mapped');
  });

  it('change_active si openspec/changes/*/tasks.md existe + SPEC locked', () => {
    mkdirSync(path.join(projectRoot, '.ai'));
    mkdirSync(path.join(projectRoot, 'openspec/changes/auth-sso'), { recursive: true });
    writeFileSync(path.join(projectRoot, '.ai/SPEC.md'), 'x'.repeat(200));
    writeFileSync(path.join(projectRoot, 'openspec/changes/auth-sso/tasks.md'), '- [ ] task 1');
    const session = makeSession({
      started_at: new Date().toISOString(),
      dev_type: 'greenfield',
      dev_type_locked: true,
    });
    expect(detectFlowState({ projectRoot, session })).toBe('change_active');
  });
});

describe('suggestedNextStep', () => {
  const flows: Array<[Parameters<typeof suggestedNextStep>[0], DevType | null, string]> = [
    ['not_started', null, 'dd-cli start-session'],
    ['started', 'greenfield', '/new-spec'],
    ['started', 'brownfield-feature', '/init-repo-context'],
    ['started', 'modernizacion', '--on='],
    ['started', 'integracion-externa', '/init-repo-context'],
    ['repo_mapped', 'brownfield-feature', '/new-spec'],
    ['repo_mapped', 'brownfield-refactor', '/map-service'],
    ['repo_mapped', 'modernizacion', '/trace-flow'],
    ['baseline_ready', 'brownfield-refactor', '/new-spec(R)'],
    ['spec_ready', 'greenfield', '/opsx:propose'],
    ['change_active', 'greenfield', '/opsx:apply'],
  ];

  for (const [state, devType, contains] of flows) {
    it(`(${state}, ${devType}) sugiere algo con "${contains}"`, () => {
      const result = suggestedNextStep(state, devType);
      expect(result.toLowerCase()).toContain(contains.toLowerCase());
    });
  }
});
