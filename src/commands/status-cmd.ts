/**
 * `dd-cli status` — wrapper que decide entre vista narrativa y raw.
 *
 * Default: vista narrativa junior-friendly (status-narrative.ts)
 * --raw:   vista técnica original (statusOutput de commands/status.ts)
 * --json:  JSON estructurado
 * --quiet: solo exit code
 */
import { getProjectRoot } from '../utils/paths.js';
import { loadSession, SessionIOError } from '../utils/session-io.js';
import { statusOutput } from './status.js';
import { runStatusNarrative } from './status-narrative.js';
import { printErr } from '../utils/output.js';

export interface StatusCmdOptions {
  json?: boolean;
  quiet?: boolean;
  raw?: boolean;
}

export function runStatus(opts: StatusCmdOptions = {}): number {
  // Modo quiet y json van directo a la lógica técnica
  if (opts.quiet || opts.json || opts.raw) {
    const projectRoot = getProjectRoot();
    let session;
    try {
      session = loadSession(projectRoot);
    } catch (e) {
      if (e instanceof SessionIOError) {
        if (!opts.quiet) printErr(e.message);
        return 2;
      }
      throw e;
    }

    if (!session) {
      if (opts.quiet) return 1;
      if (opts.json) { console.log(JSON.stringify({ status: 'no_session' })); return 1; }
      console.log('Sin sesión activa.\nPara empezar: dd-cli start-session <feature-id>');
      return 1;
    }

    if (opts.json) {
      const result = statusOutput({ projectRoot, session });
      console.log(JSON.stringify({ session, status_lines: result.lines, exit_code: result.exitCode }));
      return result.exitCode;
    }
    if (opts.quiet) {
      return statusOutput({ projectRoot, session }).exitCode;
    }
    // --raw: modo técnico original
    const result = statusOutput({ projectRoot, session });
    for (const line of result.lines) console.log(line);
    return result.exitCode;
  }

  // Default: vista narrativa
  return runStatusNarrative();
}
