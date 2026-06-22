---
name: capture-baseline
description: Captura tests, métricas y contratos del módulo objetivo antes de refactor (genera .ai/BASELINE.md)
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.1.0
category: Quality
model: opus
model_rationale: Decidir qué contratos preservar, capturar golden tests representativos y evaluar risk_level es razonamiento de alta consecuencia (si falla, el refactor rompe en prod)
fallback_model: sonnet
applies_to_dev_types: [brownfield-refactor]
reads:
  - "<repo>/<target_module>/**/*"
  - "<repo>/.ai/REPO-CONTEXT.md"
  - "<repo>/tests/**/*  package.json  jest.config.*  vitest.config.*"
writes:
  - "<repo>/.ai/BASELINE-<modulo>.md"
  - "<repo>/.ai/golden/<modulo>/  (snapshots opcionales)"
mcp_tools:
  - devflow_save_baseline  (modo platform — enlaza a HDU)
---

# `/capture-baseline` — Snapshot pre-refactor

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

El archivo generado **DEBE** cumplir el schema fijo definido en:
`_Empresa/Productos/DevFlow-IA/schemas/baseline.schema.md`

**Estructura obligatoria (8 secciones):**
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

## Proceso

### Paso 1 — Identificación del módulo

Si se pasa `<modulo>` como arg → usa ese path. Si no → entrevista:

```
¿Qué módulo vas a refactorizar?
  1) Path al directorio o archivo principal
  2) Slug del módulo (busca en src/modules/<slug> o src/<slug>)
```

Lee el path:
- Lista archivos en scope (mostrar al dev para confirmar)
- Detecta archivos del módulo que NO se deben tocar (out of scope)
- Lee `.ai/REPO-CONTEXT.md` para entender capas, convenciones, integraciones

### Paso 2 — Detección de tests

Busca tests que cubren los archivos del módulo:
- Files matching `*.spec.*`, `*.test.*`, `*-spec.*`, `__tests__/*` en directorios cercanos
- Lee `package.json` o config para identificar test runner (jest, vitest, mocha, jasmine)
- Si jest config tiene coverage → leer coverage actual del módulo
- Cuenta tests: `grep -c "it\\|test\\|describe"` ajustado por framework

Si `tests_count == 0`:
- Marca `risk_level: high`
- Mostrar warning explícito al dev
- Sección 7 (golden tests) se vuelve OBLIGATORIA (mínimo 3 capturas)

### Paso 3 — Contratos públicos (CRÍTICO)

Identifica qué exporta el módulo al exterior:

**Endpoints HTTP** (si es controller):
- Decoradores `@Controller`, `@Get`, `@Post`, etc.
- Para cada ruta: request schema, response schema, headers requeridos, guards

**Funciones / clases exportadas**:
- `export function`, `export class`, `export interface`, `export type`
- Para cada uno: firma completa, dónde se importa en el resto del repo (grep)

**Eventos publicados**:
- Detectar `EventEmitter`, `publishMessage`, `rabbitmq.publish`, similar
- Payload schema, listeners conocidos

**Schema DB**:
- Tablas que el módulo LEE y/o ESCRIBE
- Columnas que afectan el contrato
- SQL/procedures invocadas

**Pregunta al dev** las cosas que no se detectan automáticamente:
- ¿Hay contratos públicos NO detectados que querés agregar?

### Paso 4 — Métricas de performance

Si `--skip-perf` → marca sección como "No disponible".
Si no:
- Buscar dashboards (Grafana, NewRelic, Datadog) referenciados en repo
- Preguntar al dev por latencia P50/P95/P99 conocida
- Preguntar throughput nominal
- Preguntar tasa de error

Si nada disponible → marcar "No disponible" + warning de que `/release-check(R)` no podrá validar mejora cuantitativa.

### Paso 5 — Dependencias in/out

**Out** (de qué depende el módulo):
- `grep -E "import.*from" <target_files>`
- Filtrar imports del propio módulo
- Listar imports externos al módulo

**In** (qué depende del módulo):
- `grep -rE "from ['\"](.*<modulo>)" src/`
- Listar archivos que importan del módulo

### Paso 6 — Estado de calidad

- LoC: `wc -l <target_files>`
- Cyclomatic complexity: ejecutar herramienta del stack (`eslint-complexity`, `radon`, etc.) si disponible
- Lint count: `npm run lint <target_files>` (errors + warnings)
- TypeScript: contar `any`, `@ts-ignore`
- `npm audit` filtrado

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

### Paso 8 — Decisiones del dev (checklist)

Mostrar checklist al dev. Cada item requiere [x]:

```
[ ] He revisado sección 3 (Contratos públicos) — está completa
[ ] He revisado sección 5 (Dependencias) — entiendo qué se rompe afuera si cambio firmas
[ ] He capturado golden tests representativos (mínimo 3 si tests_count < 5)
[ ] Solicito aprobación Tech Lead en Gate G1.5
```

Justificación obligatoria si `risk_level == high`.

### Paso 9 — Lock y persistencia

```
1. Validar schema completo
2. Escribir <repo>/.ai/BASELINE-<modulo>.md
3. NO setear locked_at todavía — eso lo hace Gate G1.5 (Tech Lead aprueba en plataforma)
4. Si modo platform:
   → devflow_save_baseline({...})
   → Plataforma notifica a Tech Lead para aprobar
5. Si modo local:
   → Pedir al dev que solicite firma del Tech Lead y la ponga en sección 8
6. session.json:
   - baseline_path = ".ai/BASELINE-<modulo>.md"
   - flow_state: si tiene REPO-CONTEXT → repo_mapped + baseline_ready (cuando lock)
```

## Reglas duras

1. **Bloqueante**: hasta que `locked_at != null` (Gate G1.5), `/new-spec(R)` no avanza
2. **Soporta "0 tests" explícito** — no se bloquea por no tener tests, pero requiere golden tests
3. **risk_level auto-derivado**: tests_count < 5 OR coverage < 30% OR contracts_count > 10 → `high`
4. **No re-genera silenciosamente**: archivo existente requiere `--re-capture --reason="..."` con audit
5. **Read-only sobre el código** — escribe solo en `.ai/`

## Outputs esperados al usuario

```
✓ Baseline capturado: src/modules/contratos/calculo-mora
  risk_level: high (tests_count: 0)
  contracts_count: 4
  schema_version: 1

Resumen:
  Tests existentes: 0  ⚠
  Coverage: 0%
  Contratos públicos detectados: 4
  Golden tests capturados: 3 (modo --record-mode)
  LoC: 348  ·  Cyclomatic: 47
  Métricas perf: No disponible

⚠  risk_level: high — refactor requiere aprobación explícita de Tech Lead
   Gate G1.5: pedir firma del Tech Lead en sección 8 antes de /new-spec(R)

Archivo: .ai/BASELINE-calculo-mora.md
Golden tests: .ai/golden/calculo-mora/ (3 casos)
Siguiente paso: solicitar firma Tech Lead → luego /new-spec(R)
```

## Variables que lee de CLAUDE.md

| Variable | Uso |
|---|---|
| `STACK` | Identificar test runner y herramientas de calidad |
| `BACKEND_FRAMEWORK` / `FRONTEND_FRAMEWORK` | Detectar patrones del framework |

## Variables que lee de session.json

| Campo | Uso |
|---|---|
| `dev_type` | Aborta si != `brownfield-refactor` |
| `feature_id` | Linkea BASELINE a la HDU en plataforma |
| `apps_affected` | Valida que el módulo es parte de las apps afectadas |
