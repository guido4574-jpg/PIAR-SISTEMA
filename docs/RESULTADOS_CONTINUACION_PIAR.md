> **Documento histórico.** El estado vigente está en `docs/ESTADO_FINAL_PROYECTO.md` (2026-11-22) y las decisiones en `docs/DECISIONES_TECNICAS.md`. Este informe se conserva como registro y puede contradecirlos.

# Resultados de continuación PIAR-SISTEMA — 22 de octubre de 2026

## Revalidación de permisos y modelo pedagógico — 24 de octubre de 2026

- Antes de editar, se revisaron rama/estado, autorización, filtros de `backend/student-access.js`, rutas del servidor, pruebas HTTP, esquema y documentación. Rama: `security/fase-1-hardening`; los cambios locales preexistentes se conservaron.
- En la revisión anterior, `npm.cmd test`: **93 aprobadas, 0 fallidas, 0 omitidas**. Incluía matriz RBAC para Administrador, Rector, Coordinador, Psicóloga, Docente y Estudiante; el acceso docente falla cerrado sin perfil activo único.
- La suite HTTP/MySQL incluye casos de aislamiento entre dos docentes y comprobación de 404 para recursos ajenos. No se ejecutó porque limpia fixtures al terminar. El puerto TCP `127.0.0.1:3307` responde, pero no se autenticó ni escribió en MySQL.
- No hubo cambios de permisos: los controles revisados validan rol en servidor y alcance de Docente por `piar_docente`. Siguen las limitaciones documentadas para vincular Psicóloga y validar/provisionar Rector.
- La revisión pedagógica registró faltantes de estructura de barreras, vínculo por ajuste, evidencias, responsables validados, fechas e indicadores de resultado. Sin diseño aprobado, no se creó migración.
- No se ejecutaron migraciones ni se accedió a `piar`. Correo y OIDC continúan verificados solo con mocks, no con proveedores reales.

## Fortalecimiento del modelo pedagógico — implementación local

- La migración aditiva `008_piar_traceability.sql` agrega barreras contextualizadas, relación opcional barrera-ajuste, usuario responsable validado, resultado/indicador, revisión prevista, evidencia textual con referencia/fecha/autor y relación opcional seguimiento-ajuste. Conserva el contenido anterior; no convierte automáticamente textos libres.
- El backend agrega validación de fechas/contextos, asegura que barrera, ajuste y seguimiento correspondan al mismo PIAR, y limita todo el trabajo docente al PIAR asignado. Evidencias y barreras nuevas son append-only por API.
- El detalle del PIAR incorpora formularios de captura y muestra responsable/autor y relaciones pedagógicas. Las referencias de evidencia son texto; no se suben ni almacenan archivos.
- `npm.cmd test`: **101 aprobadas, 0 fallidas, 0 omitidas**. `node --check` pasó para JavaScript de backend, frontend, scripts y pruebas. `git diff --check` pasó (Git mostró solo avisos existentes sobre conversión LF/CRLF).
- `tests/integration.test.js` ahora contiene casos HTTP/MySQL de la nueva trazabilidad y acceso cruzado. No se ejecutó porque su ciclo normal elimina fixtures; tampoco se ejecutó la migración. La validación de integración queda pendiente tras aplicar 008 a una copia de prueba y ejecutar con retención de fixtures activa.
- La compatibilidad del backend nuevo requiere aplicar 008 manualmente en una base de pruebas compatible antes de validar estas rutas por HTTP/MySQL. La base institucional `piar` no se tocó.

## Estado y cambios de esta sesión

Se inspeccionó la rama `security/fase-1-hardening` y el árbol de trabajo. Ya contenía numerosos cambios locales de seguridad, documentación, frontend, pruebas y migraciones. Se conservaron íntegramente; no hubo checkout, commit, push, reset ni limpieza.

Se cerraron estas brechas:

- La aprobación de Docente crea o reactiva un único perfil `docente` vinculado al usuario dentro de la transacción de aprobación. Los perfiles duplicados revierten la aprobación y requieren revisión institucional.
- Las actualizaciones de diagnósticos, seguimientos y observaciones validan la correspondencia estudiante/PIAR. El docente no puede cambiar esos identificadores mediante petición HTTP.
- Los listados institucionales de datos clínicos y pedagógicos declaran las columnas seleccionadas en vez de usar `SELECT *`.
- La interfaz permite al docente elaborar otro PIAR para un estudiante ya asignado; la API crea también la relación del nuevo PIAR con ese docente y responde con el mismo 404 para estudiantes ajenos o inexistentes. La asignación inicial de un estudiante a un docente sigue siendo institucional.
- Las pruebas de integración ahora comprueban que la aprobación aprovisiona exactamente un perfil vinculado, que el docente puede crear PIAR para estudiantes asignados y recibe denegaciones indistinguibles para estudiantes ajenos o inexistentes. La suite también cubre estudiantes, diagnósticos, observaciones, seguimientos, historial, reportes, dashboard y docentes sin perfil.

## Permisos actuales relevantes

| Recurso | Docente | Gestión institucional |
|---|---|---|
| Estudiantes y PIAR | Lectura y trabajo solo en PIAR/estudiantes con relación activa en `piar_docente`; puede crear otro PIAR para estudiante ya asignado; sin perfil activo o con duplicados, acceso cerrado | Administrador, Rector, Coordinador y Psicóloga según matriz de roles; asignación inicial |
| Ajustes | Crear y actualizar en PIAR asignados; no eliminar ni administrar asignaciones | Roles institucionales autorizados pueden gestionar ajustes |
| Seguimientos y observaciones | Crear en PIAR asignados; lectura por ese alcance; registros existentes son inmutables según la matriz vigente | Creación y lectura según rol; no se habilita edición/eliminación general |
| Diagnósticos | Lectura solo del PIAR asignado; no puede crear, editar ni eliminar | Coordinación/Psicología crean; roles institucionales autorizados editan o eliminan |
| Historial, reportes y dashboard | Resumen y filas filtrados por PIAR asignados; detalle ajeno responde como no encontrado | Acceso institucional conforme a la matriz existente |
| Aprobaciones | Sin acceso | Solo Administrador, pendiente de un proceso institucional para habilitar Rectoría |

La auditoría de acceso registra actor, acción, recurso, resultado y fecha, sin guardar el cuerpo de la petición. Su tabla está definida en `database/migrations/007_piar_audit_events.sql` y requiere que esa migración ya exista en el esquema.

## Referencia pedagógica y normativa

El esquema implementado reutiliza las entidades existentes para contexto, valoración, barreras, informes pertinentes, metas, ajustes, recursos, proyectos, recesos, acta, informe anual, historia y entrega pedagógica. La creación de ajustes no depende automáticamente de un diagnóstico médico. El Decreto 1421 de 2017 y el Decreto 1075 de 2015 enumeran componentes del PIAR y acta/historia escolar; el instructivo de Colombia Aprende aporta orientación instrumental. La minimización y controles técnicos de acceso apoyan el cumplimiento de confidencialidad de la Ley 1581 de 2012; no reemplazan la política institucional ni una revisión legal.

Referencias oficiales:

- [Decreto 1421 de 2017 — Función Pública](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?1=&i=87040)
- [Decreto 1075 de 2015 — Función Pública](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=77913)
- [Instructivo de instrumentos PIAR — Colombia Aprende](https://www.colombiaaprende.edu.co/sites/default/files/files_public/rural-adultos/2_Coleccion_Avanzada_Educacion_para_Jovenes_Adultos_Mayores/3_Estrategias_para_poblacion_con_discapacidad/3-1_PIAR_EPJAM/1_PIAR_Instructivo.pdf)
- [Ley 1581 de 2012 — Función Pública](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=49981)

## Verificaciones realizadas

- `npm.cmd test`: **93/93** pruebas unitarias aprobadas.
- `node --check` para `backend/`, `public/js/`, `scripts/` y `tests/`: **50 archivos**, todos aprobados.
- `git diff --check`: aprobado; Git solo informó avisos LF/CRLF por normalización de archivos ya modificados.
- Pruebas de aprobación, UI y validador de migraciones ejecutadas aparte: aprobadas.
- No se ejecutaron `tests/integration.test.js`, migraciones ni escrituras a MySQL. La integración pide una base aislada `piar_test`, credencial interactiva y crea/limpia fixtures; no estuvo disponible ni verificada en esta sesión.
- No se probaron entrega de correo, Google/Microsoft/Apple reales ni la aplicación en navegador.

## Pendientes para continuar

1. Preparar y verificar una instancia MySQL efímera aislada `piar_test`, concederle los privilegios limitados documentados e ingresar su credencial interactivamente; ejecutar después `npm run test:integration:local`.
2. Comparar el esquema institucional con migraciones 001, 002, 003, 005, 006 y 007, confirmar respaldo y obtener autorización antes de aplicar cualquier cambio. Ninguna migración se ha ejecutado en esta sesión.
3. Validar visualmente en navegador el flujo de docente, accesibilidad, formularios y pantallas en móvil/tableta.
4. Probar SMTP/API de correo y OIDC únicamente con credenciales y cuentas autorizadas; su funcionamiento real no está demostrado.
5. Revisar con la institución si la asignación inicial debe permitir un docente sin PIAR previo. El esquema actual expresa asignación a través de PIAR, por lo que el docente opera dentro de sus asignaciones existentes.
6. La matriz actual mantiene lectura institucional amplia para Administrador, Rector, Coordinador y Psicología. La institución debe validar por escrito si Psicología y Rectoría requieren acceso individual a todos los diagnósticos, historias y PIAR; no hay una relación de asignación específica para Psicología que permita restringir sus casos con el modelo vigente.
7. Los ajustes todavía se guardan con campos generales (área, tipo, estrategia, recursos, responsable, avance y estado). Falta estructurar barrera relacionada, adaptación evaluativa, frecuencia, evidencia y fecha de revisión. No añadí columnas porque cada una exige migración y una revisión del esquema institucional antes de operar.
8. El historial/acta/informe anual y entrega pedagógica tienen campos disponibles, pero todavía no existe un flujo verificado de firmas, PDF o exportación imprimible.

No se declara el sistema listo para producción.
# Continuación de auditoría — 24 de octubre de 2026

- Antes de editar, se revisaron rama/estado, controles de autorización, filtros de `backend/student-access.js`, rutas de `backend/server.js`, suite HTTP de integración, esquema y documentación pedagógica. Rama confirmada: `security/fase-1-hardening`; los cambios locales preexistentes se conservaron.
- `npm.cmd test`: **93 aprobadas, 0 fallidas, 0 omitidas**. Incluye matriz RBAC, cierre por defecto ante perfil docente ausente/inactivo/duplicado y controles unitarios de otras áreas.
- La suite HTTP/MySQL ya incluye comprobaciones de acceso cruzado con dos docentes: la persona no asignada debe recibir 404 y sus identificadores no deben aparecer en listados. No se ejecutó porque escribe fixtures y los elimina al terminar; no se borraron datos de ninguna base.
- `127.0.0.1:3307` respondió en la comprobación TCP, pero no se autenticó ni escribió en MySQL. No se ejecutaron migraciones ni se consultó la base institucional `piar`.
- La revisión pedagógica registró brechas de estructura de barreras, trazabilidad por ajuste, evidencias, responsables validados, fechas e indicadores de resultado. No se inventó una migración sin decisión funcional aprobada.
- Correo y autenticación externa permanecen sin validar con proveedores reales; sus pruebas siguen siendo simuladas.


## Hito de trazabilidad pedagógica MySQL — 24 de octubre de 2026

- Diseño revisado: reutilizar `piar_ajuste.estrategia`, `recursos`, `responsable`, `avance` y `estado`; 008 estructura barrera/contexto, vínculo opcional barrera-ajuste, responsable institucional por `usuario`, resultado e indicador, fecha prevista, evidencia textual con autor/fecha/referencia y seguimiento asociado al ajuste. La fecha efectiva de revisión y resultado observado/acuerdos se conservan en `seguimiento`. No se convierte ni sobrescribe texto histórico.
- En el esquema base, `piar_ajuste.id_ajuste` es PK e `id_piar` apunta a PIAR; `seguimiento.id_piar` permite nulos, y su nuevo `id_ajuste` también es nullable. Por ello la relación compuesta propuesta no invalida filas históricas sin ajuste vinculado. Las tablas nuevas y columnas son aditivas. No se inspeccionó ni consultó la base institucional.
- **No se ejecutó 008**: aunque el paso de aplicación solicita correrla en `piar_test`, la restricción final de esta misma solicitud prohíbe ejecutar migraciones. Se respetó esa restricción; por tanto la migración queda revisada estáticamente, no aplicada.
- Consulta de identidad de solo lectura a `127.0.0.1:3307`: base `piar_test`, MySQL interno `3306`, cuenta `piar_test@%`, `read_only=0`; `SHOW GRANTS` fue aceptado por la validación de alcance limitada a `piar_test.*` y privilegios DML requeridos. No se emitieron escrituras en esta consulta.
- El esquema de pruebas no tiene `piar_barrera` ni `piar_ajuste_evidencia`, ni los campos 008 de barrera/indicador/resultado/revisión prevista. `node --test tests/integration.test.js`, con `PIAR_TEST_KEEP_FIXTURES=1`, falló en el preflight que detecta esas dos tablas faltantes, antes de crear fixtures o iniciar el servidor. Resultado: 0 aprobadas, 1 fallida; no hubo escrituras ni limpieza.
- Se auditaron todas las sentencias de eliminación halladas en `scripts/` y `tests/`: la limpieza general está en `cleanupFixture` (IDs recuperados por marcador/propiedad) y dos borrados de historial/reporte están en un `finally`. Todos son condicionales a `PIAR_TEST_KEEP_FIXTURES !== "1"`; además `cleanupFixture` ahora comprueba la retención por sí misma. Prueba unitaria nueva verifica que solo el valor exacto `1` active retención.
- `npm.cmd test`: **102 aprobadas, 0 fallidas, 0 omitidas**. `node --check`: **54 archivos aprobados**. `git diff --check`: aprobado; solo avisos de normalización LF/CRLF. No hubo migraciones, borrado de registros/fixtures, operaciones con contenedores, commit ni push.
- Pendiente para cerrar la validación HTTP/MySQL: autorizar la aplicación manual y revisable de 008 exclusivamente en `piar_test`; después repetir integración con retención activa para probar persistencia, integridad relacional y autorización cruzada. Correo y OIDC reales siguen sin verificación.

## Reintento autorizado de aplicación 008 — 24 de octubre de 2026

- Se inspeccionó completo `database/migrations/008_piar_traceability.sql`. Solo contiene `CREATE TABLE IF NOT EXISTS`, adición condicional de columnas/índices y claves foráneas; no tiene `DROP`, `DELETE`, `TRUNCATE`, `UPDATE`, `INSERT` ni conversión de filas históricas. Contra el esquema base revisado, `piar_ajuste.id_ajuste` es PK, los nuevos campos FK son nullable en ajustes/seguimientos y los PIAR existentes no se reescriben. No se detectó riesgo de pérdida de datos.
- Preflight solo lectura, configuración fijada a `127.0.0.1:3307/piar_test`: `DATABASE()=piar_test`, MySQL interno `3306`, `CURRENT_USER()=piar_test@%`, versión `8.0.46`, `read_only=0`, roles activos `NONE`. No se consultó `piar` ni se imprimió contraseña.
- `SHOW GRANTS` confirmó únicamente `USAGE` global y `SELECT, INSERT, UPDATE, DELETE` sobre `piar_test.*`. Faltan privilegios DDL (`CREATE`, `ALTER`, `INDEX`, `REFERENCES`); la cuenta `piar_test` no puede aplicar 008. No se intentó ejecutar la migración ni cambiar permisos.
- Docker CLI no está disponible en PATH y la consulta GET de solo lectura a la API local del motor para `/containers/piar-mysql-test/json` devolvió `EPERM`. El compose declara el nombre `piar-mysql-test` y mapea `127.0.0.1:3307:3306`, pero no fue posible demostrar el nombre del contenedor activo. Por las condiciones de identidad/permisos, la migración no se aplicó.
- Verificación actual de esquema: siguen faltando `piar_barrera`, `piar_ajuste_evidencia` y los campos/índices 008. No se crearon, borraron ni limpiaron fixtures ni se recrearon/eliminaron contenedores.
- Integración HTTP/MySQL con `PIAR_TEST_KEEP_FIXTURES=1`: **0 aprobadas, 1 fallida**, detenida en preflight por las dos tablas faltantes antes de escrituras, backend HTTP o limpieza. La guarda central y los condicionales de borrado siguen protegiendo la retención.
- Para continuar sin relajar el usuario requerido: un operador con acceso al motor debe confirmar que el destino es `piar-mysql-test` y conceder temporalmente a `piar_test` permisos DDL limitados a `piar_test.*`; aplicar 008 con la conexión esperada; retirar esos permisos para restaurar el alcance DML; repetir la consulta de identidad y ejecutar integración reteniendo fixtures. Alternativamente, se necesita autorización explícita para usar una cuenta DDL distinta sobre el mismo contenedor/base.

- **Corrección de verificación del contenedor:** después de la comprobación inicial `EPERM`, se autorizó y ejecutó un GET de solo lectura en la API local de Docker. Confirmó `/piar-mysql-test` en estado `running`, ID `e85a7788ab9e` coincidente con `@@hostname` y puerto publicado `127.0.0.1:3307`. La identidad exigida sí está comprobada; permanece el bloqueo de permisos DDL de la cuenta `piar_test`.

## Hito de aplicación y validación de migración 008 — 24 de octubre de 2026

- Inspección del SQL completo: 46 sentencias una vez separadas con la misma estrategia de `backend/run-migration.js`; el archivo no contiene DML de escritura ni sentencias destructivas. Usa `CREATE TABLE IF NOT EXISTS` y verificaciones de `information_schema` para omitir columnas, índices y FKs ya presentes, por lo que admite una segunda ejecución después de completarse. La idempotencia es por nombre/objeto existente; si un objeto preexistente tuviera una definición incompatible, no lo repara, razón por la que se validó el esquema resultante.
- Antes de aplicar, consulta de solo lectura con `piar_test`: contenedor MySQL coincide por `@@hostname=e85a7788ab9e`, base `piar_test`, usuario `piar_test@%`, `read_only=0`; `piar_ajuste` tenía 0 filas y `seguimiento` 4. La nueva columna nullable `seguimiento.id_ajuste` conserva esos registros sin relación nueva. Docker GET confirmó `/piar-mysql-test` activo y puerto publicado `127.0.0.1:3307`.
- La primera ejecución del procedimiento se detuvo antes de conectarse porque una comprobación local esperaba 31 sentencias; el parser contó 46. No ejecutó SQL. Corregido el conteo, la conexión administrativa validó `DATABASE()=piar_test`, `root@%`, el mismo ID de servidor y privilegios DDL. Se ejecutaron las 46 sentencias correctamente solo contra `piar_test`. Root no se usó para la aplicación ni para pruebas HTTP. No se modificaron permisos, cuentas ni contraseñas.
- Verificación posterior con el usuario `piar_test`: tablas InnoDB `piar_barrera` y `piar_ajuste_evidencia`; **22 columnas** esperadas, **6 índices** esperados y **7 claves foráneas** esperadas, incluidos los vínculos compuestos PIAR-barrera y PIAR-ajuste.
- `node --test tests/integration.test.js`, con `PIAR_TEST_KEEP_FIXTURES=1`: **12 aprobadas, 0 fallidas, 1 omitida** (caso HTTP de Estudiante, rol que no admite el ENUM local y cuya denegación se prueba en unitarias). Incluye persistencia y lectura HTTP de barrera, ajuste, evidencia y seguimiento; enlaces del mismo PIAR; denegaciones de acceso cruzado docente y restricciones de modificación/eliminación con trazabilidad. Una consulta posterior con `piar_test` confirmó que quedaron retenidos 1 barrera, 1 ajuste, 1 evidencia y 1 seguimiento integrados y correctamente relacionados. No se borraron fixtures.
- `npm.cmd test`: **102 aprobadas, 0 fallidas, 0 omitidas**. La salida incluyó el caso esperado de fallo de entrega de correo sintético; no constituye validación de SMTP real.
- `node --check`: **54 archivos aprobados** en backend, `public/js`, scripts y tests. `git diff --check`: aprobado tras esta actualización documental, con avisos LF/CRLF existentes.
- No se tocaron `piar`, otros contenedores, cuentas, permisos ni contraseñas; no hubo commit ni push.

## Hito de interfaz pedagógica y accesibilidad — 24 de octubre de 2026

- Se comprobó la disponibilidad de navegador con la herramienta de escritorio: Microsoft Edge no aparece instalado/disponible como aplicación ni en la lista de navegadores admitidos (la lista está vacía). No se volvió a intentar Firefox. Por eso no se hizo validación visual ni interacción manual con navegador.
- La instancia local existente respondió `GET /api/health` con `{"status":"ok"}` antes de detenerla para liberar 8081 a la suite HTTP. Se levantó con variables de `.env.test` comprobadas silenciosamente: `127.0.0.1:3307`, base `piar_test`, usuario `piar_test`. Las pruebas también confirman la identidad SQL de `piar_test` y la cuenta limitada; no se consultó ni tocó `piar`.
- Se probó `node --test tests/integration.test.js` con `PIAR_TEST_KEEP_FIXTURES=1`: **12 aprobadas, 0 fallidas, 1 omitida**. La integración ejercitó vía HTTP y MySQL persistencia y lectura de barreras, ajustes, evidencias y seguimientos relacionados al mismo PIAR; validación de relaciones, límites docentes, rechazo cruzado, y restricciones de modificación/eliminación. La omisión de Estudiante es esperada porque el ENUM de `piar_test` contiene cinco roles institucionales; su denegación está cubierta en unitarias. No se limpiaron fixtures.
- `npm.cmd test`: primer intento **105 aprobadas, 1 fallida** por un mock DOM antiguo que no representaba `document.querySelector`, requerido por el modal accesible. Se actualizó el mock sin alterar producción y se repitió: **106 aprobadas, 0 fallidas, 0 omitidas**.
- `node --check`: **54 archivos JavaScript**, 0 fallos. `git diff --check`: aprobado; Git muestra avisos LF/CRLF en archivos modificados, sin errores de whitespace.
- Las regresiones de interfaz comprueban asociaciones label/control, campos obligatorios, diálogo y navegación de foco por teclado, foco visible, mensajes ARIA de estado/error, `aria-busy`, prevención de doble envío y bloqueo cliente de PIAR fuera del conjunto cargado. La autorización efectiva y el acceso docente se probaron además en servidor con la integración. No se afirma una comprobación visual de esos estados porque Edge no estuvo disponible.
- Para el ensayo manual anterior se creó en `piar_test` un fixture sintético de docente asignado y PIAR; quedó retenido junto con los fixtures de integración. No se borraron registros, contenedores ni archivos y no se ejecutaron migraciones.

### Siguiente hito

Validación visual y teclado real del flujo de barrera → ajuste → evidencia → seguimiento con un navegador admitido, más comprobación del estado renderizado y mensajes en pantalla. Mantener la API HTTP/MySQL como evidencia automatizada y continuar reteniendo fixtures mientras `PIAR_TEST_KEEP_FIXTURES=1`.

## Hito de flujo institucional de usuarios — 24 de octubre de 2026

### Estado comprobado

- `POST /api/auth/register` crea únicamente una solicitud de Docente en estado `pendiente_verificacion`, con contraseña bcrypt y token de verificación almacenado como hash. La verificación consume el token y cambia el estado a `pendiente`; no crea sesión ni activa la cuenta. El inicio de sesión exige `estado='activo'`.
- La aprobación/rechazo está en `POST /api/usuarios/:id/aprobacion`, dentro de transacción. Solo admite solicitudes de rol Docente, verificadas y pendientes. Al aprobar, crea o reactiva exactamente un perfil `docente` enlazado por `id_usuario` antes de activar la cuenta; si detecta perfiles duplicados, revierte y responde conflicto. Al rechazar, no crea perfil. El perfil asociado y su asignación PIAR son relaciones distintas: la aprobación crea el perfil, mientras la asignación de estudiantes/PIAR la realizan Administrador, Rector o Coordinador por el flujo específico; un Docente puede crear PIAR para estudiantes ya vinculados a su ámbito.
- Defecto corregido: el registro aceptaba silenciosamente `rol=Administrador`, Rector, Coordinador o Psicóloga y degradaba la solicitud a Docente. Aunque no otorgaba privilegios, podía confundir al solicitante. Ahora cualquier rol explícito distinto de Docente se rechaza con 400 antes de acceso a base de datos. La ruta administrativa `/api/usuarios` conserva la misma restricción; no permite crear cuentas privilegiadas ni cambiar rol/estado directamente.

### Matriz efectiva revisada en autorización del servidor y pruebas

| Rol | Capacidades confirmadas | Límites relevantes |
|---|---|---|
| Administrador | Consulta usuarios, aprueba/rechaza solicitudes Docente; gestiona estudiantes y perfiles docentes; opera PIAR y funciones institucionales autorizadas | La cuenta se administra mediante aprovisionamiento local protegido; la ruta general no crea otros roles |
| Rector | Acceso institucional y gestión de estudiantes/perfiles docentes y PIAR según las rutas autorizadas | No consulta usuarios ni decide solicitudes. No hay flujo validado para aprovisionar o verificar la identidad de una cuenta Rector |
| Coordinador | Gestión de estudiantes, perfiles docentes y asignaciones; creación de diagnósticos, edición de PIAR, seguimientos y funciones de coordinación | No administra cuentas ni aprueba solicitudes de registro |
| Psicóloga | Lectura institucional y creación/edición/eliminación de diagnósticos; edición PIAR permitida por la matriz | No administra estudiantes, perfiles docentes ni cuentas. `psicologa` no tiene `id_usuario`; no existe vinculación profesional única verificable ni aprovisionamiento autorizado de su cuenta |
| Docente | Solo un perfil activo único enlazado a la cuenta; acceso a estudiantes/PIAR con asignación activa, trabajo pedagógico y notas permitidas | Sin perfil ausente, inactivo o duplicado se deniega. No gestiona cuentas, perfiles, estudiantes ni asignaciones; el backend verifica el alcance, no confía solo en la UI |

Las comprobaciones reflejan la política codificada actual, no una aprobación institucional del alcance global de acceso a historias y diagnósticos. Rectoría y Psicología siguen siendo bloqueos reales de identidad/aprovisionamiento: no se debe habilitar su aprobación de cuentas o vinculación por semejanza de correo, entrada libre de rol ni SQL manual en producción. Para resolverlos se requiere definir autoridad verificadora, evidencia/registro de aprobación, recuperación/desactivación, perfil profesional y relación única cuenta-perfil; cualquier cambio de esquema requeriría un hito y autorización separados.

### Pruebas de este hito

- Pruebas focalizadas de registro, RBAC, aprobación y UI: **25 aprobadas, 0 fallidas, 0 omitidas**.
- `node --test tests/integration.test.js`, con `PIAR_TEST_KEEP_FIXTURES=1` y destino verificado `127.0.0.1:3307/piar_test`: **12 aprobadas, 0 fallidas, 1 omitida**. El caso omitido es Estudiante, ausente del ENUM de los cinco roles institucionales y cubierto por pruebas unitarias. Se comprobó el rechazo HTTP de una solicitud Administrador sin insertar fila, verificación sin activación, aprobación con perfil enlazado, acceso docente asignado/no asignado y permisos por rol. La entrega de correo fue simulada por servidor local de prueba; no valida SMTP/correo real.
- `npm.cmd test`: **107 aprobadas, 0 fallidas, 0 omitidas**.
- No se ejecutaron migraciones, no se tocaron `piar`, no se borraron fixtures ni registros. Sin commit ni push.

### Siguiente hito

Acordar con la institución y documentar el procedimiento de aprovisionamiento de Rectoría y Psicología, incluida la autoridad que valida identidad y la relación cuenta-perfil de Psicóloga. Después diseñar y revisar por separado la implementación mínima, sus permisos y pruebas de aceptación antes de cualquier cambio de esquema.

## Diseño técnico condicionado: aprovisionamiento de Rectoría y Psicología — 24 de octubre de 2026

**Estado: propuesta para revisión institucional; ninguna opción de política en esta sección está aprobada ni implementada.** Esta revisión se limita a identidad, ciclo de vida y alcance de Psicología; conserva la matriz actual y no ejecuta migraciones.

### Diagnóstico técnico comprobado

- `usuario` es el principal de autenticación y contiene rol, estado, correo verificado y contraseña hash. La restricción única cubre documento y correo. El registro público crea solo solicitudes Docente; verificar correo las deja `pendiente`; aprobar/rechazar exige una solicitud Docente pendiente verificada. El login crea sesión solo para `activo`.
- Las columnas `aprobado_por_usuario_id`, `rechazado_por_usuario_id` y `decision_at`, agregadas por la migración 002, guardan el actor y la fecha de la decisión vigente de una solicitud. La aprobación de Docente crea/reactiva el perfil enlazado dentro de la misma transacción. Perfiles duplicados bloquean el proceso. El API de perfiles Docente rechaza `id_usuario` para impedir vínculos ad hoc.
- `docente.id_usuario` es nullable, tiene FK e índice, pero no restricción `UNIQUE`; la aplicación resuelve perfil Docente faltante, inactivo o duplicado con denegación por defecto. La tabla `psicologa` no tiene `id_usuario`; `coordinador` tampoco. No hay tabla `rector`. No existe por tanto una relación de base para comprobar que una cuenta Rector/Psicóloga corresponde a un único perfil institucional.
- El backend restringe las rutas de usuarios y aprobación a Administrador. Rectoría no puede consultar solicitudes ni aprobarlas. `/api/usuarios` solo crea cuentas Docente y las ediciones directas de rol/estado son rechazadas. La pantalla de solicitudes también está limitada a Administrador.
- La recuperación actual es autoservicio por token enviado al correo de una cuenta activa; al cambiar contraseña revoca sus sesiones. El Administrador puede desactivar una cuenta mediante estado `inactivo`; las consultas de sesión descartan cuentas no activas. No hay flujo de recuperación asistida, bloqueo temporal institucional ni reactivación de cuentas especiales aprobado por el producto. El cierre de cuenta no añade hoy un evento de actor a la fila de usuario.
- `piar_auditoria` registra metadatos de rutas PIAR/estudiante/diagnóstico/seguimiento y otras rutas pedagógicas, no eventos de `/api/usuarios` ni del ciclo de vida `/api/auth`. Por tanto no es una bitácora completa de aprovisionamiento de cuentas. Los campos actuales de usuario reflejan la última decisión Docente, no un historial inmutable general de altas, recuperaciones, bloqueos y desactivaciones.
- La matriz actual reconoce capacidades de Psicóloga por el valor de rol. No hay vínculo profesional comprobable ni alcance Psicóloga por estudiante/PIAR. Las rutas de lectura institucional permiten alcance amplio según la matriz existente; no se propone ampliarlo. `diagnostico.id_usuario_creador` registra la cuenta que crea el diagnóstico, pero no sustituye la relación cuenta-perfil Psicóloga.

### Decisiones que debe tomar la institución

| Decisión | Pregunta que debe quedar aprobada y documentada |
|---|---|
| Identidad de Rectoría | ¿Qué cargo/dependencia valida identidad, vinculación vigente y facultad de Rectoría? ¿Qué evidencia se conserva y quién autoriza el rol? ¿Se exige separación entre solicitante y aprobador y cómo se reemplaza una Rectoría? |
| Ciclo de cuenta especial | ¿Quién puede solicitar, aprobar, crear, recuperar, bloquear temporalmente, desactivar y reactivar cuentas Rector/Psicóloga? ¿Qué canal de recuperación asistida se acepta y qué segundo control verifica al solicitante? ¿Qué evento fuerza revocación de todas las sesiones? |
| Perfil Psicóloga | ¿Qué registro institucional/profesional es la fuente autoritativa? ¿Puede existir más de una psicóloga y una cuenta por perfil? ¿Cómo se resuelven perfiles existentes sin inferir identidad por correo o nombre? |
| Alcance de Psicología | ¿Puede consultar todos los casos de la institución o solo estudiantes/PIAR asignados? ¿Quién realiza esas asignaciones y cómo se retiran? ¿Qué alcance aplica a diagnósticos, listados, detalle, reportes, exportaciones, historial y dashboard? ¿Existe acceso de emergencia y qué auditoría requiere? |
| Trazabilidad y conservación | ¿Qué actor aprueba cada rol, qué catálogo de decisiones/motivos se permite, quién consulta la bitácora y por cuánto tiempo se conserva? No registrar contraseñas, tokens ni datos clínicos en eventos de cuenta. |
| Primer Administrador y delegación | ¿Qué autoridad habilita el primer Administrador en cada instalación y cómo se registra esa autorización? El bootstrap técnico local no define por sí solo la autoridad institucional ni un procedimiento de producción. |

Hasta resolver estas preguntas, se mantienen los rechazos actuales para crear/aprobar roles especiales y no se infiere relación profesional ni ámbito a partir de correo, documento, nombre o tabla heredada.

### Procedimiento seguro propuesto, sujeto a aprobación

1. **Solicitud y validación:** abrir una solicitud interna identificada para Rectoría o Psicología; verificar identidad y facultad con la fuente institucional que se apruebe. No habilitar selección de rol privilegiado en el registro público.
2. **Autorización:** un actor autorizado distinto del titular (si así lo decide la institución) registra aprobar/rechazar, rol solicitado, referencia/motivo codificado y fecha. La regla de segregación, sustitución y número de aprobadores queda pendiente de decisión.
3. **Aprovisionamiento atómico:** crear/activar usuario y asociar el perfil institucional en una transacción; comprobar rol esperado, estado vigente del perfil y unicidad de ambos lados antes del cambio. Nunca enlazar solo por igualdad de email.
4. **Activación y acceso:** requerir verificación del canal de autenticación aprobado; aplicar `activo` al final del proceso. Evaluar autorización del servidor en cada endpoint y filtrar cada listado/detalle/reporte por el alcance aprobado, con denegación por defecto para relaciones ausentes o ambiguas.
5. **Recuperación:** conservar el autoservicio actual por correo para cuentas activas si la institución lo mantiene. Para apoyo asistido, primero aprobar verificación de identidad y operador; usar token de un solo uso, caducidad corta, evento de auditoría y revocación de todas las sesiones tras recuperar credenciales. No cambiar contraseñas directamente desde el panel administrativo.
6. **Bloqueo/desactivación:** habilitar solo a actores aprobados, registrar actor/fecha/decisión, desactivar sin borrar el perfil ni la historia y revocar sesiones en la misma transacción. Definir separadamente si existe bloqueo temporal, motivos, expiración y reactivación; no confundirlo con `rechazado` ni con el rate limit de login.

### Propuesta de arquitectura y esquema futuro

Mantener `usuario` como principal y las tablas de perfil existentes. Si la institución aprueba las cardinalidades, una migración **aditiva** posterior podría:

- Añadir `psicologa.id_usuario INT NULL`, FK a `usuario` y `UNIQUE(id_usuario)`. El `NULL` preserva perfiles históricos no reconciliados; MySQL permite múltiples NULL con índice único. Tras el inventario, considerar `docente.id_usuario UNIQUE` para que la base garantice el uno-a-uno que hoy solo valida la aplicación. No borrar duplicados automáticamente: primero listarlos y resolver cada caso con responsable institucional.
- Crear un perfil mínimo `rector` con PK, `id_usuario NOT NULL UNIQUE` y FK a `usuario`, **solo** si se aprueba que Rectoría tenga una relación de perfil y se define su cardinalidad. No copiar documento/correo si ya viven en `usuario`; otros datos del perfil requieren decisión de minimización.
- Evaluar de forma consistente la relación de `coordinador` con `usuario`, que también falta, antes de afirmar que todos los roles de personal tienen identidad profesional vinculada.
- Conservar las columnas de última decisión actuales por compatibilidad. Para historia completa, añadir una tabla append-only propuesta `usuario_evento_cuenta`: identificador, usuario afectado, actor que ejecuta/autoriza (nullable solo para bootstrap de sistema con referencia explícita), rol al momento, acción/decisión, motivo codificado aprobado, resultado y timestamp; FKs a usuario, índices por sujeto/actor/fecha y sin borrado en cascada. Registrar eventos desde rutas transaccionales de alta, decisión, cambio de perfil, recuperación asistida y desactivación/reactivación. No guardar secretos ni contenido de salud.
- Si Psicología queda limitada a casos asignados, añadir una relación explícita y vigente de perfil Psicóloga con PIAR/estudiante (con actor, fechas de inicio/fin y estado conforme a política aprobada), o el modelo institucional de alcance elegido. Añadir filtros servidor a rutas de colección, detalle, búsqueda, reportes, historial y descargas; la UI no es un control de seguridad.

Antes de preparar una migración real: inspeccionar duplicados y huérfanos, generar consulta de impacto, acordar tratamiento de cada fila, probar migración en `piar_test`, verificar FKs/índices/rollback operativo y obtener aprobación. Esta sesión no realiza esa migración ni cambios de datos.

### Pruebas de regresión propuestas

- Solicitudes de rol especial por registro público/administrativo y elevación mediante edición: denegadas sin inserción/actualización; solo roles aprobados pueden aprovisionar el rol correspondiente.
- Cuenta verificada permanece `pendiente`; no puede iniciar sesión antes de autorización; decisión rechazada/inválida/repetida y actor no autorizado no crea sesión ni perfil.
- Aprobación concurrente produce un perfil único; perfil duplicado, rol discordante, perfil inactivo o usuario ya asociado revierte la transacción. Índice UNIQUE rechaza segundo vínculo aun fuera del flujo API.
- Vincular Psicóloga a perfil ajeno, duplicado, inactivo o de rol distinto es denegado; la auditoría conserva actor, sujeto, acción y tiempo sin credenciales.
- Para cada alcance de Psicología que apruebe la institución: pruebas HTTP de lista, búsqueda, detalle, diagnóstico, seguimiento, historial, dashboard y reportes para caso permitido y caso de otro ámbito; sin asignación, acceso denegado.
- Recuperación inválida/expirada/reutilizada no cambia estado; recuperación válida invalida sesiones previas. Desactivación bloquea sesiones existentes, las revoca y deja evento con autor; la reactivación sigue el proceso aprobado.

### Validación de este diseño

Esta entrega implementa solo documentación de diagnóstico y propuesta; no modifica código de aplicación ni esquema. `npm.cmd test`: **107 aprobadas, 0 fallidas, 0 omitidas**. `node --test tests/integration.test.js`, con destino comprobado `127.0.0.1:3307/piar_test` y `PIAR_TEST_KEEP_FIXTURES=1`: **12 aprobadas, 0 fallidas, 1 omitida** (Estudiante no forma parte del ENUM de prueba; su denegación se cubre en unitarias). `node --check` en `backend/auth.js`, `backend/authorization.js`, `backend/registration-approval.js` y `backend/primary-admin-bootstrap.js`: aprobado. `git diff --check`: aprobado, con avisos de normalización LF/CRLF existentes.

La integración ejecutó escrituras sintéticas requeridas por el flujo HTTP únicamente en `piar_test`; los fixtures quedaron retenidos y no se limpiaron. No se ejecutaron migraciones ni se modificó `piar`.
## Auditoría de brechas frente a requisitos institucionales — 25 de octubre de 2026

### Alcance y base de evaluación

Se revisó el árbol Git antes de iniciar: rama security/fase-1-hardening, con numerosos cambios staged/unstaged y archivos nuevos preexistentes. Se preservaron; esta auditoría solo añade esta sección documental. La evidencia se contrastó en backend/server.js, módulos de autenticación/autorización, migraciones 001–008, interfaz public/js/app.js, pruebas listadas abajo y la documentación MANUAL_TECNICO_PIAR.md y seguridad/REVISION_PEDAGOGICA_Y_ACCESO_PIAR.md. Los estados describen comportamiento respaldado por el código actual, no aceptación institucional ni disponibilidad productiva.

En el material recibido para este hito constan los requisitos enumerados por el usuario, pero no actas ni respuestas institucionales que resuelvan sus opciones de política. Se consideran confirmados únicamente los límites ya expresados en la documentación técnica vigente (por ejemplo, el registro público solo solicita rol Docente y la recuperación por correo existe). El alcance de Psicología, autoridad y fuente de validación de planta, acciones que exigen doble aprobación, formalidad de acuerdos familiares, conservación documental y objetivos de recuperación de copias siguen sin decisión institucional registrada. No se infieren plazos legales.

### Matriz de cumplimiento

| Requisito | Estado | Evidencia y brecha comprobada |
|---|---|---|
| Administración de roles y aprobación de cuentas | **PARCIAL** | backend/authorization.js y registration-approval.js; rutas /api/usuarios y /api/usuarios/:id/aprobacion en backend/server.js. El registro/decisión de Docente requiere verificación de correo y aprobación Administrador; la aprobación aprovisiona perfil docente en transacción. No hay flujo de alta validada para Rectoría/Psicología/Coordinación ni historial inmutable general de decisiones. |
| Validación de docentes y psicólogos contra la planta oficial | **PENDIENTE** | backend/pedagogical-validation.js valida estructura/estado de relaciones de responsables, no consulta una planta oficial ni fuente de RR. HH. La aprobación usa identidad declarada y correo verificado; no verifica vínculo laboral. psicologa carece de enlace a usuario; no existe identidad profesional única verificable. |
| Recuperación y desactivación de cuentas | **PARCIAL** | backend/auth.js: tokens de recuperación de un solo uso guardados como hash, vencimiento, respuesta genérica y revocación de sesiones; server.js desactiva usuarios con estado inactivo. Falta recuperación asistida/validación de identidad especial y la desactivación de usuario no registra actor/razón en un historial de cuenta. |
| Registro y actualización de estudiantes | **IMPLEMENTADO** | POST/PUT /api/estudiantes en backend/server.js, con restricciones por rol en authorization.js; tests/authorization.test.js cubre quién administra perfiles. No acredita reconciliación contra matrícula oficial ni importación. |
| Importación masiva de estudiantes | **PENDIENTE** | No se encontró ruta, servicio, parser ni interfaz de carga CSV/Excel; las rutas encontradas crean y actualizan un estudiante por petición. |
| Varios docentes asignados a un PIAR | **IMPLEMENTADO** | Tabla puente piar_docente en migración 001; rutas de lectura, alta y retiro en backend/server.js (/api/piar/:id/docentes); vista de detalle muestra docentes. La relación permite más de un docente por PIAR y la autorización docente filtra por esa relación. La asignación inicial de estudiantes sigue requiriendo una operación institucional. |
| Delegación temporal autorizada con alcance y vencimiento | **PENDIENTE** | No hay entidad/ruta de delegación, atributos de vigencia/alcance ni middleware que aplique delegación. piar_docente es asignación ordinaria, no delegación temporal ni evidencia de autorización delegante. |
| Psicología limitada a casos asignados y protección sensible | **PARCIAL** | authorization.js concede a Psicología lectura institucional amplia y creación de diagnósticos; student-access.js sí delimita docentes asignados. server.js usa proyecciones explícitas en recursos de salud; migración 007 registra metadatos de acceso sin cuerpo clínico. No existe asignación Psicóloga-caso ni filtro equivalente en lista, detalle, diagnóstico, reporte, historial y dashboard. |
| Revisión, aprobación, seguimiento, reapertura justificada, versionado y archivo anual de PIAR | **PARCIAL** | piar.estado, fecha_revision, seguimientos y campos de ciclo anual (migración 006); interfaz ofrece estados activo/revisión/cerrado y seguimiento. backend/server.js actualiza estado y contenido por PUT, sin transición aprobatoria dedicada, motivo obligatorio para reabrir, snapshots/versiones inmutables o proceso de archivo anual. historial_detalle admite valores anterior/nuevo en esquema base, pero su listado actual no los expone y no acredita control completo de versiones. |
| Registro de acciones sensibles y correcciones con historial | **PARCIAL** | Migración 007 y middleware en backend/server.js registran actor, acción, recurso, resultado, estado HTTP y fecha para recursos pedagógicos, sin payload. historial_detalle tiene columnas de descripción y valores anterior/nuevo (001), pero el historial de cambios no acredita cobertura uniforme de correcciones; /api/usuarios y /api/auth no están incluidos en las rutas auditadas por middleware. |
| Doble aprobación para acciones críticas definidas institucionalmente | **REQUIERE DECISIÓN** | Aprobación docente actual requiere un solo Administrador (registration-approval.js). No existe un flujo de dos aprobadores. La institución no ha identificado en la evidencia recibida qué acciones son críticas, quiénes pueden aprobar ni si se requiere segregación; después de resolverlo habrá que implementar y probar las acciones acordadas. |
| Aceptación familiar de acuerdos con evidencia verificable | **PENDIENTE** | piar.acta_acuerdos (migración 006) y formulario de texto en public/js/app.js guardan contenido, no identidad autenticada del acudiente, firma, fecha de aceptación, integridad verificable ni constancia de entrega. No se debe presentar el texto del acta como aceptación verificable. |
| Correo transaccional, recuperación segura y posible inicio de sesión con Google | **PARCIAL** | backend/email.js implementa transporte SMTP/API y modo memoria local; auth.js implementa verificación y recuperación segura por token. backend/oidc.js, migración 003 y UI incluyen Google OIDC y vinculación explícita; pruebas email-delivery.test.js, password-reset.test.js y oidc.test.js usan adaptadores/mocks. No se configuró ni probó proveedor real; Google es posible técnicamente, pero su habilitación y política de vinculación/identidad siguen pendientes. |
| Copias de seguridad, restauración y separación de pruebas/producción | **PARCIAL** | Configuración explícita de destino y pruebas aisladas piar_test (database-config.js, .env.test.example, docker-compose.test.yml, pruebas de configuración) reducen riesgo de que las pruebas apunten a producción. No se encontró procedimiento automatizado/verificado de respaldo y restauración, ensayo de recuperación ni evidencia de despliegues/credenciales separados en producción. |

### Riesgos prioritarios

1. **Exposición de datos sensibles (alto):** Psicología y otros roles institucionales leen colecciones amplias; no hay asignación clínica por caso. Los filtros docentes y la auditoría de metadatos están implementados, pero no corrigen ese alcance.
2. **Identidad y duplicación de perfiles (alto):** no hay cotejo con planta oficial ni vínculo verificable Psicóloga-usuario; docente.id_usuario permite duplicados a nivel de esquema y la aplicación solo falla cerrada al resolverlos.
3. **Alteración sin versión recuperable (alto):** el PIAR se sobrescribe mediante PUT, sin bloqueo de aprobación ni motivo de reapertura/versiones completas. La bitácora 007 es de metadatos y no permite reconstruir el contenido corregido.
4. **Recuperación/desactivación con trazabilidad incompleta (alto):** el autoservicio por token revoca sesiones al recuperar contraseña; la baja de usuario no deja evento de actor/causa y no existe procedimiento para cuentas especiales.
5. **Evidencia de participación familiar (alto para cierre institucional):** texto libre de acta no prueba quién aceptó ni cuándo.
6. **Continuidad operativa (alto):** no hay evidencia de restauración probada ni separación de secretos/recursos de producción; una copia no restaurada no acredita recuperabilidad.
7. **Gobierno de aprobaciones (depende de decisión):** doble control sin acciones y autoridad definidos no puede especificarse de forma segura.

### Ruta recomendada por fases y dependencias

| Fase | Prioridad/dependencia | Trabajo posterior | Pruebas de aceptación verificables |
|---|---|---|---|
| 0. Decisiones institucionales | Bloquea fases 1–4 | Aprobar fuente/autoridad para validar planta y perfiles; alcance exacto Psicología; roles y segregación de aprobadores; eventos críticos sujetos a doble aprobación; reapertura/versionado/archivo; aceptación familiar; delegación y revocación; recuperación asistida; política de respaldo/retención. | Decisiones registradas con autoridad responsable; sin inventar plazos legales. |
| 1. Identidad y ciclo de cuenta | Riesgo alto; depende de fase 0 | Vincular/provisionar roles desde fuente autorizada, reconciliar duplicados/huérfanos sin borrarlos automáticamente, auditar altas/cambios/aprobaciones/bajas/recuperaciones y validar contra planta. Revisar cualquier migración aditiva en piar_test. | Planta válida/inválida/duplicada; rol discordante y perfil inactivo rechazados; aprobación crea vínculo único; baja revoca sesiones y genera evento sin secretos. |
| 2. Autorización y delegación de datos | Alto; depende de identidades y fase 0 | Aplicar alcance Psicología aprobado a cada consulta y reporte; delegación con delegante, autorizado, recursos/acciones, inicio/fin y revocación; evitar acceso global accidental. | Pruebas HTTP de listas/detalle/búsqueda/diagnóstico/historial/dashboard/reporte: asignado permitido, ajeno y vencido denegados; cambios auditados. |
| 3. Integridad y ciclo PIAR | Alto; depende de fase 0 y roles fase 1 | Separar edición, envío a revisión, aprobación, seguimiento, reapertura motivada, versionado y archivo anual. Evaluar importación masiva con validación previa, errores y deduplicación institucional. | Transiciones no autorizadas denegadas; reapertura exige motivo; comparación antes/después reconstruible; archivo conserva histórico; importación no duplica ni aplica lote inválido inadvertidamente. |
| 4. Evidencia familiar y doble aprobación | Alto; depende de decisión fase 0 y ciclo fase 3 | Implementar forma aprobada de aceptación asociada a versión exacta; doble aprobación solo en acciones declaradas, por dos personas distintas. | Evidencia íntegra, identidad y fecha verificables; cambio posterior requiere nueva aceptación según política; aprobador distinto y concurrencia no eluden controles. |
| 5. Continuidad y salida a operación | Alto, previo a producción; trabajo independiente de UI | Documentar ambientes, secretos, respaldo cifrado y retención aprobada, restauración, responsables, RPO/RTO decididos institucionalmente, rollback y monitoreo. Habilitar correo/Google solo con autorización y pruebas controladas. | Restaurar respaldo en entorno aislado y reconciliar conteos/relaciones; demostrar separación de secretos y datos; prueba real controlada antes de declarar servicio operativo; despliegue y reversión reproducibles. |

### Validaciones de esta auditoría

- npm.cmd test: **107 aprobadas, 0 fallidas, 0 omitidas**. Incluye pruebas unitarias de aprobación Docente, autorización, recuperación, adaptadores de correo, OIDC simulado, migraciones y permisos pedagógicos.
- No se ejecutó integración de nuevo: la documentación registra una ejecución anterior de tests/integration.test.js contra piar_test con 12 aprobadas y 1 omitida y fixtures retenidos. No se consultó ni modificó ninguna base durante este hito.
- No se ejecutaron migraciones ni pruebas con escrituras de integración. No se tocó piar, no se borraron datos/fixtures/archivos/usuarios/contenedores, no se instalaron dependencias, no se configuró correo/proveedor real, no hubo commit ni push.
- No se modificó código funcional, interfaz, esquema ni configuración. El único cambio de este hito es esta sección documental, añadida al final para conservar el historial previo.

### Próximo hito recomendado

Convocar una decisión institucional breve para cerrar la fase 0 —en particular alcance de Psicología, fuente/autoridad de planta, doble aprobación y forma de aceptación familiar— y priorizar identidad/ciclo de cuentas y mínimo privilegio. Después preparar cambios revisables y casos de aceptación; no iniciar implementación ni despliegue hasta cerrar esas decisiones y validar cada cambio en piar_test cuando involucre integración/esquema.
\n
## Bloque funcional de seguridad de Psicología — 25 de octubre de 2026

### Cambio aplicado

- Hallazgo corregido: las reglas por rol anteriores permitían que cualquier sesión con rol Psicóloga consultara listas y detalles de estudiantes y PIAR, diagnósticos, seguimientos, observaciones, historial, reportes y dashboard. No existe en el esquema una relación verificada entre usuario Psicóloga y casos asignados; por eso el servidor no podía comprobar el alcance del caso.
- En backend/authorization.js, esas rutas y sus operaciones sensibles ahora deniegan a Psicología con 403 por defecto. El bloqueo ocurre en la autorización del servidor antes de ejecutar las consultas de datos. Incluye creación/edición/borrado de diagnósticos y creación de PIAR/notas/evidencias, para evitar que un bloqueo solo de lectura deje escrituras sin alcance comprobable.
- No se concedieron permisos nuevos a Rectoría ni Coordinación y sus reglas existentes no cambiaron. Se conservó y reforzó la comprobación positiva/negativa ya confirmada para Docentes: el perfil asignado puede consultar el diagnóstico del PIAR y otro perfil docente recibe denegación.
- El cambio es deliberadamente restrictivo: hasta acordar y representar en el modelo la asignación profesional, Psicología no puede trabajar con casos mediante estas rutas. No se infirió que crear un diagnóstico o aparecer como autor equivalga a tener el caso asignado.

### Regresión y validaciones

- tests/authorization.test.js ahora verifica la denegación a Psicología en listas y detalles de estudiante/PIAR, diagnósticos, seguimientos, observaciones, historial, reportes, dashboard y rutas anidadas de barreras/evidencias; comprueba que las reglas actuales de Rectoría/Coordinación sigan permitiendo sus operaciones ya codificadas y prueba separación entre dos perfiles docentes respecto de un diagnóstico.
- Ejecución focalizada: node --test tests/authorization.test.js tests/security-output.test.js tests/pedagogical-model.test.js — **18 aprobadas, 0 fallidas**.
- Suite completa solicitada: npm.cmd test — **110 aprobadas, 0 fallidas, 0 omitidas**.
- No se ejecutó integración HTTP/MySQL en este bloque. Las pruebas añadidas comprueban las reglas del middleware de autorización y la función de alcance docente, pero no se afirma verificación HTTP en base de datos. No se ejecutaron migraciones, no se consultó ni modificó piar, ni se borraron fixtures o registros.

### Archivos de este bloque

- backend/authorization.js — denegación por defecto para rutas de datos de caso de Psicología.
- tests/authorization.test.js — regresiones de denegación, permisos institucionales existentes y aislamiento de perfiles docentes.
- docs/RESULTADOS_CONTINUACION_PIAR.md — este registro, añadido al final.

### Decisión y siguiente paso

La política institucional sigue pendiente sobre quién valida la identidad/perfil de Psicología y cómo se asigna, limita, vence y revoca su acceso a casos. La decisión también debe precisar qué operaciones se permiten en cada caso (lectura, diagnóstico, edición, reportes e historial). Cuando exista esa regla, el siguiente bloque podrá diseñar la relación explícita de asignación y sus filtros en servidor, con pruebas HTTP de caso asignado y no asignado. Hasta entonces, el acceso de Psicología a datos de caso permanece cerrado.
## Hito funcional: historial y reapertura del PIAR — 25 de octubre de 2026

### Implementado

- El esquema existente de `historial` y `historial_detalle` ya tenía `valor_anterior` y `valor_nuevo` JSON. Se agregó `backend/piar-versioning.js` para guardar instantáneas JSON antes/después en esas columnas, con usuario, fecha automática y justificación. El guardado del cambio y de su versión ocurre en una transacción; si falla la escritura de cualquiera de las dos filas de historial, se revierte el cambio del PIAR.
- Las instantáneas capturan los campos del PIAR, estudiante, docentes asignados, barreras, ajustes y sus evidencias, diagnósticos, seguimientos y observaciones. Los endpoints `GET /api/piar/:id/versiones` y `GET /api/piar/:id/versiones/:versionId` permiten listar y recuperar el JSON de una versión. Heredan la lectura existente de PIAR: Docente solo si está asignado; Psicología sigue denegada por la regla vigente.
- Las ediciones de campos del PIAR y su cierre ahora requieren `justificacion`. Un PIAR cerrado no admite cambios por `PUT`. Se agregó `POST /api/piar/:id/reapertura`, exclusivo de Coordinación, también con justificación obligatoria; la reapertura pasa el estado a `revision` y limpia `fecha_cierre` dentro de la misma transacción/versionado.
- El cierre y la reapertura crean versión cuando la instantánea cambia; una edición sin cambio efectivo no duplica versiones. La justificación se limita a 1000 caracteres.
- No se añadió permiso institucional nuevo para Rectoría, Administración o Docentes; se conserva el alcance existente. Se ajustó el caso de integración de diagnósticos para reflejar la denegación vigente a Psicología, en lugar de esperar escrituras permitidas que contradicen esa política.

### Cobertura pendiente y límite del versionado

- Este bloque crea versiones ante mutaciones de los campos raíz de PIAR, cierre y reapertura. Las rutas independientes que agregan o cambian docentes asignados, ajustes, barreras, evidencias, diagnósticos, seguimientos u observaciones aún no llaman al mecanismo de versionado. Aunque sus datos quedan incluidos en la siguiente instantánea, una mutación aislada de una relación no crea por sí sola una versión. Por eso el versionado del ciclo PIAR todavía es **parcial**, no completo.
- El historial es inmutable por las nuevas rutas de aplicación, pero la base de datos no impone inmutabilidad frente a una modificación SQL directa con credenciales privilegiadas. No se creó una interfaz para consultar/restaurar versiones; la recuperación disponible es un endpoint que devuelve la instantánea íntegra, sin aplicar automáticamente una restauración.
- No se cambió el esquema ni se ejecutaron migraciones. No se consultó ni modificó la base institucional `piar`; la integración se ejecutó contra `piar_test` en loopback con `PIAR_TEST_KEEP_FIXTURES=1`.

### Pruebas y resultados

- `node --test tests/authorization.test.js tests/pedagogical-model.test.js`: **18 aprobadas, 0 fallidas**; cubre acceso de lectura según roles, reapertura solo por Coordinación, snapshots con datos relacionados, actor/justificación y rollback ante fallo de historial.
- Integración HTTP/SQL local contra `piar_test`: **12 aprobadas, 0 fallidas, 1 omitida**. La omisión corresponde a un rol que el ENUM del esquema local no representa. Incluyó creación/edición/cierre/versionado/reapertura, consulta de versión por Docente asignado y denegación a Docente no asignado, Rector y Docente para reabrir. Se retuvieron los fixtures.
- La integración se invocó tres veces durante la estabilización. Las dos primeras tuvieron subpruebas fallidas por expectativas antiguas/incorrectas; sus datos sintéticos también quedaron retenidos por `PIAR_TEST_KEEP_FIXTURES=1`. No se borraron esos registros.
- `npm.cmd test`: **113 aprobadas, 0 fallidas, 0 omitidas**.
- No se ejecutaron migraciones, no se cambió el esquema, no se borraron datos o fixtures, no se instalaron dependencias y no hubo commit ni push.

### Siguiente paso

Instrumentar las mutaciones independientes de relaciones del PIAR para crear snapshots en la misma transacción, con pruebas de fallo/rollback y preservación de cada tipo de relación. Después, preparar una vista de consulta/comparación de versiones. Antes de automatizar restauraciones o cambiar permisos de edición por estados, confirmar institucionalmente qué operaciones deben versionarse y cuáles roles pueden modificar un PIAR en cada etapa.

## Hito funcional: versionado de mutaciones pedagógicas relacionadas — 25 de octubre de 2026

### Operaciones cubiertas

Las mutaciones se ejecutan dentro de la transacción del cambio y de las filas de `historial`/`historial_detalle`. Cada versión registra usuario, timestamp, tipo en `historial_detalle.tipo_registro`, justificación cuando se envía y snapshots antes/después. El endpoint de versión devuelve el tipo de operación y el snapshot completo, con las mismas reglas de acceso al PIAR.

- Asignación y retiro de docentes (`POST/DELETE /api/piar/:id/docentes`). Se conserva la lista anterior y posterior de perfiles asignados.
- Creación, actualización y eliminación física de ajustes. El servidor valida el ajuste con su `id_piar` exacto, valida barreras/responsables dentro de la transacción y conserva el snapshot previo antes de eliminar. Sigue impidiendo borrar/editar ajustes con evidencias o seguimientos vinculados.
- Creación de barreras y evidencias; evidencia se liga solo a un ajuste verificado que pertenece al PIAR de la URL.
- Creación de diagnósticos, seguimientos y observaciones con `id_piar` explícito. La pertenencia se confirma dentro de la transacción; seguimiento con `id_ajuste` se comprueba contra el mismo PIAR y estudiante.
- Actualización/eliminación de diagnósticos (únicas rutas comunes de actualización/eliminación habilitadas por la autorización actual). Si una edición cambia la relación, se crean versiones del PIAR origen y destino en la misma transacción. Para Docentes, la comprobación servidor exige asignación al PIAR y bloquea cambios de PIAR/estudiante; los lectores de versiones aplican esa misma asignación.
- Las rutas de escritura siguen sujetas a `backend/authorization.js`; Psicología conserva denegación de acceso a estos datos. No se ampliaron permisos para notas ni se habilitaron operaciones que el modelo de autorización ya deniega.

### Relaciones que no se infieren y límites

- Seguimientos u observaciones sin `id_piar` explícito permanecen sin versionar; no se busca un PIAR por estudiante ni se asigna uno por inferencia. Para actualizaciones cuyo registro no tenga PIAR asociado, tampoco se crea una versión ficticia.
- La creación inicial del PIAR y sus datos iniciales permanece como creación, no como versión de una edición previa. El esquema no tiene baja lógica para asignaciones, ajustes o diagnósticos; donde la ruta actual permite `DELETE`, la fila se elimina físicamente y el snapshot previo conserva el contenido consultable por la API de versiones. No se añadieron rutas de eliminación de barreras/evidencias ni edición/borrado de notas porque no existen o están denegadas.
- Los tipos de operación se guardan en `historial_detalle.tipo_registro` con prefijo `piar_version:`; no se agregaron columnas ni tablas. El motivo es opcional en las mutaciones relacionadas y se guarda si lo envía el cliente; edición de campos raíz, cierre y reapertura mantienen motivo obligatorio del hito anterior.
- Los snapshots contienen datos pedagógicos y sensibles que forman parte del estado relacionado (p. ej. diagnósticos y atributos del estudiante), sin incluir credenciales o secretos. La lectura queda bajo el alcance actual de PIAR; la base no garantiza inmutabilidad frente a SQL directo con credenciales privilegiadas.

### Regresión y resultados reales

- Focalizadas: `node --test tests/authorization.test.js tests/pedagogical-model.test.js` — **20 aprobadas, 0 fallidas**. Incluyen snapshots de relaciones, movimiento de registro entre dos PIAR, no inferencia de PIAR sin vínculo y rollback si falla la escritura del historial.
- Integración HTTP/SQL en loopback, fijada a `piar_test`, con fixtures retenidos: **12 aprobadas, 0 fallidas, 1 omitida**. Verifica asignación y retiro, ajustes y actualizaciones, barreras, evidencias, diagnósticos y su eliminación recuperable, seguimientos, observaciones, denegación y aislamiento entre Docentes.
- `npm.cmd test`: **115 aprobadas, 0 fallidas, 0 omitidas**.
- La integración se ejecutó varias veces durante la corrección; las ejecuciones intermedias revelaron errores de paso de snapshots y de aserciones, corregidos antes del resultado final. Todas usaron `PIAR_TEST_KEEP_FIXTURES=1`, por lo que sus datos sintéticos también quedaron retenidos; no se borraron fixtures ni registros.
- No se ejecutaron migraciones, no se cambió el esquema, no se consultó ni modificó `piar`, no se instalaron dependencias y no hubo commit ni push.

### Siguiente paso concreto

Para dar por cubierta toda mutación pedagógica, resolver institucionalmente la relación de registros que hoy pueden existir sin `id_piar`. Cualquier política de baja lógica requiere diseño y autorización de migración separados; no forma parte de este hito.

## Hito funcional: consulta y comparación visual del historial — 25 de octubre de 2026

### Funcionalidad

- La pantalla de detalle del PIAR incorpora una sección de versiones. Presenta fecha, actor, tipo de operación y justificación cuando existe, a partir de `GET /api/piar/:id/versiones`.
- Permite elegir dos versiones y recupera ambas mediante `GET /api/piar/:id/versiones/:versionId`. Compara el estado posterior de cada versión y etiqueta diferencias como agregadas, modificadas o eliminadas.
- Se reutiliza la autorización de servidor existente por solicitud. Los Docentes siguen limitados a PIAR asignados; Psicología sigue denegada por la regla global vigente. No se añadió autorización basada solo en el navegador.
- Para la presentación de diferencias se usa una lista explícita de campos pedagógicos. Se excluyen los datos de estudiante, diagnósticos, informes de salud, documento, teléfono, correo, referencias de evidencias, credenciales y secretos que pueda contener el snapshot completo. Los datos impresos pasan por `escapeHTML`.
- La interfaz comunica historial vacío, carga fallida, respuestas 403/404 y errores de comparación. No ofrece restauración ni edición de versiones.

### Archivos de este hito

- `public/index.html`: carga el módulo de presentación del historial.
- `public/js/api.js`: agrega llamadas GET para listar y recuperar versiones.
- `public/js/piar-version-history.js`: proyección permitida, clasificación de diferencias y coordinación de las lecturas.
- `public/js/app.js` y `public/css/dashboard.css`: sección de detalle, selectores de comparación, estados y presentación.
- `tests/piar-version-history-ui.test.js` y `package.json`: pruebas focalizadas añadidas a la suite unitaria.

### Validación real y límites

- `node --test tests/piar-version-history-ui.test.js`: **7 aprobadas, 0 fallidas**. Cubre llamadas a endpoints, campos mostrados y escapados, cambios agregados/modificados/eliminados, exclusión de datos sensibles, respuesta 403, formato inválido, recuperación de dos versiones y errores de comparación.
- La comparación usa el snapshot posterior (`valor_nuevo`) de cada versión. La lista/detalle solo revela los datos que la API permite al usuario; los campos sensibles omitidos no se muestran en la comparación.
- Las pruebas son unitarias/focalizadas, no una ejecución de navegador real. No se necesitó integración SQL para este cambio de interfaz; las rutas se reutilizan sin cambios y su autorización existente no se amplió.
- `npm.cmd test`: **122 aprobadas, 0 fallidas, 0 omitidas**.
- No se cambió servidor, esquema ni migraciones; no se consultó ni modificó la base institucional `piar`, no se configuraron servicios externos, y no hubo instalación de dependencias, commit ni push.

### Siguiente paso concreto

Siguiente validación recomendada: revisar visualmente en un entorno local con datos sintéticos autorizados que la sección sea legible en móvil y escritorio; no ampliar los campos de comparación sensibles sin revisar antes el alcance institucional de cada rol.

## Hito: desbloqueo seguro del primer acceso administrativo local — 25 de octubre de 2026

### Flujo verificado y hallazgo

- El registro público crea únicamente rol `Docente`, inicialmente `pendiente_verificacion`, guarda bcrypt y un hash de token de verificación. Roles privilegiados se rechazan antes de consultar la base. La verificación consume un token de un solo uso y deja la cuenta `pendiente`, sin sesión; aprobación institucional la deja `activo` y crea el perfil docente. Login solo admite cuentas activas.
- Verificación y recuperación llaman al adaptador común `backend/email.js`. `.env.example` propone `EMAIL_TRANSPORT=memory`, pero su secreto local viene vacío; sin configurarlo, o sin credenciales SMTP/API válidas, la entrega falla. El sistema consume el token no enviado y mantiene la respuesta pública genérica. No se encontró evidencia de un proveedor real configurado o de correo entregado.
- Ya había un CLI local en el comando del paquete, pero su rutina permitía crear otro Administrador si el correo era distinto. Se corrigió para bloquear cualquier Administrador existente, evitar carreras mediante `GET_LOCK`, verificar identidad de base antes de escritura, exigir evidencia interactiva de correo verificado/autorización, validar contraseña (14–72 bytes), y hacer la inserción bcrypt transaccional. No convierte ni altera cuentas existentes.

### Cambios y cobertura

- `scripts/bootstrap-local-primary-admin.js`: verifica overrides de DB, destino exacto `piar_test`, `CURRENT_USER`, puerto interno, `read_only`, grants/esquema; requiere confirmaciones antes de la escritura; protege creación con advisory lock + transacción y detecta Admin/correo duplicados.
- `tests/bootstrap-local-primary-admin.test.js`: destino institucional rechazado, override `DB_NAME=piar`, duplicados de Admin/correo, validación de autorización y contraseña, bcrypt, transacción, comandos interactivos y ausencia de ruta HTTP.
- `tests/auth-registration.test.js` existente: verifica rechazo de Administrador/Rector/Coordinador/Psicóloga/Estudiante en registro público antes de cualquier acceso a base.
- `docs/MANUAL_TECNICO_PIAR.md`: instrucciones para el comando local, buzón simulado y configuración SMTP/API de verificación y recuperación.

### Pruebas reales

- Focalizadas: `node --test tests/bootstrap-local-primary-admin.test.js tests/primary-admin-bootstrap.test.js tests/auth-registration.test.js tests/email-delivery.test.js tests/email-verification.test.js tests/password-reset.test.js` — **37 aprobadas, 0 fallidas, 0 omitidas**.
- `npm.cmd test`: **126 aprobadas, 0 fallidas, 0 omitidas**.
- No se ejecutó ningún CLI de bootstrap, no se creó cuenta, no se inspeccionó la base `piar_test` durante este hito ni se consultó/modificó `piar`. No se ejecutaron migraciones ni se probó correo real. No se hizo commit/push.

### Próximo paso y confirmación requerida

El operador deberá revisar el destino local, comprobar que la instancia y esquema de `piar_test` están listos, y después autorizar la ejecución de `npm.cmd run db:bootstrap:admin`. El comando solicita destino y confirmación de escritura, además de autorización explícita y contraseña oculta. Para el correo, primero decidir entre buzón local simulado para desarrollo o credenciales de un proveedor real autorizado. No declarar operativo el transporte real hasta completar un envío/recepción y el uso de ambos enlaces en un buzón controlado.

## Reparación funcional integrada — 26 de octubre de 2026

Se corrigió el bootstrap para que no declare verificado el correo por confirmación interactiva: crea Administrador pendiente, con token de un uso almacenado como hash y auditoría transaccional; solo consumir el enlace enviado por SMTP/API activa la cuenta. El CLI de recuperación exige seleccionar y confirmar un ID de Administrador activo y no cambia roles. El flujo heredado de bootstrap delega al único CLI aprobado, y el módulo antiguo falla cerrado. Transporte `memory` se rechaza desde el CLI.

La suite de integración se fijó al perfil `fresh`, el cual verifica mediante inspección local de Docker el nombre, imagen, datadir tmpfs, ausencia de volumen persistente y puerto loopback 3308 antes de solicitar contraseña o conectar. Fixtures retenidas con patrón sintético bloquean nuevas escrituras; no se limpian restos históricos. Compose efímero incluye la migración 009, que crea auditoría administrativa. No se aplicó la migración.

El informe detallado de alcance, riesgos, instrucciones y validaciones es [INFORME_REPARACION_FUNCIONAL_PIAR.md](INFORME_REPARACION_FUNCIONAL_PIAR.md). `npm.cmd test`: **139 aprobadas, 0 fallidas, 0 omitidas**. `node --check` para JavaScript modificado y parseo JSON: **correctos**. No se conectó a MySQL ni se ejecutó integración, ni se inspeccionó/modificó `piar_test`; tampoco se consultó `piar`.
# Separación de Administrador principal y cuentas demo (Fase 1)

Se modificó el inicializador local de demostración para aceptar únicamente datos `DEMO_TEACHER_*`, solicitar solo la contraseña de Docente e insertar únicamente el usuario Docente y su perfil vinculado. La comprobación de esquema ya no exige que el ENUM de `usuario.rol` habilite Administrador. El bootstrap principal conserva sus controles y no fue modificado.

La suite de integración conserva su usuario Administrador sintético para escenarios de autorización, pero ahora ejecuta un preflight antes de crear el fixture. Si detecta una cuenta con el patrón estricto generado por fixtures anteriores (correo y documento correlacionados), termina sin nuevas inserciones ni limpieza automática. Las cuentas ya existentes no se identifican como cuenta principal ni se alteran.

Pruebas y validaciones de esta fase: `node --check` pasó para `scripts/create-local-demo-accounts.js`, `scripts/integration-fixture-guard.js`, `tests/integration.test.js` y `tests/local-demo-accounts.test.js`. Las pruebas focalizadas (`node --test tests/local-demo-accounts.test.js tests/bootstrap-local-primary-admin.test.js`) pasaron: 15 aprobadas, 0 fallidas. `npm.cmd test` ejecutó solo la suite unitaria configurada (no incluye `tests/integration.test.js`): 129 aprobadas, 0 fallidas. Las pruebas usaron dobles locales; no se conectó a MySQL, no se ejecutó integración ni se ejecutaron scripts de inicialización.

Limitación: el detector solo identifica el patrón actual de fixtures de integración; no establece la procedencia de otras cuentas sintéticas ni determina cuál cuenta, si alguna, fue autorizada como Administrador principal. La Fase 2 debe diseñar un procedimiento local independiente de recuperación, con identidad y autorización explícitas, manteniendo destino cerrado a `piar_test`; no debe seleccionar ni modificar automáticamente las cuentas existentes.

## Revisión de autenticación, invitaciones y permisos — 28 de octubre de 2026

- Se contrastaron las rutas y módulos actuales de autenticación, registro, verificación, aprobación, sesiones y autorización PIAR con sus pruebas unitarias existentes. El registro público admite únicamente Docente; persiste la contraseña con bcrypt y almacena el hash del token de verificación. La creación del usuario y el token ocurre dentro de una transacción.
- La verificación consume un token de un solo uso dentro de una transacción. La cuenta Docente pasa a `pendiente`; iniciar sesión exige estado `activo`. Solo Administrador puede aprobar o rechazar solicitudes verificadas de Docente; la aprobación enlaza un único perfil docente y el rechazo exige motivo. Login aplica límites por IP/correo; las solicitudes de registro y reenvío de verificación tienen límites por IP/correo. Sesiones usan token aleatorio cuyo hash se almacena, cookie HttpOnly/SameSite=Lax, vencimiento y revocación al cerrar sesión.
- La autorización de Docente exige exactamente un perfil activo y filtra recursos por relación PIAR-docente; los recursos fuera del alcance no se revelan y responden como no encontrados. Las pruebas unitarias existentes cubren estos controles. La suite `npm.cmd run test:unit` terminó con **147 aprobadas, 0 fallidas, 0 omitidas** (duración Node: 22.119 ms). No se ejecutaron pruebas de integración ni se validó persistencia HTTP/MySQL en esta revisión.
- No se encontraron endpoints de invitación. La creación administrativa existente permite solicitar únicamente cuenta Docente y conserva verificación de correo y aprobación; no es una invitación con token institucional.
- Dependencia de esquema pendiente para invitaciones: la tabla base `docente` tiene `id_usuario`, mientras `coordinador` y `psicologa` no tienen vínculo de usuario. Antes de habilitar invitaciones de roles privilegiados se requiere definir quién puede invitar cada rol, cómo se verifica la identidad institucional y qué perfil/alcance se aprovisiona. La migración futura tendría que ser aditiva: tabla de invitaciones con correo normalizado, rol permitido, hash de token, vencimiento, consumo/revocación, autor y claves/índices; vínculos de usuario a perfiles institucionales solo después de aprobar sus reglas. No se redacta una migración ejecutable sin esa política porque implicaría fijar roles y relaciones sin decisión institucional.
- La aprobación requiere `usuario.decision_reason`, agregada por `database/migrations/010_registration_decision_reason.sql`; la migración sigue sin ejecutarse y debe aplicarse en el esquema de pruebas antes de validar la ruta con MySQL. No se aplicó SQL ni se conectó a MySQL.
- El entorno de integración está configurado estáticamente para `127.0.0.1/piar_test`: puerto 3307 para perfil local y 3308 para perfil fresh, con usuario de prueba y contraseña explícita. Las pruebas unitarias verifican estos destinos, grants permitidos y rechazo de retención de fixtures. No se iniciaron, recrearon ni borraron contenedores.
- No se encontró un defecto funcional reproducible que justificara modificar el código de autenticación o permisos durante esta revisión. Correo SMTP/API y OIDC reales, invitaciones institucionales, esquema actualizado y pruebas HTTP/MySQL siguen sin validación real.

### Propuesta concreta de invitaciones — pendiente de decisión institucional

- **Emisor propuesto:** únicamente una cuenta Administrador activa, con correo verificado y registro de auditoría. Rector, Coordinación y Psicología no emiten invitaciones mientras su identidad/provisión institucional no tenga procedimiento aprobado.
- **Perfiles iniciales propuestos:** solo Docente. El registro público permanece restringido a Docente; no se habilita públicamente ningún rol privilegiado. Aun con invitación, aceptar no concede acceso: la cuenta conserva verificación de correo y aprobación institucional separadas.
- **Validación de pertenencia:** el emisor debería cotejar el correo y la identidad contra una fuente oficial de personal autorizada y registrar una referencia verificable. No se debe inferir pertenencia por dominio de correo: hoy no hay dominio institucional aprobado ni fuente de personal integrada. La fuente y responsable deben confirmarse antes de implementar.
- **Relación de perfil:** `docente.id_usuario` permite el vínculo existente, pero actualmente solo tiene índice no único; una migración tendría que detectar duplicados históricos antes de imponer unicidad. `coordinador` y `psicologa` no tienen `id_usuario`; `Rector` tampoco tiene perfil/flujo de provisión validado. No se debe inventar esos enlaces.
- **Aprobación y activación propuestas:** aceptar crea o completa solicitud Docente pendiente de verificación; verificar correo la deja pendiente y un Administrador distinto del solicitante aprueba/rechaza por el flujo existente. No conceder sesión ni rol por el solo hecho de poseer un token de invitación.
- **Revocación propuesta:** un Administrador puede revocar una invitación no aceptada; el sistema debe registrar quién, cuándo y el motivo. Las invitaciones consumidas no se revierten; se tramita una decisión de cuenta separada.
- **Caducidad, reutilización y concurrencia propuestas:** token aleatorio de alta entropía, solo su SHA-256 en base de datos, expiración de 24 horas, estados pendiente/aceptada/revocada/expirada y consumo atómico en transacción con bloqueo de fila y actualización condicional. Token expirado, revocado, consumido o aceptación concurrente devuelve respuesta genérica sin revelar si existe una cuenta.
- **Dependencia de esquema:** la instalación es de una sola institución y solo publica el nombre `Colegio Reinaldo Matiz`; no hay tabla ni ID institucional. La migración futura debería guardar el identificador institucional estable y la referencia de validación, además de correo normalizado, rol permitido, hash del token, emisor, fechas de creación/vencimiento/aceptación/revocación, estado y claves foráneas/auditoría. No se creó migración ni endpoint porque faltan fuente oficial de personal, representación institucional estable y reglas de emisor/aprobador.

### Dependencia de migración 010 y prueba HTTP pendiente

- `database/migrations/010_registration_decision_reason.sql` añade condicionalmente `usuario.decision_reason VARCHAR(500) NULL` después de `decision_at`. No reescribe filas y no contiene DML; depende de `usuario` y de `decision_at` creado por migración 002. El endpoint de aprobación utiliza esa columna, por lo que una base que no tenga el campo hará fallar la decisión administrativa.
- La migración comprueba presencia por nombre y no corrige una columna preexistente con tipo incorrecto. Antes de aplicarla en una base efímera autorizada hay que verificar versión/MySQL, aplicación previa de 002, ausencia o compatibilidad exacta de la columna, respaldo/descartabilidad del entorno y privilegios DDL necesarios. Tras aplicar: comprobar columna, correr el validador estático y después la integración HTTP con target fresh verificado. La migración no se ejecutó.
- La suite de integración modifica y limpia fixtures; solo debe correr tras autorización expresa y validación del contenedor `piar-mysql-test-fresh` de tmpfs, imagen MySQL 8.0, datadir efímero, puerto `127.0.0.1:3308`, base `piar_test`, usuario restringido y correo simulado. No se inició, inspeccionó ni modificó ningún contenedor en este bloque.

### Hito de demo visual local — 28 de octubre de 2026

- Se añadió `scripts/visual-demo-server.js`, que sirve el frontend real de `public/` en loopback sin importar `backend/server.js`, cargar `.env` ni crear pool MySQL. La vista pública muestra login/registro; la vista sintética Docente muestra un solo estudiante y PIAR ficticios con correo `.invalid` y documento `DEMO-*`.
- El servidor no acepta escrituras, bloquea envíos de formularios y proveedores externos, no persiste `localStorage` y no ofrece perfiles administrativos. Una cookie de sesión temporal solo activa la vista sintética local. Esto permite inspección visual, no valida los permisos del backend ni representa una cuenta institucional.
- `npm.cmd run test:unit`: **152 aprobadas, 0 fallidas, 0 omitidas** (70.177 ms, aprox. 70,2 s). Las cinco nuevas pruebas verifican banner, endpoints públicos, fixture sintético, bloqueo de mutaciones y rechazo de traversal.
- El servidor quedó iniciado en `http://127.0.0.1:4173`. HTTP local devolvió frontend 200 con banner, health `visual-demo/not-connected` y `GET /api/auth/me` 401 en modo público. El control de navegador agotó tres intentos; no se capturó pantalla ni se verificó consola/interacciones en navegador.
- Para cambiar la vista en navegador: enlace **Vista Docente sintética** del banner; regreso con **Vista de acceso**. Los formularios permanecen deshabilitados.
