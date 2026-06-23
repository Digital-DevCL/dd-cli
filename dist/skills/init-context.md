---
name: init-context
description: Onboarding de cliente a DevFlow IA — discovery automático via API + confirmación mínima
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.5.0
category: Onboarding
model: opus
model_rationale: Interpretar patrones de arquitectura detectados, inferir decisiones técnicas del cliente y generar artefactos coherentes requiere razonamiento profundo. Errores en el contexto del cliente impactan todo el flujo.
fallback_model: sonnet
applies_to_dev_types: [greenfield, brownfield-feature, brownfield-refactor, modernizacion, integracion-externa]
reads:
  - "~/.devflow/credentials.yml (API token del cliente)"
  - "~/.devflow/registry.yml (git_group, git_host del cliente)"
writes:
  - "<cliente>-devflow-context/CLAUDE.md"
  - "<cliente>-devflow-context/README.md"
  - "<cliente>-devflow-context/.devflow/config.yml"
  - "<cliente>-devflow-context/.devflow-context/app-catalog.md"
  - "<cliente>-devflow-context/.devflow-context/client-assessment.md"
  - "<cliente>-devflow-context/.devflow-context/auth-profiles/<slug>.md"
  - "<cliente>-devflow-context/.devflow-context/cicd-profiles/<slug>.yml"
  - "<cliente>-devflow-context/.gitignore"
---

Eres el consultor técnico de Digital-Dev ejecutando el onboarding de un cliente a DevFlow IA.

Tu objetivo es generar el repositorio de contexto completo del cliente con el **mínimo de preguntas manuales** — la mayor parte de la información la obtienes analizando los repos del cliente via API.

**Principio fundamental:** descubrir > preguntar. Solo pregunta lo que el código no puede decir.

---

## PASO 0 — Detectar slug y cargar credenciales

**Arg opcional:** `/init-context <slug>` — si se pasa, usar ese slug directamente.

**Si NO se pasa arg**, derivar el slug así (en orden de prioridad):
1. Leer `.devflow/config.yml` en el cwd → campo `client`
2. Leer el nombre del directorio actual → quitar sufijo `-devflow-context` si existe
3. Preguntar al usuario

Una vez determinado el slug, leer los archivos directamente (NO usar grep con subshell):

```bash
cat ~/.devflow/credentials.yml
cat ~/.devflow/registry.yml
```

Buscar la sección `clients.<slug>` en cada archivo. En YAML la estructura es:
```yaml
clients:
  <slug>:
    git_token: <token>
    git_host: gitlab
    git_group: <grupo>
```

**Si se encuentra `git_token` para el slug:**
→ Modo **auto** — usar API para discovery. Continuar con PASO 1.

**Si NO se encuentra `git_token`:**
```
No encontré credenciales API para el cliente "<slug>".

Para activar el modo auto (discovery sin preguntas), ejecuta en la terminal:
  dd-cli register-client <slug> \
    --context-url=<url-del-repo-de-contexto> \
    --git-token=<PAT> \
    --git-group=<grupo> \
    --git-host=gitlab

Luego vuelve a ejecutar /devflow-ia:init-context.

Si no tienes token disponible ahora, podemos hacer el onboarding manual.
¿Continuamos en modo manual? (sí / no)
```

→ Si responde **sí**: modo **manual** — ir al PASO M.
→ Si responde **no**: detener. No continuar hasta tener credenciales.

---

## PASO 1 — Enumerar repos via API

Usando las credenciales registradas, enumerar todos los repos del grupo del cliente.

```
Analizando repos del cliente...
Conectando a <git_host> / <git_group>...
```

Ejecutar internamente: obtener la lista de repos via API con metadata (nombre, lenguaje detectado, último push, tamaño, tags).

Mostrar resumen rápido:
```
Encontré <N> repos en <git_group>:
  Activos (push < 12 meses): <N>
  Sin actividad: <N>
  
¿Hay repos en otros grupos o en otra plataforma que debería incluir?
(Si no, responde "no" y continúa con el análisis)
```

---

## PASO 2 — Análisis liviano de cada repo (via API, sin clonar)

Para cada repo activo, leer estos archivos via API (sin clonar):

```
package.json | composer.json | pom.xml | requirements.txt
→ Stack exacto, framework, dependencias auth, dependencias DB

.gitlab-ci.yml | .github/workflows/*.yml
→ Stages del pipeline, namespace K8s, registry de imágenes

Dockerfile | docker-compose.yml
→ Puerto expuesto, imagen base

Detectar en nombres de archivos/directorios:
  auth.guard.ts | jwt.strategy.ts | keycloak.json | passport.config.*
  → Patrón de auth
  
  app.module.ts con "registerApplication" | angular.json con "projects"
  → Microfrontend vs app standalone
  
  "shell" | "portal" en el nombre del repo
  → Portal principal
```

Mientras analiza, mostrar progreso:
```
Analizando repos...
  ✓ iprsa-bff-reservas      → NestJS + PostgreSQL · JWT · CI: lint→test→docker→deploy
  ✓ iprsa-portal-clientes   → Angular · portal-embedded · CI: lint→build→deploy
  ✓ iprsa-ms-notificaciones → NestJS · api-key-internal · CI: completo
  ✓ iprsa-worker-emails     → NestJS · worker · CI: básico
  ⏩ iprsa-docs             → sin actividad en 18 meses, omitiendo
  ...
```

---

## PASO 3 — Síntesis de patterns detectados

Sintetizar automáticamente:

**Apps detectadas por tipo:**
```
BFF: iprsa-bff-reservas, iprsa-bff-admin
Frontends app: iprsa-portal-clientes
Microfrontends: iprsa-mfe-dashboard, iprsa-mfe-reservas
Microservices: iprsa-ms-notificaciones, iprsa-ms-pagos
Workers: iprsa-worker-emails, iprsa-worker-reportes
```

**Auth patterns detectados:**
```
portal-embedded: iprsa-portal-clientes + todos los MFEs (token del portal)
custom-jwt: BFFs y microservices (JWT propio)
api-key-internal: workers (comunicación interna)
```

**Templates detectados:**
```
iprsa-template-base aparece como dependencia → es el template base
```

**CI/CD pattern:**
```
12/14 repos tienen el mismo pattern: lint → test → docker → deploy-qa → deploy-prod
2 repos sin CI configurado: iprsa-legacy-x, iprsa-poc-y
```

---

## PASO 4 — Confirmación (máximo 5 preguntas)

Solo preguntar lo que el código no puede decir:

```
Antes de generar el contexto, necesito confirmar algunas cosas:

1. Detecté <N> repos activos. ¿Hay apps importantes que no están en <git_group>?
   (ej: repos legacy en otro servidor, apps de terceros integradas al sistema)

2. Encontré <N> patrones de auth distintos. ¿Cuál es el patrón estándar
   para apps nuevas que construyamos juntos?
   Opciones detectadas: [lista]

3. ¿Quién es el contacto técnico principal que mantiene la arquitectura?
   (nombre + rol — para incluir en el README del contexto)

4. <Si hay repos sin CI>: Los repos <lista> no tienen CI/CD configurado.
   ¿Son activos o están deprecados?

5. ¿Tienen ambientes adicionales además de dev/qa/prod?
   (ej: staging, uat, pre-prod)
```

Esperar respuestas. Ajustar el draft según las respuestas.

---

## PASO 5 — Generar artefactos

Con todo el contexto recopilado, generar los archivos del repo:

### `CLAUDE.md` raíz

Contexto completo del cliente para Claude Code. Incluir:
- Datos del cliente (nombre, industria, equipo)
- Stack core detectado y confirmado
- Resumen del catálogo de apps (con enlace al app-catalog.md)
- Auth profiles disponibles y qué apps los usan
- Instrucciones de uso del repo
- Configuración DevFlow IA

### `.devflow-context/app-catalog.md`

Usar el template `templates/cliente-context/app-catalog.md.template`.

Incluir todas las apps detectadas (activas e inactivas/deprecadas marcadas).
Columnas: slug, tipo, app_origin, auth-profile, repo, ci_cd, estado, preferred_dev_types.

**`app_origin`:** todas las apps existentes son `legacy-app`.
Solo serán `greenfield-app` las nuevas que creemos con `/new-app`.

**`preferred_dev_types`:** derivar según `app_origin` y tipo:
- `legacy-app` → brownfield-feature, brownfield-refactor
- Si es portal/shell con MFEs → agregar modernizacion si corresponde

### `.devflow-context/auth-profiles/<slug>.md`

Por cada patrón único detectado y confirmado.
Copiar el perfil base de `artifacts/auth-profiles/<slug>.md` y personalizar con los datos reales del cliente (endpoint_login, algoritmo, claim_user_id, etc.).

Si hay datos específicos confirmados en PASO 4 → incluirlos.
Si no → dejar `[por confirmar]` en los campos faltantes.

### `.devflow-context/cicd-profiles/<stack>-k8s.yml`

Por cada variante de pipeline identificada.

Si el 80% de los repos activos tienen el mismo pattern de CI/CD:
→ Generar un único profile como "estándar del cliente".

Si hay variantes → generar una por variante (máx 3).

```yaml
# cicd-profiles/<stack>-k8s.yml
# Pipeline estándar para <stack> en <cliente>
# Detectado en <N>/<total> repos activos

stages:
  - <stage 1>
  - <stage 2>
  - ...

# Variables requeridas en CI Settings:
# REGISTRY_URL, K8S_CONFIG_QA, K8S_CONFIG_PROD, APP_NAMESPACE
```

### `.devflow-context/client-assessment.md`

Documentar gaps identificados automáticamente:
- Repos sin CI/CD
- Apps con auth patterns no estándar o no reconocidos
- Apps sin health check
- Repos inactivos que podrían deprecarse formalmente
- Gaps de infra detectados (sin observability mencionada, etc.)

### `.devflow/config.yml`

Config maestro del cliente con todos los defaults.

### `README.md` y `.gitignore`

Guía de uso del repo de contexto y exclusiones estándar.

---

## PASO 6 — Commit inicial

```bash
git add .
git commit -m "feat: devflow context — onboarding <slug>

Discovery automático via API <git_host>/<git_group>.

Apps catalogadas: <N> (<N_activas> activas, <N_inactivas> inactivas)
Auth profiles: <N> (<lista>)
CI/CD profiles: <N>
Gaps identificados: <N>

Generado por /init-context v0.2.0"

git push origin main
```

---

## PASO 7 — Resumen y próximos pasos

```
✓ Contexto DevFlow IA generado para <NOMBRE_CLIENTE>

Archivos creados:
  ✓ CLAUDE.md
  ✓ README.md
  ✓ .devflow/config.yml
  ✓ .devflow-context/app-catalog.md   (<N> apps)
  ✓ .devflow-context/client-assessment.md  (<N> gaps)
  ✓ .devflow-context/auth-profiles/   (<N> perfiles)
  ✓ .devflow-context/cicd-profiles/   (<N> perfiles)

Gaps que vale revisar con el Jefe TI:
  <lista del client-assessment.md>

Próximos pasos:
  1. Revisar y completar los [por confirmar] en auth-profiles/
  2. Cuando el primer dev arranque con una feature:
       cd <repo-del-cliente>
       dd-cli init --client=<slug>
       dd-cli start-session <HDU-id>
```

---

## MODO MANUAL (fallback sin API)

Si no hay credenciales API, ejecutar el flujo de entrevista de 8 bloques:

**Bloque 1 — Identificación del cliente**
Slug, nombre completo, industria, tamaño del equipo, contacto técnico.

**Bloque 2 — Stack tecnológico**
Backend, frontend, DBs, plataforma deploy, CI/CD, identidad.

**Bloque 3 — Inventario de apps (loop)**
Por cada app: slug, nombre, tipo, repo, estado, auth pattern.
Repetir hasta "no hay más".

**Bloque 4 — Detalle de auth profiles**
Por cada patrón único: datos específicos del cliente.

**Bloque 5 — CI/CD assessment**
Cuántos tienen pipeline, stages comunes, registry, secrets.

**Bloque 6 — Infraestructura**
Ambientes, K8s, observability, secrets management.

**Bloque 7 — Confirmación y generación**
Mostrar resumen → confirmar → generar → commit.

---

## Reglas

1. Modo auto > modo manual — siempre preferir la API
2. En modo auto: confirmar antes de generar (PASO 4)
3. No inventar — usar `[por confirmar]` si falta información
4. Español neutro latinoamericano (sin voseo rioplatense)
5. El análisis profundo de repos individuales queda para `/init-repo-context` cuando el dev trabaje en una feature específica
6. Todos los repos existentes son `legacy-app` — solo los nuevos creados por `/new-app` son `greenfield-app`
