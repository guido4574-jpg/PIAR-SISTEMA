# Proyecto PIAR

Aplicación web para el seguimiento del Plan Individual de Ajustes Razonables (PIAR/PR) del Colegio Reinaldo Matiz: estudiantes, docentes, diagnósticos, barreras, ajustes razonables, DUA, observaciones, seguimientos, reportes y cuentas con seis roles (Administrador, Rector, Coordinador, Psicólogo(a), Docente y Estudiante).

Estado real de cada módulo, pruebas ejecutadas y configuraciones pendientes: `docs/INFORME_ENTREGA_PIAR.md`. Uso por rol: `docs/MANUAL_USUARIO.md`. Decisiones vigentes (D1–D6): `docs/DECISIONES_TECNICAS.md`. Despliegue en Railway, migraciones y respaldo: `docs/DESPLIEGUE_RAILWAY.md`.

## Estructura

```text
backend/      Servidor Node y API
database/     Esquemas y migraciones SQL
docs/         Manuales e informes
public/       HTML, CSS, JavaScript y recursos públicos
scripts/      Herramientas locales y pruebas
tests/        Pruebas unitarias e integración opcional
```

## Ejecutar

Instala las dependencias:

```bash
npm install
```

Copia `.env.example` como `.env` y establece un esquema local, un usuario MySQL dedicado y su contraseña. No uses `root`, no uses una base real y no compartas ni subas `.env`. La aplicación requiere `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y `DB_PASSWORD`; no elige una base por defecto.

Las migraciones no se ejecutan al arrancar la aplicación. Están versionadas en `database/migrations/NNN_nombre.sql` (000 a 016; no existe 004). La 016 (`016_email_change_request.sql`, cambio de correo con verificación, decisión D1) está preparada y **no se ha ejecutado en ninguna base**; sin ella, el cambio de correo responde 503 y el correo actual no cambia y se registran en la tabla `schema_migrations` con su checksum:

```bash
npm run db:migrate          # aplica en orden solo las pendientes
npm run db:migrate:status   # aplicada / pendiente / modificada
```

Todas son re-ejecutables. Si una migración ya aplicada cambia, el ejecutor se detiene: crea una migración nueva en lugar de editarla. Por seguridad, el ejecutor solo acepta esquemas `piar_dev*` o `piar_test*` en un MySQL de loopback, rechaza `root` y bloquea el esquema `piar`. Necesita una cuenta con privilegios DDL sobre ese esquema; la aplicación debe usar otra cuenta con solo `SELECT`, `INSERT`, `UPDATE` y `DELETE`. En una base existente, haz una copia de seguridad antes de migrar. La carpeta `database/migrations/local/` es histórica y no forma parte de la secuencia.

Instalación de una base de desarrollo desde cero:

1. Como administrador de MySQL, crea el esquema (`CREATE DATABASE piar_dev_local CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`), una cuenta de migración con `ALL` sobre ese esquema y una cuenta de aplicación con solo DML.
2. Ejecuta `npm run db:migrate` con las variables `DB_*` de la cuenta de migración.
3. Configura `.env` con la cuenta de aplicación y crea el primer administrador con `npm run db:bootstrap:admin`.

La entrega de correo requiere `APP_BASE_URL` y `EMAIL_TRANSPORT`. `api` usa `PASSWORD_RESET_DELIVERY_URL` y `PASSWORD_RESET_DELIVERY_SECRET`; `smtp` requiere `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_SECURE`, `EMAIL_SMTP_USER` y `EMAIL_SMTP_PASSWORD`. Ambos requieren `EMAIL_FROM`. Sin credenciales válidas, el adaptador falla y PIAR no confirma que el mensaje haya sido enviado. `memory` solo sirve para desarrollo local con `EMAIL_DEV_OUTBOX_SECRET` fuerte; no entrega correo real y está deshabilitado en pruebas y producción.

**Entrega académica:** el acceso se hace solo con correo y contraseña. La interfaz oculta los botones de Google, Microsoft y Apple y la opción «Identidades externas» mediante `features.externalAuth: false` en `public/js/config.js`. El código OAuth/OIDC, la vinculación de identidades (D4 y D5), sus rutas del backend y sus pruebas se conservan para una fase futura. Para reactivarlos: poner `externalAuth: true` y configurar las variables de cada proveedor que se describen a continuación.

Google requiere `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_REDIRECT_URI`. Microsoft requiere `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` y `MICROSOFT_REDIRECT_URI`, además de `MICROSOFT_TENANT_IDS` (Tenant IDs organizacionales autorizados, separados por comas) o `MICROSOFT_ALLOW_PERSONAL_ACCOUNTS=true` para cuentas personales; `MICROSOFT_TENANT_ID` sigue admitido. Apple requiere `APPLE_CLIENT_ID` (Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` y `APPLE_REDIRECT_URI`, y solo funciona con un dominio HTTPS público. Los callback deben usar el mismo origen de `APP_BASE_URL` y la ruta exacta `/api/auth/oidc/<proveedor>/callback`. Con la opción reactivada y sin estas variables, los botones se muestran deshabilitados con «No disponible». Un proveedor externo nunca crea cuentas ni concede roles: solo inicia sesión en una cuenta que ya lo tenga vinculado, y la vinculación exige la contraseña local. La cobertura automática usa simulaciones; no prueba credenciales, correo entregado ni proveedores reales.

PIAR se configura como una instalación para una sola institución: Colegio Reinaldo Matiz. El servidor publica ese nombre en `GET /api/config`; la interfaz no permite sustituirlo desde preferencias del navegador. Decisiones D2 y D3: cualquier persona puede solicitar una cuenta de Docente, Psicólogo(a), Coordinador o Rector, y el Administrador puede crearlas. Todas quedan pendientes hasta verificar el correo y hasta que un Administrador las apruebe. Solo el Administrador ve y decide las solicitudes. Administrador y Estudiante nunca se solicitan; los estudiantes se gestionan en su módulo (Administrador, Rector o Coordinador).

También puedes iniciar el proyecto con:

```bash
npm start
```

El modo de desarrollo disponible usa el watcher integrado de Node.js:

```bash
npm run dev
```

La forma compatible anterior continúa disponible:

```bash
node backend/server.js
```

Luego abrir:

```text
http://localhost:8080
```

La API local queda en:

```text
http://localhost:8080/api
```

## Variables de entorno

Las variables principales son:

| Variable | Uso | Valor local recomendado |
|---|---|---|
| `PORT` | Puerto del servidor | `8080` |
| `DB_HOST` | Host MySQL | `127.0.0.1` |
| `DB_PORT` | Puerto MySQL | `3306` |
| `DB_NAME` | Base de datos | `REPLACE_WITH_LOCAL_DATABASE_NAME` (nunca `piar`) |
| `DB_USER` | Usuario MySQL | El usuario local configurado |
| `DB_PASSWORD` | Contraseña MySQL | La contraseña local, solo en `.env` |
| `CORS_ORIGIN` | Orígenes permitidos | `http://localhost:8080,http://127.0.0.1:8080` |
| `TRUSTED_PROXIES` | Proxies inversos autorizados a fijar `X-Forwarded-For` (IP, CIDR o `loopback`) | vacío; solo se configura detrás de un proxy conocido |
| `RATE_LIMIT_STORE` | Almacén de límites de intentos: `memory` (una instancia) o `mysql` (varias instancias) | `memory` |
| `MAINTENANCE_INTERVAL_MINUTES` | Purga periódica de sesiones y tokens vencidos (`0` la desactiva) | `60` |
| `SECURITY_EVENT_RETENTION_DAYS` | Retención de `evento_seguridad` | `365` |

La ruta `GET /api/health` comprueba la disponibilidad de la API y ejecuta una consulta básica contra MySQL.

## Pruebas

| Comando | Qué cubre | Requiere |
|---|---|---|
| `npm test` | Pruebas unitarias aisladas | Nada (sin MySQL) |
| `npm run test:integration:local` | Suite HTTP + SQL contra `piar_test` | MySQL en `127.0.0.1:${PIAR_TEST_DB_PORT:-3307}` (contenedor `piar-mysql-test`) con esquema `piar_test` migrado y cuenta `piar_test` solo DML |
| `npm run test:e2e` | Flujos de extremo a extremo por rol, DUA, cierre y reapertura, administración de usuarios, anti-bloqueo y persistencia tras reinicio | Esquema desechable vacío y migrado (`PIAR_E2E_DB_*`) |
| `npm run check:secrets` | Sin datos personales ni secretos en archivos versionados | Nada |
| `npm run db:check` | Diagnóstico de solo lectura de la conexión MySQL configurada | `.env` con `DB_*` |

La integración pide la contraseña de forma oculta, o la toma de `PIAR_TEST_DB_PASSWORD` en ejecuciones no interactivas (CI). Verifica que la cuenta solo tenga DML sobre `piar_test.*`, que no queden fixtures previos, y limpia sus propios datos sintéticos. El perfil heredado `fresh` (`npm run test:integration:local:fresh`) sigue apuntando al contenedor `piar-mysql-test-fresh` en `127.0.0.1:3308`, pero ya no es obligatorio: cualquier MySQL local sirve.

La prueba e2e exige `PIAR_E2E_DB_NAME` con forma `piar_dev_*` o `piar_test_*`, una cuenta DML (`PIAR_E2E_DB_USER` y `PIAR_E2E_DB_PASSWORD`) y un esquema sin usuarios. Deja sus fixtures sintéticos en ese esquema, que debe eliminarse después. Nunca la apuntes a una base institucional.

## Demostración visual aislada

Para revisar la interfaz real sin arrancar el backend, leer `.env` ni conectarse a MySQL, ejecuta `npm run demo:visual` y abre `http://127.0.0.1:4173`. El servidor de demostración usa los archivos actuales de `public/`, enlaza solo a loopback y no importa el servidor real. Muestra el acceso y registro, y ofrece una vista de Docente con un único estudiante y PIAR claramente ficticios. No hay cuenta administrativa; las escrituras y formularios están bloqueados. La vista no usa `localStorage` ni valida permisos reales del backend; cambia de vista con una cookie de sesión sintética local. Es una revisión visual, no una demostración de integración, correo, aprobación real ni invitaciones.
