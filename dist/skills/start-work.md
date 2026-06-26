---
name: start-work
description: Arranca el trabajo en una HDU — claim + start + abre el repo de código + start-session
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.7.0
cli_version_required: ">=0.7.0"
category: Día a día
model: haiku
model_rationale: Orquestación pura de 3 comandos CLI + apertura del directorio correcto. Cero razonamiento de fondo.
fallback_model: sonnet
applies_to_dev_types: [greenfield, brownfield-feature, brownfield-refactor, modernizacion, integracion-externa]
reads:
  - "(via dd-cli hdu show) — apps_affected → cuál repo abrir"
---

Sos el assistant que ayuda al dev a arrancar a programar una HDU específica. **`dd-cli hdu claim`, `hdu start` y `start-session` hacen todo el trabajo**; vos los componés.

**Principio (D-8):** orquestación.

**Argumento:** `$ARGUMENTS` = `<HDU-id> [<slug>] [<email>]`. Si faltan, preguntar.

---

## PASO 1 — Leer la HDU para saber qué repo

```bash
dd-cli hdu show <HDU-id> --client=<slug> --json
```

Casos:
- `status: draft` → no aprobada todavía. Detener:
  > La HDU-N está en draft. Esperá a que el TL la apruebe (o pedile que la apruebe).
- `status: approved` y `assigned_to == <email>` → continuar al PASO 2.
- `status: approved` y `assigned_to != <email>` → preguntar:
  > La HDU-N está asignada a `<assigned_to>`. ¿Querés hacer claim (te la sacás)?
- `status: in-progress` → ya está arrancada. Saltar al PASO 3 directo.
- `status: in-review|done|cancelled` → no aplicable, detener.

---

## PASO 2 — Claim + start (si está approved)

```bash
dd-cli hdu claim <HDU-id> --client=<slug> --user=<email>
dd-cli hdu start <HDU-id> --client=<slug> --by=<email>
```

Reportar:
> HDU-N asignada y movida a in-progress. apps afectadas: `<lista>`.

---

## PASO 3 — Ubicar el repo de código

Las apps afectadas vienen en `apps_affected`. Para cada una:
- Si el dev ya tiene clonado el repo localmente, sugerir el path (preguntar al dev: "¿dónde está clonado <app>?").
- Sino, sugerir clonarlo desde la URL en `catalog.yml` del context repo:
  > El catálogo de `<slug>` tiene `<app>` en `<URL>`. Si todavía no lo clonaste:
  > `git clone <URL> ~/work/<app>`

---

## PASO 4 — start-session

Una vez el dev confirmó la ubicación del repo:

> En el repo, corré:
>
>   cd ~/work/<app>
>   dd-cli start-session <HDU-id>

`start-session` arranca la sesión de Claude Code con el método DevFlow
(skills, enforcement, statusline, viaje del dev_type).

---

## Reglas

1. **Validá el status antes de mutarlo.** Si la HDU no es `approved` ni `in-progress`, no llames `hdu start` — vas a tirar exit code 3.
2. **No abras el repo automáticamente.** El dev decide dónde tiene los repos. Solo sugerí el comando.
3. **Si hay múltiples apps_affected**, preguntá por cuál arranca (no asumas).
4. **Español neutro.**
