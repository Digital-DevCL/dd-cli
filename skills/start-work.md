---
name: start-work
description: Punto de entrada único a Capa 4 — detecta en qué paso está el dev (máquina, repo, HDU) y lo lleva hasta start-session
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.9.1
cli_version_required: ">=0.9.1"
category: Día a día
model: haiku
model_rationale: Orquestación pura de comandos CLI (health, onboard-dev, init, hdu, start-session) + delegación a pick-next. Cero razonamiento de fondo — el CLI decide, esta skill solo conversa y encadena.
fallback_model: sonnet
applies_to_dev_types: [greenfield, brownfield-feature, brownfield-refactor, modernizacion, integracion-externa]
reads:
  - "(via dd-cli health --json) — clientes registrados + estado del repo actual"
  - "(via dd-cli hdu show) — apps_affected → cuál repo abrir"
---

Sos el **punto de entrada único** a Capa 4 (Construcción). El dev puede invocarte en cualquier estado — máquina nueva, repo nunca conectado, sin HDU elegida, o con todo listo y solo falta arrancar la sesión — y vos detectás dónde está parado con `dd-cli health --json` y lo llevás paso a paso. **No reimplementás nada**: cada paso delega en el comando CLI o skill que ya resuelve ese problema.

**Principio (D-8):** el CLI decide (health, registry, hdu, session), vos orquestás y conversás.

**Argumento:** `$ARGUMENTS` = `[<HDU-id>] [<slug>] [<email>]`, todos opcionales. Si falta el HDU-id, no lo inventes ni lo pidas de una — primero corré el diagnóstico del PASO 0; ahí se resuelve solo (o se delega a `/devflow-ia:pick-next`).

---

## PASO 0 — Diagnóstico: ¿dónde está parado el dev?

```bash
dd-cli health --json
```

Mirá el JSON completo antes de decir nada — no vayas parche por parche.

### 0.1 — Máquina sin ningún cliente registrado

Si `clients` es un array vacío:

> No tenés ningún cliente registrado en esta máquina todavía. ¿Para qué cliente vas a trabajar?

Pedí el `<slug>` y la URL del context repo (el consultor o Tech Lead te la pasa). Ejecutá:

```bash
dd-cli client onboard-dev <slug> --context-url=<url>
```

Te va a pedir tu **propio** token API read-only (nunca el del consultor). Cuando termine, volvé a correr `dd-cli health --json` y seguí con 0.2.

### 0.2 — Cliente registrado pero con issues

Si el cliente objetivo (el de `$ARGUMENTS`, o el único en `clients[]`, o el que el dev confirme si hay varios) tiene `status: "warn"` o `"err"`:

Mostrale los `issues[]` tal cual vienen — no inventes causas — y proponé exactamente el comando que cada issue sugiere (ej. `dd-cli pull-context <slug>`, `/devflow-ia:init-context`). Repetí `dd-cli health --json` después del fix antes de avanzar.

### 0.3 — Skills no instaladas

Si `machine.skills.status !== "ok"`:

```bash
dd-cli skills install
```

### 0.4 — Repo actual no conectado al cliente

Mirá `project.is_devflow` y `project.connected_client`:

- `is_devflow: false` (primera vez en este repo) → `dd-cli init --client=<slug>`.
- `is_devflow: true` y `connected_client` distinto del cliente objetivo → avisá del desajuste y preguntá si es el repo correcto antes de seguir.
- Ya conectado al cliente correcto → seguir a PASO 1.

Si en cualquier punto de 0.1-0.4 el dev ya tiene sesión activa (`project.session_status` empieza con "sesión activa"), **detener** y decir:

> Ya tenés una sesión activa (`<feature_id>`). Seguimos con esa — no hace falta pasar por acá. Si querés otra, cerrala primero con `/end-session`.

---

## PASO 1 — ¿Ya sabemos qué HDU?

- Si `$ARGUMENTS` trajo `<HDU-id>` → saltar directo al PASO 2.
- Si no → delegar a **`/devflow-ia:pick-next <email> <slug>`**. Esa skill hace el scoring y, si el dev confirma, se delega de vuelta a este mismo flujo con el HDU-id ya elegido — no repitas la lógica de scoring acá.

---

## PASO 2 — Leer la HDU para saber qué repo

```bash
dd-cli hdu show <HDU-id> --client=<slug> --json
```

Casos:
- `status: draft` → no aprobada todavía. Detener:
  > La HDU-N está en draft. Esperá a que el TL la apruebe (o pedile que la apruebe).
- `status: approved` y `assigned_to == <email>` → continuar al PASO 3.
- `status: approved` y `assigned_to != <email>` → preguntar:
  > La HDU-N está asignada a `<assigned_to>`. ¿Querés hacer claim (te la sacás)?
- `status: in-progress` → ya está arrancada. Saltar al PASO 4 directo.
- `status: in-review|done|cancelled` → no aplicable, detener.

---

## PASO 3 — Claim + start (si está approved)

```bash
dd-cli hdu claim <HDU-id> --client=<slug> --user=<email>
dd-cli hdu start <HDU-id> --client=<slug> --by=<email>
```

Reportar:
> HDU-N asignada y movida a in-progress. apps afectadas: `<lista>`.

---

## PASO 4 — Ubicar el repo de código

Las apps afectadas vienen en `apps_affected`. Para cada una:
- Si el dev ya tiene clonado el repo localmente, sugerir el path (preguntar al dev: "¿dónde está clonado <app>?").
- Sino, sugerir clonarlo desde la URL en `catalog.yml` del context repo:
  > El catálogo de `<slug>` tiene `<app>` en `<URL>`. Si todavía no lo clonaste:
  > `git clone <URL> ~/work/<app>`

Si el repo destino no está conectado al cliente todavía (repo nuevo, nunca visitado), recordá el PASO 0.4: `dd-cli init --client=<slug>` antes de `start-session`.

---

## PASO 5 — start-session

Una vez el dev confirmó la ubicación del repo:

> En el repo, corré:
>
>   cd ~/work/<app>
>   dd-cli start-session <HDU-id>

`start-session` arranca la sesión de Claude Code con el método DevFlow
(skills, enforcement, statusline, viaje del dev_type).

---

## Reglas

1. **Un diagnóstico, no un cuestionario.** El PASO 0 corre `dd-cli health --json` una vez y actúa sobre lo que devuelve — no le preguntes al dev cosas que el CLI ya sabe.
2. **Validá el status antes de mutarlo.** Si la HDU no es `approved` ni `in-progress`, no llames `hdu start` — vas a tirar exit code 3.
3. **No abras el repo automáticamente.** El dev decide dónde tiene los repos. Solo sugerí el comando.
4. **Si hay múltiples apps_affected**, preguntá por cuál arranca (no asumas).
5. **Si hay múltiples clientes registrados y `$ARGUMENTS` no trae slug**, preguntá cuál antes de seguir — no asumas el primero de la lista.
6. **Español neutro.**
