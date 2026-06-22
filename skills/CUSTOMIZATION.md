# Contrato de customización — Skills DevFlow IA

**Fecha:** 2026-06-19 (extendido para dev_type machinery)
**Versión:** 0.2.0

> Las skills DevFlow IA son **cerradas** — bundleadas con `@devflow-ia/cli`, gestionadas por Digital-Dev, no se modifican por proyecto.
> Este documento define **cómo se parametrizan** sin ser modificadas.

---

## Las tres fuentes de customización

```
┌─────────────────────────────────────────────────────────────────┐
│  CLAUDE.md del proyecto                                         │
│  → stack, paths, convenciones, decisiones técnicas              │
│  → mantenido por el equipo del cliente                          │
├─────────────────────────────────────────────────────────────────┤
│  .devflow/config.yml del proyecto                               │
│  → runtime config: feature-id format, naming, branches          │
│  → mantenido por el equipo del cliente                          │
├─────────────────────────────────────────────────────────────────┤
│  artifacts/ (en el CLI bundleado)                               │
│  → auth profiles, CI/CD templates, claude-fragments             │
│  → mantenido por Digital-Dev (release del CLI)                  │
└─────────────────────────────────────────────────────────────────┘
```

Cualquier customización debe encajar en una de estas tres capas. Si no encaja, es señal
de que falta una versión más capaz de la skill — y eso lo construye Digital-Dev.

---

## Variables esperadas en `CLAUDE.md`

```
SPEC_PATH         — ruta de specs maestros (default: docs/specs/)
APPS_PATH         — ruta de apps (default: apps/)
STACK             — descripción del stack tecnológico
BACKEND_FRAMEWORK — NestJS / Laravel / Django / Spring / .NET / ...
FRONTEND_FRAMEWORK — Angular / React / Next.js / Vue / ...
INFRA             — K8s / Docker / serverless / bare-metal
DB                — PostgreSQL / MySQL / Oracle / MongoDB
LEGACY_SYSTEM     — nombre del sistema legacy (opcional, solo brownfield)
ACCEPTANCE_FORMAT — Gherkin (default) / checklist / tabla
STORY_FORMAT      — "Como/Quiero/Para" (default) / Jobs-to-be-done
SPRINT_DURATION   — duración del sprint en semanas (default: 2)
TEAM_CAPACITY     — story points por sprint (default: preguntar)
SPRINT_NUMBER     — número del sprint actual (default: 1)
CEREMONY_FORMAT   — formato de ceremonias (default: Discovery + Sprint Review)
MAIN_BRANCH       — rama principal (default: main)
DEVFLOW_MODE      — local / platform
DEVFLOW_URL       — URL de la instancia (solo si platform)
DEVFLOW_PROJECT   — slug del proyecto en la plataforma (solo si platform)
```

### Variables eliminadas (NO usar en CLAUDE.md)

| Variable | Razón |
|---|---|
| `PM_TOOL` | DevFlow IA es el PM — no se conecta a herramientas externas en el flujo core |
| `JIRA_PROJECT` | Idem |
| `CI_TOOL` | El CI/CD se selecciona vía `cicd-profile` en `.devflow-context/` |
| `CLIENT_NAME` | No necesario — el proyecto en sí ya identifica al cliente |
| `VAULT_STATE_FILE` | Obsidian fuera de scope del producto |

---

## Mapeo skill → variables que lee

| Skill | Variables CLAUDE.md | session.json | Otros archivos |
|---|---|---|---|
| `capture-req` | `LEGACY_SYSTEM` | — | escribe BRIEF con sugerencia dev_type |
| `design-hdu` | `ACCEPTANCE_FORMAT`, `STORY_FORMAT` | — | lee BRIEF, escribe HDU con dev_type confirmado |
| `enrich-us` | `ACCEPTANCE_FORMAT`, `SPEC_PATH`, `STACK` | — | — |
| `new-spec` | `SPEC_PATH`, `APPS_PATH`, `LEGACY_SYSTEM`, `STACK` | **`dev_type`, `apps_affected`, `legacy_system`, `vendor`, `dev_type_rationale`** | `.ai/REPO-CONTEXT.md`, `.ai/BASELINE-*.md` |
| `derive-spec` | `SPEC_PATH`, `APPS_PATH`, `STACK` | `dev_type`, `apps_affected` | `.ai/REPO-CONTEXT.md` |
| `new-app` | `STACK`, `APPS_PATH`, `SPEC_PATH`, `BACKEND_FRAMEWORK`, `FRONTEND_FRAMEWORK`, `INFRA`, `DB` | **`dev_type` (guard BLOCK_NEW_APP)** | `.devflow-context/` |
| `plan-sprint` | `SPRINT_DURATION`, `TEAM_CAPACITY`, `SPRINT_NUMBER`, `CEREMONY_FORMAT` | — | HDUs con frontmatter `dev_type` |
| `release-check` | `SPEC_PATH`, `APPS_PATH`, `MAIN_BRANCH` | **`dev_type`** | `.ai/BASELINE-*.md` (si refactor) |
| `end-session` | `APPS_PATH`, `SPEC_PATH` | **`dev_type` (commit trailer)** | — |
| `init-repo-context` 🆕 | `STACK`, `APPS_PATH` | `dev_type`, `feature_id` | escribe `.ai/REPO-CONTEXT.md` |
| `explore-repo` 🆕 | `STACK`, `APPS_PATH` | — | output a stdout o `.ai/exploration-*.md` |
| `map-service` 🆕 | — | — | `.ai/REPO-CONTEXT.md` |
| `trace-flow` 🆕 | — | — | `.ai/REPO-CONTEXT.md`; escribe `.ai/flows/*.md` y `.drawio` |
| `explain-code` 🆕 | — | — | `.ai/REPO-CONTEXT.md` |
| `capture-baseline` 🆕 | `STACK`, `BACKEND_FRAMEWORK`, `FRONTEND_FRAMEWORK` | **`dev_type` (debe ser brownfield-refactor)**, `feature_id`, `apps_affected` | escribe `.ai/BASELINE-*.md`, `.ai/golden/*` |
| `opsx:*` | — | `dev_type` (refactor → "no functional change"; integracion → anti-corrupción) | `openspec/changes/` |

🆕 = skill nueva agregada en T2 (2026-06-19)

---

## Estructura de `.devflow/config.yml`

Archivo runtime mantenido por dd-cli y leído por las skills.

```yaml
# .devflow/config.yml — runtime config del proyecto
project:
  slug: pdr-portal              # identificador del proyecto
  type: brownfield               # greenfield / brownfield / modernizacion

naming:
  feature_id_pattern: "HDU-{n}"  # patrón de IDs de feature
  branch_pattern: "feature/{feature_id}-{slug}"
  spec_filename: "SPEC-{slug}.md"
  epic_filename: "EPIC-{slug}.md"

defaults:
  acceptance_format: gherkin     # gherkin / checklist / tabla
  story_format: como-quiero-para
  sprint_duration_weeks: 2

devflow:
  mode: local                    # local / platform
  url: null                      # solo si mode: platform
  project: null                  # solo si mode: platform
```

Skills que leen de `.devflow/config.yml`:
- `dd-cli watch` → modo, project slug
- Todas las skills de spec → naming patterns
- `capture-req` → epic_filename
- `design-hdu` → feature_id_pattern, acceptance_format

---

## Artefactos referenciados desde el CLI bundleado

Las skills NO contienen plantillas — las **referencian** desde `artifacts/` del CLI.

```
@devflow-ia/cli/artifacts/
├── auth-profiles/
│   ├── portal-embedded.md       ← apps embebidas en un portal con auth heredado
│   ├── oauth2-oidc.md           ← OAuth2 / OIDC estándar
│   ├── custom-jwt.md            ← JWT propio
│   ├── api-key-internal.md      ← API key para servicios internos
│   └── none-public.md           ← apps públicas sin auth
│
├── cicd-templates/
│   ├── gitlab-ci/
│   │   ├── nodejs-k8s.yml       ← happy path NestJS/Angular + K8s
│   │   ├── java-k8s.yml
│   │   ├── python-k8s.yml
│   │   └── static-nginx.yml
│   ├── github-actions/
│   └── azure-devops/
│
├── docker/
│   ├── nestjs.Dockerfile
│   ├── angular-nginx.Dockerfile
│   ├── springboot.Dockerfile
│   └── fastapi.Dockerfile
│
├── k8s/
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   └── configmap.yaml
│
└── claude-fragments/
    ├── auth-portal-embedded.md
    ├── auth-oauth2.md
    ├── oracle-patterns.md
    └── angular-mfe-shell.md
```

Skills que ensamblan desde artefactos:
- `new-app` (post-T0-003) — ensambla auth-profile + cicd-template + docker + claude-fragments
- `init-context` (T0-001, futuro) — guía la selección de artefactos por cliente

---

## Estructura de `.devflow-context/` del cliente

Por cliente (no por proyecto), generado por `/init-context`:

```
<repo-cliente>/.devflow-context/
├── app-catalog.md               ← inventario de todas las apps del cliente
├── client-assessment.md         ← gaps de CI/CD e infra detectados
├── auth-profiles/
│   └── <perfil-en-uso>.md       ← copia del artifact seleccionado
└── cicd-profiles/
    └── <perfil-en-uso>.yml      ← variante consultiva del template happy-path
```

Skills que leen de `.devflow-context/`:
- `new-app` (post-T0-003)
- `init-context`

---

## CLAUDE.md mínimo de proyecto

Ejemplo de bloque mínimo en CLAUDE.md de un proyecto que adopta DevFlow IA:

```markdown
## DevFlow IA — Configuración

DEVFLOW_MODE: local
DEVFLOW_URL:  null
DEVFLOW_PROJECT: null

## Configuración del proyecto

SPEC_PATH: docs/specs/
APPS_PATH: apps/
STACK: NestJS 11 + Angular 21 + PostgreSQL + K8s
BACKEND_FRAMEWORK: NestJS
FRONTEND_FRAMEWORK: Angular
INFRA: K8s
DB: PostgreSQL
ACCEPTANCE_FORMAT: gherkin
STORY_FORMAT: como-quiero-para
MAIN_BRANCH: main
SPRINT_DURATION: 2
TEAM_CAPACITY: 30
```

---

## Para proponer cambios al contrato

Si una skill necesita una variable nueva o una capa de customización no contemplada:

1. **No modificar la skill** — eso rompería el modelo cerrado
2. Abrir issue en el repo del CLI describiendo el caso de uso
3. Digital-Dev evalúa y decide si:
   - Agregar la variable al contrato (próxima versión menor del CLI)
   - Crear un nuevo artefacto composable
   - Refactorizar la skill (próxima versión mayor)
4. La mejora viaja a todos los clientes con el próximo `npm update -g @devflow-ia/cli`

---

## Frontmatter v0.2.0 — campos extendidos

Cada skill declara metadata adicional usada por el CLI para optimizar ejecución
y enforcement:

```yaml
---
name: <skill-name>
description: <una línea>
origin: Digital-Dev | OpenSpec (adaptado por Digital-Dev)
license: proprietary | MIT
managed-by: "@devflow-ia/cli"
version: 0.2.0
category: Workflow | Spec | Session | Quality | Onboarding | Exploration

# ── Modelo de Claude recomendado ────────────────────────────────────
model: opus | sonnet | haiku
model_rationale: <por qué este modelo es el correcto>
fallback_model: opus | sonnet | haiku   # si el preferido no está disponible

# ── Compatibilidad con dev_type ─────────────────────────────────────
applies_to_dev_types: [greenfield, brownfield-feature, brownfield-refactor,
                       modernizacion, integracion-externa]

# ── Documentación de I/O ────────────────────────────────────────────
reads:
  - <archivos/fuentes que la skill lee>
writes:
  - <archivos que la skill escribe>
mcp_tools:
  - <MCP tools que la skill invoca>

# ── Enforcement ─────────────────────────────────────────────────────
enforcement_rules_evaluated:
  - <IDs de reglas en ENFORCEMENT.md que esta skill chequea>
---
```

### Uso del campo `model`

- **Hint, no enforce**: el dev puede ignorarlo. Si está en cuenta Pro sin Opus,
  el `fallback_model` se respeta.
- **`dd-cli watch`** muestra en línea 3 si el modelo activo no matchea con el
  recomendado de la próxima skill esperada.
- **`dd-cli status`** sugiere `/model <recomendado>` cuando aplica.
- **Subagents**: cuando una skill llama a otra vía Task tool, el CLI inyecta
  el `model` declarado de la subskill.

### Distribución actual

```
Opus (8):     skills críticas — decisiones arquitectónicas, análisis profundo
Sonnet (8):   skills balanceadas — ensamblaje, formateo estructurado
Haiku (3):    skills mecánicas — mover archivos, formatear output
```

Ver `AUDIT.md` extensión T2 para distribución completa por skill.

---

## Archivos `.ai/` — propósito y mantenimiento

Las skills leen y escriben archivos en `.ai/` del repo del cliente. Cada uno
tiene un propósito específico y un schema:

| Archivo | Generado por | Schema | Aplica a dev_type |
|---|---|---|---|
| `.ai/SPEC.md` | `/new-spec`, `/derive-spec` | propio (template del proyecto) | todos |
| `.ai/CONTEXT.md` | `/derive-spec`, `/init-context` | propio | todos |
| `.ai/PROGRESS.md` | `/opsx:apply`, `/end-session` | propio | todos |
| `.ai/REPO-CONTEXT.md` 🆕 | `/init-repo-context`, `/explore-repo` | [repo-context.schema.md](../../_Empresa/Productos/DevFlow-IA/schemas/repo-context.schema.md) | brownfield-*/modernizacion/integ |
| `.ai/BASELINE-<modulo>.md` 🆕 | `/capture-baseline` | [baseline.schema.md](../../_Empresa/Productos/DevFlow-IA/schemas/baseline.schema.md) | brownfield-refactor |
| `.ai/golden/<modulo>/` 🆕 | `/capture-baseline` | snapshots input/output | brownfield-refactor |
| `.ai/flows/<dominio>.md` 🆕 | `/trace-flow` | propio (multi-pane) | refactor/modernizacion |
| `.ai/flows/<dominio>.drawio` 🆕 | `/trace-flow` | drawio v15+ | refactor/modernizacion |
| `.ai/diagrams/<modulo>.md` 🆕 | `/map-service` (con `--save`) | Mermaid | brownfield-*/modernizacion |

**Versionado en git:** TODOS estos archivos se versionan. Son parte del contexto
del proyecto y deben viajar con el código. `.gitignore` NO debe incluirlos.

---

## Versión y compatibilidad

Este contrato es versionado junto con el CLI:

- **v0.1.0** (2026-06-12): T1-002 — frontmatter estándar básico
- **v0.2.0** (2026-06-19): T2 — dev_type machinery + model selection + nuevos archivos `.ai/`
- **v1.0.0** (futuro): contrato estable — breaking changes solo en major

Cada skill declara la versión del contrato que cumple en su frontmatter (`version`).

**Compatibilidad:**
- Skills `0.1.0` siguen funcionando — el CLI les inyecta defaults: `model=sonnet`, `applies_to_dev_types=[*]`
- Skills `0.2.0` requieren CLI ≥ `0.2.0`
- El campo `version` de la skill se valida en `dd-cli skills verify`
