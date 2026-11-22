# Matriz de permisos implementada

La matriz refleja `backend/authorization.js` y los controles de alcance de `backend/server.js`; no constituye una aprobación de los cambios funcionales pendientes.

| Recurso / operación | Administrador | Rector | Coordinador | Docente | Psicóloga | Estudiante |
|---|---|---|---|---|---|---|
| Estudiantes: consultar | Institucional | Institucional | Institucional | Solo asignados | Institucional | Denegado |
| Estudiantes: crear, editar, desactivar | Sí | Sí | Sí | No | No | No |
| Docentes: consultar | Institucional | Institucional | Institucional | Solo perfil propio | Institucional | Denegado |
| Docentes: crear, editar, desactivar | Sí | Sí | Sí | No | No | No |
| PIAR: consultar | Institucional | Institucional | Institucional | Solo asignados | Institucional | Denegado |
| PIAR: crear / actualizar contenido | Sí | Sí | Sí | **No en código** | Sí | No |
| PIAR: cerrar | Sí | Sí | Sí | No | No | No |
| Asignaciones PIAR–Docente: consultar | Institucional | Institucional | Institucional | Solo dentro del PIAR asignado | Institucional | Denegado |
| Asignaciones PIAR–Docente: agregar / retirar | Sí | Sí | Sí | No | No | No |
| Diagnósticos: consultar | Institucional | Institucional | Institucional | Solo PIAR asignados | Institucional | Denegado |
| Diagnósticos: crear | No | No | Sí | No | Sí | No |
| Diagnósticos: actualizar / eliminar | Sí | Sí | Sí | No | Sí | No |
| Observaciones / seguimientos: consultar | Institucional | Institucional | Institucional | Solo PIAR asignados | Institucional | Denegado |
| Observaciones / seguimientos: crear | No | No | Sí | Solo PIAR asignados | Sí | No |
| Observaciones / seguimientos: actualizar / eliminar | No | No | No | No | No | No |
| Usuarios: consultar | Sí | Sí | No | No | No | No |
| Usuarios: administrar / aprobar solicitudes | Sí | Aprobar/rechazar | No | No | No | No |
| Reportes, historial, dashboard: consultar | Sí | Sí | Sí | No | Sí | No |

## Decisión pendiente

La solicitud maestra describe creación y actualización de contenido PIAR para Docente dentro de su asignación; el código actual deniega esas rutas. La autorización del backend no se cambió. Se requiere confirmación funcional antes de cualquier ampliación de permisos.

## Confirmación de auditoría — 3 de octubre de 2026

La matriz se contrastó estáticamente con `backend/authorization.js` y los filtros por asignación del servidor. No se cambió el alcance de ningún rol. La ruta de detalle de docentes deja a Docente consultar solo su propio perfil mediante el control de alcance; las demás consultas son por asignación. Esta conclusión aún requiere prueba HTTP local.

La decisión ambigua sobre modificación del contenido PIAR por Docente sigue pendiente: el código vigente deniega `POST /api/piar` y `PUT /api/piar/:id`. No se concedió ese permiso. La comprobación fue unitaria (suite final 8/8), no solicitudes contra un servidor y una base MySQL.

## Verificación de entorno para integración — 3 de octubre de 2026

No se pudo verificar mediante HTTP ni SQL el comportamiento de esta matriz. Aunque TCP 3307 acepta conexiones, MySQL rechazó el acceso de `piar_test` sin contraseña (`ER_ACCESS_DENIED_ERROR`); el proceso tampoco tiene `DB_PASSWORD` ni las demás variables de ejecución. El chequeo fue dirigido explícitamente a loopback y a la base `piar_test`, en modo de solo lectura. No hubo escrituras ni se cambió ninguna autorización. La suite unitaria relevante quedó 8/8.

## Cobertura de integración preparada — 3 de octubre de 2026

`tests/integration.test.js` añade pruebas HTTP con fixtures SQL sintéticos. No altera la matriz de roles. Comprueba como comportamiento vigente que Docente no puede `POST` ni `PUT` PIAR; la decisión institucional ambigua permanece pendiente. El archivo incluye cobertura para accesos sin sesión, cuentas Estudiante, acceso Docente asignado/no asignado, creación/edición/cierre por rol autorizado, diagnósticos y relaciones, asignación de perfiles, observaciones/seguimientos no editables, registro/aprobación y validaciones HTTP.

El archivo exige destino loopback `127.0.0.1:3307` y esquema `piar_test` antes de insertar. Las comprobaciones SQL posteriores se limitan a IDs de fixtures y campos sintéticos creados por el arnés. Estas pruebas están preparadas, pero no ejecutadas en el proceso de Codex por falta de la contraseña y variables de entorno; no constituyen evidencia de autorización HTTP hasta que se ejecute el comando registrado en `RESULTADOS-Y-PENDIENTES.md`.

## Ajuste de roles del fixture — 3 de octubre de 2026

La migración `001_mvp_core.sql` solo permite estos valores ENUM en `usuario.rol`: `Docente`, `Psicóloga`, `Coordinador`, `Administrador`, `Rector`. `Estudiante` existe en `backend/auth.js` y está denegado por `backend/authorization.js`, pero no forma parte de ese ENUM. Se eliminó únicamente el usuario sintético Estudiante; no se alteró esquema ni autorización. La verificación HTTP Estudiante queda omitida para integración hasta que una decisión/esquema institucional lo habilite, mientras que el test unitario de denegación continúa activo.

El preflight del test ahora lee las opciones del ENUM real antes de crear datos y se niega a escribir si no coinciden con la migración. No se pudo consultar la DB desde este proceso porque no hay credenciales de entorno; los valores vivos de `piar_test` aún requieren confirmación al ejecutar desde VS Code.

El slot eliminado se reemplaza por un tercer usuario sintético con rol `Docente` válido y sin perfil asociado, para probar por HTTP que no crea observaciones sin vínculo/asignación.

## Resultado de no-op en actualización PIAR

El Coordinador tiene permiso aprobado de modificar PIAR; esta ruta no se cambió. El no-op fallaba en la respuesta `unchanged`, no en autorización ni en persistencia: con `FOUND_ROWS` de mysql2, `affectedRows` cuenta filas coincidentes. El backend ahora usa `changedRows` para identificar mutación real. No cambia la matriz ni el permiso Docente, que permanece denegado.

Verificación posterior: la regresión unitaria de `changedRows` pasó dentro de la suite 8/8. `node --check tests/integration.test.js` y `git diff --check` también pasaron. No se volvió a ejecutar integración, por lo que el resultado HTTP real del no-op corregido está pendiente.

## Evidencia de integración local — 3 de octubre de 2026

La integración completa fue reportada por la usuaria desde VS Code: 8 aprobadas, 0 fallidas, 1 omitida (~4.93 s). La prueba omitida es Estudiante HTTP porque el ENUM real vigente de `usuario.rol` no lo admite. No se modifica ni amplía el esquema para esta cobertura; la denegación institucional de Estudiante continúa cubierta unitariamente.

La corrección de `mutationOutcome` mediante `changedRows` resolvió la clasificación del UPDATE sin cambios para el escenario PIAR de Coordinador, según la ejecución reportada. No altera autorizaciones. La capacidad de Docente para crear o modificar PIAR continúa denegada y pendiente de decisión institucional; no se debe interpretar el resultado de integración como aprobación de ese permiso.

## Evidencia de integración local — 3 de octubre de 2026

La integración completa fue reportada desde VS Code: 8 aprobadas, 0 fallidas, 1 omitida (~4.93 s). Estudiante HTTP se omitió porque el ENUM real vigente de usuario.rol no admite ese rol. No se modifica el esquema; la denegación institucional de Estudiante sigue cubierta unitariamente.

La corrección de mutationOutcome mediante changedRows resolvió la clasificación del UPDATE sin cambios para el PIAR de Coordinador, según el resultado reportado. No altera autorizaciones. La capacidad de Docente para crear o modificar PIAR continúa denegada y pendiente de decisión institucional.

## Trazabilidad de permiso, código y evidencia — 4 de octubre de 2026

La columna “política implementada” se refiere al código actual; “resultado dinámico” solo se atribuye al resultado comunicado desde VS Code. Las pruebas unitarias ejecutadas en el proceso de auditoría no sustituyen solicitudes HTTP/SQL.

| Recurso / operación | Política implementada | Evidencia en código | Resultado de prueba disponible | Estado de cierre | Observaciones |
|---|---|---|---|---|---|
| Rutas institucionales sin sesión | Rechazo HTTP 401 | `backend/auth.js`, middleware en `backend/server.js` | Prueba unitaria aprobada en `tests/authorization.test.js`; integración reportada desde VS Code | Cumple parcialmente | HTTP/SQL no repetido en esta sesión. |
| Estudiante en recursos institucionales | Denegado por autorización | `backend/auth.js`, `backend/authorization.js` | Denegación unitaria aprobada; subprueba HTTP omitida por ENUM | Pendiente de decisión institucional | Migración enumera cinco roles y no incluye Estudiante. La definición del rol requiere decisión. |
| Consulta docente de estudiantes, PIAR y recursos asociados | Solo asignados activos; perfil propio para detalle docente | Filtros de alcance en `backend/server.js` | Unitarias aprobadas; escenarios HTTP de alcance informados desde VS Code | Cumple parcialmente | Repetir integración desde entorno configurado. |
| Crear / actualizar PIAR | Administrador, Rector, Coordinador y Psicóloga; Docente denegado | `backend/authorization.js`; rutas `POST /api/piar`, `PUT /api/piar/:id` | Unitarias aprobadas; comportamiento reportado en integración VS Code | Pendiente de decisión institucional | La solicitud maestra, según informes, contempla Docente sobre PIAR asignado; no se encontró acta aprobada que resuelva la contradicción. No ampliar permisos. |
| Cerrar PIAR | Administrador, Rector y Coordinador | `backend/authorization.js` y rutas PIAR | Prueba unitaria aprobada; cierre Coordinador informado desde VS Code | Cumple parcialmente | Prueba HTTP no repetida en esta sesión. |
| Crear diagnóstico | Coordinador y Psicóloga | `backend/authorization.js` | Prueba unitaria aprobada; integración informada desde VS Code | Cumple parcialmente | Resultado HTTP reportado, no reproducido aquí. |
| Actualizar / eliminar diagnóstico | Roles institucionales según matriz | `backend/authorization.js` | Prueba unitaria aprobada; integración reportada | Cumple parcialmente | Resultado HTTP reportado, no reproducido aquí. |
| Crear observación / seguimiento | Coordinador, Psicóloga y Docente dentro de PIAR asignado | `backend/authorization.js`, verificaciones en `backend/server.js` | Prueba unitaria aprobada; escenarios reportados en integración VS Code | Cumple parcialmente | Repetición HTTP pendiente en este proceso. |
| Actualizar / eliminar observaciones y seguimientos | Denegado para todos los roles | `backend/authorization.js` | Prueba unitaria de inmutabilidad aprobada; reportado en integración VS Code | Cumple parcialmente | Repetición HTTP pendiente en este proceso. |
| Administrar usuarios / aprobar solicitudes | Administrador administra; Administrador y Rector aprueban según matriz | `backend/authorization.js`, `backend/auth.js` | Prueba unitaria y escenarios de registro reportados | Cumple parcialmente | La aprobación de cuenta no se repitió vía HTTP en esta sesión. |
| Mutación repetida sin cambio | Informar `unchanged` sin alterar permisos | `backend/mutation-result.js`, uso en `backend/server.js` | Regresión unitaria aprobada; escenario de integración corregido reportado en VS Code | Cumple parcialmente | Caso HTTP no repetido aquí. |
| Consultar reportes / historial / dashboard | Administrador, Rector, Coordinador y Psicóloga | `backend/authorization.js` | Revisión estática y matriz unitaria; sin prueba HTTP repetida | Cumple parcialmente | Confirmar con integración configurada. |

### Resumen de cierre de la matriz

- **Cumple y comprobado:** resultados unitarios de la política de autorización; suite explícita 8/8 en esta sesión.
- **Cumple parcialmente:** políticas con revisión estática y/o integración previamente reportada que no pudo repetirse ahora.
- **Pendiente de decisión institucional:** rol Estudiante y permiso Docente para crear/modificar PIAR.
- **Pendiente de validación:** repetición HTTP/SQL de matriz y verificación directa de la limpieza de fixtures.

Esta matriz no declara validación integral de seguridad. El entorno actual no dispone de las variables de conexión y no se conectó a MySQL durante esta sesión.
