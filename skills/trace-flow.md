---
name: trace-flow
description: Traza el flujo completo de comunicación cross-service y genera diagramas editables
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.1.0
category: Exploration
model: opus
model_rationale: Trazar flujos cross-service en código real requiere razonamiento profundo — seguir llamadas a través de capas, identificar disparadores asíncronos, distinguir el camino feliz de las ramas de error
fallback_model: sonnet
applies_to_dev_types: [brownfield-refactor, modernizacion]
reads:
  - "<repo>/**/*  o monorepo entero"
  - "<repo>/.ai/REPO-CONTEXT.md"
writes:
  - "<repo>/.ai/flows/<dominio>.md"
  - "<repo>/.ai/flows/<dominio>.drawio  (editable multi-hoja)"
---

# `/trace-flow` — Traza de comunicación cross-service

## Cuándo usarla

- **Modernización (caso PDR-TRIO)**: entender cómo fluye un proceso de negocio en el legacy antes de reemplazarlo
- **Brownfield-refactor cross-service**: cuando el refactor implica varios servicios encadenados
- **Documentación de procesos críticos**: generar mapa de un proceso de negocio que no estaba documentado

## Flags

```bash
/trace-flow --scope=<dominio>             # Traza el flujo de un dominio (ej: "cobranza")
/trace-flow --from=<entry>                # Empieza desde un endpoint o evento específico
/trace-flow --max-hops=N                  # Limita profundidad (default 10)
/trace-flow --include-errors              # Incluye ramas de error y retries
```

## Proceso

### Paso 1 — Identificar scope

El usuario indica:
- Dominio de negocio (ej: "cobranza", "auth", "pagos") → busca módulos relacionados
- Endpoint específico (ej: `POST /api/contratos/:id/cobrar`) → arranca ahí
- Evento (ej: `pago.received`) → empieza desde el listener

### Paso 2 — Trazar llamadas

A partir del entry point, sigue:
- Llamadas HTTP a otros servicios
- Publicaciones a colas / event bus
- Llamadas a stored procedures / funciones DB
- Invocaciones cross-process / IPC
- Webhooks salientes

Cada salto se anota: origen → destino → mecanismo → payload resumido.

### Paso 3 — Distinguir caminos

- **Happy path**: el flujo principal en condiciones normales
- **Branches de error**: qué pasa si falla cada llamada (retries, fallbacks, dead-letter)
- **Async fan-out**: cuando un evento dispara múltiples listeners

Si `--include-errors=false` (default) → solo happy path.

### Paso 4 — Generar artefactos

**Archivo 1: `<repo>/.ai/flows/<dominio>.md`** — descripción narrativa + tabla trazable

```markdown
# Flujo: <dominio>

## Resumen
<2-3 líneas explicando el proceso de negocio>

## Trazabilidad

| # | Origen | Destino | Mecanismo | Notas |
|---|---|---|---|---|
| 1 | client | api-gateway | POST /endpoint | auth: Bearer |
| 2 | api-gateway | service-A | gRPC | ... |
| ... | ... | ... | ... | ... |

## Puntos críticos
- <salto donde el flujo es frágil / depende de servicio externo>
- <salto donde hay latencia alta conocida>
```

**Archivo 2: `<repo>/.ai/flows/<dominio>.drawio`** — diagrama editable multi-hoja
- Hoja 1: Vista general del flujo (boxes + arrows)
- Hoja 2: Detalle de cada servicio involucrado
- Hoja 3 (si `--include-errors`): Ramas de error y retries

El formato drawio permite editar y exportar a PNG/SVG/PDF desde drawio.com o VS Code.

## Reglas

1. **Read-only sobre el código**
2. **Cita paths** — cada salto referencia el archivo y línea donde ocurre la llamada
3. **No inventes** — si no encuentras un destino concreto, márcalo `<no-determinado>` con razón
4. **Determinista** — mismo HEAD, mismo scope → mismo output
5. **Genera el .drawio sintácticamente válido** — el archivo debe abrirse sin errores en drawio

## Si existe `.ai/REPO-CONTEXT.md`

Lee §6 (Integraciones externas) — pre-popula las flechas hacia sistemas externos.

## Output esperado al usuario

```
✓ Flujo trazado: cobranza
  Hops: 12 (3 servicios internos + 4 sistemas externos)
  Happy path: 8 saltos
  Branches de error: 4 (excluidas — usa --include-errors)

Archivos generados:
  .ai/flows/cobranza.md (trazabilidad tabular)
  .ai/flows/cobranza.drawio (3 hojas editables)

Puntos críticos detectados:
  ⚠ Salto 5: llamada a SP_RECALC_MORA (legacy, sin timeout)
  ⚠ Salto 9: webhook a TOKU (sin retry, sin idempotencia)
```
