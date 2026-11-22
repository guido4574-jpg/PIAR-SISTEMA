> **Documento histórico.** El estado vigente está en `docs/ESTADO_FINAL_PROYECTO.md` (2026-11-22) y las decisiones en `docs/DECISIONES_TECNICAS.md`. Este informe se conserva como registro y puede contradecirlos.

# Informe de correcciones PIAR

Fecha: 19 de octubre de 2026  
Rama: `security/fase-1-hardening`

## Cambios implementados

- `backend/auth.js`: las consultas de correo usan `LOWER(correo) = ?`. El registro fuerza el rol `Docente` y siempre crea cuentas pendientes de verificación; el antiguo argumento privilegiado ya no omite ese flujo. La reclamación del token de recuperación bloquea la fila con `FOR UPDATE`; el consumo, cambio de hash y revocación de sesiones permanecen dentro de una transacción.
- `backend/server.js`: la creación administrativa queda limitada a Docente y usa el mismo flujo de verificación/aprobación. La aprobación recibe el ID del Administrador o Rector autenticado. Las consultas de usuarios incluyen los campos de auditoría de la decisión.
- `backend/registration-approval.js`: el cambio de estado registra al decisor en `aprobado_por_usuario_id` o `rechazado_por_usuario_id` y registra `decision_at`; la transición solo aplica a Docentes con correo verificado y estado pendiente.
- `database/migrations/001_mvp_core.sql`: prepara de forma idempotente los campos y llaves de auditoría para instalaciones nuevas.
- `database/migrations/002_registration_decision_audit.sql`: migración aditiva e idempotente para instalaciones que ya aplicaron la migración 001. No fue ejecutada.
- Pruebas: se añadieron regresiones para el parámetro privilegiado heredado, el ID de quien decide, bloqueo del token y rollback ante fallo de persistencia.

## Autorización por PIAR

La capa de servidor revisada exige asignación activa de docente para PIAR y estudiante por identificador; las listas de PIAR/estudiantes y las consultas de diagnósticos, seguimientos y observaciones filtran por asignación. Las rutas por ID de estos recursos también se limitan en backend. Historial, reportes y dashboard permanecen para roles institucionales, no para Docente. No se modificaron los permisos institucionales existentes.

## Evidencia de pruebas

- Ejecutado: 15 archivos unitarios aislados con `node --test` (58 pruebas en la ejecución final), todos aprobados. Incluyen registro, sesión, autorización, aprobación, verificación, recuperación, rate limiting, migración y seguridad de salida.
- No ejecutado: `tests/integration.test.js`. Escribe fixtures y requiere MySQL; aunque el código de configuración fija host `127.0.0.1`, puerto `3307`, base/usuario `piar_test`, no se verificó la identidad efectiva del servidor activo en este turno. Para respetar la restricción, no se inició conexión ni prueba de integración.
- No ejecutado: migraciones y pruebas de navegador/proveedor de correo. No hubo envío real ni uso de credenciales.

## Pendientes concretos

- Aplicar manualmente la migración 002 en una ventana aprobada cuando se confirme el destino y se valide el esquema. El backend que registra decisiones requiere esas columnas.
- La migración local `database/migrations/local/004_auth_schema_compatibility.sql` ya figuraba pendiente en el manual; no se ejecutó ni se alteró en esta corrección.
- Ejecutar las pruebas de integración luego de confirmar por inspección del servidor MySQL la conexión efectiva exclusiva a `127.0.0.1:3307/piar_test`.
- Validar el envío real de correo y el recorrido en navegador con proveedores configurados. Las pruebas locales usan callbacks simulados y no prueban entrega externa.
- El bootstrap de primera cuenta disponible está fijado deliberadamente al entorno local `piar_test`; la creación de la primera cuenta en otro entorno requiere el procedimiento controlado del operador/DBA de ese entorno. No se creó una ruta pública de promoción.

## Correcciones de configuración y seguridad local — 20 de octubre de 2026

- `backend/database-config.js` centraliza y exige host, puerto, esquema, usuario y contraseña; rechaza `root`, puerto/pool inválidos. `backend/db.js` y el migrador no completan valores de conexión por omisión y rechazan el esquema genérico `piar`.
- `.env.example` usa un marcador para el nombre de base, escucha localmente en `127.0.0.1` y requiere reemplazo explícito. `.gitignore` bloquea futuras incorporaciones de `data/db.json`, bases locales, cookies y claves; el archivo JSON versionado se conserva sin cambios y no tiene consumidores activos.
- Login aplica límites por IP y hash de correo, respuesta genérica para 429 y compara bcrypt con un hash ficticio de costo equivalente para correos inexistentes. `backend/security-controls.js` valida orígenes de mutación contra una lista exacta (sin `*`) y restringe rutas estáticas decodificadas/normalizadas al directorio público.
- Se añadió `.gitattributes` para normalizar texto y saltos LF. Las pruebas nuevas verifican configuración, respuesta de login para correo no encontrado, origen hostil y traversal estático.
- Retiro piloto: se quitaron `Dockerfile`, `.dockerignore`, `docs/RAILWAY_DATABASE_SETUP.md` y el script `db:migrate:railway`. Se conserva `docker-compose.test.yml` y `database/test-init/` exclusivamente para MySQL efímero; el SQL histórico `000_railway_schema.sql` permanece porque define el esquema utilizado por pruebas locales.
- Resultados finales: suite previa 69/69; focalizadas 13/13; suite completa actual **77/77**; sintaxis **47 archivos**; `npm ls --depth=0` correcto; `npm audit` online **0 avisos**. El servicio Windows `MySQL80` aparece Running pero no tiene listener en 3306/3307/8081; Docker CLI no está instalado. El preflight exacto `127.0.0.1:3307/piar_test` devolvió `ECONNREFUSED`; no se ejecutó integración ni migraciones.

`data/db.json` contiene datos de apariencia demostrativa y un campo de contraseña no vacío. No se puede demostrar que sea ficticio ni que no se haya reutilizado. Se mantiene intacto y aún versionado por la restricción de no retirar datos sin autorización; si pudo ser real, debe rotarse y el responsable debe autorizar retirarlo de futuras versiones. No se reescribió historia.

## Verificación integral adicional — 20 de octubre de 2026

- En esta ejecución, `npm.cmd test` aprobó **77/77** pruebas aisladas. `node --check` aprobó los JavaScript bajo `backend/`, `public/js/`, `scripts/` y `tests/`; `npm.cmd ls --depth=0` terminó correctamente; `npm.cmd audit --offline` reportó 0 vulnerabilidades en caché local; `git diff --check` aprobó.
- El contenedor `piar-mysql-test` y el esquema `piar_test` no pudieron inspeccionarse: Docker CLI no está instalado. No se ejecutó integración/CRUD ni se accedió al MySQL local del puerto 3306. No se ejecutaron migraciones.
- Los mocks cubren auth, permisos, registro/aprobación, recuperación, rate limiting, correo y OIDC. No se verificó entrega de correo, proveedores OIDC, persistencia CRUD, PDF ni navegador con servicios reales.

## Revalidación de suite unitaria — 28 de octubre de 2026

- `npm.cmd run test:unit` terminó con **147 pruebas: 147 aprobadas, 0 fallidas, 0 omitidas**. Duración reportada por Node: **22.119 ms**.
- Esta cifra corresponde a la suite unitaria actual, separada de las cifras históricas de 69/69, 77/77 y 13/13 registradas arriba. No se ejecutó integración, no se conectó ni escribió en MySQL y no se iniciaron contenedores.
- La cobertura unitaria existente incluye registro público Docente, verificación de correo de un solo uso, aprobación y aprovisionamiento de perfil, sesiones, autorización por rol y alcance PIAR, además de validaciones estáticas de migraciones y configuración de pruebas. La suite no demuestra integración con SMTP/OIDC reales ni esquema MySQL actualizado.
- La revisión de invitaciones confirmó que no hay endpoints. No se añadió código ni esquema: antes hace falta una política institucional para validar y vincular Coordinación/Psicología y determinar qué roles puede invitar cada actor. La migración 010 para el motivo de decisión continúa pendiente de aplicación en pruebas.

## Demostración visual aislada — 28 de octubre de 2026

- Se añadió un servidor local separado para servir el frontend real con datos claramente ficticios de un único perfil Docente. No usa backend, `.env`, MySQL ni proveedores externos; bloquea formularios, escrituras y almacenamiento local. No muestra usuarios administrativos.
- Pruebas focalizadas: `node --test tests/visual-demo-server.test.js`, **5/5 aprobadas** después de corregir una aserción que comprobaba el correo en el fixture equivocado.
- Suite unitaria completa posterior: `npm.cmd run test:unit`, **152 aprobadas, 0 fallidas, 0 omitidas**, 70.177 ms (aprox. 70,2 s).
- Verificación HTTP local: `/` respondió 200 y mostró el banner aislado; `/api/health` informó `visual-demo` y `not-connected`; `/api/auth/me` respondió 401 en vista pública. No se abrió el navegador por timeout repetido de la herramienta de control; consola, renderizado visual y navegación no se consideran verificados.
- El servidor visual está disponible en `http://127.0.0.1:4173`. La integración MySQL, invitaciones, migración 010, correo y OIDC reales continúan pendientes.
