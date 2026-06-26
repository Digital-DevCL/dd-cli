/**
 * Tests de telemetría local (S7-1).
 * Cubren sanitización de PII, hash de usuario, config I/O, stats.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  TelemetryConfigSchema,
  TelemetryEventSchema,
  hashUser,
  sanitizeArgs,
  computeTelemetryStats,
  type TelemetryEvent,
} from './telemetry.js';

describe('hashUser', () => {
  it('hash es estable para el mismo email', () => {
    expect(hashUser('jorge@dd.cl')).toBe(hashUser('jorge@dd.cl'));
  });

  it('hash es case-insensitive', () => {
    expect(hashUser('Jorge@DD.CL')).toBe(hashUser('jorge@dd.cl'));
  });

  it('hash es trim-insensitive', () => {
    expect(hashUser('  jorge@dd.cl  ')).toBe(hashUser('jorge@dd.cl'));
  });

  it('emails distintos tienen hashes distintos', () => {
    expect(hashUser('a@x.com')).not.toBe(hashUser('b@x.com'));
  });

  it('retorna undefined para input nulo/vacío', () => {
    expect(hashUser(undefined)).toBeUndefined();
    expect(hashUser(null)).toBeUndefined();
  });

  it('hash es exactamente 8 chars', () => {
    expect(hashUser('jorge@dd.cl')).toMatch(/^[a-f0-9]{8}$/);
  });
});

describe('sanitizeArgs', () => {
  it('redacta keys que matchean patrones de secret', () => {
    const out = sanitizeArgs({ git_token: 'glpat-XXX', name: 'foo' });
    expect(out?.['git_token']).toBe('[redacted]');
    expect(out?.['name']).toBe('foo');
  });

  it('redacta tokens GitLab por shape', () => {
    const out = sanitizeArgs({ foo: 'glpat-abc123' });
    expect(out?.['foo']).toBe('[redacted-token]');
  });

  it('redacta tokens GitHub PAT por shape', () => {
    const out = sanitizeArgs({ x: 'ghp_abc123' });
    expect(out?.['x']).toBe('[redacted-token]');
  });

  it('redacta tokens fine-grained GitHub', () => {
    const out = sanitizeArgs({ x: 'github_pat_abc' });
    expect(out?.['x']).toBe('[redacted-token]');
  });

  it('trunca strings muy largos', () => {
    const long = 'x'.repeat(200);
    const out = sanitizeArgs({ foo: long });
    expect((out?.['foo'] as string).length).toBeLessThan(100);
    expect(out?.['foo']).toMatch(/truncated/);
  });

  it('preserva valores normales', () => {
    const out = sanitizeArgs({ slug: 'iprsa', count: 5, flag: true });
    expect(out?.['slug']).toBe('iprsa');
    expect(out?.['count']).toBe(5);
    expect(out?.['flag']).toBe(true);
  });

  it('retorna undefined para input undefined', () => {
    expect(sanitizeArgs(undefined)).toBeUndefined();
  });

  it('reconoce variantes de key (Token, API_KEY, Password, etc)', () => {
    const out = sanitizeArgs({
      Token: 'x', API_KEY: 'y', Password: 'z',
      pat: 'w', secret: 'v',
    });
    expect(out?.['Token']).toBe('[redacted]');
    expect(out?.['API_KEY']).toBe('[redacted]');
    expect(out?.['Password']).toBe('[redacted]');
    expect(out?.['pat']).toBe('[redacted]');
    expect(out?.['secret']).toBe('[redacted]');
  });
});

describe('TelemetryConfigSchema', () => {
  it('default es enabled: false', () => {
    const c = TelemetryConfigSchema.parse({});
    expect(c.enabled).toBe(false);
    expect(c.scope).toBe('local');
    expect(c.enabled_at).toBeNull();
  });

  it('acepta enabled: true con timestamp', () => {
    const c = TelemetryConfigSchema.parse({
      enabled: true, enabled_at: '2026-06-26T00:00:00Z',
    });
    expect(c.enabled).toBe(true);
  });
});

describe('TelemetryEventSchema', () => {
  it('rechaza evento sin ts/command', () => {
    expect(TelemetryEventSchema.safeParse({}).success).toBe(false);
  });

  it('acepta evento mínimo válido', () => {
    const r = TelemetryEventSchema.safeParse({
      ts: '2026-06-26T00:00:00Z',
      command: 'client new',
      exit_code: 0,
      duration_ms: 1500,
    });
    expect(r.success).toBe(true);
  });

  it('rechaza duration_ms negativo', () => {
    const r = TelemetryEventSchema.safeParse({
      ts: '2026-06-26T00:00:00Z',
      command: 'x',
      exit_code: 0,
      duration_ms: -1,
    });
    expect(r.success).toBe(false);
  });
});

describe('computeTelemetryStats', () => {
  function ev(over: Partial<TelemetryEvent>): TelemetryEvent {
    return {
      ts: '2026-06-26T10:00:00Z',
      command: 'client list',
      exit_code: 0,
      duration_ms: 100,
      ...over,
    } as TelemetryEvent;
  }

  it('total y avg duration', () => {
    const s = computeTelemetryStats([
      ev({ duration_ms: 100 }),
      ev({ duration_ms: 200 }),
      ev({ duration_ms: 300 }),
    ]);
    expect(s.total_events).toBe(3);
    expect(s.avg_duration_ms).toBe(200);
  });

  it('agrupa por comando y exit code', () => {
    const s = computeTelemetryStats([
      ev({ command: 'client list' }),
      ev({ command: 'client list', exit_code: 1 }),
      ev({ command: 'home' }),
    ]);
    expect(s.by_command['client list']).toBe(2);
    expect(s.by_command['home']).toBe(1);
    expect(s.by_exit_code['0']).toBe(2);
    expect(s.by_exit_code['1']).toBe(1);
  });

  it('agrupa errores por código', () => {
    const s = computeTelemetryStats([
      ev({ error_code: 'TOKEN_MISSING' }),
      ev({ error_code: 'TOKEN_MISSING' }),
      ev({ error_code: 'CLIENT_NOT_REGISTERED' }),
    ]);
    expect(s.by_error_code['TOKEN_MISSING']).toBe(2);
    expect(s.by_error_code['CLIENT_NOT_REGISTERED']).toBe(1);
  });

  it('cuenta días activos', () => {
    const s = computeTelemetryStats([
      ev({ ts: '2026-06-26T10:00:00Z' }),
      ev({ ts: '2026-06-26T15:00:00Z' }),
      ev({ ts: '2026-06-27T10:00:00Z' }),
      ev({ ts: '2026-06-28T10:00:00Z' }),
    ]);
    expect(s.active_days).toBe(3);
  });

  it('reporta oldest/newest', () => {
    const s = computeTelemetryStats([
      ev({ ts: '2026-06-26T10:00:00Z' }),
      ev({ ts: '2026-06-20T10:00:00Z' }),
      ev({ ts: '2026-06-28T10:00:00Z' }),
    ]);
    expect(s.oldest_event).toBe('2026-06-20T10:00:00Z');
    expect(s.newest_event).toBe('2026-06-28T10:00:00Z');
  });
});
