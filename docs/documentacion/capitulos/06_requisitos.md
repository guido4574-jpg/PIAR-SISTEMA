# 6. Requisitos funcionales y no funcionales

<!-- sub: Requisitos verificados contra el código de la versión 6158d9a -->

## 6.1 Requisitos funcionales

Cada requisito indica el componente que lo implementa, para que pueda verificarse en el código.

Tabla: Requisitos funcionales

| Código | Nombre | Prioridad | Descripción | Implementación | Estado |
|---|---|---|---|---|---|
| RF-01 | Iniciar sesión | Alta | Acceso con correo y contraseña; solo entra una cuenta activa; mensaje genérico ante cualquier fallo | `auth.js`, `POST /api/auth/login` | [PRODUCCIÓN] |
| RF-02 | Cerrar sesión | Alta | Revoca la sesión en el servidor | `POST /api/auth/logout` | [PROBADO LOCAL] |
| RF-03 | Solicitar cuenta | Alta | Registro público para Docente, Psicólogo(a), Coordinador y Rector (D2); elegir un perfil no concede permisos | `POST /api/auth/register` | [PROBADO LOCAL] |
| RF-04 | Verificar correo | Alta | Enlace de un solo uso que vence en 24 horas | `/api/auth/email-verification/*` | [PROBADO LOCAL] · [PENDIENTE] en producción (correo desactivado) |
| RF-05 | Recuperar contraseña | Media | Enlace de un solo uso que vence en 30 minutos; la respuesta no revela si el correo existe | `/api/auth/password-reset/*` | [PROBADO LOCAL] · [PENDIENTE] en producción |
| RF-06 | Cambiar contraseña temporal | Alta | Cambio obligatorio en el primer acceso de una cuenta creada por el Administrador | `POST /api/auth/initial-password-change` | [PROBADO LOCAL] |
| RF-07 | Aprobar o rechazar solicitudes | Alta | El Administrador decide; el rechazo exige motivo, que no se envía a la persona | `registration-approval.js` | [PROBADO LOCAL] |
| RF-08 | Crear cuentas institucionales | Alta | El Administrador crea cuentas con contraseña temporal (D3) | `POST /api/usuarios` | [PROBADO LOCAL] |
| RF-09 | Crear cuenta Estudiante | Media | Solo el Administrador, con autorización del acudiente, una cuenta por estudiante, en una transacción (D7) | `auth.js`, migración 015 | [PROBADO LOCAL] |
| RF-10 | Administrar cuentas | Alta | Editar nombre y correo, desactivar y reactivar; no se puede dejar la institución sin Administrador | `admin-account-operations.js` | [PROBADO LOCAL] |
| RF-11 | Cambiar correo con verificación | Media | El correo actual sigue vigente hasta confirmar el nuevo; al confirmar se revocan las sesiones (D1) | `account-email.js`, migración 016 | [PROBADO LOCAL] |
| RF-12 | Gestionar estudiantes | Alta | Crear, editar, consultar y desactivar estudiantes con su caracterización | `/api/estudiantes` | [PROBADO LOCAL] |
| RF-13 | Gestionar docentes | Alta | Crear, editar, consultar y desactivar docentes | `/api/docentes` | [PROBADO LOCAL] |
| RF-14 | Crear PIAR | Alta | Título, periodo, año y docente responsable; componentes del Decreto 1421 | `POST /api/piar` | [PROBADO LOCAL] |
| RF-15 | Editar PIAR con versión | Alta | Exige justificación; guarda valor anterior y nuevo; permite vaciar campos opcionales | `piar-versioning.js`, `partial-update.js` | [PROBADO LOCAL] |
| RF-16 | Asignar docentes al PIAR | Alta | Relación N:M con responsable principal; define el alcance del Docente | `/api/piar/:id/docentes` | [PROBADO LOCAL] |
| RF-17 | Registrar barreras | Alta | Barreras por contexto con fecha de identificación | `/api/piar/:id/barreras` | [PROBADO LOCAL] |
| RF-18 | Registrar ajustes razonables | Alta | Vinculados a una barrera del mismo PIAR, con responsable, indicador y avance de 0 a 100 | `/api/piar/:id/ajustes` | [PROBADO LOCAL] |
| RF-19 | Registrar evidencias | Media | Evidencias descriptivas de la aplicación de un ajuste | `/api/piar/:id/ajustes/:aid/evidencias` | [PROBADO LOCAL] |
| RF-20 | Registrar estrategias DUA | Media | Por principio: representación, acción y expresión, implicación | `/api/piar/:id/dua` | [PROBADO LOCAL] |
| RF-21 | Registrar diagnósticos | Media | Asociados al estudiante y opcionalmente al PIAR | `/api/diagnosticos` | [PROBADO LOCAL] |
| RF-22 | Registrar observaciones y seguimientos | Alta | Registros inmutables; el seguimiento puede enlazar un ajuste | `/api/observaciones`, `/api/seguimientos` | [PROBADO LOCAL] |
| RF-23 | Cerrar y reabrir PIAR | Alta | El cierre deja el plan en solo lectura (409); solo el Coordinador reabre, con justificación | `DELETE /api/piar/:id`, `POST /api/piar/:id/reapertura` | [PROBADO LOCAL] |
| RF-24 | Consultar historial y versiones | Media | Lista de versiones y detalle de cada una | `/api/piar/:id/versiones`, `/api/historial` | [PROBADO LOCAL] |
| RF-25 | Generar informes | Media | Instantánea persistente construida por el servidor, con hash del contenido | `reports.js`, `/api/reportes` | [PROBADO LOCAL] |
| RF-26 | Consultar tablero | Media | Totales, avance promedio, distribución y alertas | `/api/dashboard/resumen` | [PROBADO LOCAL] |
| RF-27 | Portal del Estudiante | Media | Consulta de solo lectura del propio PIAR, con proyección reducida | `student-portal.js` | [PROBADO LOCAL] |

## 6.2 Requisitos no funcionales

Tabla: Requisitos no funcionales

| Código | Categoría | Requisito | Cómo se cumple | Estado |
|---|---|---|---|---|
| RNF-01 | Seguridad | Contraseñas almacenadas con hash robusto | bcrypt con factor 12; política de 14 caracteres mínimo y 72 bytes máximo | [IMPLEMENTADO] [PROBADO LOCAL] |
| RNF-02 | Seguridad | Sesiones seguras y revocables | Token aleatorio guardado como hash en `sesion_usuario`; cookie `HttpOnly`, `SameSite=Lax` y `Secure` en producción; duración de 8 horas | [PRODUCCIÓN] (cabeceras) |
| RNF-03 | Seguridad | Autorización en el servidor con denegación por omisión | `authorization.js`; la interfaz solo oculta lo que el servidor negaría | [IMPLEMENTADO] [PROBADO LOCAL] |
| RNF-04 | Seguridad | Protección contra fuerza bruta | Límites por IP, por cuenta y por par IP-cuenta; almacén en MySQL en producción | [IMPLEMENTADO] [PROBADO LOCAL] |
| RNF-05 | Seguridad | Cabeceras y política de contenido | CSP sin `'unsafe-inline'`, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer` | [PRODUCCIÓN] |
| RNF-06 | Seguridad | Protección contra CSRF | Toda escritura exige un `Origin` permitido (`CORS_ORIGIN`); otro origen recibe 403 | [PRODUCCIÓN] |
| RNF-07 | Privacidad | Mínima exposición de datos personales | Errores sin mensajes de MySQL; registros sin tokens, contraseñas ni correos; auditoría sin contenido pedagógico | [IMPLEMENTADO] [PROBADO LOCAL] |
| RNF-08 | Integridad | Integridad referencial y transacciones | 47 claves foráneas; transacciones en operaciones compuestas | [IMPLEMENTADO] |
| RNF-09 | Disponibilidad | Arranque seguro y apagado ordenado | `production-config.js` impide arrancar con configuración insegura; manejo de `SIGTERM` | [PROBADO LOCAL] (imagen Docker) |
| RNF-10 | Rendimiento | Respuesta ágil del inicio de sesión | Respuesta 401 en 451 ms medida en producción; límite de 30 s en el cliente | [PRODUCCIÓN] |
| RNF-11 | Usabilidad | Interfaz adaptable y en español | Diseño adaptable revisado a 1440 y 390 px; textos en español | [PROBADO LOCAL] |
| RNF-12 | Accesibilidad | Uso con teclado y lector de pantalla | Etiquetas en formularios, `aria-busy` en botones de envío, contraste del diseño | [IMPLEMENTADO] |
| RNF-13 | Mantenibilidad | Esquema reproducible | 16 migraciones (000–016) con checksum SHA-256 registrado en `schema_migrations` | [PRODUCCIÓN] |
| RNF-14 | Portabilidad | Ejecución en contenedor | Imagen `node:22-alpine` con usuario sin privilegios | [PRODUCCIÓN] |
| RNF-15 | Compatibilidad | Navegadores modernos | Probado en Chrome; usa `fetch`, `AbortController` y `Proxy` de JavaScript estándar | [PROBADO LOCAL] |
