# Reporte de cierre técnico

## Identificación

- Proyecto: Sistema PIAR – Plan Individual de Ajustes Razonables.
- Versión de referencia: 1.1.
- Modificación: seguridad, autenticación y control de acceso.
- Rama verificada: `security/fase-1-hardening`.
- Fecha de esta verificación: 4 de octubre de 2026.
- Líder: Yeisson Fabián Reinoso Rodríguez.
- Desarrolladora de apoyo y participante de calidad: Vivian Beatriz Medina Alvarado.

## A. Resumen ejecutivo

Se revisaron la rama, el estado de trabajo, los documentos de auditoría, la matriz de permisos, el arnés de integración, la migración de esquema, los archivos actuales de autenticación y autorización y la documentación general de requerimientos y seguridad. No se descartaron los cambios locales preexistentes. No se modificó la política de permisos ni el esquema porque no hay una decisión institucional inequívoca que sustente esos cambios.

La suite unitaria explícita ejecutada en esta sesión pasó 8/8. El chequeo sintáctico de los archivos JavaScript seleccionados pasó y `git diff --check` no reportó errores, aunque Git mostró avisos LF/CRLF. La ejecución del comodín pasó 8 pruebas y falló en el preflight de integración al no estar configurada `DB_HOST`; no llegó a conectar con MySQL ni a escribir datos. La integración comunicada anteriormente desde VS Code (8 aprobadas, 0 fallidas, 1 omitida, unos 4,93 segundos) se conserva como resultado informado, no repetido en esta sesión.

Estado: validación parcial. La prueba HTTP de Estudiante está omitida por incompatibilidad entre la política de autorización y el ENUM de la migración; la decisión sobre permisos Docente para crear/actualizar PIAR sigue abierta; y no se verificó directamente el estado posterior de limpieza de los datos sintéticos.

## B. Estado inicial y alcance

El repositorio estaba en `security/fase-1-hardening`, con modificaciones locales en `backend/auth.js`, `backend/server.js`, `public/index.html`, `public/js/api.js`, `public/js/app.js`, `public/js/config.js` y `public/js/data.js`; archivos nuevos bajo `backend/`, `public/js/`, `tests/`, `docs/auditoria-local/` y `docs/seguridad/`; y el archivo local `piar-test-cookies.txt`. Estos elementos ya estaban presentes al inicio de esta tarea, excepto las actualizaciones documentales de cierre realizadas ahora. No se inspeccionó ni reprodujo el contenido del archivo de cookies.

No se encontró `AGENTS.md` en el repositorio. `package.json` declara Node.js con dependencias `mysql2` y `bcryptjs`; no define un script de pruebas ni una herramienta de lint. La documentación institucional específica o guía oficial de esta evidencia SENA no está en los archivos enumerados del repositorio.

## C. Pruebas ejecutadas en esta sesión

| Comando | Resultado observado | Clasificación |
|---|---|---|
| `node --test tests/authorization.test.js tests/security-output.test.js tests/ui-permissions.test.js tests/auth-session.test.js` | 8 aprobadas, 0 fallidas, 0 omitidas; duración reportada por Node: 1.596 s | Suite unitaria aprobada |
| `node --test tests/*.test.js` | 8 aprobadas, 1 fallida; duración reportada por Node: 1.272 s | La integración se detuvo en preflight porque falta `DB_HOST`; no llegó a MySQL ni hizo escrituras |
| `node --check` para los archivos JS de backend y pruebas enumerados | Código de salida 0 en todos los archivos revisados | Chequeo sintáctico aprobado |
| `git diff --check` | Sin errores de whitespace; avisos LF/CRLF para archivos locales previos | Aprobado con avisos de conversión de fin de línea |

No se ejecutó una integración HTTP/SQL en esta sesión porque las variables requeridas (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` y `PORT`) no están disponibles en el proceso. El arnés exige `127.0.0.1:3307`, base `piar_test`, cuenta de prueba `piar_test`, puerto de backend 8081, confirma identidad, permisos y tablas antes de escribir, y limpia por IDs sintéticos capturados en `finally`. Esas protecciones no sustituyen la verificación de que el entorno real esté aislado; por ello no se intentó conexión ni escritura desde esta sesión.

## D. Revisión técnica de seguridad

### Comprobado por pruebas unitarias

- Cookie de sesión malformada: se trata como sesión ausente.
- Solicitudes anónimas: reciben 401; Estudiante se deniega para rutas institucionales según la política unitaria.
- Matriz unitaria de roles para diagnósticos, perfiles, PIAR, asignaciones y observaciones/seguimientos inmutables.
- Clasificación de mutaciones con `changedRows`, incluyendo fila existente sin cambios.
- Escape de HTML de payloads sintéticos.
- La acción de crear PIAR en interfaz coincide con los roles autorizados por backend.

### Revisión estática documentada

El código revisado almacena hashes SHA-256 de tokens aleatorios, comprueba expiración, revocación y usuario activo, configura cookies `HttpOnly` y `SameSite=Lax` con `Secure` bajo producción, usa bcrypt con factor 12 y parametriza las consultas revisadas. La revisión de auditoría describe el retiro de `/api/data` y `/api/reset` con respuesta 410, control de asignaciones para Docente y aprobación institucional de cuentas públicas. La prueba unitaria no acredita por sí sola una comprobación HTTP/SQL contra la base ni QA visual/XSS dinámica en navegador.

### Pendiente dinámico

No se repitieron solicitudes HTTP/SQL, QA visual, XSS en navegador, compatibilidad entre navegadores, rendimiento ni comprobación de base de datos. No se considera completa la validación de seguridad.

## E. Puntos funcionales e institucionales

### Rol Estudiante

La migración `database/migrations/001_mvp_core.sql` fija el ENUM de `usuario.rol` en `Docente`, `Psicóloga`, `Coordinador`, `Administrador` y `Rector`. `backend/auth.js` contempla Estudiante en la lista de roles de autenticación, pero `backend/authorization.js` deniega ese rol para recursos institucionales. La prueba HTTP está omitida porque el rol no puede representarse con el esquema declarado. Los documentos de requerimientos generales disponibles describen capacidades generales del sistema, pero no contienen una aprobación institucional específica para admitir el rol Estudiante. Se conserva el esquema y la denegación; decisión institucional pendiente.

### Creación y modificación de PIAR por Docente

`backend/authorization.js` restringe `POST /api/piar` y `PUT /api/piar/:id` a Administrador, Rector, Coordinador y Psicóloga. La matriz local documenta que la solicitud maestra del proyecto contempla edición de PIAR asignados por Docente, lo que contradice el comportamiento implementado; no se localizó en el repositorio un acta o requisito aprobado que resuelva la diferencia. Se conserva la denegación vigente hasta decisión institucional.

## F. Documentación y evidencia

Actualizados en este cierre:

- `docs/auditoria-local/INFORME-AUDITORIA.md`: adenda de verificación del 4 de octubre.
- `docs/auditoria-local/MATRIZ-PERMISOS.md`: tabla de trazabilidad permiso/código/prueba/estado.
- `docs/auditoria-local/RESULTADOS-Y-PENDIENTES.md`: resultados de pruebas repetidos en esta sesión y límites.
- `informe_validacion_modificaciones_PIAR.html`: lista final de chequeo con estados controlados y distinción entre evidencia local y reportada.
- `docs/auditoria-local/REPORTE-CIERRE-TECNICO.md`: este consolidado.
- `docs/auditoria-local/evidencias-pruebas-20261004.txt`: resumen de comandos y límites.
- `docs/auditoria-local/suite-unitaria-20261004.log` y `docs/auditoria-local/suite-completa-20261004.log`: salidas TAP completas generadas en esta sesión, sin secretos de entorno.

La guía oficial de la evidencia SENA no está disponible en el repositorio; el informe no atribuye ponderaciones ni criterios no proporcionados. El documento puede revisarse frente a dicha guía cuando el instructor o el aprendiz la tenga disponible.

## G. Estado Git y control de cambios

La rama observada fue `security/fase-1-hardening`. El diff-check pasó sin errores de whitespace, con avisos CRLF. El repositorio ya contenía cambios locales de hardening y documentación antes de este cierre; se preservaron. Los cambios de esta tarea son las actualizaciones de los cuatro documentos de cierre y el registro de salida de pruebas señalado en la sección F. No se hizo commit, push, fusión ni despliegue. No se ejecutaron migraciones ni operaciones de base de datos.

## H. Riesgos y pendientes técnicos

1. Configurar y verificar un entorno de prueba aislado, repetir integración y conservar el TAP completo.
2. Confirmar directamente, por IDs de esa ejecución, el estado de limpieza en `piar_test` sin hacer limpiezas masivas.
3. Resolver institucionalmente si el rol Estudiante debe persistirse como rol y cuál es la cobertura HTTP esperada.
4. Resolver institucionalmente la discrepancia sobre permisos Docente para crear/actualizar PIAR.
5. Contrastar la evidencia con la guía SENA específica cuando esté disponible.
6. Revisar documentación general de seguridad/requerimientos, que contiene descripciones históricas de una etapa anterior y puede resultar contradictoria si se lee sin fecha/contexto. Este informe prioriza la matriz local más reciente y el código actual para describir el estado presente.

## I. Próximos pasos priorizados

1. Obtener la decisión institucional sobre el rol Estudiante y edición de PIAR por Docente.
2. Ejecutar integración desde un entorno local aislado con la configuración requerida, y guardar su salida completa protegida de secretos.
3. Inspeccionar el resultado de limpieza por IDs exactos de prueba.
4. Incorporar evidencia original disponible (TAP de VS Code o nuevas ejecuciones) y revisar el informe con la guía oficial SENA.

## Revalidación adicional — 4 de octubre de 2026

La suite unitaria explícita se repitió y pasó 8/8 (0 fallidas, 0 omitidas, 0 canceladas; 610.497 ms). `node --check` pasó en los archivos backend, cliente y pruebas; `git diff --check` pasó con avisos LF/CRLF preexistentes. Esta revalidación no ejecutó integración ni repitió el comodín.

Se comprobó solo la presencia de `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` y `PORT`: todas estaban ausentes. No había listeners TCP en `127.0.0.1:3307` ni `127.0.0.1:8081`. No se abrió conexión, no se inició el backend y no se escribieron datos. La limpieza de fixtures en `piar_test` continúa sin verificación directa. La integración previa reportada desde VS Code sigue siendo un resultado informado, no repetido.
