# Diseño — Skill `/init-context`

**Tarea:** T0-001
**Fecha:** 2026-06-12
**Estado:** Diseño refinado — listo para implementar

> Onboarding de un cliente nuevo a DevFlow IA. Genera el repo de contexto que será
> la fuente única de verdad del cliente — corazón de datos del método para ese cliente.

---

## Decisiones cerradas

| Decisión | Resultado |
|---|---|
| Ubicación de `.devflow-context/` | Repo separado por cliente (ej: `pdr-devflow-context/`) |
| Discovery de apps | Manual vía entrevista (MVP). Auto-detect GitLab/GitHub queda para v0.2 |
| Operador | Consultor Digital-Dev en modo onboarding (entrevista experta) |
| Outputs | 4 artefactos core + CLAUDE.md raíz + config.yml maestro + README.md + commit inicial |

---

## Cuándo se ejecuta

```
Cliente firma propuesta DevFlow IA
       ↓
Consultor Digital-Dev agenda reunión de discovery (1-2 hrs)
       ↓
Consultor crea repo vacío: <cliente>-devflow-context/
       ↓
Consultor abre Claude Code en ese repo
       ↓
Ejecuta /init-context  ← este skill
       ↓
Entrevista guiada con Jefe Dev / arquitectos del cliente
       ↓
Repo de contexto poblado + commit inicial
       ↓
Push a GitLab/GitHub del cliente o de Digital-Dev (según acuerdo)
       ↓
Cliente listo para el primer /new-app o /new-spec
```

---

## Estructura del repo generado

```
<cliente>-devflow-context/
├── CLAUDE.md                          ← contexto Claude inmediato del cliente
├── README.md                          ← onboarding para humanos
├── .devflow/
│   └── config.yml                     ← runtime config MAESTRO del cliente
├── .devflow-context/
│   ├── app-catalog.md                 ← inventario de todas las apps
│   ├── client-assessment.md           ← gaps de CI/CD + infra detectados
│   ├── auth-profiles/
│   │   ├── portal-embedded.md         ← perfil personalizado del cliente
│   │   └── custom-jwt.md              ← otro perfil si lo tiene
│   └── cicd-profiles/
│       ├── gitlab-nodejs-k8s.yml      ← variante del happy path para este cliente
│       └── gitlab-oracle-bare.yml     ← variantes consultivas si las hay
└── .gitignore
```

---

## Flujo de la entrevista

### PASO 0 — Verificar contexto

```bash
# ¿Estamos en un directorio vacío o ya existe contexto?
ls -la .devflow-context/ 2>/dev/null
```

**Si existe `.devflow-context/`:**
```
Detecté un .devflow-context/ existente. ¿Qué quieres hacer?

  a) Modo update — agregar apps/perfiles nuevos al contexto existente
  b) Reset — descartar y empezar de cero (requiere confirmación)
  c) Cancelar
```

**Si está vacío:** continuar con PASO 1 (modo init).

---

### PASO 1 — Identificación del cliente

```
Vamos a generar el contexto DevFlow IA para tu cliente.
Te haré preguntas en bloques. Si no sabes algo, responde "pendiente".

Identificación del cliente:

1. Slug del cliente (kebab-case, sin espacios)
   Ej: pdr, iprsa, amass-group

2. Nombre completo
   Ej: "Parque del Recuerdo S.A."

3. Industria
   Ej: "Servicios funerarios", "Seguros", "Retail"

4. Tamaño del equipo de desarrollo (aproximado)
   Ej: 5, 12, 30+

5. ¿Quién será el contacto técnico principal para mantener este contexto?
   Nombre + rol (ej: "Carlos Pérez — Jefe de Desarrollo")
```

**Espera respuesta antes de continuar.**

---

### PASO 2 — Stack core del cliente

```
Stack tecnológico transversal del cliente:

1. Backend predominante: NestJS / Spring Boot / FastAPI / Laravel / .NET / otro
2. Frontend predominante: Angular / React / Next.js / Vue / otro
3. Bases de datos en uso (todas): PostgreSQL, Oracle, MySQL, MongoDB, otras
4. Plataforma de despliegue: K8s / Docker Swarm / VMs / serverless / mixto
5. Plataforma CI/CD: GitLab / GitHub Actions / Azure DevOps / Jenkins / otro
6. Plataforma de identidad: SSO interno / Azure AD / Google Workspace / Keycloak / otro

¿Hay alguna restricción o estándar técnico del cliente que debamos respetar?
(ej: "no usamos npm public", "todo debe pasar por nuestro registry", "DBs solo on-prem")
```

---

### PASO 3 — Inventario de apps (loop)

```
Inventario de apps. Vamos a ir una por una.
Puedes parar cuando quieras y completar después con /new-app.

App #1:

1. Slug (kebab-case): _______
2. Nombre descriptivo: _______
3. Tipo:
   - microservice    → API consumida por otras apps
   - bff             → backend-for-frontend
   - api-rest        → API expuesta a usuarios finales
   - frontend-app    → app standalone con UI
   - frontend-mfe    → microfrontend dentro de un shell
   - worker          → proceso de background
   - library         → librería compartida

4. Repo URL: _______
5. Estado: prod / qa / dev / nuevo / deprecado
6. Stack específico (si difiere del default): _______
7. Auth pattern (responderé después al consolidar perfiles): 
   - portal-embedded / oauth2-oidc / custom-jwt / api-key-internal / none-public / custom

¿Agregar otra app? (sí / no)
```

**Loop hasta `no`.**

Al terminar, mostrar resumen:
```
Apps capturadas: 12

  Microservices: 4
  BFFs: 3
  APIs REST: 1
  Frontends standalone: 1
  Microfrontends: 3

Estados:
  Producción: 8
  QA: 2
  Dev: 1
  Nuevos: 1
```

---

### PASO 4 — Consolidación de auth profiles

```
Detecté estos patrones de auth en tus apps:

  Patrón A — portal-embedded:
    Usado por: pdr-mf-cobranza, pdr-mf-sepultaciones, pdr-mf-clientes
    (3 apps)
    
  Patrón B — custom-jwt:
    Usado por: pdr-bff-sepultaciones, pdr-bff-cobranza
    (2 apps)

  Patrón C — none-public:
    Usado por: pdr-app-landing
    (1 app)

Para cada patrón único, necesito detalles:

PATRÓN A — portal-embedded:
  - URL del portal padre: _______
  - Variable de sesión heredada: _______
  - Mecanismo de comunicación con el portal: postMessage / cookie / iframe-bridge
  - Variables a leer de la sesión: _______
  - ¿Hay un service común para esto?: _______

PATRÓN B — custom-jwt:
  - Endpoint de validación: _______
  - Algoritmo: HS256 / RS256
  - Claims requeridos: _______
  - Refresh strategy: _______

[etc.]
```

Para cada patrón único, generar `.devflow-context/auth-profiles/<slug>.md` con los detalles.

---

### PASO 5 — Assessment de CI/CD

```
Pipeline assessment:

¿Cuántas de las 12 apps tienen actualmente CI/CD funcionando?
  - Todas
  - Mayoría (>50%)
  - Pocas (<50%)
  - Ninguna

De las que tienen pipeline, ¿usan un template común o cada una tiene su pipeline?

Para las que SÍ tienen pipeline funcional, ¿quieres que lo capturemos como
"perfil cliente" (lo replicamos para futuras apps)?

Apps SIN pipeline (gap a resolver):
  [lista de las que el dev marcó como "sin CI/CD"]
  → ¿se les aplica el happy path (gitlab-nodejs-k8s) o requieren consultoría?

Apps CON pipeline custom (potencial gap):
  [lista]
  → ¿podemos estandarizar al happy path, o el custom es necesario?
```

Para cada perfil CI/CD identificado, generar `.devflow-context/cicd-profiles/<slug>.yml`.

---

### PASO 6 — Assessment de infraestructura

```
Infraestructura:

1. ¿K8s self-managed, GKE, EKS, AKS, OCP, otro?
2. ¿Cuántos ambientes? (dev/qa/prod típico, o algo distinto)
3. ¿Tienen registry de imágenes propio? URL: _______
4. ¿Health checks estándar? (formato común en /health o cada app es distinta)
5. ¿Observability? Prometheus / Datadog / NewRelic / propio / ninguno
6. ¿Secrets management? Vault / Sealed Secrets / GitLab vars / variables de entorno

Gaps de infraestructura identificados:
  [auto-detectado por el skill basándose en respuestas anteriores]
```

---

### PASO 7 — Resumen pre-generación

```
Listo para generar el contexto. Esto es lo que voy a crear:

CLAUDE.md                          → contexto del cliente para Claude
README.md                          → onboarding para humanos
.devflow/config.yml                → runtime config maestro
.devflow-context/
  app-catalog.md                   → 12 apps inventariadas
  client-assessment.md             → 4 gaps identificados
  auth-profiles/
    portal-embedded.md             → personalizado para PDR
    custom-jwt.md                  → personalizado para PDR
  cicd-profiles/
    gitlab-nodejs-k8s.yml          → variante del happy path
.gitignore                         → estándar Node + DevFlow IA

Después de generar:
  → git init (si no es repo todavía)
  → git add . && git commit -m "feat: devflow context — onboarding pdr"

¿Continuar? (sí / ajustar algún punto)
```

---

### PASO 8 — Generación de artefactos

Generar todos los archivos atomically. Si algo falla, no dejar estado parcial.

#### 8.1 — `CLAUDE.md` raíz

```markdown
# {{nombre_cliente}} — Contexto DevFlow IA

Cliente: {{nombre_completo}}
Industria: {{industria}}
Slug: {{slug_cliente}}
Onboarding: {{fecha_hoy}}

## Stack core

- Backend: {{backend_framework}}
- Frontend: {{frontend_framework}}
- DBs: {{dbs}}
- Infra: {{infra}}
- CI/CD: {{cicd_platform}}

## Apps activas

Ver detalle completo en `.devflow-context/app-catalog.md`.

Total: {{n_apps}} apps ({{n_prod}} en producción, {{n_qa}} en QA, {{n_dev}} en dev)

## Auth profiles disponibles

{{lista_perfiles_con_apps_que_los_usan}}

## Cómo se usa este repo

- **Lee primero:** `.devflow-context/app-catalog.md`
- **Para agregar una nueva app:** ejecutar `/new-app` desde el repo de código (no desde aquí)
- **Para refrescar el contexto:** `/init-context --update`
- **Mantenido por:** {{contacto_tecnico}} (cliente) + Digital-Dev (release del CLI)

## Configuración DevFlow IA

DEVFLOW_MODE: local
DEVFLOW_URL: null
DEVFLOW_PROJECT: {{slug_cliente}}
```

#### 8.2 — `README.md`

```markdown
# {{nombre_cliente}} — DevFlow IA Context

Este repositorio es la **fuente única de verdad** del contexto DevFlow IA
para {{nombre_completo}}.

## ¿Qué hay aquí?

| Archivo | Propósito |
|---|---|
| `.devflow-context/app-catalog.md` | Inventario de todas las apps del cliente |
| `.devflow-context/auth-profiles/` | Patrones de autenticación en uso |
| `.devflow-context/cicd-profiles/` | Templates CI/CD para nuevas apps |
| `.devflow-context/client-assessment.md` | Gaps técnicos identificados |
| `.devflow/config.yml` | Configuración maestra (defaults para todos los repos) |
| `CLAUDE.md` | Contexto para Claude Code al abrir este repo |

## ¿Cuándo se actualiza?

- **Automáticamente:** cada `/new-app` ejecutado en un repo de código del cliente
  agrega la app nueva a `app-catalog.md` vía commit cross-repo.
- **Manualmente:** cuando aparece un patrón nuevo (nuevo auth profile, nueva DB,
  nueva plataforma CI), ejecutar `/init-context --update`.

## ¿Quién lo mantiene?

- **Digital-Dev (consultor):** durante el onboarding inicial y refreshes mayores
- **{{contacto_tecnico}}:** ajustes operativos y validación de cambios

## Flujos típicos

### Agregar una nueva app
1. Crear el repo de código de la app
2. En ese repo, ejecutar `/new-app`
3. El skill lee este contexto, ensambla artefactos y actualiza `app-catalog.md`

### Cambiar el auth profile de una app existente
1. Editar manualmente la fila correspondiente en `app-catalog.md`
2. Asegurar que el perfil destino existe en `auth-profiles/`
3. Commit con mensaje descriptivo

### Onboardear un dev nuevo
1. Clonar este repo
2. Leer README.md + CLAUDE.md + app-catalog.md
3. Ya tienes el mapa completo del cliente

---

Para más sobre DevFlow IA: [documentación interna de Digital-Dev]
```

#### 8.3 — `.devflow/config.yml`

```yaml
# Config maestro del cliente {{slug_cliente}}
# Heredan: todos los repos del cliente al ejecutar `dd-cli init`

project:
  client_slug: {{slug_cliente}}
  client_name: {{nombre_completo}}

naming:
  feature_id_pattern: "HDU-{n}"
  branch_pattern: "feature/{feature_id}-{slug}"
  spec_filename: "SPEC-{slug}.md"
  epic_filename: "EPIC-{slug}.md"

defaults:
  acceptance_format: gherkin
  story_format: como-quiero-para
  sprint_duration_weeks: 2
  main_branch: main

stack:
  backend_framework: {{backend_framework}}
  frontend_framework: {{frontend_framework}}
  infra: {{infra}}
  cicd_platform: {{cicd_platform}}

devflow:
  mode: local
  url: null
  project: {{slug_cliente}}
```

#### 8.4 — `.devflow-context/app-catalog.md`

(Usar el template T0-004 ya definido)

#### 8.5 — `.devflow-context/auth-profiles/<slug>.md`

Por cada patrón único detectado en PASO 4, generar un archivo con los detalles
específicos del cliente sobre ese perfil.

#### 8.6 — `.devflow-context/cicd-profiles/<slug>.yml`

Por cada perfil CI/CD identificado en PASO 5.

#### 8.7 — `.devflow-context/client-assessment.md`

```markdown
# Client Assessment — {{nombre_cliente}}

Fecha: {{fecha_hoy}}
Generado por: /init-context (onboarding)

## Gaps identificados

### CI/CD
- [{{n_apps_sin_pipeline}} apps sin pipeline]: lista detallada en sección abajo
- [{{n_apps_pipeline_custom}} apps con pipelines custom]: requieren evaluación

### Infraestructura
- [gaps específicos detectados]

### Auth
- [si hay apps con auth no documentado o ad-hoc]

## Decisiones tomadas durante onboarding

[Captura de razones cuando el dev tomó decisiones específicas]

## Próximos pasos sugeridos

1. {{accion_inmediata_1}}
2. {{accion_inmediata_2}}
```

#### 8.8 — `.gitignore`

```
node_modules/
.DS_Store
*.log
.env
.env.local

# DevFlow IA — runtime de sesión (no commitear)
.devflow/session.json
```

---

### PASO 9 — Commit inicial

```bash
# Solo si no es repo git todavía:
git init

git add .
git commit -m "feat: devflow context — onboarding {{slug_cliente}}

Setup inicial del contexto DevFlow IA para {{nombre_completo}}.

Apps inventariadas: {{n_apps}}
Auth profiles: {{n_perfiles}}
CI/CD profiles: {{n_cicd}}
Gaps identificados: {{n_gaps}}

Generado por /init-context v0.1.0"
```

---

### PASO 10 — Resumen final

```
✓ Contexto DevFlow IA generado para {{nombre_cliente}}

Archivos creados:
  ✓ CLAUDE.md
  ✓ README.md
  ✓ .devflow/config.yml
  ✓ .devflow-context/app-catalog.md ({{n_apps}} apps)
  ✓ .devflow-context/auth-profiles/ ({{n_perfiles}} perfiles)
  ✓ .devflow-context/cicd-profiles/ ({{n_cicd}} perfiles)
  ✓ .devflow-context/client-assessment.md ({{n_gaps}} gaps)
  ✓ .gitignore
  
Commit inicial creado: {{hash_commit}}

Próximos pasos:
  1. Push del repo a GitLab/GitHub del cliente
  2. Compartir acceso con el equipo del cliente
  3. Primer /new-app desde un repo de código del cliente
  4. Revisar gaps en client-assessment.md con el Jefe Dev
```

---

## Modo `--update`

Comportamiento alternativo cuando `.devflow-context/` ya existe:

- **No reescribe** archivos existentes
- Permite agregar:
  - Apps nuevas → append a `app-catalog.md`
  - Auth profiles nuevos → nuevo archivo en `auth-profiles/`
  - CI/CD profiles nuevos → nuevo archivo en `cicd-profiles/`
- Actualiza `client-assessment.md` con nuevos gaps
- Commit incremental: `"chore: devflow context update — {{descripcion}}"`

---

## Reglas del skill

- No inventar información — usar `[por confirmar]` para gaps
- Cada perfil único (auth o CI/CD) genera un archivo aparte — nunca consolidar todo en uno
- Confirmar el resumen antes de generar archivos (idempotencia importa)
- Si un archivo ya existe y el modo es `init`: pedir confirmación explícita
- Mantener atributo `version` en cada perfil generado (para evolución futura)
- Idioma español neutro (sin voseo)
- Tono: experto pero pedagógico (el consultor está aprendiendo del cliente)

---

## Frontmatter del skill

```yaml
---
name: init-context
description: Onboarding de cliente nuevo — genera el repo de contexto con app catalog, auth profiles y CI/CD profiles
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.1.0
category: Onboarding
tags: [onboarding, client, context, catalog, devflow-ia]
---
```

---

## Dependencias

- **Requiere:** T0-004 (template `app-catalog.md`) — sin esto no hay formato base
- **Requiere:** T0-002 (estructura artefactos composables) — para tener auth-profiles base que personalizar
- **Habilita:** T0-003 (refactor de `/new-app` para leer este contexto)

---

## Estimación actualizada

Comparado con la estimación original de 3-4 hrs:

| Componente | Estimado original | Refinado |
|---|---|---|
| Skill con entrevista (PASO 0-7) | 3-4 hrs | 4-5 hrs |
| Generación 3 artefactos core | incluido | incluido |
| CLAUDE.md raíz + README.md + .gitignore | no contemplado | +1 hr |
| config.yml maestro | no contemplado | +30 min |
| Commit inicial automático | no contemplado | +30 min |
| Modo `--update` | no contemplado | +1 hr |
| **Total refinado** | **3-4 hrs** | **7-8 hrs (~1 día)** |

El alcance creció pero el valor también — ahora `/init-context` deja el cliente
**totalmente operativo** después de un solo comando + entrevista.
