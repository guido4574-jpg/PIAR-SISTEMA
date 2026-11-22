> **Documento histórico.** El estado vigente está en `docs/ESTADO_FINAL_PROYECTO.md` (2026-11-22) y las decisiones en `docs/DECISIONES_TECNICAS.md`. Este informe se conserva como registro y puede contradecirlos.

# Validación y entrega local de PIAR-SISTEMA

Fecha de revisión: 20 de octubre de 2026. Rama: `security/fase-1-hardening`.

## Estado verificado

- La aplicación es un proyecto local Node.js + MySQL. Se retiraron el `Dockerfile`, `.dockerignore`, el manual operativo de Railway y el comando de migración denominado Railway. Se conserva el SQL `000_railway_schema.sql` como migración histórica de esquema y como inicializador de MySQL efímero de pruebas; no provisiona servidores ni crea bases automáticamente.
- Se conserva `docker-compose.test.yml` y `database/test-init/`: son recursos exclusivos de MySQL efímero para pruebas, enlazados a `127.0.0.1:3307` con almacenamiento temporal. No son infraestructura de despliegue de la app.
- La configuración MySQL requiere explícitamente host, puerto, base, usuario y contraseña, rechaza `root`, y la app/migrador rechazan el esquema `piar`. El servidor local se enlaza a `127.0.0.1` por defecto.
- `npm.cmd test`: **77/77 pruebas aprobadas**. Las pruebas nuevas cubren configuración explícita, bcrypt para correos inexistentes, rate limiting de login, `Origin` y contención de rutas estáticas.
- `node --check`: **47 archivos JavaScript** verificados. `npm ls --depth=0` pasó. `npm audit` online reportó **0 avisos** para las 17 dependencias revisadas; no se actualizaron versiones porque no aparecieron alertas que justificaran cambios.
- No se ejecutó ninguna migración. Las migraciones 002/003 tienen pruebas de estructura SQL, no se validaron contra MySQL real.

## Instalación y arranque local

1. Instala una versión vigente de Node.js y MySQL local. Crea manualmente una base de desarrollo y un usuario MySQL dedicado con permisos mínimos. No uses una base real, `root` ni la base de pruebas.
2. Ejecuta `npm install`.
3. Copia `.env.example` a `.env` y configura todos los valores MySQL; reemplaza `DB_NAME=REPLACE_WITH_LOCAL_DATABASE_NAME` por el nombre explícito del esquema local. No compartas `.env`.
4. Revisa los archivos SQL en orden `000_railway_schema.sql`, `001_mvp_core.sql`, y cualquier migración incremental aplicable. Las migraciones no corren automáticamente. Se requiere un principal autorizado para DDL y una revisión del destino antes de ejecutarlas.
5. Ejecuta `npm start` o `npm run dev` y abre `http://127.0.0.1:8080`.

Si falta una variable obligatoria, el servidor finaliza con un mensaje que identifica el nombre ausente. No hay fallback a `root`, contraseña vacía, esquema `piar` ni puerto implícito.

## Base aislada de pruebas

`npm test` corre las pruebas unitarias aisladas, sin MySQL. La prueba HTTP/MySQL escribe fixtures y solo acepta `127.0.0.1:3307/piar_test`, usuario `piar_test`, API en `127.0.0.1:8081` y contraseña ingresada interactivamente. Verifica la identidad efectiva y permisos antes de escribir.

El intento de conexión realizado en este entorno contra el destino fijado devolvió `ECONNREFUSED`; no se ejecutó integración. El servicio Windows `MySQL80` aparece `Running`, pero no hay listener TCP en 3306/3307/8081; Docker CLI no está disponible. No se inició ningún servicio ni se modificó la configuración. `docker-compose.test.yml` se conserva como opción futura de MySQL efímero: revisar el compose y las migraciones base antes de iniciarlo.

## Registro, correo y recuperación

El registro solo crea Docentes en `pendiente_verificacion`. Verificación de correo consume un token hash de un uso y cambia la cuenta a `pendiente`; Administrador o Rector deciden aprobación/rechazo, que registra actor y fecha. Login no admite cuentas pendientes o rechazadas. Recuperación responde genéricamente, consume tokens bajo transacción, actualiza bcrypt y revoca sesiones.

En desarrollo, `EMAIL_TRANSPORT=memory` guarda mensajes en un buzón local en memoria; leerlo requiere un secreto local y el enlace no se imprime en logs. Las pruebas con callbacks y transportes mock **no prueban entrega real**. API HTTPS y SMTP son adaptadores disponibles, pendientes de configuración y prueba con proveedor autorizado.

## Administrador inicial y permisos

El comando `npm run db:bootstrap:admin` apunta solo a `127.0.0.1:3307/piar_test` y solicita opt-in, confirmación del destino/titularidad y contraseña oculta. También existe un CLI general de bootstrap cuya entrada está igualmente fijada a ese destino. Ningún endpoint público crea Administradores y no existe contraseña predeterminada. Para una instalación fuera de ese entorno, el DBA de esa instancia debe preparar un procedimiento separado y aprobado; no se probó ni habilitó aquí.

El backend mantiene la matriz Administrador, Rector, Coordinador, Psicóloga, Docente y Estudiante. Para Docentes se limita cada PIAR/estudiante/recurso relacionado a una asignación activa comprobada en el servidor; el historial, dashboard y reportes institucionales no están disponibles a Docentes.

## OIDC y migraciones

Hay rutas Google/Microsoft/Apple de inicio, vínculo autenticado y callback; state/nonce/PKCE y claims se validan mediante `openid-client`, con persistencia declarada en `003_oidc_identity.sql`. Solo se probaron mocks. Faltan credenciales autorizadas, configuración de redirects y una prueba externa real; no se declara listo para producción.

`002_registration_decision_audit.sql` agrega condicionalmente los campos y llaves de auditoría a `usuario`, también en una instalación nueva basada en 000/001. `003_oidc_identity.sql` crea tablas de transacciones e identidades y depende de `usuario` de las migraciones base. Ninguna migración fue ejecutada contra la base durante esta revisión.

## Datos locales y credenciales

`data/db.json` continúa versionado y contiene datos con apariencia de demostración, incluyendo un campo de contraseña no vacío. No tiene referencias activas en aplicación/scripts/pruebas y el frontend ya no lo usa. No es posible probar desde el repositorio si esos datos son inventados o si una contraseña fue reutilizada. Se añadió a `.gitignore` para evitar nuevas incorporaciones, pero Git seguirá incluyendo la copia actualmente versionada hasta que el responsable autorice retirarla. Si la contraseña pudo ser real o reutilizada, cámbiala en todo servicio donde aplique; revisar de manera separada con autorización cómo retirar el archivo de futuras entregas y cómo responder a la exposición histórica sin reescribir el historial aquí.

## Retiro del piloto

Se quitaron el artefacto de imagen Docker de la aplicación, sus exclusiones de contexto, el manual de configuración de Railway y el script `db:migrate:railway`. Se conserva la evidencia académica histórica en `docs/auditoria-local/` y los recursos de Docker Compose dedicados exclusivamente a pruebas. No se accedió a Railway ni se borraron bases, volúmenes, secretos o archivos de datos.

## Pendiente de verificación real

- Iniciar un MySQL descartable en el destino fijado y ejecutar la prueba de integración después de validar `DATABASE()`, puerto efectivo, usuario, modo de solo lectura y grants.
- Aplicar manualmente las migraciones requeridas únicamente tras revisar el estado del esquema y confirmar la instancia de pruebas; no ejecutar 002 si 001 ya tiene campos/FK compatibles.
- Probar navegador, entrega SMTP/API y proveedores OIDC solo con cuentas autorizadas. No hay prueba de persistencia CRUD completa en este entorno.
- Eliminar/rotar cualquier dato o credencial real identificados en el archivo versionado mediante autorización del titular.

No se modificaron `.env` ni `.env.test`; no hubo commits, pushes, despliegues, ni acceso a entornos externos.

## Ejecución adicional — 20 de octubre de 2026

- `npm.cmd test`: **77/77** aprobadas. `node --check` aprobó los archivos JavaScript de `backend/`, `public/js/`, `scripts/` y `tests/`. `npm.cmd ls --depth=0` terminó correctamente. `npm.cmd audit --offline` reportó cero vulnerabilidades en caché local; no representa una consulta online actual. `git diff --check` pasó.
- Docker CLI no está instalado, así que no fue posible consultar el estado de `piar-mysql-test`, confirmar su mapeo, ni leer las tablas de `piar_test`. No se ejecutaron integración/CRUD, migraciones, correo real, proveedores OIDC reales, navegador ni pruebas PDF.
- No se usó MySQL80/3306. El código del runner de integración permanece fijado a `127.0.0.1:3307/piar_test` y valida identidad, puerto efectivo, modo de solo lectura y privilegios antes de insertar fixtures.

## Comprobación adicional del entorno local — 20 de octubre de 2026

- `sc.exe query MySQL80` reportó `RUNNING`; `sc.exe qc MySQL80` identifica `C:\ProgramData\MySQL\MySQL Server 8.0\my.ini` como archivo de opciones. Se leyeron solo ajustes no secretos: puerto 3306. La conexión TCP a 3306 responde y 3307 no; esto explica el `ECONNREFUSED` del destino fijado. No se consultó ninguna base en 3306 y no se puede confirmar si allí existe `piar_test`, porque no está verificado que sea una instancia descartable.
- `node --test --test-reporter=spec tests/migration-validator.test.js`: **7/7 aprobadas**. Son validaciones estáticas de SQL; no ejecutan migraciones ni prueban el motor.
- 002 depende de `usuario` creada por el esquema base. 001 define la tabla, y 002 agrega condicionalmente los campos/llaves de auditoría requeridos por el flujo de aprobación. 003 depende de `usuario` y agrega tablas InnoDB para transacciones OIDC e identidades, con FK y unicidad issuer/subject. El Compose de pruebas carga 000, 001, 002, 003 y 005 en orden. No se ejecutó ninguna migración.
- La opción local preparada para integración es `docker-compose.test.yml`: MySQL 8 efímero en tmpfs, publicado solo en loopback. Docker no está instalado. Se requiere habilitarlo manualmente y autorizar el inicio de ese servicio; no se iniciará ni usará MySQL80/3306. Una vez preparado el destino aislado, confirma `DATABASE()`, `@@port`, `CURRENT_USER()`, `@@read_only` y `SHOW GRANTS` como `piar_test`; entonces puede ejecutarse `npm run test:integration:local`, que solicita la contraseña oculta y escribe fixtures solo tras su preflight.
- `/data/db.json` está en `.gitignore` pero sigue versionado, por lo que Git aún lo incluiría en commits. Para conservarlo localmente y retirarlo del índice en futuras entregas, el responsable debe revisar y ejecutar `git rm --cached -- data/db.json`. Si la contraseña pudo ser real o reutilizada, rótala en cada servicio afectado; los commits previos requieren respuesta autorizada separada.

## Revalidación tras reinicio — 21 de octubre de 2026

- En la rama `security/fase-1-hardening` se conservaron todos los cambios locales. Se ajustó `docker-compose.test.yml` para montar las migraciones 002 y 005 antes de restringir los permisos del usuario de integración.
- `npm.cmd test`: **83/83** aprobadas. `node --check` aprobó 49 archivos JavaScript. `git diff --check` pasó.
- En esta sesión no se encontró Docker CLI ni un puerto escuchando en 3306–3309. Existe `.env.test`, pero no se mostraron sus valores. El contenedor MySQL y la base `piar_test` no se pudieron verificar; por ello no se ejecutó la integración ni se aplicaron migraciones.
- `db:migrate:user-state-length` apunta a `database/migrations/005_user_state_length.sql`. La ampliación a `VARCHAR(30)` está pendiente de ejecución contra una base cuyo destino y respaldo hayan sido verificados.

## Revision de seguimiento - 28 de octubre de 2026

- Estado inicial: rama `security/fase-1-hardening`; el repositorio ya tenia cambios locales extensos, archivos eliminados y archivos nuevos sin seguimiento. Se conservaron y no se leyeron archivos de credenciales.
- Se encontro y corrigio una contradiccion del bootstrap administrativo: el CLI apuntaba a `127.0.0.1:3307`, pero la guarda de escritura exigia puerto 3306. El CLI, su confirmacion y la guarda ahora exigen `127.0.0.1:3308/piar_test`; tambien construye la conexion con el perfil `fresh`. Las pruebas verifican que 3307 se rechaza y que el servidor debe reportar puerto 3308.
- `npm.cmd test`: linea base inicial 139/139 aprobadas. Tras el cambio hubo una ejecucion intermedia con 6 fallos por mocks que todavia indicaban 3306; se actualizaron esos datos de prueba y la ejecucion completa final termino con 139/139 aprobadas, 0 fallidas.
- Docker CLI no esta disponible en esta terminal, por lo que no fue posible inspeccionar el contenedor ni comprobar tablas y grants reales. No se ejecuto integracion, no se conecto a MySQL y no se alteraron 3307, 3308 ni `piar`.
- El registro publico permanece limitado a Docente. Verificacion y aprobacion siguen siendo pasos separados; no se amplio la politica de roles por falta de una decision institucional. Las pruebas unitarias cubren registro, tokens, aprobacion, autorizacion, sesiones y correo simulado. No se envio correo real.
- El bootstrap de Administrador no se ejecuto. Para continuar se necesita 3308 disponible con esquema compatible y correo configurado; no se reconstruyo el contenedor ni se aplicaron migraciones.
- Las migraciones 002 a 009 y las migraciones locales siguen pendientes de revision y autorizacion de ejecucion. No hubo cambios de esquema.
- No se hicieron commits, pushes, despliegues ni instalaciones de dependencias.- El comando de recuperacion administrativa tambien quedo fijado al perfil `fresh` de 3308 y pide confirmar ese puerto; no opera sobre las cuentas de 3307.
## Continuacion de reparacion integral - 28 de octubre de 2026

### Solicitud de perfiles

- El esquema raiz define `usuario.rol` con los roles institucionales, pero las tablas `coordinador` y `psicologa` no tienen `id_usuario`; `estudiante` es una entidad separada y no un rol de cuenta; Rector no tiene flujo aprobado de comprobacion de identidad. La aprobacion de solicitudes y el aprovisionamiento de perfil implementados solo cubren Docente.
- Se centralizo en `backend/auth.js` la lista `PUBLIC_REGISTRATION_ROLES`, actualmente `Docente`, que es el unico perfil con verificacion de correo, aprobacion y enlace de perfil completo. El formulario ahora muestra ese perfil, explica que solicitarlo no da acceso, y envia el valor del selector. El backend vuelve a validar y no admite Administrador, otros roles ni Estudiante. Para habilitar otros perfiles primero se necesita politica institucional, vinculo de identidad y flujo de aprobacion/provisionamiento correspondiente.

### Administrador, correo e integracion

- El bootstrap y la recuperacion siguen fijados a 3308 y perfil `fresh`; las guardas de mutacion exigen que MySQL reporte `piar_test`, puerto 3308, usuario de pruebas y no solo lectura. Se agregaron pruebas que comprueban que 3307 se rechaza antes de locks, grants o escrituras. No se ejecutaron estos comandos ni se cambio ninguna cuenta.
- La configuracion de correo requiere `EMAIL_FROM` y `APP_BASE_URL`. SMTP necesita `EMAIL_TRANSPORT=smtp`, host, puerto, modo TLS, usuario y contrasena SMTP; API necesita `EMAIL_TRANSPORT=api`, URL HTTPS y secreto de autorizacion. Los valores solo se configuran localmente fuera del repositorio. No se leyo `.env` ni `.env.test`, no se enviaron correos y el proveedor real sigue sin probar.
- El Compose fresco monta `000_railway_schema.sql`, `001_mvp_core.sql`, migraciones raiz `002`, `003`, `005` a `009` y `database/test-init/03-restrict-test-user.sql`. No monta `database/migrations/local/002` a `004`, destinadas a compatibilidad local. Este inventario de archivos no valida las tablas del contenedor existente: Docker no esta disponible, por tanto no se inspecciono 3308 ni se corrio integracion. No se reconstruyo el contenedor y no se ejecutaron migraciones.

### Pruebas de esta continuacion

- `npm.cmd test`: **142 aprobadas, 0 fallidas, 0 omitidas**. Incluye las nuevas pruebas de politica publica de roles, selector accesible, bloqueo de 3307 y coherencia de los destinos administrativos.
- No se probaron MySQL real, el esquema de 3308, correo real, navegador ni proveedor OIDC. No hubo commits, pushes, despliegues ni cambios a `.env*`.
## Actualizacion de autenticacion y pruebas — 28 de octubre de 2026

- Registro publico: solo admite solicitar Docente. La creacion del usuario pendiente y su token de verificacion hash ahora es transaccional; el fallo al guardar el token revierte la cuenta. El endpoint aplica limites en memoria por IP (10/15 min) y correo normalizado (5/15 min).
- Aprobacion: endpoint `POST /api/usuarios/:id/aprobacion`, reservado a Administrador. El backend rechaza autoaprobacion; el rechazo requiere motivo de hasta 500 caracteres y lo persiste junto con decisor y fecha. La interfaz solicita el motivo.
- Cambio de esquema pendiente: `database/migrations/010_registration_decision_reason.sql` agrega `usuario.decision_reason VARCHAR(500) NULL` de forma aditiva. No se ejecuto; el servidor que use el nuevo endpoint necesita esta columna.
- Roles: solo Docente tiene flujo publico soportado. Administrador, Rector, Coordinador y Psicologa requieren alta interna autorizada; Estudiante y familia no son roles tradicionales de `usuario`. No existen endpoints de invitacion implementados: faltan vinculos y permisos institucionales validados para perfiles de Coordinacion/Psicologia.
- `npm.cmd test`: 147 aprobadas, 0 fallidas y 0 omitidas. Son pruebas unitarias con mocks y verificaciones estaticas; no validan MySQL ni el correo real.
- Integracion/esquema 3308 no verificados. No se ejecuto migracion, bootstrap, recuperacion ni prueba de integracion. No se leyeron ni cambiaron `.env` o `.env.test`.

### Actualización posterior: demostración visual aislada — 28 de octubre de 2026

- `npm.cmd run test:unit`: **152 aprobadas, 0 fallidas y 0 omitidas**; duración Node **70.177 ms (aprox. 70,2 s)**. Incluye cinco pruebas nuevas del servidor de demostración visual.
- La demo usa los archivos actuales del frontend y datos sintéticos de solo lectura; no arranca el backend real, no accede a MySQL y no habilita roles administrativos. La vista Docente es solo visual y no acredita autorización backend.
- La integración HTTP/MySQL continúa pendiente. No se ejecutaron migraciones, correo real ni flujos OAuth/OIDC externos.
