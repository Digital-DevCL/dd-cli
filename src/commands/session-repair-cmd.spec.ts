import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { runSessionRepairCmd } from './session-repair-cmd.js';
import { createInitialSession } from '../types/session.js';
import { getSessionPath } from '../utils/paths.js';

function runInDir<T>(dir: string, fn: () => T): T {
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(originalCwd);
  }
}

describe('session-repair-cmd', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'df-repair-'));
    mkdirSync(path.join(dir, '.devflow'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('no hace nada si session.json ya es válido', async () => {
    writeFileSync(getSessionPath(dir), JSON.stringify(createInitialSession('0.9.0')), 'utf-8');
    const exitCode = await runInDir(dir, () => runSessionRepairCmd({ yes: true }));
    expect(exitCode).toBe(0);
  });

  it('repara dev_type_source inválido post-lock a "reclassify"', async () => {
    const broken = {
      ...createInitialSession('0.9.0'),
      dev_type: 'brownfield-feature',
      dev_type_locked: true,
      dev_type_source: 'tech-lead-reclassify', // valor inválido escrito a mano
    };
    writeFileSync(getSessionPath(dir), JSON.stringify(broken), 'utf-8');

    const exitCode = await runInDir(dir, () => runSessionRepairCmd({ yes: true }));
    expect(exitCode).toBe(0);

    const repaired = JSON.parse(readFileSync(getSessionPath(dir), 'utf-8'));
    expect(repaired.dev_type_source).toBe('reclassify');
    expect(existsSync(`${getSessionPath(dir)}.bak`)).toBe(true);
  });

  it('repara dev_type_source inválido sin lock a "business-brief"', async () => {
    const broken = {
      ...createInitialSession('0.9.0'),
      dev_type_locked: false,
      dev_type_source: 'algo-inventado',
    };
    writeFileSync(getSessionPath(dir), JSON.stringify(broken), 'utf-8');

    const exitCode = await runInDir(dir, () => runSessionRepairCmd({ yes: true }));
    expect(exitCode).toBe(0);

    const repaired = JSON.parse(readFileSync(getSessionPath(dir), 'utf-8'));
    expect(repaired.dev_type_source).toBe('business-brief');
  });

  it('no toca el archivo si el error no tiene reparación automática conocida', async () => {
    const broken = { ...createInitialSession('0.9.0'), schema_version: 1 };
    writeFileSync(getSessionPath(dir), JSON.stringify(broken), 'utf-8');

    const exitCode = await runInDir(dir, () => runSessionRepairCmd({ yes: true }));
    expect(exitCode).toBe(1);

    const untouched = JSON.parse(readFileSync(getSessionPath(dir), 'utf-8'));
    expect(untouched.schema_version).toBe(1);
    expect(existsSync(`${getSessionPath(dir)}.bak`)).toBe(false);
  });

  it('devuelve 2 si session.json no es JSON válido', async () => {
    writeFileSync(getSessionPath(dir), '{ esto no es json', 'utf-8');
    const exitCode = await runInDir(dir, () => runSessionRepairCmd({ yes: true }));
    expect(exitCode).toBe(2);
  });

  it('devuelve 2 si no existe session.json', async () => {
    const emptyDir = mkdtempSync(path.join(tmpdir(), 'df-repair-empty-'));
    mkdirSync(path.join(emptyDir, '.devflow'));
    try {
      const exitCode = await runInDir(emptyDir, () => runSessionRepairCmd({ yes: true }));
      expect(exitCode).toBe(2);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
