---
name: "opsx:apply"
description: Implementa las tareas del change — actualiza tablero del Tech Lead vía devflow_update_task
origin: OpenSpec (adaptado por Digital-Dev)
license: MIT
managed-by: "@devflow-ia/cli"
version: 0.2.0
category: Workflow
tags: [workflow, implementation, devflow-ia]
model: sonnet
model_rationale: Implementación task por task — Sonnet maneja bien código en lenguajes mainstream. Para tasks complejas el dev puede /model opus puntualmente
fallback_model: haiku
applies_to_dev_types: [greenfield, brownfield-feature, brownfield-refactor, modernizacion, integracion-externa]
---

Implementar las tareas de un OpenSpec change, task por task.

**Input:** Opcionalmente especificá el nombre del change (ej: `/opsx:apply agregar-auth`). Si se omite, intentar inferir del contexto o listar los disponibles.

**Steps**

1. **Seleccionar el change**

   Si se provee nombre: usarlo. Si no:
   - Inferir del contexto de la conversación
   - Auto-seleccionar si solo hay un change activo
   - Si es ambiguo: `openspec list --json` + **AskUserQuestion**

   Anunciar: "Usando change: <name>" + cómo cambiar a otro.

2. **Verificar estado**
   ```bash
   openspec status --change "<name>" --json
   ```
   Entender: `schemaName` y qué artefacto contiene las tareas.

3. **Obtener instrucciones de apply**
   ```bash
   openspec instructions apply --change "<name>" --json
   ```
   
   Retorna: `contextFiles`, progreso, lista de tareas, instrucción dinámica.
   
   **Manejar estados:**
   - `state: "blocked"` (artefactos faltantes): mostrar mensaje, sugerir `/opsx:continue`
   - `state: "all_done"`: felicitar, sugerir archive
   - Otros: continuar

4. **Leer archivos de contexto**

   Leer todos los archivos en `contextFiles` del output anterior.

5. **Mostrar progreso actual**

   - Schema en uso
   - Progreso: "N/M tareas completas"
   - Tareas pendientes
   - Instrucción dinámica del CLI

6. **Implementar tareas (loop hasta terminar o bloquearse)**

   Por cada tarea pendiente:
   - Mostrar qué tarea se está implementando
   - Hacer los cambios de código necesarios (mínimos y focalizados)
   - Marcar la tarea como completa en el archivo: `- [ ]` → `- [x]`
   - Continuar a la siguiente

   **Pausar si:**
   - La tarea es ambigua → pedir clarificación
   - La implementación revela un problema de diseño → sugerir actualizar artefactos
   - Error o bloqueo → reportar y esperar
   - El usuario interrumpe

7. **Al terminar o pausar, mostrar estado**

   - Tareas completadas en esta sesión
   - Progreso total
   - Si todo terminó: sugerir archive
   - Si pausó: explicar por qué

**Output durante implementación**

```
## Implementando: <change-name> (schema: <schema-name>)

Tarea 3/7: <descripción>
[...implementando...]
✓ Tarea completa

Tarea 4/7: <descripción>
```

**Output al completar**

```
## Implementación Completa

Change: <change-name>
Schema: <schema-name>
Progreso: 7/7 tareas completas ✓

Completadas en esta sesión:
- [x] Tarea 1
...

Podés archivar con `/opsx:archive`
```

**Guardrails**
- Continuar hasta terminar o bloquearse
- Siempre leer los archivos de contexto antes de empezar
- Si una tarea es ambigua: pausar y preguntar antes de implementar
- Si la implementación revela problemas de diseño: pausar y sugerir actualizar artefactos
- Cambios mínimos y focalizados por tarea
- Actualizar el checkbox inmediatamente después de completar cada tarea
- En caso de errores o requisitos poco claros: pausar — no adivinar
