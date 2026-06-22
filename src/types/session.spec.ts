import { describe, it, expect } from 'vitest';
import {
  SessionStateSchema,
  FlowStateSchema,
  createInitialSession,
  DevTypeSchema,
} from './session.js';

describe('SessionStateSchema', () => {
  it('acepta el estado inicial generado por createInitialSession', () => {
    const initial = createInitialSession('0.2.0');
    const result = SessionStateSchema.safeParse(initial);
    expect(result.success).toBe(true);
  });

  it('rechaza schema_version distinto a 2', () => {
    const initial = createInitialSession('0.2.0');
    const broken = { ...initial, schema_version: 1 };
    const result = SessionStateSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });

  it('rechaza dev_type fuera del enum', () => {
    const initial = createInitialSession('0.2.0');
    const broken = { ...initial, dev_type: 'something-else' };
    const result = SessionStateSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });

  it('acepta dev_type=null en estado inicial', () => {
    const initial = createInitialSession('0.2.0');
    expect(initial.dev_type).toBeNull();
    expect(SessionStateSchema.safeParse(initial).success).toBe(true);
  });

  it('acepta los 5 dev_types válidos', () => {
    const valid = [
      'greenfield',
      'brownfield-feature',
      'brownfield-refactor',
      'modernizacion',
      'integracion-externa',
    ];
    for (const t of valid) {
      expect(DevTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it('rechaza dev_type_rationale > 300 chars', () => {
    const initial = createInitialSession('0.2.0');
    const broken = { ...initial, dev_type_rationale: 'x'.repeat(301) };
    const result = SessionStateSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });

  it('rechaza dev_type_subtype > 40 chars', () => {
    const initial = createInitialSession('0.2.0');
    const broken = { ...initial, dev_type_subtype: 'x'.repeat(41) };
    expect(SessionStateSchema.safeParse(broken).success).toBe(false);
  });
});

describe('FlowStateSchema', () => {
  it('acepta los 7 estados del flujo', () => {
    const states = [
      'not_started',
      'started',
      'repo_mapped',
      'baseline_ready',
      'spec_ready',
      'change_active',
      'ended',
    ];
    for (const s of states) {
      expect(FlowStateSchema.safeParse(s).success).toBe(true);
    }
  });

  it('rechaza estados desconocidos', () => {
    expect(FlowStateSchema.safeParse('paused').success).toBe(false);
  });
});

describe('createInitialSession', () => {
  it('arranca con flow_state=not_started', () => {
    const s = createInitialSession('0.2.0');
    expect(s.flow_state).toBe('not_started');
  });

  it('no tiene tipo definido inicialmente', () => {
    const s = createInitialSession('0.2.0');
    expect(s.dev_type).toBeNull();
    expect(s.dev_type_locked).toBe(false);
  });

  it('cli_version coincide con el parámetro', () => {
    expect(createInitialSession('1.0.0').cli_version).toBe('1.0.0');
  });
});
