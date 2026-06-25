/**
 * Tests del contrato JSON (S1-9, D-7/D-8 Parte 3).
 * Estos tests son la garantía de que el shape no rota — cualquier cambio
 * que rompa la forma esperada falla el build y rompe los consumers
 * (skills, CI, etc).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isJsonMode,
  formatJson,
  jsonSuccess,
  jsonError,
} from './json-output.js';
import { ERROR_CODES, exitCodeFor } from './error-codes.js';

describe('json-output', () => {
  describe('isJsonMode', () => {
    const origEnv = process.env.DEVFLOW_CLAUDE_MODE;

    beforeEach(() => {
      delete process.env.DEVFLOW_CLAUDE_MODE;
    });

    afterEach(() => {
      if (origEnv !== undefined) process.env.DEVFLOW_CLAUDE_MODE = origEnv;
    });

    it('returns true when --json flag is set', () => {
      expect(isJsonMode({ json: true })).toBe(true);
    });

    it('returns true when DEVFLOW_CLAUDE_MODE=1', () => {
      process.env.DEVFLOW_CLAUDE_MODE = '1';
      expect(isJsonMode()).toBe(true);
    });

    it('returns false when neither is set', () => {
      expect(isJsonMode()).toBe(false);
      expect(isJsonMode({ json: false })).toBe(false);
    });

    it('returns false for DEVFLOW_CLAUDE_MODE != "1"', () => {
      process.env.DEVFLOW_CLAUDE_MODE = '0';
      expect(isJsonMode()).toBe(false);
      process.env.DEVFLOW_CLAUDE_MODE = 'true';
      expect(isJsonMode()).toBe(false);
    });
  });

  describe('jsonSuccess', () => {
    it('builds a success output with required fields', () => {
      const out = jsonSuccess('test-cmd', { foo: 'bar' });
      expect(out.status).toBe('success');
      expect(out.command).toBe('test-cmd');
      expect(out.cli_version).toMatch(/^\d+\.\d+\.\d+/);
      expect(out.data).toEqual({ foo: 'bar' });
      expect(out.next_safe_command).toBeUndefined();
    });

    it('includes next_safe_command when provided', () => {
      const out = jsonSuccess('test-cmd', {}, 'dd-cli foo');
      expect(out.next_safe_command).toBe('dd-cli foo');
    });

    it('allows null next_safe_command (explicit "no next step")', () => {
      const out = jsonSuccess('test-cmd', {}, null);
      expect(out.next_safe_command).toBeNull();
    });
  });

  describe('jsonError', () => {
    it('builds an error output with required fields', () => {
      const out = jsonError({
        command: 'test-cmd',
        code: 'CLIENT_NOT_REGISTERED',
        message: 'no se pudo',
      });
      expect(out.status).toBe('error');
      expect(out.code).toBe('CLIENT_NOT_REGISTERED');
      expect(out.message).toBe('no se pudo');
      expect(out.context).toBeUndefined();
      expect(out.recovery_hints).toBeUndefined();
    });

    it('includes context and recovery_hints when provided', () => {
      const out = jsonError({
        command: 'test-cmd',
        code: 'TOKEN_INSUFFICIENT_SCOPE',
        message: 'token requiere scope api',
        context: { scope_present: 'read_api', scope_required: 'api' },
        recovery_hints: [
          'Regenerá el token con scope `api`',
          'Ejecutá: dd-cli client upgrade-token <slug>',
        ],
      });
      expect(out.context).toEqual({ scope_present: 'read_api', scope_required: 'api' });
      expect(out.recovery_hints).toHaveLength(2);
    });
  });

  describe('formatJson', () => {
    it('produces stable, pretty-printed JSON', () => {
      const out = jsonSuccess('foo', { a: 1 });
      const formatted = formatJson(out);
      expect(formatted).toContain('"status": "success"');
      expect(formatted).toContain('"command": "foo"');
      const parsed = JSON.parse(formatted);
      expect(parsed.status).toBe('success');
    });

    it('round-trips through JSON.parse', () => {
      const out = jsonError({
        command: 'cmd',
        code: 'INTERNAL_ERROR',
        message: 'msg',
        recovery_hints: ['hint1'],
      });
      const parsed = JSON.parse(formatJson(out));
      expect(parsed).toEqual(out);
    });
  });
});

describe('error-codes', () => {
  it('ERROR_CODES is a frozen list of unique stable codes', () => {
    const set = new Set(ERROR_CODES);
    expect(set.size).toBe(ERROR_CODES.length);
    expect(ERROR_CODES.length).toBeGreaterThan(20);
  });

  it('all known error codes map to a valid exit code 1/2/3', () => {
    for (const code of ERROR_CODES) {
      const exit = exitCodeFor(code);
      expect([1, 2, 3]).toContain(exit);
    }
  });

  it('schema/validation errors return exit code 3', () => {
    expect(exitCodeFor('CONFIG_INVALID')).toBe(3);
    expect(exitCodeFor('CATALOG_PARSE_ERROR')).toBe(3);
    expect(exitCodeFor('INVALID_INPUT')).toBe(3);
  });

  it('precondition errors return exit code 2', () => {
    expect(exitCodeFor('CLIENT_NOT_REGISTERED')).toBe(2);
    expect(exitCodeFor('TOKEN_MISSING')).toBe(2);
    expect(exitCodeFor('PROJECT_NOT_INITIALIZED')).toBe(2);
  });

  it('operational errors (network, generic) return exit code 1', () => {
    expect(exitCodeFor('NETWORK_ERROR')).toBe(1);
    expect(exitCodeFor('GIT_CLONE_FAILED')).toBe(1);
    expect(exitCodeFor('INTERNAL_ERROR')).toBe(1);
  });
});
