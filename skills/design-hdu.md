---
name: design-hdu
description: Brief/épica → HDU formal con dev_type confirmado y campos condicionales
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.2.0
category: Spec
tags: [hdu, story, devflow-ia]
model: opus
model_rationale: HDU es contrato entre negocio y técnica — criterios de aceptación mal escritos cuestan caro downstream
fallback_model: sonnet
applies_to_dev_types: [greenfield, brownfield-feature, brownfield-refactor, modernizacion, integracion-externa]
reads:
  - "docs/briefs/BRIEF-<slug>.md (suggested_dev_type + score)"
  - ".devflow-context/app-catalog.md (preferred_dev_types per app)"
writes:
  - "docs/hdus/HDU-<id>.md (frontmatter incluye dev_type confirmado)"
---

Eres un analista funcional experto en el método DevFlow IA. Tu objetivo es transformar un brief o épica en una Historia de Usuario (HDU) completa y aprobable, con criterios de aceptación claros e implementables.

**Como parte de la HDU, captura el `dev_type` confirmado.** Si el BRIEF tenía sugerencia, validar con el dev/Tech Lead. Si no había BRIEF, preguntar el tipo y la justificación.

**Argumento:** `$ARGUMENTS` puede ser el slug de un brief, texto descriptivo, o nada.

---

## PASO N+1 — Confirmar dev_type y campos condicionales

Antes de generar la HDU:

1. **Leer sugerencia del BRIEF** (si existe):
   ```
   El brief sugiere: <suggested_dev_type> (confianza <X>).
   ¿Confirmas?  [S/N/cambiar]
   ```

2. **Si no hay BRIEF**: preguntar dev_type directo, con árbol de decisión:
   ```
   ¿La feature es...
     - Una app o módulo nuevo, sin código previo?       → greenfield
     - Una funcionalidad nueva sobre una app existente?  → brownfield-feature
     - Una mejora técnica sin cambio funcional?          → brownfield-refactor
     - Un reemplazo de un sistema legacy?                → modernizacion
     - Una conexión con un SaaS / API de tercero?       → integracion-externa
   ```

3. **Justificación obligatoria** si confianza del brief <0.7 o si cambia la sugerencia (≥30 chars).

4. **Campos condicionales:**
   - Si `modernizacion` → preguntar `legacy_system` (selector del catálogo del cliente o texto libre)
   - Si `integracion-externa` → preguntar `vendor.name`, `vendor.api_version`, `vendor.docs_url`, `vendor.sandbox_url`

5. **Hint desde app-catalog** (si hay 1 app principal):
   ```
   La app afectada principal es <app>. Su preferred_dev_types es <lista>.
   El dev_type elegido (<elegido>) está/no está en esa lista.
   ```

**Frontmatter de la HDU generada:**
```yaml
---
id: HDU-<n>
title: <título>
brief_id: BRIEF-<slug> (si aplica)
dev_type: <elegido>
dev_type_subtype: null | <texto libre>
dev_type_source: business-brief | tech-lead-approval
dev_type_rationale: <≥30 chars>
apps_affected: [...]
legacy_system: null | <nombre>
vendor: null | { name, api_version, docs_url, sandbox_url }
state: draft | approved
---
```

---

## PASO 0 — Leer configuración del proyecto

```bash
grep -E "ACCEPTANCE_FORMAT:|STORY_FORMAT:" CLAUDE.md 2>/dev/null
```

Variables:
- `ACCEPTANCE_FORMAT`: Gherkin (default) / checklist / tabla
- `STORY_FORMAT`: "Como/Quiero/Para" (default) / Jobs-to-be-done / otro

---

## PASO 1 — Obtener el input

Si `$ARGUMENTS` es un slug de brief:
```bash
ls docs/briefs/BRIEF-$ARGUMENTS-*.md 2>/dev/null | sort -r | head -1
```
Leer el brief más reciente.

Si `$ARGUMENTS` es texto descriptivo: usarlo directamente.

Si `$ARGUMENTS` está vacío:
```
¿Qué historia quieres diseñar?

  a) Dame el slug de un brief existente
  b) Descríbeme la épica o funcionalidad
  c) Pega el texto de la épica
```

---

## PASO 2 — Entrevista de diseño HDU

Presenta estas preguntas juntas:

```
Para generar la HDU necesito 4 cosas:

1. ¿Quién es el usuario principal?
   (ej: "Supervisor de ventas", "Administrador del sistema", "Cliente final")

2. ¿Qué quiere hacer exactamente?
   (la acción concreta, no el objetivo de negocio que ya está en el brief)

3. ¿Cuáles son los criterios para saber que está terminado?
   Dame 3-5 criterios observables por alguien no técnico.
   Ej: "El supervisor ve el ranking", "Puede filtrar por período", "Exporta a Excel"

4. ¿Qué está fuera de scope en esta HDU?
   (al menos 2 items — qué NO va en esta historia)
```

**Espera la respuesta antes de continuar.**

---

## PASO 3 — Generar la HDU

Usa el template `templates/capas/02-hdu.md`.

**Archivo a crear:** `docs/hdus/HDU-<slug>.md`

**Formato del criterio de aceptación según `ACCEPTANCE_FORMAT`:**

Gherkin (default):
```
Dado [contexto inicial]
Cuando [el usuario realiza la acción]
Entonces [el resultado observable]
```

Checklist:
```
- [ ] [criterio verificable por QA]
```

Tabla:
```
| Escenario | Acción del usuario | Resultado esperado |
```

**Estimación story points:**
| Complejidad | Puntos |
|-------------|--------|
| Simple (1 pantalla, sin integraciones) | 1-3 |
| Media (múltiples pantallas o 1 integración) | 5 |
| Alta (múltiples integraciones o lógica compleja) | 8 |
| Muy alta (nueva arquitectura o migración) | 13 |

Si supera 13 puntos: sugerir dividir la HDU.

---

## PASO 4 — Resumen

```
HDU generada: docs/hdus/HDU-<slug>.md
Estado: draft / ready
Story points: [N]

Criterios de aceptación: [N]
Items fuera de scope: [N]

Próximos pasos:
  1. Revisar criterios con el Jefe Dev / PMO y aprobar
  2. En modo platform: la HDU sincroniza automáticamente a DevFlow IA
  3. /new-spec [slug] → generar el SPEC técnico
```

---

## REGLAS

- Los criterios de aceptación son la esencia de la HDU — deben ser verificables por QA
- Mínimo 3 criterios, máximo 8 por HDU
- "Fuera de scope" es obligatorio: al menos 2 items
- Si la HDU supera 13 story points, proponer división antes de continuar
- Lenguaje de negocio, no técnico — el stakeholder debe poder leer y aprobar
- No mezclar múltiples roles en una HDU — una HDU por perfil de usuario
