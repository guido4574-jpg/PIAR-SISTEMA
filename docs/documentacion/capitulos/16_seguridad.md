# 16. Seguridad

<!-- sub: Controles técnicos implementados y su verificación -->

## 16.1 Autenticación y sesiones

Tabla: Controles de autenticación

| Control | Implementación | Estado |
|---|---|---|
| Hash de contraseñas | bcrypt con factor 12 (`bcryptjs`) | [IMPLEMENTADO] [PROBADO LOCAL] |
| Política de contraseñas | Mínimo 14 caracteres y máximo 72 bytes (límite de bcrypt) | [IMPLEMENTADO] [PROBADO LOCAL] |
| Respuesta uniforme | Comparación contra un hash ficticio si la cuenta no existe; mensaje genérico ante cualquier fallo | [IMPLEMENTADO] [PRODUCCIÓN] (respuesta 401 genérica) |
| Sesiones | Token aleatorio guardado como hash en `sesion_usuario`, vencimiento de 8 horas, revocación al cerrar sesión, desactivar la cuenta o cambiar el correo | [IMPLEMENTADO] [PROBADO LOCAL] |
| Cookie | `piar_session` con `HttpOnly`, `SameSite=Lax` y `Secure` en producción | [IMPLEMENTADO] |
| Tokens de un solo uso | Verificación (24 h), recuperación (30 min) y cambio de correo (24 h), guardados como hash | [IMPLEMENTADO] [PROBADO LOCAL] |
| Contraseña temporal | Cambio obligatorio en el primer acceso | [IMPLEMENTADO] [PROBADO LOCAL] |

## 16.2 Autorización

- La matriz de `authorization.js` deniega por omisión y se aplica en el servidor antes de cada manejador.
- El alcance del Docente se filtra en las consultas SQL por su asignación en `piar_docente`.
- El Estudiante recibe una proyección reducida; un PIAR ajeno responde 404, igual que uno inexistente, para no revelar su existencia.
- Las respuestas 401 y 403 se registran en `piar_auditoria` sin contenido pedagógico.

## 16.3 Protección de la aplicación web

Tabla: Controles HTTP

| Control | Detalle | Estado |
|---|---|---|
| Content-Security-Policy | `script-src 'self' https://cdn.jsdelivr.net`, sin `'unsafe-inline'`; los manejadores de eventos se declaran con `data-on*` | [PRODUCCIÓN] |
| HSTS | Solo en producción | [PRODUCCIÓN] |
| Otras cabeceras | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, COOP, `Cache-Control: no-store` en la API | [PRODUCCIÓN] |
| Control de origen | Toda escritura exige un `Origin` incluido en `CORS_ORIGIN`; otro origen recibe 403 | [PRODUCCIÓN] |
| Integridad de recursos externos | Chart.js y Bootstrap Icons cargan con atributo SRI | [IMPLEMENTADO] |
| Escape de salida | `security.js` (`escapeHTML`) al insertar texto en la interfaz | [IMPLEMENTADO] [PROBADO LOCAL] |
| Rutas retiradas | `/api/data` y `/api/reset` responden 410; el buzón de correo de desarrollo responde 404 en producción | [PRODUCCIÓN] |

## 16.4 Protección contra abuso

- **Límites de intentos:** por par (IP, cuenta), por IP y por cuenta en el inicio de sesión; también en el registro, la recuperación, la verificación y el cambio de correo. Superado el límite, el servidor responde 429 con `Retry-After`.
- **Almacén compartido:** con `RATE_LIMIT_STORE=mysql`, los contadores (`limite_solicitudes`) sobreviven a los redespliegues.
- **IP real:** solo se toma de `X-Forwarded-For` si la conexión viene de una red de `TRUSTED_PROXIES`. El valor de producción está pendiente de ajuste (capítulo 21).

## 16.5 Datos y base de datos

- **SQL parametrizado** en todas las consultas; los nombres de columna dinámicos solo salen de listas fijas del servidor.
- **Mínimo privilegio:** la aplicación usa `piar_app`, que solo tiene permisos DML. La cuenta de migraciones `piar_migrador` está bloqueada fuera de las ventanas de migración [PRODUCCIÓN].
- **Arranque seguro:** `production-config.js` impide arrancar en producción si `APP_BASE_URL` no usa HTTPS o apunta a `localhost`, si `CORS_ORIGIN` falta o no es un origen HTTPS público, si `DB_HOST` es local, si `DB_NAME` es un esquema de pruebas o desarrollo, o si el transporte de correo es `memory`. Además, `database-config.js` rechaza la cuenta `root`.
- **Esquemas protegidos:** el ejecutor de migraciones rechaza el esquema de pruebas y el antiguo `piar` en modo remoto, y exige confirmar el nombre del esquema.
- **Errores:** las respuestas nunca incluyen mensajes de MySQL.

## 16.6 Privacidad y auditoría

Tabla: Registros de auditoría

| Tabla | Qué registra | Qué no registra |
|---|---|---|
| `evento_seguridad` | Tipo de evento, resultado, usuario si existe | El correo (solo su hash) ni la IP completa (se trunca) |
| `piar_auditoria` | Actor, acción, recurso, resultado y código HTTP | Contenido pedagógico |
| `admin_account_audit` | Operación administrativa, actor, cuenta afectada y resultado | Contraseñas ni tokens |
| `historial_detalle` | Valores anteriores y nuevos de cada versión del PIAR | — (es la trazabilidad pedagógica) |

## 16.7 Seguridad del repositorio

- `npm run check:secrets` detecta secretos, hashes de contraseña, volcados, archivos de entorno, correos personales y claves de Resend, tanto en archivos versionados como en los que se van a agregar. El último resultado fue sin hallazgos.
- `npm audit --omit=dev`: 0 vulnerabilidades en las dependencias de producción.
- El historial de Git conserva una credencial antigua ya retirada del código. Su rotación y la limpieza del historial están planificadas en `docs/seguridad/PLAN_LIMPIEZA_HISTORIAL.md` [PENDIENTE].
