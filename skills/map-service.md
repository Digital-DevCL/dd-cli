---
name: map-service
description: Genera diagrama Mermaid de la arquitectura interna del servicio (capas, flujos, integraciones)
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.1.0
category: Exploration
model: sonnet
model_rationale: Tarea balanceada — analiza estructura conocida y produce diagrama. No requiere razonamiento profundo de Opus salvo en código muy desestructurado
fallback_model: haiku
applies_to_dev_types: [brownfield-feature, brownfield-refactor, modernizacion]
reads:
  - "<repo>/<module>/**/*  (lectura)"
  - "<repo>/.ai/REPO-CONTEXT.md  (si existe)"
writes:
  - stdout (Mermaid + explicación)
  - opcional: <repo>/.ai/diagrams/<module>.md si --save
---

# `/map-service` — Diagrama Mermaid de arquitectura

## Cuándo usarla

- **Brownfield-refactor**: entender la arquitectura interna del módulo a refactorizar
- **Modernización**: visualizar servicios legacy a reemplazar
- **Documentación**: generar diagrama para README o Confluence sobre código existente

## Flags

```bash
/map-service                          # Analiza el repo entero (cwd)
/map-service <modulo>                 # Foca en un módulo específico
/map-service <modulo> --save          # Guarda en .ai/diagrams/<modulo>.md
/map-service --depth=N                # Profundidad de capas (default 3)
```

## Proceso

Analiza el código fuente del servicio (o módulo indicado) en la carpeta actual y genera un diagrama Mermaid de la arquitectura interna. El diagrama debe mostrar:

- Las capas del sistema (controller, service, repository, etc.)
- Los flujos principales de datos entre capas
- Las integraciones externas (bases de datos, colas, APIs externas)
- Los eventos que produce o consume (si los hay)

Devuelve el bloque ```mermaid``` listo para pegar en un README o en Confluence.
Luego da un párrafo de texto explicando el diagrama en lenguaje de negocio.

## Si existe `.ai/REPO-CONTEXT.md`

Lee la sección §3 (Arquitectura interna) y §4 (Entry points) como input.
No re-analiza desde cero — refina el diagrama con esa data.

## Reglas

1. **Read-only**
2. **Mermaid válido** — el output debe pasar `mermaid-cli validate`
3. **Una sola figura** — si el módulo es muy grande, sugerir dividir y emitir varios `/map-service` con `<modulo>` distintos
4. **Capas reconocibles** — usar nombres estándar del stack detectado (Controller/Service/Repository para NestJS; Handler/UseCase/Gateway para Clean Arch; etc.)

## Output esperado

```
\`\`\`mermaid
graph TD
  Client[Client] -->|HTTP| Controller
  Controller --> UseCase
  UseCase --> Repo
  Repo --> DB[(Database)]
  UseCase -->|publica| Bus[Message Bus]
\`\`\`

**Explicación:** El servicio expone endpoints REST a través de un Controller que delega a casos de uso. Los casos de uso orquestan acceso a la base de datos y publican eventos al bus de mensajes cuando hay cambios relevantes.
```
