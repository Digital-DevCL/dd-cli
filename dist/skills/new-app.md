---
name: new-app
description: Genera scaffolding inicial de una nueva app — solo válida para dev_type=greenfield. Detecta si hay templates configurados y opera en modo template o modo from-scratch.
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.3.0
category: Onboarding
tags: [scaffolding, app, devflow-ia]
model: sonnet
model_rationale: Ensamblaje desde artefactos (auth + cicd + Dockerfile + claude-fragments). No requiere decisiones de Opus — la decisión la tomó el consultor al validar templates del catálogo
fallback_model: haiku
applies_to_dev_types: [greenfield]
reads:
  - "CLAUDE.md"
  - ".devflow/session.json (dev_type)"
  - ".devflow-context/app-catalog.md (template_origin por app-type)"
  - ".devflow-context/auth-profiles/<perfil>.md"
writes:
  - "<APPS_PATH>/<slug>/  (scaffolding completo)"
enforcement_rules_evaluated:
  - BLOCK_NEW_APP
---

Eres un arquitecto de software experto en el método DevFlow IA. Tu objetivo es generar el scaffolding inicial para una nueva app o servicio: archivos `.ai/`, CLAUDE.md y la estructura de directorios base según el stack del proyecto.

**Importante: este skill SOLO aplica a `dev_type == greenfield`. Para todos los demás tipos está bloqueado.**

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

## PASO 0b — Detectar modo: ¿hay templates de código configurados?

Buscar en el CLAUDE.md (o en `.devflow-context/app-catalog.md` si existe) si hay templates de código registrados:

```bash
grep -iE "template|Template" CLAUDE.md 2>/dev/null | grep -i "http\|gitlab\|github\|url" | head -10
cat .devflow-context/app-catalog.md 2>/dev/null | grep -i "template_origin" | head -10
```

### Caso A — Templates configurados ✅

Hay URLs de repos template en el CLAUDE.md o `template_origin` en el app-catalog.

→ **Modo template**: usar el template correspondiente al tipo de app que se va a crear.
→ Continuar con PASO 1 normalmente.

---

### Caso B — Sin templates, pero stack definido ⚠️

El CLAUDE.md tiene `STACK`, `BACKEND_FRAMEWORK`, `FRONTEND_FRAMEWORK` etc., pero NO hay templates de código registrados. Esto ocurre cuando:
- La arquitectura ya está diseñada pero es la primera app que se construye
- La empresa aún no tiene templates propios estandarizados
- Están arrancando desde cero con una arquitectura definida

**Mostrar advertencia:**

```
⚠️  No encontré templates de código configurados para este proyecto.

Situación detectada:
  Stack definido:  {{STACK del CLAUDE.md}}
  Templates:       No configurados

Esto significa que voy a generar el scaffolding desde cero siguiendo
las buenas prácticas del stack definido — sin aplicar plantillas
propias de la empresa todavía.

Opciones:
  A) Continuar en modo "from scratch" (recomendado si es la primera app)
     El scaffolding generado puede convertirse en el template base de la empresa.

  B) Definir el template primero
     Si ya existe un repo template, agrega en el CLAUDE.md:
       ## Templates de código
       - backend: https://gitlab.com/<grupo>/<repo-template>
       - frontend: https://gitlab.com/<grupo>/<repo-template-fe>
     Luego vuelve a ejecutar /new-app.

¿Continuar en modo "from scratch"? (sí / no)
```

**Si dice sí → Modo from-scratch**: continuar con PASO 1 con una advertencia activa.
**Si dice no → Abortar** con instrucciones para registrar el template primero.

---

### Caso C — Stack no definido en absoluto ❌

No hay `STACK`, `BACKEND_FRAMEWORK` ni templates. El proyecto no tiene suficiente contexto.

```
✗  No puedo generar el scaffolding — faltan las definiciones mínimas del proyecto.

Necesito al menos uno de estos:
  - Templates de código configurados en el CLAUDE.md
  - Stack tecnológico definido (BACKEND_FRAMEWORK, FRONTEND_FRAMEWORK, INFRA, DB)

Soluciones:
  1. Si ya tienes templates: agrégalos en el CLAUDE.md (ver guia-empresa.md §6)
  2. Si es un proyecto nuevo sin nada definido aún:
     - Completa las variables {{...}} en el CLAUDE.md (creado por dd-cli init)
     - O ejecuta /init-context para generar el contexto del cliente desde los repos
```

**Abortar — no continuar.**

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

Mostrar el modo activo y los archivos a generar:

```
Voy a crear el scaffolding para: [SLUG]
Tipo: [tipo]
Stack: [STACK extraído del CLAUDE.md]
Modo: [🔷 desde template: <nombre-template> | ⚠️ from-scratch (sin template)]
Spec asociado: [nombre o "ninguno — completar después con /new-spec"]

Archivos a generar:
  [APPS_PATH]/[SLUG]/.ai/CONTEXT.md
  [APPS_PATH]/[SLUG]/.ai/SPEC.md
  [APPS_PATH]/[SLUG]/.ai/PROGRESS.md
  [APPS_PATH]/[SLUG]/CLAUDE.md
  [estructura base según STACK / INFRA]
  [Si modo from-scratch: estructura completa de código base]

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

## PASO 3b — Scaffolding from-scratch (solo si Caso B del PASO 0b)

Si se confirmó el modo from-scratch, generar la estructura de código completa siguiendo las buenas prácticas del stack. No es solo el esqueleto — debe ser un punto de partida real y funcional.

### Backend (NestJS ejemplo)

```
[APPS_PATH]/[SLUG]/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── app.controller.ts
│   ├── app.service.ts
│   ├── health/
│   │   └── health.controller.ts   ← health check para K8s
│   └── config/
│       └── configuration.ts       ← tipado de variables de entorno
├── test/
│   └── app.e2e-spec.ts
├── package.json                   ← con las dependencias estándar del stack
├── tsconfig.json
├── .env.example                   ← variables requeridas, sin valores
├── Dockerfile
└── README.md
```

### Frontend (Angular ejemplo)

```
[APPS_PATH]/[SLUG]/
├── src/
│   ├── app/
│   │   ├── app.component.ts
│   │   ├── app.module.ts
│   │   └── core/
│   │       ├── auth/              ← integración con auth-profile del cliente
│   │       └── http/              ← interceptors, error handling
│   ├── environments/
│   │   ├── environment.ts
│   │   └── environment.prod.ts
│   └── main.ts
├── angular.json
├── package.json
└── Dockerfile
```

**Principios del from-scratch:**
- El código debe compilar en verde desde el primer momento (`npm run build` pasa)
- Incluir un health check mínimo funcional
- Las variables de entorno documentadas en `.env.example`
- El auth-profile del cliente integrado (leer `.devflow-context/auth-profiles/`)
- Si hay CI/CD profile, generar el pipeline desde ese profile
- Sin lógica de negocio — solo la estructura y los wires mínimos

**Al finalizar, mostrar:**

```
⚠️  Scaffolding from-scratch completado.

Este resultado es el candidato a convertirse en el template estándar
de la empresa para apps de tipo [tipo].

Próximo paso recomendado (Tech Lead):
  1. Revisar y ajustar el código generado
  2. Crear un repo template con este contenido:
       git checkout -b template-base
       # ajustar, limpiar valores específicos del proyecto
       git push origin template-base
  3. Registrar el template en el CLAUDE.md:
       ## Templates de código
       - [tipo]: https://gitlab.com/<grupo>/<slug>
  4. La próxima vez que ejecutes /new-app, usará este template.
```

---

## PASO 4 — Estructura de infra según stack

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
Modo usado: [🔷 desde template: <nombre> | ⚠️ from-scratch]

Archivos creados: [N]
  .ai/              (CONTEXT.md, SPEC.md, PROGRESS.md)
  CLAUDE.md
  [código base si from-scratch]
  [estructura de infra según STACK]

────────────────────────────────────
PRÓXIMOS PASOS:

[Si modo template:]
1. Crear el SPEC maestro:
   /new-spec
2. Derivar el .ai/SPEC.md:
   /derive-spec [spec-slug] [SLUG]
3. Registrar la app en el sistema de autenticación
   (ver auth-profiles en el CLAUDE.md del proyecto)
4. Primer deploy: [instrucción según INFRA]

[Si modo from-scratch:]
1. Verificar que compila: [comando según stack]
2. Revisar y ajustar el scaffolding generado
3. Crear el SPEC maestro: /new-spec
4. (Tech Lead) Considerar convertir este scaffolding en template de la empresa
   Ver instrucciones al final del PASO 3b.
────────────────────────────────────

⚠️ Secrets: nunca commitear valores reales. Usar .env.example como referencia.
```

---

## REGLAS

- Generar solo scaffolding — no código de negocio
- Los secrets con valores reales nunca van al repositorio
- Si el CLAUDE.md del proyecto no tiene una variable necesaria, usar placeholder `[COMPLETAR]` y mencionarlo en el resumen
- Adaptar el CLAUDE.md de la app a las convenciones del proyecto padre
