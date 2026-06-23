---
name: trace-flow
description: Traza el flujo completo de comunicación cross-service y genera diagramas editables. Multi-stack — funciona con monolitos (Laravel, Django, .NET), microservicios (Node, Java) y sistemas legacy.
origin: Digital-Dev
license: proprietary
managed-by: "@devflow-ia/cli"
version: 0.4.0
category: Exploration
model: opus
model_rationale: Trazar flujos cross-service en código real requiere razonamiento profundo — seguir llamadas a través de capas, identificar disparadores asíncronos, distinguir el camino feliz de las ramas de error
fallback_model: sonnet
applies_to_dev_types: [brownfield-refactor, modernizacion]
supported_stacks: [node, php-laravel, python-django, dotnet, java-spring, go, generic, mixed-legacy]
reads:
  - "<repo>/**/*  o monorepo entero"
  - "<repo>/.ai/REPO-CONTEXT.md"
writes:
  - "<repo>/.ai/flows/<dominio>.md"
  - "<repo>/.ai/flows/<dominio>.drawio  (editable multi-hoja)"
---

# `/trace-flow` — Traza de comunicación cross-service (multi-stack)

## Cuándo usarla

- **Modernización**: entender cómo fluye un proceso de negocio en el legacy antes de reemplazarlo — monolito Laravel, Django, .NET legacy, sistema TRIO-like
- **Brownfield-refactor cross-service**: cuando el refactor toca varios servicios encadenados
- **Documentación de procesos críticos**: generar mapa de un proceso de negocio no documentado

## Flags

```bash
/trace-flow --scope=<dominio>             # Traza el flujo de un dominio (ej: "cobranza")
/trace-flow --from=<entry>                # Empieza desde un endpoint o evento específico
/trace-flow --max-hops=N                  # Limita profundidad (default 10)
/trace-flow --include-errors              # Incluye ramas de error y retries
```

## Proceso

### Paso 1 — Detectar contexto del sistema

Leer `.ai/REPO-CONTEXT.md` si existe. Si no:
```bash
# Detectar si es monolito vs microservicios
test -f composer.json -o -f manage.py -o -f Gemfile && echo "probable monolito"
ls services/ apps/ 2>/dev/null && echo "probable monorepo/microservicios"
```

Identificar el tipo de sistema para saber qué llamadas buscar:
- **Monolito PHP/Laravel/Django/Rails** → llamadas internas (clases/métodos), jobs async, eventos de dominio, APIs externas
- **Monolito .NET** → llamadas entre proyectos, MediatR commands, servicios Windows, COM/DCOM legacy
- **Microservicios Node/Java/Go** → HTTP entre servicios, gRPC, message queues (RabbitMQ, Kafka, SQS)
- **Sistema legacy mixto** → combinación de lo anterior + llamadas a stored procedures, FTP, archivos planos

### Paso 2 — Identificar scope

El usuario indica:
- Dominio de negocio (ej: "cobranza", "auth", "pagos", "reservas") → busca módulos relacionados
- Endpoint específico (ej: `POST /api/contratos/:id/cobrar`) → arranca ahí
- Evento (ej: `pago.received`, `ReservaCreated`) → empieza desde el listener
- Proceso batch (ej: "cierre mensual", "envío de estados de cuenta") → empieza desde el cron/command

### Paso 3 — Trazar llamadas por stack

#### PHP / Laravel
```bash
# Entry points de routes
grep -E "Route::(get|post|put|patch|delete)" routes/api.php routes/web.php | grep -i "<scope>"

# Jobs y queues
grep -rE "dispatch\(|->dispatch\(" app/ --include="*.php" | grep -i "<scope>"
grep -rE "class.*Job|implements.*ShouldQueue" app/Jobs/ --include="*.php"

# Eventos y listeners
grep -rE "event\(new |Event::dispatch" app/ --include="*.php" | grep -i "<scope>"
grep -rE "class.*Listener|protected \$listen" app/Providers/EventServiceProvider.php

# Llamadas a APIs externas
grep -rE "Http::get|Http::post|Guzzle|curl_exec" app/ --include="*.php" | grep -i "<scope>"

# Stored procedures (si legacy con SP)
grep -rE "DB::statement|DB::select.*EXEC\|CALL\|PROCEDURE" app/ --include="*.php"
```

#### Python / Django
```bash
# URLs → Views
grep -rE "path\(.*views\." */urls.py | grep -i "<scope>"

# Signals
grep -rE "post_save|pre_save|@receiver" --include="*.py" . | grep -i "<scope>"

# Celery tasks
grep -rE "@shared_task|@app.task" --include="*.py" . | grep -i "<scope>"

# Llamadas HTTP externas
grep -rE "requests\.(get|post)|httpx\." --include="*.py" . | grep -i "<scope>"
```

#### .NET
```bash
# Controllers y endpoints
grep -rE "\[Route\]|\[HttpGet\]|\[HttpPost\]" --include="*.cs" . | grep -i "<scope>"

# MediatR commands/queries
grep -rE "IRequest|ICommand|IQuery|Send\(" --include="*.cs" . | grep -i "<scope>"

# Background services y timers
grep -rE "IHostedService|BackgroundService|Timer" --include="*.cs" . | grep -i "<scope>"

# WCF / Web Services (legacy)
grep -rE "\[ServiceContract\]|\[OperationContract\]" --include="*.cs" .
```

#### Node / NestJS / Express
```bash
# Controllers y routes
grep -rE "@Controller|@Get|@Post|router\.(get|post)" src/ | grep -i "<scope>"

# Events y queues
grep -rE "EventEmitter|@OnEvent|BullMQ|kafkaProducer" src/ | grep -i "<scope>"

# Llamadas a otros servicios
grep -rE "HttpService|axios|fetch" src/ | grep -i "<scope>"
```

#### Java / Spring
```bash
# Controllers
grep -rE "@RestController|@Controller|@RequestMapping" src/ --include="*.java" | grep -i "<scope>"

# @Async y @Scheduled
grep -rE "@Async|@Scheduled|@EventListener" src/ --include="*.java" | grep -i "<scope>"

# Feign clients (llamadas HTTP entre servicios)
grep -rE "@FeignClient" src/ --include="*.java"

# RabbitMQ / Kafka
grep -rE "@RabbitListener|@KafkaListener|rabbitTemplate\." src/ --include="*.java"
```

#### Generic / Legacy mixto
Si el sistema es un legacy no reconocible, hacer entrevista:
```
No pude determinar el mecanismo de comunicación automáticamente.
Ayúdame a entender el sistema:

1. ¿Cómo se comunican los módulos internamente? (llamadas directas, mensajes, archivos, DB compartida)
2. ¿Hay procesos batch o cron? (ej: cierre nocturno, imports de archivos)
3. ¿Usa stored procedures o triggers en la base de datos?
4. ¿Hay integraciones con sistemas externos? (APIs, FTP, archivos planos)
```

### Paso 4 — Distinguir caminos

- **Happy path**: flujo principal en condiciones normales
- **Branches de error**: qué pasa si falla cada llamada
- **Async fan-out**: cuando un evento dispara múltiples listeners

Si `--include-errors=false` (default) → solo happy path.

### Paso 5 — Generar artefactos

**Archivo 1: `<repo>/.ai/flows/<dominio>.md`**

```markdown
# Flujo: <dominio>

## Resumen
<2-3 líneas explicando el proceso de negocio>

## Stack del sistema
<Stack detectado — monolito Laravel / microservicios Node / legacy .NET / etc.>

## Trazabilidad

| # | Origen | Destino | Mecanismo | Stack | Notas |
|---|---|---|---|---|---|
| 1 | Browser | routes/api.php | POST /reservas | Laravel router | auth: Sanctum |
| 2 | ReservaController | ReservaService | method call | PHP/Laravel | valida StoreRequest |
| 3 | ReservaService | Reserva (Eloquent) | save() | PostgreSQL | transacción |
| 4 | ReservaService | SendConfirmationJob | dispatch() | Laravel Queue | async |
| 5 | Queue Worker | SendGrid API | HTTP POST | externa | retry x3 |

## Puntos críticos
- <salto donde el flujo es frágil>
- <salto donde hay deuda técnica / riesgo>
```

**Archivo 2: `<repo>/.ai/flows/<dominio>.drawio`** (editable multi-hoja)
- Hoja 1: Vista general del flujo (boxes + arrows)
- Hoja 2: Detalle de cada servicio/módulo involucrado
- Hoja 3 (si `--include-errors`): Ramas de error y retries

---

## Reglas

1. **Read-only sobre el código**
2. **Cita paths** — cada salto referencia el archivo y línea donde ocurre la llamada
3. **No inventes** — si no encuentras un destino concreto, márcalo `<no-determinado>` con razón
4. **Determinista** — mismo HEAD, mismo scope → mismo output
5. **Nomenclatura del stack** — usar los nombres reales del framework, no imponer vocabulario microservicios sobre un monolito
6. **Genera el .drawio sintácticamente válido** — el archivo debe abrirse sin errores en drawio

---

## Si existe `.ai/REPO-CONTEXT.md`

Leer §6 (Integraciones externas) — pre-popula las flechas hacia sistemas externos sin necesitar re-analizar.

---

## Output esperado al usuario (ejemplo Laravel)

```
✓ Flujo trazado: reservas
  Sistema:  monolito PHP/Laravel 10
  Hops:     8 (4 internos + 2 integraciones externas + 1 queue + 1 cron)
  Happy path: 6 saltos
  Branches de error: excluidas (usa --include-errors)

Archivos generados:
  .ai/flows/reservas.md
  .ai/flows/reservas.drawio  (3 hojas)

Puntos críticos detectados:
  ⚠ Salto 4: SendConfirmationJob sin retry configurado
  ⚠ Salto 6: llamada a API de pagos sin timeout explícito
```
