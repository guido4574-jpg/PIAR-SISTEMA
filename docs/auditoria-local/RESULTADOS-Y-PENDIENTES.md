# Resultados de pruebas y pendientes

## Ejecutadas por Codex en esta sesión

Comando:

```powershell
node --test tests/authorization.test.js tests/security-output.test.js
```

Resultado previo al ajuste de interfaz: 6 aprobadas, 0 fallidas. Después del ajuste se ejecutaron las pruebas existentes junto con `tests/ui-permissions.test.js`:

```powershell
node --test tests/authorization.test.js tests/security-output.test.js tests/ui-permissions.test.js
```

Resultado final: 7 aprobadas, 0 fallidas. La primera ejecución de la prueba nueva falló por una asignación incorrecta del rol en el arnés `vm`; se corrigió el arnés y la suite completa volvió a pasar. No fue un fallo de la aplicación.

## Evidencia HTTP proporcionada por el usuario

Resultados de Coordinador reportados anteriormente: `GET /api/auth/me` sin cookie 401; login 200; `/api/auth/me` con cookie 200 y rol Coordinador; `/api/estudiantes` con cookie 200 y lista vacía; `/api/estudiantes` sin cookie 401. No se volvieron a ejecutar en esta sesión.

## Estado del entorno local

| Comprobación | Resultado en esta sesión |
|---|---|
| `DB_HOST` equivale a loopback | No disponible en el proceso |
| `DB_PORT=3307` | No disponible en el proceso |
| `DB_NAME=piar_test` | No disponible en el proceso |
| Puerto Windows 3307 escucha | No |
| Puerto backend 8081 libre | Sí |
| Preflight con pool efectivo del backend | Bloqueado; no ejecutado |
| Backend en puerto 8081 | No iniciado |
| Consulta de salud HTTP | No ejecutada |
| Contenido real de `piar_test` | No inspeccionado |

La prueba de conexión separada a `piar_test` fue reportada por el usuario, pero no identifica la configuración heredada por este proceso de Codex.

## Pendientes

- Iniciar/confirmar la instancia local MySQL Docker publicada en `127.0.0.1:3307` y volver a ejecutar Codex desde el entorno que tenga las variables de prueba. No compartir `DB_PASSWORD`.
- Validar el pool real con `SELECT DATABASE(), @@port, @@hostname` y solo después iniciar backend en 8081.
- Inspeccionar tablas y conteos sin PII; detenerse antes de cualquier escritura si no se puede probar que los datos existentes son sintéticos.
- Ejecutar pruebas HTTP de Estudiante, alcance docente y roles; después CRUD sintético solo con aislamiento confirmado y plan de limpieza seguro.
- Ejecutar QA visual y XSS en navegador local.
- Resolver la diferencia de permisos de creación/actualización de PIAR para Docente antes de modificar la matriz del backend.
- La solicitud maestra adjunta termina truncada dentro de la sección de sesiones; confirmar el alcance faltante si contenía requisitos adicionales.

## Cierre de ejecución — 3 de octubre de 2026

Suite final ejecutada:

```powershell
node --test tests/authorization.test.js tests/security-output.test.js tests/ui-permissions.test.js tests/auth-session.test.js
```

Resultado: 8 aprobadas, 0 fallidas, 0 omitidas, 0 canceladas. La prueba `auth-session.test.js` cubre el nuevo manejo seguro de cookie malformada. Este resultado reemplaza el recuento anterior de 7 pruebas para la suite ampliada.

Integración: 0 ejecutadas, bloqueadas por ausencia del comando Docker y de las variables de conexión de prueba en el proceso actual. No se inició backend, no se abrió conexión MySQL, no se hicieron escrituras y no se tocó producción. Los puertos 3307/8081 no mostraron listeners durante la inspección. El contenido y los conteos de `piar_test` permanecen sin verificar.

Corrección: `backend/auth.js` ignora un valor de cookie que no puede decodificarse; `tests/auth-session.test.js` verifica que el token inválido no llegue a consultar el pool y que la sesión resulte ausente. Los otros cambios locales que ya existían se conservaron. No se hicieron migraciones, commits, pushes ni despliegues.

Pendiente imprescindible para completar integración: disponer del runtime Docker local con `piar-mysql-test` activo y ejecutar el proceso con `DB_HOST=127.0.0.1`, `DB_PORT=3307`, `DB_NAME=piar_test`, `DB_USER=piar_test` y `PORT=8081`, sin revelar `DB_PASSWORD`. Antes de cualquier escritura, verificar identidad del servidor/base y que los registros usados sean sintéticos. Luego ejecutar pruebas HTTP/SQL con identificadores únicos y limpieza limitada a esos identificadores. La ambigüedad institucional del permiso Docente sobre contenido PIAR requiere decisión antes de ampliar acceso.

Aclaración: el pendiente heredado que indicaba que el prompt adjunto estaba truncado no corresponde al archivo revisado en esta sesión; el contenido recibido incluyó las fases hasta la entrega final. No requiere intervención del usuario.

## Revalidación del entorno en Codex — 3 de octubre de 2026

- `docker.exe`: no está disponible en PATH ni en la ubicación estándar comprobada.
- Variables `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `PORT`: ausentes (se comprobó presencia; nunca se imprimieron valores).
- Node.js: `v22.20.0`; paquete `mysql2`: presente.
- TCP `127.0.0.1:3307`: abierto. TCP `127.0.0.1:8081`: cerrado.
- Comprobación MySQL read-only explícita con host `127.0.0.1`, puerto `3307`, usuario y base `piar_test`, sin contraseña: denegada por `ER_ACCESS_DENIED_ERROR`. No se consultó ninguna otra base.
- No hay tests de integración HTTP/SQL en `tests/`; al no poder autenticarse, no se añadieron pruebas que no puedan ejecutarse de forma verificada.
- Suite unitaria completa `node --test tests/*.test.js`: 8 pass, 0 fail, 0 skipped, 0 cancelled.

Para heredar configuración sin poner secretos en archivos ni chat, el proceso de Codex tendría que iniciarse desde el mismo terminal integrado de VS Code después de definir allí las variables de prueba, o ejecutar las pruebas desde ese terminal. El valor de `DB_PASSWORD` debe permanecer en ese entorno. En esta sesión no hay mecanismo autorizado para leer el terminal integrado y la skill de control de Windows prohíbe automatizar aplicaciones de terminal. La integración sigue bloqueada y no se considera aprobada.

## Harness HTTP/SQL listo para ejecución local — 3 de octubre de 2026

Archivo nuevo: `tests/integration.test.js`. Ejecución exacta desde la terminal integrada de VS Code que hereda las variables:

```powershell
if ($env:DB_HOST -ne '127.0.0.1' -or $env:DB_PORT -ne '3307' -or $env:DB_NAME -ne 'piar_test' -or $env:DB_USER -ne 'piar_test' -or $env:PORT -ne '8081' -or -not $env:DB_PASSWORD) { throw 'Entorno de prueba incompleto o distinto del esperado' }
node --test tests/integration.test.js
```

El arnés se niega a escribir si las variables no coinciden, falta contraseña, el puerto 8081 está ocupado, `DATABASE()` no es `piar_test`, el puerto MySQL interno no es 3306 o faltan tablas base. Si el preflight pasa, inserta fixtures sintéticos con IDs nuevos, inicia el backend con el entorno heredado, ejecuta pruebas HTTP y consultas de verificación parametrizadas, detiene el backend y limpia por IDs exactos capturados, en `finally`. No aplica esquemas ni toca otras bases.

**Resultado en esta sesión:** el archivo nuevo pasó `node --check tests/integration.test.js`. La suite existente se ejecutó con `node --test tests/authorization.test.js tests/security-output.test.js tests/ui-permissions.test.js tests/auth-session.test.js`: 8 aprobadas, 0 fallidas, 0 omitidas. La integración no se ejecutó porque el proceso de Codex carece de las variables y la autenticación de MySQL falló sin contraseña. HTTP/SQL siguen bloqueadas, no aprobadas. Comparte la salida TAP completa del comando de integración (incluido el resumen) y cualquier error de preflight o limpieza; no compartas secretos ni cookies.

El preflight verifica la cuenta autenticada `piar_test`, `@@read_only=0` y privilegios SELECT/INSERT/UPDATE/DELETE antes de cualquier fixture. Si estos requisitos no se cumplen, la prueba se detiene sin escribir.

## Fallo de rol en makeFixture y estado de limpieza — 3 de octubre de 2026

Causa: el fixture intentaba insertar `Estudiante`, valor ausente del ENUM definido por `database/migrations/001_mvp_core.sql`; los otros valores válidos declarados por esa migración son `Docente`, `Psicóloga`, `Coordinador`, `Administrador` y `Rector`. La lista de `makeFixture` ahora crea solo esos roles. No se cambió la tabla ni la política de autorización. El preflight consulta y valida el ENUM vivo antes de permitir cualquier escritura; la cobertura HTTP Estudiante se marca omitida, dado que el rol no es representable con el esquema migrado. La prueba unitaria existente sigue comprobando su 403.

La creación de fixture está dentro de `try/finally`, conserva IDs inmediatamente después de cada INSERT y llama a limpieza por IDs exactos si una inserción posterior falla. Este proceso no tiene DB_PASSWORD, no pudo leer el esquema vivo ni comprobar registros residuales de la ejecución informada. No se hizo limpieza externa ni se ejecutó la integración. Por lo tanto, la ausencia de residuos de aquella ejecución no puede certificarse desde Codex; si su proceso no fue interrumpido y su `finally` terminó sin error, el mecanismo del test debió limpiar los registros parciales. La integración permanece pendiente.

En esta sesión sí se ejecutaron `node --check tests/integration.test.js` (pasó), `node --test tests/authorization.test.js tests/security-output.test.js tests/ui-permissions.test.js tests/auth-session.test.js` (8 aprobadas, 0 fallidas) y `git diff --check` (pasó).

Valor válido usado en sustitución: `Docente`, con cuenta sintética sin perfil vinculado. Su intento de crear una observación sobre el PIAR de otro perfil debe responder 403. Se preservan dos cuentas Docente con perfiles (asignado y no asignado) para las pruebas de alcance.

## Diagnóstico del fallo PIAR y corrección — 3 de octubre de 2026

Aserción fallida: línea 396, `unchangedPiar.payload.unchanged === true`, para un segundo PUT idéntico del Coordinador sobre el PIAR sintético. La llamada recibió HTTP 200 pero `unchanged` llegó `false`. El primer PUT y las operaciones previas de creación/asignación no son la aserción reportada.

Causa: el pool usa la opción predeterminada de mysql2 que incluye `FOUND_ROWS`; por ello `affectedRows` puede valer 1 en un UPDATE sin cambios. La ruta de PIAR clasificaba `affectedRows > 0` como modificación. Corrección mínima: `mutationOutcome` usa `changedRows`; con cero consulta si la fila existe y la clasifica como `unchanged` o `not_found`. La regresión unitaria ahora distingue `{affectedRows:1, changedRows:0}` de `{affectedRows:1, changedRows:1}`. No cambié las expectativas funcionales, la matriz, el ENUM ni permisos.

Resultado comunicado por la ejecución en VS Code: 6 aprobadas, 2 fallidas en el resumen, 1 omitida. Una falla subtest concreta en la aserción de no-op; la estructura Node test también reporta al padre contenedor como fallido. Corrección local verificada por suite unitaria; integración aún pendiente de repetición.

Limpieza: inspeccionado `finally`; limpia por IDs sintéticos guardados y termina el backend. No se pudo consultar la base en este proceso (variables/contraseña ausentes), por tanto no se certifican residuos ni se hizo operación SQL de limpieza manual.

**Validación posterior del código corregido:** `node --check tests/integration.test.js` pasó; suite unitaria: 8 pass, 0 fail, 0 skipped; `git diff --check` pasó. La integración HTTP/SQL no se volvió a ejecutar por falta de credenciales y configuración en este proceso. Pendiente: repetir `node --test tests/integration.test.js` desde el terminal configurado de VS Code y compartir salida TAP completa. No se certifica el estado de residuos de la ejecución anterior desde Codex.

## Resultado posterior de integración comunicado desde VS Code — 3 de octubre de 2026

La usuaria ejecutó `node --test tests/integration.test.js` en la terminal integrada de VS Code y reportó el resumen exacto: **8 aprobadas, 0 fallidas, 1 omitida**, duración aproximada de 4.93 s. Reporta aprobados autenticación, permisos, alcance docente, PIAR, diagnósticos, observaciones, seguimientos, registro y validaciones HTTP. La prueba HTTP de Estudiante permanece omitida porque el ENUM vigente de `usuario.rol` no contempla ese rol. No se presenta como aprobada ni se alteró el esquema.

El fallo previo de `assert.equal(unchangedPiar.payload.unchanged, true)` se corrigió: `mutationOutcome` se basa en `changedRows` y clasifica como `unchanged` el UPDATE que coincide con una fila pero no modifica columnas. El escenario pasó en la integración reportada. La autorización de Coordinador se conserva y Docente continúa sin permiso para crear o modificar PIAR mientras la decisión institucional siga pendiente.

La prueba conserva `finally` y elimina exclusivamente IDs sintéticos registrados por el arnés. El proceso de Codex no pudo inspeccionar `piar_test` después de la ejecución; el residuo real no está verificado y no se hizo limpieza manual.

Validaciones de este proceso: `node --check tests/integration.test.js` pasó. `node --test tests/*.test.js` produjo 8 pass y 1 fail: el test de integración se detuvo inmediatamente en preflight con `DB_HOST` ausente; no conectó a MySQL ni hizo escrituras. Esto no contradice el resultado informado desde VS Code.

Pendientes: prueba HTTP de Estudiante (requiere una representación compatible del rol aprobada institucionalmente o cobertura alternativa; no cambiar ENUM sin decisión), decisión de permisos de Docente sobre creación/modificación PIAR y verificación directa del estado final de limpieza sintética.

## Resultado posterior de integración comunicado desde VS Code — 3 de octubre de 2026

La usuaria ejecutó node --test tests/integration.test.js desde VS Code y reportó 8 aprobadas, 0 fallidas y 1 omitida, duración aproximada 4.93 s. Reporta aprobados autenticación, permisos, alcance docente, PIAR, diagnósticos, observaciones, seguimientos, registro y validaciones HTTP. Estudiante HTTP permanece omitida porque el ENUM vigente de usuario.rol no contempla ese rol; no se alteró el esquema ni se declara esa prueba aprobada.

El fallo previo de assert.equal(unchangedPiar.payload.unchanged, true) se corrigió: mutationOutcome usa changedRows y clasifica unchanged el UPDATE que coincide con una fila pero no modifica columnas. El escenario pasó en la integración reportada. Docente continúa sin permiso para crear o modificar PIAR mientras la decisión institucional siga pendiente.

El finally de la prueba limpia únicamente IDs sintéticos registrados por el arnés. Codex no pudo inspeccionar piar_test después de la ejecución; los residuos reales no están verificados y no se hizo limpieza manual.

Validaciones de este proceso: node --check tests/integration.test.js pasó. node --test tests/*.test.js produjo 8 pass y 1 fail: integración detenida inmediatamente en preflight por DB_HOST ausente; no conectó a MySQL ni hizo escrituras. Esto no contradice el resultado reportado desde VS Code.

Pendientes: prueba HTTP de Estudiante, decisión institucional sobre permisos de Docente para creación/modificación PIAR y verificación directa del estado final de limpieza sintética.

## Verificación de cierre por Codex — 4 de octubre de 2026

### Pruebas ejecutadas en esta sesión

| Comando | Resultado |
|---|---|
| `node --test tests/authorization.test.js tests/security-output.test.js tests/ui-permissions.test.js tests/auth-session.test.js` | 8 aprobadas, 0 fallidas, 0 omitidas, 0 canceladas; 1,596 s según TAP |
| `node --test tests/*.test.js` | 8 aprobadas, 1 fallida; el test de integración se detuvo durante preflight porque `DB_HOST` no estaba configurada; 1,272 s según TAP |
| `node --check` para los cuatro archivos backend y cinco archivos JS de prueba listados en `evidencias-pruebas-20261004.txt` | Todos completaron con código 0 |
| `git diff --check` | Código 0, sin errores de whitespace; avisos LF/CRLF en archivos locales previos |

Salidas TAP completas: `suite-unitaria-20261004.log` y `suite-completa-20261004.log`. El resumen de procedencia y limitaciones está en `evidencias-pruebas-20261004.txt`.

La integración del comodín no llegó a conectar a MySQL ni escribió datos: el error de preflight ocurrió antes de iniciar el backend. No se clasifica como fallo funcional del producto. La integración comunicada desde VS Code (8 aprobadas, 0 fallidas, 1 omitida, ~4,93 s) es un resultado informado en una sesión previa y no se repitió ahora.

### Revisión de precondiciones y decisiones

- No están disponibles en este proceso `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` ni `PORT`. No se intentó autenticar ni escribir en ninguna base.
- La migración de referencia contiene cinco roles: Docente, Psicóloga, Coordinador, Administrador y Rector. Estudiante no está incluido en el ENUM; se mantiene omitida la prueba HTTP correspondiente y sin alterar el esquema.
- La autorización actual deniega a Docente `POST /api/piar` y `PUT /api/piar/:id`. Se conserva hasta decisión institucional sobre el requisito en conflicto.
- El arnés limpia únicamente IDs sintéticos registrados en `finally`; no se verificó el estado posterior de `piar_test`. Limpieza no certificada.
- No se encontró guía oficial de la evidencia SENA en los archivos del repositorio. No se inventaron ponderaciones.
- La documentación general `docs/PIAR-DOC-01-REQUERIMIENTOS.md`, `docs/PIAR-DOC-04-SEGURIDAD.md` y `docs/PIAR-DOCUMENTACION-CONSOLIDADA.md` contiene afirmaciones propias de una etapa anterior, que no deben leerse como descripción actual del hardening. Para el estado presente, se consultaron código actual e informes locales de auditoría.

El reporte integrado de cierre está en `REPORTE-CIERRE-TECNICO.md`. No se hicieron migraciones, commits, push, despliegues ni cambios a la política de roles.

## Revalidación local adicional — 4 de octubre de 2026

La suite unitaria explícita se ejecutó de nuevo: `node --test tests/authorization.test.js tests/security-output.test.js tests/ui-permissions.test.js tests/auth-session.test.js`; resultado 8 aprobadas, 0 fallidas, 0 omitidas y 0 canceladas (610.497 ms; código 0). `node --check` completó con código 0 para los archivos backend, JavaScript del cliente y cinco pruebas. `git diff --check` terminó con código 0, con avisos LF/CRLF preexistentes.

La comprobación de presencia encontró ausentes `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` y `PORT`; TCP no mostró listener en `127.0.0.1:3307` ni `127.0.0.1:8081`. No se ejecutó integración, no se inició el backend ni se conectó/escribió en una base. No se verificó la limpieza sintética. La integración comunicada anteriormente desde VS Code sigue siendo evidencia informada, no repetida.

### Diagnóstico concreto de configuración — 4 de octubre de 2026

El TAP disponible de `node --test tests/*.test.js` concluyó 8 pass / 1 fail porque el subtest de integración se detuvo en preflight por ausencia de `DB_HOST`; no llegó a conexión, servidor ni fixtures. En el entorno inspeccionado, las seis variables del harness están ausentes, no hay listeners en 3306/3307/8081, el servicio Windows `MySQL80` está detenido (inicio Manual) y no están disponibles Docker ni el cliente MySQL. README y `backend/db.js` usan como defaults la base genérica `piar` en 3306; integración requiere una instancia distinta en loopback 3307 con base y cuenta `piar_test`. No se inició servicio ni migración porque no se confirmó aislamiento de la instancia existente. No se puede verificar limpieza sin conectarse a la base correcta.

Para desbloquear, provisionar una instancia local dedicada en `127.0.0.1:3307`, base `piar_test`, cuenta restringida a esa base, esquema/tablas compatibles y permisos SELECT/INSERT/UPDATE/DELETE. En la terminal integrada, configurar `DB_HOST=127.0.0.1`, `DB_PORT=3307`, `DB_NAME=piar_test`, `DB_USER=piar_test`, `DB_PASSWORD` desde el gestor local sin mostrarlo y `PORT=8081`; luego ejecutar `node --test tests/integration.test.js`. No reutilizar `MySQL80`/`piar` ni ejecutar migraciones hasta verificar que el destino sea desechable.

### Diagnóstico específico de Estudiante — 4 de octubre de 2026

`tests/integration.test.js:326-328` contiene un `skip` literal e incondicional para «Estudiante HTTP» y el callback es vacío. No es una omisión causada por fixture ausente ni por configuración. El preflight también compara el ENUM vivo con los cinco roles de `001_mvp_core.sql`; la migración define `Docente`, `Psicóloga`, `Coordinador`, `Administrador` y `Rector`, sin `Estudiante`. Quitar el `skip` aprobaría un callback sin aserciones y no valida HTTP. Crear una cuenta Estudiante requiere cambiar el ENUM, pendiente de decisión institucional; no se hizo. La denegación del rol continúa probada unitariamente.

Verificación de esta continuación: `node --test tests/authorization.test.js tests/security-output.test.js tests/ui-permissions.test.js tests/auth-session.test.js` pasó 8/8 (0 fallidas, 0 omitidas; 980.740 ms). `node --check tests/integration.test.js` y `git diff --check` pasaron. El puerto 3307 responde TCP, pero este proceso no tiene las variables requeridas y no hay archivo `.env.test`; el Docker CLI tampoco está disponible. Por eso no se ejecutó integración ni se verificó limpieza SQL. No se leyeron secretos.
## Avance de implementación funcional — 11 de octubre de 2026

Se añadió recuperación de contraseña en `backend/auth.js`, rutas públicas en `backend/server.js`, formulario y enlace de acceso en `public/js/app.js`, métodos API y rutas en `public/js/api.js` y `public/js/config.js`, y la tabla `recuperacion_contrasena` en las migraciones `000_railway_schema.sql` y `001_mvp_core.sql`. El token aleatorio se persiste como SHA-256, vence a los 30 minutos, solo puede consumirse una vez, y al cambiar la contraseña se guarda bcrypt y se revocan las sesiones activas. El envío del enlace requiere `APP_BASE_URL` HTTPS, `PASSWORD_RESET_DELIVERY_URL` HTTPS y `PASSWORD_RESET_DELIVERY_SECRET`; el servicio no está configurado en este entorno y no se exponen tokens en respuestas.

Pruebas ejecutadas: `node --test tests/authorization.test.js tests/auth-session.test.js tests/password-reset.test.js tests/security-output.test.js tests/ui-permissions.test.js` terminó 12/12 aprobadas, 0 fallidas. `node --check` en backend y cliente y `git diff --check` terminaron con código 0. `node --test tests/integration.test.js` fue ejecutado, pero falló en preflight por ausencia de `DB_HOST`; no inició servidor ni escribió datos. Por tanto el ciclo de recuperación no está validado HTTP/MySQL y la nueva migración no se aplicó.

Los bloques siguientes ya tienen código en el estado local: registro público Docente pendiente y aprobación/rechazo por Administrador o Rector; gestión de cuentas limitada por rol; gestión institucional de estudiantes, PIAR, diagnósticos, seguimientos e informes. Las reglas unitarias de rol y UI pasaron en la suite indicada, pero sus flujos persistentes HTTP/MySQL no se pudieron revalidar por el preflight. No se concedieron permisos adicionales a Docente ni se habilitó el rol Estudiante.

Respaldo/restauración segura de MySQL sigue sin implementar. Hace falta definir el destino y retención de respaldos, cifrado y custodia de claves, método de restauración con aislamiento/validación, y permisos operativos del Administrador; no se ejecutó ningún respaldo/restauración ni se conectó a una base.

### Validación dirigida de recuperación — 11 de octubre de 2026

La inspección encontró las rutas de recuperación ubicadas después de la autenticación obligatoria. Se movieron a la sección pública de autenticación para que funcionen en una sesión cerrada. También se detectó exposición potencial del token en `Referer` al usar query string; el enlace ahora usa el fragmento `#reset=...`, que el navegador no envía al servidor, y los archivos estáticos incluyen `Referrer-Policy: no-referrer`. El consumo del token ahora se reclama con `UPDATE` condicional por estado/expiración antes de actualizar contraseña, evitando que dos solicitudes concurrentes completen el cambio con el mismo token. Las operaciones se ejecutan sobre la conexión transaccional y hacen commit conjunto o rollback.

`node --test tests/password-reset.test.js`: 5 aprobadas, 0 fallidas. Suite unitaria completa (excluye el arnés de integración): `node --test tests/authorization.test.js tests/auth-session.test.js tests/password-reset.test.js tests/security-output.test.js tests/ui-permissions.test.js`: 13 aprobadas, 0 fallidas. Sintaxis de pruebas de integración/backend/cliente y `git diff --check`: aprobados. Se añadió al arnés HTTP/MySQL un caso que crea token hash sintético en `piar_test`, ejecuta la ruta pública de confirmación, comprueba expiración/consumo/hash/revocación/reutilización/login y limpia por IDs de los usuarios sintéticos. `node --test tests/integration.test.js` sigue detenido en preflight por ausencia de `DB_HOST`; no conecta ni escribe. No se aplicaron migraciones. La tabla `recuperacion_contrasena`, sus claves/columnas y `usuario.password_hash` existen en las dos migraciones y coinciden con las consultas del backend.

Para integración desde PowerShell de VS Code, provisionar primero una instancia aislada en `127.0.0.1:3307` con base y usuario `piar_test`, y esquema ya migrado. Luego:

```powershell
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = '3307'
$env:DB_NAME = 'piar_test'
$env:DB_USER = 'piar_test'
$env:PORT = '8081'
$env:DB_PASSWORD = [System.Net.NetworkCredential]::new('', (Read-Host 'DB_PASSWORD' -AsSecureString)).Password
node --test tests/integration.test.js
Remove-Item Env:DB_PASSWORD
```

No se mostró ni guardó la contraseña en el repositorio. Para probar el envío real también se necesitan `APP_BASE_URL` HTTPS, `PASSWORD_RESET_DELIVERY_URL` HTTPS y `PASSWORD_RESET_DELIVERY_SECRET`, suministrados al proceso local sin compartirlos en el chat. Sin esos valores solo puede probarse confirmación con token sintético, no la entrega por correo.

### Continuación del cierre y preflight local — 11 de octubre de 2026

Se preparó `database/migrations/local/002_create_recuperacion_contrasena.sql`; contiene únicamente `CREATE TABLE IF NOT EXISTS` con la definición revisada y no se ejecutó. El proceso de Codex no dispone de Docker ni del cliente MySQL y `DB_PASSWORD` está vacío en `.env.test`, por lo que la consulta read-only a `piar_test` no pudo abrir conexión. La migración queda pendiente de confirmación manual de identidad/esquema desde VS Code.

### Revisión del prompt maestro y revalidación unitaria — 11 de octubre de 2026

Estado confirmado antes de continuar: rama `security/fase-1-hardening`; se conservaron todos los cambios locales existentes. El historial reciente termina en `27a87f8 configura migracion de base de datos para Railway`. No se hicieron operaciones Git de escritura.

Se corrigió la discrepancia en la ejecución segura de integración: `tests/integration.test.js` y el backend obtienen los parámetros de conexión desde `scripts/local-piar-test-config.js`, que fija exclusivamente `127.0.0.1:3307`, base/usuario `piar_test` y API `8081`. `scripts/run-local-integration-test.js` solicita DB_PASSWORD con entrada oculta y lanza únicamente el test de integración con esos destinos forzados; no requiere editar `.env` o `.env.test`. Se añadieron pruebas de regresión para configuración, overrides heredados y rechazo de contraseñas vacías.

Suite unitaria actual, excluyendo deliberadamente `tests/integration.test.js`: **24 aprobadas, 0 fallidas, 0 omitidas** (`node --test tests/auth-session.test.js tests/authorization.test.js tests/local-piar-test-config.test.js tests/migration-validator.test.js tests/password-reset.test.js tests/rate-limit.test.js tests/security-output.test.js tests/ui-permissions.test.js`). La integración no se ejecutó durante este cierre; la ejecución reportada antes por la usuaria (9 subpruebas, 8 aprobadas y 1 omitida) se conserva como evidencia comunicada, no como repetición de esta sesión.

Pendientes funcionales/externos: el envío real de recuperación exige proveedor HTTPS y secretos locales `APP_BASE_URL`, `PASSWORD_RESET_DELIVERY_URL`, `PASSWORD_RESET_DELIVERY_SECRET`; no se probó envío real. Las pruebas locales no representan rol Estudiante porque el ENUM vigente no lo permite; no se añadió ese rol. La diferencia sobre permisos Docente para crear/editar PIAR sigue requiriendo decisión institucional. La corrección de observaciones como nueva nota enlazada carece de especificación de relación/campos y migración aprobada. El respaldo/restauración MySQL sigue sin implementar; requiere definir destino, retención, cifrado/custodia, validación de restauración y confirmación operativa. No se hicieron conexiones ni escrituras en bases en esta validación, ni se accedió a Railway/producción.

Se añadió limitación de solicitudes de recuperación por IP (10/15 min) y hash de correo (5/15 min), con respuesta genérica 429. Suite unitaria ampliada: `node --test tests/authorization.test.js tests/auth-session.test.js tests/password-reset.test.js tests/rate-limit.test.js tests/security-output.test.js tests/ui-permissions.test.js`, **17 aprobadas, 0 fallidas**. `node --test tests/integration.test.js` volvió a detenerse en preflight por falta de `DB_HOST`; no conectó ni escribió datos. No se aplicaron migraciones ni se accedió a Railway/producción.

### Registro y autenticación externa — 11 de octubre de 2026

Cambios de esta revisión: el frontend dejó de recortar los espacios de las contraseñas; el registro responde conflicto también ante una colisión concurrente del índice único; se añadieron pruebas para hash bcrypt, rol Docente forzado, estado pendiente, duplicados y preservación literal de password. La interfaz identifica las cuentas nuevas como pendientes de aprobación y declara que el correo aún no se verifica automáticamente. Los botones Google, Microsoft y Apple están deshabilitados mientras no exista el flujo OAuth completo.

Se añadió `backend/oidc.js`, con verificación RS256/JWKS, emisor, audiencia/azp, exp/nbf, nonce y claim de correo verificado. La prueba usa claves RSA sintéticas y también cubre rechazo de tokens inválidos, tenant configurado de Microsoft y la regla de no vincular por igualdad de correo. Este módulo aún no está conectado a endpoints de authorization code/callback, PKCE, sesiones ni tabla de identidades. Google, Microsoft y Apple **no funcionan aún como métodos de inicio de sesión**. No se configuraron ni se expusieron secretos.

Suite unitaria completa disponible, excluyendo deliberadamente integración: `node --test tests/auth-session.test.js tests/auth-registration.test.js tests/authorization.test.js tests/local-piar-test-config.test.js tests/migration-validator.test.js tests/oidc.test.js tests/password-reset.test.js tests/rate-limit.test.js tests/registration-approval.test.js tests/security-output.test.js tests/ui-permissions.test.js`: **39 aprobadas, 0 fallidas, 0 omitidas**. `node --check` para backend y frontend cambiados pasó. `git diff --check`: sin errores, con avisos de conversión LF/CRLF en archivos locales preexistentes. No se ejecutó integración ni se conectó a MySQL.

Configuración externa pendiente: crear credenciales OAuth Web en Google, Microsoft Entra y Apple Developer; fijar redirect URI solo después de implementar y publicar las rutas callback; guardar Client ID/secret y llaves privadas en el gestor del entorno, nunca en archivos de frontend/Git. Para Outlook/Hotmail la App Registration Microsoft debe aceptar cuentas organizacionales y personales, y el validador deberá admitir issuers de tenants verificados según metadata oficial. El client secret de Apple debe firmarse como JWT ES256 con Services ID, Team ID, Key ID y clave `.p8` custodiada fuera del repositorio.

El registro tradicional todavía no verifica correo y crea Docente `pendiente` hasta aprobación; se informa explícitamente en la UI y no activa la cuenta antes de la aprobación. Para completar esa regla hace falta implementar tokens de verificación de un solo uso/expiración, entrega real y migración local revisada. La aprobación institucional y la autorización por roles permanecen en el flujo existente; Administrador/Rector no son concedidos por el payload público. No se añadieron permisos de Estudiante ni se alteró la base.

## Actualización local: verificación de correo y OIDC

Se implementó el flujo de verificación tradicional: cuenta `pendiente_verificacion`, token aleatorio con hash persistido, vencimiento de 24 horas, consumo único, reenvío limitado y respuesta no enumerable. Confirmar correo mueve la cuenta a `pendiente`, sin saltarse aprobación institucional. Se añadió la migración local aditiva `003_email_verification.sql`, pero no se aplicó a ninguna base.

La dependencia `openid-client` reemplaza la verificación JWT artesanal y prepara descubrimiento, autorización PKCE y canje/validación OIDC. Aún faltan rutas HTTP, tabla/persistencia de identidades y el flujo de vinculación y onboarding; los botones de proveedor siguen deshabilitados y no se afirma que exista autenticación externa funcional.

`node --test tests/*.test.js` terminó con 42 aprobadas y 1 fallo de preflight en `tests/integration.test.js`: se detuvo porque `DB_HOST` no estaba configurada en el proceso. No alcanzó conexión ni escrituras. Las demás 42 pruebas unitarias pasaron. No hubo autenticación real con proveedores ni envío real de correo. `git diff --check` y verificaciones sintácticas se ejecutarán tras los últimos ajustes.
