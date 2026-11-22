> **Documento histórico.** El estado vigente está en `docs/ESTADO_FINAL_PROYECTO.md` (2026-11-22) y las decisiones en `docs/DECISIONES_TECNICAS.md`. Este informe se conserva como registro y puede contradecirlos.

# Auditoría técnica integral del Sistema PIAR

> **Documento de auditoría histórica.** Describe el estado observado antes de las correcciones posteriores y conserva evidencia académica. Las instrucciones vigentes de operación y los resultados actuales están en `VALIDACION_FINAL.md`, `MANUAL_TECNICO_PIAR.md` y `MATRIZ_PRUEBAS_PIAR.md`. El despliegue piloto que menciona fue retirado; no se debe usar este informe como guía de publicación.

**Fecha de inspección:** 18 de octubre de 2026  
**Rama observada:** `security/fase-1-hardening`  
**Alcance:** inspección estática del repositorio y ejecución de pruebas Node aisladas. No se conectó a MySQL ni se alteraron datos.

## 1. Resumen ejecutivo

El repositorio contiene una aplicación web PIAR funcionalmente amplia, con servidor Node.js HTTP nativo, pool MySQL (`mysql2`), interfaz HTML/CSS/Bootstrap y JavaScript Vanilla que consume API mediante Fetch. La rama actual contiene una fase extensa de hardening todavía sin confirmar: hay cambios locales en servidor, autenticación, esquema, frontend y numerosas pruebas. El informe describe ese estado de trabajo y no presupone que los cambios estén desplegados.

La autenticación local está implementada con hash bcrypt, sesiones opacas almacenadas como hash en MySQL, cookie HttpOnly y expiración de ocho horas. El registro público no respeta el rol solicitado y genera usuarios Docente pendientes de verificación de correo y aprobación institucional. La aprobación de servidor se restringe a Administrador/Rector y a solicitudes Docente verificadas. Hay una utilidad de bootstrap de administrador con varias salvaguardas, pero está fijada a `piar_test` local: no resuelve por sí misma el alta inicial en Railway/producción.

La deficiencia de seguridad de mayor impacto detectada en el código es el control de alcance incompleto para Docente. Se comprueba asignación en rutas de PIAR, estudiantes y perfil docente, pero endpoints de diagnósticos, seguimientos, observaciones, historial y reportes devuelven consultas globales a cualquier rol al que la matriz permita leer. Un Docente autenticado podría consultar información de estudiantes ajenos a sus PIAR. También se identifican riesgos en la lectura de diagnósticos por detalle, ausencia de limitación de intentos en login, falta de protección explícita CSRF y uso de `SELECT *` con datos sensibles.

Se ejecutaron 54 pruebas unitarias/estáticas aisladas: todas pasaron. No se ejecutaron pruebas de integración HTTP/MySQL porque el script requiere credenciales introducidas por terminal para un servidor `piar_test` local fijado y la integración escribe y limpia fixtures. No se verificaron la base real, el despliegue Railway, la entrega externa de correo, proveedor OIDC, ni el comportamiento visual en navegador.

**Estado de producción:** no verificado; no hay evidencia suficiente para declarar el sistema listo para producción.

## 2. Arquitectura detectada

| Capa | Evidencia | Estado observado |
|---|---|---|
| Servidor | `backend/server.js` | Node.js `http.createServer`; rutas API y servicio estático desde `public/`. |
| Acceso a datos | `backend/db.js` | Pool `mysql2`; variables `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`. |
| Autenticación | `backend/auth.js` | bcrypt, token de sesión aleatorio, hash SHA-256 del token guardado en `sesion_usuario`. |
| Autorización | `backend/authorization.js` y verificaciones puntuales en `server.js` | Política por rol y recurso; comprobar también alcance del recurso para cada consulta. |
| Persistencia | `database/migrations/000_railway_schema.sql`, `001_mvp_core.sql` | Tablas MySQL institucionales y migración de compatibilidad. Estado aplicado en cada ambiente no verificable. |
| Interfaz | `public/index.html`, `public/js/*.js`, `public/css/*.css` | HTML, CSS, Bootstrap visible en UI, JS Vanilla y Fetch. |
| Datos de archivo | `data/db.json` | Existe; no se halló referencia activa desde los módulos frontend/backend inspeccionados. No es fuente demostrada de persistencia actual. |
| Contenedor | `Dockerfile`, `.dockerignore` | Imagen Node 22 Alpine, `npm ci`, `npm start`, puerto 8080. No contiene servicio MySQL ni procedimiento de migración/administrador. |

La configuración institucional de la interfaz se guarda en `localStorage` desde `public/js/app.js` (clave `piar_institution_settings`): no se persiste en MySQL. `backend/oidc.js` implementa funciones OIDC, pero `backend/server.js` no registra rutas que las invoquen; el inicio externo no está conectado al flujo HTTP observado.

## 3. Inventario de componentes relevantes

- `backend/server.js`: servidor, rutas API, asignación docente, consultas CRUD, CORS y archivos estáticos.
- `backend/auth.js`: registro, login, sesiones, correo, verificación, recuperación de contraseña.
- `backend/authorization.js`: matriz central de rol, método y ruta.
- `backend/registration-approval.js`: decisión de aprobar/rechazar Docente verificado pendiente.
- `backend/rate-limit.js`: limitador en memoria utilizado para solicitudes de verificación y recuperación.
- `backend/oidc.js`: funciones de proveedor OIDC sin ruta HTTP conectada.
- `backend/config.js`, `backend/db.js`: carga `.env` y pool MySQL.
- `database/migrations/000_railway_schema.sql`: esquema inicial con usuarios, PIAR, perfiles, diagnóstico, seguimiento, observación, historial y reporte.
- `database/migrations/001_mvp_core.sql`: migración de compatibilidad con alteraciones condicionales de columnas, índices y llaves.
- `database/migrations/local/`: cambios locales para verificación, recuperación y compatibilidad.
- `scripts/bootstrap-local-primary-admin.js`: creación interactiva fijada a `piar_test` en 127.0.0.1:3307.
- `scripts/run-local-integration-test.js`: lanzador interactivo fijado a base de pruebas.
- `tests/`: pruebas unitarias, de autorización, autenticación, interfaz y una integración HTTP/MySQL.
- `public/index.html`, `public/js/app.js`, `api.js`, `config.js`, `data.js`, `security.js`: interfaz, llamadas API y helpers de renderización.
- `.env.example`, `.env.test`, `.env.test.example`: configuración de entorno. Los valores de archivos de entorno no se reproducen aquí.

El estado Git reporta múltiples cambios modificados y archivos nuevos en esta rama (incluidos archivos de seguridad, migraciones, scripts, pruebas y documentación). Se conservaron. No se usó `git diff` como fuente de estado remoto ni se cambió de rama.

## 4. Estado general

| Área | Clasificación | Fundamento |
|---|---|---|
| Servidor/API | Parcialmente implementado | CRUD de los recursos principales; permisos centralizados, pero faltan filtros de alcance en varias consultas. |
| Persistencia | Implementada, no comprobada en ambiente | SQL y consultas MySQL existen. No se verificó una instancia real ni aplicación de migraciones. |
| Login/sesión | Implementado y cubierto por pruebas aisladas | bcrypt, sesión revocable y cookie segura según `NODE_ENV`. Falta prueba HTTP/MySQL en este turno. |
| Registro/aprobación | Implementado parcialmente | Registro público solo Docente, verificación de email y aprobación. Aprobador no se guarda en historial/auditoría. |
| Bootstrap administrador | Parcial | Herramienta segura para DB local de prueba; no existe procedimiento equivalente configurable para producción. |
| PIAR y ajustes | Implementado parcialmente | CRUD y relaciones en servidor/esquema, sin verificación de flujo completo contra BD/UI. |
| Reportes PDF | No demostrado | Esquema incluye `reporte`; API solo lista/consulta reportes, no se encontró generación PDF en ruta API. |
| OIDC social | Presente sin integración HTTP | `backend/oidc.js` existe, pero sin rutas conectadas al servidor ni pruebas end-to-end. |
| Pruebas unitarias | Verificadas | 54 pruebas pasaron en este entorno. |
| Integración/MySQL | Pendiente | Requiere instancia de prueba y credencial interactiva; no se ejecutó. |
| Producción/Railway | No verificable | No se inspeccionó cuenta remota, base, variables ni despliegue vivo. |

## 5. Administrador, registro y autorización

### 5.1 Primer administrador

`scripts/bootstrap-local-primary-admin.js` pide confirmaciones literales, contraseña oculta de al menos 14 caracteres, verifica identidad de BD, puerto, usuario, grants y esquema, rechaza cuentas existentes en lugar de cambiar su rol y guarda bcrypt dentro de transacción. Sus constantes fijan destino a `127.0.0.1:3307`, base/usuario `piar_test`; por diseño no sirve para Railway. Las pruebas mock verifican el hash, la transacción, el rollback y el destino fijo.

No hay un endpoint público de bootstrap hallado. El registro público fuerza el rol `Docente`. La ruta `POST /api/usuarios` está protegida por Administrador y rechaza todos los roles salvo Docente. No se observó una forma de autopromoción a Administrador mediante `rol` enviado al registro público. `auth.register(..., true)` puede aceptar roles privilegiados en abstracto, pero el único llamador HTTP observado comprueba primero que el solicitante sea Administrador y luego limita el payload a Docente.

**Deficiencia alta:** no hay procedimiento operacional de primer administrador para base nueva de producción ni recuperación administrativa documentada y aplicable a producción. Crear una cuenta sin administrador requeriría acceso directo/operacional a MySQL, pero no está formalizado ni probado. Preparar una herramienta restringida de una sola ejecución, fuera del HTTP público, que apunte a producción solo mediante credenciales explícitas y preflight, rechace si ya existe un administrador, aplique bcrypt y deje evidencia/auditoría; documentar recuperación con control de acceso y pasos de reversión. No introducir credenciales predeterminadas.

### 5.2 Registro y aprobación

El registro requiere nombre, apellidos, documento, correo y contraseña de al menos 8 caracteres; verifica formato simple, duplicados y rol reconocido. El rol realmente almacenado para registro público siempre es `Docente`. La cuenta empieza `pendiente_verificacion`; se guarda hash de token de correo con expiración de 24 horas. Tras confirmar el enlace, pasa a `pendiente`; el login exige `activo`. Administrador/Rector pueden aprobar o rechazar únicamente Docente con correo verificado y estado pendiente. Aprobación actualiza solo estado.

Puntos aún incompletos: `decidePendingTeacher` no registra ID del aprobador ni timestamp dedicado; no hay tabla/registro de auditoría de decisiones. El perfil `docente` no se crea ni se vincula automáticamente cuando se aprueba cuenta, así que el acceso de una cuenta Docente recién aprobada puede no tener asignaciones ni perfil asociado. `POST /api/docentes` crea perfiles, pero la cuenta vinculada mediante `id_usuario` está explícitamente denegada; falta un flujo de vinculación/provisionamiento. `backend/auth.js` tiene función de verificación de correo; la entrega real depende de endpoint HTTPS y secreto configurados. No se comprobó entrega.

El frontend tiene vistas de registro/solicitudes y pruebas estáticas de sus permisos. No existe inicio social operativo conectado. Recuperación por email está implementada en módulos de backend con token hash, expiración de 30 minutos y revocación de sesiones al cambiar contraseña; entrega externa no verificada.

### 5.3 Matriz de permisos observados

La política procede de `backend/authorization.js`; las rutas ejecutan esta comprobación antes de consultar. La columna “alcance de datos” considera además las consultas en `server.js`.

| Acción/recurso | Administrador | Rector | Coordinador | Psicóloga | Docente | Estudiante | Discrepancia/nota |
|---|---:|---:|---:|---:|---:|---:|---|
| Leer/listar usuarios | Sí | Sí | No | No | No | No | `GET /api/usuarios`; incluye estado y datos de contacto. |
| Crear usuario por API | Docente solamente | No | No | No | No | No | Alta privilegiada se niega; requiere vinculación institucional separada. |
| Editar/desactivar usuario | Sí | No | No | No | No | No | PUT impide cambiar rol/estado; DELETE desactiva. |
| Aprobar/rechazar registro | Sí | Sí | No | No | No | No | Solo Docente verificado en estado pendiente; no registra aprobador. |
| Leer docentes | Sí | Sí | Sí | Sí | Solo propio/lista asociada | No | perfiles incluyen `SELECT *`; revisar minimización. |
| Crear/editar/desactivar docentes | Sí | Sí | Sí | No | No | No | `POST /api/docentes` no crea vínculo de usuario. |
| Leer estudiantes | Sí | Sí | Sí | Sí | Solo asignados en lista/detalle | No | GET detalle valida alcance docente en middleware. |
| Crear/editar/desactivar estudiantes | Sí | Sí | Sí | No | No | No | CRUD usa MySQL. |
| Leer PIAR y asignaciones | Sí | Sí | Sí | Sí | Solo asignados | No | alcance aplicado a rutas PIAR. |
| Crear/editar PIAR | Sí | Sí | Sí | Sí | No | No | cierre/eliminación lógica solo Admin/Rector/Coordinador. |
| Gestionar ajustes | Sí | Sí | Sí | Sí | Lectura asignada | No | Docente no escribe ajustes. |
| Leer diagnósticos/seguimientos/observaciones | Sí | Sí | Sí | Sí | Sí | No | **Docente puede consultar registros fuera de sus PIAR por falta de filtro de alcance**. |
| Crear diagnóstico | Sí | No | Sí | Sí | No | No | `Psicóloga` y Coordinador. |
| Editar/eliminar diagnóstico | Sí | Sí | Sí | Sí | No | No | Todas las funciones institucionales; validar alcance y trazabilidad. |
| Crear observación/seguimiento | No | No | Sí | Sí | Sí | No | Psicóloga/Coordinador/Docente. |
| Editar/eliminar observación/seguimiento | No | No | No | No | No | No | Inmutables por política actual. |
| Leer historial/reportes/dashboard | Sí | Sí | Sí | Sí | Sí | No | Listados no filtran por PIAR asignado; alcance excesivo para Docente. |
| Generar/administrar reportes | No | No | No | No | No | No | API observada solo permite GET; generación no hallada. |
| Gestionar catálogo/configuración | Parcial | Parcial | Parcial | Parcial | Parcial | No | Configuración institucional en `localStorage`, no permiso/estado MySQL. |

El rol Estudiante está en constantes de aplicación y es denegado por la matriz para recursos institucionales, pero no se encontró un módulo/API estudiantil de autoservicio implementado.

## 6. Auditoría de seguridad

### Hallazgos confirmados

1. **Alcance insuficiente para Docente (alto):** `server.js` solo comprueba asignación docente para rutas `/api/piar/:id`, `/api/estudiantes/:id` y `/api/docentes/:id`. Las rutas de diagnósticos, observaciones, seguimientos, historial y reportes seleccionan globalmente y `authorization.js` autoriza GET al rol Docente. Puede exponer datos personales y de discapacidad de estudiantes no asignados.
2. **Sin rate limit en login (alto/medio):** `createRateLimiter` solo se aplica a solicitudes de recuperación/verificación. `POST /api/auth/login` no limita IP, correo ni intentos; bcrypt eleva costo, pero no sustituye control anti-fuerza bruta.
3. **No existe comprobación CSRF explícita (medio):** autenticación usa cookie HttpOnly `SameSite=Lax`, CORS permite una lista exacta de orígenes y credenciales. No se observa token CSRF ni comprobación de `Origin`/Fetch Metadata para operaciones mutables. Riesgo residual depende de despliegue, subdominios y uso futuro de métodos/formularios; validar y añadir defensa explícita.
4. **Registro de aprobación incompleto (medio):** endpoint actualiza estado sin persistir quién aprobó/rechazó ni cuándo; no satisface trazabilidad solicitada.
5. **Datos personales por `SELECT *` (medio):** perfil docente y varios registros sensibles devuelven todas las columnas. La minimización y filtrado de alcance deben definirse explícitamente.
6. **Sesiones sin limpieza demostrada (bajo/medio):** sesiones vencidas/revocadas se filtran al autenticar, pero no se observa tarea de purga; las tablas pueden crecer indefinidamente.
7. **Migraciones no verificadas en servidor objetivo (alto operacional):** no se ejecutaron; `001_mvp_core.sql` contiene cambios de tipo, columnas, índices y FK. Se debe revisar contra snapshot de esquema/datos antes de producción.

### Controles positivos observados

- Consultas con parámetros para valores recibidos en rutas principales; identificadores se convierten a número en consultas relevantes.
- Contraseñas nuevas con bcrypt cost 12 y comparación bcrypt.
- Cookie de sesión `HttpOnly; SameSite=Lax; Path=/`, con atributo `Secure` si `NODE_ENV=production`.
- Token de sesión aleatorio, persistido como SHA-256, con expiración y revocación de servidor.
- Verificación y recuperación guardan hashes de token; enlaces de un solo uso, vencimiento y recuperación revoca sesiones.
- Respuestas de solicitud de reset/verificación son genéricas para no revelar existencia de correo.
- Limitador de solicitudes para reset/verificación; cuerpo JSON limitado a 1 MiB; CORS exacto desde `CORS_ORIGIN`.
- Helpers frontend de escape de texto y pruebas que verifican que payload sintético no se convierta en HTML activo.
- Endpoints `/api/data` y `/api/reset` devuelven 410, evitando el reset de datos antiguo.

### Aspectos no verificados

- Secretos reales: se revisaron nombres/configuración sin imprimir valores. Existe `.env.test` y no existe `.env`; su contenido no se copia al informe. No se ejecutó escáner de secretos ni análisis de dependencias (`npm audit`).
- Transporte TLS, cabeceras del proxy, dominios, límites upstream y configuración real Railway.
- Entrega de correo y rotación/almacenamiento de secretos de proveedor.
- Vulnerabilidades conocidas de dependencias; no se consultó registro de red.

## 7. Backend y API

Todas las rutas no públicas, excepto los endpoints expresamente descritos, pasan por `auth.currentUser` y `authorizationStatus`. `/api/health` es público y consulta MySQL. `/api/data` y `/api/reset` siempre responden 410.

| Método/ruta | Propósito/entrada | Auth y rol | Persistencia/respuesta | Prueba y riesgo principal |
|---|---|---|---|---|
| GET `/api/health` | Salud API + `SELECT 1` | Pública | 200 `{status: ok}` o 503 degraded | No prueba de integración en este turno. |
| POST `/api/auth/register` | nombre, apellidos, documento, correo, password, rol | Pública | 202 solicitud; rol forzado Docente | Unidad cubre; falta email real/end-to-end. |
| POST `/api/auth/login` | correo, password | Pública | 200 usuario + cookie | Unidad cubre; sin limitador de intentos. |
| POST `/api/auth/logout`, GET `/api/auth/me` | sesión actual | Cookie | Revoca sesión / devuelve usuario | Unidad cubre sesión; HTTP/MySQL pendiente. |
| POST `/api/auth/email-verification/{request,confirm}` | correo/token | Pública | estado genérico/confirmación | Unidad cubre tokens; entrega externa no verificada. |
| POST `/api/auth/password-reset/{request,confirm}` | correo o token+password | Pública | respuesta genérica/actualización | Unidad cubre; entrega externa no verificada. |
| GET `/api/usuarios[/:id]` | datos usuario | Admin/Rector | JSON de usuarios | Unidad parcial; comprobar minimización. |
| POST `/api/usuarios` | alta de usuario | Admin, pero payload solo Docente | delegado a registro | No crea roles privilegiados. |
| PUT/DELETE `/api/usuarios/:id` | editar/desactivar | Admin | MySQL | Roles/estado denegados en PUT. |
| POST `/api/usuarios/:id/aprobacion` | `decision` aprobar/rechazar | Admin/Rector | estado | Unidad cubre; falta audit trail. |
| CRUD `/api/docentes` | perfiles | lectura institucional; escritura Admin/Rector/Coordinador | MySQL, varias respuestas usan filas completas | Falta vinculación a cuenta; revisar alcance/columnas. |
| CRUD `/api/estudiantes` | ficha y datos PIAR | lectura institucional/Docente asignado; escritura Admin/Rector/Coordinador | MySQL y mapeo JSON | CRUD sensible; validación de payload no uniforme. |
| CRUD `/api/piar`, `/api/piar/:id/docentes`, `/api/piar/:id/ajustes` | PIAR, asignaciones, ajustes | lectura institucional/Docente asignado; escritura según matriz | MySQL | Tests de integración diseñados; no ejecutados aquí. |
| CRUD `/api/diagnosticos` | diagnóstico y relación estudiante/PIAR | lectura institucional/Docente; crear Psicóloga/Coordinador; edición institucional | MySQL | **Lecturas Docente no filtran PIAR asignado**. Validación relación en creación/edición. |
| CRUD `/api/seguimientos`, `/api/observaciones` | notas de seguimiento | lectura institucional/Docente; creación según rol; no edición/borrado | MySQL | **Listados/detalles Docente sin alcance**. |
| GET `/api/historial[/:id]`, `/api/reportes[/:id]` | consultar historial/reportes | institucional, incluye Docente | MySQL | **No limita por PIAR asignado**; no se observa creación de historial/reportes. |
| GET `/api/dashboard/resumen` | agregados globales | institucional, incluye Docente | MySQL | Datos agregados globales; definir si Docente debe verlos. |

Respuestas y códigos no son uniformes entre rutas: algunos handlers usan `{ok,data}`, otros devuelven array/objeto directamente; mutaciones a veces diferencian `unchanged`, otras responden 201. Preservar el contrato existente mientras se crea una matriz de contratos y pruebas.

## 8. Base de datos y persistencia

`000_railway_schema.sql` define al menos: `usuario`, `sesion_usuario`, `verificacion_correo`, `recuperacion_contrasena`, `estudiante`, `docente`, `coordinador`, `psicologa`, `piar`, `piar_docente`, `piar_ajuste`, `diagnostico`, `seguimiento`, `observacion`, `historial`, `historial_detalle`, `reporte`. Se observan PK, unicidad de documento/correo usuario y estudiante, FK e índices para relaciones principales.

`001_mvp_core.sql` crea tablas de recuperación/verificación si faltan, añade columnas condicionalmente, expande roles/columnas, agrega índices y FK. No mantiene una tabla formal de versiones de migración: el SQL reevalúa el esquema mediante `information_schema`. No se verificó re-ejecución contra MySQL, compatibilidad de versión/collation ni datos ya existentes. Hay variantes locales de migración que deben compararse con Railway antes de aplicarse.

**Inconsistencia a resolver (media/alta):** el esquema inicial declara `usuario.rol` como `VARCHAR`, mientras la migración de compatibilidad intenta modificar a ENUM con cinco valores (`Docente`, `Psicóloga`, `Coordinador`, `Administrador`, `Rector`) y omite `Estudiante`, que aparece en `backend/auth.js` y la matriz. Confirmar si el entorno aplica la rama ENUM y si Estudiante es un rol contractual; alinear sin convertir datos inválidos ni cambiar contratos accidentalmente.

Las consultas CRUD observadas usan MySQL; `data/db.json` no aparece conectado. No hay evidencia de transacción para todas las mutaciones compuestas; flujos de registro y creación de registros asociados merecen revisión. `historial`/`historial_detalle` existen pero no vi escritura automática que audite cambios de usuario, PIAR o aprobación. La persistencia tras reinicio no se verificó debido a falta de conexión segura documentada al entorno.

## 9. Frontend y módulos PIAR

| Módulo | Clasificación | Evidencia / limitación |
|---|---|---|
| Login/registro/verificación/reset | Parcial implementado | Formularios y API configurados; entrega externa y navegador real no comprobados. Proveedores externos explícitamente rotulados no disponibles en tests. |
| Usuarios/solicitudes | Parcial implementado | UI de solicitudes pendientes probada estáticamente; alta, edición y aprobación no probadas en DB real. |
| Institución | Presente sin persistencia servidor | `app.js` usa `localStorage`; datos varían por navegador/dispositivo. |
| Docentes/estudiantes | Parcial con API | CRUD y mapeo de estudiantes a esquema MySQL; faltan integración de vinculación de cuenta y alcance uniforme. |
| PIAR/asignaciones/ajustes | Parcial con API | Tablas y rutas existen; prueba HTTP/MySQL pendiente. |
| Diagnósticos | Parcial | Tabla/rutas y validación de relación PIAR-estudiante; exposición docente interinstitucional por scope. |
| Seguimientos/observaciones | Parcial | Tabla/rutas; nota de creación e inmutabilidad en autorización. No comprobado flujo completo de UI. |
| Historial/auditoría | Insuficiente | Consulta de tablas, pero evidencia de escritura/auditoría automática no encontrada. |
| Reportes/PDF | No demostrado | Tabla de reportes y API GET; no hay generación PDF probada ni dependencia PDF declarada en `package.json`. |
| DUA/barreras/apoyos | Parcial | Campos JSON/texto de estudiante y vistas relacionadas, sin verificación end-to-end. |
| Catálogos | Pendiente de inventario operacional | No se observó API genérica de catálogos en rutas de servidor; revisar interfaces y hardcodes con aceptación funcional. |

`public/js/api.js` usa Fetch con credenciales de sesión y `public/js/config.js` define las rutas conocidas. Las pruebas estáticas cubren algunos permisos UI, sanitización y estados de autenticación; no reemplazan navegador/API. Accesibilidad, consola, adaptabilidad y botones no se inspeccionaron visualmente.

## 10. Pruebas ejecutadas y pendientes

### Ejecutadas en esta auditoría

Se ejecutó `node --test` para todos los `tests/*.test.js` excepto `integration.test.js` (54 subpruebas; **54 aprobadas, 0 fallidas**). Incluye pruebas aisladas de auth/registro, authorization, bootstrap mock, verificación de email, config de DB de prueba, migración-validator, OIDC helper, reset de contraseña, rate limit, aprobación, UI y salida segura. No requiere conexión MySQL y usa dobles/fixtures sintéticos.

### No ejecutadas

- `tests/integration.test.js`: exige DB local `piar_test` en puerto 3307, usuario y contraseña interactiva; inspecciona grants, crea fixtures sintéticos y limpia filas al finalizar. No se ejecutó para evitar escrituras sin confirmar el destino y disponibilidad.
- `scripts/run-local-integration-test.js`: no iniciado por la misma razón.
- Pruebas de esquema/migración contra MySQL real, persistencia tras reinicio, roles con sesiones reales.
- Smoke test de `/api/health` y rutas HTTP reales.
- Pruebas de proveedor de correo y recuperación externa.
- Pruebas en navegador y de despliegue Docker/Railway.
- Escaneo de dependencias y secretos.

### Matriz breve de aceptación

| ID | Escenario | Precondición/pasos | Esperado | Observado | Estado |
|---|---|---|---|---|---|
| T-UNIT-01 | Suites aisladas sin integración | `node --test` excluyendo integración | Todas pasan | 54/54 pasaron | Aprobada |
| T-AUTH-01 | Registro no puede asignar Admin | Unit test con payload rol Admin | almacena Docente pendiente | pruebas unitarias cubren el caso | Aprobada en unidad |
| T-BOOT-01 | Bootstrap local guarda hash y destino fijo | conexión mock | bcrypt, target piar_test, transacción | probado con mocks | Aprobada en unidad |
| T-INT-01 | Flujos HTTP + MySQL | iniciar instancia piar_test segura, ejecutor aislado | CRUD, permisos, aprobación y persistencia correctos | No ejecutada | Pendiente |
| T-SCOPE-01 | Docente A consulta datos de PIAR de Docente B | dos fixtures asignados distintos y sesiones reales | 403/404 o listado filtrado | Código actual permite GET global en varias rutas | Fallida por inspección; probar integración tras corrección |
| T-PROD-01 | Primer administrador en entorno de producción | DB nueva Railway controlada | bootstrap auditado y de una sola ejecución | solo script local piar_test | No implementado/verificado |
| T-DEPLOY-01 | Docker/Railway con BD provisionada | ambiente aislado | arranque, migración planificada, health OK | No ejecutada | Pendiente |

## 11. Configuración y despliegue

`package.json` declara `start`, `dev`, `db:migrate:railway`, `db:migrate:mvp`; dependencias directas: `bcryptjs`, `mysql2`, `openid-client`. `Dockerfile` instala dependencias, copia proyecto y ejecuta `npm start`. `.env.example` documenta puerto, variables MySQL y CORS. `backend/config.js` carga `.env` manualmente si está presente.

Puntos de despliegue: el Dockerfile no inicia MySQL ni ejecuta migraciones; el operador debe provisionar BD y aplicar SQL de manera controlada. No hay procedimiento observado de bootstrap admin productivo, rollback de cambios SQL ni healthcheck Docker. `server.js` escucha en `PORT` y sirve frontend del mismo origen. `NODE_ENV=production` activa Secure cookie. No se pudo verificar variables reales Railway, TLS/proxy, dominio permitido por CORS, estado de esquema ni backups.

## 12. Registro priorizado de fallas

| ID | Área | Problema / evidencia | Severidad / certeza | Impacto y causa probable | Corrección propuesta y aceptación | Dependencias / regresión |
|---|---|---|---|---|---|---|
| PIAR-SEC-001 | Seguridad/privacidad | Docente obtiene GET global para diagnóstico, seguimiento, observación, historial y reportes; `authorization.js` autoriza rol y `server.js` no filtra por asignación en esos handlers. | **Alta, confirmado** | Divulgación de datos sensibles de estudiantes de otras asignaciones. Autorización de rol sin autorización por recurso. | Aplicar joins `piar_docente` + `docente.id_usuario` a listas y detalles de cada recurso, incluido dashboard/historial/reportes según política; crear dos docentes y probar cruce de IDs/listados. | server.js, authorization.js, integration.test.js. Riesgo: ocultar resultados que UI espera ver. |
| PIAR-SEC-002 | Usuarios/operación | Bootstrap disponible solo para `piar_test`; no se encontró equivalente operativo para la primera cuenta de Railway. | **Alta, confirmado** | BD nueva sin camino documentado de alta admin o alta manual insegura. | Diseñar comando de operación restringido, explícito, one-shot, preflight entorno, cero secretos impresos, transacción y rechazo si existe Admin; probar con DB descartable y documentar recuperación. | scripts, docs de despliegue y esquema. Riesgo de uso contra DB equivocada. |
| PIAR-SEC-003 | Seguridad | `POST /api/auth/login` no usa rate limiter, a diferencia de reset/verificación. | **Alta, confirmado** | Fuerza bruta y uso de recursos bcrypt. | Añadir límite combinado IP/correo con respuesta 429 y límites configurables; probar umbral, expiración y claves distribuidas; en despliegue multiinstancia preferir almacenamiento compartido. | auth/server/rate-limit; riesgo de bloqueo de usuarios tras NAT. |
| PIAR-SEC-004 | Usuarios/auditoría | Aprobación modifica `usuario.estado` sin guardar aprobador, decisión ni fecha. | **Media, confirmado** | No hay trazabilidad ni investigación de alta/rechazo. | Agregar entidad/campos de auditoría con FK y timestamp, registrar sesión aprobadora en misma transacción; prueba de autor/tiempo/decisión y rechazo no autorizado. | migración, server.js, registration-approval.js. Riesgo de compatibilidad migratoria. |
| PIAR-DB-001 | DB/usuarios | `001_mvp_core.sql` convierte rol a ENUM omitiendo `Estudiante`, aunque auth lista ese rol; esquema base es VARCHAR. | **Media, confirmado en código; efecto depende ambiente** | Migración o datos futuros incompatibles; diferencias entre instalaciones. | Resolver catálogo oficial de roles y alinear esquema, validación y pruebas de migración; probar copia de esquemas desde cero y existente. | SQL, auth.js, authorization.js. Riesgo de datos de rol legado. |
| PIAR-USER-001 | Usuarios | Aprobación de Docente no crea ni vincula perfil `docente`; POST de perfil rechaza explícitamente `id_usuario`. | **Media, confirmado** | Cuenta activa sin perfil/asignaciones y proceso manual no claro. | Definir provisioning aprobado, transaccional e idempotente, sin permitir que solicitante enlace cuenta ajena; prueba de aprobación a perfil y restricción de vinculación. | server.js, migración, UI usuarios. |
| PIAR-API-001 | API | Respuestas CRUD no homogéneas (array directo vs `{ok,data}`, status y `unchanged`). | **Media, confirmado** | Frontend y scripts pueden tratar errores o resultados de forma divergente. | Inventariar contrato vigente y agregar pruebas por ruta; corregir sin romper contrato salvo cambio versionado justificado. | server.js, api.js, tests; regresión UI. |
| PIAR-DATA-001 | Persistencia | Configuración institucional vive en `localStorage`, no servidor/BD. | **Media, confirmado** | No compartida ni respaldada; cambia por navegador. | Confirmar requisito multiusuario; persistir con institución/configuración y permiso en API si corresponde; prueba entre sesiones/usuarios. | app.js, esquema/API; migración futura. |
| PIAR-AUD-001 | Historial | Tablas de auditoría existen, pero no se encontró escritura central para cambios principales. | **Media, probable** | Historial reportado puede estar vacío o incompleto pese a consultas disponibles. | Identificar eventos a auditar y escribirlos en transacción con mutaciones; probar antes/después por entidad. | CRUD y tablas de historial; costo/retención. |
| PIAR-DEP-001 | Despliegue | Sin evidencia de migración, bootstrap, conexión ni Railway operativo; el Dockerfile solo arranca la app. | **Alta, no verificable** | Despliegue puede iniciar con esquema faltante y fallar al usar rutas. | Ejecutar plan en staging aislado, validar esquema y health, respaldar, definir rollback y smoke tests antes de producción. | Infraestructura/credenciales externas; evitar impacto en producción. |
| PIAR-SEC-005 | Seguridad | CSRF explícito no hallado para endpoints con cookie de sesión. | **Media, probable** | Operación inducida en navegadores bajo condiciones compatibles con SameSite/origen. | Verificar amenazas del dominio y añadir token u Origin/Fetch Metadata para mutaciones; prueba cross-origin. | server.js, api.js, CORS. |
| PIAR-PIAR-001 | Módulos | Reporte PDF/generación y OIDC no conectados a rutas verificables. | **Baja/media, confirmado respecto a API observada** | Expectativa de función sin flujo utilizable. | Marcar pendiente o completar servicio/rutas/end-to-end; evitar mostrar botón como activo. | oidc.js, app, dependencias; contratos externos. |

## 13. Plan ordenado para Claude

### Fase 1 — Cerrar límites de autorización (P0)

- Archivos: `backend/server.js`, `backend/authorization.js`, `tests/integration.test.js`, `tests/authorization.test.js`.
- Filtrar listados y detalles sensibles Docente por asignación PIAR activa. Revisar historial, reportes y dashboard con la misma política. Agregar pruebas negativas entre dos docentes y lecturas de identificadores ajenos.
- Añadir limitación de intentos a login con límites claros, respuesta uniforme y pruebas.
- Criterio: un Docente solo ve registros de PIAR asignados; resto mantiene contratos actuales; login se limita según política documentada.

### Fase 2 — Ciclo de vida de cuenta y auditoría (P0/P1)

- Diseñar bootstrap de primera cuenta productiva fuera del HTTP público y documentar recuperación. Reutilizar validaciones del script local, pero no redirigirlo accidentalmente a producción.
- Registrar aprobador, decisión y timestamp. Crear vínculo de perfil docente con procedimiento autorizado e idempotente.
- Criterio: BD vacía obtiene primer administrador de forma controlada; registro público no eleva privilegios; aprobación deja trazabilidad y cuenta utilizable.

### Fase 3 — Esquema y migración (P1)

- Comparar `000`, `001` y migraciones `local/` con esquema real de staging. Alinear el catálogo de roles y la diferencia VARCHAR/ENUM.
- Validar preflight, unicidad, llaves foráneas y tipos con base nueva y copia compatible de existente. Registrar versión de migración y preparar reversión/back-up antes de producción.
- No aplicar cambios antes de revisar datos heredados.

### Fase 4 — API y persistencia PIAR (P1)

- Documentar método, entrada, respuesta, códigos y roles por ruta. Preservar formatos usados por frontend o versionar cambios.
- Verificar transacciones para mutaciones compuestas; probar integridad estudiante-PIAR y relaciones de observación/diagnóstico/seguimiento.
- Acordar persistencia institucional compartida en lugar de `localStorage`, si requisito funcional lo confirma.

### Fase 5 — Funcionalidad y frontend (P1/P2)

- Recorrer módulos en navegador con estados HTTP error, expiración y carga. Confirmar alta/vinculación docente, PIAR, DUA, ajustes, seguimientos y reportes.
- Aclarar si reporte PDF/OIDC son parte del alcance; completar end-to-end o representarlos claramente como pendientes.

### Fase 6 — Verificación integral y despliegue (P0 antes de producción)

- Ejecutar integración únicamente contra `piar_test` descartable y grants limitados. Validar persistencia después de reiniciar servidor y suites de autorización.
- Revisar dependencias/secrets con herramientas aprobadas, variables sin imprimir, TLS/CORS, logs, backups, migración y rollback en staging.
- Criterio final: suites limpias, esquema verificado, alcance por recurso probado, bootstrap/recuperación documentados, despliegue staging comprobado y lista de aceptación firmada.

## 14. Riesgos pendientes y límites de verificación

- No se tuvo conexión confirmada a instancia local MySQL de pruebas ni a DB de Railway.
- No se inspeccionaron datos reales ni se ejecutaron migraciones.
- No se probó de forma interactiva la UI ni se inspeccionó consola del navegador.
- No se probaron correo, reset de extremo a extremo, proveedores externos, TLS o despliegue.
- No se ejecutó `npm audit` ni escaneo formal de secretos.
- Los informes previos presentes bajo `docs/auditoria-local/` y `docs/seguridad/` son documentación de referencia; este informe basa las afirmaciones en archivos vigentes observados y las pruebas aquí ejecutadas.

## 15. Lista de cierre del proyecto

- [ ] Filtros de alcance de Docente comprobados en todas las lecturas sensibles.
- [ ] Login con mitigación de fuerza bruta probada.
- [ ] Bootstrap y recuperación del primer Administrador seguros y aplicables al ambiente objetivo.
- [ ] Aprobación registra autor, decisión y fecha; cuenta Docente recibe perfil vinculado por flujo autorizado.
- [ ] Roles coinciden entre UI, backend y esquema de BD.
- [ ] Migraciones ensayadas en instalación nueva y copia de esquema existente.
- [ ] CRUD y relaciones PIAR verificados con MySQL de prueba y reinicio de servidor.
- [ ] Respuestas API y manejo de sesión expirada comprobados contra UI.
- [ ] Persistencia de configuración institucional definida y respaldable.
- [ ] Historial refleja mutaciones que el producto promete auditar.
- [ ] Reportes/PDF y OIDC implementados y probados o declarados fuera de alcance.
- [ ] Integración HTTP, regresión de permisos y pruebas de migración aprobadas.
- [ ] Variables, TLS, CORS, logs, backups, migración y rollback verificados en staging.
- [ ] No hay secretos en repositorio ni salida de logs; análisis de dependencias revisado.
- [ ] Producción recibe respaldo, migración controlada, bootstrap único y smoke test.

## Recomendación inmediata

La primera corrección debe ser **PIAR-SEC-001: imponer autorización por asignación en las lecturas de diagnóstico, seguimiento, observación, historial, reporte y dashboard**. Afecta información especialmente sensible de estudiantes y actualmente el permiso por rol permite consultas globales para Docentes. Añadir pruebas cruzadas de dos docentes antes de avanzar con despliegue.
