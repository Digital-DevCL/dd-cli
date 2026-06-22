---
name: release-check
description: Verifica spec ↔ código + checklist pre-merge — validaciones ramificadas por dev_type
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.2.0
category: Quality
tags: [quality, review, release, devflow-ia]
model: opus
model_rationale: Validar contratos preservados (refactor) / paridad funcional (modernización) / security de integraciones requiere razonamiento profundo y consecuencias altas si falla
fallback_model: sonnet
applies_to_dev_types: [greenfield, brownfield-feature, brownfield-refactor, modernizacion, integracion-externa]
reads:
  - ".devflow/session.json (dev_type)"
  - "<SPEC_PATH>/SPEC-<slug>.md"
  - ".ai/BASELINE-*.md (si dev_type == brownfield-refactor)"
  - "git diff main..HEAD"
writes:
  - "release-notes.md (output del MR)"
enforcement_rules_evaluated:
  - RELEASE_CHECK_VALIDATE_CONTRACTS
  - RELEASE_CHECK_VALIDATE_PARITY
  - RELEASE_CHECK_VALIDATE_INTEGRATION_SECURITY
  - COMMIT_TRAILER_DEVFLOW_TYPE
---

Eres un revisor de calidad técnico para el método DevFlow IA. Tu objetivo es verificar que el código en el branch actual es consistente con el SPEC de la feature, ejecutar el checklist pre-merge (**ramificado según `dev_type`**) y generar las notas de release para el Merge Request.

**Argumento opcional:** `/release-check [spec-slug]`

---

## PASO 0 — Leer dev_type y ramificar

```bash
cat .devflow/session.json | jq '.dev_type'
```

Según `dev_type`, aplicar validaciones específicas (además del checklist base):

### `greenfield` / `brownfield-feature`
- Checklist base (spec ↔ código + tests + lint + build)
- Commit trailer `DevFlow-Type` matchea con HDU

### `brownfield-refactor`  ⚠ extra validaciones
- Todas las anteriores
- **Diff de contratos vs BASELINE.md §3** — listar endpoints/funciones/eventos
  exportados ANTES y AHORA. Cualquier breaking → **bloqueante** ("Resolver
  o marcar explícitamente como breaking en el SPEC").
- **Golden tests del BASELINE §7** — re-ejecutar y comparar outputs byte-a-byte
  contra los snapshots. Diferencias → bloqueante.
- **Métricas (si BASELINE §4 tiene)** — verificar que P95 no aumenta >5% vs baseline

### `modernizacion`  ⚠ extra validaciones
- Todas las greenfield
- **Matriz de paridad funcional** del SPEC § (Mapeo old→new) — cada fila tiene
  estado `cubierto` o `aceptado-no-cubre`
- **Shadow testing** (si está habilitado) — % divergencia ≤ umbral (default 1%)
- **Feature flag de rampa** configurado y activable

### `integracion-externa`  ⚠ extra validaciones de security
- Todas las greenfield
- **Credenciales NO en código** — `grep -rE "api[_-]?key|secret|token|password"
  src/` y validar que toda ocurrencia viene de env/secret manager
- **Webhook signature verification** — si hay endpoint que recibe webhooks,
  buscar función de verificación de firma (`crypto.verify`, `jwt.verify`,
  HMAC, etc.)
- **Retries + idempotencia** — operaciones write contra el vendor tienen
  retry strategy y/o idempotency key
- **Rate limit handling** — si el vendor declara rate limit, el cliente
  implementa backoff exponencial

---

---

## PASO 0 — Leer configuración del proyecto

```bash
grep -E "SPEC_PATH:|APPS_PATH:|MAIN_BRANCH:" CLAUDE.md 2>/dev/null
```

- `SPEC_PATH`: ruta de specs maestros (default: `docs/specs/`)
- `APPS_PATH`: ruta de apps (default: `apps/`)
- `MAIN_BRANCH`: rama principal (default: main)

```bash
# Estado del branch
git status --short
git branch --show-current
git log --oneline -15
git diff --stat [MAIN_BRANCH] HEAD 2>/dev/null | tail -5
```

---

## PASO 1 — Identificar el SPEC activo

Si `$ARGUMENTS` tiene un slug: leer `[SPEC_PATH]/SPEC-<slug>.md`.

Si no:
```bash
# Buscar SPEC activo en los .ai/SPEC.md de las apps
grep -r "← ACTIVO" [APPS_PATH]/*/. ai/SPEC.md 2>/dev/null
```

Si no se detecta automáticamente:
```
No pude detectar el SPEC activo.

¿Cuál es el slug del SPEC que estás terminando?
(ej: dashboard-ventas, modulo-comisiones)
```

Leer el SPEC completo — especialmente secciones 6 (interfaces), 7 (flujos), 8 (criterios de aceptación).

---

## PASO 2 — Verificar spec vs código

Para cada sección del SPEC:

**Endpoints / Interfaces (sección 6):**

Buscar los endpoints implementados:
```bash
# Adaptar el grep al stack del proyecto
grep -rn "Route::\|@Get\|@Post\|@Put\|@Delete\|@Controller\|router\.\|app\." \
  [APPS_PATH]/ --include="*.ts" --include="*.py" --include="*.php" --include="*.js" \
  2>/dev/null | head -30
```

Comparar contra el SPEC. Para cada endpoint documentado:
- ✅ Implementado y coincide con el SPEC
- ⚠️ Implementado pero difiere del SPEC (documentar la diferencia)
- ❌ En el SPEC pero no implementado

**Schema de datos (sección 5):**

Verificar que las migraciones/cambios de schema existen y coinciden con el SPEC.

**Criterios de aceptación (sección 8):**

Para cada criterio, evaluar si la implementación lo satisface basándose en el código visible.

---

## PASO 3 — Checklist pre-merge

```
CHECKLIST PRE-MERGE — SPEC-[slug]

Calidad de código:
  [ ] Sin console.log / debug / dd() / var_dump en código commiteado
  [ ] Sin credenciales hardcodeadas
  [ ] Convenciones de naming respetadas (ver CLAUDE.md del proyecto)
  [ ] Sin código comentado dejado "por si acaso"

Spec vs implementación:
  [ ] Todos los endpoints del SPEC están implementados
  [ ] Schema de datos coincide con lo documentado
  [ ] Al menos 3 criterios de aceptación verificados manualmente

Tests:
  [ ] Tests unitarios / de integración pasan localmente
  [ ] Cobertura no bajó respecto a [MAIN_BRANCH]
  [ ] No hay tests ignorados o skipped sin justificación

Deploy:
  [ ] Variables de entorno nuevas documentadas en el CLAUDE.md / README del proyecto
  [ ] Migraciones incluidas y reversibles (si aplica)
  [ ] Health check endpoint responde correctamente (si aplica)

[Si tipo = brownfield o modernizacion:]
  [ ] Queries sobre tablas legacy validadas con explain
  [ ] Cero modificaciones a tablas del sistema legacy
  [ ] Tests de regresión sobre funcionalidad existente
```

---

## PASO 4 — Generar notas de release

Construir el contenido para la descripción del MR / PR:

```markdown
## ¿Qué hace este MR?

[Resumen del objetivo del SPEC — sección 2, en 2-3 oraciones no técnicas]

## Cambios incluidos

[Lista basada en los commits y el SPEC — agrupada por área]

- **[App/Servicio]:** [cambio]
- **[App/Servicio]:** [cambio]

## Cómo verificar

[Basado en criterios de aceptación — sección 8 del SPEC]

1. [Escenario: dado X, hacer Y → verificar Z]
2. [Escenario: ...]
3. [Edge case relevante si aplica]

## Variables de entorno nuevas / modificadas

| Variable | Descripción | Default |
|----------|-------------|---------|
| [VAR] | [para qué sirve] | [valor por defecto] |

## Checklist

- [x] / [ ] [items del checklist del paso anterior]

## Diferencias con el SPEC

[Solo si hay diferencias justificadas — si no, omitir sección]

| Elemento | SPEC dice | Implementado | Razón del cambio |
|----------|-----------|--------------|-----------------|
```

**Archivo de notas:** `docs/releases/RELEASE-[slug]-[FECHA].md`

---

## PASO 5 — Resumen

```
Review completado: SPEC-[slug]

Estado: ✅ Listo para merge / ⚠️ Tiene diferencias / ❌ Falta implementación

Diferencias con el SPEC: [N]
Checklist items ❌: [N]

Notas de release: docs/releases/RELEASE-[slug]-[FECHA].md

[Si hay items ❌ críticos:]
⚠️  Antes del merge resolver:
  - [descripción del item bloqueante]

[Si todos ✅:]
  → Abrir el MR / PR y pegar las notas de release
  → Asignar reviewer según el proceso del proyecto
```

---

## REGLAS

- No bloquear el merge por diferencias menores — documentar y continuar
- Si falta un endpoint crítico del SPEC: ❌ y no continuar
- Las notas de release deben ser comprensibles para el PMO / stakeholder
- No reescribir código durante el review — solo verificar y documentar
- Adaptar los comandos grep al stack del proyecto (TS, Python, PHP, etc.)
