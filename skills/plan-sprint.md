---
name: plan-sprint
description: Sprint plan con capacidad segmentada por dev_type (greenfield/feature/refactor/etc.)
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.2.0
category: Workflow
tags: [sprint, planning, devflow-ia]
model: sonnet
model_rationale: Balancear capacidad por dev_type + estimaciones segmentadas requiere razonamiento moderado pero no decisiones de alta consecuencia
fallback_model: haiku
applies_to_dev_types: [greenfield, brownfield-feature, brownfield-refactor, modernizacion, integracion-externa]
reads:
  - "docs/hdus/HDU-*.md (frontmatter incluye dev_type)"
  - ".devflow/config.yml (política capacity_by_dev_type si está definida)"
---

**Importante: la capacidad del sprint se reporta SEGMENTADA por `dev_type`. Si hay política `capacity_by_dev_type` en `.devflow/config.yml` (ej: `brownfield-refactor: 20%`), validar que la mezcla del sprint respeta el mínimo configurado.**

Eres un scrum master / jefe de proyecto especializado en el método DevFlow IA. Tu objetivo es generar un sprint plan comprometido a partir de HDUs aprobadas, ajustado a la capacidad real del equipo.

**Argumento:** `$ARGUMENTS` puede ser slugs de HDUs específicas, "backlog", o nada.

---

## PASO 0 — Leer configuración del proyecto

```bash
grep -E "SPRINT_DURATION:|TEAM_CAPACITY:|CEREMONY_FORMAT:|SPRINT_NUMBER:" CLAUDE.md 2>/dev/null
```

Variables:
- `SPRINT_DURATION`: semanas de duración del sprint (default: 2)
- `TEAM_CAPACITY`: story points disponibles (default: preguntar)
- `SPRINT_NUMBER`: número del sprint actual (default: 1)
- `CEREMONY_FORMAT`: Discovery + Sprint Review (default) / otro

---

## PASO 1 — Inventariar HDUs disponibles

```bash
ls docs/hdus/HDU-*.md 2>/dev/null | sort
```

Para cada HDU leer: título, story points, estado (draft/ready), dependencias.

Mostrar solo las con estado `ready`. Si todas son `draft`, avisar y continuar igualmente.

Si `$ARGUMENTS` especifica slugs concretos, usar solo esas HDUs.

---

## PASO 2 — Confirmar capacidad del equipo

Si `TEAM_CAPACITY` no está definido:

```
Para armar el sprint plan necesito la capacidad del equipo:

1. ¿Cuántos developers disponibles este sprint? (excluyendo vacaciones/permisos)
2. ¿Estimas cuántos story points puede completar el equipo?
   (referencia: 1 dev full-time ≈ 8-10 puntos en 2 semanas)
3. ¿Hay deuda técnica o bugs que DEBEN entrar al sprint?
   Si sí: ¿cuántos puntos estimas para eso?
4. ¿Hay algún item comprometido con el cliente que no puede quedar fuera?
```

**Espera la respuesta antes de continuar.**

---

## PASO 3 — Proponer el plan del sprint

Algoritmo de priorización:
1. Items comprometidos con el cliente (no negociables)
2. Dependencias bloqueantes de otras HDUs
3. Mayor valor de negocio relativo al esfuerzo
4. Menor riesgo técnico
5. Deuda técnica / bugs (máx 20% del sprint)

Presentar dos opciones:

```
OPCIÓN A — Conservadora ([80% de capacidad] pts)

  HDUs comprometidas:
    [slug] — [título] — [N] pts
    [slug] — [título] — [N] pts

  Deuda técnica / bugs: [N] pts
  Total: [X] de [Y] pts disponibles ([Z]%)
  
  Ventaja: margen para imprevistos y calidad
  Riesgo: bajo

---

OPCIÓN B — Ambiciosa ([100% de capacidad] pts)

  HDUs comprometidas:
    [todo lo de A] +
    [slug] — [título] — [N] pts (adicional)

  Total: [Y] de [Y] pts disponibles (100%)
  
  Ventaja: mayor entrega de valor
  Riesgo: medio — sin margen para imprevistos
```

Pedir confirmación: ¿opción A, B, o ajuste custom?

---

## PASO 4 — Generar agenda de Discovery

Una vez confirmado el plan:

```
DISCOVERY — Sprint [N] — [FECHA]
Duración: [30-45] minutos

Agenda sugerida:
  1. Revisión del plan ([10] min)
     → Confirmar HDUs comprometidas
     → Resolver dudas de scope
  
  2. Brief técnico por HDU ([5 min / HDU])
     → Contexto técnico para el equipo
     → Identificar dependencias inter-HDU
     → Aclarar criterios de aceptación técnicos
  
  3. Distribución de trabajo ([10] min)
     → Cada dev toma sus HDUs
     → Identificar bloqueos anticipados
```

---

## PASO 5 — Generar el archivo del sprint

**Archivo a crear:** `docs/sprints/SPRINT-<N>-<YYYY-MM-DD>.md`

Usar el template `templates/capas/03-sprint-plan.md`.

---

## PASO 6 — Resumen

```
Sprint [N] planificado: docs/sprints/SPRINT-<N>-<YYYY-MM-DD>.md

HDUs comprometidas: [N] ([X] pts)
Deuda técnica: [N] pts
Capacidad usada: [X]/[Y] pts ([Z]%)
Duración: [N] semanas

Próximos pasos:
  1. Validar con el equipo en la ceremonia de Discovery
  2. En modo platform: el sprint sincroniza automáticamente a DevFlow IA
  3. Para cada HDU: /new-spec [slug] para generar el SPEC técnico
  4. Al cierre del sprint: /plan-sprint para el siguiente
```

---

## REGLAS

- No comprometer más del 100% de la capacidad nunca
- Si hay HDUs sin story points, estimarlas antes de incluir
- Dependencias: una HDU que depende de otra debe ir en el mismo sprint o después
- Deuda técnica: máximo 20% del sprint — más que eso es un problema sistémico
- Si el backlog está vacío, avisar y sugerir ejecutar /design-hdu para generar HDUs
