# `dd-cli` — DevFlow IA

El asistente de línea de comandos que guía tu trabajo de desarrollo paso a paso.

---

## ¿Qué es?

`dd-cli` conecta tu entorno local (Claude Code + código) con el método DevFlow IA.
Te dice **dónde estás** en el flujo, **qué va después**, y mantiene el estado de tu sesión automáticamente.

---

## Instalación

```bash
# Desde el repo Digital-Dev (mientras no está en npm público)
cd /ruta/al/repo/Digital-Dev/_Empresa/Herramientas/devflow-ia-metodo/cli-package
npm install
npm link
```

Verifica que funciona:

```bash
dd-cli --version   # → 0.2.0
```

---

## Setup en tu proyecto (una vez)

```bash
cd tu-proyecto
dd-cli init
```

Esto hace 3 cosas automáticamente:

1. Crea `.devflow/` con el estado local de tus sesiones
2. Instala las 19 skills en `~/.claude/skills/devflow-ia/`
3. Configura Claude Code para mostrar tu progreso en la barra inferior

Después edita `CLAUDE.md` que se generó en el proyecto y completa los datos reales del stack.

---

## Uso diario

### 1. Inicia tu sesión al empezar el día

```bash
dd-cli start-session <HDU-id>
```

Te va a preguntar:
- Nombre de la feature
- Tipo de trabajo (un menú de 5 opciones — elegís el que corresponde)
- Apps que vas a tocar
- Una justificación corta del tipo elegido

### 2. Abre Claude Code

```bash
claude
```

Claude va a saludarte con el contexto de tu sesión activa y sugerirte el primer paso.

### 3. Trabaja con las skills en Claude Code

```
❯ /new-spec          ← primer paso para cualquier feature
❯ /opsx:propose      ← diseñar la implementación
❯ /opsx:apply        ← programar task por task
❯ /release-check     ← verificar antes del MR
❯ /end-session       ← cerrar la sesión al terminar
```

### 4. Si en algún momento no sabes qué hacer

```bash
dd-cli next      # ← te dice exactamente qué tipear ahora
dd-cli status    # ← muestra tu viaje completo con check marks
dd-cli help-ctx  # ← comandos útiles para tu estado actual
```

---

## Comandos esenciales

| Comando | Cuándo usarlo |
|---|---|
| `dd-cli init` | Primera vez en un proyecto |
| `dd-cli start-session <id>` | Al empezar a trabajar cada día |
| `dd-cli status` | Para ver dónde estás en el flujo |
| `dd-cli next` | Cuando no sabes qué hacer |
| `dd-cli help-ctx` | Ver comandos disponibles según tu estado |
| `dd-cli end-session` | Si lo que cierra es el terminal (normalmente lo hace /end-session) |
| `dd-cli skills list` | Ver las 19 skills instaladas con su modelo recomendado |
| `dd-cli doctor` | Si algo no funciona como esperas |

---

## Lo que ves en Claude Code

Mientras trabajas, Claude Code muestra en la barra inferior:

```
HDU-128 · paso 3/8: /new-spec → /new-app · 42m  ⬢ brownfield-feature
```

Esto siempre está visible — te dice en qué paso del flujo estás y cuál viene después.

---

## Barra de estado opcional (para demos o pair programming)

Si quieres ver más detalle en un pane separado:

```bash
dd-cli watch    # levantar en otro pane de tmux/iTerm
```

---

## Los 5 tipos de trabajo

DevFlow IA entiende 5 tipos de desarrollo. Cada uno tiene un camino distinto:

| Tipo | Cuándo usarlo |
|---|---|
| `greenfield` | App o módulo nuevo, sin código previo |
| `brownfield-feature` | Agregar algo a una app existente |
| `brownfield-refactor` | Mejorar código sin cambiar lo que hace |
| `modernizacion` | Reemplazar un sistema legacy |
| `integracion-externa` | Conectar con un servicio de terceros (Stripe, Auth0, etc.) |

El tipo lo eliges cuando inicias la sesión. Cada tipo activa un flujo diferente de skills.

---

## ¿Algo no funciona?

```bash
dd-cli doctor          # diagnóstico completo del entorno
dd-cli status --raw    # modo técnico (para debug)
dd-cli skills verify   # verifica que las skills estén bien instaladas
```

---

## Versión actual

`0.2.0` — MVP local (sin conexión a plataforma todavía).
