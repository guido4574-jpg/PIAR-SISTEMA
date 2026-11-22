# Puesta en producción en Railway

Actualizada: 2026-11-22 (segunda revisión).

- **Estado:** ningún paso se ha ejecutado contra Railway. Todo lo marcado con 🔒 requiere autorización expresa.
- **Base de datos:** `docs/GUIA_MYSQL_MIGRACIONES.md`.
- **Orden general de las operaciones pendientes:** `docs/PROCEDIMIENTOS_PENDIENTES.md`.

## 0. Bloqueo conocido: Railway restringe el SMTP saliente

Según la documentación de Railway y las respuestas de su soporte, los planes **Free, Trial y Hobby bloquean las conexiones salientes a los puertos SMTP 465 y 587**. El SMTP saliente es una función del plan **Pro**, y en esos planes Railway recomienda proveedores de correo con API HTTPS. Fuentes:
- [Outbound Networking (Railway Docs)](https://docs.railway.com/networking/outbound-networking)
- [Station: SMTP bloqueado en Hobby](https://station.railway.com/questions/i-am-on-the-hobby-plan-but-my-smtp-port-fae4611b)
- [Station: puertos aún bloqueados tras pasar a Pro](https://station.railway.com/questions/outbound-smtp-port-465-still-blocked-a-580551e5)

Consecuencia: **Gmail SMTP solo funcionará si el proyecto está en el plan Pro.** El proyecto está en plan **Trial**. Para el periodo de evaluación académica se implementó la opción B con **Resend** (decisión D9, §7). Alternativas:

| Opción | Cambio | Costo o esfuerzo |
|---|---|---|
| A. Plan Pro de Railway | Ninguno en el código | Costo mensual del plan. Hay que comprobar la conexión con `probar-correo.js --verificar` desde Railway (§7), porque algunos usuarios informan bloqueos incluso después de cambiar de plan |
| **B. Resend por HTTPS (implementada)** | `EMAIL_TRANSPORT=resend` en `backend/email.js`; el resto del sistema no cambia | Plan gratuito de Resend, con los límites del §7, y un dominio verificado |
| C. Servicio intermedio propio con `EMAIL_TRANSPORT=api` | Un servicio HTTPS que reciba `{to, subject, text}` con `Authorization: Bearer` y lo reenvíe | Otro servicio que mantener |

Sin correo, PIAR funciona, pero no llegan los enlaces de verificación, recuperación ni cambio de correo, ni los avisos de decisión. Las respuestas al usuario no cambian, para no revelar si una cuenta existe.

## 1. Qué está preparado y verificado en local

| Elemento | Verificación (2026-11-22) |
|---|---|
| `Dockerfile` | `node:22-alpine`, `npm ci --omit=dev`, usuario `node`, `HOST=0.0.0.0`. Incluye `verificar-produccion.js`, `probar-correo.js` y `admin-transfer.js` para usarlos con `railway ssh`. Imagen `piar-sistema:ensayo-produccion-2` construida y probada |
| `.dockerignore` | Excluye `.env*`, `.git`, `tests`, `docs` y `scripts/*`, salvo los tres scripts de verificación |
| `railway.json` | Constructor `DOCKERFILE`, comprobación de salud `/api/health` (60 s), reinicio `ON_FAILURE` (3), una réplica |
| Validación al arrancar | Sin variables de producción, el contenedor no arranca y lista las que faltan |
| Migraciones remotas | 16 aplicadas por TLS desde el contenedor; la repetición no encontró pendientes |
| Verificador `npm run db:verificar` | Por TLS dentro del contenedor: 28 tablas, 16/16 migraciones, Administradora con huella idéntica |
| Traslado de la cuenta 178 | Ensayado: exportar, comprobar, importar, verificar, rechazar duplicado, revertir y volver a importar |

## 2. Referencias entre servicios

En Railway, una variable puede referirse a otra con `${{<Servicio>.<VARIABLE>}}`. `<Servicio>` es el nombre exacto del servicio MySQL tal como aparece en el panel (por omisión, `MySQL`).

**Antes de escribir nada, comprobación de solo lectura** (requiere `railway login`):
```powershell
railway status                                  # proyecto, entorno y servicio enlazados
railway variables --service MySQL --json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(Object.keys(JSON.parse(d)).join('\n')))"
```
El segundo comando lista solo los **nombres** de las variables, no sus valores. Deben existir `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD` y `MYSQLDATABASE`. `MYSQL_PUBLIC_URL` solo aparece si se activó el acceso público.

## 3. Variables del servicio PIAR-SISTEMA 🔒

| Variable | Valor | Origen |
|---|---|---|
| `NODE_ENV` | `production` | Fijo |
| `DB_HOST` | `${{MySQL.MYSQLHOST}}` | Red privada (`mysql.railway.internal`) |
| `DB_PORT` | `${{MySQL.MYSQLPORT}}` | Red privada (3306) |
| `DB_NAME` | `piar_produccion` | Creada en §5.1 |
| `DB_USER` | `piar_app` | Cuenta solo DML (§5.1). **No** `${{MySQL.MYSQLUSER}}`, que es `root` |
| `DB_PASSWORD` | Secreto de `piar_app` | Solo en el panel |
| `DB_SSL` | `off` | Tráfico interno de la red privada |
| `DB_CONNECTION_LIMIT` | `10` | Fijo |
| `APP_BASE_URL` | `https://<dominio público>` | Dominio de Railway o propio |
| `CORS_ORIGIN` | El mismo origen | Igual que `APP_BASE_URL` |
| `RATE_LIMIT_STORE` | `mysql` | Los contadores sobreviven a los redespliegues |
| `TRUSTED_PROXIES` | Vacía al principio; después, el valor verificado (§8) | — |
| `PIAR_DIAGNOSTICO_PROXY` | `1` solo durante la verificación del §8; luego se retira | — |
| `MAINTENANCE_INTERVAL_MINUTES` | `60` | Fijo |
| `SECURITY_EVENT_RETENTION_DAYS` | `365` | Fijo |
| `EMAIL_TRANSPORT` | `resend` | Opción B del §0. Con plan Pro se puede usar `smtp` (Gmail; variables `EMAIL_SMTP_*`, §7.2) |
| `EMAIL_FROM` | Dirección de un dominio **verificado** en Resend, por ejemplo `piar@<subdominio verificado>` | Con `onboarding@resend.dev` solo llega al dueño de la cuenta de Resend |
| `EMAIL_FROM_NAME` | Nombre visible, por ejemplo `PIAR Colegio Reinaldo Matiz` | Opcional |
| `RESEND_API_KEY` | Clave `re_…` con permiso **Sending access** | Solo en el panel. Se carga con `--stdin` |
| `EMAIL_TIMEOUT_MS` | `10000` | Opcional (100–30000) |

No se definen `HOST` ni `PORT` (los fijan el `Dockerfile` y Railway), ni `EMAIL_DEV_OUTBOX_SECRET`, `GOOGLE_*`, `MICROSOFT_*` o `APPLE_*`.

## 4. Conexión del operador con MySQL

| Vía | Uso | TLS | Costo |
|---|---|---|---|
| Proxy TCP público (`MYSQL_PUBLIC_URL`: host `*.proxy.rlwy.net` y su puerto) | Preparar la base, migrar, trasladar y respaldar desde este equipo | `DB_SSL=required`. Se comprueba antes con `npm run db:verificar`: debe mostrar `"tls": "sí (...)"` | Railway cobra el tráfico de salida del proxy. Se puede retirar el acceso público al terminar |
| `railway ssh` en el servicio de la aplicación | Migrar y verificar dentro de la red privada, sin exponer MySQL | No hace falta | Sin tráfico público |

Para el cliente `mysql` se usa el del contenedor local, sin instalar nada:
```powershell
docker exec -it piar-mysql-test mysql -h <host-proxy> -P <puerto-proxy> -u root -p --ssl-mode=REQUIRED
```

Si el proxy no acepta TLS (`--ssl-mode=REQUIRED` falla), no se envían credenciales sin cifrar: se usa la vía `railway ssh` (§6).

## 5. Secuencia de puesta en producción

### 5.1 Base y cuentas 🔒
Como `root` de Railway (§4):
```sql
CREATE DATABASE IF NOT EXISTS piar_produccion CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'piar_migrador'@'%' IDENTIFIED BY '<secreto A>';
GRANT CREATE, ALTER, INDEX, REFERENCES, SELECT, INSERT, UPDATE, DELETE ON piar_produccion.* TO 'piar_migrador'@'%';
CREATE USER 'piar_app'@'%' IDENTIFIED BY '<secreto B>';
GRANT SELECT, INSERT, UPDATE, DELETE ON piar_produccion.* TO 'piar_app'@'%';
SHOW GRANTS FOR 'piar_app'@'%';   -- verificación: solo USAGE y los 4 privilegios DML
```

Los secretos se generan fuera del repositorio:
```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```
Se guardan en un gestor de contraseñas, no en archivos.

### 5.2 Migraciones 000–016 🔒
Desde la raíz del proyecto, en PowerShell. `NODE_ENV=test` evita leer el `.env` local.
```powershell
$env:NODE_ENV="test"; $env:DB_HOST="<host-proxy>"; $env:DB_PORT="<puerto-proxy>"; $env:DB_NAME="piar_produccion"; $env:DB_SSL="required"
$env:DB_USER="piar_app"; $env:DB_PASSWORD="<secreto B>"
$env:MIGRATION_DB_USER="piar_migrador"; $env:MIGRATION_DB_PASSWORD="<secreto A>"; $env:PIAR_MIGRATION_CONFIRM_DATABASE="piar_produccion"
npm run db:migrate:remote:status   # 16 «sin registro»
npm run db:migrate:remote          # «Migraciones aplicadas en …/piar_produccion: 16»
npm run db:migrate:remote          # «Sin migraciones pendientes»
Remove-Item Env:MIGRATION_DB_PASSWORD, Env:MIGRATION_DB_USER
```
Después, como `root`: `ALTER USER 'piar_migrador'@'%' ACCOUNT LOCK;`

### 5.3 Verificación de las tablas
Con las mismas variables `DB_*` (cuenta `piar_app`):
```powershell
npm run db:verificar
```
Resultado esperado:
- `"tls": "sí (...)"`, `"privilegios": "solo_dml"`, `"tablas": 28`, `"migraciones": "16/16 aplicadas"`, `"usuarios": 0`;
- última línea: `VERIFICACIÓN SUPERADA.`

### 5.4 Incorporación de la Administradora 178 🔒
Paquete existente, verificado hoy: `Desktop\PIAR-SISTEMA-respaldos\transferencia-admin\admin-row-178-20261122T170030Z.json`. Su huella coincide con `piar_test`. Si la cuenta cambia antes del traslado (por ejemplo, un cambio de contraseña), se exporta de nuevo con `export --id 178`.

```powershell
(Get-FileHash "<paquete.json>" -Algorithm SHA256).Hash.ToLower()   # comparar con el .sha256
$env:TARGET_DB_HOST="<host-proxy>"; $env:TARGET_DB_PORT="<puerto-proxy>"; $env:TARGET_DB_NAME="piar_produccion"
$env:TARGET_DB_USER="piar_app"; $env:TARGET_DB_PASSWORD="<secreto B>"; $env:TARGET_DB_SSL="required"
node scripts/admin-transfer.js check  --file "<paquete.json>"      # «compatible»
$env:PIAR_TRANSFER_CONFIRM="piar_produccion"
node scripts/admin-transfer.js import --file "<paquete.json>"      # «Huella verificada: 81d64095…»
node scripts/admin-transfer.js verify --file "<paquete.json>"      # «Huella idéntica»
npm run db:verificar -- --paquete "<paquete.json>"                  # administradores 1, huellaAdmin true
```

Garantías:
- Se copia solo la fila de `usuario`.
- No se crea otra cuenta ni cambia la contraseña.
- `check` rechaza el traslado si ya existe un Administrador o la misma cuenta.
- La importación es una transacción que se revierte si la huella no coincide.

### 5.5 Respaldo inicial 🔒
```powershell
docker exec -e MYSQL_PWD="<secreto root>" piar-mysql-test mysqldump -h <host-proxy> -P <puerto-proxy> -u root --ssl-mode=REQUIRED --single-transaction --routines --triggers --no-tablespaces --set-gtid-purged=OFF --skip-extended-insert piar_produccion > "$HOME\Desktop\PIAR-SISTEMA-respaldos\piar_produccion_<fecha>.sql"
Get-FileHash "$HOME\Desktop\PIAR-SISTEMA-respaldos\piar_produccion_<fecha>.sql" -Algorithm SHA256
```
El respaldo se verifica restaurándolo en un esquema local `piar_test_ensayo_<fecha>` (`docs/GUIA_MYSQL_MIGRACIONES.md` §6) y se cifra con GnuPG como los anteriores.

### 5.6 Código 🔒
Commits según `docs/PROCEDIMIENTOS_PENDIENTES.md` §A; después, `push` y la fusión o la rama que use Railway.

### 5.7 Variables y despliegue 🔒
1. Cargar las variables del §3 en el servicio PIAR-SISTEMA, con `PIAR_DIAGNOSTICO_PROXY=1`.
2. Desplegar. Railway construye con `railway.json` y espera a que `/api/health` responda 200.
3. Revisar los registros de arranque. Deben aparecer:
   - `PIAR API y app disponibles en http://0.0.0.0:<PORT>`
   - `Conectado a MySQL`
   - las dos advertencias esperadas mientras `TRUSTED_PROXIES` siga vacía.

   No debe aparecer «Configuración de producción no válida».

### 5.8 Verificaciones posteriores
| Comprobación | Resultado esperado |
|---|---|
| `curl -sI https://<dominio>/api/health` | `200` y `Strict-Transport-Security` |
| `curl -sI https://<dominio>/` | CSP con `script-src 'self' https://cdn.jsdelivr.net` |
| `curl -s -o NUL -w "%{http_code}" https://<dominio>/api/piar` | `401` |
| `curl -s -o NUL -w "%{http_code}" https://<dominio>/api/dev/email-outbox` | `404` |
| La Administradora inicia sesión personalmente | Entra. En las herramientas del navegador, la cookie `piar_session` aparece con `HttpOnly`, `Secure` y `SameSite=Lax` |
| `railway ssh` → `node scripts/verificar-produccion.js --esperar-admin` | `VERIFICACIÓN SUPERADA.` |
| Prueba de correo (§7.1) | El mensaje llega |

## 6. Alternativa: migrar y verificar dentro de Railway
Si el proxy público no acepta TLS:
1. Desplegar primero (5.6 y 5.7). Con la base vacía, `/api/health` responde 200, pero la API falla hasta migrar.
2. Ejecutar:
```bash
railway ssh   # en el servicio PIAR-SISTEMA
MIGRATION_DB_USER=piar_migrador MIGRATION_DB_PASSWORD='<secreto A>' PIAR_MIGRATION_CONFIRM_DATABASE=piar_produccion node backend/run-migration.js --remote
node scripts/verificar-produccion.js
```
3. Para el traslado, copiar el paquete con un canal privado y ejecutar `admin-transfer.js` dentro del servicio. No se publica el dominio hasta terminar.

## 7. Correo

### 7.0 Sin proveedor todavía: `EMAIL_TRANSPORT=desactivado`
Es un modo explícito para publicar antes de tener una clave de Resend:
- el servidor arranca con una advertencia y ningún correo sale del servidor;
- la verificación, la recuperación y los avisos fallan de forma controlada: la respuesta pública no cambia y el enlace se invalida;
- la Administradora 178, ya verificada, entra con normalidad;
- las cuentas nuevas quedan pendientes hasta que se active un proveedor.

Para activar Resend se cambian `EMAIL_TRANSPORT=resend`, `EMAIL_FROM` y `RESEND_API_KEY` (§7.1).

### 7.1 Resend (opción vigente, D9)
Datos de la documentación oficial de Resend, consultada el 2026-11-22: [Envío](https://resend.com/docs/api-reference/emails/send-email), [Errores](https://resend.com/docs/api-reference/errors), [Dominios](https://resend.com/docs/dashboard/domains/introduction), [Precios](https://resend.com/pricing).

**Cómo funciona en PIAR:**
- `deliverEmail()` envía `POST https://api.resend.com/emails` con `Authorization: Bearer`, `User-Agent` (obligatorio en Resend) y el JSON `{from, to, subject, text}`.
- Tiempo de espera: `EMAIL_TIMEOUT_MS`.
- No hay reintentos automáticos.
- Ante un fallo, el registro operativo solo guarda el código HTTP y el nombre del error, nunca la clave, el destinatario ni el mensaje.

**1. Cuenta y clave** (en el navegador, por la persona responsable):
- Crear la cuenta gratuita en `https://resend.com/signup`.
- En **API Keys → Create API Key**, elegir el permiso **Sending access** y, si se puede, restringirla al dominio del paso 2.
- Copiarla una sola vez; empieza por `re_`. Se guarda en el gestor de contraseñas.

**2. Dominio remitente:**
- Sin dominio propio verificado, Resend solo entrega desde `onboarding@resend.dev` y **solo al correo del dueño de la cuenta**; a cualquier otro destinatario responde 403.
- Pasos:
  1. En **Domains → Add Domain**, añadir un **subdominio** (Resend lo recomienda), por ejemplo `notificaciones.<dominio institucional>`.
  2. Crear en el DNS del dominio los registros que muestre la pestaña **Records** (SPF y DKIM, tipos TXT/MX o CNAME). Deben copiarse exactos; si se usa Cloudflare, sin proxy (nube gris).
  3. Pulsar **Verify DNS Records**. Suele tardar unos 15 minutos, y hasta 72 horas. El estado debe quedar en `verified`.
  4. Después, añadir un registro DMARC como indica Resend.
- **Hace falta un dominio** que la institución controle. Sin él, el correo solo sirve para pruebas al dueño de la cuenta.

**3. Prueba local**, en PowerShell, sin la clave en el historial:
```powershell
$env:EMAIL_TRANSPORT="resend"; $env:EMAIL_FROM="piar@<subdominio verificado>"; $env:EMAIL_FROM_NAME="PIAR"
$s = Read-Host "Clave de Resend" -AsSecureString
$env:RESEND_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
npm run correo:probar -- --verificar       # comprueba que el dominio esté «verified»; no envía
$env:PIAR_CONFIRMAR_ENVIO="SI"; npm run correo:probar -- --enviar <buzón controlado>   # 🔒 envío real
Remove-Item Env:RESEND_API_KEY, Env:PIAR_CONFIRMAR_ENVIO
```
`--verificar` necesita una clave con **Full access**. Con la clave de solo envío responde `restricted_api_key`; en ese caso, el estado del dominio se comprueba en el panel de Resend.

**4. En Railway** 🔒:
```powershell
railway variable set --service PIAR-SISTEMA --skip-deploys EMAIL_TRANSPORT=resend EMAIL_FROM=<remitente verificado> "EMAIL_FROM_NAME=PIAR Colegio Reinaldo Matiz"
$s = Read-Host "Clave de Resend" -AsSecureString
[Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)) | railway variable set RESEND_API_KEY --stdin --service PIAR-SISTEMA --skip-deploys
```
Después del despliegue: `railway ssh --service PIAR-SISTEMA -- node scripts/probar-correo.js --verificar` y una recuperación de contraseña de una cuenta de prueba controlada.

**Límites del plan gratuito de Resend:**
- 3.000 correos al mes y **100 al día** (se reinicia a medianoche UTC);
- 3 dominios y 30 días de retención de registros;
- 10 solicitudes por segundo;
- sin pago por uso.

Al superar una cuota, Resend responde 429 (`daily_quota_exceeded` o `monthly_quota_exceeded`). PIAR mantiene la misma respuesta al usuario e invalida el enlace no entregado; la persona puede pedir uno nuevo al día siguiente.

### 7.2 Alternativa: Gmail SMTP (solo con plan Pro)

1. En la cuenta de Google institucional:
   - activar la verificación en dos pasos;
   - crear una contraseña de aplicación en `https://myaccount.google.com/apppasswords` (nombre: «PIAR Railway»);
   - copiar los 16 caracteres sin espacios.

   En una cuenta de Google Workspace, el administrador del dominio debe permitir las contraseñas de aplicación.
2. **Prueba local primero.** Desde este equipo, que no tiene el bloqueo de Railway, en PowerShell:
```powershell
$env:EMAIL_TRANSPORT="smtp"; $env:EMAIL_FROM="<cuenta de Gmail>"; $env:EMAIL_SMTP_USER="<cuenta de Gmail>"
$env:EMAIL_SMTP_HOST="smtp.gmail.com"; $env:EMAIL_SMTP_PORT="465"; $env:EMAIL_SMTP_SECURE="true"
$s = Read-Host "Contraseña de aplicación" -AsSecureString
$env:EMAIL_SMTP_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
npm run correo:probar -- --verificar                                          # «Conexión y autenticación SMTP correctas»
$env:PIAR_CONFIRMAR_ENVIO="SI"; npm run correo:probar -- --enviar <buzón controlado>   # 🔒 requiere autorización
Remove-Item Env:EMAIL_SMTP_PASSWORD, Env:PIAR_CONFIRMAR_ENVIO
```
   `Read-Host -AsSecureString` evita que la contraseña quede en el historial de la terminal. El script nunca la imprime. Ante un error, muestra la etapa y una pista; por ejemplo, el código 535 significa contraseña de aplicación rechazada.
3. **En Railway** (plan Pro): cargar las mismas variables en el panel y ejecutar `railway ssh` → `node scripts/probar-correo.js --verificar`. Si falla en la etapa de conexión (`ETIMEDOUT` o `ECONNREFUSED`), el puerto está bloqueado por el plan.
4. **Prueba funcional** 🔒: «¿Olvidaste tu contraseña?» con una cuenta de prueba controlada. Hay que comprobar que el enlace llega, que funciona una sola vez y que vence en 30 minutos.

**Límites:** Gmail admite unos 500 destinatarios al día en cuentas personales. Para volúmenes mayores, la opción B del §0.

## 8. TRUSTED_PROXIES
1. Desplegar con `PIAR_DIAGNOSTICO_PROXY=1`.
2. Abrir el sitio una vez y revisar los registros. Debe aparecer `Diagnóstico de proxy: par TCP <dirección>; saltos en X-Forwarded-For: <n>`.
   - Solo se registran las 5 primeras peticiones.
   - Nunca se registran los valores de `X-Forwarded-For`.
3. Si `<dirección>` pertenece a la red interna de Railway (privada, distinta de tu IP pública), configurar `TRUSTED_PROXIES` con la subred observada. Para un grupo de direcciones IPv4 internas, su /16 o el rango exacto que documente Railway. Nunca `0.0.0.0/0`.
4. Retirar `PIAR_DIAGNOSTICO_PROXY` y redesplegar.
5. Verificar: hacer un intento de acceso fallido con un correo inexistente. Después, como root en solo lectura: `SELECT red_origen FROM evento_seguridad ORDER BY id_evento DESC LIMIT 1;` debe mostrar tu red pública truncada (/24) y no la del proxy.

## 9. Reversión
| Situación | Acción 🔒 |
|---|---|
| Despliegue defectuoso | En Railway → Deployments → volver a desplegar la versión anterior |
| Configuración incorrecta | El servidor no arranca y Railway mantiene la versión anterior. Corregir las variables y redesplegar |
| Migración interrumpida | Las migraciones son re-ejecutables: corregir la causa y repetir `db:migrate:remote` |
| Traslado incorrecto (antes del primer acceso) | `admin-transfer.js rollback --file <paquete>` con `PIAR_TRANSFER_CONFIRM` |
| Datos dañados después de operar | Detener el servicio, restaurar el último respaldo verificado y volver a ejecutar `db:verificar` |
| Abandono completo | Retirar el dominio y el acceso público de MySQL. Eliminar `piar_produccion` solo con autorización expresa |
