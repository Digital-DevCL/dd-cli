---
name: explore-repo
description: Analiza el repo actual y genera un reporte de stack, estructura, endpoints y dependencias
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.1.0
category: Exploration
model: opus
model_rationale: Análisis profundo del codebase desconocido — detectar patrones, identificar entry points implícitos, distinguir señal de ruido en código legacy
fallback_model: sonnet
applies_to_dev_types: [brownfield-feature, brownfield-refactor, modernizacion, integracion-externa]
reads:
  - "<repo>/**/*  (lectura solamente)"
writes:
  - stdout (reporte) — opcional: archivo si se invoca con --save
---

# `/explore-repo` — Reporte de descubrimiento de repo

## Cuándo usarla

Para entender rápidamente un repo desconocido. Útil:
- En onboarding de un dev nuevo al proyecto
- Antes de proponer un cambio en un repo que no conoces
- Como input rápido sin todo el ceremonial del schema (uso ad-hoc)

**Diferencia con `/init-repo-context`:** `/explore-repo` produce un **reporte legible** sin schema obligatorio. `/init-repo-context` produce el `.ai/REPO-CONTEXT.md` estructurado que el resto de las skills puede parsear.

Si necesitas el archivo estructurado para downstream skills → usa `/init-repo-context` (que internamente usa `/explore-repo`).

## Proceso

Analiza el repositorio o carpeta actual y genera un reporte en markdown con:

1. **Qué hace este servicio** — descripción en 2-3 oraciones, en lenguaje de negocio
2. **Stack tecnológico** — lenguaje, framework, gestor de dependencias, versión si está disponible
3. **Estructura de carpetas** — árbol con una línea explicando qué contiene cada carpeta principal
4. **Endpoints o puntos de entrada** — si es una API, lista los endpoints principales con método y descripción breve
5. **Dependencias externas** — bases de datos, colas, servicios externos, APIs que consume
6. **Cómo corre localmente** — si hay un README con instrucciones, resúmelas en 3 pasos

Sé directo. Sin introducción larga. El reporte debe ser útil para alguien que nunca vio este código.

## Reglas

1. **Read-only** — nunca modifica código
2. **Tone factual** — sin opiniones, sin "deberíamos refactorizar X"
3. **Detecta lenguaje** — no asume que es JS/TS si no lo es
4. **Cita paths** — siempre referencias archivos con su path para que el dev pueda navegar

## Variables que lee de CLAUDE.md

| Variable | Uso |
|---|---|
| `STACK` | Validar contra detección automática (warning si difieren) |
| `APPS_PATH` | Scope si es monorepo |

## Output esperado

Markdown plano con las 6 secciones. Si invocada con `--save` → escribe a `.ai/exploration-<timestamp>.md`.
