# 17. Documentación de la API

<!-- sub: Rutas HTTP expuestas por backend/server.js -->

## 17.1 Convenciones

- **Base:** la misma URL de la aplicación (por ejemplo, `https://<dominio>/api/...`).
- **Formato:** JSON en peticiones y respuestas. Las respuestas siguen la forma `{ "ok": true, ... }` o `{ "ok": false, "message": "..." }`.
- **Autenticación:** cookie de sesión `piar_session`, que el navegador envía automáticamente. Las rutas protegidas sin sesión responden 401.
- **Escrituras** (`POST`, `PUT`, `DELETE`): exigen una cabecera `Origin` permitida.
- **Permisos:** cada ruta se valida contra la matriz del capítulo 15.

Tabla: Códigos de estado usados

| Código | Significado en el sistema |
|---|---|
| 200 / 201 | Operación correcta / recurso creado |
| 400 | Datos inválidos (por ejemplo, falta la justificación) |
| 401 | Sin sesión o credenciales inválidas |
| 403 | Rol sin permiso u origen no permitido |
| 404 | Recurso inexistente o fuera del alcance del usuario |
| 409 | Conflicto: PIAR cerrado, duplicado o estado incompatible |
| 410 | Ruta retirada (`/api/data`, `/api/reset`) |
| 429 | Demasiados intentos; incluye `Retry-After` |
| 500 | Error interno, sin detalles técnicos en la respuesta |

## 17.2 Sistema y autenticación

Tabla: Rutas públicas y de autenticación

| Método | Ruta | Función | Sesión |
|---|---|---|---|
| GET | `/api/health` | Estado del servicio: comprueba MySQL con `SELECT 1` y responde `{"status":"ok"}` (200) o `{"status":"degraded"}` (503) | No |
| GET | `/api/config` | Configuración pública: nombre de la institución | No |
| POST | `/api/auth/register` | Solicitud de cuenta (cuatro perfiles) | No |
| POST | `/api/auth/login` | Inicio de sesión | No |
| POST | `/api/auth/logout` | Cierre de sesión | Sí |
| GET | `/api/auth/me` | Datos de la sesión actual | Sí |
| POST | `/api/auth/email-verification/request` | Reenviar verificación | No |
| POST | `/api/auth/email-verification/confirm` | Confirmar el correo con el token | No |
| POST | `/api/auth/email-change/confirm` | Confirmar el cambio de correo | No |
| POST | `/api/auth/password-reset/request` | Solicitar recuperación | No |
| POST | `/api/auth/password-reset/confirm` | Fijar la nueva contraseña con el token | No |
| POST | `/api/auth/initial-password-change` | Cambiar la contraseña temporal | Sí |
| GET | `/api/dev/email-outbox` | Buzón de correo de desarrollo; responde 404 en producción | Solo desarrollo |

Ejemplo de inicio de sesión:

```http
POST /api/auth/login
Content-Type: application/json
Origin: https://piar-sistema-production-99f3618b.up.railway.app

{ "correo": "docente@ejemplo.edu.co", "password": "••••••••••••••" }
```

```json
{ "ok": false, "message": "Correo o contraseña incorrectos." }
```

## 17.3 Identidades externas (implementadas y ocultas)

Tabla: Rutas de OpenID Connect

| Método | Ruta | Función |
|---|---|---|
| GET | `/api/auth/oidc/providers` | Proveedores habilitados (ninguno en producción) |
| GET | `/api/auth/oidc/{google\|microsoft\|apple}/start` | Inicio del flujo con PKCE |
| POST | `/api/auth/oidc/{proveedor}/link` | Vincular una identidad a la cuenta actual |
| GET | `/api/auth/oidc/{proveedor}/callback` | Retorno del proveedor (Apple usa `POST`) |
| GET | `/api/auth/identities` | Identidades vinculadas |
| DELETE | `/api/auth/identities/:id` | Desvincular una identidad |

## 17.4 Usuarios, estudiantes y docentes

Tabla: Rutas de gestión institucional

| Método | Ruta | Función | Roles |
|---|---|---|---|
| GET, POST | `/api/usuarios` | Listar y crear cuentas (incluida la cuenta Estudiante) | Administrador |
| GET, PUT, DELETE | `/api/usuarios/:id` | Consultar, editar y desactivar una cuenta | Administrador |
| POST | `/api/usuarios/:id/aprobacion` | Aprobar o rechazar una solicitud | Administrador |
| POST | `/api/usuarios/:id/reactivacion` | Reactivar una cuenta | Administrador |
| GET, POST | `/api/estudiantes` | Listar y crear estudiantes | Consultar: todos menos Estudiante; crear: Administrador, Rector, Coordinador |
| GET, PUT, DELETE | `/api/estudiantes/:id` | Consultar, editar y desactivar | Igual que la anterior |
| GET, POST | `/api/docentes` | Listar y crear docentes | Igual que estudiantes |
| GET, PUT, DELETE | `/api/docentes/:id` | Consultar, editar y desactivar | Igual que estudiantes |

## 17.5 PIAR y componentes pedagógicos

Tabla: Rutas del PIAR

| Método | Ruta | Función |
|---|---|---|
| GET, POST | `/api/piar` | Listar y crear PIAR |
| GET, PUT | `/api/piar/:id` | Consultar y editar (la edición exige `justificacion`) |
| DELETE | `/api/piar/:id` | **Cerrar** el PIAR (no lo elimina) |
| POST | `/api/piar/:id/reapertura` | Reabrir con justificación (solo Coordinador) |
| GET | `/api/piar/:id/versiones` y `/api/piar/:id/versiones/:v` | Historial de versiones y detalle |
| GET, POST, DELETE | `/api/piar/:id/docentes` | Docentes asignados |
| GET, POST | `/api/piar/:id/barreras` | Barreras |
| GET, POST | `/api/piar/:id/ajustes` | Ajustes razonables |
| PUT, DELETE | `/api/piar/:id/ajustes/:aid` | Editar o eliminar un ajuste |
| GET, POST | `/api/piar/:id/ajustes/:aid/evidencias` | Evidencias del ajuste |
| GET, POST | `/api/piar/:id/dua` | Estrategias DUA |
| PUT | `/api/piar/:id/dua/:did` | Editar una estrategia DUA |

## 17.6 Registros, historial, reportes y tablero

Tabla: Rutas complementarias

| Método | Ruta | Función |
|---|---|---|
| GET, POST | `/api/diagnosticos`, `/api/seguimientos`, `/api/observaciones` | Listar y crear registros |
| GET | `/api/{diagnosticos\|seguimientos\|observaciones}/:id` | Consultar un registro |
| PUT, DELETE | `/api/diagnosticos/:id` | Editar o eliminar un diagnóstico (observaciones y seguimientos son inmutables) |
| GET | `/api/historial`, `/api/historial/:id` | Historial general |
| GET, POST | `/api/reportes` | Listar y generar informes |
| GET | `/api/reportes/:id` | Consultar un informe guardado |
| GET | `/api/dashboard/resumen` | Indicadores del tablero |
