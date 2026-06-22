# DevFlow IA — Matriz de Enforcement por `dev_type`

**Versión:** 1.0
**Estado:** Documento canónico de referencia
**Última actualización:** 2026-06-19

Este documento es la **fuente única de verdad** para las reglas de enforcement
del método. Las skills, el CLI (`dd-cli`) y el pipeline CI/CD evaluan estas
reglas localmente. La plataforma (`devflow_get_feature`) las despacha a los
clientes según el `dev_type` activo.

---

## Catálogo de reglas

Cada regla tiene:
- **ID**: constante (UPPER_SNAKE_CASE), usado en `enforcement_rules[]`
- **Aplica a**: lista de `dev_type` donde la regla se activa
- **Quién evalúa**: skill / componente que la chequea
- **Severidad**: `block` (impide avanzar) | `warn` (avisa pero permite) | `audit` (registra)
- **Mensaje accionable**: qué se le muestra al dev cuando la regla se viola

---

### REQUIRE_REPO_CONTEXT_MD

| | |
|---|---|
| **Aplica a** | `brownfield-feature`, `brownfield-refactor`, `modernizacion`, `integracion-externa` (si toca app existente) |
| **Evalúa** | `/new-spec`, `dd-cli doctor --for`, `flow_state` machine |
| **Severidad** | `block` |
| **Condición** | Existe `.ai/REPO-CONTEXT.md` con `schema_version >= 1` |
| **Mensaje** | "Esta HDU es `<dev_type>` y requiere mapeo del repo existente. Ejecuta `/init-repo-context` antes de `/new-spec`." |

### REQUIRE_BASELINE_MD

| | |
|---|---|
| **Aplica a** | `brownfield-refactor` |
| **Evalúa** | `/new-spec(R)`, `dd-cli doctor --for`, `flow_state` machine |
| **Severidad** | `block` |
| **Condición** | Existe `.ai/BASELINE-<modulo>.md` con `locked_at != null` |
| **Mensaje** | "Refactor sin baseline no garantiza no-regresión. Ejecuta `/capture-baseline <modulo>` antes de `/new-spec`. Si no hay tests previos, el skill registra el caso explícitamente." |

### BLOCK_NEW_APP

| | |
|---|---|
| **Aplica a** | `brownfield-feature`, `brownfield-refactor`, `modernizacion`, `integracion-externa` |
| **Evalúa** | `/new-app` |
| **Severidad** | `block` |
| **Condición** | `dev_type == greenfield` |
| **Mensaje** | "Esta HDU es `<dev_type>`. Usa el repo existente y trabajá con `/derive-spec` o `/opsx:propose`. `/new-app` solo aplica a greenfield." |

### REQUIRE_LEGACY_SYSTEM_FIELD

| | |
|---|---|
| **Aplica a** | `modernizacion` |
| **Evalúa** | APP formulario HDU + `/new-spec(M)` |
| **Severidad** | `block` |
| **Condición** | `HDU.legacy_system` no es `null` ni `""` |
| **Mensaje** | "Modernización requiere identificar el sistema legacy a reemplazar. Completá el campo `legacy_system` en la HDU." |

### REQUIRE_VENDOR_FIELD

| | |
|---|---|
| **Aplica a** | `integracion-externa` |
| **Evalúa** | APP formulario HDU + `/new-spec(I)` |
| **Severidad** | `block` |
| **Condición** | `HDU.vendor.name` y `HDU.vendor.api_version` no null |
| **Mensaje** | "Integración externa requiere identificar el vendor y la versión de API. Completá los campos `vendor` en la HDU." |

### OPSX_PROPOSE_REQUIRE_NO_FUNCTIONAL_CHANGE_SECTION

| | |
|---|---|
| **Aplica a** | `brownfield-refactor` |
| **Evalúa** | `/opsx:propose` |
| **Severidad** | `warn` (no bloquea, registra) |
| **Condición** | `proposal.md` contiene sección con heading "no functional change" (case insensitive) |
| **Mensaje** | "Refactor: asegúrate de que el proposal incluye la sección 'no functional change' declarando explícitamente que el comportamiento externo se mantiene." |

### OPSX_PROPOSE_SUGGEST_ANTI_CORRUPTION_LAYER

| | |
|---|---|
| **Aplica a** | `integracion-externa` |
| **Evalúa** | `/opsx:propose` |
| **Severidad** | `warn` |
| **Condición** | `design.md` menciona patrón anti-corrupción / port-adapter |
| **Mensaje** | "Integración externa: considera patrón anti-corrupción / port-adapter para aislar el modelo del vendor del modelo de dominio interno." |

### RELEASE_CHECK_VALIDATE_CONTRACTS

| | |
|---|---|
| **Aplica a** | `brownfield-refactor` |
| **Evalúa** | `/release-check(R)`, CI/CD pipeline |
| **Severidad** | `block` |
| **Condición** | Diff de contratos públicos (endpoints, exports, schemas) entre BASELINE.md y código actual = sin breaking changes; golden tests del BASELINE pasan; métricas no empeoran >5% |
| **Mensaje** | "Refactor: detectado breaking change en contrato `<X>` o golden test fallido. Detalle: `<diff>`. Resolver antes de MR." |

### RELEASE_CHECK_VALIDATE_PARITY

| | |
|---|---|
| **Aplica a** | `modernizacion` |
| **Evalúa** | `/release-check(M)`, CI/CD pipeline |
| **Severidad** | `block` |
| **Condición** | Matriz de paridad funcional de SPEC tiene todas las filas con estado `cubierto` o `aceptado-no-cubre`; si shadow testing está habilitado, % de divergencia ≤ umbral configurado (default 1%) |
| **Mensaje** | "Modernización: paridad no validada. Filas pendientes: `<lista>`. O divergencia shadow `<%>`. Resolver antes de activar rampa de tráfico." |

### RELEASE_CHECK_VALIDATE_INTEGRATION_SECURITY

| | |
|---|---|
| **Aplica a** | `integracion-externa` |
| **Evalúa** | `/release-check(I)`, CI/CD pipeline |
| **Severidad** | `block` |
| **Condición** | (1) Ningún string sensible literal (API key/token/secret) en `src/` — solo via env/secrets; (2) Si hay endpoint webhook receiver: existe función de verificación de firma; (3) Si la API tiene rate limit < 1000/min: existe retry con backoff exponencial; (4) Operaciones write tienen idempotency key |
| **Mensaje** | "Integración externa: <X> check de seguridad falló. Detalle: <razón>. Bloqueante para merge." |

### COMMIT_TRAILER_DEVFLOW_TYPE

| | |
|---|---|
| **Aplica a** | Todos los tipos |
| **Evalúa** | `/release-check`, CI/CD pipeline |
| **Severidad** | `block` |
| **Condición** | Cada commit del MR incluye trailer `DevFlow-Type: <dev_type>` que matchea con `HDU.dev_type` |
| **Mensaje** | "Commit `<sha>` no incluye trailer DevFlow-Type o no matchea con HDU.dev_type (`<X>` vs `<Y>`). Configurar git template o re-commitear." |

### RECLASSIFY_REQUIRES_TECH_LEAD

| | |
|---|---|
| **Aplica a** | Todos los tipos, una vez `dev_type_locked == true` |
| **Evalúa** | `dd-cli reclassify`, APP backend |
| **Severidad** | `block` |
| **Condición** | Rol del usuario que invoca == `tech-lead` o `admin`; `reason` tiene ≥30 chars |
| **Mensaje** | "Reclasificación post-lock solo permitida a Tech Lead. Justificación obligatoria (≥30 chars). Queda en audit-log." |

### RECLASSIFY_NOTIFIES_BUSINESS_ON_LEAD_TIME_DELTA

| | |
|---|---|
| **Aplica a** | Todos los tipos en reclassify |
| **Evalúa** | APP backend (post-reclassify hook) |
| **Severidad** | `audit` |
| **Condición** | Si lead-time estimado nuevo difiere >20% del anterior, envía notificación al PMO autor del brief |
| **Mensaje** | "Lead time estimado cambió `<+X%>` por reclasificación. PMO notificado." |

### MOVE_TO_SPRINT_REQUIRES_DEV_TYPE

| | |
|---|---|
| **Aplica a** | Todos los tipos |
| **Evalúa** | APP backend al mover HDU a sprint |
| **Severidad** | `block` |
| **Condición** | `HDU.dev_type` no es `null` |
| **Mensaje** | "Esta HDU no tiene `dev_type` definido. Volver al portal de negocio o pedir al PMO que lo complete antes de planificar." |

### CAPTURE_REQUIRES_RATIONALE_ON_LOW_CONFIDENCE

| | |
|---|---|
| **Aplica a** | Todos los tipos en captura inicial (portal negocio) |
| **Evalúa** | APP formulario brief |
| **Severidad** | `block` |
| **Condición** | Si confianza IA en sugerencia de `dev_type` <0.7 O si PMO cambia la sugerencia → `rationale` requerido (≥30 chars) |
| **Mensaje** | "La IA tiene baja confianza en la clasificación o cambiaste la sugerencia. Explicá por qué (≥30 chars)." |

---

## Vista resumida por `dev_type`

```
GREENFIELD
  block: BLOCK_NEW_APP (negado: greenfield SÍ puede usar /new-app)
  block: COMMIT_TRAILER_DEVFLOW_TYPE
  block: MOVE_TO_SPRINT_REQUIRES_DEV_TYPE
  block: RECLASSIFY_REQUIRES_TECH_LEAD (si aplica)

BROWNFIELD-FEATURE
  block: REQUIRE_REPO_CONTEXT_MD
  block: BLOCK_NEW_APP
  block: COMMIT_TRAILER_DEVFLOW_TYPE
  block: MOVE_TO_SPRINT_REQUIRES_DEV_TYPE

BROWNFIELD-REFACTOR
  block: REQUIRE_REPO_CONTEXT_MD
  block: REQUIRE_BASELINE_MD
  block: BLOCK_NEW_APP
  warn:  OPSX_PROPOSE_REQUIRE_NO_FUNCTIONAL_CHANGE_SECTION
  block: RELEASE_CHECK_VALIDATE_CONTRACTS
  block: COMMIT_TRAILER_DEVFLOW_TYPE

MODERNIZACION
  block: REQUIRE_REPO_CONTEXT_MD
  block: REQUIRE_LEGACY_SYSTEM_FIELD
  block: BLOCK_NEW_APP
  block: RELEASE_CHECK_VALIDATE_PARITY
  block: COMMIT_TRAILER_DEVFLOW_TYPE
  (G3 humano: rampa de tráfico aprobada por Operaciones)

INTEGRACION-EXTERNA
  block: REQUIRE_VENDOR_FIELD
  block: REQUIRE_REPO_CONTEXT_MD (si toca app existente)
  block: BLOCK_NEW_APP
  warn:  OPSX_PROPOSE_SUGGEST_ANTI_CORRUPTION_LAYER
  block: RELEASE_CHECK_VALIDATE_INTEGRATION_SECURITY
  block: COMMIT_TRAILER_DEVFLOW_TYPE
```

---

## Evaluación local (sin plataforma)

Cuando `dd-cli` opera en modo `local`, las `enforcement_rules` se generan
client-side a partir del `dev_type` en `session.json`. Reglas que requieren
data server-side (`RECLASSIFY_REQUIRES_TECH_LEAD`,
`RECLASSIFY_NOTIFIES_BUSINESS_*`) **no se evalúan en modo local** — el CLI
permite la reclasificación pero deja warning explícito de que la auditoría
no quedó persistida.

---

## Evolución del catálogo

- **Cambios menores** (texto del mensaje, mejora condición): bump 1.x
- **Reglas nuevas**: bump minor con migration note en CHANGELOG del CLI
- **Cambio de severidad** (warn→block): mayor, requiere comunicación al cliente
- **Nuevas reglas requieren validación con al menos 2 clientes piloto** antes de incluir en release estable

---

## Implementación

### En `@devflow-ia/cli`

`packages/cli/src/enforcement/rules.ts` exporta:
```typescript
export interface EnforcementRule {
  id: string;
  applies_to: DevType[];
  severity: 'block' | 'warn' | 'audit';
  evaluate(session: SessionState, repo: RepoState): EvaluationResult;
  message_template: string;
}

export const RULES: Record<string, EnforcementRule>;
```

### En skills

Cada skill que evalúa reglas hace:
```typescript
import { evaluateRules } from '@devflow-ia/cli/enforcement';

const violations = evaluateRules(session.enforcement_rules, session, repo);
const blockers = violations.filter(v => v.severity === 'block');
if (blockers.length > 0) {
  abortWithMessages(blockers);
}
warnings.forEach(w => printWarning(w.message));
```

### En CI/CD

GitLab CI / GitHub Actions usan `dd-cli ci-check` que evalúa solo las reglas
con tag `ci-applicable` (subset de las anteriores: COMMIT_TRAILER_*,
RELEASE_CHECK_VALIDATE_*).
