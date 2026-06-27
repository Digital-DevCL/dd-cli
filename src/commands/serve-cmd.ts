/**
 * `dd-cli serve [--port=<N>]` — servidor HTTP local que expone el motor de estado.
 *
 * Pensado para que la app web (Fase 1) pueda consumir el estado del dev sin
 * necesidad de lanzar un proceso nuevo por cada request.
 *
 * Endpoints:
 *   GET /state            → getFlowState() serializado como JSON
 *   GET /state?user=<e>  → getFlowState({ user }) filtrado por usuario
 *   GET /health           → { ok: true, version: "0.8.0" }
 *   POST /close-session   → cierra la sesión activa (llama runEndSession())
 *
 * Seguridad: solo escucha en 127.0.0.1 (localhost). No acepta conexiones externas.
 * Autenticación: token de sesión aleatorio en header X-DevFlow-Token (generado al inicio).
 */
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { getFlowState } from '../flow-state/engine.js';
import { runEndSession } from './end-session.js';
import { CLI_VERSION } from '../index.js';
import { printOk, printDim, printErr, bold } from '../utils/output.js';

const DEFAULT_PORT = 51234;  // fuera del rango de puertos conocidos

export interface ServeOpts {
  port?: number;
  token?: string;  // si no se pasa, se genera uno aleatorio
}

export async function runServe(opts: ServeOpts = {}): Promise<number> {
  const port = opts.port ?? DEFAULT_PORT;
  const token = opts.token ?? crypto.randomBytes(16).toString('hex');

  const server = http.createServer((req, res) => {
    // CORS local
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
    res.setHeader('Access-Control-Allow-Headers', 'X-DevFlow-Token, Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
      res.writeHead(204); res.end(); return;
    }

    // Auth
    if (req.headers['x-devflow-token'] !== token) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, version: CLI_VERSION }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/state') {
      try {
        const user = url.searchParams.get('user') ?? undefined;
        const state = getFlowState({ user });
        res.writeHead(200);
        res.end(JSON.stringify(state));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/close-session') {
      runEndSession().then(code => {
        res.writeHead(code === 0 ? 200 : 400);
        res.end(JSON.stringify({ ok: code === 0 }));
      }).catch(e => {
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(e) }));
      });
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(bold(`\nDevFlow IA — motor de estado HTTP\n`));
    printOk(`Escuchando en http://127.0.0.1:${port}`);
    printDim(`  GET  /health`);
    printDim(`  GET  /state[?user=<email>]`);
    printDim(`  POST /close-session`);
    console.log('');
    printDim(`  Token: ${token}`);
    printDim('  (header X-DevFlow-Token requerido en todos los requests)');
    console.log('');
    printDim('  Ctrl-C para detener.');
  });

  server.on('error', (e) => {
    printErr(`Error al iniciar el servidor: ${e.message}`);
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      printErr(`Puerto ${port} en uso. Usá --port=<otro>`);
    }
    process.exit(1);
  });

  // Mantener el proceso vivo
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      server.close(() => resolve());
    });
    process.on('SIGTERM', () => {
      server.close(() => resolve());
    });
  });

  return 0;
}
