# Auditoría de Skills — T1-002

**Fecha:** 2026-06-11
**Objetivo:** Estandarizar las 13 skills existentes para bundling en `@devflow-ia/cli`.
**Resultado esperado:** skills genéricas, sin sesgos de cliente, con frontmatter estándar y contrato de customización documentado.

---

## Resumen ejecutivo

**Buena noticia:** las skills están más limpias de lo esperado.
- ✅ Cero referencias explícitas a IPRSA
- ✅ Cero paths o lógica hardcodeada de PDR
- ✅ Los clientes solo aparecen como ejemplos en placeholders (`PDR`, `KOM` como JIRA_PROJECT)

**Trabajo a hacer:** mayormente estilístico y de estandarización.
- Frontmatter estándar en todas
- Renombrar "método SDD" → "método DevFlow IA"
- Limpiar voseo rioplatense → español neutro
- Eliminar formatos PM_TOOL externos (DevFlow IA es el PM)
- Eliminar integración Obsidian (fuera de scope)
- Reemplazar terminología interna "Capa N" → nombres descriptivos

---

## Decisiones tomadas

| Decisión | Resultado |
|---|---|
| Nombre del método en las skills | **DevFlow IA** |
| Formatos PM_TOOL (Jira/Azure/Linear) | **Eliminar** — DevFlow IA es el PM |
| Integración Obsidian (VAULT_STATE_FILE) | **Eliminar** — fuera de scope del producto |
| Terminología "Capa N" | **Reemplazar por nombres descriptivos** |
| Voseo (Pegá, Describila, etc.) | **Eliminar** — español neutro |
| Frontmatter | **Estándar obligatorio en todas** (ver abajo) |

---

## Frontmatter estándar

### Skills nativas Digital-Dev:

```yaml
---
name: <skill-name>
description: <una línea, max 80 chars>
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.1.0
category: <Workflow | Spec | Session | Quality | Onboarding>
---
```

### Skills adaptadas de OpenSpec:

```yaml
---
name: <skill-name>
description: <una línea>
origin: OpenSpec (adaptado por Digital-Dev)
license: MIT
managed-by: "@devflow-ia/cli"
version: 0.1.0
category: Workflow
---
```

---

## Inventario y hallazgos por skill

### Nativas Digital-Dev

#### 1. `capture-req.md` — Captura de requerimiento → brief
- **Frontmatter:** falta
- **"método SDD":** sí → cambiar
- **Voseo:** detectado → limpiar
- **PM_TOOL formats hardcodeados:** sí (Jira/Azure/Linear) → eliminar
- **Ejemplos cliente:** `PDR, KOM` en línea 16 → cambiar a `XX, YY` genéricos
- **Severidad:** Media

#### 2. `derive-spec.md` — Deriva spec maestro → .ai/SPEC.md por app
- **Frontmatter:** falta
- **"método SDD":** sí → cambiar
- **Voseo:** mínimo
- **Otros:** generalmente limpio
- **Severidad:** Baja

#### 3. `design-hdu.md` — Brief/épica → HDU formal
- **Frontmatter:** falta
- **"método SDD":** sí → cambiar
- **Voseo:** sí ("Pegá", "Describila", "sabés") → limpiar
- **PM_TOOL formats hardcodeados:** sí → eliminar
- **Severidad:** Media

#### 4. `end-session.md` — Cierre formal de sesión
- **Frontmatter:** falta
- **"método SDD":** sí → cambiar
- **Voseo:** ligero
- **Obsidian (VAULT_STATE_FILE):** sí, líneas 11-12 y 117-130 → eliminar
- **Severidad:** Media

#### 5. `enrich-us.md` — Enriquecer historia vaga
- **Frontmatter:** falta
- **"método SDD":** sí → cambiar
- **Voseo:** extenso → limpiar
- **Terminología "Capa N":** línea 5 ("Capa 2", "Capa 4") → reemplazar
- **Severidad:** Media

#### 6. `new-app.md` — Scaffolding nueva app
- **Frontmatter:** falta
- **"método SDD":** sí → cambiar
- **Voseo:** ligero
- **Integración artefactos:** pendiente refactor (T0-003 separada)
- **Severidad:** Media (refactor mayor pendiente en T0-003)

#### 7. `new-spec.md` — Spec maestro técnico
- **Frontmatter:** falta
- **"método SDD":** sí → cambiar
- **Voseo:** mínimo
- **LEGACY_SYSTEM:** parametrizado correctamente vía CLAUDE.md ✓
- **Severidad:** Baja

#### 8. `plan-sprint.md` — Sprint plan desde HDUs
- **Frontmatter:** falta
- **"método SDD":** sí → cambiar
- **Voseo:** sí → limpiar
- **PM_TOOL:** mención simple, no formatos hardcodeados — aceptable
- **Severidad:** Baja-Media

#### 9. `release-check.md` — Review pre-merge
- **Frontmatter:** falta
- **"método SDD":** no menciona — limpio
- **Voseo:** mínimo
- **PM_TOOL:** referencia simple, aceptable
- **Severidad:** Baja

---

### Adaptadas de OpenSpec

#### 10. `opsx/apply.md`
- **Frontmatter:** parcial — falta `origin`, `license`, `managed-by`, `version`
- **Tag "sdd":** cambiar a `devflow-ia`
- **Severidad:** Baja (solo frontmatter)

#### 11. `opsx/archive.md`
- **Frontmatter:** parcial — mismo issue
- **Tag "sdd":** cambiar
- **Severidad:** Baja

#### 12. `opsx/explore.md`
- **Frontmatter:** parcial — mismo issue
- **Severidad:** Baja

#### 13. `opsx/propose.md`
- **Frontmatter:** parcial — mismo issue
- **Severidad:** Baja

---

## Plan de estandarización

**Orden propuesto (de menor a mayor impacto):**

### Batch 1 — Frontmatter en opsx/* (4 archivos, cambios menores)
- `opsx/apply.md`, `opsx/archive.md`, `opsx/explore.md`, `opsx/propose.md`
- Completar frontmatter con `origin`, `license`, `managed-by`, `version`
- Cambiar tag `sdd` → `devflow-ia`

### Batch 2 — Skills "limpias" (3 archivos)
- `derive-spec.md`, `new-spec.md`, `release-check.md`
- Agregar frontmatter
- Reemplazar "método SDD" → "método DevFlow IA"
- Limpieza menor de voseo

### Batch 3 — Skills con PM_TOOL externo (2 archivos)
- `capture-req.md`, `design-hdu.md`
- Agregar frontmatter
- Eliminar formatos Jira/Azure/Linear hardcodeados
- Limpieza de voseo
- Cambiar ejemplos PDR/KOM por placeholders genéricos

### Batch 4 — Skills con dependencias eliminadas (2 archivos)
- `end-session.md` — eliminar Obsidian (VAULT_STATE_FILE)
- `enrich-us.md` — reemplazar "Capa N" + voseo

### Batch 5 — Skills con refactor pendiente (2 archivos)
- `new-app.md` — frontmatter + naming. Refactor mayor para integrar con `.devflow-context/` queda en T0-003.
- `plan-sprint.md` — frontmatter + voseo

### Batch 6 — Customization contract
- Crear `skills/CUSTOMIZATION.md` documentando qué espera cada skill del proyecto:
  - Qué lee de `CLAUDE.md`
  - Qué lee de `.devflow/config.yml`
  - Qué lee de `artifacts/`

---

## Contrato de customización (esbozo)

Las skills leen de tres fuentes:

| Fuente | Qué contiene | Quién la mantiene |
|---|---|---|
| `CLAUDE.md` del proyecto | Stack, paths, convenciones, decisiones técnicas | El equipo del cliente |
| `.devflow/config.yml` | Runtime config: feature-id format, naming, branches | El equipo del cliente |
| `artifacts/` (en el CLI) | Auth profiles, CI/CD templates, fragmentos | Digital-Dev (release del CLI) |

Variables esperadas en `CLAUDE.md` (a documentar en CUSTOMIZATION.md):

```
SPEC_PATH         — ruta de specs maestros (default: docs/specs/)
APPS_PATH         — ruta de apps (default: apps/)
STACK             — stack del proyecto
LEGACY_SYSTEM     — nombre del sistema legacy si aplica
ACCEPTANCE_FORMAT — Gherkin / checklist / tabla (default: Gherkin)
STORY_FORMAT      — formato de HDU
SPRINT_DURATION   — duración del sprint en semanas
TEAM_CAPACITY     — story points por sprint
MAIN_BRANCH       — rama principal (default: main)
DEVFLOW_MODE      — local / platform
DEVFLOW_URL       — URL de la instancia (si platform)
DEVFLOW_PROJECT   — slug del proyecto en la plataforma
```

Variables `PM_TOOL`, `JIRA_PROJECT`, `CI_TOOL`, `CLIENT_NAME`, `VAULT_STATE_FILE` se **eliminan**.

---

## Estado de la auditoría

- [x] Inventario completo (13 skills auditadas)
- [x] Issues catalogados por skill
- [x] Decisiones cerradas
- [x] Plan de estandarización propuesto
- [x] Batch 1: frontmatter opsx/* (2026-06-12)
- [x] Batch 2: skills limpias (2026-06-12)
- [x] Batch 3: skills con PM_TOOL (2026-06-12)
- [x] Batch 4: skills con dependencias eliminadas (2026-06-12)
- [x] Batch 5: skills con refactor pendiente (2026-06-12)
- [x] Batch 6: CUSTOMIZATION.md (2026-06-12)

---

## Notas para T2-006 (bundling)

Antes de bundlear:
1. ✅ Auditoría completa
2. ✅ Aplicar batches 1-6
3. ⏳ Generar `skills.checksums` (parte de T2-006)
4. ⏳ Lint check de frontmatter en build (parte de T2-006)
5. ⏳ Lint check de ausencia de sesgos (parte de T2-006)

---

## Resumen final — T1-002 completado el 2026-06-12

**13 skills estandarizadas** y listas para bundling:

| Skill | Categoría | Origen | Versión |
|---|---|---|---|
| capture-req | Onboarding | Digital-Dev | 0.1.0 |
| design-hdu | Spec | Digital-Dev | 0.1.0 |
| enrich-us | Spec | Digital-Dev | 0.1.0 |
| new-spec | Spec | Digital-Dev | 0.1.0 |
| derive-spec | Spec | Digital-Dev | 0.1.0 |
| new-app | Onboarding | Digital-Dev | 0.1.0 |
| plan-sprint | Workflow | Digital-Dev | 0.1.0 |
| release-check | Quality | Digital-Dev | 0.1.0 |
| end-session | Session | Digital-Dev | 0.1.0 |
| opsx:propose | Workflow | OpenSpec (adaptado) | 0.1.0 |
| opsx:apply | Workflow | OpenSpec (adaptado) | 0.1.0 |
| opsx:archive | Workflow | OpenSpec (adaptado) | 0.1.0 |
| opsx:explore | Workflow | OpenSpec (adaptado) | 0.1.0 |

**Verificaciones pasadas:**
- ✅ 13/13 con frontmatter completo (`origin`, `license`, `managed-by`, `version`)
- ✅ Cero referencias a "método SDD" (solo histórico en este documento)
- ✅ Cero voseo rioplatense
- ✅ Cero `PM_TOOL`, `JIRA_PROJECT`, `CI_TOOL`, `CLIENT_NAME`, `VAULT_STATE_FILE`
- ✅ Cero formatos hardcodeados de Jira / Azure DevOps / Linear
- ✅ Cero terminología "Capa N"
- ✅ Contrato de customización documentado en `CUSTOMIZATION.md`

---

## Extensión T2 — dev_type machinery (2026-06-19)

Extiende la auditoría T1-002 para incorporar:
- Tipología de 5 `dev_type` con ramificación del flujo
- Campo `model` + `model_rationale` + `fallback_model` por skill (per-skill model selection)
- Campo `applies_to_dev_types` que declara compatibilidad
- Campo `enforcement_rules_evaluated` que documenta qué reglas chequea cada skill
- 6 skills nuevas agregadas al bundle (4 bundleadas desde Digital-Dev + 2 totalmente nuevas)
- 13 skills existentes actualizadas con ramificación por dev_type

### Frontmatter extendido — schema v0.2.0

```yaml
---
name: <skill-name>
description: <una línea, max 80 chars>
origin: Digital-Dev | OpenSpec (adaptado por Digital-Dev)
license: proprietary | MIT
managed-by: "@devflow-ia/cli"
version: 0.2.0
category: Workflow | Spec | Session | Quality | Onboarding | Exploration
model: opus | sonnet | haiku                  # ← NUEVO
model_rationale: <por qué este modelo>        # ← NUEVO
fallback_model: opus | sonnet | haiku         # ← NUEVO
applies_to_dev_types: [<lista>]                # ← NUEVO
reads:                                         # ← NUEVO (opcional, hint)
  - <archivos que la skill consume>
writes:                                        # ← NUEVO (opcional, hint)
  - <archivos que la skill produce>
mcp_tools:                                     # ← NUEVO (opcional)
  - <tools MCP que la skill llama>
enforcement_rules_evaluated:                   # ← NUEVO (opcional)
  - <reglas de ENFORCEMENT.md que esta skill evalúa>
---
```

### Catálogo completo — 19 skills bundleadas

#### Skills nativas Digital-Dev (13)

| Skill | Categoría | Modelo | Aplica a dev_type | Versión |
|---|---|---|---|---|
| init-context | Onboarding | (T0-001 diseñado, no implementado) | (consultor) | — |
| capture-req | Onboarding | sonnet | todos | 0.2.0 |
| design-hdu | Spec | opus | todos | 0.2.0 |
| enrich-us | Spec | haiku | todos | 0.2.0 |
| new-spec | Spec | opus | todos (5 modos) | 0.2.0 |
| derive-spec | Spec | sonnet | todos | 0.2.0 |
| new-app | Onboarding | sonnet | **solo greenfield** | 0.2.0 |
| init-repo-context 🆕 | Exploration | opus | brownfield-*/modernizacion/integ. | 0.1.0 |
| explore-repo 🆕 | Exploration | opus | brownfield-*/modernizacion/integ. | 0.1.0 |
| map-service 🆕 | Exploration | sonnet | brownfield-*/modernizacion | 0.1.0 |
| trace-flow 🆕 | Exploration | opus | refactor/modernizacion | 0.1.0 |
| explain-code 🆕 | Exploration | sonnet | brownfield-*/modernizacion | 0.1.0 |
| capture-baseline 🆕 | Quality | opus | **solo brownfield-refactor** | 0.1.0 |
| plan-sprint | Workflow | sonnet | todos | 0.2.0 |
| release-check | Quality | opus | todos (5 modos) | 0.2.0 |
| end-session | Session | haiku | todos | 0.2.0 |

#### Skills adaptadas de OpenSpec (4)

| Skill | Categoría | Modelo | Versión |
|---|---|---|---|
| opsx:propose | Workflow | sonnet | 0.2.0 |
| opsx:apply | Workflow | sonnet | 0.2.0 |
| opsx:archive | Workflow | haiku | 0.2.0 |
| opsx:explore | Workflow | opus | 0.2.0 |

🆕 = skill nueva agregada en este ciclo (creada o bundleada desde Digital-Dev)

### Distribución por modelo

```
Opus (8):     init-repo-context, explore-repo, trace-flow, capture-baseline,
              new-spec, release-check, design-hdu, opsx:explore
Sonnet (8):   capture-req, derive-spec, new-app, map-service, explain-code,
              plan-sprint, opsx:propose, opsx:apply
Haiku (3):    enrich-us, end-session, opsx:archive
```

**Justificación del mix:** ~42% Opus para skills críticas (decisiones arquitectónicas, validación de contratos, análisis profundo). ~42% Sonnet para skills balanceadas (ensamblaje, formateo estructurado). ~16% Haiku para mecánicas (mover archivos, actualizar PROGRESS, formatear). Ahorro estimado de costo vs todo-Opus: ~50%.

### Cambios funcionales aplicados a las 13 skills existentes

| Skill | Cambios v0.2.0 |
|---|---|
| capture-req | Sugerencia de `dev_type` con score + frontmatter del BRIEF.md |
| design-hdu | Confirmación de `dev_type` + campos condicionales (`legacy_system`, `vendor`) |
| enrich-us | Solo frontmatter (model=haiku) |
| new-spec | NO pregunta `dev_type` (lee de session.json) · 5 modos del Grupo B (G/B/R/M/I) · LOCK al guardar |
| derive-spec | Detecta app existente vía REPO-CONTEXT.md · NO scaffolding |
| new-app | **Guard BLOCK_NEW_APP** al inicio — aborta si `dev_type != greenfield` |
| plan-sprint | Capacidad segmentada por `dev_type` + política `capacity_by_dev_type` |
| release-check | Ramificación: refactor valida contratos · modernización valida paridad · integracion valida security |
| end-session | Commit con trailer `DevFlow-Type: <dev_type>` |
| opsx:propose | Refactor exige sección "no functional change" · integracion sugiere anti-corrupción |
| opsx:apply | (sin cambios funcionales, solo frontmatter) |
| opsx:archive | (sin cambios funcionales) |
| opsx:explore | (sin cambios funcionales) |

### Verificaciones pendientes (al bundlear)

- ⏳ Build script valida frontmatter v0.2.0 completo en todas las skills
- ⏳ Lint check: cada `applies_to_dev_types` es subset del enum oficial
- ⏳ Lint check: cada `enforcement_rules_evaluated` existe en `ENFORCEMENT.md`
- ⏳ Smoke test E2E por dev_type (5 escenarios)

**Pendiente fuera de scope de esta extensión:**
- T0-001: skill `/init-context` nueva — onboarding cliente
- T0-003: refactor mayor de `/new-app` para leer `.devflow-context/`
- T2-006: bundling en `@devflow-ia/cli` con `skills.checksums`
- Bundling de `/analyze-repo` y `/setup-local` (acoplados a PDR — NO en MVP)
