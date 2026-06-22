---
name: derive-spec
description: Deriva un SPEC maestro al slice relevante para una app o servicio específico
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.2.0
category: Spec
tags: [spec, derive, devflow-ia]
model: sonnet
model_rationale: Extracción y mapeo guiado por SPEC maestro — operación balanceada, no requiere razonamiento de Opus salvo cuando hay >5 apps afectadas
fallback_model: haiku
applies_to_dev_types: [greenfield, brownfield-feature, brownfield-refactor, modernizacion, integracion-externa]
reads:
  - "<SPEC_PATH>/SPEC-<slug>.md (frontmatter incluye dev_type)"
  - ".devflow/session.json (dev_type, apps_affected)"
  - ".ai/REPO-CONTEXT.md (si dev_type != greenfield)"
  - "<APPS_PATH>/<app>/.ai/SPEC.md (si existe — append)"
writes:
  - "<APPS_PATH>/<app>/.ai/SPEC.md"
  - "<APPS_PATH>/<app>/.ai/CONTEXT.md"
---

Eres un arquitecto de software experto en el método DevFlow IA. Tu objetivo es leer un SPEC maestro y extraer el slice relevante para una app o servicio específico, generando o actualizando su `.ai/SPEC.md`.

**Importante: la skill detecta si la app es existente (lee REPO-CONTEXT.md) o nueva, y se comporta acorde — NO crea scaffolding (eso es responsabilidad de `/new-app`, que solo aplica a greenfield).**

**Argumentos:** `/derive-spec [spec-slug] [app-nombre]`

---

## PASO 0 — Leer session.json + frontmatter del SPEC

```bash
cat .devflow/session.json | jq '.dev_type, .apps_affected'
cat [SPEC_PATH]/SPEC-[spec-slug].md | head -20
```

Detectar:
- `dev_type` de la HDU (debe coincidir con el del SPEC maestro)
- Lista `apps_affected` de la session vs apps referenciadas en SPEC

---

## PASO 0.5 — Detectar si la app es existente

```bash
ls [APPS_PATH]/[app-nombre]/.ai/ 2>/dev/null
ls [APPS_PATH]/[app-nombre]/package.json 2>/dev/null
ls .ai/REPO-CONTEXT.md 2>/dev/null
```

- **App existente** (tiene `package.json` o equivalente): NO crear scaffolding. Leer REPO-CONTEXT §3 (Arquitectura) y §4 (Entry points) para entender puntos de extensión. El `.ai/SPEC.md` enfatiza dónde **integrar** las nuevas capacidades, no dónde construir desde cero.
- **App nueva** (no existe directorio): solo continuar si `dev_type == greenfield`. Si no es greenfield → abortar con: "Esta app no existe. Si es greenfield, ejecuta `/new-app` primero. Si no es greenfield, no debería haber app nueva — revisar el SPEC."

---

---

## PASO 0 — Leer configuración del proyecto

```bash
grep -E "SPEC_PATH:|APPS_PATH:|STACK:" CLAUDE.md 2>/dev/null
```

- `SPEC_PATH`: ruta de specs maestros (default: `docs/specs/`)
- `APPS_PATH`: ruta donde viven las apps (default: `apps/`)

---

## PASO 1 — Detectar contexto

```bash
# SPECs disponibles
ls [SPEC_PATH]/SPEC-*.md 2>/dev/null | sed 's|.*SPEC-||;s|\.md||' | grep -v TEMPLATE | sort

# Apps o servicios disponibles
ls [APPS_PATH]/ 2>/dev/null | sort

# Directorio actual (para inferir app)
pwd
```

Si el directorio actual es `[APPS_PATH]/<nombre>/`, inferir el app-nombre de ahí.

---

## PASO 2 — Seleccionar SPEC y app (si no vienen en $ARGUMENTS)

Si falta el spec-slug:
```
SPECs disponibles:
  [lista numerada]

¿Qué SPEC maestro quieres derivar?
```

Si falta el app-nombre:
```
Apps disponibles:
  [lista numerada]

¿Para qué app o servicio estás derivando?
```

---

## PASO 3 — Leer el SPEC maestro

Lee `[SPEC_PATH]/SPEC-<slug>.md` completo. Identifica:
- Tipo (greenfield / brownfield / modernizacion)
- Endpoints / interfaces (sección 6)
- Schema de datos (sección 5)
- Flujos clave (sección 7)
- Criterios de aceptación (sección 8)

---

## PASO 4 — Preguntar el alcance de esta app

```
En el SPEC "[nombre]" encontré:

Endpoints / Componentes:
  [lista de la sección 6]

Datos / Migraciones:
  [lista de la sección 5]

¿Qué parte de esto implementa [app-nombre]?

Opciones:
  a) Todo (esta app implementa el SPEC completo)
  b) Solo endpoints/componentes: [indica cuáles]
  c) Solo la capa de datos / migraciones
  d) Descríbelo con tus palabras

¿Esta feature es nueva para esta app o extiende algo que ya existe en su .ai/SPEC.md?
```

**Espera la respuesta.**

---

## PASO 5 — Verificar .ai/SPEC.md existente

```bash
cat [APPS_PATH]/[app-nombre]/.ai/SPEC.md 2>/dev/null | head -30
```

Si existe con contenido real:
- Agregar nueva feature a la tabla de features al inicio
- Appendear el detalle al final
- NO reemplazar contenido existente

Si no existe o está vacío: crear desde cero.

---

## PASO 6 — Generar el .ai/SPEC.md

### Si NO existe — crear completo:

```markdown
# Spec: [app-nombre]

> Última actualización: [FECHA]

| Feature | Spec Maestra | Estado |
|---------|-------------|--------|
| [nombre feature] | `[SPEC_PATH]/SPEC-[slug].md` | `ready-for-implementation` ← ACTIVO |

---

# [Nombre Feature] — [app-nombre]

> Derivado de: `[SPEC_PATH]/SPEC-[slug].md`
> Tipo: [greenfield / brownfield / modernizacion]

## Responsabilidad de esta app

[1-2 oraciones: qué parte del feature implementa esta app]

## Endpoints / Interfaces a implementar

| Método | Ruta | Handler / Componente | Estado |
|--------|------|----------------------|--------|
| [METODO] | `/[ruta]` | `[Handler]` | ❌ Pendiente |

## Cambios de datos

| Archivo | Descripción | Estado |
|---------|-------------|--------|
| `[migración o schema change]` | [qué hace] | ❌ Pendiente |

## Componentes UI

| Nombre | Archivo | Estado |
|--------|---------|--------|
| `[Componente]` | `[ruta/archivo]` | ❌ Pendiente |

## Lógica clave

> Puntos de implementación no obvios extraídos del SPEC maestro.

- [Punto clave 1]
- [Punto clave 2]

## Criterios de aceptación (slice de esta app)

- [ ] [criterio del SPEC maestro relevante a esta app]
```

### Si YA EXISTE — agregar feature:

1. Agregar fila a la tabla de features
2. Marcar feature anterior como `done` si corresponde
3. Appendear nuevo bloque al final

---

## PASO 7 — Verificar / crear .ai/PROGRESS.md

```bash
ls [APPS_PATH]/[app-nombre]/.ai/PROGRESS.md 2>/dev/null
```

Si NO existe, crear desde el template `templates/app-ai/PROGRESS.md`.
Si ya existe: no modificar — solo informar.

---

## PASO 8 — Resumen

```
.ai/SPEC.md actualizado: [APPS_PATH]/[app-nombre]/

Feature: [nombre]
Tipo: greenfield / brownfield / modernizacion
Estado: ready-for-implementation

Items a implementar:
  Endpoints/Interfaces: [N]
  Cambios de datos:     [N]
  Componentes UI:       [N]

PROGRESS.md: creado / ya existía

Próximo paso: /opsx:propose para empezar el desarrollo
```

---

## REGLAS

- El `.ai/SPEC.md` es un SLICE del maestro — no copiar lo que no implementa esta app
- Si hay ambigüedad sobre qué implementa la app, preguntar antes de generar
- No inventar archivos, rutas o componentes que no estén en el SPEC maestro
- Estados: `draft` / `ready-for-implementation` / `in-progress` / `done`
- Marcar con `← ACTIVO` la feature que se está implementando
