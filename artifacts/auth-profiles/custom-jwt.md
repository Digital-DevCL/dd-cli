# Auth Profile — `custom-jwt`

**Versión:** 1.0
**Cuándo usar:** el sistema emite sus propios tokens JWT. El backend genera y valida los tokens sin depender de un proveedor externo (no es OAuth/OIDC).

Típico en: sistemas Laravel con autenticación propia, APIs internas con Passport o JWT-Auth.

---

## Parámetros a completar (específicos del cliente)

```yaml
# Completar al generar el perfil del cliente
ENDPOINT_LOGIN: /api/auth/login
ENDPOINT_REFRESH: /api/auth/refresh
ENDPOINT_LOGOUT: /api/auth/logout
ALGORITMO: HS256          # HS256 | RS256
EXPIRACION_TOKEN: 3600    # segundos
EXPIRACION_REFRESH: 86400 # segundos
CLAIM_USER_ID: user_id    # nombre del claim que identifica al usuario
CLAIM_ROLES: roles        # nombre del claim con roles/permisos
STORAGE: localStorage     # localStorage | sessionStorage | httpOnly cookie
```

---

## Patrón de implementación

### Backend (validación)

```
Recibe: Authorization: Bearer <token>
1. Verificar firma con la clave secreta (env: JWT_SECRET)
2. Verificar expiración (exp)
3. Extraer CLAIM_USER_ID y CLAIM_ROLES del payload
4. Adjuntar usuario al request (request.user)
```

**Guard a usar en cada endpoint protegido:** `JwtAuthGuard` (NestJS) / `auth:api` middleware (Laravel)

### Frontend (flujo)

```
1. POST ENDPOINT_LOGIN con credenciales
   → Recibe { access_token, refresh_token }
2. Guardar ambos tokens en STORAGE
3. Adjuntar en cada request: Authorization: Bearer <access_token>
4. Si el servidor responde 401:
   → POST ENDPOINT_REFRESH con { refresh_token }
   → Si OK: reemplazar access_token y reintentar
   → Si error: redirigir a login y limpiar tokens
5. En logout: POST ENDPOINT_LOGOUT + limpiar STORAGE
```

### Interceptor HTTP (frontend)

```typescript
// Patrón estándar para Angular
intercept(req: HttpRequest<unknown>, next: HttpHandler) {
  const token = localStorage.getItem('access_token');
  if (token) {
    req = req.clone({ headers: req.headers.set('Authorization', `Bearer ${token}`) });
  }
  return next.handle(req).pipe(
    catchError(err => {
      if (err.status === 401) this.authService.refresh(); // → lógica de refresh
      return throwError(() => err);
    })
  );
}
```

---

## Variables de entorno requeridas

| Variable | Descripción | Ejemplo |
|---|---|---|
| `JWT_SECRET` | Clave para firmar tokens (HS256) | string aleatorio ≥32 chars |
| `JWT_EXPIRES_IN` | Expiración del access token | `3600` (segundos) |
| `JWT_REFRESH_SECRET` | Clave para refresh tokens | string aleatorio ≥32 chars |
| `JWT_REFRESH_EXPIRES_IN` | Expiración del refresh token | `86400` |

Para RS256: `JWT_PRIVATE_KEY` y `JWT_PUBLIC_KEY` en lugar de `JWT_SECRET`.

---

## Tests

```
Mock mínimo para tests:
  - Generar un token de prueba en beforeEach con el secret de test
  - No mockear el guard completo — probar con token real generado localmente
  - Token expirado: usar exp: 0 en el payload
  - Token inválido: alterar la firma manualmente
```

---

## Consideraciones de seguridad

- Nunca guardar tokens en cookies sin `HttpOnly` y `SameSite=Strict`
- Rotar `JWT_SECRET` periódicamente en producción
- El access token debe tener vida corta (≤1 hora)
- El refresh token debe invalidarse en logout (blacklist o rotación)
- No incluir información sensible en el payload (es decodificable sin clave)
