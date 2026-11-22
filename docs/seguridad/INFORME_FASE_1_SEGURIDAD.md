# Informe técnico — endurecimiento de seguridad Fase 1

> **Registro histórico de la fase inicial.** Algunas observaciones sobre configuración, archivos de despliegue o funcionalidades corresponden a la fecha del informe y fueron corregidas después. El estado actual está en `../VALIDACION_FINAL.md` y `../MANUAL_TECNICO_PIAR.md`. Se conserva este informe como evidencia; no usar las referencias de despliegue piloto como instrucciones actuales.

## Alcance y estado

### Actualización de aprobación institucional — 21 de octubre de 2026

La matriz y las secciones históricas de este informe describen la regla previa que incluía Rector. PIAR se configura actualmente para una institución central, Colegio Reinaldo Matiz; no se requiere estructura multinstitucional. La implementación vigente restringe la consulta y decisión de solicitudes a Administrador porque no existe un procedimiento aprobado para validar la identidad y autorización de una persona Rector ni para aprovisionar ese rol. La interfaz refleja la misma restricción. Coordinador, Psicóloga y Docente tampoco pueden aprobar. Antes de habilitar a Rector debe definirse y probarse el proceso de verificación y provisión de rol; el nombre configurado no verifica a una persona.

Se aplicaron cambios locales para cerrar consultas anónimas, exigir sesión antes de hidratar la aplicación, agregar controles RBAC y retirar la persistencia institucional heredada en JSON. Este endurecimiento tiene alcance limitado; no acredita que el sistema esté completamente seguro.

- Rama: `security/fase-1-hardening`
- Commit base: `27a87f8` (`configura migracion de base de datos para Railway`)
- Estado final esperado: cambios locales sin commit.
- No se ejecutaron migraciones, no se accedió a MySQL, Railway ni a servicios productivos, y no se modificaron variables de entorno.

## Archivos inspeccionados

`backend/server.js`, `backend/auth.js`, `backend/db.js`, `public/js/app.js`, `public/js/api.js`, `public/js/config.js`, `public/js/data.js`, `public/index.html`, `package.json` y los esquemas de `database/migrations/000_railway_schema.sql` y `001_mvp_core.sql`.

## Hallazgos confirmados

1. `GET /api/estudiantes` y `GET /api/estudiantes/:id` no exigían sesión.
2. `GET /api/data`, `PUT /api/data` y `POST /api/reset` eran públicos. La lectura agregada consultaba MySQL, mientras que las escrituras usaban `data/db.json`; el reset cargaba la semilla estática.
3. El registro público fijaba el rol Docente, pero activaba la cuenta y creaba una sesión de inmediato.
4. Varias rutas exigían una sesión, pero no aplicaban permisos por rol ni alcance del registro. Docentes podían consultar listados institucionales y varias rutas permitían edición o borrado genérico.
5. El frontend leía primero `/api/data`, guardaba todo el estado institucional en `localStorage` y lo recuperaba si la API fallaba. También podía sustituirlo por `APP_DATA` y confirmar un reset fallido como exitoso.
6. `public/js/data.js` contenía campos de acceso y registros con información personal y de salud. Se retiraron del árbol público sin replicarlos en otro archivo. Si algún acceso incluido allí fue real, debe rotarse por el procedimiento seguro de la institución; este cambio no lo utiliza ni modifica. El historial Git anterior también puede conservar el contenido y requiere una revisión separada si el repositorio fue compartido.

## Cambios implementados

### Sesión y frontend

- La SPA consulta `/api/auth/me` antes de pedir estudiantes, docentes o PIAR.
- Sin sesión, limpia las claves heredadas con datos de negocio y muestra el formulario de acceso. Ante errores de red/servidor muestra indisponibilidad y reintento, sin cargar datos institucionales desde caché o semilla.
- El cliente conserva el código HTTP en los errores. Un 401 de una ruta protegida limpia el estado visible y vuelve al acceso; un 403 no se presenta como sesión expirada.
- La sesión se vuelve a validar cada cinco minutos y al regresar a la pestaña. Si no se puede verificar, se oculta el estado institucional hasta reintentar.
- El cierre de sesión limpia el estado en memoria y las claves antiguas de estado completo. `localStorage` conserva únicamente una configuración de presentación no sensible del navegador; no es fuente de datos institucionales.
- La solicitud pública crea una cuenta Docente en estado `pendiente`, devuelve 202 y no crea sesión. La interfaz informa que debe esperar aprobación.
- Se retiraron del frontend las llamadas y controles para guardar estado completo, descargar un respaldo JSON y restaurar semillas. Los cambios de la pantalla de configuración ahora se guardan solo como preferencias locales del navegador, con mensaje explícito.

### Backend y rutas

- Todas las rutas API, salvo health, login, registro pendiente, logout y OPTIONS, requieren sesión. Las rutas institucionales anónimas responden 401.
- `/api/data` y `/api/reset` están retiradas en todos los entornos y responden 410. Se eliminaron sus manejadores JSON y la lectura de semilla desde el backend.
- Se aplican respuestas 403 para roles autenticados sin permiso y para docentes fuera de su alcance. El rol Estudiante está registrado en la lista de roles admitidos, pero recibe 403 en toda ruta institucional.
- Docentes consultan sus PIAR asignados, sus estudiantes asociados y los registros relacionados con esos PIAR. La creación docente de observaciones/seguimientos requiere un PIAR asignado; la atribución de observaciones toma el perfil docente enlazado en `docente.id_usuario`.
- Se agregó `POST /api/usuarios/:id/aprobacion`, limitado a Administrador/Rector, que activa o rechaza solicitudes pendientes de rol Docente. Los cambios directos de rol/estado por edición quedaron bloqueados.
- El health público solo informa estado general y no revela conectividad de base de datos.

## Matriz aplicada

| Módulo / operación | Administrador | Rector | Coordinador | Psicóloga | Docente asignado | Estudiante |
|---|---|---|---|---|---|---|
| Consultar estudiantes, docentes, PIAR, diagnósticos, observaciones, seguimientos | Todos los institucionales | Todos los institucionales | Todos los institucionales | Todos los institucionales | Solo estudiantes/PIAR asignados y datos vinculados | Denegado |
| Historial, reportes y resumen institucional | Consulta institucional | Consulta institucional | Consulta institucional | Consulta institucional | Denegado hasta confirmar alcance de reportes/historial | Denegado |
| Crear / modificar contenido PIAR | Sí | Sí | Sí | Sí | Denegado | Denegado |
| Cerrar PIAR | Sí | Sí | Sí | Denegado | Denegado | Denegado |
| Asignar docentes a PIAR | Sí | Sí | Sí | Denegado | Denegado | Denegado |
| Crear diagnósticos | Denegado | Denegado | Sí | Sí | Denegado | Denegado |
| Modificar / eliminar diagnósticos existentes | Sí | Sí | Sí | Sí | Denegado | Denegado |
| Crear observaciones / seguimientos | Denegado | Denegado | Sí | Sí | Sí, solo en PIAR asignado | Denegado |
| Editar / eliminar observaciones y seguimientos | Denegado (inmutables) | Denegado | Denegado | Denegado | Denegado | Denegado |
| Crear corrección enlazada a nota | No disponible: falta relación en esquema | No disponible | No disponible | No disponible | No disponible | No disponible |
| Crear / modificar / desactivar estudiantes o perfiles docentes | Sí | Sí | Sí | Denegado | Denegado | Denegado |
| Solicitudes públicas pendientes | Aprobar / rechazar | Aprobar / rechazar | Denegado | Denegado | Denegado | Denegado |
| Restaurar respaldo MySQL | Aprobado en principio; ruta no implementada | Denegado | Denegado | Denegado | Denegado | Denegado |

**Permisos ya presentes antes de esta fase:** sesión/cookie de servidor, consulta de usuarios restringida a Administrador/Rector, edición/desactivación de usuarios solo por Administrador y relación `docente.id_usuario` más `piar_docente`. No se consideraban suficientes para el alcance aprobado.

## Diferencias frente a decisiones aprobadas y límites

- La política actual limita la creación de diagnósticos a Coordinador/Psicóloga y permite su modificación/eliminación a Administrador, Rector, Coordinador y Psicóloga. Observaciones y seguimientos permanecen inmutables.
- La administración de estudiantes y perfiles docentes (crear, modificar y desactivar) corresponde a Administrador, Rector y Coordinador. Esto no autoriza aprovisionar cuentas sensibles ni vincular/desvincular cuentas de docente: el API de perfiles rechaza `id_usuario` y conserva la relación existente; falta definir el flujo de vinculación.
- El frontend ofrecía datos de demostración con información personal/sensible y mostraba respaldo local; se eliminó esa dependencia. El contenido público de `data.js` ahora contiene solo configuración vacía no sensible y catálogos vacíos.
- El esquema actual solo enlaza cuentas con perfiles Docente mediante `docente.id_usuario`. No hay vínculo de cuenta para perfiles Coordinador, Psicóloga o Estudiante ni relación para correcciones de observaciones/seguimientos. No se hizo migración ni se inventó un vínculo alternativo. La creación por API de roles que requieren vínculo quedó bloqueada; falta diseñar y aprobar el mecanismo institucional y su cambio de esquema antes de aprovisionarlos. Las cuentas ya existentes con rol Coordinador o Psicóloga conservan sus permisos definidos por rol y no pueden comprobarse contra un perfil con el esquema actual; se debe reconciliar esa población antes de activar estos cambios en un ambiente compartido.
- La aprobación/rechazo está disponible como endpoint, pero no se añadió una pantalla de administración de solicitudes. El esquema admite el estado `pendiente`; la ruta solo acepta solicitudes públicas Docente.
- La SPA muestra controles para crear y editar estudiantes/perfiles docentes solo a Administrador, Rector y Coordinador. El backend RBAC sigue siendo la autoridad y rechaza las operaciones para los demás roles.
- Se bloqueó la creación de cuentas con roles sensibles mediante el endpoint general de usuarios y los cambios directos de rol/estado; aún hace falta el procedimiento institucional aprobado para proteger cuentas Administrador y aprovisionar Rector, Coordinador, Psicóloga y Estudiante.

## Rutas y controles principales

| Rutas | Control aplicado |
|---|---|
| `GET /api/health` | Público; estado genérico |
| `POST /api/auth/login`, `POST /api/auth/register` | Públicas; login solo activa; registro crea solicitud pendiente sin cookie de sesión |
| `POST /api/auth/logout`, `GET /api/auth/me` | Logout revoca; `me` valida sesión y responde 401 sin ella |
| `/api/data`, `/api/reset` | Retiradas; 410, sin lectura/escritura JSON |
| `/api/estudiantes` y detalle; `POST/PUT/DELETE` | Lectura institucional A/R/C/P o estudiantes vinculados a PIAR asignado por Docente; alta, edición y desactivación A/R/C; resto 403 |
| `/api/docentes` y detalle; `POST/PUT/DELETE` | Lectura institucional A/R/C/P, Docente solo su propio perfil; administración de perfiles A/R/C; `id_usuario` se rechaza para separar la vinculación de cuentas |
| `/api/piar`, detalle y ajustes | Sesión y alcance; lectura institucional o PIAR asignado; creación/edición A/R/C/P; cierre A/R/C; asignación A/R/C |
| `/api/diagnosticos` | Lectura institucional o datos de PIAR asignado; creación C/P; actualización/borrado A/R/C/P |
| `/api/observaciones`, `/api/seguimientos` | Lectura institucional o registros de PIAR asignado; creación C/P y Docente asignado; PUT/DELETE denegados |
| `/api/historial`, `/api/reportes`, `/api/dashboard/resumen` | Solo consulta institucional A/R/C/P; Docente denegado mientras no se apruebe el detalle de alcance |
| `/api/usuarios` | Consulta A/R; aprovisionamiento/edición/desactivación Administrador; aprobación/rechazo de solicitudes A/R; cambio directo de rol/estado denegado |

## Pruebas realizadas

- `node --check` en `backend/server.js`, `backend/auth.js`, `public/js/app.js`, `public/js/api.js`, `public/js/config.js` y `public/js/data.js`: **PASS**.
- `git diff --check`: **PASS** (solo advertencias de conversión CRLF de Git para algunos archivos).
- Prueba aislada de `auth.register` con DB simulada en memoria: **PASS**; el registro público queda pendiente, no crea sesión y login rechaza la cuenta pendiente. No se conectó a MySQL.
- Prueba aislada del cliente API con respuestas simuladas: **PASS**; preserva 401/403 y el callback de expiración solo se activa para 401 de rutas protegidas.
- Escaneo de archivos públicos JS/HTML/JSON buscando direcciones de correo y marcadores de credenciales: **PASS** en la versión de trabajo.
- No existe script de tests en `package.json`. No se levantó el servidor ni se ejecutaron pruebas CRUD/RBAC integradas porque `backend/server.js` inicia el pool MySQL al ejecutarse y no se pudo demostrar de forma segura que la configuración local apuntara a una base aislada. No se modificó ninguna base de datos.

### Pruebas de aceptación pendientes en entorno aislado

| Caso | Resultado esperado |
|---|---|
| Anónimo: GET estudiantes/PIAR; POST observación; PUT estudiante/PIAR | 401 |
| Anónimo: GET/PUT `/api/data`, POST `/api/reset` | 410, sin consultar ni escribir datos |
| Sesión expirada/invalidada en `/api/auth/me` o ruta protegida | 401; SPA limpia datos en memoria y no recupera caché; acceso/reintento |
| Usuario autenticado sin permiso; cualquier endpoint institucional como Estudiante | 403 |
| A/R/C/P consulta recursos institucionales | 200 |
| Docente consulta PIAR/estudiante asignados y datos relacionados | 200 |
| Docente cambia ID por un PIAR/estudiante no asignado; consulta docentes ajenos | 403 |
| Coordinador/Psicóloga crea diagnóstico; Docente/Admin/Rector intenta | C/P: 201; demás: 403 |
| Docente asignado/C/P crea observación o seguimiento; Docente no asignado intenta | Permitido en alcance; fuera de alcance: 403 |
| PUT/DELETE observación o seguimiento; actualizar diagnóstico mientras no se defina el permiso | 403 |
| A/R/C cierra PIAR/asigna docente; Psicóloga o Docente intenta | A/R/C: permitido; demás: 403 |
| Error de red durante arranque/revalidación y fallo al guardar ajustes de navegador | No muestra datos de demostración ni confirma guardado; permite reintentar |
| Solicitud de registro pública seguida de login antes de aprobación | 202 sin cookie; login 401 hasta que A/R apruebe |

La ejecución de estos casos requiere un MySQL local desechable con el esquema de prueba y cuentas/datos sintéticos. No se ejecutaron contra la configuración actual para evitar cualquier conexión accidental a producción.

## Riesgos abiertos y dependencias

1. Antes de activar en otro ambiente, se requiere una base de pruebas aislada para verificar 401/403, alcance Docente, flujos de aprobación y todas las operaciones CRUD con datos ficticios.
2. Debe diseñarse la relación segura usuario-perfil para Coordinador, Psicóloga y Estudiante, incluyendo unicidad, validación y operación de vinculación. El esquema actual impide demostrar esa asociación.
3. Deben definirse campos visibles para Estudiante y quién vincula su perfil; mientras tanto recibe 403.
4. La administracion de estudiantes/perfiles docentes (A/R/C) y edicion/eliminacion de diagnosticos (A/R/C/P) esta aprobada y codificada; faltan pruebas CRUD integradas en MySQL aislado.
5. Debe acordarse alcance de reportes/historial para Docente y diseñar entidad/campos de correcciones inmutables enlazadas. Ninguna corrección se implementa sin relación de datos.
6. Deben aprobarse salvaguardas de creación, aprobación, recuperación y desactivación de cuentas Administrador/Rector.
7. La UI administrativa de aprobación y los controles de rol por pantalla son trabajo pendiente; las rutas de backend aplican la autorización independientemente de la UI.

## Actualización de interfaz y acceso de demostración

La pantalla `Solicitudes de registro` fue añadida al menú solo para Administrador y Rector. Usa el GET existente `/api/usuarios` y el POST existente `/api/usuarios/:id/aprobacion`; no introduce rutas nuevas. La interfaz muestra solicitudes Docente pendientes de verificar y de aprobar. Solo ofrece aprobar/rechazar cuando el estado ya es `pendiente` (correo verificado); el backend conserva la autorización como control final.

Se añadió `scripts/create-local-demo-accounts.js` para crear, únicamente en `127.0.0.1:3307/piar_test`, una cuenta sintética de Docente con perfil vinculado. El script requiere opt-in y confirmación literal, correo `example.invalid`, documento con prefijo `DEMO-`, contraseña de al menos 14 caracteres solicitada sin eco, bcrypt y transacción; valida usuario/base/puerto/estado de solo lectura y esquema antes de escribir. No crea Administradores ni modifica `.env`.

Para usarlo manualmente en la terminal PowerShell de VS Code, confirma primero que la instancia Docker local y las tablas de `piar_test` corresponden a pruebas. Define únicamente los valores ficticios de Docente para esta ejecución, por ejemplo:

```powershell
$env:PIAR_ALLOW_LOCAL_DEMO_SEED = '1'
$env:DEMO_TEACHER_NAME = 'Docente'
$env:DEMO_TEACHER_LAST_NAME = 'Demo'
$env:DEMO_TEACHER_DOCUMENT = 'DEMO-TEACHER-001'
$env:DEMO_TEACHER_EMAIL = 'teacher-demo@example.invalid'
node scripts/create-local-demo-accounts.js
```

El programa mostrará el destino fijado, solicitará escribir `CREAR CUENTA DOCENTE DEMO EN piar_test` y luego pedirá la contraseña de base y una contraseña nueva en entrada oculta. No escribe ni imprime esos secretos. Al terminar, elimina de la sesión de PowerShell las variables sintéticas con `Remove-Item Env:PIAR_ALLOW_LOCAL_DEMO_SEED, Env:DEMO_TEACHER_NAME, Env:DEMO_TEACHER_LAST_NAME, Env:DEMO_TEACHER_DOCUMENT, Env:DEMO_TEACHER_EMAIL`. El Administrador principal usa el bootstrap local separado y sus propias protecciones; este informe no recomienda usar cuentas de pruebas retenidas como identidad principal. El script no se ejecutó durante esta revisión.
8. La eliminación de datos sensibles del archivo no elimina el contenido de commits anteriores. El propietario debe valorar rotación de cualquier credencial posiblemente real y saneamiento de historial con un procedimiento separado.
9. La pantalla de configuración dejó de pretender guardar ajustes en MySQL: esos campos son preferencia local del navegador. Si deben ser parámetros institucionales compartidos, hace falta definir un recurso backend autorizado.
10. Un despliegue futuro requerirá actualizar los archivos estáticos juntos y considerar cachés de navegador/CDN; los clientes antiguos que sigan llamando endpoints retirados recibirán 410.

## Archivos modificados

- `backend/auth.js`: rol Estudiante reconocido; alta pública pendiente y sin sesión.
- `backend/server.js`: controles de sesión/RBAC/alcance, aprobaciones de solicitudes, rutas heredadas retiradas e inmutabilidad de notas.
- `backend/authorization.js`: política RBAC centralizada para diagnósticos y administración de estudiantes/perfiles docentes.
- `public/js/app.js`: acciones visibles según rol y validaciones visuales redundantes; el backend sigue siendo autoridad.
- `tests/authorization.test.js`: pruebas unitarias RBAC sin conexión a base de datos.

## Corrección de permisos — 2026-09-29

Esta sección sustituye las filas y afirmaciones anteriores de esta auditoría que indicaban que estos permisos estaban pendientes o denegados:

| Operación | Administrador | Rector | Coordinador | Psicóloga | Docente asignado | Estudiante |
|---|---|---|---|---|---|---|
| Crear diagnóstico | Denegado | Denegado | Permitido | Permitido | Denegado | Denegado |
| Modificar/eliminar diagnóstico existente | Permitido | Permitido | Permitido | Permitido | Denegado | Denegado |
| Crear/modificar/desactivar estudiantes | Permitido | Permitido | Permitido | Denegado | Denegado | Denegado |
| Crear/modificar/desactivar perfiles docentes | Permitido | Permitido | Permitido | Denegado | Denegado | Denegado |

La política backend se aplica a `POST/PUT/DELETE /api/diagnosticos[/:id]`, `/api/estudiantes[/:id]` y `/api/docentes[/:id]`. Los DELETE de estudiantes y docentes realizan desactivación lógica. Administrar un perfil docente no permite enlazar o cambiar una cuenta: `id_usuario` se rechaza en POST/PUT. Las comprobaciones de Docente requieren cuenta enlazada, asignación de PIAR y perfil activo.

Pruebas ejecutadas en esta corrección: `node --test tests/authorization.test.js` (**4/4 PASS**); `node --check backend/authorization.js`, `backend/server.js`, `public/js/app.js` y `git diff --check` (**PASS**). No se conectó servidor ni MySQL. Pendientes de entorno aislado: consultas SQL de alcance docente, persistencia CRUD real, estados inexistentes y comprobaciones de integración frontend-backend.
- `public/js/app.js`: sesión antes de datos, limpieza al expirar/cerrar, revalidación, registro pendiente y retiro de persistencia/restauración local de estado completo.
- `public/js/api.js`: cliente API sin adaptador/caché de datos local; estado HTTP y manejo de expiración.
- `public/js/config.js`: eliminadas rutas de `data` y `reset`.
- `public/js/data.js`: retirados accesos y registros personales/sensibles del recurso público.
- `docs/seguridad/INFORME_FASE_1_SEGURIDAD.md`: este informe.

## Revisión adicional de Fase 1 — 2026-10-02

Se inspeccionó la rama `security/fase-1-hardening`, el estado de trabajo y el commit base `27a87f8`. Los cambios locales preexistentes se conservaron.

- `POST /api/piar/:id/docentes` valida ID positivo, existencia del PIAR y perfil docente activo; rechaza duplicados con 409 y efectúa comprobación/inserción en transacción. Respuestas de validación no exponen SQL.
- La modificación de diagnósticos añade el ID de ruta a la validación. Si se envía solo estudiante o PIAR, completa el otro desde el diagnóstico persistido y valida la relación; ID inválido/inexistente se devuelve como error controlado. El `UPDATE` y `DELETE` de diagnósticos distinguen inexistencia mediante `affectedRows` y consulta segura.
- Se escaparon valores externos en tarjetas de estudiantes/docentes/PIAR y en el reporte; el mensaje de error de inicio y los avisos se insertan como texto.

**Pendiente: esta revisión no cierra completamente los hallazgos 3 y 4.** No se aplicó comprobación de `affectedRows` a todas las rutas de actualización, desactivación, cierre, retiro/asignación y eliminación de ajustes; tampoco se verificaron todas las interpolaciones de datos no confiables en detalles, modales, opciones y componentes de observación/diagnóstico. Esos puntos no deben considerarse corregidos y requieren continuación antes de declarar Fase 1 cerrada. La prueba disponible `tests/authorization.test.js` cubre permisos, no la persistencia SQL nueva; no se ejecutaron pruebas de integración ni se conectó MySQL.

Verificación local de esta revisión: `node --check backend/server.js`, `node --check public/js/app.js`, `node --test tests/authorization.test.js` (4/4) y `git diff --check` pasaron. `git diff --check` reportó únicamente advertencias normales de conversión CRLF.

## Cierre de pendientes `affectedRows` y HTML dinámico — 2026-10-02

### Resultados de mutaciones

Se agregó `backend/mutation-result.js` como clasificador sin dependencias de la base de datos. `mutationOutcome` consulta existencia con SQL parametrizado cuando `affectedRows` es cero: el resultado es `changed`, `unchanged` o `not_found`. Los endpoints de edición responden 200 con `unchanged: true` para registro existente sin cambios y 404 si falta. Desactivación/cierre informan el estado existente; borrados responden 404 cuando no borraron una fila.

| Operación | Control implementado |
|---|---|
| Aprobar/rechazar solicitud docente | Solo actualiza solicitud pendiente Docente; cero filas devuelve 404 (no hay solicitud pendiente aplicable). |
| Actualizar/desactivar usuario | `affectedRows` + consulta de existencia; distingue no encontrado y sin cambios. |
| Actualizar/desactivar docente | `affectedRows` + consulta de existencia; distingue no encontrado y sin cambios. |
| Actualizar/desactivar estudiante | `affectedRows` + consulta de existencia; distingue no encontrado y sin cambios. |
| Editar/cerrar PIAR | `affectedRows` + existencia; PIAR cerrado existente devuelve respuesta sin cambios. |
| Asignar docente a PIAR | Validación transaccional anterior conservada; verifica `affectedRows === 1` del INSERT antes de confirmar. |
| Retirar docente de PIAR | Valida ID y exige fila eliminada; inexistencia devuelve 404. |
| Editar/eliminar ajuste PIAR | Actualización distingue cambiado/sin cambios/inexistente; DELETE sin fila devuelve 404. |
| Actualizar/eliminar diagnóstico, seguimiento u observación | UPDATE distingue cambiado/sin cambios/inexistente; DELETE sin fila devuelve 404. |

Los INSERT restantes de creación de PIAR y ajustes siguen basándose en el resultado de inserción/`insertId`; no son actualizaciones o eliminaciones de registros existentes. No se ejecutó SQL en este trabajo.

### Inventario HTML dinámico

Inventario estático de sinks en `public/js`: `innerHTML` en estados de inicio/login, shell de la aplicación y vistas, renderizado de reporte/tarjetas y modales; `insertAdjacentHTML` para crear el modal. No se encontraron `outerHTML`, `document.write`, `createContextualFragment`, `.html()` de jQuery, `eval` ni `new Function` en los JS públicos inspeccionados.

Se añadió `public/js/security.js` con escape HTML para texto, contenido de textarea, valores de atributos entre comillas y texto de opciones. Se cargó antes de `app.js`. Se verificó su uso en datos provenientes de estudiantes/docentes, diagnósticos, PIAR, ajustes, observaciones/notas, preferencias institucionales, nombre/rol de sesión y mensajes de error del cliente: tarjetas, tablas, perfiles, reportes, formularios, selectores y modal. `showToastMessage` ahora crea un nodo de texto; el error de inicio también se coloca con `textContent`. Los atributos con ID de callbacks se limitan a números; la clase de estado se restringe a estados conocidos y el ancho de progreso se fuerza a número. Los enlaces `href="#"`, callbacks e iconos restantes usan constantes internas; el HTML fijo de estructura no interpola contenido externo.

Se agregaron pruebas unitarias para la tabla de resultados de mutación y el escape de caracteres HTML/atributos. La prueba de escape es unitaria; no reemplaza una prueba de navegador/renderizado con payloads hostiles. Sigue pendiente QA visual de las vistas y prueba dinámica de cada formulario/modal en un navegador con datos sintéticos, así como integración CRUD con MySQL local desechable. Ninguna de esas pruebas requiere o utilizó una base productiva.

### Cambios y pruebas

Archivos modificados en esta continuación: `backend/server.js`, `backend/mutation-result.js`, `public/index.html`, `public/js/app.js`, `public/js/security.js`, `tests/security-output.test.js` y este informe. Pruebas: `node --check` para JS modificado, `node --test` (**6/6 PASS**) y `git diff --check` (**PASS**, con advertencias CRLF de Git). `tests/authorization.test.js` permanece pasando dentro de la suite. La prueba no se conectó a MySQL.

Pendientes reales: QA de navegador para confirmar representación y ausencia de regresiones visuales; pruebas de integración CRUD con MySQL local aislado. No hay un bloque HTML identificado en la revisión de código que permanezca interpolando valores externos sin escape contextual; la confirmación de runtime en navegador queda pendiente.

No se modificaron `main`, dependencias, migraciones, `data/db.json`, variables de entorno ni archivos de configuración productiva. No se hizo commit, push ni despliegue.

## Validación posterior y preparación de pruebas — 2026-10-02

### Etapa 1: seguridad y funcionamiento del frontend

Reinventario estático de sinks: `public/js/app.js` usa `innerHTML` para la pantalla de inicio/login, shell, vistas, reporte, tarjetas y modales; `insertAdjacentHTML` crea el modal. No se hallaron `outerHTML`, `document.write`, `createContextualFragment`, jQuery `.html()`, `eval` ni `new Function` en `public/js`/HTML público. Revisión de valores: datos de estudiantes/docentes/PIAR/diagnósticos/ajustes/observaciones/notas y preferencias van a nodos HTML escapados; los errores visibles van a `textContent`/nodo de texto; atributos `value` y `option` se escapan; IDs de callbacks se convierten a número, clase de estado se limita a allowlist y ancho de progreso se fuerza a número. Las plantillas HTML restantes insertan estructura local y subplantillas construidas internamente. No se encontraron URLs dinámicas ni enlaces con destino externo derivado de registros.

Casos sintéticos agregados a `tests/security-output.test.js` y ejecutados contra `escapeHTML`:

| Campo simulado | Entrada | Resultado unitario esperado |
|---|---|---|
| Nombre | `Ana <img src=x onerror=alert(1)>` | Etiqueta y delimitador codificados como texto. |
| Observación | `Nota <svg onload=alert(2)>` | Etiqueta codificada como texto. |
| Diagnóstico/atributo | `"><script>alert(3)</script>` | Comillas y etiquetas codificadas. |
| Texto general | `<img src=x onerror='alert(1)'>&"` | `& < > " '` codificados. |

Estas son pruebas unitarias del escape, **no** pruebas de DOM: no prueban ejecución/no ejecución del navegador, layout, formularios ni modales. No se ejecutó browser QA. No hay `playwright`, `puppeteer`, `jsdom` o `happy-dom` en dependencias; el helper local de ventanas de escritorio falló dos veces al conectarse. Por tanto, el resultado funcional/visual de runtime sigue pendiente.

Pasos manuales preparados para una revisión posterior con datos de prueba en navegador: (1) usar un clon local y un API con base aislada, iniciar sesión con una cuenta ficticia autorizada; (2) crear un estudiante cuyo nombre sea `Ana <img src=x onerror=alert(1)>` y diagnóstico `"><script>alert(3)</script>`; (3) agregar una observación `Nota <svg onload=alert(2)>`; (4) comprobar lista y filtro, tarjetas, vista de perfil, detalle PIAR, modal de edición, tabla/resumen y reporte: el texto debe conservar los caracteres, el DOM no debe contener elementos `img`, `svg` o `script` provenientes de esos valores y no debe aparecer alerta; (5) revisar atributos en inspector: ningún payload debe crear atributos `onerror`/`onload`; (6) editar, guardar y cerrar modales y comprobar estilo y controles. No realizar estos pasos en una instancia con datos reales.

### Etapa 2: preparación CRUD MySQL (no ejecutada)

Examen de configuración sin conexión: no existe `.env`; `backend/db.js` usa `127.0.0.1:3306`, usuario `root`, base predeterminada `piar` y contraseña vacía si no hay variables de entorno. `.env.example` documenta los mismos valores genéricos de desarrollo, sin identidad exclusiva de pruebas. Las variables `DB_HOST`, `DB_NAME`, `DB_PORT` no están definidas en el proceso. El servicio local `MySQL80` aparece activo, pero esto no demuestra que su base `piar` sea desechable ni que no contenga datos reales; no hay CLI mysql disponible para identificarla y no se intentó conexión. Importar `backend/db.js` abre el pool y ejecuta `SELECT 1`, por lo que no se importó `server.js` en pruebas. **Conclusión: no está confirmada una instancia local aislada; no se preparó ni ejecutó ninguna operación SQL.** No ejecutar migraciones ni CRUD hasta tener servidor/contenedor efímero dedicado, esquema con prefijo de prueba, credencial restringida a ese esquema y evidencia verificable de host/puerto/instancia. No reutilizar `piar`.

Matriz preparada para pruebas de integración exclusivamente con filas sintéticas sobre un esquema desechable:

| Grupo | Caso y resultado esperado |
|---|---|
| Sesión/RBAC | Anónimo: rutas institucionales 401; sesión válida sin permiso: 403; rol autorizado: éxito. Estudiante recibe 403. |
| Alcance Docente | Docente activo enlazado y asignado consulta su PIAR/estudiante/registros; docente activo sin asignación recibe 403. Perfil inactivo o cuenta sin perfil enlazado no obtiene acceso asignado ni puede crear notas. |
| Diagnóstico | Pareja estudiante–PIAR válida acepta; discordante rechaza; update parcial valida contra pareja existente; diagnóstico inexistente devuelve 404 en update/delete. |
| CRUD estudiantes/docentes/usuarios | Alta, consulta, update, desactivación; inexistente 404; update idéntico 200 con `unchanged: true`; repetir baja lógica debe distinguir sin cambios. Verificar RBAC por método. |
| CRUD PIAR/ajustes | Crear/consultar/editar PIAR; payload idéntico 200 unchanged; cerrar y volver a cerrar; PIAR/ajuste inexistente 404; alta, update y delete de ajuste. |
| Asignación docente | Asignar docente activo; duplicado 409; PIAR/docente inexistente o docente inactivo da error controlado; retirar asignación existente e inexistente (404); comprobar alcance posterior. |
| Diagnósticos | Crear como Coordinador/Psicóloga; leer, modificar y borrar según rol; probar relación discordante y registro inexistente. |
| Notas | Crear observación/seguimiento según rol y alcance; PUT/DELETE deben seguir denegados y no alterar filas. |
| Inyección en vista | Usar payloads de Etapa 1 y verificar DOM/texto, atributos, reporte, formularios y modales sin efectos ejecutables. |

### Resultados actuales y archivos

Ejecutado durante esta validación: revisiones de Git, configuración y sinks; lectura de configuración no secreta; `node --check` de los JS modificados en la continuación anterior; `node --test` (**6/6 PASS**) y `git diff --check` (**PASS**, advertencias CRLF). La suite incluye clasificación pura `changed/unchanged/not_found`, permisos unitarios y escape de payloads sintéticos; no incluye render de navegador ni SQL. No se levantó backend, no se conectó a MySQL ni se ejecutaron migraciones.

Preparado pero no ejecutado: pasos manuales de navegador y matriz CRUD. Pendiente: browser QA real, CRUD/RBAC integrado y validación de payloads sintéticos end-to-end. Riesgo del entorno: el servicio MySQL activo y el nombre genérico `piar` no permiten asumir aislamiento; hasta disponer de instancia explícitamente efímera y credenciales separadas, las pruebas de integración no se ejecutan.

Archivos modificados específicamente en esta etapa: `tests/security-output.test.js` y este informe. El resto de cambios locales de seguridad se conservaron.
