import { describe, it, expect } from 'vitest';
import { stagesForDevType, getStageContext, currentStageIndex, stageStatus } from './flow-stages.js';
import { createInitialSession } from '../types/session.js';
import type { DevType } from '../types/dev-type.js';
import type { FlowState } from '../types/session.js';

describe('stagesForDevType', () => {
  it('greenfield tiene 8 pasos', () => {
    expect(stagesForDevType('greenfield').length).toBe(8);
  });

  it('brownfield-feature tiene 8 pasos', () => {
    expect(stagesForDevType('brownfield-feature').length).toBe(8);
  });

  it('brownfield-refactor tiene 9 pasos', () => {
    expect(stagesForDevType('brownfield-refactor').length).toBe(9);
  });

  it('modernizacion tiene 9 pasos', () => {
    expect(stagesForDevType('modernizacion').length).toBe(9);
  });

  it('integracion-externa tiene 8 pasos', () => {
    expect(stagesForDevType('integracion-externa').length).toBe(8);
  });

  it('todos los pasos tienen índice 1-based consecutivo', () => {
    const types: DevType[] = ['greenfield', 'brownfield-feature', 'brownfield-refactor', 'modernizacion', 'integracion-externa'];
    for (const t of types) {
      const stages = stagesForDevType(t);
      stages.forEach((s, i) => {
        expect(s.index).toBe(i + 1);
      });
    }
  });

  it('primer paso siempre es start-session (terminal)', () => {
    const types: DevType[] = ['greenfield', 'brownfield-feature', 'brownfield-refactor', 'modernizacion', 'integracion-externa'];
    for (const t of types) {
      const s = stagesForDevType(t)[0]!;
      expect(s.id).toBe('start-session');
      expect(s.invokeIn).toBe('terminal');
    }
  });

  it('todos los pasos tienen rationale no vacío', () => {
    const types: DevType[] = ['greenfield', 'brownfield-feature', 'brownfield-refactor', 'modernizacion', 'integracion-externa'];
    for (const t of types) {
      for (const s of stagesForDevType(t)) {
        expect(s.rationale.length).toBeGreaterThan(10);
      }
    }
  });
});

describe('currentStageIndex', () => {
  const cases: Array<[DevType, FlowState, number | null]> = [
    ['greenfield', 'not_started', null],
    ['greenfield', 'started', 2],
    ['greenfield', 'spec_ready', 3],
    ['greenfield', 'change_active', 6],
    ['greenfield', 'ended', 8],
    ['brownfield-feature', 'started', 2],
    ['brownfield-feature', 'repo_mapped', 3],
    ['brownfield-feature', 'spec_ready', 4],
    ['brownfield-feature', 'change_active', 6],
    ['brownfield-refactor', 'started', 2],
    ['brownfield-refactor', 'repo_mapped', 3],
    ['brownfield-refactor', 'baseline_ready', 5],
    ['brownfield-refactor', 'spec_ready', 6],
    ['modernizacion', 'started', 2],
    ['modernizacion', 'repo_mapped', 3],
    ['integracion-externa', 'started', 2],
    ['integracion-externa', 'repo_mapped', 3],
    ['integracion-externa', 'spec_ready', 4],
  ];

  for (const [devType, flowState, expected] of cases) {
    it(`(${devType}, ${flowState}) → índice ${expected}`, () => {
      expect(currentStageIndex(devType, flowState)).toBe(expected);
    });
  }
});

describe('getStageContext', () => {
  it('devuelve null si session.dev_type es null', () => {
    const s = createInitialSession('0.2.0');
    expect(getStageContext(s, 'started')).toBeNull();
  });

  it('devuelve ctx completo con greenfield + started', () => {
    const s = { ...createInitialSession('0.2.0'), started_at: new Date().toISOString(), dev_type: 'greenfield' as DevType };
    const ctx = getStageContext(s, 'started');
    expect(ctx).not.toBeNull();
    expect(ctx!.total).toBe(8);
    expect(ctx!.currentIndex).toBe(2);
    expect(ctx!.currentStage?.id).toBe('/new-spec');
    expect(ctx!.nextStage?.id).toBe('/new-app');
  });

  it('currentStage es null cuando not_started', () => {
    const s = { ...createInitialSession('0.2.0'), dev_type: 'greenfield' as DevType };
    const ctx = getStageContext(s, 'not_started');
    expect(ctx!.currentStage).toBeNull();
  });
});

describe('stageStatus', () => {
  it('índice antes del actual → done', () => {
    expect(stageStatus(1, 3, 'started')).toBe('done');
  });

  it('índice igual al actual → current', () => {
    expect(stageStatus(3, 3, 'started')).toBe('current');
  });

  it('índice después del actual → pending', () => {
    expect(stageStatus(5, 3, 'started')).toBe('pending');
  });

  it('ended → todos done', () => {
    expect(stageStatus(1, null, 'ended')).toBe('done');
    expect(stageStatus(8, null, 'ended')).toBe('done');
  });
});
