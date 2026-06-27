# Fixes y mejoras pendientes — dd-cli

> Listado acumulativo encontrado en pruebas post-release v0.6.0 (2026-06-26).

---

## v0.6.1 — Patch urgente

Criterio: bugs que bloquean el uso básico del CLI recién instalado.

### Bugs

| # | Comando | Descripción | Fix |
|---|---------|-------------|-----|
| B-02 | `dd-cli install` | Skills NO se copian a `~/.claude/commands/devflow-ia/` al hacer el setup. `dd-cli install` solo configura la statusline. El dev queda sin `/devflow-ia:*` disponibles hasta que corra `dd-cli skills install` manualmente. | `dd-cli install` debe ejecutar `skills install` como parte del mismo comando. |
| B-03 | `start-session` | Correr con `!` en Claude Code → `stdout.isTTY = false` → modo no-interactivo → exige `--feature-name`, `--type`, `--rationale`. Línea 78 de `start-session-cmd.ts`. | Cambiar chequeo a `process.stdin.isTTY`. Complementario: el skill `/devflow-ia:start-work` debe leer el HDU y construir el comando con flags completos. |
| B-01 | `client publish` | No stagea directorios nuevos (ej: `hdus/`). La primera vez que aparece ese directorio hay que hacer `git add` manual. | Cambiar el `git add` del comando a `git add --all` o detectar untracked dirs antes del commit. |
| B-04 | `client publish` | No ejecuta el commit/push incluso cuando los archivos están correctamente preparados. El workaround es `git commit + push` manual en `~/.devflow/clients/<slug>/`, pero el estado del cliente no avanza a `READY`. | Investigar por qué el paso git falla silenciosamente. Revisar si el proceso git hereda el path correcto del repo clonado. |

### Providers — soporte cuentas personales

| # | Archivo | Descripción | Fix |
|---|---------|-------------|-----|
| P-04 | `providers/factory.ts` + `client new` | **Dos bugs encadenados.** (1) `client new` guarda `https://api.github.com` en `credentials.yml`. (2) `client discover` lo pasa a `defaultBaseUrlFor()` que matchea `/github/i` y transforma a `https://api.github.com/api/v3` → `GET /api/v3/user` → 404. Workaround: editar `credentials.yml` manualmente, cambiar `git_base_url` a `https://github.com`. **Fix**: agregar condición previa `if (raw === 'https://api.github.com') return raw;`. Complementario: `client new` debe normalizar y guardar siempre el base URL (`https://github.com`), no el API URL. |
| P-05 | `discovery/pattern-detector.ts:259` | `client discover` asigna `slug: meta.slug` directo desde el nombre del repo en la API (ej: `DO_Apps`, `voxkpi_AZ`, `Voxkpi_cliente1`). El schema exige kebab-case → `refresh --apply` falla con `{ "message": "Debe ser kebab-case", "path": ["slug"] }` sin indicar qué repo falló. Editar `discovery.json` manualmente no sirve: `refresh` re-corre discovery desde la API y pisa los cambios. Workaround: escribir `catalog.yml` a mano. **Fix**: (a) normalizar en línea 259: `slug: toKebabCase(meta.slug)`, conservar nombre original en `display_name`; (b) incluir el valor del slug inválido en el mensaje de error del validador. |
| P-01 | `providers/github.ts:155` | `listGroupRepos` hardcodeado a `orgs/{name}/repos`. Falla con 404 en cuentas personales. `createRepo` ya tiene el fallback. | Try/catch; reintentar con `users/{name}/repos`. Response shape idéntico — sin cambio en mapper. |
| P-02 | `providers/gitlab.ts:162` | `listGroupRepos` hardcodeado a `groups/{name}/projects`. Falla en namespaces personales. | Try/catch; fallback a `users/{name}/projects`. Response shape idéntico. |
| P-03 | `providers/gitlab.ts:232` | `createRepo` resuelve namespace con `groups/{name}` — falla si el namespace es personal. | Reemplazar por `GET /namespaces?search={name}`; tomar primer resultado con `kind === 'group'` o `kind === 'user'`. |

---

## v0.7.0 — Mejoras

Criterio: UX, enforcement de flujo, ritual diario. No bloquean uso pero degradan la experiencia.

### Gaps de contexto arquitectural

| # | Área | Descripción | Fix |
|---|------|-------------|-----|
| G-01 | Context repo sin CLAUDE.md | El context repo (`<cliente>-devflow-context`) no tiene `CLAUDE.md`. Cuando el Tech Lead abre Claude Code ahí, Claude no tiene contexto del cliente (stack, apps, equipo). Las skills `/capture-req`, `/enrich-us`, `/design-hdu` operan "a ciegas". | Crear `CLAUDE.md.context-repo.template` para el rol TL/PMO. `dd-cli client publish` debe generarlo en el context repo con los datos del `stack.yml` y `catalog.yml`. El Consultor es el responsable de esta configuración. |

### Flujo PMO / Tech Lead

| # | Área | Descripción | Fix |
|---|------|-------------|-----|
| F-01 | Flujo PMO | Nada impide ir directo a `dd-cli hdu new` sin correr `/enrich-us` ni `/design-hdu`. Las HDUs quedan con metadata correcta pero sin cuerpo formal (Gherkin, tasks, estimación). | `dd-cli hdu approve` debe advertir si el archivo HDU no tiene criterios de aceptación (`## Criterios` o bloque Gherkin ausente). |
| F-02 | `hdu new` vs `/design-hdu` | `dd-cli hdu new` crea metadata mínima; `/design-hdu` genera el cuerpo estructurado. Son pasos separados sin conexión explícita. | `/design-hdu` debe invocar `dd-cli hdu new` por debajo y escribir el archivo completo en un solo paso. |

### Sesiones multi-cliente

| # | Área | Descripción | Fix |
|---|------|-------------|-----|
| S-01 | Sesión abierta en otro cliente | Al trabajar en Digital-Dev, el usuario tenía una sesión `unclosed: true` de IPRSA (HDU-4/Mapa). Ningún comando avisó proactivamente. | `dd-cli start-session` y `/devflow-ia:start-work` deben detectar sesiones `unclosed` en proyectos conocidos y advertir antes de continuar. |
| S-02 | `unclosed` sin alerta proactiva | La anomalía `stuck_in_started` se detectó pero no se notificó hasta que el usuario corrió `dd-cli status` manualmente. | `dd-cli today` y `/devflow-ia:daily-standup` deben incluir alerta de sesiones `unclosed` de cualquier cliente registrado, no solo del proyecto activo. |

### Ritual diario

| # | Área | Descripción | Fix |
|---|------|-------------|-----|
| R-01 | Dual-clone | `dd-cli` usa `~/.devflow/clients/<slug>/` como cache; si el usuario trabaja en un clone propio, los dos se dessincronizan. | Agregar `dd-cli pull-context <slug>` como paso 0 en el skill `/devflow-ia:daily-standup`, antes de `dd-cli today`. |

### UX Statusline

| # | Área | Descripción | Fix |
|---|------|-------------|-----|
| U-01 | Statusline / Caso C | Muestra `DevFlow IA · iprsa ✓` sin info útil. | Mostrar conteo de HDUs activas: `DevFlow IA · iprsa · 3 HDUs (1 in-progress)` |
| U-02 | Statusline / Caso C | Sin sesión activa no hay indicación del siguiente paso. | Agregar hint: `· dd-cli hdu list` o `· start-session` según estado. |
| U-03 | Statusline / Caso D | No diferencia "directorio random" de "context repo del cliente". | Detectar `.devflow-context/.context-repo.yml` y mostrar `DevFlow IA · context: iprsa`. |

---

_Agregar nuevos ítems a medida que se encuentran en pruebas._
