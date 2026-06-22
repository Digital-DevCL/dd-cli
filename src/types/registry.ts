/**
 * Schema de ~/.devflow/registry.yml — registro global de clientes en la máquina.
 *
 * Cada consultor/Tech Lead registra los clientes que gestiona.
 * El CLI usa esto para saber dónde está el contexto de cada cliente
 * sin necesitar un path manual.
 *
 * No se commitea — es local a cada máquina.
 */
import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as yaml from 'js-yaml';

// ── Schema ───────────────────────────────────────────────────────────

export const ClientRegistryEntrySchema = z.object({
  slug: z.string(),
  name: z.string().default(''),
  context_url: z.string().url(),
  local_cache: z.string(),         // path absoluto a ~/.devflow/clients/<slug>/
  last_synced: z.string().nullable().default(null),
  registered_at: z.string(),
});
export type ClientRegistryEntry = z.infer<typeof ClientRegistryEntrySchema>;

export const RegistrySchema = z.object({
  clients: z.record(z.string(), ClientRegistryEntrySchema).default({}),
});
export type Registry = z.infer<typeof RegistrySchema>;

// ── Paths ────────────────────────────────────────────────────────────

export function getDevflowGlobalDir(): string {
  return path.join(os.homedir(), '.devflow');
}

export function getRegistryPath(): string {
  return path.join(getDevflowGlobalDir(), 'registry.yml');
}

export function getClientCacheDir(slug: string): string {
  return path.join(getDevflowGlobalDir(), 'clients', slug);
}

// ── I/O ──────────────────────────────────────────────────────────────

export function loadRegistry(): Registry {
  const registryPath = getRegistryPath();
  if (!existsSync(registryPath)) {
    return { clients: {} };
  }
  const raw = readFileSync(registryPath, 'utf-8');
  const parsed = yaml.load(raw);
  const result = RegistrySchema.safeParse(parsed ?? {});
  if (!result.success) {
    throw new Error(`registry.yml inválido:\n${result.error.message}`);
  }
  return result.data;
}

export function saveRegistry(registry: Registry): void {
  const globalDir = getDevflowGlobalDir();
  if (!existsSync(globalDir)) mkdirSync(globalDir, { recursive: true });

  const validated = RegistrySchema.parse(registry);
  const yamlStr = yaml.dump(validated, { indent: 2, lineWidth: 120 });
  writeFileSync(getRegistryPath(), yamlStr, 'utf-8');
}

export function getClient(slug: string): ClientRegistryEntry | null {
  const registry = loadRegistry();
  return registry.clients[slug] ?? null;
}

export function registerClient(entry: Omit<ClientRegistryEntry, 'registered_at'>): void {
  const registry = loadRegistry();
  registry.clients[entry.slug] = {
    ...entry,
    registered_at: new Date().toISOString(),
  };
  saveRegistry(registry);
}

export function updateLastSynced(slug: string): void {
  const registry = loadRegistry();
  const entry = registry.clients[slug];
  if (entry) {
    entry.last_synced = new Date().toISOString();
    saveRegistry(registry);
  }
}

export function listClients(): ClientRegistryEntry[] {
  return Object.values(loadRegistry().clients);
}
