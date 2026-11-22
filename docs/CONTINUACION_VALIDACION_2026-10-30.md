> **Documento histórico.** El estado vigente está en `docs/ESTADO_FINAL_PROYECTO.md` (2026-11-22) y las decisiones en `docs/DECISIONES_TECNICAS.md`. Este informe se conserva como registro y puede contradecirlos.

# Continuación de validación local

Fecha: 30 de octubre de 2026  
Rama observada: `security/fase-1-hardening`

## Estado del repositorio

El repositorio ya contenía cambios locales extensos antes de esta revisión, incluidos cambios en backend, frontend, migraciones, documentación, pruebas y archivos sin seguimiento. Se conservaron todos; no se ejecutaron comandos Git que alteren o descarten cambios.

## Verificaciones realizadas

- Suite unitaria configurada en el proyecto: **152 aprobadas, 0 fallidas, 0 omitidas** (`node --test --test-concurrency=1` con los archivos definidos por `test:unit`).
- `node --check` pasó para `backend/server.js`, `backend/auth.js`, `backend/piar-versioning.js` y `public/js/app.js`.
- `git diff --check` terminó sin errores de espacios o conflictos; Git mostró únicamente avisos de conversión LF/CRLF.
- No se leyeron `.env` ni `.env.test`, y no se imprimieron credenciales.

## Bloqueo de integración y migraciones

La inspección solicitada no pudo confirmar el contenedor porque el ejecutable `docker` no está disponible en este entorno. Por tanto, no se pudo validar el nombre, imagen, estado, almacenamiento efímero, puerto publicado ni la identidad y privilegios efectivos de `piar_test`.

Por la precondición de seguridad, no se consultó ni modificó MySQL, no se aplicó ninguna migración y no se ejecutó la suite de integración. No se inició el backend real ni se afirmó que frontend y backend estén integrados. Los puertos 3306, 3307 y 3308 no fueron usados para conexión de base de datos.

Las pruebas de migración unitarias confirman que el SQL 008 define `piar_barrera` y `piar_ajuste_evidencia`, además de los vínculos de trazabilidad. Esto valida la estructura en texto, pero no sustituye su aplicación y verificación contra MySQL.

## Comando para repetir la suite unitaria en PowerShell

`npm.ps1` fue bloqueado por la política de ejecución de PowerShell al invocar `npm test`; se usó directamente Node para ejecutar el mismo conjunto configurado por `test:unit`:

```powershell
node --test --test-concurrency=1 tests/admin-account-operations.test.js tests/auth-registration.test.js tests/auth-session.test.js tests/authorization.test.js tests/bootstrap-local-primary-admin.test.js tests/database-config.test.js tests/email-delivery.test.js tests/email-verification.test.js tests/fresh-test-container.test.js tests/institution-config.test.js tests/local-demo-accounts.test.js tests/local-piar-test-config.test.js tests/login-throttle.test.js tests/migration-validator.test.js tests/oidc.test.js tests/password-reset.test.js tests/pedagogical-model.test.js tests/pedagogical-ui.test.js tests/piar-version-history-ui.test.js tests/primary-admin-bootstrap.test.js tests/rate-limit.test.js tests/registration-approval.test.js tests/registration-requests-ui.test.js tests/security-controls.test.js tests/security-output.test.js tests/ui-permissions.test.js tests/visual-demo-server.test.js
```

La integración puede continuar cuando Docker vuelva a estar disponible y se pueda verificar `piar-mysql-test-fresh` con su publicación exclusiva en `127.0.0.1:3308` y el esquema `piar_test`. Después deben revisarse los grants efectivos, aplicar en orden las migraciones pendientes únicamente a ese destino y ejecutar la suite autorizada.

## Reintento de continuación (30 de octubre de 2026)

Se intentó continuar desde una terminal donde el usuario indicó que Docker estaba disponible. La comprobación efectiva contradijo esa indicación: `docker ps` terminó con `docker` no reconocido; tampoco existe `docker.exe` en las ubicaciones estándar de Docker Desktop consultadas. Por tanto, no fue posible comprobar el contenedor exacto, su publicación, esquema actual ni grants efectivos. No se intentó ninguna conexión a MySQL.

Se ejecutó `node scripts/run-local-integration-test.js fresh`. El guard del script falló antes de solicitar la contraseña o iniciar pruebas: `No se pudo verificar piar-mysql-test-fresh`. No se leyeron `.env` ni `.env.test`, ni se usaron los puertos 3306, 3307 o 3308.

La revisión del SQL 008 confirma que es aditivo y requiere primero el esquema base: las tablas `piar`, `usuario`, `piar_ajuste` y `seguimiento`; `piar_ajuste.id_piar` y `seguimiento.id_piar`; además añade una clave única compuesta en `piar_ajuste` usada por dos claves foráneas compuestas. En este repositorio, las tablas/columnas base aparecen en `database/migrations/000_railway_schema.sql` y `database/migrations/001_mvp_core.sql`. Los SQL 007 y 008 son migraciones separadas; revisar el esquema real es necesario para decidir cuáles faltan, y no se aplicó ninguna. No se afirmó que 008 haya pasado contra MySQL.

El trabajo queda bloqueado antes de la base de datos y, por dependencia, antes del backend real y la revisión funcional del frontend. Para reanudar, esta sesión necesita acceso al ejecutable Docker en el `PATH` o su ruta completa. El siguiente paso seguro es inspeccionar solo `piar-mysql-test-fresh`, verificar `127.0.0.1:3308`, la base `piar_test`, su esquema y los grants DML limitados; después aplicar únicamente migraciones pendientes, ejecutar integración y arrancar backend/frontend con el perfil fresh.

## Continuación completada en esta sesión

Docker Desktop estaba accesible en una ruta de usuario protegida por el sandbox. Con inspección elevada y el guard del proyecto se confirmó `piar-mysql-test-fresh`, imagen `mysql:8.0`, estado activo, datos en `tmpfs`, sin volumen persistente de MySQL y publicación exacta `127.0.0.1:3308`. La identidad SQL quedó verificada como `piar_test` (puerto interno 3306); `piar_test` tiene solo `SELECT`, `INSERT`, `UPDATE` y `DELETE` en `piar_test.*`. No se conectó a los servicios observados en 3307 o 8080.

El esquema ya contenía los campos de 006 y la tabla `piar_auditoria` de 007. Se aplicaron únicamente `008_piar_traceability.sql`, `009_admin_account_audit.sql` y `010_registration_decision_reason.sql` a `piar_test`. La inspección posterior confirmó las tablas y columnas requeridas por las pruebas. No se aplicó ninguna migración a `piar`.

Para cumplir la regla de no leer `.env`, se ajustó `backend/config.js` para omitir ese archivo cuando `NODE_ENV=test`; el runner ya inyecta todas las variables explícitas del perfil fresh. La primera ejecución de integración encontró un fallo de limpieza por dependencias del historial de versiones y perfiles docentes/estudiantes. Se corrigió `tests/integration.test.js` para recuperar todos los PIAR del fixture y borrar sus dependencias antes de los padres. Se retiró el fixture de la ejecución fallida con una transacción DML acotada a usuarios sintéticos en `piar_test`; la comprobación final encontró cero usuarios de fixture retenidos.

Resultados de la repetición:

- Suite unitaria `test:unit`: **152 aprobadas, 0 fallidas, 0 omitidas**.
- Suite de integración en perfil `fresh`: **12 aprobadas, 0 fallidas, 1 omitida**. La omisión es la prueba de rechazo del rol `Estudiante`, que no puede representarse en el `ENUM` local; su denegación está cubierta por `tests/authorization.test.js`.
- El runner levantó el backend real en `127.0.0.1:8081`, conectado a `piar_test`, y lo cerró después de las pruebas.
- Después se dejó el backend en ejecución en `127.0.0.1:8081` con `NODE_ENV=test` y la conexión explícita a `piar_test`; `/api/health` respondió 200.
- La revisión HTTP de frontend obtuvo 200 para `/`, las 10 hojas de estilo/scripts enlazados y 401 en `/api/auth/me` sin sesión. La vista visual completa en navegador no pudo inspeccionarse porque el host de automatización indicó `Browser access host is unavailable`; no se usó la demo visual.
- La comprobación final volvió a validar contenedor, destino, grants, objetos migrados, cero fixtures retenidos y salud del backend. No se leyeron ni imprimieron `.env` o `.env.test`, y no se mostraron contraseñas.

## Validación funcional del frontend real (30 de octubre de 2026)

Se retomó sin repetir migraciones ni la suite unitaria completa. Antes de las solicitudes HTTP se verificó nuevamente el contenedor exacto `piar-mysql-test-fresh`, publicación exclusiva `127.0.0.1:3308->3306/tcp` y estado saludable. Una consulta dentro de ese contenedor, con `--database=piar_test`, confirmó `DATABASE()=piar_test`, usuario efectivo `piar_test@%`, servidor de solo lectura desactivado y puerto MySQL interno 3306. No se usaron los puertos de host 3306, 3307 ni 8080, ni se consultó otra base.

El backend de pruebas seguía escuchando en `127.0.0.1:8081` (PID 32592); `/api/health` respondió `200 {"status":"ok"}`. Las comprobaciones HTTP contra ese origen dieron 200 para `/`, `/js/config.js`, `/js/api.js` y `/api/config`; dieron 401 sin cookie en `/api/auth/me`, `/api/estudiantes` y `/api/usuarios`, como corresponde a una sesión ausente. La configuración servida vincula `baseUrl` a `window.location.origin`, y `api.js` usa `credentials: "include"`; por ello la aplicación abierta en 8081 dirige sus llamadas API al mismo backend de pruebas.

Se ejecutaron pruebas de interfaz enfocadas (sin DB ni datos de demo): `tests/ui-permissions.test.js`, `tests/pedagogical-ui.test.js`, `tests/registration-requests-ui.test.js` y `tests/piar-version-history-ui.test.js`: **22 aprobadas, 0 fallidas**. Cubren inicio de sesión y campos accesibles, acciones PIAR por rol, restricciones docentes/asignaciones, solicitudes solo para Administrador, controles pedagógicos, y presentación de errores 403/404 en historial. La suite de integración `fresh` previamente aprobada en esta misma continuación ya ejercitó los endpoints reales de login, sesión, cierre de sesión, aislamiento entre cuentas y autorización 403 por rol; se conserva su resultado de 12 aprobadas, 0 fallidas y 1 omitida, sin crear fixtures adicionales en esta fase.

La automatización visual no permitió completar la inspección en navegador: `cua.getState()` detectó Firefox pero reportó `Browser access host is unavailable`, y la ventana de Firefox no expuso estado de accesibilidad. No se usó la demo visual ni se atribuyen pruebas visuales. Por ello quedan pendientes la navegación interactiva observada en navegador (login y logout desde formularios, menús y módulos de cada rol) y la comprobación visual de mensajes en respuestas 401/403. Se verificaron en su lugar la configuración servida, respuestas HTTP reales sin sesión y las pruebas automatizadas de UI/backend descritas arriba.

Archivos modificados en esta fase: solo este informe. No se encontró un defecto nuevo que justificara cambios de código. Riesgo abierto: falta la revisión visual de los flujos interactivos, aunque la ruta de API, autenticación y reglas por rol pasan las verificaciones HTTP y pruebas disponibles. Próximo paso: repetir la revisión en navegador cuando el host de automatización esté disponible, usando el origen `http://127.0.0.1:8081` y cuentas de prueba del perfil fresh, con limpieza garantizada en `piar_test`.

## Revisión de autenticación y proveedores (31 de octubre de 2026)

Se revisó el estado de Git antes de esta continuación. Había numerosos cambios locales y archivos sin seguimiento, entre ellos `backend/auth.js`, `backend/server.js`, `backend/oidc.js`, `public/css/auth.css`, `public/index.html`, scripts de bootstrap, migraciones y pruebas. Se conservaron; no se ejecutaron comandos de limpieza o reversión. No se leyeron `.env` ni `.env.test`.

La implementación presente contiene login local con contraseña bcrypt, sesión en cookie `HttpOnly`, cierre de sesión/revocación, registro público restringido al rol Docente, verificación de correo, recuperación de contraseña y decisiones administrativas de aprobación/rechazo con auditoría. Los estados pendientes no son aceptados por el login ni por la consulta de sesión. Hay límites de intentos para autenticación y rutas administrativas protegidas por rol. El flujo OIDC incluye inicio, callback, estado/nonce/PKCE y vinculación desde una sesión local. El formulario y sus estilos están en `public/js/app.js` y `public/css/auth.css`; la vista se crea desde JavaScript en el elemento `#viewRoot`, por lo que `public/index.html` no contiene una plantilla de login fija. La hoja de estilos actual define foco visible, estados de carga/deshabilitado y reglas responsive. La inspección visual automatizada en Edge no se completó en esta sesión.

El backend existente en `127.0.0.1:8081` respondió `200` en `/api/config` y `/api/auth/oidc/providers`. Este último informó `google: false`, `microsoft: false`, `apple: false`; por tanto los tres proveedores siguen sin configuración efectiva y no se intentó redirección OAuth. `/api/auth/me` respondió `401` sin cookie, esperado para una sesión anónima. No se hizo una prueba de registro ni aprobación en base de datos en esta revisión.

El bootstrap interactivo real es `scripts/bootstrap-local-primary-admin.js` (también invocado por `scripts/bootstrap-primary-admin.js`). Fija host `127.0.0.1`, puerto `3308`, base y usuario `piar_test`; comprueba base/puerto/identidad SQL y grants, lee la contraseña SQL y la contraseña inicial sin mostrarlas, exige confirmaciones exactas y crea un administrador pendiente, con hash bcrypt y auditoría. No eleva una cuenta existente. Antes de usarlo exige transporte de correo persistente; no debe usarse un modo de desarrollo que simule la entrega. Esta ejecución no pudo verificar el contenedor `piar-mysql-test-fresh` y sus grants en vivo, así que el bootstrap no se ejecutó, no se consultó MySQL, no se buscó una cuenta existente ni se cambió ninguna cuenta. La creación y el acceso inicial de `[correo de la Administradora principal]` siguen pendientes. No hay contraseña que reportar: debe definirse interactivamente al correr el bootstrap después de validar el destino y preparar SMTP real, y el administrador debe completar la verificación desde el enlace recibido antes de iniciar sesión. No se envió correo en esta revisión.

### Comprobaciones de esta revisión

- `node --check` en `backend/server.js`, `backend/auth.js`, `backend/oidc.js`, `scripts/bootstrap-local-primary-admin.js` y `public/js/app.js`: completó sin errores de sintaxis.
- `git diff --check`: sin errores; solo avisos de conversión LF/CRLF.
- HTTP real al backend: `/api/config` 200, `/api/auth/oidc/providers` 200 con los tres proveedores no configurados, y `/api/auth/me` 401 sin sesión.
- Se inició una ejecución enfocada de pruebas para bootstrap, OIDC, registro/sesión, verificación/recuperación y aprobación. No se obtuvo un resultado completo antes de terminar la sesión de herramientas; no se declara aprobada ni fallida y no se repitió una suite completa.
- Las pruebas de interfaz en Edge no se repitieron. La evidencia previa en este documento registra que el host de automatización del navegador no estaba disponible; esta revisión no sustituye esa observación con una demo.

### Pasos siguientes

1. Verificar que el único destino sea `piar-mysql-test-fresh`, publicado en `127.0.0.1:3308`, y que la conexión devuelva `DATABASE() = piar_test`, puerto interno `3306` y usuario `piar_test` con grants DML acotados. Si cualquiera de estas comprobaciones falla, detenerse sin conectar ni escribir.
2. Configurar transporte SMTP real sin revelar secretos, confirmar que puede entregar correo y ejecutar interactivamente `node scripts/bootstrap-local-primary-admin.js`. Usar `[correo de la Administradora principal]`, comprobar la existencia previa que el script informa y completar las confirmaciones solo con autorización institucional verificada. Definir la contraseña en la entrada oculta y conservarla solo mediante el canal seguro de credenciales institucional.
3. Completar la verificación desde el enlace realmente recibido; entonces iniciar sesión con ese correo y la contraseña establecida interactivamente, comprobar el panel administrativo, aprobar y rechazar una solicitud sintética en `piar_test`, y confirmar actor/fecha de auditoría.
4. Proporcionar y validar clientes y URI de callback autorizadas para Google, Microsoft y Apple; hasta entonces deben permanecer no disponibles.
5. Repetir las pruebas enfocadas de autenticación con resultado capturado y revisar la pantalla en Edge cuando la automatización del navegador esté disponible.

### Cierre de cambios de interfaz (31 de octubre de 2026)

Se quitó de `public/js/app.js` el panel izquierdo con textos y elementos decorativos repetidos. El acceso usa una tarjeta centrada de una columna con wordmark PIAR, título semántico, pestañas con estado accesible y formularios locales existentes. `public/css/auth.css` ahora ajusta el ancho de la tarjeta de registro, espacio, foco visible, campos y disposición para móvil. Los botones de proveedor empiezan deshabilitados mientras consultan `/api/auth/oidc/providers`; se habilitan únicamente cuando el backend informa `true`, y muestran “No disponible” junto con `aria-disabled` cuando la respuesta es falsa o no se puede consultar. El login local no cambió.

Se actualizaron las pruebas de `tests/ui-permissions.test.js` para comprobar el estado deshabilitado inicial y la representación de una respuesta mixta de proveedores; la corrida final de UI/permisos y solicitudes terminó con **10 aprobadas, 0 fallidas**. También terminaron con **24 aprobadas, 0 fallidas** las pruebas enfocadas de OIDC, registro, sesión y aprobación, y con **26 aprobadas, 0 fallidas** las pruebas enfocadas de bootstrap, operaciones administrativas, permisos y solicitudes. Hay casos solapados entre esas ejecuciones, por lo que no se suman como casos únicos. Una corrida intermedia falló mientras se actualizaba la expectativa anterior de botones; tras corregir la prueba, las corridas finales indicadas pasaron.

`node --check` pasó para frontend y backend revisados; `git diff --check` pasó sin errores (solo avisos LF/CRLF). Una consulta HTTP final respondió 200 para `/api/config` y `/api/auth/oidc/providers`; los tres proveedores reportaron `false`. El backend de pruebas continúa respondiendo en `127.0.0.1:8081`.


### Administrador inicial: contraseña temporal y cambio obligatorio (31 de octubre de 2026)

Se corrigió el guard de puertos del bootstrap: desde el host el destino se publica como `127.0.0.1:3308`, mientras `@@port` dentro del contenedor MySQL es `3306`. El script verifica explícitamente el nombre `piar_test`, identidad `piar_test@...`, puerto interno 3306, modo escritura, usuario limitado y grants DML sobre `piar_test.*`; cualquier discrepancia aborta antes de adquirir el bloqueo de escritura. En esta sesión se verificó el contenedor exacto `piar-mysql-test-fresh`, publicación única `127.0.0.1:3308->3306/tcp`, base `piar_test` y grants `SELECT, INSERT, UPDATE, DELETE` únicamente sobre `piar_test.*`. No se conectó a los puertos host 3306, 3307 ni 8080.

El bootstrap genera la contraseña temporal con 24 bytes criptográficos (`base64url`, 32 caracteres), la aplica con bcrypt y no la persiste en claro. Solo la imprime una vez tras crear la cuenta desde una terminal interactiva; debe copiarse directamente a un gestor de contraseñas. No ejecutar el bootstrap bajo captura de salida o registro de consola. La fila inicial queda como `Administrador`, `pendiente_verificacion`, `correo_verificado_at = NULL` y `password_change_required = 1`. No se marca correo verificado ni se salta la verificación. Después de abrir el enlace real, el primer inicio de sesión conduce a un formulario obligatorio de contraseña nueva (mínimo 14 caracteres); hasta completarlo el backend rechaza cualquier ruta protegida. El cambio almacena bcrypt, consume la marca y revoca las otras sesiones.

Se añadió `database/migrations/011_admin_initial_password_change.sql`, aditiva e idempotente. Aún no se aplicó en MySQL porque el usuario SQL de pruebas tiene solo permisos DML; debe aplicarse mediante el procedimiento de migración autorizado para el entorno de pruebas antes de reiniciar el backend con el código actualizado. El backend existente en `127.0.0.1:8081` responde, pero aún corre el proceso iniciado antes de estos cambios; no se reinició para evitar poner en servicio consultas que requieren la columna ausente.

SMTP no está configurado en el entorno de esta sesión. Faltan `EMAIL_TRANSPORT`, `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASSWORD`, `EMAIL_SMTP_SECURE` y `EMAIL_FROM` para SMTP. El transporte API alternativo requiere `PASSWORD_RESET_DELIVERY_URL` y `PASSWORD_RESET_DELIVERY_SECRET`. No se leyeron archivos de entorno ni se enviaron correos. El script ofrece configuración Gmail SMTP temporal por entrada interactiva oculta, no escribe esos valores en archivos, y verifica conexión/autenticación antes de crear la cuenta. Para Gmail: habilitar verificación en dos pasos, crear una contraseña de aplicación en Seguridad de la cuenta Google, usar `smtp.gmail.com`, puerto 465 con TLS (o 587 con STARTTLS), cuenta Gmail completa y remitente autorizado. No introducir la contraseña de aplicación en el chat.

La cuenta no se creó: además del SMTP real y de la migración 011, la rutina solicita nombre/documento y atribución/autorización del operador; esos datos institucionales no se inventaron. Ningún correo se envió ni entregó. El paso seguro siguiente es aplicar solo la migración 011 a `piar_test` con el mecanismo de migraciones privilegiado ya aprobado, reiniciar el backend apuntando a ese mismo perfil, y ejecutar el script directamente desde una terminal interactiva sin grabación de stdout; confirmar el destino y los datos del operador, configurar/verificar SMTP, copiar la contraseña temporal mostrada una sola vez y completar la verificación desde el mensaje realmente recibido. Luego cambiarla al primer acceso. Hasta entonces el admin no existe y no se puede probar el panel ni aprobar cuentas.

Las pruebas focalizadas ejecutadas tras estos cambios: bootstrap, operaciones de administrador, cambio de contraseña inicial, registro, sesiones, validador de migraciones y permisos/UI: **55 aprobadas, 0 fallidas**. `node --check` pasó en los archivos JS modificados; `git diff --check` pasó (solo avisos LF/CRLF). La prueba visual de Edge no se repitió. Se conservaron los cambios locales y no se ejecutó ninguna suite completa.

## Continuación autónoma (3 de noviembre de 2026)

Se inspeccionó únicamente `piar-mysql-test-fresh`: Docker lo reporta `running` y `healthy`, con publicación `127.0.0.1:3308` hacia el puerto interno MySQL 3306. No tiene volumen de datos persistente; sus montajes observados son solo migraciones de inicialización en modo de solo lectura. El contenedor `piar-mysql-test` en 3307 apareció en el inventario, pero no se inspeccionó ni se usó. No se abrió ninguna conexión a MySQL.

El backend no estaba escuchando en `127.0.0.1:8081` (fallaron las solicitudes a `/api/health` y `/api/config`). El runner documenta el perfil `fresh`, DB/usuario `piar_test` y el puerto host 3308, y el bootstrap fija el destino. La identidad efectiva, los grants SQL y la presencia real de `password_change_required` no se pudieron comprobar sin una contraseña SQL ingresada de forma oculta; 011 no se aplicó. No se leyó `.env` ni `.env.test`.

Se ajustó `scripts/bootstrap-local-primary-admin.js` para fijar el correo en `[correo de la Administradora principal]`, en vez de aceptar otro correo por entrada. El flujo existente sigue creando la cuenta pendiente, con correo sin verificar, contraseña temporal criptográfica y cambio de contraseña obligatorio. No se ejecutó porque aún faltan la verificación SQL, SMTP Gmail autenticado y datos reales de operador/autorización.

Pruebas enfocadas de bootstrap, operaciones administrativas, contraseña inicial, correo/verificación, registro, aprobación y autorización: **62 aprobadas, 0 fallidas**. `node --check scripts/bootstrap-local-primary-admin.js` y `git diff --check` terminaron sin errores (Git mostró avisos LF/CRLF). No se ejecutó suite de integración ni se escribieron datos.

Bloqueos para la validación de extremo a extremo: falta una credencial SQL ingresada de forma oculta para comprobar identidad/grants y determinar si falta 011; si falta, se necesita la credencial de una identidad autorizada para ALTER en `piar_test` (sin elevar al usuario DML). También hace falta una contraseña de aplicación de Google creada en la cuenta remitente, la identidad/documento y referencia de autorización institucional del operador, y acceso del destinatario al correo real para abrir el enlace. No se inventó ni se simuló ninguno de esos datos o resultados.
## Continuación de validación (3 de noviembre de 2026, sesión actual)

Se releyó este informe y el estado de Git. Se conservaron todos los cambios existentes; no se repitieron las 62 pruebas previas. No se leyeron `.env` ni `.env.test`.

Verificación de destino:

- `docker inspect piar-mysql-test-fresh` confirmó `running`, `healthy` y único mapeo `127.0.0.1:3308` a `3306/tcp`; los volúmenes de base son efímeros y solo hay montajes de inicialización en modo de solo lectura.
- Se filtraron únicamente `MYSQL_USER` y `MYSQL_DATABASE` de la configuración del contenedor: ambos son `piar_test`. No se mostró ni se inspeccionó ninguna variable de contraseña. Esto confirma la configuración inicial del contenedor; la identidad SQL efectiva y el esquema requieren iniciar sesión, y siguen pendientes.
- `Test-NetConnection 127.0.0.1 -Port 8081` devolvió `False`; el backend no está escuchando. No se inició porque aún no se ha podido validar su conexión efectiva a MySQL en el puerto 3308 y `piar_test`.
- No se abrió conexión a MySQL, ni se usaron los servicios de 3307/8080 o la base institucional.

Se revisó el SQL 011: agrega `password_change_required TINYINT(1) NOT NULL DEFAULT 0` si no existe. Como no se pudo consultar el esquema, no se afirma que la columna esté ausente o presente y no se aplicó la migración. Para hacer la aplicación segura, se añadió `scripts/apply-local-admin-password-change-migration.js`: fija el contenedor fresh y destino, vuelve a validar Docker antes de conectarse, solicita usuario/contraseña (esta última con entrada oculta), rechaza `piar_test` como identidad de migración, requiere grants `ALTER` únicamente en `piar_test.*`, comprueba la columna y su definición, y verifica el SQL 011 fijado por SHA-256 antes de ejecutarlo. No se le concedió ALTER a ninguna cuenta.

El guard compartido `scripts/fresh-test-container.js` ahora requiere estado saludable y exactamente una publicación, en loopback 3308. Se añadieron pruebas nuevas para el guard y el migrador: **6 aprobadas, 0 fallidas** (`node --test --test-concurrency=1 tests/apply-local-admin-password-change-migration.test.js tests/fresh-test-container.test.js`). `node --check scripts/apply-local-admin-password-change-migration.js` pasó; `git diff --check` no reportó errores (solo avisos LF/CRLF). Estas pruebas no se conectaron a MySQL.

Pendiente: introducir en terminal interactiva la credencial de la identidad SQL autorizada para migrar y confirmar la identidad SQL efectiva; el migrador preparado es `node scripts/apply-local-admin-password-change-migration.js`. Después de comprobar 011 se podrá configurar el backend solo con `127.0.0.1:3308` / `piar_test`, arrancarlo en 8081 y verificar `/api/health`. Continúan pendientes la contraseña de aplicación Gmail creada desde Google, los datos reales y la referencia de autorización del operador, y la apertura del enlace desde el buzón real. No se creó administrador, no se envió correo y no se ejecutaron pruebas con datos reales.
La terminal interactiva `cmd` se abrió con `node scripts/apply-local-admin-password-change-migration.js` y muestra el prompt del usuario SQL autorizado para ALTER; está esperando entrada manual del operador. La contraseña se solicitará después con eco oculto. Hasta completar esos prompts, el script no ha conectado a MySQL ni ejecutado SQL. El primer intento con PTY del runner unificado falló al crear el proceso (`Acceso denegado`); la ventana visible permite que la persona operadora controle directamente la entrada sensible.
## Identidad mínima de migración (3 de noviembre de 2026)

El migrador anterior rechazó la identidad probada al detectar `GRANT OPTION`. No se ejecutó 011 con esa identidad. Se revisó el guard: exige `ALTER` limitado a `piar_test.*`, admite solo `USAGE` global y rechaza `GRANT OPTION` y cualquier otro alcance/privilegio.

Se preparó `scripts/provision-local-admin-migrator.js`. Vuelve a validar el contenedor fresh y el destino SQL; solicita root con entrada oculta; comprueba que root está conectado a `piar_test` en el contenedor MySQL esperado; limita `piar_migrator` al host cliente exacto de esa conexión; revoca los grants previos de esa cuenta concreta, fija una contraseña nueva oculta y concede únicamente `ALTER ON piar_test.*`. Luego abre una conexión separada como `piar_migrator`, valida la identidad, muestra/valida `SHOW GRANTS` y solo ejecuta el SQL 011 fijado por hash si todos los guards pasan y la columna todavía falta. No modifica grants del usuario DML `piar_test`.

Pruebas nuevas del provisionador: **3 aprobadas, 0 fallidas** (`node --test --test-concurrency=1 tests/provision-local-admin-migrator.test.js`); sintaxis de los dos scripts pasó `node --check`; `git diff --check` sin errores (avisos LF/CRLF existentes). No se repitieron las 62 pruebas previas.

Se abrió una terminal interactiva con `node scripts/provision-local-admin-migrator.js`. Está esperando entrada manual oculta del operador. Hasta ahora no se ha ingresado root, no se ha creado ni reconfigurado `piar_migrator`, no se ha consultado `SHOW GRANTS` con esa cuenta y no se ha ejecutado 011. La validación y la migración quedan pendientes de completar esos prompts; si cualquier guard rechaza, se detiene antes de 011 y se registra el motivo real.
## Acceso root del contenedor de pruebas (3 de noviembre de 2026)

El operador reportó `ER_ACCESS_DENIED_ERROR` al autenticarse contra `127.0.0.1:3308` con `scripts/provision-local-admin-migrator.js`. No se volvieron a probar contraseñas ni se repitió el provisionador.

Se inspeccionó solo `piar-mysql-test-fresh`. Docker confirmó `mysql:8.0`, `running`, `healthy`, `RestartCount=0`, publicación única `127.0.0.1:3308 -> 3306/tcp`, `tmpfs` en `/var/lib/mysql` y ausencia de volumen o bind mount para el datadir. El contenedor fue creado el 23 de octubre y su ejecución actual comenzó el 3 de noviembre, hora local de Bogotá. Sus mounts son los SQL de inicialización y el restrictor de permisos, todos de solo lectura.

La configuración fuente `docker-compose.test.yml` define `MYSQL_ROOT_PASSWORD` mediante una referencia requerida a `.env.test`, y especifica `MYSQL_DATABASE=piar_test`, `MYSQL_USER=piar_test`; `docker-compose.test.fresh.yml` solo cambia el contenedor/publicación a loopback:3308. No se leyó `.env.test`, no se extrajo ningún valor de `Config.Env` y no se mostró ningún secreto. El SQL de inicialización `03-restrict-test-user.sql` revoca privilegios previos a `piar_test` y le concede únicamente DML (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) en `piar_test.*`.

Los logs se redujeron a indicadores booleanos, sin mostrar líneas: inicialización iniciada y terminada, creación de `piar_test` y creación de `piar_test` como usuario, todos verdaderos. También se confirmó la ejecución/mención de los SQL de inicialización montados hasta `06-restrict-test-user.sql`; 011 no forma parte de esos mounts. El resultado es consistente con una base ya inicializada en este contenedor. Según la documentación de la imagen oficial MySQL, los valores `MYSQL_ROOT_PASSWORD` y demás variables de inicialización se ignoran si el datadir ya contiene una base; cambiar esa variable no restablece la contraseña root existente ([imagen oficial MySQL](https://hub.docker.com/_/mysql/)).

**Impacto de restablecer mediante reinicio/reinicialización:** el datadir vive en `tmpfs`. Docker documenta que el contenido de `tmpfs` desaparece cuando el contenedor se detiene o reinicia ([documentación de tmpfs](https://docs.docker.com/engine/storage/tmpfs), [documentación de almacenamiento](https://docs.docker.com/engine/storage)). Por tanto, cualquier `docker stop`, `docker restart`, recreación o cambio que detenga este contenedor perdería toda la base de prueba actualmente en memoria. No se ejecutó ninguna de esas operaciones. Tampoco se puede prometer una recuperación no destructiva de root con la información disponible: no se confirmó otro usuario con privilegios administrativos y no hay acceso root válido demostrado.

Siguiente opción no destructiva: el operador debe localizar en su gestor de secretos la credencial exacta de root usada al inicializar este datadir y, solo si confirma que es la original, ingresarla una vez en un prompt oculto. El agente no leyó ni puede confirmar ese valor. Si no existe una credencial administrativa vigente, el siguiente camino requeriría acordar primero cómo respaldar o descartar expresamente el contenido efímero y obtener confirmación explícita antes de parar/reinicializar el contenedor. No se preparó ni ejecutó un reset destructivo.

Comandos/lecturas de esta revisión: `docker inspect piar-mysql-test-fresh` con campos no secretos; lectura de `docker-compose.test.yml`, `docker-compose.test.fresh.yml`, `database/test-init/03-restrict-test-user.sql` y `scripts/fresh-test-container.js`; `docker logs piar-mysql-test-fresh` reducido en memoria a indicadores, sin emitir líneas. No se accedió a MySQL, otros contenedores o puertos, y no se modificaron grants ni datos.
## Continuación de preservación y diagnóstico (3 de noviembre de 2026)

Se releyó este informe y se revisó `git status --short`, `git diff --stat` y `git diff --check`. El árbol ya contiene cambios locales extensos, archivos sin seguimiento y eliminaciones locales (`.dockerignore`, `Dockerfile`, `docs/RAILWAY_DATABASE_SETUP.md`, entre otros). Se conservaron todos; no se ejecutó ninguna operación de Git que modifique o descarte contenido. `git diff --check` no reportó errores; solo avisos de conversión LF/CRLF.

La inspección actual de `piar-mysql-test-fresh` confirma imagen `mysql:8.0`, estado `running`, salud `healthy`, cero reinicios, y una única publicación `127.0.0.1:3308 -> 3306/tcp`. El datadir `/var/lib/mysql` está en `tmpfs`; no existe montaje persistente para la base. Los únicos mounts son archivos SQL de inicialización de solo lectura. No se inspeccionaron otros contenedores ni se conectó a otros puertos o bases.

La escucha de `127.0.0.1:8081` no existe en esta revisión. No se inició el backend, porque aún no se puede demostrar una conexión efectiva a la base y usuario de prueba.

No se obtuvo un respaldo lógico: no hay una credencial DML proporcionada en una terminal interactiva oculta para esta sesión. No se intentó autenticar con contraseñas vacías, supuestas o repetidas, no se leyeron `.env` ni `.env.test` y no se creó un archivo de respaldo sin acceso a MySQL. Por la falta de respaldo verificable —incluida una restauración de comprobación en un entorno aislado permitido— no se detuvo, reinició, recreó ni modificó el contenedor, su datadir o sus usuarios. La recuperación destructiva de la fase 2 queda bloqueada hasta contar con respaldo validado y confirmación explícita del operador.

Para reanudar la fase 1 hace falta que el operador ingrese la credencial vigente del usuario DML `piar_test` en un prompt oculto y que exista un mecanismo de validación de restauración aislada autorizado que no afecte el contenedor actual ni otros servicios. La credencial no debe enviarse por chat. Sin esos elementos no se puede demostrar el respaldo exigido ni continuar de forma segura con las fases dependientes de la base.

## Respaldo lógico solicitado (3 de noviembre de 2026)

Se revisó el mecanismo sin leer archivos de entorno: `backend/database-config.js` requiere `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y `DB_PASSWORD`; `scripts/local-piar-test-config.js` fija para el perfil `fresh` `127.0.0.1:3308`, `piar_test` y el usuario `piar_test`, y recibe la contraseña como argumento en memoria. El loader de `backend/config.js` puede leer `.env` fuera del modo test, por lo que no se usó para esta tarea. No se leyeron `.env` ni `.env.test`.

Se añadió `scripts/backup-local-piar-test.js`, que vuelve a verificar el contenedor fresh, solicita la credencial DML con eco oculto, valida mediante consultas de solo lectura la identidad/base/puerto y los grants DML, y solo entonces crea un volcado lógico consistente bajo `%TEMP%/PIAR-SISTEMA-secure-backups`, fuera del repositorio. La ruta y el contenido SQL no se guardan en archivos versionados. `node --check scripts/backup-local-piar-test.js` pasó; `git diff --check` no reportó errores (avisos LF/CRLF existentes).

Se abrió el proceso interactivo del respaldo (PID 19560). En la última comprobación seguía activo y aún no existía el directorio del respaldo; por ello no se ha intentado conexión SQL y no hay resultado de autenticación ni archivo que validar. El proceso espera que el operador ingrese la credencial directamente en la ventana local. La contraseña no debe enviarse por chat. No se cambió el contenedor, ningún grant ni contraseña, y no se hizo restauración.

## Verificación del intento de respaldo (3 de noviembre de 2026)

Tras el cierre de la ventana interactiva se inspeccionó únicamente `%TEMP%\PIAR-SISTEMA-secure-backups`, sin volver a ejecutar el exportador ni solicitar otra vez la credencial. El directorio no existe (`BACKUP_DIRECTORY_MISSING`); por tanto, no hay archivo SQL que validar, no se completó el respaldo y no se puede confirmar una conexión satisfactoria ni su contenido. La ventana cerrada no dejó disponible un código de error de MySQL, así que no se atribuye una causa de autenticación. No se imprimieron ni leyeron contraseñas o datos SQL. El contenedor, sus grants y sus contraseñas no se modificaron; no hubo restauración ni migración.

## Auditoría del sistema real y estado local (4 de noviembre de 2026)

Se continuó la auditoría de arquitectura y funcionalidad descrita por el operador, conservando el árbol de trabajo preexistente, incluidas modificaciones, archivos sin seguimiento y eliminaciones locales. No se leyeron `.env`, `.env.test`, datos locales ni archivos de cookies. No se ejecutaron operaciones de Git que descarten contenido, no se hizo commit/push ni despliegue.

Se confirmó que el servicio Windows `MySQL80` está en estado `Running`; sin embargo, en esta sesión no se detectó un listener accesible en 3306, 3307 ni 3308, y el backend no escucha en 8081. No se intentó conexión SQL ni autenticación. Por ello no se puede probar qué esquema/usuario atiende el servicio ni iniciar el backend de forma segura. El operador indicó que inició MySQL; queda pendiente resolver esta discrepancia de disponibilidad de red y confirmar un destino local de desarrollo (`piar_dev` o `piar_test`) antes de toda operación SQL.

La revisión funcional y los hallazgos priorizados quedaron en `docs/auditoria-local/AUDITORIA-ESTADO-REAL-2026-11-04.md`. Entre los pendientes que impiden afirmar preparación institucional: persistencia real no verificada, estado de migración 011 no consultado, correo y administrador inicial sin ejecutar, política institucional de alcance de estudiante/psicología pendiente de definición, módulo DUA no localizado y PDF de servidor no localizado (la impresión observada usa el navegador). El piloto/Compose de prueba y contenedores se conservan: el inventario previo registra un volumen persistente en `piar-mysql-test` cuyo contenido no se verificó, y `piar-mysql-test-fresh` mantiene datos efímeros en `tmpfs`; no se detuvo ni modificó ninguno.

Se aplicó una protección al runner local de migraciones: ahora valida host loopback y esquema con nombre `piar_dev`/`piar_test` antes de permitir SQL; se agregó la prueba de destinos aceptados/rechazados y comando explícito para 011. Verificaciones ya ejecutadas tras el cambio: `node --check` de configuración y runner; pruebas de configuración **4 aprobadas, 0 fallidas**; suite `npm test` **160 aprobadas, 0 fallidas**. Estas pruebas no conectan a MySQL ni reemplazan pruebas de integración.

`git diff --check` no reportó errores de espacio, con avisos LF/CRLF en archivos preexistentes. No se aplicó 011, no se respaldó/restauró base, no se inició el backend ni se afirmó funcionamiento de flujos reales. Próximo paso: demostrar un endpoint y esquema locales de desarrollo con una consulta inicialmente de solo lectura y credenciales ingresadas mediante terminal oculta; si MySQL continúa sin listener, diagnosticar su configuración/arranque sin tocar el datadir ni cambiar credenciales.
