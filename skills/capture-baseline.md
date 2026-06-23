---
name: capture-baseline
description: Captura tests, métricas y contratos del módulo objetivo antes de refactor (genera .ai/BASELINE.md). Multi-stack.
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.4.0
category: Quality
model: opus
model_rationale: Decidir qué contratos preservar, capturar golden tests representativos y evaluar risk_level es razonamiento de alta consecuencia (si falla, el refactor rompe en prod)
fallback_model: sonnet
applies_to_dev_types: [brownfield-refactor]
supported_stacks: [node, php-laravel, python-django, dotnet, java-spring, go, generic]
reads:
  - "<repo>/<target_module>/**/*"
  - "<repo>/.ai/REPO-CONTEXT.md"
  - "<repo>/tests/**/*  (config + archivos de test según stack)"
writes:
  - "<repo>/.ai/BASELINE-<modulo>.md"
  - "<repo>/.ai/golden/<modulo>/  (snapshots opcionales)"
mcp_tools:
  - devflow_save_baseline  (modo platform — enlaza a HDU)
---

# `/capture-baseline` — Snapshot pre-refactor (multi-stack)

## Cuándo usarla

**Precondición bloqueante de `/new-spec(R)`** cuando `dev_type == brownfield-refactor`.

Sin BASELINE.md, el "no-regresión" es retórica. La skill produce el contrato firmado
contra el que `/release-check(R)` valida después.

## Cuándo NO usarla

- `dev_type ≠ brownfield-refactor` — no aplica
- Ya existe `.ai/BASELINE-<modulo>.md` con `locked_at != null` — para re-capturar requiere `--re-capture --reason="..."`

## Flags

```bash
/capture-baseline <modulo>                    # Modo normal — captura para módulo
/capture-baseline <modulo> --record-mode      # Graba inputs/outputs runtime para golden tests
/capture-baseline <modulo> --re-capture --reason="<razón>"  # Re-captura (audit-log)
/capture-baseline <modulo> --skip-perf        # Salta sección métricas (sin observability)
```

## Contrato del output

El archivo generado **DEBE** cumplir el schema fijo (8 secciones obligatorias):

1. Identidad del refactor
2. Tests existentes
3. Contratos públicos a preservar
4. Métricas de performance baseline
5. Dependencias del módulo (in/out)
6. Estado de calidad pre-refactor
7. Comportamiento observable (golden tests)
8. Decisiones y advertencias del dev

Frontmatter YAML: `schema_version`, `generated_by`, `captured_at`, `target_module`,
`target_files`, `risk_level`, `tests_count`, `coverage_baseline`, `contracts_count`,
`locked_by`, `locked_at` (null hasta Gate G1.5).

---

## Proceso

### Paso 1 — Identificación del módulo

Si se pasa `<modulo>` como arg → usa ese path. Si no → entrevista:

```
¿Qué módulo vas a refactorizar?
  1) Path al directorio o archivo principal
  2) Slug del módulo
```

Lee el path, lista archivos en scope (mostrar al dev para confirmar), y lee `.ai/REPO-CONTEXT.md` para entender capas, convenciones y el stack detectado en el análisis previo.

---

### Paso 2 — Detección del stack y test runner

Leer `primary_language` y `framework` del `.ai/REPO-CONTEXT.md` si existe. Si no, detectar:

```bash
test -f package.json && echo "node"
test -f composer.json && echo "php"
test -f manage.py -o -f requirements.txt && echo "python"
find . -name "*.csproj" -maxdepth 3 | head -1 && echo "dotnet"
test -f pom.xml -o -f build.gradle && echo "java"
test -f go.mod && echo "go"
```

#### Comandos de test por stack

**Node (Jest / Vitest):**
```bash
# Detectar runner
grep -E '"test"' package.json | head -1
test -f vitest.config.ts && echo "vitest"
test -f jest.config.js -o -f jest.config.ts && echo "jest"

# Contar tests en el módulo
grep -rE "(it|test|describe)\(" <target_module> --include="*.spec.*" --include="*.test.*" | wc -l

# Coverage del módulo (si está configurado)
# jest: npx jest --coverage --collectCoverageFrom="<target>/**" --testPathPattern="<target>"
# vitest: npx vitest run --coverage <target>
```

**PHP / Laravel (PHPUnit / Pest):**
```bash
# Detectar runner
test -f phpunit.xml -o -f phpunit.xml.dist && echo "phpunit"
test -f ./vendor/bin/pest && echo "pest"

# Contar tests
find tests/ -name "*.php" | xargs grep -l "function test_\|#\[Test\]\|@test" | wc -l
grep -rE "public function test_|#\[Test\]|@test" tests/ --include="*.php" | wc -l

# Correr tests del módulo (NO correr — solo identificar)
# phpunit --filter=<NombreTest>
# ./vendor/bin/pest --filter="<patrón>"
```

**Python (pytest / unittest):**
```bash
# Detectar runner
test -f pytest.ini -o -f pyproject.toml && grep -q pytest pytest.ini pyproject.toml 2>/dev/null && echo "pytest"
grep -rE "class Test|def test_" tests/ --include="*.py" | wc -l

# Coverage
# pytest --cov=<módulo> --cov-report=term
```

**.NET (xUnit / NUnit / MSTest):**
```bash
# Detectar proyectos de test
find . -name "*.Tests.csproj" -o -name "*.Test.csproj" | head -5
grep -rE "\[Fact\]|\[Test\]|\[Theory\]" --include="*.cs" | wc -l

# Correr (NO correr — identificar)
# dotnet test --filter "FullyQualifiedName~<Namespace>"
```

**Java / Spring (JUnit):**
```bash
# Detectar tests
find src/test -name "*Test.java" | wc -l
grep -rE "@Test|@ParameterizedTest" src/test/ --include="*.java" | wc -l

# Cobertura con Jacoco
# mvn test -pl <módulo>
```

**Go:**
```bash
# Tests en Go
find <target_module> -name "*_test.go" | wc -l
grep -c "^func Test" <target_module>/*_test.go 2>/dev/null

# Coverage
# go test -coverprofile=coverage.out ./<target_module>/...
```

Si `tests_count == 0`:
- Marca `risk_level: high`
- Mostrar warning explícito
- Sección 7 (golden tests) se vuelve OBLIGATORIA (mínimo 3 capturas)

---

### Paso 3 — Contratos públicos (CRÍTICO)

Identifica qué expone el módulo al exterior. Los patrones varían por stack:

**Endpoints HTTP:**
```
Node/NestJS:  decoradores @Controller, @Get, @Post, etc.
PHP/Laravel:  routes/web.php y routes/api.php que apunten al módulo
Python:       urls.py, @app.route / @router.get (FastAPI)
.NET:         [ApiController], [Route], [HttpGet/Post/...]
Java/Spring:  @RestController, @RequestMapping, @GetMapping, etc.
Go:           http.HandleFunc, router.GET/POST, etc.
```

Para cada ruta: request schema, response schema, headers requeridos, auth middleware.

**Funciones / clases exportadas:**
- Rastrear exports públicos del módulo y dónde se consumen en el resto del repo

**Eventos publicados** (queue, mensajería):
- Detectar patrones de eventos según el framework (EventEmitter, queue jobs, etc.)

**Schema DB:**
- Tablas que el módulo LEE y/o ESCRIBE
- Columnas que afectan el contrato externo

**Preguntar al dev** lo que no se detecta automáticamente:
```
¿Hay contratos públicos NO detectados que quieres agregar?
(webhooks, cron jobs, eventos de dominio, integraciones implícitas)
```

---

### Paso 4 — Métricas de performance

Si `--skip-perf` → marca sección como "No disponible".
Si no:
- Buscar dashboards (Grafana, NewRelic, Datadog) referenciados en repo
- Preguntar al dev por latencia P50/P95/P99 conocida
- Preguntar throughput nominal y tasa de error

Si nada disponible → marcar "No disponible" + warning de que `/release-check(R)` no podrá validar mejora cuantitativa.

---

### Paso 5 — Dependencias in/out

**Out** (de qué depende el módulo):
```
Node:   grep -E "import.*from" <target_files>
PHP:    grep -E "use " <target_files> | grep -v "// "
Python: grep -E "^import |^from " <target_files>
.NET:   grep -E "^using " <target_files>
Java:   grep -E "^import " <target_files>
Go:     grep -E '"' <target_files>.go | grep import
```

**In** (qué depende del módulo): grep inverso buscando imports del módulo en el resto del repo.

---

### Paso 6 — Estado de calidad pre-refactor

```
LoC:               wc -l <target_files> (por stack)
Cyclomatic:        herramienta según stack (eslint-plugin-complexity, radon cc, cognitivecomplexity)
Lint count:        runner según stack (eslint, phpcs, flake8, dotnet-format, checkstyle)
Type safety:       any/@ts-ignore (Node), type hints (Python), etc.
Smell detectados:  métodos >50 LOC, clases >500 LOC, duplicación obvia
```

---

### Paso 7 — Golden tests (obligatorio si `tests_count < 5`)

```
Modo standard (con tests existentes):
  Capturar 2-3 inputs/outputs reales de los tests más representativos

Modo --record-mode (sin tests / pocos):
  Instrumentar el código temporalmente para grabar I/O en runtime
  Correr en QA por X horas
  Capturar al menos 3 casos distintos (happy, edge, error)
  Guardar en .ai/golden/<modulo>/case-NN.{input,output}
```

Si `tests_count < 5` y golden_count < 3 → **bloqueo**, no permite continuar.

---

### Paso 8 — Decisiones del dev (checklist)

```
[ ] He revisado sección 3 (Contratos públicos) — está completa
[ ] He revisado sección 5 (Dependencias) — entiendo qué se rompe afuera si cambio firmas
[ ] He capturado golden tests representativos (mínimo 3 si tests_count < 5)
[ ] Solicito aprobación Tech Lead en Gate G1.5
```

Justificación obligatoria si `risk_level == high`.

---

### Paso 9 — Lock y persistencia

```
1. Validar schema completo
2. Escribir <repo>/.ai/BASELINE-<modulo>.md
3. NO setear locked_at todavía — eso lo hace Gate G1.5 (Tech Lead aprueba)
4. Si modo platform: → devflow_save_baseline + notificar Tech Lead
5. Si modo local: → pedir al dev que solicite firma del Tech Lead
6. session.json:
   - baseline_path = ".ai/BASELINE-<modulo>.md"
   - flow_state: → baseline_ready (cuando lock)
```

---

## Reglas duras

1. **Bloqueante**: hasta `locked_at != null`, `/new-spec(R)` no avanza
2. **Soporta "0 tests" explícito** — no se bloquea por no tener tests, pero requiere golden tests
3. **risk_level auto-derivado**: `tests_count < 5 OR coverage < 30% OR contracts_count > 10` → `high`
4. **No re-genera silenciosamente**: archivo existente requiere `--re-capture --reason`
5. **Read-only sobre el código** — escribe solo en `.ai/`
6. **Stack-agnóstico en schema, stack-específico en detección** — mismo output sin importar el lenguaje
