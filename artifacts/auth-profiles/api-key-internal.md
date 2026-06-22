# Auth Profile — `api-key-internal`

**Versión:** 1.0
**Cuándo usar:** comunicación entre servicios internos (machine-to-machine). No hay usuario humano — un servicio llama a otro usando una clave compartida.

Típico en: microservicio A llamando a microservicio B, jobs internos, workers que consumen APIs internas, integraciones entre sistemas del mismo cliente.

---

## Parámetros a completar (específicos del cliente)

```yaml
HEADER_NAME: X-Api-Key       # header donde viaja la clave
KEY_STORAGE: env              # env | secrets-manager | vault
KEY_ROTATION_DAYS: 90        # cada cuántos días rotar la clave
RATE_LIMIT: 1000/min         # límite si aplica
IP_ALLOWLIST: true            # ¿se restringe por IP además?
```

---

## Patrón de implementación

### Emisor (servicio que llama)

```
# En cada request al servicio interno:
Headers:
  X-Api-Key: ${API_KEY_VALUE}   ← viene de env/secrets manager
  Content-Type: application/json
```

### Receptor (servicio que valida)

```
Recibe: X-Api-Key: <clave>
1. Extraer el valor del header HEADER_NAME
2. Comparar con el valor esperado (timing-safe comparison)
3. Si no coincide → 401 Unauthorized
4. Opcionalmente: verificar IP del solicitante contra allowlist
5. Si pasa → procesar request (sin concepto de "usuario")
```

**Guard en NestJS:**
```typescript
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const key = req.headers['x-api-key'];
    return timingSafeEqual(
      Buffer.from(key ?? ''),
      Buffer.from(process.env.INTERNAL_API_KEY ?? '')
    );
  }
}
```

**Middleware en Laravel:**
```php
public function handle($request, Closure $next) {
    if (!hash_equals(config('services.internal_api_key'), $request->header('X-Api-Key', ''))) {
        return response()->json(['error' => 'Unauthorized'], 401);
    }
    return $next($request);
}
```

---

## Variables de entorno requeridas

| Variable | Descripción |
|---|---|
| `INTERNAL_API_KEY` | La clave compartida (en ambos servicios) |

---

## Tests

```
- En tests de integración: usar una API key de prueba fija
- Probar con clave correcta → 200
- Probar sin clave → 401
- Probar con clave incorrecta → 401
- No usar la clave de producción en tests
```

---

## Consideraciones de seguridad

- Usar `timingSafeEqual` / `hash_equals` para comparar (previene timing attacks)
- Nunca hardcodear la clave en el código
- Rotar claves regularmente (ROTATION_DAYS)
- Generar claves con suficiente entropía: `openssl rand -hex 32`
- Si una clave se compromete: revocar y distribuir una nueva a todos los servicios que la usan
- Considerar IP allowlist para restringir qué servicios pueden llamar
- No usar en endpoints públicos o expuestos a internet
