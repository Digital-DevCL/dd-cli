/**
 * Schema de ~/.devflow/credentials.yml — credenciales git por cliente.
 *
 * Archivo con permisos 600 (solo lectura del usuario).
 * NUNCA se commitea. Separado de registry.yml para seguridad.
 */
import { z } from 'zod';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { getDevflowGlobalDir } from './registry.js';

export const GitHostSchema = z.enum(['gitlab', 'github', 'bitbucket', 'azure']);
export type GitHost = z.infer<typeof GitHostSchema>;

export const ClientCredentialsSchema = z.object({
  git_token: z.string().min(1),
  git_host: GitHostSchema.default('gitlab'),
  git_base_url: z.string().url().default('https://gitlab.com'),
  git_group: z.string().min(1),  // grupo/org a escanear
});
export type ClientCredentials = z.infer<typeof ClientCredentialsSchema>;

export const CredentialsFileSchema = z.object({
  clients: z.record(z.string(), ClientCredentialsSchema).default({}),
});
export type CredentialsFile = z.infer<typeof CredentialsFileSchema>;

// ── Paths ─────────────────────────────────────────────────────

export function getCredentialsPath(): string {
  return path.join(getDevflowGlobalDir(), 'credentials.yml');
}

// ── I/O ──────────────────────────────────────────────────────

export function loadCredentials(): CredentialsFile {
  const p = getCredentialsPath();
  if (!existsSync(p)) return { clients: {} };
  const raw = readFileSync(p, 'utf-8');
  const parsed = yaml.load(raw);
  const result = CredentialsFileSchema.safeParse(parsed ?? {});
  if (!result.success) throw new Error(`credentials.yml inválido:\n${result.error.message}`);
  return result.data;
}

export function saveCredentials(creds: CredentialsFile): void {
  const p = getCredentialsPath();
  const validated = CredentialsFileSchema.parse(creds);
  const yamlStr = yaml.dump(validated, { indent: 2 });
  writeFileSync(p, yamlStr, { encoding: 'utf-8', mode: 0o600 });
  // Asegurar permisos restrictivos
  try { chmodSync(p, 0o600); } catch { /* ignorar en sistemas sin soporte */ }
}

export function getClientCredentials(slug: string): ClientCredentials | null {
  return loadCredentials().clients[slug] ?? null;
}

export function setClientCredentials(slug: string, creds: ClientCredentials): void {
  const all = loadCredentials();
  all.clients[slug] = ClientCredentialsSchema.parse(creds);
  saveCredentials(all);
}

export function hasClientCredentials(slug: string): boolean {
  return !!getClientCredentials(slug);
}
