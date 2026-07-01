import { describe, it, expect } from 'vitest';
import { reclassify } from './reclassify.js';
import { createInitialSession } from '../types/session.js';
import type { SessionState } from '../types/session.js';

function activeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    ...createInitialSession('0.9.0'),
    feature_id: 'HDU-1',
    started_at: new Date().toISOString(),
    dev_type: 'brownfield-feature',
    dev_type_locked: true,
    mode: 'local',
    ...overrides,
  };
}

describe('reclassify', () => {
  it('funciona en modo local (bug: antes bloqueaba con NOT_PLATFORM_MODE)', () => {
    const result = reclassify({
      session: activeSession(),
      newType: 'modernizacion',
      reason: 'El legacy expuesto obliga a tratarlo como modernización, no feature nueva.',
      callerRole: 'tech-lead',
    });

    expect(result.ok).toBe(true);
    expect(result.updatedSession?.dev_type).toBe('modernizacion');
    expect(result.updatedSession?.dev_type_source).toBe('reclassify');
  });

  it('funciona en modo platform con rol tech-lead', () => {
    const result = reclassify({
      session: activeSession({ mode: 'platform' }),
      newType: 'modernizacion',
      reason: 'El legacy expuesto obliga a tratarlo como modernización, no feature nueva.',
      callerRole: 'tech-lead',
    });

    expect(result.ok).toBe(true);
  });

  it('rechaza reason < 30 caracteres en cualquier modo', () => {
    const result = reclassify({
      session: activeSession(),
      newType: 'modernizacion',
      reason: 'muy corto',
      callerRole: 'tech-lead',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('REASON_TOO_SHORT');
  });

  it('rechaza rol insuficiente en cualquier modo', () => {
    const result = reclassify({
      session: activeSession(),
      newType: 'modernizacion',
      reason: 'El legacy expuesto obliga a tratarlo como modernización, no feature nueva.',
      callerRole: 'dev',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('INSUFFICIENT_ROLE');
  });

  it('el session resultante cumple el schema v2 (dev_type_source=reclassify es válido)', async () => {
    const { SessionStateSchema } = await import('../types/session.js');
    const result = reclassify({
      session: activeSession(),
      newType: 'modernizacion',
      reason: 'El legacy expuesto obliga a tratarlo como modernización, no feature nueva.',
      callerRole: 'tech-lead',
    });

    expect(SessionStateSchema.safeParse(result.updatedSession).success).toBe(true);
  });
});
