---
name: end-day
description: Cierra el día — end-session + sugerencia de commit + si HDU lista, hdu review/close
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.7.0
cli_version_required: ">=0.7.0"
category: Día a día
model: sonnet
model_rationale: Decidir si la HDU pasa a review/done requiere leer el estado del repo (PR abierto, mergeado, etc) y conversar con el dev. Más razonamiento que las skills de mañana.
fallback_model: haiku
applies_to_dev_types: [greenfield, brownfield-feature, brownfield-refactor, modernizacion, integracion-externa]
reads:
  - "(via dd-cli status) — sesión activa"
  - "(via dd-cli hdu show) — status actual"
writes:
  - "(via dd-cli end-session, hdu review, hdu close) — transiciones"
---

Sos el assistant del cierre del día. La sesión activa del dev se cierra con `dd-cli end-session`; las transiciones HDU con `hdu review`, `hdu close`.

**Principio (D-8):** propones, el humano confirma.

**Argumento:** `$ARGUMENTS` = `<email>` o vacío.

---

## PASO 1 — Detectar contexto

```bash
dd-cli status --json     # sesión activa
dd-cli today --user=<email> --json  # queue + alertas
```

Si no hay sesión activa, no hay nada que cerrar — saludar y terminar.

---

## PASO 2 — Preguntar qué pasó hoy

```
¿Cómo te fue con HDU-N?
  1. Terminé, PR abierto/listo para review     → hdu review
  2. Terminé, PR mergeado                       → hdu close
  3. Avancé pero no terminé (pausa)             → solo end-session
  4. Estoy bloqueado (anotar razón)             → end-session + nota
```

---

## PASO 3A — PR abierto (in-progress → in-review)

```bash
dd-cli hdu review <HDU-id> --client=<slug> --by=<email> --reason="MR #N abierto"
```

---

## PASO 3B — PR mergeado (in-review → done)

```bash
dd-cli hdu close <HDU-id> --client=<slug> --by=<email>
```

Si la HDU estaba en `in-progress` directo (sin pasar por review), la transición a `done` no es legal. Avisar:
> La HDU-N está en in-progress, no podemos cerrarla directo a done. Pasala a in-review primero:
> `dd-cli hdu review HDU-N --client=<slug> --by=<email>`
> después `dd-cli hdu close HDU-N --client=<slug> --by=<email>`.

---

## PASO 3C — Pausa (solo end-session)

Si el dev avanzó pero no terminó:

```bash
dd-cli end-session
```

La HDU queda en `in-progress` hasta mañana. La sesión se cierra y queda
loggeada.

---

## PASO 3D — Bloqueado

```bash
dd-cli end-session --note="<razón del bloqueo>"
```

Sugerir además agregar al inbox del TL:

```bash
dd-cli inbox add --kind=hdu_blocked --client=<slug> \
  --data='{"hdu":"HDU-N","reason":"<razón>","by":"<email>"}'
```

Para que el TL lo vea en su daily-standup mañana.

---

## PASO 4 — Sugerir commit message

Si hay cambios sin commitear en el repo de código, sugerir un commit
message con trailer DevFlow:

```
feat: <síntesis>

Cierra parte de HDU-N · <título>

DevFlow-Type: <dev_type>
DevFlow-Session: <duración>
```

(El commit lo hace el dev manualmente — la skill no commitea.)

---

## Reglas

1. **No cerrés HDUs sin confirmación explícita.** "Mergeado el PR" requiere `sí` del dev.
2. **Validá transiciones legales.** Si el dev dice "cerralo" pero está en `in-progress`, explicá que falta pasar por `in-review`.
3. **No suspondas la sesión sin nota si el dev menciona bloqueo.**
4. **Español neutro.**
