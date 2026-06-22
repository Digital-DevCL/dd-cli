# Auth Profile — `portal-embedded`

**Versión:** 1.0
**Cuándo usar:** la app vive embebida dentro de un portal shell corporativo. El usuario ya está autenticado en el portal y la app hereda esa sesión — no tiene formulario de login propio.

Típico en: microfrontends Angular embebidos en un shell de empresa, apps internas que viven como iframes o widgets dentro de un portal.

---

## Parámetros a completar (específicos del cliente)

```yaml
PORTAL_URL: https://portal.cliente.cl   # URL del portal padre
BRIDGE_MECHANISM: postMessage            # postMessage | sessionStorage | cookie | custom
BRIDGE_KEY: authToken                    # clave/evento que entrega el token
TOKEN_STORAGE: sessionStorage           # dónde guardar el token recibido
TOKEN_KEY: authToken                     # clave en el storage
PORTAL_LOGOUT_URL: /logout              # a dónde redirigir al expirar
```

---

## Patrón de implementación

### Cómo el portal entrega el token

El portal padre inyecta el token al cargar la app, o en respuesta a un handshake:

**Opción A — postMessage (más común):**
```javascript
// Portal padre envía el token al iframe/microfrontend
window.postMessage({ type: 'AUTH_TOKEN', token: jwtToken }, targetOrigin);

// App embebida escucha
window.addEventListener('message', (event) => {
  if (event.origin !== PORTAL_URL) return; // validar origen
  if (event.data.type === 'AUTH_TOKEN') {
    sessionStorage.setItem(TOKEN_KEY, event.data.token);
  }
});
```

**Opción B — sessionStorage compartido:**
```javascript
// Token ya está en sessionStorage al cargar la app
const token = sessionStorage.getItem(TOKEN_KEY);
if (!token) window.location.href = PORTAL_LOGOUT_URL;
```

### Guard de autenticación (frontend)

```typescript
// canActivate — verificar que el token existe y no expiró
canActivate(): boolean {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token || this.jwtHelper.isTokenExpired(token)) {
    window.location.href = PORTAL_LOGOUT_URL;
    return false;
  }
  return true;
}
```

### Backend (validación)

```
El BFF recibe el token del portal en cada request.
1. Recibe: Authorization: Bearer <token-del-portal>
2. Valida firma con la clave pública del portal
3. Extrae userId, roles del payload
4. Propaga al backend interno en X-Internal-Token (no emite token propio)
```

---

## Variables de entorno requeridas

| Variable | Descripción |
|---|---|
| `PORTAL_PUBLIC_KEY` | Clave pública del portal para validar firmas JWT |
| `PORTAL_ALLOWED_ORIGIN` | Origin del portal (para validar postMessage) |
| `PORTAL_LOGOUT_URL` | URL de logout del portal |

---

## Tests

```
Mock del token del portal:
  - En beforeEach: sessionStorage.setItem(TOKEN_KEY, generarTokenDePrueba())
  - Para simular sesión expirada: token con exp en el pasado
  - Para simular sin sesión: sessionStorage.clear()
  - No es necesario mockear el portal completo
```

---

## Consideraciones

- La app no puede hacer refresh del token — si expira, redirige al portal
- Si el portal está caído, la app no puede funcionar (dependencia dura)
- No guardar el token en localStorage (riesgo XSS cross-tab)
- Validar siempre el origin en postMessage antes de procesar
