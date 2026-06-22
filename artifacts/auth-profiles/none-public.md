# Auth Profile — `none-public`

**Versión:** 1.0
**Cuándo usar:** la app o endpoint es completamente público — sin autenticación requerida. Cualquier visitante puede acceder sin credenciales.

Típico en: sitios web corporativos, landing pages, documentación pública, APIs de consulta de datos públicos.

---

## Parámetros a completar

```yaml
# No hay parámetros de autenticación
# Completar con consideraciones de acceso público del cliente:
RATE_LIMIT: 100/min     # rate limit para prevenir abuso
CORS_ORIGINS: "*"       # o dominio específico si aplica
CDN: true               # ¿va detrás de CloudFlare/CDN?
```

---

## Patrón de implementación

### Backend

```
No aplicar guards de autenticación.
Sí aplicar:
  - Rate limiting (para prevenir abuso)
  - CORS correctamente configurado
  - Validación de inputs (aunque sea público, no confiar en el input)
  - Headers de seguridad: X-Content-Type-Options, X-Frame-Options
```

### Frontend

```
No hay flujo de login.
No hay tokens que manejar.
Foco en:
  - Carga rápida (no hay auth que bloquee)
  - SEO si aplica
  - Cache headers correctos
```

---

## Variables de entorno

No hay variables de autenticación.

Variables de configuración recomendadas:
| Variable | Descripción |
|---|---|
| `ALLOWED_ORIGINS` | Origins permitidos en CORS |
| `RATE_LIMIT_PER_MINUTE` | Límite de requests por IP por minuto |

---

## Tests

```
- Verificar que el endpoint responde sin Authorization header → 200
- Verificar que el rate limit bloquea después del umbral → 429
- Verificar headers de seguridad presentes
```

---

## Consideraciones

- "Público" no significa "sin seguridad" — aplicar rate limiting siempre
- Si en el futuro se agrega autenticación, cambiar el perfil de la app en `app-catalog.md`
- Monitorear logs de abuso (requests inusuales, scraping)
- Si el contenido es sensible aunque no requiera login, revisar si realmente debe ser `none-public`
