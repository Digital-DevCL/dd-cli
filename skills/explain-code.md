---
name: explain-code
description: Explica un archivo o fragmento de código en dos niveles (técnico y negocio)
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.1.0
category: Exploration
model: sonnet
model_rationale: Balanceada — explicar código requiere comprensión pero no decisiones de alta consecuencia. Sonnet maneja bien el doble registro técnico/negocio
fallback_model: haiku
applies_to_dev_types: [brownfield-feature, brownfield-refactor, modernizacion]
reads:
  - "<archivo> o fragmento provisto"
  - "<repo>/.ai/REPO-CONTEXT.md  (si existe — para contexto)"
writes:
  - stdout (explicación dual)
---

# `/explain-code` — Explicación dual técnico + negocio

## Cuándo usarla

- **Brownfield-refactor**: entender qué hace un fragmento legacy antes de tocarlo
- **Onboarding dev**: leer código compartido con alguien que no lo escribió
- **Code review**: el reviewer pide al dev un resumen ejecutivo del MR
- **Bridge con Tech Lead**: explicar código en lenguaje accesible para que el Jefe TI valide intención

## Flags

```bash
/explain-code <archivo>                   # Explica un archivo completo
/explain-code <archivo>:<linea-inicio>-<linea-fin>  # Fragmento específico
/explain-code <archivo> --level=tech      # Solo nivel técnico
/explain-code <archivo> --level=business  # Solo nivel negocio
```

## Proceso

Genera **dos explicaciones del mismo código**:

### Nivel 1 — Técnico

Para developers. Incluye:
- Qué hace el código línea por línea (o por bloque)
- Patrones de diseño identificados (si los hay)
- Dependencias (qué importa, qué exporta)
- Edge cases manejados
- Smells o anti-patterns observables (sin opinar — describir)

### Nivel 2 — Negocio

Para Tech Lead / PMO / stakeholder. Incluye:
- Qué problema de negocio resuelve este código
- Qué pasa si esto falla (impacto)
- Qué reglas de negocio están implementadas aquí
- Sin jerga técnica — usar lenguaje del dominio del cliente

## Reglas

1. **Read-only**
2. **Fiel al código** — no inventar lo que el código "debería hacer"; explicar lo que **hace**
3. **Dos secciones separadas** con headings `## Técnico` y `## Negocio`
4. **Cita líneas** — en nivel técnico, referenciar líneas específicas
5. **Sin recomendaciones** — esta skill explica, no propone cambios. Si quieres proponer, usa `/opsx:propose`

## Si existe `.ai/REPO-CONTEXT.md`

Lee §1 (Identidad — propósito del sistema) y §7 (Convenciones) para contextualizar.

## Output esperado

```markdown
# Explicación: src/modules/contratos/calculo-mora.ts (líneas 14-89)

## Técnico

La función `calcularMora(contratoId, fecha)` (línea 14):
1. Consulta la tabla `CONTRATOS` por id (línea 22) usando TypeORM
2. Si el contrato no existe → lanza `ContratoNotFoundException` (línea 25)
3. Calcula los días de mora con `differenceInDays` (línea 31)
4. Invoca el procedure Oracle `SP_RECALC_MORA(contratoId, fecha)` (línea 45)
5. Aplica un tope al monto si supera el 30% del capital (línea 62)
6. Publica evento `mora.calculated` al bus (línea 78)

Patrón: anti-corrupción parcial — el SP de Oracle se invoca pero el resultado se mapea a un tipo TS antes de retornar (líneas 50-58).

Edge cases manejados: contrato inexistente (línea 25), fecha futura (línea 28), monto negativo (línea 65).

## Negocio

Esta función calcula cuánto debe pagar un cliente de más cuando se atrasa en el pago de su contrato. Mira hasta qué fecha quedó al día, cuenta los días de atraso, aplica las reglas de cobro de la empresa y devuelve el monto total a pagar.

Hay un tope: nunca cobra más del 30% del valor original del contrato, aunque el atraso sea muy largo.

Cuando termina, avisa a otros sistemas (cobranza, notificaciones) que se calculó la mora para que puedan actuar.

**Si esto falla:** un cliente podría recibir un cobro incorrecto. Por eso el cálculo crítico se hace en Oracle (procedure SP_RECALC_MORA), no en este código.
```
