# Manual técnico de PIAR-SISTEMA

Actualizado: 2026-11-22. La versión anterior, con el historial de octubre, está en `docs/historico/MANUAL_TECNICO_PIAR_hasta_2026-11-22.md`.

## 1. Arquitectura

- **Servidor:** Node.js 22 con `http` nativo, sin frameworks (`backend/server.js`). Sirve la API (`/api/*`) y los archivos estáticos de `public/`.
- **Base de datos:** MySQL 8 mediante `mysql2`, con un grupo de conexiones (`backend/db.js`). Las sesiones viven en MySQL (`sesion_usuario`), así que sobreviven a los reinicios.
- **Frontend:** HTML, CSS y JavaScript sin frameworks, Bootstrap Icons y Chart.js 4.5.1, ambos desde jsDelivr con SRI. Fuente Poppins alojada localmente.
- **Dependencias de producción:** `bcryptjs`, `mysql2`, `nodemailer` y `openid-client`.
- **Despliegue:** `Dockerfile` y `railway.json` (`docs/DESPLIEGUE_RAILWAY.md`).

## 2. Módulos del backend

| Archivo | Responsabilidad |
|---|---|
| `server.js` | Enrutamiento, sesión, autorización por ruta, límites, control de origen, cabeceras de seguridad y archivos estáticos |
| `production-config.js` | Validación de la configuración al arrancar; `HOST` (`0.0.0.0` en producción) y `PORT` |
| `database-config.js`, `db.js` | Conexión explícita, rechazo de `root`, bloqueo del esquema `piar`, TLS opcional (`DB_SSL`) |
| `migrations.js`, `run-migration.js` | Migraciones versionadas con checksum; modo local y modo `--remote` con confirmación y `GET_LOCK` |
| `authorization.js` | Matriz de roles por método y ruta (denegación por omisión) |
| `auth.js`, `password-policy.js` | Registro, creación institucional (incluida la cuenta Estudiante, D7), inicio de sesión, sesiones de 8 h, verificación, recuperación, contraseña temporal; mínimo 14 caracteres y máximo 72 bytes |
| `registration-approval.js`, `decision-notification.js` | Aprobación y rechazo de solicitudes; aviso por correo posterior, que no revierte la decisión |
| `account-email.js`, `admin-account-operations.js`, `admin-account-audit.js` | Cambio de correo con verificación (D1), edición, desactivación y reactivación, auditoría administrativa |
| `student-portal.js`, `student-access.js` | Alcance y proyección de solo lectura del Estudiante; alcance del Docente por asignación |
| `piar-versioning.js`, `partial-update.js` | Versiones del PIAR, PIAR cerrado en solo lectura, actualizaciones parciales (un campo opcional vacío se guarda como NULL) |
| `pedagogical-validation.js`, `pedagogical-access.js`, `teacher-validation.js`, `student-update.js` | Validación de barreras, ajustes, evidencias, DUA, registros, docentes y estudiantes |
| `reports.js` | Informes persistentes con instantánea construida por el servidor |
| `rate-limit*.js`, `login-throttle.js`, `client-ip.js` | Límites en memoria o MySQL; IP real solo detrás de `TRUSTED_PROXIES` |
| `security-events.js`, `maintenance.js` | `evento_seguridad` (correo en hash, IP truncada) y purga periódica |
| `email.js` | Punto único de envío (`deliverEmail`). Transportes `resend` (API HTTPS de Resend, vigente en Railway Trial), `smtp`, `api` y `memory` (solo en desarrollo). Los errores solo conservan el código HTTP o técnico y el nombre del error |
| `oidc.js` | Google, Microsoft y Apple (implementados, ocultos en la interfaz y sin credenciales) |

## 3. Frontend

- `public/js/app.js` contiene las vistas.
- Archivos auxiliares: `api.js` (cliente HTTP), `piar-management.js`, `user-admin.js`, `piar-version-history.js`, `report-history.js`, `student-portal.js`, `login-scene.js` y `security.js` (`escapeHTML`).
- **`event-actions.js`:** las plantillas declaran sus acciones con `data-onclick`, `data-onsubmit`, `data-oninput` o `data-onchange`, por ejemplo `data-onclick="viewPIAR(12)"`. Un único despachador las ejecuta:
  - Solo admite funciones de una lista permitida, con argumentos literales, `event` o `this`, y no evalúa código.
  - Esto permite una CSP con `script-src 'self' https://cdn.jsdelivr.net`, sin `'unsafe-inline'`.
  - `tests/produccion-d7.test.js` comprueba que no quedan manejadores en línea y que cada acción está permitida y definida.

**Para agregar una acción:**
1. Declarar la función en el ámbito global de un archivo de `public/js/`.
2. Usar `data-on<evento>` en la plantilla.
3. Añadir el nombre a `PIAR_EVENT_ACTIONS`.

## 4. Matriz de permisos (`backend/authorization.js`)

| Recurso | Administrador | Rector | Coordinador | Psicólogo(a) | Docente | Estudiante |
|---|---|---|---|---|---|---|
| Solicitudes y usuarios (`/api/usuarios`) | Todo | — | — | — | — | — |
| Solicitudes pendientes (`GET /api/usuarios/solicitudes`, `POST /api/usuarios/:id/aprobacion`) | Todas | Docente, Psicólogo(a) y Coordinador | — | — | — | — |
| Estudiantes y docentes: consultar | ✔ | ✔ | ✔ | ✔ | Solo los asignados o su propio perfil | — |
| Estudiantes y docentes: crear, editar, desactivar | ✔ | ✔ | ✔ | — | — | — |
| PIAR: consultar | ✔ | ✔ | ✔ | ✔ | Asignados | Solo el propio, con proyección reducida |
| PIAR: crear y editar | ✔ | ✔ | ✔ | — | Asignados | — |
| PIAR: cerrar y asignar docentes | ✔ | ✔ | ✔ | — | — | — |
| PIAR: reabrir | — | — | ✔ | — | — | — |
| Barreras, ajustes, evidencias, DUA | ✔ (incluye eliminar ajustes) | ✔ (incluye eliminar ajustes) | ✔ (incluye eliminar ajustes) | Consulta | Crear y editar en asignados; no elimina ajustes | — |
| Diagnósticos | Editar y eliminar | Editar y eliminar | Crear, editar y eliminar | Crear y editar | Consulta (asignados) | — |
| Observaciones | Consulta | Consulta | Crear | Crear | Crear (asignados) | — |
| Seguimientos | Consulta | Consulta | Crear | Consulta | Crear (asignados) | — |
| Historial, versiones, reportes, dashboard | ✔ | ✔ | ✔ | ✔ | Asignados | — |

- **Inmutabilidad:** las observaciones y los seguimientos no se editan.
- **PIAR cerrado:** responde 409 a toda escritura de contenido.
- **Origen de las reglas:** las aplica el backend. La interfaz solo oculta lo que el backend negaría.

## 5. Cuentas y flujos

- **Registro público (D2):** abierto a Docente, Psicólogo(a), Coordinador y Rector.
  1. La cuenta empieza en `pendiente`, sin enlace de verificación (D11). `correo_verificado_at` queda en NULL.
  2. Un Administrador, o un Rector para perfiles distintos de Rector, la aprueba (`activo`) o la rechaza con motivo (`rechazado`). Se guardan `aprobado_por_usuario_id`/`rechazado_por_usuario_id` y `decision_at`, se audita en `admin_account_audit` y, si hay transporte de correo, se envía un aviso sin el motivo.
  3. La aprobación no marca el correo como verificado. Las solicitudes anteriores en `pendiente_verificacion` también se pueden decidir.
- **Creación por el Administrador (D3):** los mismos perfiles, con contraseña temporal (`password_change_required = 1`). Queda en `pendiente` (auditoría `account_created` / `pending_approval`) y se aprueba en «Solicitudes».
- **Cuenta Estudiante (D7):**
  - `POST /api/usuarios` con `rol: "Estudiante"`, `id_estudiante` y `autorizacion_acudiente`.
  - El estudiante debe existir, estar activo y no tener otra cuenta.
  - En una transacción: se crea el usuario, se vincula `estudiante.id_usuario` y se audita con la referencia `autorizacion_acudiente_confirmada`.
  - Al verificar el correo, la cuenta queda activa sin pasar por «Solicitudes» y debe cambiar la contraseña temporal.
  - El listado de estudiantes indica al Administrador cuáles ya tienen cuenta (`cuenta_vinculada`).
- **Cambio de correo (D1, migración 016):** el correo actual sigue vigente hasta que se confirma el nuevo. Al confirmar se revocan las sesiones y se invalidan los enlaces pendientes.
- **Administradora principal (D6):** se conserva la cuenta 178. Se traslada con `scripts/admin-transfer.js`, nunca con el *bootstrap*. Los *bootstrap* locales existen solo para `piar_test` y no deben ejecutarse. El correo de la Administradora no se versiona: el *bootstrap* lo leería de `PIAR_BOOTSTRAP_ADMIN_EMAIL`.

## 6. Controles de seguridad

- **Contraseñas:** bcrypt (factor 12). El inicio de sesión compara contra un hash ficticio aunque la cuenta no exista y responde con un mensaje genérico.
- **Cookie de sesión:** `HttpOnly; SameSite=Lax`, y `Secure` en producción.
- **Límites:** por par (IP, cuenta), por IP y por cuenta; también en registro, recuperación, verificación y cambio de correo.
- **Origen:** toda escritura exige un `Origin` incluido en `CORS_ORIGIN`.
- **Cabeceras:** CSP sin scripts en línea, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, COOP, `Cache-Control: no-store` en la API y HSTS en producción.
- **SQL:** siempre parametrizado. Los nombres de columna solo salen de listas fijas del servidor.
- **Datos personales:** los errores no devuelven mensajes de MySQL y los registros no imprimen tokens, contraseñas ni correos. La auditoría guarda metadatos, no contenido pedagógico.
- **Repositorio:** `npm run check:secrets` revisa los archivos versionados y los que se agregarían.

## 7. Operación

| Tarea | Comando |
|---|---|
| Backend local sobre `piar_test` | `node scripts/start-local-backend.js` (127.0.0.1:8090; `MAINTENANCE_INTERVAL_MINUTES=0` evita la purga) |
| Demo visual sin base de datos | `npm run demo:visual` (127.0.0.1:4173) |
| Migraciones | `docs/GUIA_MYSQL_MIGRACIONES.md` |
| Respaldo de `piar_test` | `docs/GUIA_MYSQL_MIGRACIONES.md` §6 |
| Producción | `docs/DESPLIEGUE_RAILWAY.md` |
| Purga manual de vencidos | `npm run db:purge-expired` |
| Verificar una base (solo lectura: TLS, privilegios, 28 tablas, 16 migraciones, Administradora) | `npm run db:verificar [-- --paquete <archivo>]` |
| Probar el correo configurado | `npm run correo:probar -- --verificar` (y `--enviar <destino>` con `PIAR_CONFIRMAR_ENVIO=SI`) |

El `.env` local actual apunta a `127.0.0.1:3306` sin `DB_USER`, así que `npm start` no conecta. El arranque local soportado es `scripts/start-local-backend.js`, que toma las credenciales de `.env.test` sin imprimirlas.

## 8. Referencias normativas

El modelo del PIAR sigue el Decreto 1421 de 2017 (incorporado al Decreto 1075 de 2015). El tratamiento de datos se apoya en la Ley 1581 de 2012. Estos son controles técnicos de apoyo: no sustituyen la política institucional ni la autorización de los titulares.
