---
name: init-repo-context
description: Mapea un repo existente y genera .ai/REPO-CONTEXT.md con schema estándar
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.1.0
category: Exploration
model: opus
model_rationale: Interpretar un repo desconocido y producir un reporte schema-correct exige razonamiento profundo (detectar patrones arquitecturales, identificar zonas sensibles, deducir convenciones)
fallback_model: sonnet
applies_to_dev_types: [brownfield-feature, brownfield-refactor, modernizacion, integracion-externa]
reads:
  - "<repo>/**/*  (lectura solamente)"
  - "<repo>/.ai/REPO-CONTEXT.md  (si existe)"
writes:
  - "<repo>/.ai/REPO-CONTEXT.md"
mcp_tools:
  - devflow_save_repo_context  (modo platform — indexa en RAG)
---

# `/init-repo-context` — Mapeo de repo existente

## Cuándo usarla

**Precondición de `/new-spec`** cuando `dev_type ∈ {brownfield-feature, brownfield-refactor, modernizacion, integracion-externa}` (si toca app existente).

Sin un REPO-CONTEXT.md actualizado, `/new-spec` aborta. La skill es **idempotente**: si el archivo existe y `last_scanned` es ≤30 días, **no regenera** salvo `--refresh`.

## Cuándo NO usarla

- `dev_type == greenfield` — no hay repo todavía
- El repo ya tiene un `.ai/REPO-CONTEXT.md` reciente y no se solicita refresh

## Flags

```bash
/init-repo-context                            # Modo normal — cwd, idempotente
/init-repo-context --refresh                  # Fuerza regeneración aunque exista
/init-repo-context --on=<path>                # Analiza otro path (modernización con legacy)
/init-repo-context --confidence-target=0.8    # Pide más profundidad
/init-repo-context --quick                    # Pasa rápido (confidence ~0.5)
```

## Contrato del output

El archivo generado **DEBE** cumplir el schema fijo definido en:
`_Empresa/Productos/DevFlow-IA/schemas/repo-context.schema.md`

**Estructura obligatoria (10 secciones):**
1. Identidad
2. Stack técnico
3. Arquitectura interna
4. Entry points
5. Datos
6. Integraciones externas
7. Convenciones del repo
8. Dependencias clave
9. Build, run, deploy
10. Deuda técnica y zonas sensibles

Frontmatter YAML obligatorio: `schema_version`, `generated_by`, `last_scanned`, `repo_root`, `repo_name`, `primary_language`, `runtime`, `framework`, `app_origin`, `confidence`.

## Proceso

### Paso 1 — Detección de contexto

Lee del repo:
- `package.json` / `pom.xml` / `requirements.txt` / `go.mod` / `Cargo.toml`
- `.nvmrc`, `Dockerfile`, `docker-compose.yml`
- `.gitlab-ci.yml`, `.github/workflows/*.yml`, `azure-pipelines.yml`
- `tsconfig.json`, `angular.json`, `nest-cli.json`
- `README.md` raíz
- Estructura de `src/` (3 niveles de profundidad)

Si NO encuentra ningún archivo de project file en cwd → aborta con mensaje accionable.

### Paso 2 — Auto-detección de `app_origin`

```
greenfield-app:
  - git log --reverse --pretty=%aI | head -1 → fecha de primer commit
  - Si fecha es <6 meses Y src/ tiene <50 archivos → greenfield-app

legacy-app:
  - Si fecha primer commit es >2 años → legacy-app
  - O si src/ tiene >500 archivos → legacy-app

external-app:
  - Si .gitignore o README dice "vendored" / "third-party" → external-app
  - Sino, default a legacy-app
```

### Paso 3 — Entrevista breve (solo lo no detectable)

Solo preguntar lo que NO se pudo deducir:
- Equipo dueño (si no hay CODEOWNERS)
- Propósito del sistema (si README es vago)
- Zonas sensibles que el dev sabe pero no están documentadas
- Confirmación del `app_origin` detectado

### Paso 4 — Generación atómica

Generar todas las 10 secciones de una vez. Para cada sección:
- Si tiene data detectada → llenar
- Si no aplica al tipo de app → marcar `_No aplica a este tipo de app._`
- Si no se pudo detectar pero podría aplicar → marcar `[no detectado]` y bajar `confidence`

### Paso 5 — Validación schema

Antes de escribir:
- Verificar que frontmatter tiene todos los campos requeridos
- Verificar que están las 10 secciones con headings exactos
- Verificar que `confidence ∈ [0, 1]`

Si falla validación → mostrar diff y abortar (no escribir parcial).

### Paso 6 — Escritura + persistencia

```
1. Escribir <repo>/.ai/REPO-CONTEXT.md (crear .ai/ si no existe)
2. Actualizar .gitignore para versionar el archivo (NO ignorarlo)
3. Si modo platform:
   → devflow_save_repo_context({ repo_context_md, repo_root, schema_version: 1 })
4. Si modo local:
   → solo escritura local
5. Actualizar session.json:
   - repo_context_path = ".ai/REPO-CONTEXT.md"
   - flow_state recalculado por heartbeat → repo_mapped
```

## Modo `--on=<path>` (modernización)

Cuando se invoca con `--on=<legacy-path>`:
- Cambia cwd a `<legacy-path>` para análisis
- Output va a `.ai/REPO-CONTEXT-legacy.md` (no sobrescribe el del target)
- Frontmatter marca `app_origin: legacy-app` automáticamente
- Sección 10 (deuda técnica) recibe énfasis especial — qué se reemplaza

## Reglas duras

1. **Read-only sobre el codebase** — nunca modifica código del repo, solo `.ai/`
2. **Idempotente** — `last_scanned` ≤30 días + sin `--refresh` → exit 0 sin trabajo
3. **Determinista** — dos ejecuciones sobre el mismo HEAD producen el mismo output (excepto `last_scanned`)
4. **Falla a `confidence` bajo antes que a "no sé"** — siempre produce archivo válido, marca [no detectado] cuando falte
5. **Nunca inventa** — secciones que no aplican: `_No aplica._`

## Outputs esperados al usuario

```
✓ Repo analizado: app-bff-cuentas
  app_origin: legacy-app  ·  confidence: 0.87
  schema_version: 1  ·  last_scanned: 2026-06-19T14:30:00Z

Sección por sección:
  ✓ 1. Identidad
  ✓ 2. Stack técnico (TypeScript + NestJS 11 + TypeORM)
  ✓ 3. Arquitectura interna (DDD ligero detectado)
  ⚠ 4. Entry points (3 endpoints detectados, posiblemente más sin documentar)
  ✓ 5. Datos (Oracle + PostgreSQL)
  ✓ 6. Integraciones externas (4)
  ✓ 7. Convenciones del repo
  ✓ 8. Dependencias clave (47 prod, 23 dev)
  ✓ 9. Build, run, deploy
  ✓ 10. Deuda técnica (3 zonas sensibles)

Archivo: .ai/REPO-CONTEXT.md
Siguiente paso sugerido: /new-spec (modo brownfield-feature)
```

## Variables que lee de CLAUDE.md

| Variable | Uso |
|---|---|
| `STACK` | Comparar con detección automática |
| `APPS_PATH` | Identificar el scope a analizar si es monorepo |

## Variables que lee de session.json

| Campo | Uso |
|---|---|
| `dev_type` | Decide nivel de detalle (modernización = profundidad máxima) |
| `apps_affected` | Si está definido, foco en esas apps |

## Tests aceptados al ejecutar

Esta skill no escribe tests, pero su output debe pasar:
- `dd-cli validate-schema .ai/REPO-CONTEXT.md --schema=repo-context-v1`
- Output válido para downstream skills (`/new-spec`, `/derive-spec`, `/map-service`)
