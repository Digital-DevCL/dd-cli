---
name: init-repo-context
description: Mapea un repo existente (cualquier stack) y genera .ai/REPO-CONTEXT.md con schema estándar
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.4.0
category: Exploration
model: opus
model_rationale: Interpretar un repo desconocido y producir un reporte schema-correct exige razonamiento profundo (detectar patrones arquitecturales, identificar zonas sensibles, deducir convenciones)
fallback_model: sonnet
applies_to_dev_types: [brownfield-feature, brownfield-refactor, modernizacion, integracion-externa]
supported_stacks: [node, php-laravel, python-django, dotnet, java-spring, go, generic]
reads:
  - "<repo>/**/*  (lectura solamente)"
  - "<repo>/.ai/REPO-CONTEXT.md  (si existe)"
writes:
  - "<repo>/.ai/REPO-CONTEXT.md"
mcp_tools:
  - devflow_save_repo_context  (modo platform — indexa en RAG)
---

# `/init-repo-context` — Mapeo de repo existente (multi-stack)

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

El archivo generado **DEBE** cumplir el schema fijo:
`_Empresa/Productos/DevFlow-IA/schemas/repo-context.schema.md`

**Estructura obligatoria (10 secciones — agnóstica al stack):**
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

---

## Proceso

### Paso 1 — Detección de stack (multi-language)

Detectar el stack PRIMARIO leyendo project files en este orden de prioridad:

| Archivo detectado | Stack | Lenguaje |
|---|---|---|
| `package.json` | node | TypeScript/JavaScript |
| `composer.json` | php-laravel (o php-symfony) | PHP |
| `requirements.txt`, `pyproject.toml`, `setup.py`, `Pipfile`, `manage.py` | python-django (o python-fastapi/flask) | Python |
| `*.csproj`, `*.sln`, `Program.cs` | dotnet | C# |
| `pom.xml`, `build.gradle` | java-spring | Java/Kotlin |
| `go.mod` | go | Go |
| `Gemfile`, `config/application.rb` | ruby-rails | Ruby |
| `Cargo.toml` | rust | Rust |
| Ninguno de los anteriores | generic | Por confirmar |

**Multi-stack en el mismo repo:** si encuentra varios (ej: monorepo con `package.json` Y `composer.json`), preguntar al dev cuál es el FOCO de esta sesión. La skill mapea uno, pero menciona los otros en la sección 3 (arquitectura).

Si NO encuentra ningún archivo de project file en cwd → aborta con mensaje accionable.

---

### Paso 2 — Auto-detección de `app_origin`

```
greenfield-app:
  - git log --reverse --pretty=%aI | head -1 → fecha de primer commit
  - Si fecha es <6 meses Y código fuente tiene <50 archivos → greenfield-app

legacy-app:
  - Si fecha primer commit es >2 años → legacy-app
  - O si código fuente tiene >500 archivos → legacy-app

external-app:
  - Si .gitignore o README dice "vendored" / "third-party" → external-app
  - Sino, default a legacy-app
```

Heurísticas por stack para contar "archivos de código fuente":
- Node: `find src -name "*.ts" -o -name "*.js" | wc -l`
- PHP/Laravel: `find app -name "*.php" | wc -l`
- Python: `find . -name "*.py" -not -path "*/venv/*" | wc -l`
- .NET: `find . -name "*.cs" -not -path "*/bin/*" -not -path "*/obj/*" | wc -l`
- Java: `find src -name "*.java" | wc -l`
- Go: `find . -name "*.go" -not -path "*/vendor/*" | wc -l`

---

### Paso 3 — Análisis específico por stack

Una vez detectado el stack, ejecutar el bloque de análisis correspondiente. Cada bloque busca señales típicas del framework.

#### Stack: `node` (TypeScript/JavaScript)

```bash
# Framework
cat package.json | jq -r '.dependencies | keys | .[]' | grep -E "@nestjs/core|next|express|fastify|@angular/core|react|vue"

# TypeScript config
test -f tsconfig.json && cat tsconfig.json | jq '.compilerOptions.target,.compilerOptions.module'

# Estructura típica
ls src/                          # main.ts, app.module.ts → NestJS
ls src/app/ 2>/dev/null          # → Angular
ls pages/ app/ 2>/dev/null       # → Next.js

# Tests
test -f vitest.config.ts && echo "vitest"
test -f jest.config.js && echo "jest"
```

#### Stack: `php-laravel`

```bash
# Versión y framework
cat composer.json | jq -r '.require | keys | .[]' | grep -E "laravel/framework|symfony/symfony"
cat composer.json | jq -r '.require."php"'

# Estructura típica Laravel
ls app/Http/Controllers/         # Controllers
ls app/Models/                   # Eloquent Models
ls routes/                       # web.php, api.php
ls database/migrations/          # Schema evolution

# Artisan commands disponibles
php artisan list 2>/dev/null | head -20

# Tests
test -d tests/Feature && echo "Laravel feature tests"
test -d tests/Unit && echo "Laravel unit tests"

# Queue, eventos, jobs
ls app/Jobs/ 2>/dev/null
ls app/Events/ 2>/dev/null
ls app/Listeners/ 2>/dev/null

# Config DB
grep "DB_CONNECTION" .env.example 2>/dev/null
grep "DB_CONNECTION" config/database.php
```

#### Stack: `python-django`

```bash
# Framework
cat requirements.txt 2>/dev/null | grep -iE "django|fastapi|flask"
test -f pyproject.toml && grep -E "django|fastapi|flask" pyproject.toml

# Estructura Django
ls */settings.py 2>/dev/null     # Proyecto Django
ls */urls.py 2>/dev/null         # URLs config
find . -name "models.py" -not -path "*/venv/*" | head -10
find . -name "views.py" -not -path "*/venv/*" | head -10

# Tests
test -f manage.py && python manage.py test --help 2>/dev/null | head -3
test -f pytest.ini && echo "pytest configurado"
```

#### Stack: `dotnet`

```bash
# Solution y proyectos
find . -name "*.sln" -maxdepth 2
find . -name "*.csproj" -maxdepth 3 | head -10

# Framework target
grep -h "TargetFramework" $(find . -name "*.csproj" -maxdepth 3) | sort -u

# Estructura típica
ls Controllers/ 2>/dev/null
ls Services/ 2>/dev/null
ls Models/ 2>/dev/null
ls Migrations/ 2>/dev/null

# Tests
find . -name "*.Tests.csproj" -maxdepth 3
```

#### Stack: `java-spring`

```bash
# Pom o gradle
test -f pom.xml && cat pom.xml | grep -E "<spring-boot|<java.version>"
test -f build.gradle && cat build.gradle | grep -E "spring-boot|sourceCompatibility"

# Estructura típica Spring
find src/main/java -type d | head -10
ls src/main/resources/

# Tests
find src/test/java -type d | head -5
```

#### Stack: `go`

```bash
# Versión Go
cat go.mod | head -3

# Estructura típica
ls cmd/ 2>/dev/null              # Binarios
ls internal/ 2>/dev/null         # Código privado
ls pkg/ 2>/dev/null              # Código público

# Tests
find . -name "*_test.go" -not -path "*/vendor/*" | wc -l
```

#### Stack: `generic`

Si no encuentra ningún stack reconocido, preguntar al dev:

```
No detecté un stack conocido automáticamente.
¿Qué stack usa este repo? (Ruby, Elixir, Scala, otro)
¿Dónde está el código fuente?
¿Cómo se ejecutan los tests?
¿Cómo se hace el build?
```

Generar el REPO-CONTEXT.md con los datos provistos manualmente.

---

### Paso 4 — Detección de CI/CD y deploy

Independiente del stack:

```bash
test -f .gitlab-ci.yml && echo "GitLab CI"
test -d .github/workflows && ls .github/workflows/
test -f azure-pipelines.yml && echo "Azure Pipelines"
test -f Jenkinsfile && echo "Jenkins"

# Containerización
test -f Dockerfile && cat Dockerfile | head -5
test -f docker-compose.yml && cat docker-compose.yml | grep -E "^services:" -A 20 | head -30

# Kubernetes
ls k8s/ 2>/dev/null
ls helm/ 2>/dev/null
ls deploy/ 2>/dev/null
```

---

### Paso 5 — Entrevista breve (solo lo no detectable)

Solo preguntar lo que NO se pudo deducir:
- Equipo dueño (si no hay CODEOWNERS)
- Propósito del sistema (si README es vago)
- Zonas sensibles que el dev sabe pero no están documentadas
- Confirmación del `app_origin` detectado
- Confirmación del stack detectado si hubo ambigüedad

---

### Paso 6 — Generación atómica

Generar todas las 10 secciones de una vez. Para cada sección:
- Si tiene data detectada → llenar
- Si no aplica al tipo de app → marcar `_No aplica a este tipo de app._`
- Si no se pudo detectar pero podría aplicar → marcar `[no detectado]` y bajar `confidence`

---

### Paso 7 — Validación schema

Antes de escribir:
- Verificar que frontmatter tiene todos los campos requeridos
- Verificar que están las 10 secciones con headings exactos
- Verificar que `confidence ∈ [0, 1]`

Si falla validación → mostrar diff y abortar (no escribir parcial).

---

### Paso 8 — Escritura + persistencia

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

---

## Modo `--on=<path>` (modernización)

Cuando se invoca con `--on=<legacy-path>`:
- Cambia cwd a `<legacy-path>` para análisis
- Output va a `.ai/REPO-CONTEXT-legacy.md` (no sobrescribe el del target)
- Frontmatter marca `app_origin: legacy-app` automáticamente
- Sección 10 (deuda técnica) recibe énfasis especial — qué se reemplaza
- El stack puede ser **diferente** al stack del target (ej: legacy PHP → target NestJS)

---

## Reglas duras

1. **Read-only sobre el codebase** — nunca modifica código del repo, solo `.ai/`
2. **Idempotente** — `last_scanned` ≤30 días + sin `--refresh` → exit 0 sin trabajo
3. **Determinista** — dos ejecuciones sobre el mismo HEAD producen el mismo output (excepto `last_scanned`)
4. **Falla a `confidence` bajo antes que a "no sé"** — siempre produce archivo válido, marca [no detectado] cuando falte
5. **Nunca inventa** — secciones que no aplican: `_No aplica._`
6. **Stack-agnóstico en el schema, stack-específico en la detección** — el output sigue el mismo formato sin importar el lenguaje

---

## Outputs esperados al usuario

### Ejemplo Laravel (IPRSA)

```
✓ Repo analizado: iprsa-portal-clientes
  Stack:       php-laravel  (Laravel 10, PHP 8.2)
  app_origin:  legacy-app
  confidence:  0.85
  last_scanned: 2026-06-23T10:30:00Z

Sección por sección:
  ✓ 1. Identidad
  ✓ 2. Stack técnico (PHP 8.2 + Laravel 10 + Eloquent + PostgreSQL)
  ✓ 3. Arquitectura interna (MVC + Service Pattern detectado)
  ✓ 4. Entry points (routes/web.php + routes/api.php — 47 endpoints)
  ✓ 5. Datos (PostgreSQL + Redis cache + migrations completas)
  ✓ 6. Integraciones externas (3: SendGrid, AWS S3, gateway-pagos)
  ⚠ 7. Convenciones del repo (PSR-12 detectado, pero hay inconsistencias)
  ✓ 8. Dependencias clave (24 prod, 8 dev)
  ✓ 9. Build, run, deploy (artisan + Dockerfile + GitLab CI)
  ⚠ 10. Deuda técnica (2 controllers de >500 LOC, queue jobs sin tests)

Archivo: .ai/REPO-CONTEXT.md
Siguiente paso sugerido: /new-spec (modo brownfield-feature)
```

### Ejemplo Node (NestJS)

```
✓ Repo analizado: app-bff-cuentas
  Stack:       node  (NestJS 11 + TypeORM + PostgreSQL)
  app_origin:  legacy-app
  confidence:  0.87

  [secciones 1-10 ...]
```

---

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
- Validación de schema (las 10 secciones + frontmatter)
- Output válido para downstream skills (`/new-spec`, `/derive-spec`, `/map-service`)
