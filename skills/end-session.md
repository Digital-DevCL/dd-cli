---
name: end-session
description: Cierra sesión actualizando PROGRESS.md + commit con trailer DevFlow-Type
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.2.0
category: Session
tags: [session, close, progress, devflow-ia]
model: haiku
model_rationale: Operación mecánica de cierre — genera PROGRESS.md, hace commit/push. No requiere razonamiento profundo. Haiku es 5x más rápido para algo que el dev ejecuta varias veces al día
fallback_model: sonnet
applies_to_dev_types: [greenfield, brownfield-feature, brownfield-refactor, modernizacion, integracion-externa]
reads:
  - ".devflow/session.json (dev_type)"
writes:
  - "<APPS_PATH>/<app>/.ai/PROGRESS.md"
  - "git commit con trailer DevFlow-Type: <dev_type>"
enforcement_rules_evaluated:
  - COMMIT_TRAILER_DEVFLOW_TYPE
---

**Importante: el commit generado DEBE incluir el trailer `DevFlow-Type: <dev_type>` para que `/release-check` y la CI/CD pipeline lo validen.**

Eres un asistente de cierre de sesión para el método DevFlow IA. Tu objetivo es actualizar el estado del proyecto con lo que se trabajó hoy, minimizando la fricción para el developer.

**Fecha actual:** usar `date +%Y-%m-%d` para todas las fechas.

---

## PASO 0 — Leer configuración del proyecto

```bash
grep -E "APPS_PATH:|SPEC_PATH:" CLAUDE.md 2>/dev/null
```

- `APPS_PATH`: ruta de apps (default: `apps/`)
- `SPEC_PATH`: ruta de specs maestros (default: `docs/specs/`)

---

## PASO 1 — Leer contexto automáticamente

Ejecutar silenciosamente. No reportar el output crudo — solo usarlo para construir el contexto.

```bash
date +%Y-%m-%d

# Commits de esta sesión
git log --oneline --format="%h %s" --since="12 hours ago" 2>/dev/null \
  || git log --oneline -10

# Apps con archivos modificados
git diff --name-only HEAD~5 HEAD 2>/dev/null \
  | grep "^[APPS_PATH]/" | sed "s|[APPS_PATH]/||;s|/.*||" | sort -u

# Estado del working tree
git status --short 2>/dev/null
```

Leer:
- `BACKLOG.md` — tareas pendientes y en progreso
- `.ai/PROGRESS.md` de cada app detectada como modificada

Construir internamente:
- Lista de IDs del BACKLOG en los commits (mayúsculas-guion-número: `FEAT-004`, `FIX-029`)
- Lista de apps afectadas
- Resumen de qué se hizo

---

## PASO 2 — Preguntar al developer

```
Detecté esto en la sesión de hoy:

Commits:
  [hash] [mensaje]
  [hash] [mensaje]

Apps tocadas: [lista]
IDs del BACKLOG posiblemente completados: [lista o "ninguno detectado"]

---

Para cerrar la sesión necesito 3 cosas:

1. ¿Cuáles de los IDs quedaron completamente terminados?
   (confirma la lista, agrega los que falten, quita los que no)

2. ¿Cuál es el próximo paso concreto para la próxima sesión?
   (1-2 items específicos, no "continuar el trabajo")

3. ¿Hay alguna decisión técnica o lección aprendida que no esté evidente en los commits?
   (opcional — "ninguna" si no aplica)
```

**Espera la respuesta.**

---

## PASO 3 — Generar actualizaciones

### 3a. `.ai/PROGRESS.md` — prepend por app afectada

Agregar AL INICIO (después del header):

```markdown
## Sesión [FECHA]

### Completado

- [x] [descripción — no copiar el commit literal]
  - Commit: [hash]

### Pendiente / En progreso

- [ ] [qué quedó a medias — con contexto de dónde quedó]

### Decisiones tomadas

- [Decisión + razón — si el developer indicó alguna]

### Lección aprendida

- [Solo si el developer indicó — omitir sección si no aplica]

---
```

### 3b. `BACKLOG.md` — mover completadas

Para cada ID confirmado como completado:
1. Encontrar la fila en la tabla de pendientes
2. Moverla a `## Completadas ([FECHA])` — crear sección si no existe
3. Agregar resolución concisa en la columna Notas

No tocar IDs no confirmados, secciones históricas, ni la sección "Lecciones Aprendidas".

### 3c. `.devflow/session.json` — marcar sesión como cerrada

Llamar `dd-cli end-session` para:
- Setear `ended_at` con timestamp ISO
- Setear `flow_state: "ended"`
- En modo platform: notifica al Jefe Dev vía MCP

Si `dd-cli` no está disponible (proyecto sin setup completo): saltar este paso.

---

## PASO 4 — Escribir los archivos

Orden:
1. `.ai/PROGRESS.md` de cada app afectada
2. `BACKLOG.md`
3. `dd-cli end-session` (cierra la sesión en `.devflow/session.json`)

---

## PASO 5 — Resumen final

```
Sesión [FECHA] cerrada.

Archivos actualizados:
  ✅ [APPS_PATH]/[app]/.ai/PROGRESS.md
  ✅ BACKLOG.md — [N] tareas movidas a Completadas
  ✅ .devflow/session.json — flow_state: ended

Completadas hoy:  [ID1], [ID2]
Próxima sesión:   [próximo paso 1]
                  [próximo paso 2]

[Si hay cambios sin commitear:]
⚠️  Hay cambios sin commitear en: [lista de archivos]
```

---

## REGLAS

- No crear entradas de progreso vacías — si no hay commits, preguntar antes de inventar
- No modificar "Lecciones Aprendidas" ni "Recursos" del BACKLOG
- No borrar información histórica — solo agregar y mover
- Si un ID del BACKLOG no se encuentra, mencionar que puede ya estar completado
- Si hay archivos con cambios sin commitear, mencionarlos al final
