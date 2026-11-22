# Manual de usuario de PIAR

## Estado de esta versión (2026-11-21)

Este manual describe las pantallas y flujos del árbol local. Las secciones posteriores a «Preparación local de demostración» son históricas. El estado real de cada módulo y las pruebas ejecutadas están en `docs/INFORME_ENTREGA_PIAR.md`.

- No se ha probado la entrega real de correo. Mientras no se configure el SMTP de Gmail con una contraseña de aplicación, los enlaces de verificación y recuperación no llegan.
- Para la entrega académica, el acceso se hace solo con correo y contraseña. Los botones de Google, Microsoft y Apple y la opción «Identidades externas» están ocultos. Su código se conserva para una fase futura (ver README).
- El cambio de correo de una cuenta (decisión D1) necesita la migración 016, que no se ha ejecutado. Sin ella, el sistema responde que el cambio no está disponible y el correo actual no cambia.

## Iniciar PIAR localmente

Consulta el README (sección «Ejecutar»). En el entorno de pruebas local: MySQL en `127.0.0.1:3307` (base `piar_test`) y `node scripts/start-local-backend.js`, que abre `http://127.0.0.1:8090`. Para revisar solo la interfaz, sin base de datos: `npm run demo:visual` y `http://127.0.0.1:4173`.

## Registro, verificación y aprobación

1. En la pantalla de acceso, pulsa **Registrarse** (o **Crear una cuenta**).
2. Completa nombre, apellidos, documento, correo, **perfil solicitado** (Docente, Psicólogo(a), Coordinador o Rector), contraseña (mínimo 14 caracteres) y su confirmación. Elegir un perfil no concede acceso ni permisos.
3. La solicitud queda en estado «Pendiente de verificar correo». Por seguridad, el mensaje es el mismo aunque el correo o el documento ya existan.
4. Abre el enlace de verificación que llega al correo; vence en 24 horas y sirve una sola vez. Si no llegó, usa **Reenviar verificación de correo**.
5. Un **Administrador** revisa **Solicitudes de registro** (nombre, correo, documento, perfil y estado) y aprueba o rechaza. Rechazar exige un motivo. Solo se pueden decidir solicitudes con el correo verificado.
6. Al aprobar, la cuenta queda activa. Docente queda con su perfil docente; Psicólogo(a), Coordinador y Rector no necesitan un perfil adicional.

**Creación por el Administrador:** en **Usuarios**, pulsa **Nueva cuenta** e indica nombre, apellidos, documento, correo, perfil y una contraseña temporal. La persona recibe el enlace de verificación; después, la cuenta aparece en Solicitudes para aprobarla. En el primer acceso debe cambiar la contraseña temporal. Administrador y Estudiante no se crean desde aquí: las cuentas de estudiante las gestionan Administrador, Rector o Coordinador en el módulo de Estudiantes.

**Editar, desactivar y reactivar:** en **Usuarios**, el Administrador edita el nombre y el correo. Si cambia el correo, el actual sigue funcionando hasta que se confirme el enlace enviado al nuevo; al confirmarlo se cierran las sesiones de la cuenta. El Administrador también puede desactivar una cuenta (se cierran sus sesiones) y reactivarla. El rol de una cuenta existente no se cambia desde la interfaz.

## Inicio y cierre de sesión

- Escribe correo y contraseña. Solo una cuenta activa entra. Las cuentas pendientes, rechazadas o desactivadas reciben el mismo mensaje genérico que unas credenciales incorrectas.
- Tras varios intentos fallidos, el acceso se bloquea temporalmente.
- La sesión dura 8 horas y se guarda en una cookie HttpOnly. **Cerrar sesión** la revoca.
- **¿Olvidaste tu contraseña?** envía un enlace de un solo uso que vence en 30 minutos. La respuesta no revela si el correo existe.
- El acceso con Google, Microsoft y Apple no está disponible en esta versión: sus botones y la opción «Identidades externas» del menú de la cuenta están ocultos.

## Qué puede hacer cada rol

| Rol | Puede |
|---|---|
| Administrador | Todo lo institucional, más Solicitudes y Usuarios (crear, editar, desactivar y reactivar). Gestiona estudiantes, docentes y PIAR (crear, editar y cerrar). Edita y elimina diagnósticos. No registra observaciones ni seguimientos. |
| Rector | Gestiona estudiantes y docentes, y crea, edita y cierra PIAR. Edita y elimina diagnósticos. Consulta reportes. No decide solicitudes. |
| Coordinador | Lo mismo que Rector. Además reabre PIAR cerrados, crea diagnósticos y registra observaciones y seguimientos. |
| Psicólogo(a) | Consulta toda la información institucional. Crea y edita diagnósticos y registra observaciones. No edita PIAR, ajustes, DUA ni seguimientos. |
| Docente | Solo ve los estudiantes y PIAR asignados. Edita sus PIAR, registra ajustes razonables, evidencias, DUA, observaciones y seguimientos. |
| Estudiante | Consulta solo su propio PIAR, sin información profesional y sin opciones de edición. |

El backend aplica estas reglas aunque se llame directamente a la API. Un PIAR cerrado es de solo lectura.

## Navegación por módulos

| Módulo | Uso |
|---|---|
| Dashboard | Totales, seguimientos recientes, avance promedio, distribución por necesidad y alertas de revisión. **Nueva observación** aparece solo para los roles que pueden registrarla. |
| Solicitudes | (Administrador) Aprobar o rechazar solicitudes verificadas de los cuatro perfiles. |
| Usuarios | (Administrador) Crear, buscar, filtrar, editar, desactivar y reactivar cuentas. |
| Estudiantes | Búsqueda y perfil. **Nuevo estudiante** y **Editar** para Administrador, Rector y Coordinador; todos los campos tienen etiqueta visible. |
| Docentes | Consulta. **Nuevo docente** y **Editar** para Administrador, Rector y Coordinador. |
| PIAR / PR | Crear y consultar planes. En el detalle: barreras, ajustes razonables con evidencias, DUA, diagnósticos, observaciones, seguimientos, docentes asignados, historial de versiones, cierre y reapertura, según el rol. |
| Reportes | Genera el informe de un PIAR. El servidor guarda una instantánea consultable e imprimible en **Informes guardados**. |
| Configuración | Datos de presentación de la institución en el navegador. El nombre institucional lo fija el servidor. |

## Preparación local de demostración

Existe `scripts/create-local-demo-accounts.js`, fijado en el código a `127.0.0.1:3307`, base y usuario `piar_test`. Prepara únicamente una cuenta Docente, con correo `.invalid` y documento sintético `DEMO-`. Solicita consentimiento explícito en la terminal, verifica la identidad del servidor/esquema y lee la contraseña sin mostrarla. Inserta la cuenta y el perfil de Docente dentro de una transacción. Este inicializador no puede crear Administradores. El Administrador principal se aprovisiona por separado con `npm.cmd run db:bootstrap:admin`, sujeto al procedimiento del manual técnico. No ejecuta migraciones ni crea estudiantes o registros académicos.

No ejecutes el inicializador hasta que:

1. Se haya confirmado que el servicio detrás del puerto externo 3307 es el MySQL local de pruebas y que la base seleccionada es exactamente `piar_test`.
2. La migración de compatibilidad se haya revisado y aplicado por una conexión administrativa limitada a esa misma instancia y esquema, después de autorización explícita.
3. La estructura y los permisos DML se hayan comprobado. La cuenta `piar_test` está limitada a `SELECT`, `INSERT`, `UPDATE` y `DELETE`; no tiene permisos DDL.

Para preparar la cuenta Docente tras esas comprobaciones, configura temporalmente `PIAR_ALLOW_LOCAL_DEMO_SEED=1`, `DEMO_TEACHER_NAME`, `DEMO_TEACHER_LAST_NAME`, `DEMO_TEACHER_DOCUMENT` y `DEMO_TEACHER_EMAIL`. Usa un documento que empiece por `DEMO-` y un correo terminado en `.invalid`. Ejecuta `node scripts/create-local-demo-accounts.js` desde una terminal interactiva, comprueba el destino mostrado, escribe exactamente `CREAR CUENTA DOCENTE DEMO EN piar_test` y proporciona de forma oculta la contraseña de base y una contraseña nueva de al menos 14 caracteres para Docente. El script no imprime esas contraseñas.

El inicializador de cuentas no carga datos académicos. Para recorrer pantallas después de completar la autenticación, crea los registros de prueba desde la interfaz usando identificadores sintéticos y sin datos personales reales. Las acciones de diagnósticos y otros recursos requieren roles autorizados; la cuenta Docente no debe convertirse en Administrador para evitar ese requisito. Las pruebas de integración generan un Administrador fixture para sus escenarios. Antes de crear nuevos fixtures, detectan fixtures Administrador retenidos de ejecuciones anteriores y se detienen sin borrarlos; no uses la retención de fixtures como mecanismo de cuentas demo.

### Cuenta principal de Administrador local

`scripts/bootstrap-local-primary-admin.js` está fijado a `127.0.0.1:3307/piar_test` y usa la cuenta DML `piar_test`. Primero consulta el correo indicado de forma interactiva. Si ya existe, solo informa rol, estado y si tiene marca de correo verificado; no modifica esa cuenta. Si no existe, requiere confirmaciones separadas, una atestación del operador de que el correo ya fue verificado fuera de PIAR y una contraseña nueva que se introduce dos veces de forma oculta. La cuenta se crea activa con hash bcrypt y documento sintético `DEMO-ADMIN-*`. Este procedimiento local de bootstrap no envía correo ni sustituye el flujo público de registro; no lo ejecutes si no puedes verificar la titularidad/autorización de esa dirección.

El comando es `node scripts/bootstrap-local-primary-admin.js`. El script imprime el destino fijado, pero aun así verifica identidad y permisos antes de consultar o insertar. Su contraseña de MySQL se pide de forma oculta y nunca se lee de `.env` o `.env.test`.

La pantalla de solicitudes permite aprobar o rechazar Docentes verificados. No existe actualmente una pantalla de reasignación de roles: el registro público siempre crea Docentes, y las rutas de modificación rechazan cambios de rol/estado. No uses la aprobación de solicitudes para elevar una cuenta a otro rol.

## Guion sugerido para grabar el video

1. Comprueba el destino de MySQL y el backend local antes de abrir la aplicación. No muestres secretos en pantalla.
2. Presenta la pantalla de acceso y el registro. Si la entrega de correo no está configurada, explica que la solicitud queda pendiente de verificación y no afirmes que el mensaje llegó.
3. Muestra el flujo de verificación y aprobación solo si el correo se recibió y la cuenta fue verificada realmente. Aprueba la solicitud desde la cuenta Administrador o Rector.
4. Inicia sesión con las cuentas sintéticas preparadas. Recorre dashboard, estudiantes, docentes, PIAR/PR, ajustes, observaciones y reportes según las acciones habilitadas para cada rol.
5. Evita incluir datos personales reales, tokens, contraseñas o cadenas de conexión en la grabación.
6. Cierra sesión. No presentes Google, Microsoft, Apple ni recuperación de correo como operativos si no se configuraron y probaron con sus servicios reales.

## Pendientes de validación

- Aplicar y verificar `004_auth_schema_compatibility.sql` en `piar_test` con una conexión administrativa confirmada y autorización expresa.
- Ejecutar preflight y prueba de integración solo después de confirmar destino, estructura y permisos. Esas pruebas escriben fixtures sintéticas y realizan limpieza acotada.
- Verificar en navegador el ciclo completo de registro, entrega y verificación de correo, aprobación, login, navegación y cierre de sesión.
- Configurar y verificar recuperación/verificación por correo. Hacer pruebas reales de cada proveedor OIDC y sus redirects antes de habilitar su uso institucional.
- Preparar, si se necesita, cuentas de rol adicionales y datos académicos de demostración sintéticos; el script existente solo crea dos cuentas.

## Actualizacion de autenticacion y pruebas — 28 de octubre de 2026

- Registro publico: solo admite solicitar Docente. La creacion del usuario pendiente y su token de verificacion hash ahora es transaccional; el fallo al guardar el token revierte la cuenta. El endpoint aplica limites en memoria por IP (10/15 min) y correo normalizado (5/15 min).
- Aprobacion: endpoint `POST /api/usuarios/:id/aprobacion`, reservado a Administrador. El backend rechaza autoaprobacion; el rechazo requiere motivo de hasta 500 caracteres y lo persiste junto con decisor y fecha. La interfaz solicita el motivo.
- Cambio de esquema pendiente: `database/migrations/010_registration_decision_reason.sql` agrega `usuario.decision_reason VARCHAR(500) NULL` de forma aditiva. No se ejecuto; el servidor que use el nuevo endpoint necesita esta columna.
- Roles: solo Docente tiene flujo publico soportado. Administrador, Rector, Coordinador y Psicologa requieren alta interna autorizada; Estudiante y familia no son roles tradicionales de `usuario`. No existen endpoints de invitacion implementados: faltan vinculos y permisos institucionales validados para perfiles de Coordinacion/Psicologia.
- `npm.cmd test`: 147 aprobadas, 0 fallidas y 0 omitidas. Son pruebas unitarias con mocks y verificaciones estaticas; no validan MySQL ni el correo real.
- Integracion/esquema 3308 no verificados. No se ejecuto migracion, bootstrap, recuperacion ni prueba de integracion. No se leyeron ni cambiaron `.env` o `.env.test`.
