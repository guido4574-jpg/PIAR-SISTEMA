> **Documento histórico.** El estado vigente está en `docs/ESTADO_FINAL_PROYECTO.md` (2026-11-22) y las decisiones en `docs/DECISIONES_TECNICAS.md`. Este informe se conserva como registro y puede contradecirlos.

# Estado actual del proyecto PIAR-SISTEMA

Actualizado: 2026-11-09 (cierre técnico) · Rama: `security/fase-1-hardening` · Nada de este trabajo está commiteado ni publicado.

> **Aviso (2026-11-21):** las decisiones institucionales y técnicas vigentes están en `docs/DECISIONES_TECNICAS.md`. Prevalecen sobre este documento, en particular sobre el registro limitado a Docente y el aprovisionamiento de otros roles.

Este es el documento de referencia del estado vigente. Los informes anteriores de `docs/` (auditorías, validaciones y continuaciones de octubre y noviembre) se conservan como histórico y pueden contradecir este documento; ante cualquier diferencia, prevalece este.

## 00. Cierre técnico (2026-11-09)

### Entorno local definitivo
- **MySQL:** un único contenedor, `piar-mysql-test` (MySQL 8.0.46), en `127.0.0.1:3307`.
  - Base `piar_test` en el volumen persistente `c3c5424b…`.
  - Sin reinicio automático.
- **WSL 2:** limitado en `%USERPROFILE%\.wslconfig` (`memory=1536MB`, `processors=2`, `swap=2GB`). La VM queda en 1,37 GiB y MySQL usa unos 430 MiB.
  - Causa del fallo anterior: el equipo tiene 3,9 GB de RAM y la memoria comprometida llegó a 14,4 de 15,9 GB. Docker Desktop no podía arrancar la VM ("Insufficient system resources").
  - En el diálogo de error de Docker, usar **Quit**, nunca **Reset to factory defaults**: borra el volumen.
- **Backend nativo en Windows:** `node scripts/start-local-backend.js` → http://127.0.0.1:8090.
  - Toma solo `DB_USER` y `DB_PASSWORD` de `.env.test` como variables del proceso; no los imprime ni modifica `.env` o `.env.test`.
  - Fija `127.0.0.1:3307/piar_test` y rechaza root y otros esquemas. `PIAR_LOCAL_DB_NAME=piar_test_<sufijo>` admite esquemas desechables.
  - `MAINTENANCE_INTERVAL_MINUTES=0` desactiva la purga periódica: úsalo para arrancar sin modificar datos.
- **Retirados:** los contenedores `piar-mysql-test-fresh` (3308) y `piar-mysql-verificacion` (3310). Sus datos ya se habían perdido con su tmpfs. Los scripts heredados que apuntan a 3308 ya no tienen destino.
- **Conservados sin autorización de retirada:**
  - el contenedor `piar-backend`: piloto detenido, publicado en `0.0.0.0:8080`;
  - la imagen `piar-backend:latest` (265 MB);
  - la red `piar-sistema_default`, sin contenedores conectados;
  - la imagen `mysql:8.0`.
- **MySQL80 nativo** (servicio en ejecución, inicio manual): no se tocó. Podría alojar la base institucional `piar`. Consume unos 600 MB.

### Base `piar_test`
- **Respaldo previo:** `Desktop/PIAR-SISTEMA-respaldos/piar_test_3307_20261109_052254Z.sql`, con su `.sha256` (`76eb0676…434cfc`).
  - Contiene 22 tablas y 1827 filas, sin triggers, rutinas, eventos ni vistas.
  - Se verificó restaurándolo en un esquema de ensayo: datos y estructura idénticos por hash.
  - Contiene datos con forma de datos personales: guárdalo fuera de cualquier sincronización.
- **Migraciones:** 009–015 aplicadas el 2026-11-09, después de un ensayo completo en una copia.
  - Se aplicaron una por una con `backend/run-migration.js` y una cuenta migradora temporal (`CREATE, ALTER, REFERENCES, SELECT, INSERT, UPDATE` solo sobre el esquema, sin privilegios globales). La cuenta ya está eliminada.
  - Tras cada paso, los datos originales siguieron idénticos por hash.
  - Cambios en estructura existente: solo `docente.documento` (varchar 20 → 30) y `usuario.rol` (+`Estudiante`; `'Psicóloga'` intacto). Se añadieron 57 objetos nuevos.
  - `schema_migrations` registra 000–015 con checksum. Volver a ejecutarlas no produce cambios.
- **Fixtures retenidos, limpiados con autorización:** 112 de 115 cuentas y 28 de 29 estudiantes eran restos de 14 ejecuciones fallidas de la integración (23–26 de octubre).
  - Se borraron con sus dependencias en una transacción, tras ensayo y simulación.
  - El hash de las filas no sintéticas quedó idéntico en las 26 tablas.
  - `piar_test` conserva 3 cuentas, 1 estudiante, 1 PIAR y su auditoría.
- **Cuentas MySQL:** `piar_test@%` (solo DML sobre `piar_test.*`), `root@%` y `root@localhost`. La aplicación nunca usa root.

### Correcciones de esta fase (sin commit)
- **`POST /api/observaciones` y `/api/seguimientos` aceptaban `{}`** y creaban registros sin descripción, PIAR ni estudiante.
  - Ahora exigen descripción (`nota` se admite en observaciones), un `id_piar` o `id_estudiante` válido y existente, y `fecha` en formato `AAAA-MM-DD` si se envía.
  - Función: `validateRecordPayload` en `backend/pedagogical-validation.js`. Para el Docente se valida después de su comprobación de alcance, así que conserva el 403.
- **`tests/integration.test.js`:** la limpieza de fixtures generaba `IN ()` si fallaba antes de crear usuarios, y ocultaba el error original. Ahora está protegida.
- **Nuevo** `scripts/start-local-backend.js`, con su prueba en `tests/local-piar-test-config.test.js`.

### Pruebas del cierre (resultados reales, 2026-11-09)
| Prueba | Resultado | Entorno |
|---|---|---|
| `npm test` | **214/214** (212 anteriores + 2 nuevas) | Sin base de datos |
| `npm run check:secrets` | Sin hallazgos | — |
| `npm run db:migrate:status` | 15/15 `aplicada` (cuenta DML, solo lectura) | `piar_test` |
| Integración (`test:integration:local`, perfil local 3307) | **12 aprobadas, 0 fallidas, 1 omitida**. Ejecutada dos veces, antes y después de la corrección de validación. 0 fixtures retenidos al terminar. | `piar_test` |
| e2e (`test:e2e`) | **Aprobada**. Ejecutada dos veces sobre un esquema nuevo con 000–015; la segunda, después de la corrección. | `piar_test_e2e` (desechable, ya eliminado) |
| Matriz HTTP de 6 roles | **127/127**: login de los 6 roles, 19 rutas × 6 roles según `authorization.js`, aislamiento del Estudiante (solo su PIAR; PIAR ajeno = 404 idéntico a inexistente; detalle sin campos profesionales), alcance docente, Psicóloga sin edición de PIAR y 401 sin sesión | `piar_test_e2e` |
| Chrome real (headless, protocolo DevTools) | Login por formulario, menú por rol y cierre de sesión correctos en los 6 roles. Administrador: Dashboard, Solicitudes, Usuarios, Estudiantes, Docentes, PIAR/PR, Reportes y Configuración. Rector, Coordinador, Psicóloga y Docente: lo mismo sin Solicitudes ni Usuarios. Estudiante: solo "Mi PIAR". **0 excepciones JS.** Errores de consola: CSP bloquea Google Fonts (ver pendientes), 401 esperado en `/api/auth/me` antes del login y 404 de `/favicon.ico`. | Backend en 8090 sobre `piar_test_e2e` |
| Arranque contra `piar_test` (8090) | `/api/health` 200, `/api/config` 200, página 200 con CSP, `X-Frame-Options: DENY`, `nosniff`, `no-referrer` y COOP. `/api/piar` y `/api/usuarios` sin sesión responden 401. Sin cambios de datos, salvo 1 evento de auditoría de la propia petición denegada. | `piar_test` |

**La omisión de la integración es un marcador fijo** (`tests/integration.test.js:569`), escrito antes de la 015: no consulta el esquema. El Estudiante quedó cubierto por la matriz HTTP, por Chrome y por `tests/student-portal.test.js`.

### Pendientes reales tras el cierre
1. **CSP y fuente:** `public/css/main.css:1` y `public/css/styles.css:805` importan Poppins de Google Fonts y la CSP lo bloquea. Hay que alojar la fuente localmente o retirar el `@import`.
2. Convertir la omisión del Estudiante en la integración en una prueba real: el ENUM ya admite el rol.
3. Decidir la retirada de `piar-backend`, de su imagen y de la red `piar-sistema_default`. Es el piloto, que publica en `0.0.0.0:8080`.
4. Los informes previos a la 014 se borraron con la limpieza, porque todos eran sintéticos. Los nuevos se guardan con instantánea.
5. Detalles visuales vistos en Chrome:
   - El dashboard muestra fechas ISO crudas (`2026-02-03T05:00:00.000Z`).
   - En "Mi PIAR", el campo "Revisión:" aparece vacío.
   - Falta `favicon.ico`.
6. El aprovisionamiento de cuentas Estudiante sigue sin flujo por la API: en las pruebas se vinculó por SQL en el esquema desechable.

## 0. Fase de finalización (2026-11-08, segunda parte)

### Cómo abrir el sistema localmente
- **Vigente desde el 2026-11-09:** ver la sección 00. Lo que sigue describe el entorno de verificación del 2026-11-08, ya retirado.
- **Dirección:** http://localhost:8090
- **Base de datos (retirada):** contenedor desechable `piar-mysql-verificacion` (127.0.0.1:3310), esquema `piar_dev_verificacion`, migraciones 000-013 aplicadas, cuenta de aplicación con solo DML.
- **Cuentas sintéticas de la e2e:** `e2e-0@example.invalid` (Administrador), `e2e-1` (Rector), `e2e-2` (Coordinador), `e2e-3` (Psicóloga), `e2e-4` y `e2e-5` (Docente), todas con dominio `@example.invalid`. Contraseña: `Frase sintetica e2e 2026`. Es una contraseña de prueba que ya figura en `tests/e2e-flujos.test.js`. Solo existen dentro de un esquema e2e mientras no se elimine.
- MySQL80 (3306) no se usó: no hay credenciales para él.

### Cambios de esta fase
- **PIAR cerrado de solo lectura en el backend** (opción `rejectClosed` en `piar-versioning.js`, comprobada sobre la fila bloqueada). Responden 409: barreras, ajustes (crear, editar y eliminar), evidencias, DUA, edición del PIAR, diagnósticos, observaciones y seguimientos vinculados. En el frontend se ocultan esas acciones y el formulario de observaciones no ofrece PIAR cerrados. La asignación de docentes sigue permitida, porque controla el acceso y no el contenido.
- **Permisos de la Psicóloga** (propuesta funcional aprobada):
  - Lee institucionalmente estudiantes, PIAR, diagnósticos, seguimientos, observaciones, historial, informes y dashboard.
  - Crea y edita diagnósticos; no los elimina.
  - Crea observaciones.
  - No edita PIAR, barreras, ajustes, evidencias, DUA ni seguimientos.
- **Informes persistentes** (`backend/reports.js`, `public/js/report-history.js`, migración **014, aplicada en `piar_test` el 2026-11-09**):
  - El servidor construye la instantánea desde MySQL; no acepta HTML del cliente.
  - Cada informe se vincula a PIAR y estudiante, con autor y fecha.
  - Un mismo autor no duplica un informe de contenido idéntico en 10 minutos.
  - El Docente solo genera y consulta informes de PIAR asignados.
  - Los informes históricos se ven e imprimen tal como se generaron.
  - Sin la migración 014, guardar responde 503 y la consulta sigue funcionando.
- **Datos personales en registros:** el error al crear un estudiante ya no registra el mensaje de MySQL, que incluía el documento. Un documento duplicado devuelve 409, y si faltan el nombre o el documento devuelve 400.
- **Repositorio:**
  - `npm run check:secrets`, también en la CI, rechaza rutas y patrones sensibles en los archivos versionados.
  - `.gitignore` excluye `/data/` completo.
  - Plan de limpieza del historial en `docs/seguridad/PLAN_LIMPIEZA_HISTORIAL.md`.
- **Herramientas:** `npm run db:check` (diagnóstico de solo lectura). `db:migrate:status` ya no crea tablas.

### Pruebas de esta fase (resultados reales)
| Prueba | Resultado |
|---|---|
| `npm test` | 193/193 |
| Integración (`piar_test`, MySQL 8.0.46) | 12 aprobadas, 0 fallidas, 1 omitida (Estudiante) |
| e2e en esquema nuevo con 000-013 | Aprobada. Incluye controles positivos y de 409 por PIAR cerrado, la matriz de la Psicóloga y el 503 de informes sin la 014. |
| Prueba HTTP contra la instancia en 8090 | 27/27: página y recursos, CSP, bloqueo de ruta, otro origen rechazado, login de 5 roles, registro → verificación → aprobación → login, cierre de sesión |
| Navegador real | **Pendiente, manual.** No se relanzó Chrome headless. |
| Validación del YAML de la CI | **No realizada.** Se denegó descargar un validador externo. |

### Pruebas del rol Estudiante (2026-11-08, tercera parte; resultados reales)
| Prueba | Resultado |
|---|---|
| `npm test` | **212/212** (193 anteriores y 19 nuevas, contando subpruebas) |
| `tests/student-portal.test.js` | 18/18. Cubre la matriz de rutas del Estudiante y de la Psicóloga, el perfil con fallo cerrado, el alcance tomado de la sesión, la proyección sin tablas profesionales y la migración 015. Incluye una prueba **HTTP contra el `server.js` real** con una base en memoria y dos estudiantes sintéticos. Esa prueba comprueba lo siguiente: <br>- La lista solo trae los PIAR propios.<br>- El detalle no contiene información profesional.<br>- El PIAR ajeno responde un 404 igual al de uno inexistente.<br>- Las rutas profesionales y todas las escrituras responden 403.<br>- Una cuenta sin vínculo activo responde 403.<br>- Ninguna petición consultó tablas profesionales.<br>- Las peticiones quedan auditadas. |
| Control de mutación | Con el desvío del Estudiante desactivado en `server.js`, la prueba HTTP falló (6 fallos). Se restauró el archivo y se verificó byte a byte. |
| `tests/ui-permissions.test.js` | Nueva prueba de la vista "Mi PIAR": sin secciones profesionales ni acciones de edición. |
| `npm run check:secrets` y detector sobre archivos nuevos | Sin hallazgos |
| Integración y e2e con MySQL | **No ejecutadas.** Docker no está activo. La integración local (`piar_test` en 3306) pide una contraseña que no estaba disponible y requiere aplicar antes la migración 015. `tests/integration.test.js` ya espera el ENUM con `Estudiante` y la columna/FK `estudiante.id_usuario`. Por eso fallará en su preflight hasta que se aplique la 015. |

### Decisiones institucionales aprobadas sobre roles (2026-11-08, tercera parte)
1. **Psicóloga:** consulta institucional con permisos profesionales limitados. Puede consultar estudiantes, PIAR, diagnósticos y seguimientos, registrar observaciones y gestionar diagnósticos según sus permisos. No puede modificar el PIAR ni sus ajustes institucionales.
   - **Sin cambios de código:** la matriz ya implementada (ver "Permisos de la Psicóloga") cumple la decisión. `tests/student-portal.test.js` la fija con una prueba adicional.
2. **Estudiante:** acceso exclusivo a su propio PIAR, en modo solo lectura. No puede consultar diagnósticos ni observaciones profesionales, ni modificar información. **Implementado**, como se describe a continuación.

### Rol Estudiante (implementado; cambios sin commit)
- **Vínculo de cuenta (migración 015, aplicada en `piar_test` el 2026-11-09):** `015_student_account_link.sql` agrega `Estudiante` al ENUM `usuario.rol` y conserva los valores existentes. También agrega `estudiante.id_usuario`, con `UNIQUE` y clave foránea a `usuario`. Es aditiva y re-ejecutable.
- **Autorización por ruta** (`authorization.js`): el Estudiante solo puede usar `GET /api/piar` y `GET /api/piar/:id`. Todo lo demás responde 403, incluidas cualquier escritura y estas rutas:
  - Diagnósticos, observaciones y seguimientos.
  - Versiones, historial, informes y dashboard.
  - Subrutas del PIAR: barreras, ajustes, DUA y docentes.
  - Perfiles de estudiantes y docentes, y usuarios.
- **Alcance y proyección en el backend** (`backend/student-portal.js`):
  - `server.js` envía toda petición de un Estudiante a este módulo justo después de la autorización. Así nunca llega a los manejadores institucionales.
  - El estudiante se obtiene de la sesión (`usuario` → `estudiante.id_usuario`) y nunca de un identificador enviado por el cliente.
  - Si el vínculo falta, está inactivo, es duplicado o el esquema no tiene la migración 015, la respuesta es 403 sin datos.
  - Un PIAR de otro estudiante y uno inexistente responden el mismo 404.
  - La respuesta usa una lista blanca de campos. Incluye los campos pedagógicos del PIAR, docentes (nombre y área), barreras, ajustes, evidencias (descripción y fecha) y DUA.
  - **Excluye:** diagnósticos, observaciones, seguimientos, versiones, historial, `informes_salud` (informes de salud), datos del perfil del estudiante (valoración, contexto, acudiente, teléfono), correos de docentes, autores internos y referencias de evidencias.
  - Las consultas SQL del módulo no tocan las tablas `diagnostico`, `observacion`, `seguimiento`, `historial` ni `reporte`.
- **Auditoría:** cada consulta del Estudiante, permitida o denegada, se registra en `piar_auditoria` mediante el mecanismo existente.
- **Frontend** (`public/js/student-portal.js` y ganchos en `app.js`):
  - Menú único "Mi PIAR" y vista forzada a esa sección.
  - Detalle de solo lectura sin diagnósticos, observaciones, seguimientos, versiones ni informes de salud.
  - Sin botones de edición. Solo se ofrece imprimir.
  - La interfaz no es la barrera de seguridad: el backend aplica las mismas reglas.
- **Rutas:** se reutilizan las rutas existentes de PIAR en lugar del `GET /api/mi-piar` de la propuesta. Así el cliente HTTP no cambia. El aislamiento es el mismo, porque el módulo dedicado atiende todas las peticiones del rol.

**Interpretaciones conservadoras que conviene confirmar:**
- Se excluyeron `informes_salud` y los **seguimientos**, aunque la decisión solo nombra "diagnósticos y observaciones profesionales". Se consideraron información clínica o profesional.
- El Estudiante ve sus PIAR en cualquier estado, también en borrador o revisión.

**Pendiente para usar el rol en una base real:**
1. ~~Aplicar la migración 015~~: hecho en `piar_test` el 2026-11-09.
2. Definir el **flujo de aprovisionamiento**: quién crea la cuenta del estudiante y la vincula a su registro, y cómo se gestiona la autorización del acudiente si el estudiante es menor de edad (Ley 1581).
   - Hoy no hay ninguna vía por la API: el registro público y `POST /api/usuarios` solo admiten Docente, y la API de estudiantes no acepta `id_usuario`.

## 1. Arquitectura actual

- **Ejecución:** Node.js 22 con `http` nativo y MySQL 8, sin Docker ni Railway. `npm start` sirve la API (`/api/*`) y el frontend estático (`public/`).
- **Backend** (`backend/`):
  - `server.js`: enrutamiento. Su tamaño sigue pendiente de reducir (ver sección 5).
  - `authorization.js`: matriz de roles, con denegación por defecto.
  - `student-portal.js`: alcance y proyección de solo lectura del rol Estudiante.
  - `auth.js` y `password-policy.js`: sesiones, registro, reset y política de contraseñas.
  - `client-ip.js`: IP del cliente con proxies de confianza.
  - `rate-limit-store.js` y `login-throttle.js`: límites de intentos en memoria o en MySQL.
  - `security-events.js`: auditoría de autenticación.
  - `maintenance.js`: purga de registros vencidos.
  - `piar-versioning.js`: instantáneas y versiones del PIAR.
  - `pedagogical-validation.js`: validación de barreras, ajustes, evidencias y DUA.
  - `migrations.js` y `run-migration.js`: migraciones versionadas.
- **Frontend** (`public/js/`):
  - `app.js`: vistas principales.
  - `api.js`: cliente HTTP centralizado.
  - `piar-management.js`: editar, cerrar o reabrir un PIAR, docentes asignados, DUA e impresión.
  - `user-admin.js`: administración de cuentas.
  - `piar-version-history.js`: historial de versiones.
  - `student-portal.js`: vista "Mi PIAR" del Estudiante.
  - `security.js`: `escapeHTML`.
- **Base de datos:** migraciones `000_base_schema.sql` a `015_student_account_link.sql`, registradas en `schema_migrations` con checksum. Todas son re-ejecutables. En `piar_test`, 000–015 están aplicadas y registradas desde el 2026-11-09.

## 2. Correcciones realizadas en esta fase

### Repositorio y datos sensibles
- Respaldo completo antes de cualquier cambio, incluido `.git`, sin `node_modules` ni archivos `.env*`: `Desktop/PIAR-SISTEMA-respaldos/respaldo-pre-fase-final-20261107.tar.gz`.
- `data/db.json` salió del índice con `git rm --cached` (cambio preparado, sin commit). Su copia quedó en `Desktop/PIAR-SISTEMA-respaldos/datos-sensibles/db.json`, fuera del proyecto. Contenía una credencial (`validEmail`/`validPassword`) y datos de estudiantes y docentes. El código no lo usaba.
- Se reemplazaron por marcadores la credencial que aparecía en `docs/PIAR-DOC-05-MODULOS.md`.
- Se retiraron archivos accidentales (`ntent .package.json`, `piar-test-cookies.txt`; ambos están en el respaldo). El informe HTML suelto de la raíz pasó a `docs/auditoria-local/`.

### Retiro del piloto Railway/Docker
- `Dockerfile`, `.dockerignore` y `docs/RAILWAY_DATABASE_SETUP.md` ya estaban borrados en el árbol de trabajo y se mantienen así.
- `000_railway_schema.sql` pasó a llamarse `000_base_schema.sql`, con todas sus referencias actualizadas.
- La integración ya no depende de contenedores: el perfil `local` acepta cualquier MySQL en loopback.

### Seguridad
| Hallazgo | Corrección |
|---|---|
| Límite de login por IP tras un proxy (bloqueo global) | `TRUSTED_PROXIES` define los proxies de confianza. Solo para ellos se lee `X-Forwarded-For`, recorriéndolo desde el salto más cercano. |
| Bloqueo dirigido de cuentas | Solo se cuentan los fallos. El límite estricto es de 5 por par (IP, cuenta). Hay un tope de 30 por IP y 100 por hora por cuenta. Un login correcto limpia el par. |
| Limitadores solo en memoria | `RATE_LIMIT_STORE=mysql` comparte los contadores entre instancias (tabla `limite_solicitudes`, claves en SHA-256). |
| CSP y recursos externos | Se agregaron CSP, `Cross-Origin-Opener-Policy` y `Cache-Control: no-store` en la API. Chart.js está fijado en 4.5.1 y Bootstrap Icons en 1.13.1, ambos con SRI. Se retiró el bundle de Bootstrap JS, que no se usaba. |
| Registros vencidos sin limpieza | Purga por lotes cada hora (`MAINTENANCE_INTERVAL_MINUTES`) y `npm run db:purge-expired`. |
| Sin auditoría de autenticación | Tabla `evento_seguridad` (migración 012) con el correo en hash y la IP truncada a /24 o /48. |
| Política de contraseñas inconsistente (8 frente a 14) | Un solo mínimo de 14 caracteres (máximo 72 bytes) en el backend y el frontend. |
| Relojes mezclados en las expiraciones | Sesiones, verificaciones y resets calculan la expiración con el reloj de MySQL. Se verificó con MySQL en UTC y Node en UTC-5: las sesiones duran 480 minutos. |
| `LOWER(correo)` impedía usar el índice y bloqueaba la tabla con `FOR UPDATE` | Comparación directa: la colación ya no distingue mayúsculas. |
| `docente.documento` era VARCHAR(20) frente a 30 en `usuario` | La migración 012 lo amplía. |
| Administración de cuentas | Se impide la autodesactivación y la desactivación del último Administrador. Desactivar revoca las sesiones. Hay reactivación. El correo se valida y un duplicado devuelve 409. Todo queda en `admin_account_audit`. |

**Corrección de la auditoría anterior:** el hallazgo "`GET /api/docentes/:id` sin filtro para Docente" era **incorrecto**. Un filtro central previo ya limitaba al Docente a su propio perfil y respondía 404 para los demás. Se retiró la comprobación duplicada que se había añadido, y la prueba verifica ahora el filtro existente.

### Funcionalidad
- **DUA (nuevo, migración 013):** estrategias organizadas por los tres principios (representación, acción y expresión, implicación). Permite registrar, consultar y editar dentro de cada PIAR, queda en el historial de versiones y no admite cambios con el PIAR cerrado.
- **PIAR:** interfaz para editar con justificación (versionada), cerrar (Administrador, Rector o Coordinador), reabrir (solo Coordinador) y asignar o retirar docentes. El detalle se puede imprimir o guardar como PDF.
- **Usuarios:** nueva vista "Usuarios" para el Administrador, con búsqueda, filtro por estado, edición de nombre y correo, desactivación y reactivación.
- **Errores corregidos:**
  - La Psicóloga no podía completar el inicio de sesión: un 403 abortaba toda la carga. Ahora cada recurso denegado llega vacío.
  - El docente aparecía como "Sin asignar" después de cualquier cambio.
  - Las observaciones salían en blanco porque había desajuste entre `nota`/`autor` y `descripcion`/`docente_responsable`.
  - Había colisión entre el texto `barreras` y la lista de barreras estructuradas.
  - `deleteDiagnostic` lanzaba un error después de eliminar.
  - Los catálogos de grados, discapacidades (MEN, Decreto 1421) y áreas estaban vacíos.
  - Había 22 textos con acentos corruptos (por ejemplo, "participaci?n").

### Herramientas
- `npm run db:migrate`, `npm run db:migrate:status` y `npm run db:purge-expired`.
- `npm run test:integration:local`, que acepta cualquier MySQL local, y `npm run test:e2e`.
- CI en `.github/workflows/ci.yml`: pruebas unitarias, `npm audit`, migraciones desde cero y re-ejecución, integración y e2e, sobre un MySQL efímero del runner.

## 3. Pruebas ejecutadas (resultados reales)

| Prueba | Resultado | Entorno |
|---|---|---|
| `npm test` (unitarias) | **185/185** en dos ejecuciones completas seguidas. Una ejecución anterior falló a nivel del archivo `login-throttle.test.js`; no se reprodujo en 3 intentos (posible inestabilidad, sin causa confirmada). | Sin base de datos |
| Migraciones 000-013 desde cero, más re-ejecución de cada archivo | 13 aplicadas, 0 fallos al re-ejecutar | MySQL 8.0.46 desechable (`piar-mysql-verificacion`, 127.0.0.1:3310) |
| `npm run test:integration:local` | 12 aprobadas, 0 fallidas, 1 omitida (el rol Estudiante no es representable en el ENUM). Se ejecutó después de los últimos cambios del backend. | Mismo MySQL, esquema `piar_test` |
| `npm run test:e2e` | Aprobada. Cubre los 5 roles del esquema, el alcance docente, el DUA, la edición versionada, la asignación de docentes, el cierre y la reapertura, la administración de usuarios, el anti-bloqueo tras proxy, los límites en MySQL, los eventos de seguridad, el cierre de sesión y la **persistencia tras reiniciar el backend**. | Mismo MySQL, esquema `piar_dev_verificacion` |
| Prueba en navegador real (Chrome headless) | **No completada.** La sesión de trabajo se cerró inesperadamente durante el intento. | — |
| CI de GitHub Actions | **No ejecutado:** requiere push. No se validó el YAML localmente. | — |
| `npm audit` | 0 vulnerabilidades | — |

## 4. Bloqueos y decisiones que requieren intervención humana

1. **Exposición pública (urgente).** El repositorio `github.com/guido4574-jpg/PIAR-SISTEMA` es público. La credencial de `data/db.json` y los datos personales están en el historial de `main`: `data/db.json`, `public/js/data.js` y `docs/PIAR-DOC-05-MODULOS.md` en 5 commits. Pasos:
   - Si esa contraseña se usó en una cuenta real, cambiarla.
   - Decidir si se reescribe el historial (`git filter-repo --path data/db.json --invert-paths` y limpieza de los otros dos archivos), seguido de `push --force`.
   - Pedir a GitHub que purgue la caché.
   - Valorar si los datos de estudiantes eran reales (Ley 1581).
2. **Rol Estudiante:** decisión aprobada e implementada (sección 0). Quedan pendientes tres cosas:
   - ~~Aprobar la migración 015~~: aplicada el 2026-11-09.
   - Definir el flujo de aprovisionamiento y vinculación de cuentas, con la autorización del acudiente para menores.
   - Confirmar las dos interpretaciones conservadoras: exclusión de seguimientos e informes de salud, y visibilidad de PIAR en borrador.
3. **Alcance de la Psicóloga:** decisión aprobada: consulta institucional con permisos profesionales limitados (sección 0). La implementación vigente la cumple.
3b. **Migraciones 014 y 015:** **aplicadas en `piar_test` el 2026-11-09** (ver sección 00). Para otra base hace falta una autorización propia.
4. **Contenedores:** resuelto en la sección 00.
   - Queda un único MySQL, `piar-mysql-test` (3307), respaldado y verificado.
   - `piar-mysql-test-fresh` y `piar-mysql-verificacion` fueron retirados.
   - La retirada de `piar-backend` (8080) sigue pendiente de decisión.
5. **Herramientas Docker heredadas:** `docker-compose.test*.yml`, `scripts/fresh-test-container.js`, `apply-local-admin-password-change-migration.js`, `provision-local-admin-migrator.js`, `backup-local-piar-test.js` y `database/test-init/`. Ya no son necesarias para probar, pero se conservan hasta decidir el destino de los contenedores. `database/migrations/local/` es histórica.

## 5. Pendientes técnicos

- Quitar los `onclick` en línea de `app.js` para eliminar `'unsafe-inline'` de `script-src` en la CSP.
- Dividir `server.js` (~1750 líneas) en routers por recurso. Varias pruebas verifican texto fuente de `server.js` y habrá que adaptarlas.
- La edición del PIAR no puede vaciar un campo: el backend usa `COALESCE`.
- El dashboard no usa `/api/dashboard/resumen`; calcula sus cifras en el cliente con datos reales de la API.
- Se puede servir Chart.js y Bootstrap Icons desde el propio servidor para no depender del CDN (hoy están fijados por versión y con SRI).
- La carga inicial hace N+1 peticiones (una `GET /api/piar/:id` por PIAR). No hay paginación ni filtros en el servidor.
- Falta una interfaz para desactivar estudiantes y docentes (el backend ya lo permite).
- Hay colaciones mezcladas (`utf8mb4_0900_ai_ci` en partes de 001) y falta un `UNIQUE` en `docente.id_usuario`.
- Hay que decidir si se reorganizan los informes históricos de `docs/` en una carpeta `historico/`.

## 6. Próximos pasos sugeridos

1. Resolver el punto 4.1 (exposición pública) y commitear esta fase en partes revisables.
2. Hacer push de la rama para que corra la CI y corregir lo que falle.
3. ~~Aplicar 014 y 015 y volver a ejecutar la integración y la e2e~~: hecho el 2026-11-09 (sección 00). Conviene añadir a la e2e una cuenta Estudiante vinculada.
4. Hacer la prueba en navegador real con los seis flujos de rol.
5. Refactorizar `server.js` y eliminar los manejadores en línea.
6. Preparar un despliegue nuevo con proxy inverso (`TRUSTED_PROXIES`), `RATE_LIMIT_STORE=mysql` y una cuenta MySQL con solo DML.
