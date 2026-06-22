---
name: "opsx:propose"
description: Propone change con proposal+design+tasks — exige "no functional change" si refactor
origin: OpenSpec (adaptado por Digital-Dev)
license: MIT
managed-by: "@devflow-ia/cli"
version: 0.2.0
category: Workflow
tags: [workflow, artifacts, devflow-ia]
model: sonnet
model_rationale: Genera 3 artefactos estructurados (proposal/design/tasks) desde SPEC ya pensado. Balanceada — no requiere Opus salvo casos muy complejos
fallback_model: haiku
applies_to_dev_types: [greenfield, brownfield-feature, brownfield-refactor, modernizacion, integracion-externa]
reads:
  - ".devflow/session.json (dev_type)"
  - ".ai/SPEC.md o docs/specs/SPEC-*.md"
enforcement_rules_evaluated:
  - OPSX_PROPOSE_REQUIRE_NO_FUNCTIONAL_CHANGE_SECTION
  - OPSX_PROPOSE_SUGGEST_ANTI_CORRUPTION_LAYER
---

**Reglas adicionales por `dev_type`:**

- **`brownfield-refactor`**: `proposal.md` DEBE incluir sección `## No Functional Change` declarando que el comportamiento externo se mantiene. Warning si falta.
- **`integracion-externa`**: sugerir en `design.md` un patrón anti-corrupción / port-adapter para aislar el modelo del vendor del modelo de dominio interno.
- **`modernizacion`**: `design.md` incluye sección sobre cómo se conviven legacy + nuevo durante la rampa.

Proponer un nuevo cambio técnico. Genera los artefactos de diseño antes de implementar.

Artefactos que crea:
- `proposal.md` (qué y por qué)
- `design.md` (cómo — arquitectura y decisiones)
- `tasks.md` (lista ordenada de tareas de implementación)

Cuando estés listo para implementar: `/opsx:apply`

---

**Input:** El argumento después de `/opsx:propose` es el nombre del cambio (kebab-case), o una descripción de lo que quieres construir.

**Steps**

1. **Si no hay input, preguntar qué se quiere construir**

   Usar la herramienta **AskUserQuestion** (abierta, sin opciones predefinidas):
   > "¿Qué cambio quieres trabajar? Describe qué quieres construir o corregir."

   Del texto, derivar un nombre en kebab-case (ej: "agregar autenticación" → `agregar-auth`).

   **IMPORTANTE:** No continuar sin entender qué se quiere construir.

2. **Crear el directorio del change**
   ```bash
   openspec new change "<name>"
   ```
   Crea el scaffolding en `openspec/changes/<name>/` con `.openspec.yaml`.

3. **Obtener el orden de construcción de artefactos**
   ```bash
   openspec status --change "<name>" --json
   ```
   Parsear el JSON para obtener:
   - `applyRequires`: artefactos necesarios antes de implementar
   - `artifacts`: lista con status y dependencias

4. **Crear artefactos en secuencia hasta estar listo para apply**

   Usar **TodoWrite** para trackear progreso.

   Para cada artefacto con dependencias satisfechas (`ready`):
   
   a. Obtener instrucciones:
      ```bash
      openspec instructions <artifact-id> --change "<name>" --json
      ```
      El JSON incluye: `context`, `rules`, `template`, `instruction`, `outputPath`, `dependencies`
   
   b. Leer los artefactos dependientes para contexto
   
   c. Crear el artefacto usando `template` como estructura. Los campos `context` y `rules` son restricciones para vos — no van en el archivo de salida.
   
   d. Continuar hasta que todos los artefactos de `applyRequires` estén `done`

   e. Si un artefacto necesita input del usuario: usar **AskUserQuestion**

5. **Mostrar estado final**
   ```bash
   openspec status --change "<name>"
   ```

**Output al terminar**

Resumir:
- Nombre del change y ubicación
- Artefactos creados con descripción breve
- "Todos los artefactos listos para implementar."
- Indicación: "Ejecutar `/opsx:apply` para comenzar la implementación."

**Guardrails**
- Crear TODOS los artefactos necesarios para implementar
- Siempre leer artefactos dependientes antes de crear el siguiente
- Si el contexto es críticamente confuso: preguntar. Pero preferir tomar decisiones razonables para mantener momentum
- Si ya existe un change con ese nombre, preguntar si continuar o crear uno nuevo
- Verificar que el archivo del artefacto existe después de crearlo
