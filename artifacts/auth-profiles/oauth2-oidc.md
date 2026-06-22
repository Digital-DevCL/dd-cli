# Auth Profile — `oauth2-oidc`

**Versión:** 1.0
**Cuándo usar:** autenticación delegada a un proveedor externo estándar (Keycloak, Azure AD, Google, Auth0, Okta). El proveedor emite los tokens; el sistema los consume.

Típico en: sistemas empresariales modernos con SSO, integración con Azure AD del cliente, sistemas con múltiples apps que comparten identidad.

---

## Parámetros a completar (específicos del cliente)

```yaml
PROVIDER: Keycloak          # Keycloak | AzureAD | Google | Auth0 | Okta | otro
ISSUER_URL: https://auth.cliente.cl/realms/main
CLIENT_ID: mi-app
SCOPES: openid profile email roles
FLOW: authorization-code-pkce   # authorization-code-pkce | implicit (deprecated)
CALLBACK_ROUTE: /auth/callback
TOKEN_STORAGE: localStorage
LOGOUT_URL: https://auth.cliente.cl/realms/main/protocol/openid-connect/logout
```

---

## Patrón de implementación

### Flujo authorization-code con PKCE (recomendado)

```
1. Usuario accede a la app
2. App genera code_verifier y code_challenge (PKCE)
3. App redirige a ISSUER_URL/authorize con:
   - client_id, redirect_uri, scope, response_type=code
   - code_challenge, code_challenge_method=S256
4. Proveedor autentifica al usuario (login del proveedor)
5. Proveedor redirige a CALLBACK_ROUTE con `code`
6. App intercambia code por tokens:
   POST ISSUER_URL/token con code + code_verifier
   → Recibe: { access_token, id_token, refresh_token }
7. App guarda tokens y usa access_token en cada request
```

### Backend (validación)

```
Recibe: Authorization: Bearer <access_token>
1. Obtener JWKS del proveedor: ISSUER_URL/.well-known/jwks.json
2. Verificar firma del token con las claves públicas
3. Verificar iss, aud, exp
4. Extraer usuario y roles del payload
5. Cache de JWKS (renovar cada ~1 hora)
```

### Refresh token

```
Si access_token expira (401 del backend):
1. POST ISSUER_URL/token con refresh_token y grant_type=refresh_token
2. Si OK → actualizar access_token y reintentar
3. Si error (refresh expirado) → redirigir a login
```

---

## Variables de entorno requeridas

| Variable | Descripción |
|---|---|
| `OAUTH_ISSUER_URL` | URL base del proveedor |
| `OAUTH_CLIENT_ID` | ID de la app registrada en el proveedor |
| `OAUTH_CLIENT_SECRET` | Secret (solo en backend/BFF, nunca en frontend) |
| `OAUTH_REDIRECT_URI` | URL de callback registrada en el proveedor |
| `OAUTH_SCOPES` | Scopes a solicitar |

---

## Tests

```
Mock mínimo:
  - No conectar al proveedor real en tests — mockear el intercambio de tokens
  - Generar un id_token de prueba localmente (firmado con clave de test)
  - Probar el callback handler con un code de prueba
  - Probar el guard con un token válido y uno expirado
```

---

## Consideraciones de seguridad

- Usar siempre PKCE en el frontend (nunca implicit flow)
- El `client_secret` nunca en el frontend
- Validar el `state` parameter para prevenir CSRF
- Registrar `redirect_uri` exacta en el proveedor (sin wildcards)
- Si usas Azure AD: tenant ID determina qué usuarios pueden ingresar
