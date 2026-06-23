/**
 * `dd-cli init` — setup completo del proyecto + entorno Claude Code.
 *
 * 1. Crea .devflow/session.json (estado inicial)
 * 2. Instala 19 skills en ~/.claude/skills/devflow-ia/
 * 3. Escribe .claude/settings.json con hooks de heartbeat
 *
 * Idempotente: skip si existe + sin --force.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getProjectRoot,
  getDevflowDir,
  getSessionPath,
  getClaudeHome,
  getClaudeSkillsDir,
  getProjectClaudeDir,
  getProjectClaudeSettingsPath,
  isClaudeCodeInstalled,
} from '../utils/paths.js';
import { saveSession } from '../utils/session-io.js';
import { createInitialSession } from '../types/session.js';
import { CLI_VERSION } from '../index.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold } from '../utils/output.js';

export interface InitOptions {
  force?: boolean;
  skipSkills?: boolean;
  skipHooks?: boolean;
}

const META_FILES = new Set([
  'AUDIT.md',
  'CUSTOMIZATION.md',
  'ENFORCEMENT.md',
  'DISENO_INIT_CONTEXT.md',
]);

/**
 * Resuelve dónde están las skills bundleadas.
 * Estrategia:
 *   1. <package>/skills/  (después de bundle de release)
 *   2. <monorepo>/skills/  (modo dev — npm link desde Digital-Dev)
 */
function resolveSkillsSourceDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));

  // dist/bin/dd-cli.js → ../../skills (package en producción)
  const bundled = path.resolve(here, '..', '..', 'skills');
  if (existsSync(bundled)) return bundled;

  // dist/bin/dd-cli.js → ../../../skills (modo dev, dentro del monorepo Digital-Dev)
  const monorepo = path.resolve(here, '..', '..', '..', 'skills');
  if (existsSync(monorepo)) return monorepo;

  return null;
}

/**
 * Copia recursivamente, saltando META_FILES en el root.
 */
function copySkillsTree(srcDir: string, destDir: string): string[] {
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  const copied: string[] = [];

  const entries = readdirSync(srcDir);
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry);
    const destPath = path.join(destDir, entry);
    const st = statSync(srcPath);

    if (st.isDirectory()) {
      // sub-folders como opsx/ se copian completas
      copied.push(...copySkillsTree(srcPath, destPath));
    } else if (st.isFile() && entry.endsWith('.md') && !META_FILES.has(entry)) {
      copyFileSync(srcPath, destPath);
      copied.push(path.relative(destDir, destPath));
    }
  }

  return copied;
}

/**
 * Escribe ~/.claude/skills/devflow-ia/.version
 */
function writeSkillsVersion(): void {
  const skillsDir = getClaudeSkillsDir();
  writeFileSync(path.join(skillsDir, '.version'), `${CLI_VERSION}\n`, 'utf-8');
}

/**
 * Construye el objeto settings con hooks para Claude Code (mergea con existente).
 *
 * La statusLine NO se setea acá — vive en ~/.claude/settings.json (global),
 * configurada por `dd-cli install`. Esto evita ruido en proyectos no-DevFlow
 * y permite que la barra sea inteligente según contexto.
 */
function buildSettingsJson(existing: Record<string, unknown> = {}): Record<string, unknown> {
  const settings = { ...existing };

  const hooks = (settings.hooks as Record<string, unknown>) ?? {};

  const heartbeatHook = {
    type: 'command',
    command: 'dd-cli heartbeat --silent 2>/dev/null || true',
  };
  const stopHook = {
    type: 'command',
    command: 'dd-cli heartbeat --silent --on-stop 2>/dev/null || true',
  };

  const postToolUse = (hooks.PostToolUse as Array<Record<string, unknown>>) ?? [];
  const alreadyHas = postToolUse.some((entry) => {
    const list = (entry.hooks as Array<Record<string, unknown>>) ?? [];
    return list.some((h) => typeof h.command === 'string' && h.command.includes('dd-cli heartbeat'));
  });
  if (!alreadyHas) {
    postToolUse.push({
      matcher: 'Write|Edit|Bash',
      hooks: [heartbeatHook],
    });
  }
  hooks.PostToolUse = postToolUse;

  const stop = (hooks.Stop as Array<Record<string, unknown>>) ?? [];
  const stopAlready = stop.some((entry) => {
    const list = (entry.hooks as Array<Record<string, unknown>>) ?? [];
    return list.some((h) => typeof h.command === 'string' && h.command.includes('--on-stop'));
  });
  if (!stopAlready) {
    stop.push({ hooks: [stopHook] });
  }
  hooks.Stop = stop;

  settings.hooks = hooks;

  return settings;
}

export async function runInit(opts: InitOptions = {}): Promise<number> {
  const projectRoot = getProjectRoot();
  // 0. Copiar CLAUDE.md template si no existe
  const claudeMdPath = path.join(projectRoot, 'CLAUDE.md');
  if (!existsSync(claudeMdPath) || opts.force) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const templatePath = path.resolve(here, '..', '..', 'templates', 'CLAUDE.md.template');
    if (existsSync(templatePath)) {
      const projectName = path.basename(projectRoot);
      let content = readFileSync(templatePath, 'utf-8');
      content = content.replaceAll('{{PROJECT_NAME}}', projectName);
      content = content.replaceAll('{{STACK}}', 'Completar en CLAUDE.md');
      content = content.replaceAll('{{INFRA}}', 'Completar en CLAUDE.md');
      content = content.replaceAll('{{BACKEND_FRAMEWORK}}', 'Completar en CLAUDE.md');
      content = content.replaceAll('{{FRONTEND_FRAMEWORK}}', 'Completar en CLAUDE.md');
      content = content.replaceAll('{{DB}}', 'Completar en CLAUDE.md');
      writeFileSync(claudeMdPath, content, 'utf-8');
    }
  }

  console.log(bold(`\nDevFlow IA — init`));
  printDim(`  Proyecto: ${projectRoot}\n`);

  // 1. Verificar Claude Code instalado
  if (!isClaudeCodeInstalled()) {
    printErr(`Claude Code no detectado en ${getClaudeHome()}`);
    printInfo(`Instalá Claude Code primero: https://claude.com/claude-code`);
    return 2;
  }
  printOk(`Detectado Claude Code en ${getClaudeHome()}`);

  // 2. Crear .devflow/session.json
  const devflowDir = getDevflowDir(projectRoot);
  const sessionPath = getSessionPath(projectRoot);
  const sessionExists = existsSync(sessionPath);

  if (sessionExists && !opts.force) {
    printWarn(`.devflow/session.json ya existe — usa --force para sobrescribir`);
  } else {
    if (sessionExists && opts.force) {
      rmSync(sessionPath);
    }
    const initial = createInitialSession(CLI_VERSION);
    saveSession(projectRoot, initial);
    printOk(`Creado .devflow/ con session.json inicial (schema_version: ${initial.schema_version})`);
  }

  // 3. Instalar skills
  if (!opts.skipSkills) {
    const srcDir = resolveSkillsSourceDir();
    if (!srcDir) {
      printWarn(`No se encontraron skills bundleadas; saltando instalación de skills`);
      printDim(`  Esperado en <package>/skills/ o <monorepo>/skills/`);
    } else {
      const destDir = getClaudeSkillsDir();
      const copied = copySkillsTree(srcDir, destDir);
      writeSkillsVersion();
      printOk(`Skills instaladas en ${destDir}`);
      printDim(`  ${copied.length} skills (v${CLI_VERSION})`);
    }
  } else {
    printDim(`  (skip skills)`);
  }

  // 4. Configurar hooks en .claude/settings.json
  if (!opts.skipHooks) {
    const projectClaudeDir = getProjectClaudeDir(projectRoot);
    if (!existsSync(projectClaudeDir)) {
      mkdirSync(projectClaudeDir, { recursive: true });
    }
    const settingsPath = getProjectClaudeSettingsPath(projectRoot);

    let existing: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      try {
        existing = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      } catch {
        // Si el archivo existe pero está corrupto y no force → abortar
        if (!opts.force) {
          printErr(`.claude/settings.json existe pero no es JSON válido — usa --force para sobrescribir`);
          return 2;
        }
      }
    }
    const merged = buildSettingsJson(existing);
    writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
    printOk(`Hooks configurados en .claude/settings.json`);
  } else {
    printDim(`  (skip hooks)`);
  }

  // Confirmar CLAUDE.md
  if (existsSync(path.join(projectRoot, 'CLAUDE.md'))) {
    printOk(`CLAUDE.md generado con auto-onboarding`);
    printDim(`  Edita las variables {{...}} con los datos del proyecto`);
  }

  console.log(`\n${bold('Listo.')} Abre Claude Code en este directorio.`);
  printDim(`\nPróximo paso: dd-cli start-session <feature-id>`);
  printDim(`Tip: para ver la statusline en Claude Code → ejecuta una sola vez: dd-cli install`);
  return 0;
}
