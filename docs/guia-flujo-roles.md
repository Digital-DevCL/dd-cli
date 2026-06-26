# DevFlow IA — Flujo por rol

Referencia rápida de skills y comandos CLI por perfil. En orden de ejecución.

---

## Consultor Digital-Dev — Onboarding de cliente (una vez por cliente)

```
/devflow-ia:client-onboard
  └── dd-cli client new <slug>        → crea context repo en GitLab/GitHub
  └── dd-cli client discover <slug>   → detecta apps del grupo
  └── dd-cli client publish <slug>    → commit + push al context repo
```

---

## Tech Lead / PMO — Por épica o feature

### Crear HDUs (en Claude Code)

```
/devflow-ia:capture-req   → brief crudo → brief estandarizado + dev_type sugerido
/devflow-ia:enrich-us     → agrega edge cases, criterios de aceptación, riesgos
/devflow-ia:design-hdu    → genera el archivo HDU formal con Gherkin + estimación
```

### Gestionar HDUs (en terminal)

```
dd-cli hdu new "<título>" --client=<slug>   → crea draft en context repo
dd-cli hdu approve <HDU-N>                  → Tech Lead aprueba
dd-cli hdu assign <HDU-N> --to=<email>      → asigna al dev
dd-cli client publish <slug>                → sincroniza al remoto
```

### Sprint (en terminal)

```
dd-cli sprint new --client=<slug>           → abre sprint
dd-cli sprint add <HDU-N>                   → agrega HDUs al sprint
```

### Board y métricas (en Claude Code)

```
/devflow-ia:hdu-board     → gestión conversacional del board (triage, aprobar, asignar)
/devflow-ia:stats-review  → interpreta métricas de throughput y lead time
```

---

## Dev — Por HDU asignada

### Cada mañana (en Claude Code)

```
/devflow-ia:daily-standup → qué tengo hoy + inbox + alertas
/devflow-ia:pick-next     → scoring de qué HDU tomar
```

### Arrancar una HDU (en Claude Code → terminal)

```
/devflow-ia:start-work HDU-N
  └── dd-cli hdu claim <HDU-N>        → auto-asignación
  └── dd-cli hdu start <HDU-N>        → approved → in-progress
  └── dd-cli start-session <HDU-N>    → abre sesión de trabajo
```

### Trabajar (en Claude Code, en orden)

```
/devflow-ia:init-repo-context  → mapea el repo, genera .ai/REPO-CONTEXT.md
/devflow-ia:enrich-us          → valida edge cases de la HDU antes del SPEC
/devflow-ia:new-spec           → redacta el SPEC técnico completo
/devflow-ia:derive-spec        → (si toca varias apps) slice del SPEC por app

/devflow-ia:opsx:propose       → diseña implementación + lista de tasks
/devflow-ia:opsx:apply         → implementa task por task
/devflow-ia:opsx:explore       → (cuando hay dudas) investigación profunda

/devflow-ia:release-check      → verifica SPEC ↔ código antes del MR
/devflow-ia:end-session        → commit + push + resumen de sesión
```

### Cerrar la HDU (en terminal)

```
dd-cli hdu review <HDU-N>   → in-progress → in-review (abre MR)
dd-cli hdu close <HDU-N>    → in-review → done (post-merge)
dd-cli client publish       → sincroniza estado al context repo
```

### Al final del día (en Claude Code)

```
/devflow-ia:end-day   → cierra sesión + sugerencia de commit + estado de la HDU
```

---

## Regla de oro

Todo lo que toca archivos del **context repo** termina con `dd-cli client publish`.
Todo lo que es **trabajo de código** termina con `/end-session` o `/end-day`.
