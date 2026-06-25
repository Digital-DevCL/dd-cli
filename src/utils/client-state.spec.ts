/**
 * Tests de la máquina de estados del cliente (S3-7, D-3 Parte 3).
 */
import { describe, it, expect } from 'vitest';
import {
  CLIENT_STATES,
  canTransitionTo,
  nextNaturalState,
  suggestedCommandFor,
} from './client-state.js';

describe('CLIENT_STATES', () => {
  it('tiene los 6 estados canónicos en orden', () => {
    expect(CLIENT_STATES).toEqual([
      'REGISTERED',
      'DISCOVERED',
      'DRAFT',
      'READY',
      'ACTIVE',
      'NEEDS_REFRESH',
    ]);
  });
});

describe('canTransitionTo', () => {
  it('cliente nuevo solo puede llegar a REGISTERED', () => {
    expect(canTransitionTo(undefined, 'REGISTERED')).toBe(true);
    expect(canTransitionTo(undefined, 'DISCOVERED')).toBe(false);
    expect(canTransitionTo(undefined, 'READY')).toBe(false);
  });

  it('happy path completo es legal', () => {
    expect(canTransitionTo('REGISTERED', 'DISCOVERED')).toBe(true);
    expect(canTransitionTo('DISCOVERED', 'DRAFT')).toBe(true);
    expect(canTransitionTo('DRAFT', 'READY')).toBe(true);
    expect(canTransitionTo('READY', 'ACTIVE')).toBe(true);
    expect(canTransitionTo('ACTIVE', 'NEEDS_REFRESH')).toBe(true);
    expect(canTransitionTo('NEEDS_REFRESH', 'DRAFT')).toBe(true);
  });

  it('skip de review (DISCOVERED → READY) es legal', () => {
    // F-3 review es opcional — un consultor con defaults puede saltarlo
    expect(canTransitionTo('DISCOVERED', 'READY')).toBe(true);
  });

  it('rollbacks legales: READY → DRAFT cuando hay refresh', () => {
    expect(canTransitionTo('READY', 'DRAFT')).toBe(true);
    expect(canTransitionTo('READY', 'DISCOVERED')).toBe(true);
  });

  it('rechaza transiciones que saltan estados', () => {
    expect(canTransitionTo('REGISTERED', 'READY')).toBe(false);
    expect(canTransitionTo('REGISTERED', 'ACTIVE')).toBe(false);
  });

  it('rechaza transición desde estado posterior al anterior incoherente', () => {
    expect(canTransitionTo('READY', 'REGISTERED')).toBe(false);
    expect(canTransitionTo('ACTIVE', 'REGISTERED')).toBe(false);
  });

  it('idempotencia (X → X) solo cuando está declarada', () => {
    expect(canTransitionTo('DISCOVERED', 'DISCOVERED')).toBe(true);  // re-discover
    expect(canTransitionTo('DRAFT', 'DRAFT')).toBe(true);             // re-review
    expect(canTransitionTo('ACTIVE', 'ACTIVE')).toBe(true);           // ping
    // REGISTERED → REGISTERED no es legal (no debería re-registrarse así)
    expect(canTransitionTo('REGISTERED', 'REGISTERED')).toBe(false);
  });
});

describe('nextNaturalState', () => {
  it('cliente nuevo → REGISTERED', () => {
    expect(nextNaturalState(undefined)).toBe('REGISTERED');
  });

  it('avanza por happy path', () => {
    expect(nextNaturalState('REGISTERED')).toBe('DISCOVERED');
    expect(nextNaturalState('DISCOVERED')).toBe('DRAFT');
    expect(nextNaturalState('DRAFT')).toBe('READY');
    expect(nextNaturalState('READY')).toBe('ACTIVE');
  });

  it('ACTIVE se queda en ACTIVE (estado terminal del happy path)', () => {
    expect(nextNaturalState('ACTIVE')).toBe('ACTIVE');
  });

  it('NEEDS_REFRESH apunta a DRAFT (re-publish flow)', () => {
    expect(nextNaturalState('NEEDS_REFRESH')).toBe('DRAFT');
  });
});

describe('suggestedCommandFor', () => {
  it('cada estado mapea a un comando concreto (excepto ACTIVE)', () => {
    expect(suggestedCommandFor('REGISTERED', 'iprsa')).toBe('dd-cli client discover iprsa');
    expect(suggestedCommandFor('DISCOVERED', 'iprsa')).toContain('dd-cli client publish iprsa');
    expect(suggestedCommandFor('DRAFT', 'iprsa')).toBe('dd-cli client publish iprsa');
    expect(suggestedCommandFor('READY', 'iprsa')).toContain('dd-cli init --client=iprsa');
    expect(suggestedCommandFor('NEEDS_REFRESH', 'iprsa')).toBe('dd-cli client refresh iprsa');
    expect(suggestedCommandFor('ACTIVE', 'iprsa')).toBeNull();
  });
});
