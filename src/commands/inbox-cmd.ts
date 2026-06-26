/**
 * `dd-cli inbox [--read] [--add]` (S6-8) — eventos asincrónicos del dev.
 *
 * El inbox vive en ~/.devflow/inbox.jsonl (append-only, local, no commiteable).
 * Append: CLI internamente cuando hay eventos (HDU asignada, MR mergeado),
 * git hooks del context repo, o manualmente con `dd-cli inbox add`.
 *
 * Sub-comandos:
 *   inbox            lista eventos no-leídos
 *   inbox --all      todos (leídos y no-leídos)
 *   inbox --read     marca todos los listados como leídos
 *   inbox add        agrega un evento manualmente (testing / scripts)
 *
 * TTL (D-26): auto-purge de items `read: true` a los 30 días.
 * Configurable por env DEVFLOW_INBOX_RETENTION_DAYS.
 *
 * Forward-compat con app web (D-27): cuando exista, dd-cli inbox sync
 * mergea con el remoto.
 */
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { getDevflowGlobalDir } from '../types/registry.js';
import { isJsonMode, emitJson, jsonSuccess, jsonError, type JsonModeOpts } from '../utils/json-output.js';
import { printOk, printDim, printErr, printInfo, bold, dim, ok } from '../utils/output.js';

const InboxEventSchema = z.object({
  ts: z.string(),
  client: z.string().optional(),
  kind: z.string(),                            // hdu_assigned | mr_merged | context_updated | etc.
  data: z.record(z.string(), z.unknown()).default({}),
  read: z.boolean().default(false),
  id: z.string().optional(),                    // generado al append si no viene
});
export type InboxEvent = z.infer<typeof InboxEventSchema>;

export interface InboxOpts extends JsonModeOpts {
  read?: boolean;
  all?: boolean;
}

export interface InboxAddOpts extends JsonModeOpts {
  client?: string;
  kind?: string;
  data?: string;       // JSON string
}

function getInboxPath(): string {
  return path.join(getDevflowGlobalDir(), 'inbox.jsonl');
}

function readInbox(): InboxEvent[] {
  const p = getInboxPath();
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf-8')
    .split('\n')
    .filter(l => l.trim().length > 0)
    .map(l => {
      try {
        return InboxEventSchema.parse(JSON.parse(l));
      } catch {
        return null;
      }
    })
    .filter((e): e is InboxEvent => e !== null);
}

function writeInbox(events: InboxEvent[]): void {
  const p = getInboxPath();
  const dir = path.dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const content = events.map(e => JSON.stringify(InboxEventSchema.parse(e))).join('\n') + '\n';
  writeFileSync(p, content, 'utf-8');
}

/**
 * Helper exportado: el CLI internamente y los git hooks pueden invocarlo.
 */
export function appendInboxEvent(event: Omit<InboxEvent, 'ts' | 'read'> & { ts?: string; read?: boolean }): void {
  const p = getInboxPath();
  const dir = path.dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const full = InboxEventSchema.parse({
    ts: event.ts ?? new Date().toISOString(),
    read: event.read ?? false,
    ...event,
  });
  appendFileSync(p, JSON.stringify(full) + '\n', 'utf-8');
}

function purgeOld(events: InboxEvent[]): InboxEvent[] {
  const retentionDays = Number(process.env.DEVFLOW_INBOX_RETENTION_DAYS ?? 30);
  const cutoff = Date.now() - retentionDays * 86_400_000;
  return events.filter(e => !e.read || new Date(e.ts).getTime() >= cutoff);
}

function ageStr(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `hace ${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr}h`;
  return `hace ${Math.floor(hr / 24)}d`;
}

export async function runInbox(opts: InboxOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);
  let events = readInbox();

  // Auto-purge cada vez que se lee (lazy GC)
  const before = events.length;
  events = purgeOld(events);
  if (events.length < before) {
    writeInbox(events);
  }

  const filtered = opts.all ? events : events.filter(e => !e.read);

  if (jsonMode) {
    emitJson(jsonSuccess('inbox', {
      total: events.length,
      shown: filtered.length,
      unread: events.filter(e => !e.read).length,
      events: filtered,
    }));
  }

  console.log('');
  console.log(bold(`  📬 INBOX  (${filtered.length} ${opts.all ? 'totales' : 'sin leer'})`));
  console.log('');

  if (filtered.length === 0) {
    printDim('  No hay eventos.');
    return 0;
  }

  for (let i = 0; i < filtered.length; i++) {
    const e = filtered[i]!;
    const tag = e.read ? dim('· ') : ok('● ');
    const kindStr = e.kind.padEnd(20);
    const clientStr = (e.client ?? '-').padEnd(12);
    console.log(`  ${tag}${ageStr(e.ts).padEnd(10)} ${dim(clientStr)} ${kindStr} ${formatEventData(e)}`);
  }

  if (opts.read) {
    // Marcar todos los listados como leídos
    const filteredIds = new Set(filtered.map((e, i) => `${e.ts}#${i}`));
    const updated = events.map((e, i) => {
      const key = `${e.ts}#${i}`;
      if (filteredIds.has(key)) {
        return { ...e, read: true };
      }
      return e;
    });
    writeInbox(updated);
    console.log('');
    printOk(`  ${filtered.length} marcados como leídos`);
  } else if (filtered.length > 0 && !opts.all) {
    console.log('');
    printDim('  Marcar como leídos: dd-cli inbox --read');
  }

  return 0;
}

function formatEventData(e: InboxEvent): string {
  switch (e.kind) {
    case 'hdu_assigned': {
      const hdu = e.data['hdu'] ?? '?';
      const by = e.data['by'] ?? '?';
      return `${hdu} (por ${by})`;
    }
    case 'mr_merged': {
      const hdu = e.data['hdu'] ?? '?';
      const mr = e.data['mr'] ?? '?';
      return `${hdu} (MR ${mr})`;
    }
    case 'context_updated': {
      const news = (e.data['new_apps'] ?? []) as string[];
      return news.length > 0 ? `+${news.length} apps nuevas` : '';
    }
    default:
      try { return JSON.stringify(e.data).slice(0, 60); }
      catch { return ''; }
  }
}

export async function runInboxAdd(opts: InboxAddOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);
  if (!opts.kind) {
    const e = { code: 'INVALID_INPUT' as const, message: 'Falta --kind. Uso: dd-cli inbox add --kind=<tipo> --client=<slug>' };
    if (jsonMode) emitJson(jsonError({ command: 'inbox add', ...e }));
    printErr(e.message);
    return 3;
  }

  let data: Record<string, unknown> = {};
  if (opts.data) {
    try { data = JSON.parse(opts.data); }
    catch {
      const e = { code: 'INVALID_INPUT' as const, message: '--data debe ser JSON válido.' };
      if (jsonMode) emitJson(jsonError({ command: 'inbox add', ...e }));
      printErr(e.message);
      return 3;
    }
  }

  appendInboxEvent({ kind: opts.kind, client: opts.client, data });

  if (jsonMode) {
    emitJson(jsonSuccess('inbox add', { kind: opts.kind, client: opts.client, data }));
  }
  printOk(`Evento agregado al inbox.`);
  printInfo('Para ver: dd-cli inbox');
  return 0;
}
