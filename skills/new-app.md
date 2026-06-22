---
name: new-app
description: Genera scaffolding inicial de una nueva app — solo válida para dev_type=greenfield
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.2.0
category: Onboarding
tags: [scaffolding, app, devflow-ia]
model: sonnet
model_rationale: Ensamblaje desde artefactos (auth + cicd + Dockerfile + claude-fragments). No requiere decisiones de Opus — la decisión la tomó el consultor al validar templates del catálogo
fallback_model: haiku
applies_to_dev_types: [greenfield]
reads:
  - "CLAUDE.md"
  - ".devflow/session.json (dev_type)"
  - ".devflow-context/templates/<app-type>/  (templates validated)"
  - ".devflow-context/auth-profiles/<perfil>.md"
writes:
  - "<APPS_PATH>/<slug>/  (scaffolding completo)"
enforcement_rules_evaluated:
  - BLOCK_NEW_APP
---

Eres un arquitecto de software experto en el método DevFlow IA. Tu objetivo es generar el scaffolding inicial para una nueva app o servicio: archivos `.ai/`, CLAUDE.md y la estructura de directorios base según el stack del proyecto.

**Importante: este skill SOLO aplica a `dev_type == greenfield`. Para todos los demás tipos está bloqueado.**

> Nota: este skill será refactorizado (T0-003) para leer artefactos composables desde `.devflow-context/` (auth-profiles, cicd-templates, claude-fragments).

**Argumento opcional:** `/new-app [slug]`

---

## PASO -1 — Validar dev_type (BLOCK_NEW_APP)

```bash
cat .devflow/session.json | jq -r '.dev_type'
```

**Si `dev_type != "greenfield"`:**

```
✗ /new-app solo aplica a HDUs greenfield.

Tu HDU actual es de tipo: <dev_type>.
Esto significa que estás trabajando sobre código existente.

Acciones según tu tipo:
  - brownfield-feature/refactor → usa /derive-spec sobre la app existente
  - modernizacion              → /trace-flow + /map-service para entender el legacy
  - integracion-externa        → /new-spec(I) directamente, el adaptador se genera ahí

Si querés crear una app NUEVA además del trabajo brownfield, abre una HDU separada
con dev_type=greenfield y vuelve a ejecutar /new-app desde esa sesión.
```

**Aborta — no continuar con los pasos siguientes.**

---

---

## PASO 0 — Leer configuración del proyecto

```bash
grep -E "STACK:|APPS_PATH:|SPEC_PATH:|BACKEND_FRAMEWORK:|FRONTEND_FRAMEWORK:|INFRA:|DB:" CLAUDE.md 2>/dev/null
```

Variables clave:
- `STACK`: descripción del stack tecnológico completo
- `APPS_PATH`: dónde viven las apps (default: `apps/`)
- `BACKEND_FRAMEWORK`: NestJS / Laravel / Django / Spring / .NET / etc.
- `FRONTEND_FRAMEWORK`: Angular / React / Next.js / Vue / etc.
- `INFRA`: K8s / Docker / serverless / bare-metal / etc.
- `DB`: PostgreSQL / MySQL / Oracle / MongoDB / etc.

---

## PASO 1 — Preguntas (una sola ronda)

Presenta todas juntas:

```
Voy a scaffoldear la nueva app. Necesito 4 cosas:

1. ¿Cuál es el slug de la app?
   (kebab-case, ej: dashboard-ventas, api-reportes, portal-clientes)
   [Si viene en $ARGUMENTS, proponer ese valor y confirmar]

2. ¿Qué tipo de app es?
   - backend-api    → API puro sin UI, consume datos, expone endpoints
   - frontend       → UI puro, sin lógica de negocio propia
   - fullstack      → UI + API en el mismo servicio
   - worker         → proceso de background / batch / event-driven
   - library        → librería compartida entre servicios

3. ¿Qué bases de datos o servicios externos necesita?
   (ej: base propia, base legacy [LEGACY_SYSTEM], ambas, ninguna)

4. ¿Implementa algún SPEC maestro existente?
   (slug del SPEC, o "ninguno" si todavía no hay spec)
```

**Espera la respuesta.**

---

## PASO 2 — Confirmar y mostrar plan

```
Voy a crear el scaffolding para: [SLUG]
Tipo: [tipo]
Stack: [STACK extraído del CLAUDE.md]
Spec asociado: [nombre o "ninguno — completar después con /new-spec"]

Archivos a generar:
  [APPS_PATH]/[SLUG]/.ai/CONTEXT.md
  [APPS_PATH]/[SLUG]/.ai/SPEC.md
  [APPS_PATH]/[SLUG]/.ai/PROGRESS.md
  [APPS_PATH]/[SLUG]/CLAUDE.md
  [estructura base según STACK / INFRA]

¿Continuar? (sí / ajustar algo)
```

---

## PASO 3 — Crear archivos .ai/

### 3a. `[APPS_PATH]/[SLUG]/.ai/CONTEXT.md`

Usar el template `templates/app-ai/CONTEXT.md`. Completar:
- Nombre de la app: [SLUG]
- Tipo: [tipo elegido]
- Stack: extraído del CLAUDE.md del proyecto
- Ecosistema: qué otras apps existen y cómo se relacionan

### 3b. `[APPS_PATH]/[SLUG]/.ai/SPEC.md`

```markdown
# Spec: [SLUG]

> Última actualización: [FECHA]
> Completar con /derive-spec [spec-slug] [SLUG] cuando el SPEC maestro esté listo.

| Feature | Spec Maestra | Estado |
|---------|-------------|--------|
| — | — | — |
```

### 3c. `[APPS_PATH]/[SLUG]/.ai/PROGRESS.md`

```markdown
# Progreso - [SLUG]

> Última actualización: [FECHA]

## Estado General

App creada. Pendiente: código fuente (ver setup inicial) y primer SPEC.

## Setup inicial

- [ ] Crear repositorio y clonar estructura base según stack
- [ ] Configurar variables de entorno (.env o equivalente)
- [ ] Crear SPEC maestro con /new-spec
- [ ] Derivar .ai/SPEC.md con /derive-spec
- [ ] Primer deploy / levantamiento local
```

### 3d. `[APPS_PATH]/[SLUG]/CLAUDE.md`

```markdown
# Instrucciones para el Copiloto — [SLUG]

> Leer `.ai/CONTEXT.md`, `.ai/SPEC.md` y `.ai/PROGRESS.md` al iniciar cada sesión.

## INICIO DE SESIÓN

### Paso 0: Verificar entorno

```bash
# Verificar que el entorno local está levantado
[comandos de verificación según STACK — ver CONTEXT.md]
```

### Paso 1: Leer contexto

1. `.ai/CONTEXT.md`   → arquitectura del ecosistema, patrones y convenciones
2. `.ai/SPEC.md`      → qué implementa esta app
3. `.ai/PROGRESS.md`  → estado actual y próximos pasos

### Paso 2: Mostrar estado

```
═══════════════════════════════════
  ESTADO: [SLUG]
═══════════════════════════════════
  Entorno:  [OK / ver arriba]
  Branch:   [nombre]
  Spec:     [Sin Spec / Draft / MVP Listo / Completa]
  
  Próxima acción: [según PROGRESS.md]
═══════════════════════════════════
```

**No escribir código hasta que el Spec esté en "MVP Listo" o superior.**

## CONVENCIONES

> Completar con las convenciones específicas del stack según el CLAUDE.md del proyecto padre.

[Copiado de la sección CONVENCIONES del CLAUDE.md del proyecto]

## FIN DE SESIÓN

Ejecutar `/end-session` desde el repositorio raíz para actualizar PROGRESS.md y BACKLOG.
```

---

## PASO 4 — Estructura base según stack

Leer `INFRA` del CLAUDE.md del proyecto y generar la estructura de directorios apropiada:

**Si INFRA = K8s:**
Crear:
- `[SLUG]/k8s/[ambiente]/deployment.yaml` (parametrizado con SLUG y namespace del proyecto)
- `[SLUG]/k8s/[ambiente]/service.yaml`
- `[SLUG]/k8s/[ambiente]/ingress.yaml`
- `[SLUG]/k8s/[ambiente]/configmap.yaml`

Usar los valores del CLAUDE.md del proyecto (namespace, registry, dominio) para completar los manifests.

**Si INFRA = Docker:**
Crear:
- `[SLUG]/Dockerfile` (skeleton según BACKEND_FRAMEWORK / FRONTEND_FRAMEWORK)
- `[SLUG]/docker-compose.yml` (con el servicio y las dependencias de DB)

**Si INFRA = serverless:**
Crear:
- `[SLUG]/serverless.yml` o equivalente según proveedor configurado

**Si INFRA no está definido o es otro:**
Crear un archivo `[SLUG]/SETUP.md` con el checklist de infraestructura a completar manualmente.

---

## PASO 5 — Resumen y próximos pasos

```
Scaffolding generado: [APPS_PATH]/[SLUG]/

Archivos creados: [N]
  .ai/              (CONTEXT.md, SPEC.md, PROGRESS.md)
  CLAUDE.md
  [estructura de infra según STACK]

────────────────────────────────────
PRÓXIMOS PASOS:

1. Crear el código fuente:
   [instrucción específica según BACKEND_FRAMEWORK / FRONTEND_FRAMEWORK]

2. Crear el SPEC maestro (si no existe):
   /new-spec [SLUG]

3. Derivar el .ai/SPEC.md:
   /derive-spec [spec-slug] [SLUG]

4. Registrar la app en el sistema de autenticación / gateway del proyecto
   (ver CLAUDE.md del proyecto para el proceso específico)

5. Primer deploy:
   [instrucción según INFRA]
────────────────────────────────────

⚠️ Si generé archivos de infraestructura con credenciales o secrets:
   - No commitear secrets con valores reales
   - Aplicar directamente al entorno sin pasar por git
```

---

## REGLAS

- Generar solo scaffolding — no código de negocio
- Los secrets con valores reales nunca van al repositorio
- Si el CLAUDE.md del proyecto no tiene una variable necesaria, usar placeholder `[COMPLETAR]` y mencionarlo en el resumen
- Adaptar el CLAUDE.md de la app a las convenciones del proyecto padre
