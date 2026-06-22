---
name: "opsx:archive"
description: Archivar un change completado
origin: OpenSpec (adaptado por Digital-Dev)
license: MIT
managed-by: "@devflow-ia/cli"
version: 0.2.0
category: Workflow
tags: [workflow, archive, devflow-ia]
model: haiku
model_rationale: Mecánica pura — mueve archivos de openspec/changes/<name>/ a openspec/changes/archive/. No requiere razonamiento
fallback_model: sonnet
applies_to_dev_types: [greenfield, brownfield-feature, brownfield-refactor, modernizacion, integracion-externa]
---

Archivar un change completado.

**Input:** Opcionalmente especificá el nombre después de `/opsx:archive` (ej: `/opsx:archive agregar-auth`). Si se omite y es ambiguo, pedir selección.

**Steps**

1. **Si no se provee nombre, pedir selección**

   ```bash
   openspec list --json
   ```
   
   Usar **AskUserQuestion** para que el usuario seleccione.
   Mostrar solo changes activos (no archivados).
   
   **IMPORTANTE:** No adivinar ni auto-seleccionar. Siempre dejar elegir al usuario.

2. **Verificar completitud de artefactos**

   ```bash
   openspec status --change "<name>" --json
   ```
   
   Parsear: `schemaName`, `artifacts` con sus status.
   
   **Si hay artefactos no `done`:**
   - Mostrar advertencia con la lista de incompletos
   - Pedir confirmación para continuar
   - Proceder si el usuario confirma

3. **Verificar completitud de tareas**

   Leer el archivo de tareas (típicamente `tasks.md`) y contar:
   - `- [ ]` (incompletas) vs `- [x]` (completas)
   
   **Si hay tareas incompletas:**
   - Mostrar advertencia con el conteo
   - Pedir confirmación
   - Proceder si confirma

4. **Evaluar sincronización de delta specs**

   Verificar si hay delta specs en `openspec/changes/<name>/specs/`.
   Si no hay: continuar sin prompt de sync.
   
   **Si hay delta specs:**
   - Comparar cada delta spec con el spec principal en `openspec/specs/<capability>/spec.md`
   - Mostrar resumen combinado de los cambios que se aplicarían
   - Opciones:
     - "Sincronizar ahora (recomendado)" → usar Task tool para invocar openspec-sync-specs
     - "Archivar sin sincronizar"
   - Proceder al archive independientemente de la elección

5. **Ejecutar el archive**

   ```bash
   mkdir -p openspec/changes/archive
   ```
   
   Nombre destino: `YYYY-MM-DD-<change-name>`
   
   Si ya existe ese destino: falla con error, sugerir opciones.
   
   ```bash
   mv openspec/changes/<name> openspec/changes/archive/YYYY-MM-DD-<name>
   ```

6. **Mostrar resumen**

   Incluir: nombre del change, schema usado, ubicación del archive, estado de sync de specs, advertencias si aplica.

**Output exitoso**

```
## Archive Completo

Change:     <change-name>
Schema:     <schema-name>
Archivado:  openspec/changes/archive/YYYY-MM-DD-<name>/
Specs:      Sincronizados / Sin delta specs / Sync omitido

Todos los artefactos completos. Todas las tareas completas.
```

**Output con advertencias**

```
## Archive Completo (con advertencias)

Change:     <change-name>
Archivado:  openspec/changes/archive/YYYY-MM-DD-<name>/

Advertencias:
- Archivado con [N] artefactos incompletos
- Archivado con [N] tareas incompletas
- Sync de specs omitido (el usuario eligió omitir)

Revisar el archive si esto no fue intencional.
```

**Guardrails**
- Siempre pedir selección si no se provee nombre
- Usar el grafo de artefactos (openspec status --json) para verificar completitud
- No bloquear el archive en advertencias — solo informar y confirmar
- Preservar `.openspec.yaml` al mover (se mueve con el directorio)
- Si se solicita sync: usar Skill tool para invocar `openspec-sync-specs`
