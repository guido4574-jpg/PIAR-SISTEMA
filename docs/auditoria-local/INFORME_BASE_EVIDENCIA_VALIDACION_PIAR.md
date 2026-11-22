# Base de evidencia para validar modificaciones de software — PIAR

**Identificador documental:** Fase 1 — Hardening de seguridad, revisión 1  
**Fecha de elaboración:** 4 de octubre de 2026  
**Estado:** Documento de trabajo para revisión y firma  
**Sistema:** PIAR — aplicación de apoyo a la gestión de Planes Individuales de Ajustes Razonables  
**Uso previsto:** Evidencia técnica del diseño de una lista de chequeo para validar modificaciones de software.

> Este documento organiza evidencia del repositorio local y resultados disponibles. No acredita despliegue, aprobación institucional, ejecución productiva ni la aprobación de pruebas que no tengan una salida verificable. “Cumple” se limita al criterio y a la evidencia citada en cada fila.

## 1. Identificación del proyecto y alcance

### Introducción

Este documento reúne evidencia técnica local para la evidencia SENA **“Diseño de lista de chequeo para validación de modificaciones de software”**, aplicada al fortalecimiento de seguridad del Sistema PIAR. Presenta hechos observados en código y archivos de prueba, resultados de ejecución que están respaldados por registros, antecedentes que solo fueron comunicados, y decisiones que siguen pendientes. La validación descrita es local; no equivale a aprobación institucional ni a aceptación en producción.

### Objetivos de esta validación

1. Identificar los controles de autenticación, sesión y autorización presentes en el código.
2. Contrastar la matriz documental de roles con el backend, el frontend, las migraciones y los tests.
3. Verificar qué resultados de pruebas tienen evidencia conservada y explicar sus límites.
4. Proponer criterios repetibles para revisar funcionalidad, seguridad, rendimiento, usabilidad y compatibilidad.
5. Registrar hallazgos, responsables y aprobaciones pendientes sin tomar decisiones institucionales.

### Alcance de la modificación

El objeto es la fase local de hardening que aborda autenticación, administración de sesiones, permisos por rol, alcance docente por asignación, validación de operaciones institucionales y retiro de endpoints antiguos. Se examina el árbol de trabajo de la rama indicada y documentos de auditoría. No se acredita que todos los cambios locales estén integrados en un commit ni que se hayan desplegado. Quedan fuera de alcance una certificación de seguridad, pruebas sobre datos reales, aprobación del modelo institucional de roles y aceptación de producción.

| Campo | Información y estado de evidencia |
|---|---|
| Proyecto | PIAR-SISTEMA (nombre del repositorio). |
| Aprendiz / institución | Yeisson Fabián Reinoso Rodríguez; Tecnólogo en Análisis y Desarrollo de Software; SENA (datos proporcionados en el encargo, pendientes de validación documental académica). |
| Producto | Aplicación web con frontend HTML/CSS/JavaScript, backend Node.js y persistencia MySQL. |
| Rama revisada | `security/fase-1-hardening`. La rama y el árbol de trabajo contienen cambios locales; estos cambios no constituyen por sí solos una versión publicada. |
| Versión del paquete | `piar-backend` declara `1.0.0` en `package.json`. Es la versión del paquete, no hay evidencia de que sea una versión oficial aprobada del sistema PIAR. |
| Versión documental de referencia | Un informe de seguridad existente usa la referencia 1.1. No se encontró etiqueta Git de versión ni declaración que resuelva su relación con `package.json`. |
| Identificador de esta revisión | “Fase 1 — Hardening de seguridad, revisión 1” se usa como identificador documental provisional, no como versión oficial del producto. |
| Base tecnológica | Node.js, módulos `mysql2` y `bcryptjs`; MySQL 8 es la base prevista para el entorno local de pruebas. El repositorio no declara un rango `engines` de Node.js en `package.json`. |
| Herramientas | VS Code, Git/GitHub, Postman y Docker se declaran en el encargo. Git y Compose tienen artefactos en el repositorio; no se encontró evidencia de una ejecución Postman ni de versiones exactas de las herramientas. |
| Alcance de la revisión | Evidencia local de requisitos, autorizaciones, autenticación, sesiones, aislamiento de pruebas, cambios de seguridad, pruebas registradas y pendientes. No se hizo auditoría general, despliegue ni prueba contra servicios o datos productivos. |
| Guía institucional | No se encontró en los archivos revisados una guía SENA de diligenciamiento que defina formato, escala, métricas o criterios oficiales. La estructura aquí es una propuesta técnica para revisión. |

### Fechas que no deben confundirse

| Hito | Fecha/resultado disponible | Interpretación |
|---|---|---|
| Historial confirmado de Git | `HEAD` de la rama y `main`: `27a87f8`, fechado 20-sep-2026; no se encontraron etiquetas Git. | Identifica el último commit confirmado, no la fecha de implementación del hardening local. |
| Cambios de hardening | Hay archivos modificados y no rastreados en el árbol de trabajo. | No tienen commit que permita asignarles una fecha de implementación definitiva. Los metadatos locales no bastan para certificarla. |
| Prueba unitaria registrada | 4-oct-2026; artefacto `docs/auditoria-local/evidencia/suite-unitaria-20261004.log`: 8 aprobadas, 0 fallidas, 0 omitidas; código de salida 0; 1.596 s. | Resultado reproducible como registro conservado. En una interacción anterior también se informó otra ejecución de 8/8 en 0.981 s; no corresponde al mismo artefacto y no se mezcla con esta medición. |
| Integración comunicada en documentación local | 3-oct-2026, aproximadamente 4.93 s: 8 aprobadas, 0 fallidas y 1 omitida. | Está descrita en informes como ejecución desde VS Code, pero no se encontró su salida TAP original. Se registra como resultado comunicado, no como ejecución verificada por este informe. |
| Otra cifra comunicada | El encargo recibido menciona una ejecución el 4-oct-2026, aproximadamente 4.65 s, con 8 aprobadas y 1 omitida. | No se halló artefacto original que confirme esa fecha/duración. La discrepancia se conserva explícita; no se escoge una cifra como hecho probado. |
| Ejecución completa registrada | `docs/auditoria-local/evidencia/suite-completa-20261004.log`: 9 pruebas de nivel superior, 8 aprobadas, 1 fallida; el proceso hijo de integración terminó en preflight por falta de `DB_HOST`; salida 1. | No demuestra que MySQL haya sido contactado ni que se ejecutara una transacción. La prueba de integración no se declara aprobada. |
| Implementación en producción | Por confirmar: no se encontró evidencia suficiente de despliegue o instalación institucional. | No inferir a partir de archivos locales, commits ni reportes de prueba. |

## 2. Fuentes revisadas y límites

Se revisaron únicamente fuentes pertinentes a permisos, esquema, preparación y evidencia de pruebas:

- `tests/integration.test.js`, incluyendo la condición `skip`, el preflight, los roles de fixtures y la limpieza prevista.
- `tests/authorization.test.js`, `tests/auth-session.test.js`, `tests/security-output.test.js` y `tests/ui-permissions.test.js`.
- `backend/auth.js`, `backend/authorization.js`, `backend/server.js`, `backend/mutation-result.js`, `backend/db.js` y las rutas/API frontend pertinentes.
- `database/migrations/000_railway_schema.sql` y `database/migrations/001_mvp_core.sql`.
- `docker-compose.test.yml`, `database/test-init/03-restrict-test-user.sql`, `.env.test.example` y reglas relevantes de `.gitignore`, sin leer archivos con secretos.
- `docs/seguridad/INFORME_FASE_1_SEGURIDAD.md`, `docs/auditoria-local/INFORME-AUDITORIA.md`, `docs/auditoria-local/RESULTADOS-Y-PENDIENTES.md`, `docs/auditoria-local/REPORTE-CIERRE-TECNICO.md`, `docs/auditoria-local/MATRIZ-PERMISOS.md` y evidencia textual relacionada.
- `package.json`, historial/estado local de Git y los dos registros de pruebas citados arriba.

No se inspeccionaron valores de `.env`, `.env.test` ni archivos de cookies. No se muestran credenciales, tokens, datos personales o datos de estudiantes. No se inició un contenedor, conectó una base, ejecutó migraciones ni realizó pruebas de integración durante la elaboración. La inspección es estática salvo los resultados ya guardados en los registros indicados.

### Metodología de validación

1. Localizar archivos mediante inventario del repositorio y confirmar la existencia de cada fuente antes de citarla.
2. Contrastar requisitos y matriz de roles contra `backend/authorization.js`, rutas en `backend/server.js`, autenticación en `backend/auth.js`, interfaz y pruebas.
3. Revisar esquema y preparación del test sin aplicar migraciones ni conectarse a una base.
4. Contrastar resultados reportados con logs presentes; separar TAP verificable de reportes narrativos y verificaciones estáticas.
5. Asignar estado a cada criterio únicamente dentro del alcance de la evidencia. Para ejecución futura, registrar fecha, versión de Node, comando, configuración no secreta, resultado TAP, conteos y confirmación de limpieza de fixtures.

La metodología aplicada aquí fue de revisión estática y lectura de registros existentes. No se ejecutó una ronda nueva de pruebas ni se midió rendimiento. Los procedimientos de ejecución futura se indican en las listas de chequeo.

## 3. Resumen de la omisión de Estudiante

El subtest se encuentra en `tests/integration.test.js` bajo el nombre **“Estudiante HTTP (no representable por el ENUM local)”**. Su opción `skip` es incondicional y explica que el ENUM de `piar_test.usuario.rol` acepta los cinco roles de la migración, excluye `Estudiante` y que las denegaciones del rol se cubren separadamente en `tests/authorization.test.js`. El callback es vacío, de modo que al quitar el `skip` no se ejecutaría una solicitud HTTP.

La migración `database/migrations/001_mvp_core.sql` deja `usuario.rol` como `ENUM('Docente','Psicóloga','Coordinador','Administrador','Rector')`. El conjunto de roles de datos del arnés se alinea con ese esquema y no crea un usuario Estudiante. Por tanto, la causa demostrable es una **limitación intencional del esquema de pruebas alineado con el esquema vigente**, reflejada expresamente en un `skip` del arnés; no es una omisión accidental por falta de fixture, un error de configuración del test ni un fallo de preflight. La decisión de admitir el rol en el ENUM es institucional y está pendiente.

La implementación de autorización también deniega al rol Estudiante el acceso a las rutas institucionales que protege. Los tests unitarios verifican esa política de autorización sin necesitar insertar ese rol en MySQL. Es una validación útil de la regla actual, pero no sustituye una integración HTTP con un usuario persistido. No se modificó el `skip`, el ENUM, las reglas de negocio ni las aserciones. La alternativa honesta, hasta una aprobación institucional, es mantener el subtest de integración identificado como pendiente y conservar el test unitario de denegación, sin presentarlo como cobertura de extremo a extremo.

En el módulo de autenticación se encontró creación de sesión en login, vencimiento configurado a 8 horas y revocación en logout. En los endpoints revisados no se encontró una operación de renovación/rotación de sesión. No se califica como defecto sin un requisito aprobado; registrar y decidir si la renovación forma parte del alcance.

## 4. Descripción de la modificación y controles de seguridad

El siguiente resumen describe el código actualmente visible en el árbol local. “Antes” se incluye solo donde los informes existentes documentan el comportamiento previo; no implica que cada diferencia tenga un commit atribuible o una fecha de instalación.

| ID | Área y comportamiento actual comprobado estáticamente | Antecedente o motivo | Evidencia/estado |
|---|---|---|---|
| SEC-01 | La autenticación usa contraseña comparada con bcrypt; genera token de sesión aleatorio, guarda su hash SHA-256 en `sesion_usuario`, comprueba vencimiento de 8 horas, revocación y estado activo. La cookie de sesión tiene `HttpOnly`, `SameSite=Lax`, `Path=/` y `Secure` en producción. | Sustituye el uso de credenciales de sesión expuestas en el cliente descrito en informes de seguridad históricos. | Código revisado; pruebas unitarias de sesión. No es una revisión dinámica de cookie en navegador. |
| SEC-02 | Registro público normaliza y valida correo y campos; el registro fuerza rol Docente y estado pendiente. Inicio de sesión no autorizado responde sin revelar si el correo existe. | Evita que el registro público asigne roles institucionales privilegiados. | Código y tests de sesión; alta/aprobación institucional de usuarios no equivale a aprovisionamiento completo de perfiles. |
| SEC-03 | Las rutas protegidas exigen sesión y autorización de rol; respuestas previstas: 401 sin autenticación y 403 sin autorización. | Los informes históricos describen recursos de datos accesibles sin controles suficientes. | Cobertura unitaria de permisos; parte de la cobertura HTTP aparece solo en ejecución de integración comunicada y no verificable por TAP. |
| SEC-04 | El acceso de Docente se filtra por PIAR y estudiante asignados; un profesor ajeno o no vinculado no debe acceder a recursos fuera de su alcance. | Protección de datos y alcance por asignación. | Pruebas unitarias de autorización y escenario de integración del arnés. Ejecución completa de integración pendiente de salida verificable. |
| SEC-05 | Las reglas actuales permiten a Administrador, Rector, Coordinador y Psicóloga determinadas operaciones de PIAR. Docente no crea ni modifica PIAR en las rutas actuales. | La matriz documental y el código tienen una discrepancia sobre edición de PIAR por Docente; no se resuelve por inferencia. | Código y matriz revisados; decisión funcional pendiente. |
| SEC-06 | El acceso a diagnósticos tiene restricciones de rol y validaciones de relación con el estudiante/PIAR. | Reduce acceso cruzado y entradas inconsistentes. | Código y tests de autorización; ejecución HTTP contra DB por completar. |
| SEC-07 | Seguimientos y observaciones permiten creación a roles definidos, con alcance de Docente por asignación; las rutas bloquean modificación y eliminación. | Preserva el carácter de registro de seguimiento según reglas actuales. | Tests unitarios y matriz; confirmar comportamiento completo en integración cuando exista salida original. |
| SEC-08 | `/api/data` y `/api/reset` responden 410; el arnés también comprueba endpoints retirados. | El informe de seguridad existente documenta que endpoints antiguos permitían acceso/reset sin controles adecuados. | Código actual revisado; la prueba dinámica global se detuvo antes de ejecutar integración. |
| SEC-09 | La salida del cliente usa `escapeHTML` para valores mostrados en contextos HTML revisados; la configuración frontend usa el origen actual y no contiene token fijo. | Mitigación de inyección en vistas y secretos en cliente. | Revisión estática más test de escape. No equivale a un análisis dinámico XSS de todas las vistas. |
| SEC-10 | La capa de resultado de mutación distingue cambios reales de no-op usando `changedRows` con fallback, y la prueba unitaria cubre mutación sin cambios. | Soluciona un caso de actualización idempotente descrito por el arnés y reporte técnico. | Test unitario aprobado; la integración donde se reportó el problema no tiene TAP disponible. |
| SEC-11 | El preflight de integración exige configuración local, host seguro, base esperada, usuario y privilegios restringidos; compara esquema/roles para prevenir conexión accidental a producción. | Evita ejecutar fixtures contra entornos ajenos a pruebas. | Código de integración y configuración de Compose revisados estáticamente; no se intentó conexión en esta revisión. |
| SEC-12 | Compose publica MySQL de prueba en loopback `127.0.0.1:3307`, con base `piar_test`, y el usuario de prueba se restringe a esa base. | Aislamiento local definido en configuración de pruebas. | Configuración estática. No acredita estado actual del contenedor ni de Docker Desktop. |

### Trazabilidad de cambios de seguridad

| ID | Archivos/módulos | Comportamiento anterior comprobable | Comportamiento actual | Riesgo que busca reducir | Evidencia encontrada | Estado |
|---|---|---|---|---|---|---|
| SEC-01 | `backend/auth.js`, tabla `sesion_usuario`, `tests/auth-session.test.js` | Informes históricos describen credenciales/token manejados en cliente; no se asigna fecha exacta al cambio por falta de commit que lo aísle. | Contraseña verificada con bcrypt; token aleatorio de sesión; DB guarda hash SHA-256; expiración 8 h, revocación y cuenta activa son verificadas. Cookie HttpOnly/SameSite=Lax y Secure bajo producción. | Robo/reutilización de credenciales y sesiones; acceso con cuenta inactiva. | Código y pruebas unitarias. | Implementado en código; validación integrada parcial. |
| SEC-02 | `backend/auth.js`, `backend/server.js`, `tests/auth-session.test.js`, `tests/integration.test.js` | No se afirma un comportamiento anterior exacto más allá de los reportes generales de auditoría. | Registro público fuerza rol Docente y estado pendiente; login usa respuesta genérica ante credenciales no válidas; endpoints de sesión controlan login/logout/me. | Autoasignación de privilegios y enumeración de cuentas. | Código y pruebas unitarias; flujo persistente aparece en integración, cuya salida actual no está disponible. | Parcial; integración pendiente. |
| SEC-03 | `backend/authorization.js`, `backend/server.js`, `tests/authorization.test.js` | Informes de seguridad señalan exposición previa de recursos institucionales; no hay commit/tag que identifique por sí solo el instante del cambio. | Middleware exige sesión y aplica permisos por ruta; respuestas distinguen 401 y 403. | Acceso no autenticado o de rol incorrecto. | Implementación y suite unitaria 8/8 del log citado. | Implementado en código; pruebas unitarias locales aprobadas. |
| SEC-04 | `backend/server.js`, `backend/authorization.js`, `tests/integration.test.js`, `tests/authorization.test.js` | No se determinó baseline histórico por commit para cada consulta. | Docente queda limitado a PIAR/estudiantes vinculados; se comprueba asignación y perfil en rutas pertinentes. | Divulgación de información fuera del grupo asignado. | Código y reglas unitarias; integración se comunicó anteriormente pero no tiene TAP adjunto. | Parcial; integración verificable pendiente. |
| SEC-05 | `backend/authorization.js`, `backend/server.js`, `docs/auditoria-local/MATRIZ-PERMISOS.md` | Matriz documental conserva expectativa de edición docente en conflicto con la autorización actual. | Administrador/Rector/Coordinador/Psicóloga autorizados según acción; Docente no crea ni actualiza PIAR. | Cambios por rol no autorizado; riesgo de requisito mal interpretado. | Código y matriz. | Parcial; decisión funcional pendiente. |
| SEC-06 | `backend/authorization.js`, `backend/server.js`, `tests/integration.test.js` | No se encontró baseline versionado atribuible a este control concreto. | Diagnósticos restringidos por rol y validación de asociación con estudiante/PIAR. | Acceso o asociación de diagnóstico incorrectos. | Código y casos planeados en integración. | Parcial; integración DB pendiente. |
| SEC-07 | `backend/authorization.js`, `backend/server.js`, `tests/integration.test.js` | No se encontró commit histórico que pruebe individualmente la política anterior. | Se permite creación conforme al rol y ámbito; modificación/eliminación de observaciones y seguimientos se rechaza. | Alteración directa de registros de seguimiento. | Código, matriz y tests unitarios pertinentes. | Implementado en código; cobertura de integración pendiente. |
| SEC-08 | `backend/server.js`, `tests/integration.test.js`, `docs/seguridad/INFORME_FASE_1_SEGURIDAD.md` | El informe de seguridad registra que endpoints antiguos de datos/reset se identificaron como accesibles sin control suficiente. | `/api/data` y `/api/reset` devuelven 410 y no realizan el comportamiento legado. | Lectura o destrucción de datos mediante rutas obsoletas. | Código estático; ejecución actual de integración se abortó en preflight. | Implementado en código; prueba dinámica pendiente. |
| SEC-09 | `public/js/security.js`, `public/js/app.js`, `public/js/api.js`, `public/js/config.js`, `tests/security-output.test.js` | No se adjudica baseline anterior para cada plantilla. | Escape HTML en vistas revisadas; API incluye cookie de forma explícita; config usa origen actual y no contiene token fijo. | XSS y exposición directa de token en cliente. | Prueba unitaria de escape y revisión estática acotada. | Parcial; falta barrido dinámico de vistas y navegador. |
| SEC-10 | `backend/mutation-result.js`, `tests/security-output.test.js`, `tests/integration.test.js` | Una actualización sin cambios podía confundirse con ausencia del recurso según el caso informado. | Se distingue cambio efectivo mediante `changedRows` con fallback y caso de no-op. | Falsos 404/resultado incorrecto en actualización idempotente. | Test unitario de mutación sin cambios. | Implementado y cubierto unitariamente. |
| SEC-11 | `tests/integration.test.js`, `docker-compose.test.yml`, `database/test-init/03-restrict-test-user.sql`, `.gitignore` | El reporte completo anterior falló antes de poder validar conexión por configuración faltante. | Preflight verifica identidad de entorno y esquema; configuración enlaza MySQL de test en loopback y limita grants; secreto de test no se versiona. | Escritura accidental en producción/DB distinta y exposición de credenciales. | Configuración estática y log de rechazo por `DB_HOST` faltante. | Parcial; aislamiento runtime y grants efectivos por comprobar. |

### Discrepancias funcionales que requieren decisión o validación

1. **Rol Estudiante:** `auth.js` conoce el nombre de rol, pero el esquema de datos actual no lo admite; la política de autorización deniega su acceso institucional. Su inclusión, permisos y tratamiento de datos necesitan aprobación institucional antes de cualquier cambio en ENUM o reglas.
2. **Edición de PIAR por Docente:** la matriz de permisos presenta una expectativa de edición en PIAR asignado; la autorización del backend niega POST/PUT a Docente. La autoridad funcional debe decidir cuál es el requisito y actualizar de forma coherente matriz, código y pruebas.
3. **Restauración administrativa:** la documentación de permisos menciona restauración como capacidad reservada; no se encontró una ruta actual que la implemente. `/api/reset` está retirado y devuelve 410. No afirmar que existe una restauración segura sin implementar y aprobar su flujo.
4. **Vinculación de perfiles y cuentas:** el alta pública queda pendiente como Docente; el alta administrativa genérica permite Docente y las rutas bloquean vincular `id_usuario` mediante actualización de perfil. El flujo institucional para vincular cuentas de Coordinador/Psicóloga no está demostrado como implementado.
5. **Prueba HTTP de Estudiante:** el subtest se omite por el ENUM y tiene cuerpo vacío. La comprobación unitaria actual solo demuestra la denegación de autorización, no un ciclo HTTP con persistencia.

### Matriz de roles y permisos: requisito frente a código

La matriz documental es una fuente de requisitos, no prueba de que el control funcione. La columna de interfaz indica únicamente controles revisados en frontend; la autorización efectiva debe permanecer en backend.

| Rol/capacidad | Regla documental o esperada | Backend observado | Interfaz/pruebas | Resultado del contraste |
|---|---|---|---|---|
| Rector | Consulta institucional de estudiantes, diagnósticos e informes según política. | Rutas institucionales permiten lectura; `/api/usuarios` es legible por Admin/Rector. | El arnés incluye Rector para permisos y lectura; no existe salida TAP verificable de esa ronda. | Parcial: regla de lectura se observa en código; revisar minimización de datos de salud y confirmar en integración. |
| Docente | Consulta solo PIAR asignados; la matriz existente indica expectativa de creación/actualización del PIAR asignado. | Ámbito de lectura se filtra por asignación. Autorización deniega POST/PUT de PIAR para Docente. | Hay prueba UI de visibilidad limitada de controles; arnés espera 403 para POST/PUT. | Discrepancia funcional pendiente: decidir formalmente edición de PIAR por Docente. |
| Coordinador | Administra PIAR, asigna Docentes, registra diagnósticos y crea observaciones/seguimientos según política. | Puede crear/actualizar/cerrar PIAR, asignar Docentes y crear diagnósticos/observaciones según rutas. | Escenarios de integración escritos; unidad cubre reglas de acceso. | Implementación visible; ejecución persistente pendiente de TAP actual. |
| Psicóloga/o | Puede crear diagnósticos y anotaciones; no cerrar PIAR ni asignar Docentes. | Autorizado para crear diagnósticos y anotaciones; cierre/asignación se limitan a Admin/Rector/Coordinador. | Matriz y arnés contienen denegaciones relevantes. | Coincide en código revisado; integración DB pendiente. |
| Administrador | Gestiona usuarios y operaciones administrativas; cierre y asignación autorizados. | Puede consultar usuarios, crear Docente; actualización de rol/estado y borrado físico no se permiten por las rutas descritas. | No hay evidencia de flujo de restauración. | Parcial; facultad de restaurar datos no está implementada en las rutas actuales. |
| Registro público Docente | Solicitud requiere aprobación institucional antes del acceso activo. | Registro fuerza rol Docente y estado pendiente; el acceso depende de cuenta activa. | Tests de sesión y escenario de arnés cubren registro/aprobación; integración integral por ejecutar. | Parcial; confirmar persistencia y aprobación en integración. |
| Estudiante | Requisito esperado: consulta información general, sin datos restringidos del PIAR. | No admitido por ENUM de usuario y denegado por la política de acceso institucional actual. | Test unitario de denegación; test HTTP de integración omitido intencionalmente. | Pendiente de decisión institucional y definición de datos/rutas permitidas. |
| Observaciones y seguimientos | No editar ni borrar el registro original; corregir mediante nueva anotación. | POST conforme a rol; las otras mutaciones se bloquean en la autorización revisada. | Unidad de permisos y escenario de integración. | Coincide en código; confirmar vía integración. |
| Restauración de datos | Capacidad administrativa según matriz documental. | No se encontró endpoint actual de restauración; `/api/reset` es legado y devuelve 410. | Sin test de restauración, pues la ruta no está presente. | Pendiente: confirmar si el requisito aplica; no presentar como implementado. |

**Nota de alcance:** “Psicóloga” y “Psicólogo” se refieren al rol persistido `Psicóloga` (con tilde) en el esquema. Las cuentas privilegiadas Coordinador/Psicóloga no se asignan mediante el registro público; se requiere definir/aprobar el aprovisionamiento y vínculo de perfiles.

## 5. Evaluación y lista de chequeo propuesta

### Convención de estado

- **Cumple:** evidencia existente respalda el criterio acotado descrito; no declara la aceptación del sistema completo.
- **No cumple:** la evidencia revisada contradice el requisito explícito descrito.
- **No aplica:** el criterio no corresponde al alcance aprobado. No usar para encubrir una prueba faltante.
- **Pendiente:** falta ejecución, evidencia, decisión de requisito o aprobación.

La columna “resultado/evidencia” indica el alcance de lo que realmente se conoce. Las validaciones propuestas deben ejecutarse únicamente cuando el entorno aislado esté comprobado y el requisito correspondiente esté aprobado.

#### Ficha diligenciable por cada criterio

Las tablas siguientes contienen los criterios específicos, sus estados preliminares y evidencia disponible. Para registrar una ejecución y dejar separados todos los campos requeridos, duplicar esta ficha por cada código evaluado:

| Código | Categoría | Criterio de validación | Resultado esperado | Método/procedimiento | Evidencia requerida | Estado (Cumple / No cumple / No aplica / Pendiente) | Observaciones | Acción correctiva |
|---|---|---|---|---|---|---|---|---|
| __________ | __________ | __________ | __________ | __________ | __________ | __________ | __________ | __________ |

En las tablas por categoría, el criterio describe el comportamiento esperado. Cuando método y evidencia estén combinados, separarlos en esta ficha durante la ejecución. La observación y la acción correctiva se completan por separado; no inferir una acción cerrada cuando se requiere decisión institucional.

### 5.1 Funcionalidad

| ID | Criterio de aceptación | Validación/evidencia objetiva | Estado | Observación / acción requerida |
|---|---|---|---|---|
| FUN-01 | Una solicitud sin sesión no accede a recursos institucionales. | `tests/authorization.test.js`; registro unitario 8/8. | Cumple | Cumple a nivel de pruebas unitarias de autorización; validar además con HTTP integrado. |
| FUN-02 | Inicio de sesión válido crea una sesión utilizable; credenciales inválidas no crean sesión. | Tests de sesión; el arnés contiene ciclo login/logout, sin salida TAP integral adjunta. | Pendiente | Adjuntar resultado TAP al ejecutar la integración aislada. |
| FUN-03 | El registro público crea una cuenta Docente pendiente, sin elevar rol. | Regla estática en `backend/auth.js`; escenario en `tests/integration.test.js`. | Pendiente | Confirmar persistencia, estado y restricciones en la integración. |
| FUN-04 | Solo roles autorizados administran cuentas y cambios de estado conforme a la matriz aprobada. | Backend limita consulta y creación de usuario; cambios de rol/estado están bloqueados. | Pendiente | Validar con decisión institucional y pruebas de integración de casos permitidos/denegados. |
| FUN-05 | Docente consulta únicamente PIAR/estudiantes que tiene asignados. | Regla y pruebas unitarias; escenarios en arnés. | Pendiente | Evidencia HTTP/DB no está adjunta como TAP verificable. |
| FUN-06 | Coordinador crea PIAR válido y asigna Docente activo; solicitudes inválidas o duplicadas se rechazan con estado apropiado. | Casos de creación/asignación descritos en el arnés; log integral terminó en preflight. | Pendiente | Ejecutar contra `piar_test` y conservar TAP. |
| FUN-07 | Roles permitidos actualizan/cerran PIAR respetando estado, relación y validación. | Código y pruebas de autorización; escenario de arnés. | Pendiente | Revisar discrepancia de edición por Docente antes de fijar aceptación. |
| FUN-08 | Docente no crea ni edita PIAR bajo la política actualmente implementada. | `backend/authorization.js`; tests de rol; aserciones previstas en integración. | Cumple | Es el comportamiento implementado hoy. Si el requisito institucional fuera distinto, registrar cambio aprobado y no cambiar solo la prueba. |
| FUN-09 | Diagnóstico se registra solo para relaciones válidas y roles autorizados. | Código valida asociaciones; arnés contempla rol y relación. | Pendiente | Ejecutar integración. |
| FUN-10 | Observaciones y seguimientos respetan ámbito de asignación y no son editables/eliminables por rutas generales. | Autorización y tests unitarios; escenarios del arnés. | Pendiente | Confirmar respuestas HTTP persistentes y alcance con integración. |
| FUN-11 | Estudiante realiza las operaciones institucionales definidas por requisito aprobado. | Rol ausente del ENUM; endpoint institucional deniega Student; subtest HTTP omitido incondicionalmente. | Pendiente | Decisión institucional requerida; mantener skip. No modificar ENUM para obtener un “pass”. |
| FUN-12 | Endpoints heredados de lectura/reset no ejecutan operaciones y devuelven 410. | Código actual y criterio del arnés. | Pendiente | La prueba integral no superó preflight; adjuntar TAP al ejecutar de forma aislada. |
| FUN-13 | Operaciones idempotentes distinguen dato inexistente, sin cambio y actualización efectiva. | `mutation-result.js` y prueba unitaria correspondiente. | Cumple | La prueba unitaria acotada pasó; documentar la salida de integración que antes se comunicó como mejora. |

### 5.2 Seguridad

| ID | Criterio de aceptación | Validación/evidencia objetiva | Estado | Observación / acción requerida |
|---|---|---|---|---|
| SEG-01 | Las rutas institucionales exigen sesión y devuelven 401 sin autenticar. | Tests unitarios de autorización aprobados. | Cumple | Cobertura unitaria; no equivale a certificación de toda ruta en producción. |
| SEG-02 | Roles sin permiso reciben 403 y no realizan mutación. | Matriz y pruebas unitarias; el arnés contiene casos HTTP. | Cumple | Cumple para reglas cubiertas por tests; obtener TAP integral de los casos restantes. |
| SEG-03 | Token de sesión aleatorio se almacena como hash en DB y la sesión expira/revoca/obedece estado de cuenta. | Revisión de `backend/auth.js` y tests de sesión. | Cumple | Revisión estática más unidad; falta prueba operativa de revocación con DB en salida verificable. |
| SEG-04 | Cookie de sesión tiene HttpOnly, SameSite y Secure en producción. | Opciones visibles en código. | Cumple | Probar cabeceras en entorno HTTPS aprobado; Secure depende de NODE_ENV de producción. |
| SEG-05 | Contraseñas se verifican con bcrypt y no se devuelven en respuestas. | Código de autenticación y salida genérica. | Cumple | No se inspeccionaron secretos ni datos reales. |
| SEG-06 | La UI escapa datos insertados en contextos HTML relevantes. | `public/js/security.js`, uso en UI revisada y `security-output.test.js`. | Cumple | La prueba no sustituye revisión de todos los contextos DOM ni test dinámico XSS. |
| SEG-07 | SQL usa consultas parametrizadas para datos externos y valida relaciones antes de mutar. | Rutas backend y esquema revisados; algunos escenarios unitarios. | Pendiente | Hacer revisión de cobertura por endpoint/consulta y prueba con entradas adversas. |
| SEG-08 | El usuario DB de test tiene solo privilegios DML requeridos dentro de `piar_test`. | Script `database/test-init/03-restrict-test-user.sql` y Compose. | Pendiente | Configuración declara grants; falta salida de `SHOW GRANTS` tomada en el entorno aislado. |
| SEG-09 | El servicio MySQL de prueba escucha únicamente en loopback y no expone interfaz de red externa. | Compose mapea `127.0.0.1:3307:3306`. | Cumple | Cumple por configuración estática. No se inició contenedor ni se comprobó socket activo. |
| SEG-10 | Preflight aborta si host/base/usuario/esquema no son los autorizados para test. | Código de `tests/integration.test.js`; ejecución completa archivada abortó por `DB_HOST` faltante. | Cumple | El log demuestra rechazo seguro ante variable faltante, no todos los escenarios de producción prohibida. |
| SEG-11 | Errores internos no exponen detalles al cliente. | Handler devuelve mensaje genérico; log del servidor puede registrar detalle. | Cumple | Revisar que los logs locales no contengan secretos o datos sensibles; no se inspeccionaron archivos de secretos. |
| SEG-12 | Cookies/sesiones no se almacenan en localStorage y el cliente envía credenciales mediante cookie. | `public/js/api.js` usa `credentials: include`; configuración de API sin token fijo. | Cumple | Alcance de archivos revisados, no barrido dinámico de navegador. |
| SEG-13 | Datos enviados exceden el límite solo si se rechazan con respuesta controlada; JSON inválido no tumba proceso. | Servidor define límites y manejo de errores; sin ejecución dinámica asociada en evidencia. | Pendiente | Incorporar casos automatizados y conservar su salida. |
| SEG-14 | Acceso y modificaciones de Estudiante cumplen política institucional aprobada. | La decisión de incluir rol y permisos sigue abierta; esquema no lo admite. | Pendiente | No cambiar ENUM ni reglas hasta aprobación documentada. |
| SEG-15 | Restauración administrativa, si es requisito, está autenticada, autorizada, auditada y probada. | No se halló ruta de restauración; reset heredado retorna 410. | Pendiente | Definir si está dentro del alcance; diseñar e implementar mediante cambio separado aprobado. |

### 5.3 Rendimiento

No hay benchmark, prueba de carga ni mediciones de latencia verificables en los archivos revisados. Los tiempos de suite completa/unidad miden duración del proceso de pruebas y **no** representan latencia de endpoints. Los siguientes umbrales son una propuesta para aprobar antes de medir; no son resultados obtenidos ni requisito institucional vigente.

| Métrica | Criterio propuesto | Método de medición | Resultado real | Estado | Evidencia |
|---|---|---|---|---|---|
| REN-01: respuesta de operaciones principales | Máximo propuesto 1 segundo. | Medir operaciones CRUD principales en `piar_test`; registrar equipo, versión runtime, datos sintéticos y percentiles por operación. | Pendiente de medición. | Pendiente | No hay benchmark ni registro de latencias en el repositorio. |
| REN-02: respuesta de consultas seleccionadas | Máximo propuesto 1 segundo. | Medir lecturas acordadas de PIAR/diagnósticos con volumen de fixture documentado; reportar p50/p95/máximo. | Pendiente de medición. | Pendiente | No hay medición de consultas; tiempo de suite no es latencia. |
| REN-03: operaciones consecutivas | 20 operaciones consecutivas sin errores inesperados. | Ejecutar ronda repetible de operaciones sintéticas y contar 5xx, errores DB y diferencias no esperadas. | Pendiente de medición. | Pendiente | No se realizó prueba de carga. |
| REN-04: solicitudes no autorizadas | Rechazo sin modificación de datos. | Verificar respuesta 401/403 y comparar estado antes/después en DB aislada. | Pendiente de medición. | Pendiente | Hay reglas unitarias, pero no evidencia de verificación DB de esta ronda. |
| REN-05: estabilidad | Ausencia de errores inesperados en los casos definidos. | Repetir el conjunto acordado y registrar errores HTTP/DB; conservar TAP y condiciones. | Pendiente de medición. | Pendiente | Sin registro real de rendimiento/estabilidad repetida. |

### 5.4 Usabilidad

No se encontró una prueba documentada con participantes/usuarios ni un protocolo de usabilidad ejecutado. Los criterios quedan pendientes hasta validar pantallas con perfiles sintéticos autorizados; no usar datos personales de estudiantes.

| ID | Criterio | Validación/evidencia requerida | Estado | Observación |
|---|---|---|---|---|
| USA-01 | Un usuario puede iniciar/cerrar sesión y reconocer con claridad el estado de sesión. | Recorrido guiado, capturas sin datos reales y registro de incidencias. | Pendiente | No se encontró evidencia de recorrido. |
| USA-02 | Los mensajes de validación indican cómo corregir el dato sin revelar información sensible. | Casos de formularios inválidos; revisar texto, foco y accesibilidad. | Pendiente | Revisar con usuario de QA. |
| USA-03 | Las opciones visibles coinciden con el rol y las restricciones del servidor. | Recorrer vistas por rol sintético y contrastar con autorizaciones. | Pendiente | El test UI existente cubre visibilidad limitada de creación, no todas las pantallas. |
| USA-04 | Operaciones sensibles comunican resultado, rechazo y cambios de estado de manera inequívoca. | Pruebas moderadas de tareas PIAR/diagnóstico/seguimiento. | Pendiente | No declarar aceptación sin prueba. |
| USA-05 | Formularios se pueden completar con teclado y errores se anuncian/identifican. | Revisión WCAG básica con teclado/lector de pantalla y registro. | Pendiente | Sin evaluación de accesibilidad documentada. |
| USA-06 | La pantalla mantiene legibilidad y flujo en tamaños habituales de móvil/tableta/escritorio. | Capturas de viewport y pruebas de tareas con perfiles sintéticos. | Pendiente | No se ejecutó QA visual en esta revisión. |

### 5.5 Compatibilidad

No se encontró una matriz aprobada de navegadores o dispositivos compatibles. El uso de cookie de sesión requiere probar SameSite, Secure y CORS con el despliegue final; la configuración local no demuestra compatibilidad de producción.

| ID | Criterio | Validación/evidencia requerida | Estado | Observación |
|---|---|---|---|---|
| COM-01 | Aplicación carga y completa autenticación en navegadores institucionales oficialmente soportados. | Definir navegadores/versiones y guardar resultados por navegador. | Pendiente | El alcance de soporte está por confirmar. |
| COM-02 | Flujos principales operan en resoluciones móvil, tableta y escritorio. | Ejecutar matriz de viewport en navegador y documentar defectos. | Pendiente | No hay evidencia visual de ejecución. |
| COM-03 | Cliente y API manejan JSON, errores y cookies de sesión de forma consistente. | Prueba HTTP/browser con CORS y cookie en origen real autorizado. | Pendiente | `credentials: include` aparece en cliente; falta prueba integrada. |
| COM-04 | Esquema de integración corresponde a migraciones existentes en MySQL 8. | Aplicar solo en DB de prueba desechable autorizada, verificar esquema y guardar salida. | Pendiente | No se ejecutaron migraciones en esta revisión. |
| COM-05 | Configuración de QA no comparte host, esquema ni credenciales con producción. | Revisar preflight, `SHOW GRANTS`, dirección de escucha y variables sin mostrar secretos. | Pendiente | El Compose define aislamiento; verificación en runtime falta. |
| COM-06 | Errores de red/DB y sesión vencida presentan recuperación adecuada al usuario. | Simular pérdida de red, 401 y backend no disponible sin usar producción. | Pendiente | El cliente contiene manejo de 401; no existe resultado de prueba de UX. |

## 6. Estado de pruebas y evidencia conservada

| Evidencia | Resultado exacto disponible | Valor probatorio y limitación |
|---|---|---|
| `suite-unitaria-20261004.log` | 8 tests; 8 pass; 0 fail; 0 skipped; 1.5955784 s; `EXIT_CODE=0`. | Resultado real registrado para suite unitaria. No prueba conectividad ni persistencia MySQL. |
| `suite-completa-20261004.log` | 9 tests principales; 8 pass; 1 fail; la integración aborta en preflight: `DB_HOST debe estar configurada para el entorno local de pruebas`; `EXIT_CODE=1`. | Resultado real. No se conectó a DB ni se ejecutaron subtests HTTP de integración. No equivale a prueba de regresión aprobada completa. |
| Informes locales sobre integración anterior | Resultado comunicado: 8 pass, 0 fail, 1 skip (Estudiante), alrededor de 4.93 s. | No se encontró TAP original ni evidencia adjunta que permita confirmar cada subtest. Mantener como resultado reportado, pendiente de reproducir. |
| Encargo/contexto de usuario | Menciona 8 pass, 0 fail, 1 skip y 4.65 s el 4-oct. | Dato recibido, no corroborado por salida cruda. Hay diferencia de fecha/tiempo frente al informe local. |
| `node --check tests/integration.test.js` y `git diff --check` | Se informó previamente que terminaron con código 0. | Verificaciones estáticas/comprobación de formato, no ejecución de integración. No se reejecutaron para este informe. |

**Resultado de QA de este documento:** no se ejecutaron pruebas ni migraciones. No se declara aprobada la integración. La prueba HTTP de Estudiante sigue omitida por diseño y a la espera de aprobación institucional. La última ejecución completa registrada falló el preflight por configuración ausente; no intentó usar una base ajena.

### Inventario de pruebas disponibles

| Archivo/prueba | Tipo y objetivo | Comando registrado/conocido | Casos representados | Resultado real disponible | Limitación |
|---|---|---|---|---|---|
| `tests/authorization.test.js` | Unitaria: autorización por rol, ausencia de sesión y límites de acceso. | `node --test tests/authorization.test.js tests/security-output.test.js tests/ui-permissions.test.js tests/auth-session.test.js` (como parte de la suite unitaria reportada). | 401 anónimo, denegaciones 403, reglas para perfiles/diagnósticos y rol Estudiante según los casos del archivo. | Incluida en el log unitario: suite 8/8, 0 fallidas/omitidas. | El total es de toda la suite, no hay desglose por archivo en el log citado; no prueba HTTP/DB. |
| `tests/auth-session.test.js` | Unitaria: sesiones/cookies y control de autenticación. | Mismo comando explícito unitario. | Manejo de sesión y cookies malformadas sin exponer detalles. | Incluida en suite 8/8. | No es una prueba integral de persistencia de sesión en MySQL. |
| `tests/security-output.test.js` | Unitaria/seguridad: escape de salida y resultado de mutación/no-op. | Mismo comando explícito unitario. | Escape HTML y detección de operación que no cambió filas. | Incluida en suite 8/8. | No realiza análisis dinámico de todas las vistas. |
| `tests/ui-permissions.test.js` | Unitaria de interfaz: visibilidad condicionada de controles según rol. | Mismo comando explícito unitario. | Visibilidad de acción de creación para roles contemplados por el test. | Incluida en suite 8/8. | No cubre todo el flujo visual ni sustituye autorización del servidor. |
| `tests/integration.test.js` | Integración HTTP + MySQL: autenticación, permisos, alcance docente, PIAR, diagnósticos, anotaciones, registro y validaciones. | `node --test tests/integration.test.js` | Los escenarios están definidos en el archivo; Estudiante HTTP está `skip` por ENUM, con callback vacío. | Resultado de 8 pass/0 fail/1 skip aparece comunicado en documentación (aprox. 4.93 s el 3-oct); el encargo indica 4-oct/4.65 s. No hay TAP original. La suite completa registrada solo falla el preflight. | No presentar el resultado comunicado como ejecución confirmada. Se necesita salida real con ambiente aislado. |
| Suite completa | Unitaria + integración. | `node --test tests/*.test.js` | Descubre todos los `*.test.js`; integración requiere preflight y configuración de DB de test. | Log conservado: 9 top-level; 8 pass, 1 fail por `DB_HOST` ausente; exit 1. | El test de integración no llegó a conectarse ni a iniciar su backend. |

El comando unitario explícito reportado fue `node --test tests/authorization.test.js tests/security-output.test.js tests/ui-permissions.test.js tests/auth-session.test.js`; su registro disponible confirma conteo agregado de 8/8, no resultados separados por archivo.

## 7. Datos, permisos y configuración de pruebas

- Las migraciones definen el esquema de la aplicación. `001_mvp_core.sql` fija cinco roles en el ENUM de usuario y excluye `Estudiante`; no deben alterarse para preparar la prueba sin decisión formal.
- El esquema base y migración se incluyen en configuración de pruebas Compose. El Compose publicado en `127.0.0.1:3307` sirve solo para acceso desde la propia máquina. Esta conclusión es de lectura estática de la asignación de puerto, no de una comprobación de sockets activos.
- La preparación configura base `piar_test` y cuenta `piar_test` con permisos DML limitados a esa base. El script de grants ofrece la definición esperada; una comprobación `SHOW GRANTS` con salida redactada sigue pendiente.
- El arnés ejecuta preflight antes de crear fixtures. Verifica identidad de entorno/esquema, grants y estructura requerida, y prevé borrar por identificadores sintéticos creados por el propio test. Una limpieza prevista no es evidencia de que los datos quedaron limpios: comprobar conteos/residuos tras una futura ejecución y guardar el resultado sin valores personales.
- No se debe usar la base `piar`, el servicio Windows `MySQL80`, Railway ni credenciales productivas. No mostrar valores de `.env.test` o cookies en consola, logs, capturas o este informe.
- Para Estudiante, la alternativa segura actual es conservar la prueba unitaria de la regla de denegación, marcar la integración como Pendiente y solicitar definición institucional documentada. Si se aprueba, especificar rol, permisos, visibilidad de datos y criterios de acceso antes de modificar migración, backend y prueba.

## 8. Hallazgos priorizados y acciones

| ID | Prioridad | Hallazgo | Riesgo/efecto | Acción y responsable sugerido | Estado |
|---|---|---|---|---|---|
| H-01 | Alta | Rol Estudiante no está en ENUM y el subtest HTTP está omitido de forma explícita. | No existe integración con usuario persistido; cualquier cambio unilateral alteraría regla institucional. | Definir formalmente inclusión y permisos; hasta entonces conservar skip y la denegación unitaria. Responsable: autoridad funcional/institucional. | Pendiente de aprobación |
| H-02 | Alta | Expectativa de edición PIAR por Docente en matriz difiere del backend. | Riesgo de aceptar una regla funcional equivocada o bloquear una tarea prevista. | Resolver requisito, documentar decisión y alinear matriz/código/pruebas. Responsable: líder funcional/QA. | Pendiente |
| H-03 | Alta | Ejecución completa registrada no supera preflight por falta de `DB_HOST`; salida de integración previa no está conservada como TAP. | No se puede confirmar con artefacto el resultado HTTP/DB ni limpieza. | En entorno aislado, configurar variable local sin revelar secreto, ejecutar solo test de integración y suite requerida y guardar salida redactada. | Pendiente de ejecución |
| H-04 | Alta | El documento de permisos menciona restauración administrativa, pero no se encontró ruta de restauración actual; reset antiguo devuelve 410. | Requisito documental puede dar falsa expectativa de recuperación. | Confirmar alcance; si se requiere, diseñar flujo separado con autorización, auditoría, respaldo y pruebas. | Pendiente de decisión |
| H-05 | Media | No se encontró flujo aprobado/implementado de vínculo de cuentas privilegiadas a perfiles de Coordinador/Psicóloga. | Aprovisionamiento institucional puede quedar manual o incompleto. | Definir actor, controles y auditoría de vinculación antes de habilitar operación. | Pendiente |
| H-06 | Media | No hay benchmark de rendimiento ni umbrales aprobados. | No es posible afirmar rendimiento suficiente. | Aprobar criterios de REN-01 a REN-05 y medir en entorno sintético reproducible. | Pendiente |
| H-07 | Media | No hay evidencia de compatibilidad/usabilidad o revisión visual registrada. | UX y accesibilidad no quedan validadas por las pruebas unitarias. | Definir matriz de navegadores/dispositivos y ejecutar recorridos con datos sintéticos. | Pendiente |
| H-08 | Media | Compose/grants se han inspeccionado estáticamente, no comprobado en ejecución en esta revisión. | El estado real del entorno local no queda certificado por este informe. | Confirmar Docker, puerto, identidad DB y grants antes del test; no usar datos ajenos. | Pendiente |
| H-09 | Baja | `package.json` indica 1.0.0, informe técnico 1.1, sin tag Git ni declaración oficial de versión. | Ambigüedad en trazabilidad de entregas. | Acordar convención y registrar release/tag aprobado en ciclo posterior. | Pendiente |
| H-10 | Media | En los módulos de autenticación revisados no se identificó endpoint/mecanismo de renovación de sesión; se observa creación, expiración y cierre/revocación. | Si la renovación es requisito, expiración puede cerrar sesiones que deban continuar; si no lo es, la sesión fija puede ser el diseño previsto. | Confirmar política institucional de duración/renovación y agregar caso de prueba solo si se aprueba. Responsable sugerido: seguridad/QA y dueño funcional. | Pendiente de definición |

## 9. Objetivos, evaluación y conclusiones

| Objetivo | Indicador o criterio de evaluación | Evidencia disponible | Resultado | Estado | Observaciones |
|---|---|---|---|---|---|
| Proteger rutas institucionales. | Anónimo recibe 401; respuesta no autorizada no ejecuta operación. | `backend/authorization.js`, `tests/authorization.test.js`, log unitario 8/8; la suite completa falló en preflight antes de integración. | La regla está implementada y hay cobertura unitaria; persistencia HTTP no verificada en la última ejecución registrada. | Cumplimiento evidenciado en pruebas locales unitarias; integración pendiente. | No generalizar al total de rutas sin TAP de integración. |
| Aplicar autorización por roles. | Cada endpoint acepta solo roles permitidos y niega los demás. | Matriz de permisos, backend y unit tests; conflicto Docente/PIAR. | Controles presentes; una decisión de requisito sigue abierta. | Parcial. | Reconciliar código y matriz antes de aceptar esa función. |
| Restringir Docente a PIAR asignados. | Docente no obtiene PIAR/estudiante no asignados. | Rutas backend, authorization tests y escenarios de integración definidos. | Regla estática y pruebas unitarias disponibles; resultado HTTP+DB actual no disponible. | Parcial. | Adjuntar TAP de la integración aislada. |
| Proteger diagnósticos, observaciones y seguimientos. | Verificar rol, relación con PIAR/estudiante y bloqueo de edición/borrado directo. | Backend, matriz, tests unitarios y casos de integración escritos. | Implementación identificada; verificación integral falta. | Parcial. | Conservar evidencia de respuestas y estado antes/después de fixtures sintéticos. |
| Controlar registro y aprobación de cuentas. | Registro público crea Docente pendiente; activación requiere aprobación; rol público no se eleva. | `backend/auth.js`, tests de sesión y escenario de arnés. | Regla visible en código y unidad; ciclo DB reportado, no corroborado con TAP. | Parcial. | Probar alta/activación en DB local aislada. |
| Mantener operaciones permitidas de PIAR. | Coordinador crea/actualiza/cierra y asigna; validaciones y duplicados retornan estados previstos. | `backend/server.js`, authorization y escenarios de integración; mutation test unitario. | Flujos implementados estáticamente; la suite completa no llegó a ejecutarlos. | Parcial. | Adjuntar salida de integración; documentar por separado edición por Docente. |
| Validar rol Estudiante según política aprobada. | Permisos sobre información general sin datos restringidos, según decisión institucional. | ENUM de cinco roles y `skip` explícito; test unitario deniega acceso institucional. | No se realizó integración de un usuario Estudiante y aún no está aprobado su modelo. | Pendiente. | No ampliar ENUM ni presentar el skip como aprobado. |
| Confirmar despliegue/aceptación institucional. | Acta, versión desplegada, fecha y responsable institucional verificables. | No se encontró evidencia suficiente. | No comprobado. | Pendiente. | Requiere acta/evidencia institucional, no basta el árbol local. |

### Conclusión técnica

La causa de la omisión de Estudiante es demostrable: el subtest HTTP fue omitido intencionalmente porque el esquema local acepta cinco roles y no incluye Estudiante; además, su cuerpo es vacío. La limitación es de esquema y de decisión institucional, no de datos faltantes ni de configuración accidental. Mantener la omisión y no cambiar la migración es el resultado seguro. La prueba unitaria de denegación valida solo la política presente y no debe rotularse como integración.

La evidencia disponible permite respaldar 8 pruebas unitarias aprobadas en el registro citado y una definición local de MySQL aislado en Compose. No permite afirmar que la integración actual haya pasado: la suite completa guardada falla en preflight, y el resultado histórico de 8 aprobadas/1 omitida carece del TAP original y tiene discrepancia de fecha/duración. Tampoco hay base para afirmar rendimiento medido, compatibilidad institucional o despliegue.

## 10. Próximas acciones concretas

1. La autoridad funcional documenta si Estudiante será admitido, qué rutas puede usar y a qué datos puede acceder. Hasta entonces: no cambiar el ENUM, reglas ni prueba omitida.
2. El dueño del requisito resuelve si Docente debe crear/editar PIAR asignado y si la restauración administrativa está dentro del alcance.
3. En Windows, confirmar Docker Desktop disponible y levantar únicamente el servicio Compose de prueba definido en el repositorio. Configurar la contraseña local en el archivo ignorado por Git, nunca en comandos guardados, capturas o chat.
4. Verificar puerto loopback, base `piar_test`, usuario y grants restringidos sin imprimir contraseña ni datos. El preflight debe identificar inequívocamente el host local y abortar ante cualquier discrepancia.
5. Ejecutar `node --test tests/integration.test.js` usando exclusivamente `piar_test`; guardar salida TAP y resultado de limpieza. Después ejecutar la suite unitaria y la suite correspondiente. Registrar cuántas pasaron, fallaron y se omitieron tal como ocurrió.
6. Definir y aprobar umbrales de rendimiento, matriz de compatibilidad y protocolo de usabilidad antes de reportar aceptación de esos aspectos.
7. Acordar versión oficial y fecha de instalación institucional; adjuntar acta o evidencia de despliegue antes de completar esos campos.

## 11. Responsabilidades y aprobación

Los nombres y roles indicados como declarados provienen del contexto de trabajo y deben confirmarse con el responsable antes de firma. El repositorio no acredita por sí mismo asignación académica o autoridad institucional.

| Responsable | Rol | Responsabilidad | Estado de participación | Aprobación | Firma | Fecha |
|---|---|---|---|---|---|---|
| Yeisson Fabián Reinoso Rodríguez | Aprendiz y desarrollador principal; Tecnólogo en Análisis y Desarrollo de Software (datos declarados en el encargo) | Preparar cambios, pruebas reproducibles y anexos. | Declarado; requiere validación formal para esta evidencia. | Pendiente | ____________________ | __________ |
| Vivian Beatriz Medina Alvarado | Apoyo en desarrollo y pruebas (rol formal por confirmar) | Revisión cruzada, QA y conservación de evidencias. | Declarado; requiere validación formal para esta evidencia. | Pendiente | ____________________ | __________ |
| Luis Alfonso Becerra | Instructor | Acompañamiento/revisión académica, si corresponde. | Por confirmar para esta evidencia. | Pendiente | ____________________ | __________ |
| Por asignar | Responsable de calidad / QA | Aprobar criterios y validar resultados/no conformidades. | Por asignar. | Pendiente | ____________________ | __________ |
| Por asignar | Administrador institucional | Confirmar reglas de roles, permisos, operación y recuperación. | Por asignar. | Pendiente | ____________________ | __________ |
| Por asignar | Representante institucional | Aceptar formalmente el resultado y cualquier adopción institucional. | Por asignar. | Pendiente | ____________________ | __________ |

**Aprobación técnica:** ______________________________  **Fecha:** ______________  
**Aprobación funcional/institucional:** ______________________________  **Fecha:** ______________  
**Resultado final:** ☐ Aprobado ☐ Aprobado con pendientes ☐ Rechazado ☐ En revisión

## 12. Fuentes de evidencia del repositorio

- `package.json` — nombre y versión declarada del paquete.
- `tests/integration.test.js` — preflight, fixture de cinco roles, subtest omitido de Estudiante, escenarios HTTP y limpieza prevista.
- `tests/authorization.test.js`, `tests/auth-session.test.js`, `tests/security-output.test.js`, `tests/ui-permissions.test.js` — pruebas unitarias relacionadas.
- `database/migrations/000_railway_schema.sql`, `database/migrations/001_mvp_core.sql` — esquema y ENUM de roles.
- `backend/auth.js`, `backend/authorization.js`, `backend/server.js`, `backend/mutation-result.js`, `backend/db.js` — autenticación, autorización, rutas, errores y mutaciones.
- `docker-compose.test.yml`, `database/test-init/03-restrict-test-user.sql`, `.env.test.example`, `.gitignore` — definición estática del entorno de test y exclusión de secretos locales.
- `docs/auditoria-local/MATRIZ-PERMISOS.md` — expectativas documentales por rol; contrastar con las discrepancias detalladas en este informe.
- `docs/seguridad/INFORME_FASE_1_SEGURIDAD.md` y documentos de `docs/auditoria-local/` — antecedentes y resultados reportados; distinguidos aquí de salidas crudas.
- `docs/auditoria-local/evidencia/suite-unitaria-20261004.log` — resultado unitario conservado.
- `docs/auditoria-local/evidencia/suite-completa-20261004.log` — preflight y fallo registrados para la ejecución completa.

**Control de edición:** Este informe se creó como nuevo archivo Markdown. No se modificaron código, migraciones, configuración, archivos de secretos ni permisos institucionales; no se ejecutaron contenedores, migraciones, integraciones, despliegues ni operaciones sobre bases existentes.
# Actualización de implementación — 11 de octubre de 2026

Se añadió el bloque de recuperación de contraseña con token aleatorio, almacenamiento de hash, expiración a 30 minutos, consumo único, cambio con bcrypt y revocación de sesiones. La entrega requiere configuración HTTPS del endpoint institucional de correo y `APP_BASE_URL`; no se probó entrega real. Suite unitaria ejecutada: 12 aprobadas, 0 fallidas. La integración `tests/integration.test.js` se detuvo en preflight por falta de `DB_HOST`, antes de conexión o escrituras; por ello no se declara validación HTTP/MySQL ni aplicación de migración.

Registro con aprobación, administración por roles, gestión de PIAR/estudiantes/diagnósticos/seguimientos y reportes ya están presentes en el estado local. Se conservaron los permisos actuales de Docente; las pruebas unitarias de permisos pasaron, pero los flujos de integración siguen pendientes. El respaldo/restauración segura permanece pendiente de especificación operativa y configuración, sin operaciones de base realizadas.

## Validación dirigida de recuperación — 11 de octubre de 2026

Se corrigió una ubicación de rutas que exigía sesión para endpoints de recuperación. El token ahora viaja como fragmento URL y la app aplica `Referrer-Policy: no-referrer`; backend no registra cuerpos ni tokens. El cambio de contraseña valida `expires_at > CURRENT_TIMESTAMP`, consume de forma condicional y agrupa consumo, hash bcrypt y revocación de sesiones en una transacción.

Ejecución actual: `tests/password-reset.test.js` pasó 5/5; suite unitaria (cinco archivos, sin integración) pasó 13/13; chequeos de sintaxis y `git diff --check` pasaron. Se preparó una prueba sintética HTTP/MySQL que verifica el ciclo y limpia solo las cuentas/token de su fixture. No se ejecutó contra MySQL porque el preflight rechazó la ejecución sin `DB_HOST`; no se aplicó migración. El próximo paso es correr `node --test tests/integration.test.js` desde VS Code con destino aislado `piar_test` y esquema vigente. El envío real requiere configuración privada HTTPS del endpoint de entrega y URL pública HTTPS de la app.

## Authentication and registration continuation — October 11, 2026

### Code observed

The local tree already contains public Teacher registration with bcrypt hashing, `pending_verification` status, a random token stored as a hash with a 24-hour expiry, single-use email confirmation, generic rate-limited resend, Admin/Rector approval or rejection, login for active accounts only, persisted sessions, and a pending-request screen. The synthetic-account seeder is pinned to `127.0.0.1:3307` / `piar_test`, requires explicit opt-in and confirmation, prompts for passwords without echoing them, and has no default credentials.

Email delivery is prepared through a configurable authenticated HTTPS endpoint. Google, Microsoft, and Apple remain disabled: `backend/oidc.js` prepares parts of OIDC, but complete callback routes, identity storage, and account linking are not implemented.

### Validation in this continuation

- Full unit suite, excluding the integration harness that writes MySQL fixtures: **48 passed, 0 failed, 0 skipped** (`node --test` over `tests/*.test.js` except `integration.test.js`).
- `node --check` over JavaScript files in `backend/`, `public/js/`, `scripts/`, and `tests/`: passed.
- `git diff --check`: passed; Git reported LF/CRLF conversion notices on previously modified files.
- Created `docs/MANUAL_USUARIO.md` describing the implemented flows and verification limits.

### MySQL, email, and end-to-end outcome

The effective configuration loaded by `npm start` falls back to local defaults `127.0.0.1:3306`, database `piar`, user `root`, with no password available in this process. The published test port `127.0.0.1:3307` accepted a TCP connection, but `.env.test` has no usable `DB_PASSWORD`; no login or identity/schema query succeeded, so the service could not be confirmed as `piar_test`. Docker is unavailable in this environment.

No migration or integration test was run, and no database writes were made. `APP_BASE_URL`, `PASSWORD_RESET_DELIVERY_URL`, and `PASSWORD_RESET_DELIVERY_SECRET` are not configured in the inspected local files/process; real email delivery was not tested. Account creation, state changes, approval, login/logout, or dashboard loading were not tested against MySQL. No Google, Microsoft, or Apple credentials are configured. Therefore, the traditional flow is implemented and unit-tested, but **end-to-end operation is not confirmed in this environment**.

**Safety limit:** until credentials for an isolated database are supplied and its identity is confirmed as `piar_test` at the fixed test target, do not validate writes through `npm start` against `piar`, apply migrations, or run the integration harness. Provide `DB_PASSWORD` locally and privately; record future test evidence without secrets.
