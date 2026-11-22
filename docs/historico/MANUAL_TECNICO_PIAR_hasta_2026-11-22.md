# Manual técnico de PIAR-SISTEMA

> **Actualización de seguridad (26 de octubre de 2026):** las instrucciones posteriores de “Corrección de identidad y pruebas locales” reemplazan cualquier pasaje anterior que indicara que una confirmación interactiva verifica el correo. El bootstrap actual crea una cuenta pendiente; solo el consumo del token recibido verifica el correo. La implementación antigua del bootstrap quedó deshabilitada.

## Corrección de identidad y pruebas locales

Hay una sola implementación de bootstrap: `npm.cmd run db:bootstrap:admin` ejecuta `scripts/bootstrap-local-primary-admin.js`; `scripts/bootstrap-primary-admin.js` delega a ella y `backend/primary-admin-bootstrap.js` falla cerrado. El flujo se fija a `127.0.0.1:3307`, esquema `piar_test`, usuario `piar_test`, revisa destino, puerto MySQL interno, `read_only`, `CURRENT_USER()`, grants y columnas. Rechaza toda cuenta Administrador ya existente y correo/documento duplicados. No selecciona ni eleva cuentas existentes.

La CLI solicita identidad declarada del operador, referencia de autorización, motivo y contraseña oculta. Guarda la contraseña con bcrypt. La cuenta se crea `pendiente_verificacion`, con `correo_verificado_at=NULL`; el hash del token y el evento de auditoría se guardan en la misma transacción. Solo consumir el token de un uso enviado al correo verifica y activa al Administrador. Si falla el envío, la cuenta sigue pendiente y el token no entregado se invalida. La declaración del operador no prueba autenticidad personal ni propiedad del correo. No existe ruta HTTP de bootstrap.

La tabla `admin_account_audit` requiere la migración aditiva `009_admin_account_audit.sql`, disponible como `npm.cmd run db:migrate:admin-account-audit`; no se ejecutó en esta reparación. El registro distingue una declaración de operador local de la verificación por token. No es inmutable frente a una cuenta MySQL con permisos de actualización o borrado.

La recuperación explícita es `npm.cmd run db:recover:admin`: requiere escoger y confirmar manualmente el ID de un Administrador activo y registrar identidad declarada, referencia de autorización y motivo. Solo cambia el hash de esa cuenta, revoca sus sesiones y consume sus tokens pendientes; nunca cambia roles ni escoge por correo. La aprobación institucional del operador sigue siendo necesaria.

### Transporte de correo

El bootstrap CLI rechaza `EMAIL_TRANSPORT=memory`, cuyo buzón solo existe dentro del proceso servidor. SMTP requiere `EMAIL_TRANSPORT=smtp`, `EMAIL_FROM`, `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_SECURE`, `EMAIL_SMTP_USER` y `EMAIL_SMTP_PASSWORD` (465 TLS; 587 STARTTLS). El transporte API requiere `EMAIL_TRANSPORT=api`, `PASSWORD_RESET_DELIVERY_URL` HTTPS, `PASSWORD_RESET_DELIVERY_SECRET` y un endpoint que reciba `{to, subject, text}` y responda 2xx. `APP_BASE_URL` debe ser el origen de la interfaz. No se comprobó envío real en este entorno; aceptación del proveedor no confirma recepción. OIDC permanece sin credenciales externas ni prueba real.

### Integración aislada

`npm.cmd test` solo ejecuta unitarias sin MySQL. La integración exige el contenedor `piar-mysql-test-fresh` (MySQL 8.0), datadir en tmpfs, sin volumen persistente, puerto loopback `127.0.0.1:3308`; el runner verifica metadatos Docker antes de pedir contraseña o conectar. Los fixtures de una ejecución se limpian por sus propios IDs. Fixtures sintéticas retenidas bloquean la suite sin borrado automático. No se ejecutó integración en esta reparación.

## Requisitos e instalación local

- Node.js compatible con `package-lock.json` y MySQL local.
- `npm install` instala dependencias fijadas por el lockfile.
- Copiar `.env.example` a `.env`, completar explícitamente `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `PORT`, `APP_BASE_URL` y `CORS_ORIGIN`. La app rechaza usuario MySQL `root`, falta de puerto y esquema `piar`; no usa configuración de conexión por defecto.
- Ejecutar las migraciones manualmente con un principal autorizado y después de verificar el destino. El servidor nunca migra al iniciar. `npm start` inicia; `npm run dev` activa el watcher. De forma predeterminada el listener se limita a `127.0.0.1`.

## Componentes

- `backend/server.js`: API HTTP, sesión, matriz de autorización, rate limits, control de origen y servidor estático limitado a `public/`.
- `backend/database-config.js`: validación compartida de conexión MySQL explícita.
- `backend/auth.js`, `registration-approval.js`, `email.js`: registro/verificación/aprobación, recuperación, sesiones y adaptadores de correo.
- `backend/authorization.js`: reglas por rol y método; el middleware verifica asignación de PIAR para Docente.
- `backend/oidc.js`: Google, Microsoft y Apple mediante `openid-client`; pruebas mock, sin credenciales reales en el repositorio.
- `database/migrations/`: migraciones versionadas `000_base_schema.sql` a `013_piar_dua.sql` (no existe 004), aplicadas con `npm run db:migrate` y registradas en `schema_migrations` con checksum (`backend/migrations.js`). El esquema base se llamaba `000_railway_schema.sql`; se renombró al retirar el piloto de Railway.

## Seguridad y flujos

El registro fuerza rol Docente en estado `pendiente_verificacion`; el token hash tiene un uso y expira. Verificar el correo cambia a `pendiente`, no activa el usuario. Administrador/Rector registran quién aprobó/rechazó y cuándo. Login solo acepta `activo`, aplica límites por IP y correo y hace una comparación bcrypt también si el correo no existe. Recuperación mantiene respuesta pública genérica, token de un uso/expirable, bloqueo de fila, transacción y revocación de sesiones.

Los cambios HTTP validan el `Origin` contra orígenes exactos de `CORS_ORIGIN`; el `*` no se admite con cookies. El servidor estático normaliza y decodifica la ruta y la mantiene bajo `public/`. La interfaz usa `escapeHTML` en campos de datos antes de sus plantillas HTML; IDs insertados en manejadores se convierten a número y clases se producen mediante listas cerradas.

El rol Docente solo accede a PIAR y estudiantes con asignación activa comprobada por backend. Los endpoints de registros relacionados consultan por relación PIAR; las escrituras validan nuevamente el PIAR y estudiante. Historial/reportes/resumen son institucionales. No se cambió la matriz institucional.

La aprobación de una solicitud Docente crea o reactiva, dentro de la misma transacción, un único perfil `docente` enlazado por `id_usuario`. La resolución de perfil bloquea el acceso si el usuario no tiene perfil activo o tiene perfiles duplicados. El docente trabaja sobre PIAR asignados y puede crear otro PIAR para un estudiante que ya esté dentro de ese ámbito; el servidor rechaza la operación si no existe una asignación previa. La asignación inicial se realiza desde un perfil institucional, porque el esquema vigente representa el vínculo mediante `piar_docente`.

Las actualizaciones de diagnósticos, seguimientos y observaciones validan que el PIAR y el estudiante destino coincidan; un Docente no puede cambiar esas relaciones mediante payload HTTP. Las listas y detalles para Docente usan asignaciones en SQL; los endpoints individualizados responden como no encontrado cuando el recurso queda fuera del alcance. El dashboard docente devuelve indicadores calculados solo sobre PIAR asignados. Las respuestas de listados sensibles enumeran columnas y no usan `SELECT *`.

La auditoría `piar_auditoria` registra actor, método, tipo/identificador de recurso, resultado HTTP y fecha, sin guardar cuerpo de petición ni contenido pedagógico. Su tabla se define en `database/migrations/007_piar_audit_events.sql`; debe existir en el esquema antes de operar si la institución exige trazabilidad persistente. La migración no se ejecuta al iniciar la aplicación.

## Alcance pedagógico y referencias normativas

El modelo PIAR existente cubre contexto/caracterización, valoración, barreras y estrategias, informes de salud disponibles, objetivo general/metas, ajustes, recursos, proyectos, otra información y actividades de receso; también contempla acta, informe anual y entrega pedagógica. El Decreto 1421 de 2017, incorporado en el Decreto 1075 de 2015, enumera esos componentes mínimos y describe el PIAR como herramienta pedagógica. El aplicativo permite avanzar sin diagnóstico, y los informes de salud son información que puede aportar a la definición de ajustes, no un requisito automático para crear el PIAR. El [Decreto 1421 de 2017](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?1=&i=87040), los artículos 2.3.3.5.2.3.5 a 2.3.3.5.2.3.9 del [Decreto 1075 de 2015](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=77913) y el [instructivo PIAR de Colombia Aprende](https://www.colombiaaprende.edu.co/sites/default/files/files_public/rural-adultos/2_Coleccion_Avanzada_Educacion_para_Jovenes_Adultos_Mayores/3_Estrategias_para_poblacion_con_discapacidad/3-1_PIAR_EPJAM/1_PIAR_Instructivo.pdf) son referencias funcionales, no certificación jurídica del software.

La ley exige confidencialidad y principios para el tratamiento de datos; los filtros por asignación, auditoría de metadatos y minimización de respuestas son controles técnicos implementados para apoyar esos deberes, no sustituyen la política institucional, la autorización del titular ni la revisión de cumplimiento de la [Ley 1581 de 2012](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=49981).

## Administrador inicial

`npm run db:bootstrap:admin` ejecuta `scripts/bootstrap-local-primary-admin.js`, fijado a `127.0.0.1:3307/piar_test` y usuario `piar_test`. Solicita opt-in, confirmaciones, correo verificado y contraseña oculta. Inserta bcrypt dentro de transacción y no está disponible por HTTP. El otro CLI conservado también rechaza destinos fuera de esa base. No usarlo en otros ambientes; el aprovisionamiento en otro entorno exige procedimiento DBA separado y aprobado.

## Correo y OIDC

Para desarrollo local, `EMAIL_TRANSPORT=memory` guarda los mensajes en memoria, sin imprimir enlaces; el endpoint local de buzón requiere secreto aleatorio, acceso loopback y no existe en producción. Los transportes API/SMTP requieren configuración secreta del servidor. Mocks no prueban la entrega real.

OIDC tiene rutas de inicio/vínculo/callback, state/nonce/PKCE, validación de claims, almacenamiento de transacción de un uso y unicidad issuer+subject. Enlace solo desde sesión local autenticada; correo coincidente no enlaza cuentas automáticamente. Para habilitar proveedor se necesitan credenciales y redirects exactos. El flujo externo real no está validado.

## Base de datos, pruebas y migraciones

No uses `piar` en puerto 3306. Las pruebas con escrituras fijan `127.0.0.1:3307/piar_test` y validan esquema, identidad y privilegios. `npm test` corre unitarias; `npm run test:integration:local` solicita contraseña y escribe fixtures sintéticos solo tras el preflight. Compose es opcional y solo inicia MySQL de pruebas efímero en tmpfs/loopback; no hay Dockerfile de aplicación.

`002_registration_decision_audit.sql` aplica a esquemas antiguos sin las columnas/FK de auditoría que ya trae 001. `003_oidc_identity.sql` depende de `usuario` de la base y crea tablas OIDC. No ejecutar automáticamente. Revisar el esquema y aplicar manualmente solo en la instancia aislada autorizada. En esta revisión no se ejecutaron migraciones y MySQL local respondió `ECONNREFUSED` en el destino fijado.

Las migraciones 006 y 007 son aditivas: 006 incorpora campos pedagógicos opcionales; 007 crea la tabla de auditoría de acceso. La migración 008 agrega relaciones opcionales de trazabilidad entre barreras, ajustes, evidencias y seguimientos. 006–008 se verificaron como texto SQL en pruebas, pero no se aplicaron ni comprobaron contra MySQL. Antes de usar las nuevas rutas, aplicar 008 manualmente solo a una copia/base de pruebas compatible y validar el esquema; la app no ejecuta migraciones al iniciar.

La extensión estructurada conserva `piar.barreras` y todos los ajustes/seguimientos históricos. No infiere barreras estructuradas a partir de texto libre. El detalle PIAR permite agregar barreras por contexto, ajustes con responsable/resultado/indicador/revisión, evidencias descriptivas y seguimientos enlazados al ajuste. Las referencias de evidencia son metadatos textuales; no hay carga ni custodia de archivos. Barreras y evidencias nuevas son append-only desde la API.

## Datos sensibles

`data/db.json` no tiene consumidores activos, está excluido para futuras incorporaciones y continúa versionado. Incluye un campo de contraseña no vacío y datos con apariencia de demostración; la autenticidad no puede determinarse localmente. No copiarlo a paquetes. Si una contraseña puede haberse reutilizado, rotarla en esos servicios; retirar la copia de Git requiere autorización del responsable, y la historia no se reescribe en esta entrega.

## Procedimiento operativo local: primer Administrador y correo

### Primer Administrador en `piar_test`

El comando empaquetado es `npm.cmd run db:bootstrap:admin` (`scripts/bootstrap-local-primary-admin.js`). No crea administradores desde HTTP. Está fijado a `127.0.0.1:3307`, base `piar_test`, usuario MySQL `piar_test`; requiere que el servicio de pruebas ya esté disponible, pide la contraseña de ese usuario sin eco, y verifica base seleccionada, puerto interno, `CURRENT_USER()`, `read_only`, privilegios DML y columnas requeridas. Si `DB_NAME`, `DB_HOST`, `DB_PORT` o `DB_USER` están presentes en el entorno, deben coincidir con ese destino; en particular `DB_NAME=piar` cancela el proceso.

Antes de escribir, se debe teclear la confirmación exacta de destino y luego la confirmación de escritura que muestra el programa. También requiere confirmar que el correo ya se verificó por un canal externo y que la persona está autorizada como Administrador. Solicita dos veces una contraseña nueva oculta de 14 a 72 bytes. El programa no acepta correo/documento ya existentes ni otra cuenta Administrador, usa un bloqueo MySQL para serializar ejecuciones, vuelve a comprobar duplicados dentro de una transacción y guarda solo bcrypt (factor 12). Un error revierte la transacción. No elimina ni cambia cuentas existentes. El bootstrap marca el correo verificado en la cuenta inicial únicamente tras la afirmación interactiva de quien opera; no demuestra entrega de email.

El usuario debe confirmar `npm.cmd run db:bootstrap:admin` solo después de revisar que el destino impreso y solicitado sea `piar_test`; no se debe usar el bootstrap local con otra base. La alternativa de producción necesita procedimiento de DBA separado, explícitamente autorizado y probado; el CLI local la rechaza.

### Separación de cuentas demo y Administrador principal

`scripts/create-local-demo-accounts.js` solo crea una cuenta `Docente` sintética y su perfil vinculado. No acepta variables `DEMO_ADMIN_*`, no solicita contraseña de Administrador y no inserta el rol `Administrador`. Para el Administrador principal se conserva únicamente el CLI separado `npm.cmd run db:bootstrap:admin`, que exige autorización explícita del operador, no modifica una cuenta existente y está cerrado a `127.0.0.1:3307` / `piar_test` / `piar_test`.

Las pruebas de integración mantienen el Administrador sintético necesario para probar permisos. Antes de insertar fixtures consultan si hay uno retenido con el patrón generado por la suite (correo y documento `IT` + marcador hexadecimal aleatorio + índice `0`). Si lo encuentran, cancelan la ejecución antes de crear fixtures nuevos; no identifican una cuenta principal, no cambian filas y no borran datos. La reconciliación o limpieza de fixtures retenidos requiere un procedimiento separado y autorización expresa.

### Transporte de verificación y recuperación

Verificación de registro y recuperación usan el adaptador compartido `backend/email.js`:

- Para desarrollo sin proveedor, configurar en `.env` `EMAIL_TRANSPORT=memory`, `APP_BASE_URL` con el origen local correcto y un `EMAIL_DEV_OUTBOX_SECRET` aleatorio de al menos 32 caracteres. Reiniciar el servidor y registrar un Docente de prueba. El buzón solo funciona en `NODE_ENV=development`, conexión loopback y requiere `Authorization: Bearer <secreto>` en `GET /api/dev/email-outbox`; entrega el mensaje en memoria una sola vez. Abrir desde allí el enlace de verificación prueba el flujo local de token, no envío a una bandeja real. La recuperación local puede probarse con una cuenta activa de prueba y el mismo buzón. No compartir la respuesta del buzón, porque contiene enlaces de un solo uso.
- Para envío real SMTP, establecer `EMAIL_TRANSPORT=smtp`, `EMAIL_FROM`, `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_SECURE`, `EMAIL_SMTP_USER` y `EMAIL_SMTP_PASSWORD` usando credenciales del servidor guardadas fuera del repositorio. El código exige TLS adecuado al puerto (465 seguro; 587 con STARTTLS) y certificado válido.
- El transporte alternativo `EMAIL_TRANSPORT=api` usa `PASSWORD_RESET_DELIVERY_URL` y `PASSWORD_RESET_DELIVERY_SECRET`; el endpoint debe ser HTTPS salvo el adaptador local de pruebas. Usa un servicio de entrega autorizado.

No hay prueba real de correo configurado en esta entrega. Para marcarlo operativo, hacer una prueba autorizada hacia un buzón controlado: comprobar recepción de verificación y recuperación, abrir los enlaces antes de su vencimiento y verificar los cambios de estado/contraseña. Los tests mock de SMTP/API solo verifican validación e invocación.

## Actualizacion de autenticacion y pruebas — 28 de octubre de 2026

- Registro publico: solo admite solicitar Docente. La creacion del usuario pendiente y su token de verificacion hash ahora es transaccional; el fallo al guardar el token revierte la cuenta. El endpoint aplica limites en memoria por IP (10/15 min) y correo normalizado (5/15 min).
- Aprobacion: endpoint `POST /api/usuarios/:id/aprobacion`, reservado a Administrador. El backend rechaza autoaprobacion; el rechazo requiere motivo de hasta 500 caracteres y lo persiste junto con decisor y fecha. La interfaz solicita el motivo.
- Cambio de esquema pendiente: `database/migrations/010_registration_decision_reason.sql` agrega `usuario.decision_reason VARCHAR(500) NULL` de forma aditiva. No se ejecuto; el servidor que use el nuevo endpoint necesita esta columna.
- Roles: solo Docente tiene flujo publico soportado. Administrador, Rector, Coordinador y Psicologa requieren alta interna autorizada; Estudiante y familia no son roles tradicionales de `usuario`. No existen endpoints de invitacion implementados: faltan vinculos y permisos institucionales validados para perfiles de Coordinacion/Psicologia.
- `npm.cmd test`: 147 aprobadas, 0 fallidas y 0 omitidas. Son pruebas unitarias con mocks y verificaciones estaticas; no validan MySQL ni el correo real.
- Integracion/esquema 3308 no verificados. No se ejecuto migracion, bootstrap, recuperacion ni prueba de integracion. No se leyeron ni cambiaron `.env` o `.env.test`.
