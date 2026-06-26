/**
 * `dd-cli stats --client=<slug> [--period=30d]` (S5-6).
 *
 * Métricas derivadas del log de transiciones (event-sourcing).
 * Reemplaza dashboard de Jira en una terminal:
 *   throughput      HDUs cerradas en el período
 *   lead time       draft → done (mediana + p90)
 *   cycle time      approved → done (mediana)
 *   open / WIP      por estado actual
 *   mix dev_type    distribución de tipos cerrados
 *   cancellation    % canceladas (signal de churn)
 *
 * Forward-compat con app web (H-6): la app web lee el mismo .jsonl.
 */
import { existsSync } from 'node:fs';
import { getClient, getClientCacheDir } from '../types/registry.js';
import { listHdus, readTransitions, type HduTransition } from '../types/hdu.js';
import { DEV_TYPES, type DevType } from '../types/dev-type.js';
import { isJsonMode, emitJson, jsonSuccess, jsonError, type JsonModeOpts } from '../utils/json-output.js';
import { printErr, printDim, bold } from '../utils/output.js';

export interface StatsOpts extends JsonModeOpts {
  client?: string;
  period?: string;             // '30d', '7d', '60d', 'all'
  by?: 'dev' | 'app' | 'dev_type';
}

interface HduMetrics {
  total_hdus: number;
  by_status: Record<string, number>;
  closed_in_period: number;
  cancelled_in_period: number;
  cancellation_rate: number;       // 0-1
  lead_time_days: { median: number; p90: number; samples: number };
  cycle_time_days: { median: number; p90: number; samples: number };
  mix_dev_type: Record<string, { count: number; pct: number }>;
  by_assignee?: Record<string, number>;
}

function parsePeriodToMs(period: string): number | null {
  if (period === 'all') return null;
  const match = period.match(/^(\d+)d$/);
  if (!match) return null;
  return Number.parseInt(match[1] ?? '0', 10) * 86_400_000;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : sorted[mid] ?? 0;
}

function p90(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.9);
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}

/**
 * Para una HDU dada, calcula:
 *   - draft_at:     primera transición a draft (ts del create)
 *   - approved_at:  primera transición a approved
 *   - done_at:      transición final a done (si existe)
 *   - cancelled_at: transición final a cancelled (si existe)
 *
 * Si una HDU pasó por draft → approved → in-progress → in-review → approved → done,
 * approved_at es el primero; done_at es el último.
 */
function timelineForHdu(transitions: HduTransition[], hduId: string): {
  draft_at: number | null;
  approved_at: number | null;
  done_at: number | null;
  cancelled_at: number | null;
  current_dev_type: string | null;
} {
  const ts = transitions.filter(t => t.hdu === hduId).sort((a, b) => a.ts.localeCompare(b.ts));
  let draft_at: number | null = null;
  let approved_at: number | null = null;
  let done_at: number | null = null;
  let cancelled_at: number | null = null;
  for (const t of ts) {
    const ms = new Date(t.ts).getTime();
    if (t.to === 'draft' && !draft_at) draft_at = ms;
    if (t.to === 'approved' && !approved_at) approved_at = ms;
    if (t.to === 'done') done_at = ms;
    if (t.to === 'cancelled') cancelled_at = ms;
  }
  return { draft_at, approved_at, done_at, cancelled_at, current_dev_type: null };
}

export async function runStats(opts: StatsOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);

  if (!opts.client) {
    const e = { code: 'INVALID_INPUT' as const, message: 'Falta --client=<slug>.' };
    if (jsonMode) emitJson(jsonError({ command: 'stats', ...e }));
    printErr(e.message);
    return 3;
  }

  const entry = getClient(opts.client);
  if (!entry) {
    const e = {
      code: 'CLIENT_NOT_REGISTERED' as const,
      message: `Cliente "${opts.client}" no registrado.`,
    };
    if (jsonMode) emitJson(jsonError({ command: 'stats', ...e }));
    printErr(e.message);
    return 2;
  }
  const cacheDir = getClientCacheDir(opts.client);
  if (!existsSync(cacheDir)) {
    const e = {
      code: 'CONTEXT_CACHE_MISSING' as const,
      message: `Cache local no encontrada para ${opts.client}.`,
    };
    if (jsonMode) emitJson(jsonError({ command: 'stats', ...e }));
    printErr(e.message);
    return 2;
  }

  const periodStr = opts.period ?? '30d';
  const periodMs = parsePeriodToMs(periodStr);
  if (periodStr !== 'all' && periodMs === null) {
    const e = {
      code: 'INVALID_INPUT' as const,
      message: `--period=${periodStr} no es válido. Usá Nd (ej: 30d) o 'all'.`,
    };
    if (jsonMode) emitJson(jsonError({ command: 'stats', ...e }));
    printErr(e.message);
    return 3;
  }
  const cutoffMs = periodMs ? Date.now() - periodMs : 0;

  const allHdus = listHdus(cacheDir);
  const transitions = readTransitions(cacheDir);

  // Por status actual
  const byStatus: Record<string, number> = {};
  for (const h of allHdus) {
    byStatus[h.frontmatter.status] = (byStatus[h.frontmatter.status] ?? 0) + 1;
  }

  // Throughput, cancellation, lead/cycle time
  const leadTimes: number[] = [];
  const cycleTimes: number[] = [];
  let closedInPeriod = 0;
  let cancelledInPeriod = 0;
  const mixCounts: Record<string, number> = {};
  const byAssignee: Record<string, number> = {};

  for (const h of allHdus) {
    const tl = timelineForHdu(transitions, h.frontmatter.id);
    const devType = h.frontmatter.dev_type;

    // Throughput
    if (tl.done_at !== null && tl.done_at >= cutoffMs) {
      closedInPeriod++;
      if (devType) mixCounts[devType] = (mixCounts[devType] ?? 0) + 1;
      if (h.frontmatter.assigned_to) {
        byAssignee[h.frontmatter.assigned_to] = (byAssignee[h.frontmatter.assigned_to] ?? 0) + 1;
      }
      // Lead time = draft → done
      if (tl.draft_at !== null) {
        leadTimes.push((tl.done_at - tl.draft_at) / 86_400_000);
      }
      // Cycle time = approved → done
      if (tl.approved_at !== null) {
        cycleTimes.push((tl.done_at - tl.approved_at) / 86_400_000);
      }
    }

    if (tl.cancelled_at !== null && tl.cancelled_at >= cutoffMs) {
      cancelledInPeriod++;
    }
  }

  const totalClosedOrCancelled = closedInPeriod + cancelledInPeriod;
  const cancellationRate = totalClosedOrCancelled === 0 ? 0 : cancelledInPeriod / totalClosedOrCancelled;

  const mixPct: Record<string, { count: number; pct: number }> = {};
  for (const [dt, count] of Object.entries(mixCounts)) {
    mixPct[dt] = { count, pct: closedInPeriod === 0 ? 0 : count / closedInPeriod };
  }

  const metrics: HduMetrics = {
    total_hdus: allHdus.length,
    by_status: byStatus,
    closed_in_period: closedInPeriod,
    cancelled_in_period: cancelledInPeriod,
    cancellation_rate: cancellationRate,
    lead_time_days: {
      median: median(leadTimes),
      p90: p90(leadTimes),
      samples: leadTimes.length,
    },
    cycle_time_days: {
      median: median(cycleTimes),
      p90: p90(cycleTimes),
      samples: cycleTimes.length,
    },
    mix_dev_type: mixPct,
  };

  if (opts.by === 'dev') metrics.by_assignee = byAssignee;

  if (jsonMode) {
    emitJson(jsonSuccess('stats', {
      client: opts.client,
      period: periodStr,
      ...metrics,
    }));
  }

  console.log('');
  console.log(bold(`Métricas — ${opts.client} (período: ${periodStr})`));
  console.log('');
  console.log(bold('  Throughput'));
  console.log(`    cerradas:           ${closedInPeriod}`);
  console.log(`    canceladas:         ${cancelledInPeriod}`);
  console.log(`    cancellation rate:  ${(cancellationRate * 100).toFixed(1)}%`);
  console.log('');
  console.log(bold('  Estados actuales'));
  for (const [status, count] of Object.entries(byStatus)) {
    console.log(`    ${status.padEnd(13)} ${count}`);
  }
  console.log('');
  if (leadTimes.length > 0) {
    console.log(bold('  Lead time (días)'));
    console.log(`    mediana / p90:      ${metrics.lead_time_days.median.toFixed(1)} / ${metrics.lead_time_days.p90.toFixed(1)}`);
    console.log(`    samples:            ${metrics.lead_time_days.samples}`);
    console.log('');
    console.log(bold('  Cycle time (días)'));
    console.log(`    mediana / p90:      ${metrics.cycle_time_days.median.toFixed(1)} / ${metrics.cycle_time_days.p90.toFixed(1)}`);
    console.log(`    samples:            ${metrics.cycle_time_days.samples}`);
    console.log('');
  }
  if (Object.keys(mixPct).length > 0) {
    console.log(bold('  Mix dev_type (sobre las cerradas)'));
    for (const [dt, { count, pct }] of Object.entries(mixPct)) {
      console.log(`    ${dt.padEnd(22)} ${count}  (${(pct * 100).toFixed(0)}%)`);
    }
    console.log('');
  }
  if (opts.by === 'dev' && Object.keys(byAssignee).length > 0) {
    console.log(bold('  Por dev'));
    for (const [email, count] of Object.entries(byAssignee)) {
      console.log(`    ${email.padEnd(30)} ${count}`);
    }
    console.log('');
  }
  printDim('Para JSON: dd-cli stats --client=' + opts.client + ' --period=' + periodStr + ' --json');
  return 0;
}
