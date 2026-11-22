# Registro y autenticación: estado local

> **Aviso (2026-11-21):** este documento describe el diseño anterior. Las decisiones vigentes (registro de cuatro perfiles, Microsoft personal y organizacional, gestión de identidades externas y cambio de correo con verificación) están en `docs/DECISIONES_TECNICAS.md` y prevalecen sobre lo que sigue.

## Alcance de aprobación

PIAR se configura para una sola institución, Colegio Reinaldo Matiz. El servidor expone el nombre en `GET /api/config`; es identificación de la instalación, no prueba de identidad o pertenencia personal. Una configuración centralizada basta para el alcance actual, por lo que no se agrega una estructura multinstitucional.

`GET /api/usuarios` y `POST /api/usuarios/:id/aprobacion` siguen restringidos a Administrador. Rector permanece deshabilitado para revisar solicitudes porque no existe un procedimiento establecido para validar su identidad y autorización ni para aprovisionar su rol. No se afirma que una persona Rector haya sido verificada. Coordinador, Psicóloga y Docente tampoco pueden aprobar. Las decisiones de Administrador se registran en `aprobado_por_usuario_id` o `rechazado_por_usuario_id` y `decision_at`.

## Registro por correo

El alta tradicional crea únicamente cuentas `Docente`, conserva literalmente la contraseña antes de aplicar bcrypt y rechaza duplicados incluso ante colisiones concurrentes. La cuenta empieza en `pendiente_verificacion`; un enlace con token aleatorio de 256 bits se almacena como SHA-256, caduca en 24 horas y solo puede consumirse una vez. Verificar el correo cambia el estado a `pendiente`, que sigue sin permitir iniciar sesión hasta la aprobación institucional existente.

El endpoint de reenvío responde de forma genérica y aplica límites por IP y correo. Si falla la entrega, el enlace queda consumido y la cuenta sigue pendiente. El transporte reutiliza `PASSWORD_RESET_DELIVERY_URL` y `PASSWORD_RESET_DELIVERY_SECRET`; el servidor no devuelve el token. El frontend procesa el token desde el fragmento de URL y lo envía al endpoint de confirmación.

## Proveedores externos

`backend/oidc.js` ahora usa `openid-client` para descubrimiento OIDC, construcción de autorización con PKCE S256 y canje del código con validación de estado, nonce, firma y claims a cargo de la biblioteca. La configuración de Microsoft exige un tenant UUID concreto o `consumers`; Google y Apple usan emisores fijos. Apple usa `PrivateKeyJwt` con su clave privada. No hay validación JWT criptográfica escrita a mano.

El código actual incluye rutas de inicio, vinculación tras autenticación local y callback, junto con persistencia de transacciones de un solo uso e identidades enlazadas. La migración `database/migrations/003_oidc_identity.sql` crea las tablas correspondientes y los botones llaman a las rutas. Las pruebas unitarias cubren configuración, PKCE/state/nonce, validación de claims y decisiones de vinculación mediante dependencias simuladas; no prueban intercambio de código real ni cuentas de proveedores.

Queda pendiente validar el recorrido extremo a extremo con credenciales autorizadas de cada proveedor, incluyendo consentimientos, redirects registrados y onboarding institucional. La identidad externa nunca eleva el rol: una identidad no vinculada no recibe acceso institucional ni se asocia automáticamente por coincidencia de correo. Los usuarios deben tener una cuenta local aprobada y vincular desde una sesión autenticada.

## Configuración local

No se cargaron secretos ni se modificaron `.env` o `.env.test`. El archivo `.env.test.example` contiene únicamente nombres y valores vacíos/de ejemplo. Para el envío real se requiere `APP_BASE_URL` HTTPS y un servicio compatible con `PASSWORD_RESET_DELIVERY_URL`/`PASSWORD_RESET_DELIVERY_SECRET`.

Para habilitar cada proveedor, debe existir una aplicación registrada y el URI exacto de callback:

- Google: OAuth Client ID web, consentimiento configurado, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
- Microsoft: App Registration que admita las cuentas personales Outlook/Hotmail mediante autoridad `consumers`, o tenant explícito si la institución limita el acceso; `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_REDIRECT_URI`.
- Apple: Services ID, dominio y return URL verificados, clave `.p8` protegida fuera del repositorio; `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_REDIRECT_URI`.

No hay credenciales configuradas ni se probó acceso real con Google, Microsoft o Apple. La decisión institucional pendiente es si Microsoft debe aceptar también identidades organizacionales de cualquier tenant; `consumers` cubre cuentas Microsoft personales.

## Migración y validación

`database/migrations/local/003_email_verification.sql` agrega de forma aditiva la columna nullable de verificación y crea la tabla de tokens. No se aplicó automáticamente y no se modificó ninguna base local en esta tarea. Primero debe ejecutarse en la base de pruebas aprobada y luego realizar una prueba HTTP/MySQL real.

Las pruebas unitarias de registro, entrega simulada, expiración/reuso de token, aprobación, roles, recuperación de contraseña y configuración OIDC están en `tests/`. En la continuación del 20 de octubre de 2026, `npm.cmd test` pasó **69/69** y `node --check` pasó para **41 archivos JavaScript**. El preflight de conexión se dirigió exclusivamente a `127.0.0.1:3307/piar_test` y devolvió `ECONNREFUSED`; no se ejecutó la integración ni se escribieron datos. Las migraciones 002 y 003 y sus pruebas fuente fueron revisadas, pero no se ejecutaron ni se validaron contra un servidor MySQL.
