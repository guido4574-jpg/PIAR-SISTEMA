> **Documento histórico.** El estado vigente está en `docs/ESTADO_FINAL_PROYECTO.md` (2026-11-22) y las decisiones en `docs/DECISIONES_TECNICAS.md`. Este informe se conserva como registro y puede contradecirlos.

# Informe de reparación funcional PIAR-SISTEMA

**Fecha:** 26 de octubre de 2026  
**Rama conservada:** `security/fase-1-hardening`

## Estado inicial y límites

El repositorio ya contenía numerosos cambios locales y archivos sin seguimiento antes de esta reparación. Se revisó `git status` antes de editar; no se limpiaron ni reemplazaron esos cambios. El proyecto tenía mecanismos de registro, aprobación, sesión, recuperación, transporte de correo, permisos, PIAR versionado y pruebas unitarias. También coexistían dos bootstraps administrativos: uno anterior que activaba la cuenta por afirmación de consola y otro local, además de un inicializador demo y pruebas de integración capaces de dejar identidades sintéticas retenidas. El usuario informó previamente que `piar_test` contiene 12 cuentas Administrador; su identidad/procedencia no se verificó en esta tarea.

No se conectó a MySQL, no se ejecutó ningún script de bootstrap/seeding, integración, migración o comando que escribiera datos. No se alteró ninguna cuenta ni se inspeccionó la base `piar_test`; la base institucional `piar` no fue consultada ni modificada.

## Causas raíz abordadas

- **Verificación administrativa falsa:** el bootstrap heredado insertaba Administrador activo y correo verificado a partir de una declaración interactiva. Una confirmación local no demuestra propiedad del buzón.
- **Implementación duplicada:** dos rutas de bootstrap tenían comportamientos y validaciones diferentes.
- **Auditoría ambigua:** el operador de una CLI local no es un usuario autenticado de PIAR; atribuirle ese actor sería falso.
- **Fixtures retenidas:** integración podía ejecutarse contra el perfil de base ya existente y dejar Administradores sintéticos. No había prueba de que un endpoint en 3308 fuese realmente un datadir desechable solo por su puerto.
- **Exposición de correo simulado:** el transporte `memory` no es persistente y no puede enviar el correo inicial desde una CLI que termina.

## Correcciones implementadas

- `backend/admin-account-operations.js`: crea el Administrador únicamente si no hay ninguno; valida la base fija, serializa por advisory lock y usa transacción. Inserta bcrypt, cuenta `pendiente_verificacion`, `correo_verificado_at=NULL`, token aleatorio almacenando solo SHA-256 y evento de auditoría. La recuperación exige un ID explícito de Administrador activo, modifica solo su hash, revoca sus sesiones y consume sus tokens de recuperación pendientes.
- `backend/admin-account-audit.js` y `database/migrations/009_admin_account_audit.sql`: distinguen operador local declarado (`local_cli_self_asserted`) de verificación real de token (`email_verification_token`); no registran contraseña, hash ni token. La tabla es aditiva, pero no inmutable ante cuentas SQL con permisos de actualización/borrado.
- `backend/auth.js`: el token de verificación se reclama transaccionalmente y solo entonces activa al Administrador; el evento de correo verificado queda en esa transacción. La verificación de Docente conserva el flujo pendiente de aprobación. Añade el envío del token del bootstrap por el mismo adaptador.
- `backend/email.js`: el bootstrap requiere transporte persistente SMTP/API; rechaza `memory` y valida configuración sin revelar secretos. No se realizó envío real.
- `scripts/bootstrap-local-primary-admin.js`, `scripts/bootstrap-primary-admin.js`, `backend/primary-admin-bootstrap.js`, `scripts/recover-local-primary-admin.js`: un único flujo de bootstrap fijado a `127.0.0.1:3307/piar_test` y usuario `piar_test`; el legado delega o falla cerrado. No existe ruta HTTP. La recuperación local requiere selección y confirmación manual por ID y no cambia roles.
- `scripts/integration-fixture-guard.js`, `scripts/run-local-integration-test.js`, `scripts/fresh-test-container.js`, `tests/integration.test.js`, `scripts/local-piar-test-config.js`: la integración exige perfil `fresh`, bloquea fixtures sintéticas retenidas y ya no admite retención deliberada. Runner verifica por Docker que el destino sea el contenedor MySQL `piar-mysql-test-fresh`, tmpfs, sin volumen de datos y con publicación solo loopback 3308 antes de pedir credenciales o conectar. El borrado de integración se limita a los IDs de esa ejecución.
- `docker-compose.test.yml`: incorpora en la inicialización del contenedor efímero las migraciones 008 y 009 antes de restringir el usuario de prueba.
- `tests/admin-account-operations.test.js`, `tests/bootstrap-local-primary-admin.test.js`, `tests/email-verification.test.js`, `tests/email-delivery.test.js`, `tests/local-demo-accounts.test.js`, `tests/fresh-test-container.test.js`, `tests/migration-validator.test.js`, `tests/primary-admin-bootstrap.test.js`, `tests/local-piar-test-config.test.js`, `package.json`: regresiones de duplicados, hashes, cuenta pendiente, token real, denegación, revocación, auditoría/rollback, transporte persistente, separación de roles, contenedor efímero y validación del SQL.
- `docs/MANUAL_TECNICO_PIAR.md`: aclara el flujo efectivo de cuenta, la recuperación, la auditoría y los requisitos de correo. `docs/RESULTADOS_CONTINUACION_PIAR.md`: recibe el resultado de este hito.

## Decisiones de arquitectura

Se mantiene el sistema de autenticación actual. La creación del Administrador local no es un endpoint ni una identidad autenticada: requiere declaración explícita del operador y una referencia de autorización; el registro indica que esa identidad fue declarada, no probada. La verificación del correo se basa exclusivamente en el token de un uso enviado por SMTP/API persistente. Recuperar contraseña de una cuenta existente no recupera su buzón ni cambia su rol.

La integración se limita al contenedor de datos efímero verificado, sin usar el contenedor de `piar_test` ya existente en 3307. No se hizo limpieza histórica. El detector reconoce el patrón estricto generado por la suite; no demuestra que las 12 cuentas reportadas sean todas fixtures ni su procedencia.

La migración 009 se implementó como archivo y se añadió al compose de inicialización fresca, pero **no se ejecutó**. La configuración institucional debe aplicar cualquier migración solo con autorización y ventana de mantenimiento.

## Validaciones ejecutadas

- `npm.cmd test`: **139 aprobadas, 0 fallidas, 0 omitidas**. Incluye pruebas sin conexión a MySQL de bootstrap y recuperación, registro público, verificación email, fallback heredado, auditoría, permisos, UI, fixtures y preflight puro de identidad del contenedor.
- `node --check` sobre los 10 JavaScript modificados y parseo JSON de `package.json`: **correctos**.
- No se ejecutaron `tests/integration.test.js`, Compose/Docker, migraciones, validaciones HTTP con MySQL ni navegador. El entorno fresco no fue iniciado ni verificado en esta tarea; correr integración habría requerido crear y escribir fixtures.
- La suite de integración no se ejecutó. No se inició ni verificó el contenedor efímero en esta reparación y no se usó la base existente con las 12 cuentas Administrador reportadas.

## Estado del acceso administrativo

El código ofrece un procedimiento reproducible para establecer un Administrador **nuevo** únicamente si no existe ya ningún rol Administrador en la base destino. La base con 12 Administradores reportados hará que el bootstrap se niegue a crear uno nuevo. Para recuperar acceso localmente, el operador responsable puede usar `npm.cmd run db:recover:admin`, seleccionar manualmente el ID correcto tras revisar su identidad fuera del programa, registrar la autorización y establecer una contraseña nueva oculta. El comando apunta exclusivamente a `127.0.0.1:3307/piar_test`; esta reparación no lo ejecutó. La declaración y confirmación interactiva no acreditan por sí solas que la persona controla el correo.

La tabla `admin_account_audit` necesita que el operador aplique la migración 009 a una base de desarrollo aprobada antes de usar los nuevos comandos. No hay evidencia de configuración SMTP/API real. El envío de verificación y recuperación no debe declararse operativo hasta que un buzón controlado reciba y consuma enlaces reales.

## Arranque local y navegación

La aplicación necesita un MySQL con esquema compatible. Las cuentas conocidas de `piar_test` no se alteraron y el estado de esa base no se consultó; no se puede afirmar que el backend inicie en el entorno actualmente disponible. Para un entorno de validación desechable, usar exclusivamente los archivos Compose de pruebas y su archivo local de variables, comprobando primero que el servicio resultante sea `piar-mysql-test-fresh` con tmpfs:

```powershell
docker compose --env-file .env.test -f docker-compose.test.yml -f docker-compose.test.fresh.yml up -d
npm.cmd test
npm.cmd run test:integration:local:fresh
```

La integración pide la contraseña de MySQL en modo oculto y escribe solo en el contenedor efímero verificado de loopback 3308. No se usó este procedimiento en la reparación.

Para iniciar la aplicación, configure `.env` local con `DB_HOST=127.0.0.1`, `DB_PORT=3307`, `DB_NAME=piar_test`, `DB_USER=piar_test`, el `DB_PASSWORD` correspondiente, `HOST=127.0.0.1`, `PORT=8080`, `APP_BASE_URL=http://127.0.0.1:8080` y `CORS_ORIGIN=http://127.0.0.1:8080`. No copiar secretos al repositorio. Con la aplicación y el esquema realmente disponibles: `npm.cmd start`; abrir `http://127.0.0.1:8080`, iniciar con una cuenta aprobada activa y recorrer los módulos habilitados para ese rol. No se comprobó esta navegación en navegador.

## Pendientes concretos y confirmación del estado

- Hace falta aprobación institucional/documentada de quién es el operador y quién autoriza la recuperación, además de la selección humana de un ID; ninguna cuenta existente se selecciona automáticamente.
- Hace falta que el operador aporte secretos legítimos de SMTP/API y un buzón controlado, o decida trabajar temporalmente sin aprovisionar una cuenta hasta tener correo persistente.
- Hace falta autorización independiente para aplicar migración 009 en un esquema de pruebas o institucional. No es seguro ejecutar pruebas HTTP contra una base no verificada.
- La tabla de auditoría es mutable por usuarios SQL privilegiados; retención y protección frente a administradores DB requieren una decisión de infraestructura.
- No se verificó el arranque/backend, visualización en navegador, email real, OIDC real ni integración SQL. Ningún proveedor externo está declarado operativo.

La rama sigue siendo `security/fase-1-hardening`. No se cambió de rama, no se hizo commit ni push, no hubo despliegue, no se instalaron dependencias, no se ejecutaron migraciones y no se consultó ni modificó `piar`. Los cambios locales preexistentes se conservaron.

## Actualizacion de autenticacion y pruebas — 28 de octubre de 2026

- Registro publico: solo admite solicitar Docente. La creacion del usuario pendiente y su token de verificacion hash ahora es transaccional; el fallo al guardar el token revierte la cuenta. El endpoint aplica limites en memoria por IP (10/15 min) y correo normalizado (5/15 min).
- Aprobacion: endpoint `POST /api/usuarios/:id/aprobacion`, reservado a Administrador. El backend rechaza autoaprobacion; el rechazo requiere motivo de hasta 500 caracteres y lo persiste junto con decisor y fecha. La interfaz solicita el motivo.
- Cambio de esquema pendiente: `database/migrations/010_registration_decision_reason.sql` agrega `usuario.decision_reason VARCHAR(500) NULL` de forma aditiva. No se ejecuto; el servidor que use el nuevo endpoint necesita esta columna.
- Roles: solo Docente tiene flujo publico soportado. Administrador, Rector, Coordinador y Psicologa requieren alta interna autorizada; Estudiante y familia no son roles tradicionales de `usuario`. No existen endpoints de invitacion implementados: faltan vinculos y permisos institucionales validados para perfiles de Coordinacion/Psicologia.
- `npm.cmd test`: 147 aprobadas, 0 fallidas y 0 omitidas. Son pruebas unitarias con mocks y verificaciones estaticas; no validan MySQL ni el correo real.
- Integracion/esquema 3308 no verificados. No se ejecuto migracion, bootstrap, recuperacion ni prueba de integracion. No se leyeron ni cambiaron `.env` o `.env.test`.
