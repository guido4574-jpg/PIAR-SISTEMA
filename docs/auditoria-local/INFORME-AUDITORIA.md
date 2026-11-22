# Informe de auditoría local

## Alcance y límites

Auditoría estática y pruebas unitarias en la rama `security/fase-1-hardening`. No se ejecutaron solicitudes HTTP ni consultas a MySQL en esta sesión: las variables `DB_HOST`, `DB_PORT`, `DB_NAME` y `DB_PASSWORD` no están disponibles en el proceso de Codex y no hay listener local en el puerto publicado `3307`. No se inició el backend. No se modificó ninguna base de datos.

## Autenticación y sesiones

- El backend valida la sesión antes de las rutas institucionales y aplica `authorizationStatus` antes de los controladores.
- Las contraseñas nuevas usan bcrypt con factor 12. Los tokens de sesión son aleatorios y se almacena su SHA-256; las sesiones se comprueban por expiración, revocación y estado activo del usuario.
- La cookie de sesión usa `HttpOnly` y `SameSite=Lax`; `Secure` se añade cuando `NODE_ENV=production`.
- El registro público fija el rol Docente y deja la cuenta pendiente.
- `/api/data` y `/api/reset` están retiradas y responden 410.

Estas son conclusiones de revisión estática, no pruebas HTTP ejecutadas en esta sesión.

## Alcance Docente y discrepancia funcional

El código filtra estudiantes, PIAR, diagnósticos, seguimientos y observaciones por perfil docente activo y asignaciones. La lista y los detalles de PIAR y estudiantes también verifican asignación antes de devolver datos.

La matriz implementada no autoriza a Docente a crear ni actualizar PIAR (`POST /api/piar`, `PUT /api/piar/:id`). El requisito funcional descrito en la solicitud maestra sí menciona creación y modificación de contenido PIAR asignado para Docente. Esa diferencia requiere decisión funcional. No se amplió la autorización. Como el frontend mostraba «Nuevo PIAR / PR» aunque el backend lo deniega, ahora lo oculta a Docente, Estudiante y usuarios sin rol reconocido.

## XSS e interfaz

La revisión estática encontró renderizado con `innerHTML`; los valores dinámicos revisados usan `escapeHTML`, `textContent` o nodos de texto, y los identificadores de acciones se convierten a número. Las pruebas unitarias comprueban el escape HTML. No se hizo QA visual ni prueba XSS en navegador: la aplicación carga bibliotecas externas y la instancia del backend aislado no estaba disponible.

## Base de datos y HTTP

La configuración de backend acepta `DB_HOST`, `DB_PORT` y `DB_NAME`, con valores por defecto locales `127.0.0.1:3306` y `piar`. No se creó `.env` ni se escribieron variables de conexión en archivos. La prueba de conexión independiente a `piar_test:3306` dentro de Docker y publicado en `3307` fue reportada por el usuario; no pudo verificarse desde el proceso de Codex y no se considera prueba del pool del backend.

Los resultados HTTP manuales de Coordinador reportados anteriormente se conservan como evidencia proporcionada por el usuario, no como solicitudes ejecutadas por Codex en esta sesión. Las pruebas HTTP con Estudiante y Docente, la verificación de datos y el CRUD integral siguen pendientes.

## Estado

No se hicieron cambios de esquema ni de permisos. No hay evidencia suficiente para declarar el sistema listo para producción. La matriz, los resultados y los pendientes están en los documentos de esta carpeta.

## Addendum de auditoría final — 3 de octubre de 2026

Rama auditada: `security/fase-1-hardening`. El estado al inicio ya contenía cambios locales en `backend/auth.js`, `backend/server.js`, `public/index.html`, `public/js/api.js`, `public/js/app.js`, `public/js/config.js`, `public/js/data.js`, además de archivos nuevos bajo `backend/`, `public/js/`, `tests/`, `docs/`, y `piar-test-cookies.txt`. No se descartó ni limpió ninguno. No se creó commit ni se hizo push.

Se leyeron los tres informes de esta carpeta, `docs/seguridad/INFORME_FASE_1_SEGURIDAD.md`, el código de autenticación, autorización, servidor, conexión MySQL, frontend, pruebas y migraciones SQL. La inspección del esquema fue estática; no se ejecutó SQL ni se imprimió el contenido del archivo de cookies.

Se encontró un defecto en el procesamiento de cookies: `decodeURIComponent` podía lanzar una excepción ante un valor malformado. Ahora ese valor se ignora y se interpreta como sesión ausente. Se añadió la regresión `tests/auth-session.test.js`. La suite ejecutada con `node --test tests/authorization.test.js tests/security-output.test.js tests/ui-permissions.test.js tests/auth-session.test.js` terminó con 8 aprobadas, 0 fallidas, 0 omitidas y 0 canceladas.

Docker no está disponible como comando en este entorno; las variables `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y `PORT` no estaban disponibles para este proceso y no había listener observado en 3307/8081. Por ello no se pudo verificar `piar_test`, privilegios, tablas, datos, pool real, ni ejecutar pruebas HTTP/SQL o E2E. No se inició el backend. Estas pruebas quedan bloqueadas, no aprobadas.

La revisión estática verificó consultas SQL parametrizadas en las rutas revisadas, validación de correspondencia entre diagnóstico, estudiante y PIAR, comprobación de asignación docente en rutas revisadas, denegación institucional a Estudiante, y denegación de modificación/eliminación de observaciones y seguimientos. El HTML dinámico observado escapa los valores; no se hizo fuzzing ni QA en navegador. No se afirma cobertura dinámica de estos controles.

Persisten la decisión institucional sobre creación/modificación del PIAR por Docente y la verificación dinámica de roles y alcance con una instancia local y datos sintéticos. El registro público requiere aprobación antes de activar cuentas, según la implementación revisada. No se accedió a Railway ni a producción; no hubo cambios de esquema, despliegues, commits o pushes.

## Revalidación de integración — 3 de octubre de 2026

Desde este proceso de Codex, `docker.exe` no está en PATH ni en su ruta habitual; `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` y `PORT` no están configuradas. Node.js `v22.20.0` y `mysql2` sí están disponibles. Una comprobación TCP encontró 3307 abierto y 8081 cerrado. La comprobación MySQL de solo lectura usó explícitamente `127.0.0.1:3307`, usuario/base `piar_test`, sin contraseña suministrada, e intentó `SELECT DATABASE(), @@port, @@hostname` y leer los nombres de tablas desde `information_schema`; MySQL devolvió `ER_ACCESS_DENIED_ERROR`. Por ello no se obtuvo identidad del servidor ni esquema, y no se inició el backend ni se escribió en la base.

Suite integral pertinente ejecutada con `node --test tests/*.test.js`: 8 aprobadas, 0 fallidas, 0 omitidas, 0 canceladas. No existen pruebas de integración HTTP/SQL en `tests/`; no se duplicaron ni se añadieron pruebas incapaces de autenticarse contra la DB.

## Preparación de integración HTTP/SQL — 3 de octubre de 2026

Se añadió `tests/integration.test.js`, un test end-to-end reproducible que lanza el backend local en 8081 y usa `mysql2`/`bcryptjs` existentes. Antes de la primera escritura exige `DB_HOST=127.0.0.1`, `DB_PORT=3307`, `DB_NAME=piar_test`, `DB_USER=piar_test`, `DB_PASSWORD` presente y `PORT=8081`; conecta además de forma literal al loopback y la base de pruebas, y verifica `DATABASE()=piar_test`, puerto interno 3306 y presencia de las tablas necesarias. No ejecuta migraciones. Rechaza el puerto 8081 ocupado.

El arnés crea exclusivamente cuentas con roles sintéticos, dos perfiles Docente, dos estudiantes y dos PIAR; sus identificadores de documento/correo/título incluyen un marcador aleatorio. Registra los IDs de cada inserción y en `finally` detiene el backend y elimina solo esos IDs y sus sesiones/asignaciones exactas en orden de clave foránea. No usa `TRUNCATE`, `DROP` ni limpieza por prefijo. Valida HTTP y SQL para autenticación/cookies, denegaciones Estudiante, roles institucionales, alcance docente, denegación docente a crear/modificar PIAR, cierre/edición de PIAR para Coordinador, alta/duplicado/retiro de asignaciones, relación diagnóstico-estudiante-PIAR y CRUD de diagnóstico, observaciones/seguimientos inmutables, aprobación de registro, operaciones inexistentes/sin cambios, JSON inválido y endpoints retirados.

No se ejecutó `tests/integration.test.js` en este proceso: no dispone de las variables requeridas y MySQL rechazó el login sin `DB_PASSWORD`. No se hicieron escrituras de integración ni se declara aprobada ninguna prueba HTTP/SQL. Para ejecutarlo desde PowerShell integrado de VS Code:

```powershell
if ($env:DB_HOST -ne '127.0.0.1' -or $env:DB_PORT -ne '3307' -or $env:DB_NAME -ne 'piar_test' -or $env:DB_USER -ne 'piar_test' -or $env:PORT -ne '8081' -or -not $env:DB_PASSWORD) { throw 'Entorno de prueba incompleto o distinto del esperado' }
node --test tests/integration.test.js
```

Comparte la salida TAP completa (resumen de tests/pass/fail/skipped y cualquier error de preflight/limpieza); no compartas valores de variables, contraseñas ni cookies. En esta ejecución sí se ejecutaron las ocho pruebas unitarias y el chequeo de sintaxis del nuevo archivo; ambas validaciones pasaron.

El preflight del arnés también comprueba `CURRENT_USER()=piar_test`, que MySQL no esté en modo `read_only` y que `SHOW GRANTS` exponga SELECT, INSERT, UPDATE y DELETE antes de crear fixtures; si no puede verificar esos permisos, no escribe.

## Hallazgo y corrección de rol — 3 de octubre de 2026

La lista de roles usada por `makeFixture` incluía `Estudiante`. La migración `database/migrations/001_mvp_core.sql` declara `usuario.rol` como ENUM con estos cinco valores: `Docente`, `Psicóloga`, `Coordinador`, `Administrador`, `Rector`. La política de backend contempla además `Estudiante`, pero la migración no lo admite. Como la inserción se hace rol por rol en ese orden y el error ocurrió en esta fase de fixtures, el valor no admitido es `Estudiante`; no se amplió el ENUM ni se cambiaron permisos.

Se retiró `Estudiante` del fixture SQL y se añadió un preflight read-only que consulta `information_schema.COLUMNS` y exige que el ENUM real de `piar_test` coincida con los cinco roles de la migración antes de insertar. El test HTTP Estudiante queda explícitamente omitido en integración porque el esquema no puede representarlo; su denegación institucional continúa cubierta por `tests/authorization.test.js`.

Este proceso no tiene DB_PASSWORD ni variables de conexión. La consulta directa de esquema no pudo autenticarse, así que no afirmo haber leído la columna real del contenedor en esta sesión. El arnés la verificará en el terminal VS Code configurado. `makeFixture` deja la referencia del fixture asignada antes de la primera inserción, y el `finally` limpia IDs exactos aun cuando la creación falle parcialmente. No se consultó ni eliminó ningún registro de `piar_test` desde este proceso; tampoco se puede certificar aquí si la ejecución anterior alcanzó su limpieza.

Validaciones locales: `node --check tests/integration.test.js` pasó; la suite unitaria pasó 8/8; `git diff --check` pasó. No se ejecutó la integración hasta poder verificar el esquema de destino; las pruebas HTTP/SQL siguen pendientes.

Ajuste del fixture tras revisar la solicitud: la cuenta sintética que ocupaba el slot inválido `Estudiante` fue reemplazada por una tercera cuenta `Docente`, valor admitido por el ENUM. Esa cuenta no tiene perfil vinculado y se usa para comprobar que no pueda crear observaciones sin asignación/perfil. No se crea una sesión de rol Estudiante en SQL; esa cobertura queda en pruebas unitarias y el subtest HTTP se informa como omitido.

## Fallo PIAR Coordinador — resultado comunicado el 3 de octubre de 2026

La aserción que falló fue `assert.equal(unchangedPiar.payload.unchanged, true)` en la segunda solicitud `PUT /api/piar/:id`, que repite el mismo `objetivo_general`. La respuesta conserva HTTP 200, pero reportó `unchanged: false`.

Causa raíz comprobada en el código/configuración local: `backend/db.js` no excluye la capacidad `FOUND_ROWS`, y la configuración predeterminada instalada de mysql2 la incluye. En consecuencia, `affectedRows` puede ser 1 cuando la fila coincide aunque el `UPDATE` no cambie columnas. `backend/server.js` clasificaba ese conteo como cambio real. El paquete mysql2 también proporciona `changedRows`, que distingue filas realmente cambiadas. Se corrigió `mutationOutcome` para clasificar por `changedRows` y consultar existencia cuando es cero; no se modificaron roles, rutas ni permisos.

Se amplió la prueba unitaria de `classifyMutation` para cubrir `affectedRows=1, changedRows=0` como `unchanged`. La integración no se volvió a ejecutar desde Codex por falta de variables/credenciales locales. La ejecución comunicada reportó 6 aprobadas, 2 fallidas en el resumen y 1 omitida; existe una aserción subtest fallida conocida. En Node test, el fallo del subtest también marca fallido el test padre contenedor, por lo que ambas entradas de fallo pueden corresponder a una sola causa; no se recibió la salida TAP para confirmarlo.

La prueba usa `try/finally` y guarda los IDs sintéticos antes de terminar `makeFixture`; no se modificó su limpieza. La revisión del flujo confirma que una excepción en un subtest llega al finally, que detiene el backend y limpia esos IDs. El proceso de Codex no tiene acceso a la base ni a la contraseña, así que no se verificó el estado residual real después de la ejecución del usuario y no se hizo limpieza manual.

## Validación posterior a la corrección — 3 de octubre de 2026

Ejecutados: `node --check tests/integration.test.js` (código 0), `node --test tests/authorization.test.js tests/security-output.test.js tests/ui-permissions.test.js tests/auth-session.test.js` (8 pass, 0 fail, 0 skipped) y `git diff --check` (código 0; solo avisos de conversión LF/CRLF en archivos locales previos). La integración no se repitió y no se presenta como aprobada: este proceso no dispone de variables/credenciales para comprobar destino y limpieza.

## Cierre de integración local reportado por VS Code — 3 de octubre de 2026

La usuaria informó que `node --test tests/integration.test.js` terminó en su terminal integrada de VS Code con **8 aprobadas, 0 fallidas y 1 omitida**, en aproximadamente 4.93 segundos. Según el resultado comunicado, pasaron los escenarios de autenticación, permisos, alcance docente, PIAR, diagnósticos, observaciones, seguimientos, registro y validaciones HTTP. Este resultado es evidencia reportada por la usuaria; no se volvió a ejecutar integración desde este proceso.

La prueba omitida es Estudiante HTTP porque el ENUM vigente de `usuario.rol` no representa ese rol. No se cambió el esquema ni se contó como aprobada. La prueba unitaria sigue cubriendo la denegación de Estudiante. `mutationOutcome` ahora usa `changedRows` para distinguir una actualización real de un UPDATE sin cambios; la ejecución reportada posterior confirma que el escenario de edición/no-op de PIAR pasó.

La limpieza de fixtures está implementada en `finally` y se limita a los IDs sintéticos capturados por la prueba. No hay evidencia disponible en este proceso para consultar la base después de la ejecución comunicada; por tanto, el estado de residuos no se declara verificado.

En esta sesión, `node --check tests/integration.test.js` pasó. `node --test tests/*.test.js` dio 8 aprobadas y 1 fallida: la integración abortó en preflight porque `DB_HOST` no está configurada en el proceso de Codex; no alcanzó conexión ni escrituras. La integración que se reporta arriba como exitosa es la del terminal VS Code de la usuaria, no la ejecución local de Codex.

Siguen pendientes la prueba HTTP de Estudiante por limitación del ENUM y la decisión funcional sobre permitir a Docente crear o modificar PIAR. Mientras se resuelve, Docente permanece sin esos permisos. También sigue pendiente verificar directamente el estado final de limpieza en `piar_test`.

## Cierre de integración local reportado por VS Code — 3 de octubre de 2026

La usuaria informó que node --test tests/integration.test.js terminó en su terminal integrada de VS Code con 8 aprobadas, 0 fallidas y 1 omitida, en aproximadamente 4.93 segundos. Según el resultado comunicado, pasaron autenticación, permisos, alcance docente, PIAR, diagnósticos, observaciones, seguimientos, registro y validaciones HTTP. Es evidencia reportada por la usuaria; esta integración no se volvió a ejecutar desde Codex.

Estudiante HTTP permanece omitida porque el ENUM vigente de usuario.rol no representa ese rol. No se cambió el esquema ni se contó como aprobada. La prueba unitaria sigue cubriendo la denegación de Estudiante. mutationOutcome ahora usa changedRows para distinguir un UPDATE real de uno sin cambios; la ejecución comunicada confirma que el escenario de PIAR pasó.

El finally de la prueba limita la limpieza a los IDs sintéticos capturados. No hay evidencia disponible para consultar la base después de la ejecución reportada; el estado de residuos no se declara verificado.

En esta sesión, node --check tests/integration.test.js pasó. node --test tests/*.test.js dio 8 aprobadas y 1 fallida: la integración abortó en preflight porque DB_HOST no está configurada en el proceso de Codex; no alcanzó conexión ni escrituras. La integración exitosa arriba es la reportada desde VS Code.

Siguen pendientes la prueba HTTP de Estudiante, la decisión funcional sobre permitir a Docente crear o modificar PIAR y la verificación directa del estado final de limpieza en piar_test.

## Verificación de cierre — 4 de octubre de 2026

El estado inicial se confirmó en la rama `security/fase-1-hardening`. Se conservaron los cambios locales existentes. No se encontró `AGENTS.md` ni una guía oficial de esta evidencia SENA en el repositorio. `package.json` declara Node.js con `mysql2` y `bcryptjs`, sin script de pruebas ni script de lint.

En esta sesión, la suite explícita `node --test tests/authorization.test.js tests/security-output.test.js tests/ui-permissions.test.js tests/auth-session.test.js` pasó con 8 aprobadas, 0 fallidas y 0 omitidas (1,596 s en la salida TAP). El chequeo sintáctico `node --check` para los cuatro archivos backend y los cinco archivos de pruebas listados en `evidencias-pruebas-20261004.txt` completó correctamente. `git diff --check` pasó, con avisos de conversión LF/CRLF para archivos locales previos.

La suite `node --test tests/*.test.js` produjo 8 aprobadas y 1 fallida (1,272 s según TAP). El test de integración se detuvo en preflight porque `DB_HOST` no estaba configurada. La revisión de presencia confirmó que faltan las variables de conexión requeridas; el preflight impidió conectar, iniciar el backend o escribir datos. Esto no es un fallo funcional de PIAR. No se ejecutó limpieza de base y no se certificó el estado residual de `piar_test`.

El resultado de integración de 8 aprobadas, 0 fallidas y 1 omitida en ~4,93 s sigue siendo el comunicado desde VS Code en fecha anterior; no se repitió desde este proceso. La omisión continúa siendo la prueba HTTP de Estudiante, no aprobada. La migración consultada no incluye Estudiante en el ENUM de `usuario.rol`; no se cambió el esquema. El código conserva la denegación Docente para crear y modificar PIAR; tampoco se cambió la política sin decisión institucional.

Se añadieron una lista de chequeo con estados de cierre controlados al informe HTML, una matriz de trazabilidad permiso/código/prueba/estado, el reporte de cierre técnico y salidas TAP completas de esta sesión. Véase `REPORTE-CIERRE-TECNICO.md` y `suite-unitaria-20261004.log` / `suite-completa-20261004.log`. No hubo migraciones, commits, push ni despliegues.

## Revalidación adicional — 4 de octubre de 2026

La suite unitaria explícita se volvió a ejecutar y pasó 8/8 (0 fallidas, 0 omitidas, 0 canceladas; 610.497 ms). `node --check` de archivos backend, cliente y pruebas completó correctamente; `git diff --check` pasó con avisos de conversión LF/CRLF. Las seis variables requeridas (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `PORT`) estaban ausentes y los puertos locales 3307 y 8081 no tenían listener. No se inició integración, backend ni conexión MySQL. No se verificaron residuos en `piar_test`.
