# Revisión pedagógica, normativa y de acceso PIAR

## Criterios normativos y mejoras de producto

El artículo 2.3.3.5.2.3.5 del Decreto 1075 de 2015 define el contenido mínimo del PIAR: contexto, valoración pedagógica, informes de salud que aporten a definir ajustes, metas, ajustes curriculares/didácticos/evaluativos/metodológicos, recursos, proyectos, otra información relevante y actividades para los recesos. El artículo 2.3.3.5.2.3.6 prevé acta de acuerdos, participación de acudiente, directivo, apoyo y docentes, y estrategias familiares para recesos y transiciones. Los artículos 2.3.3.5.2.3.7 y .8 prevén informe anual, entrega pedagógica e historia escolar confidencial. El artículo .9 dispone la articulación de ajustes pertinentes al PMI.

El Instructivo PIAR del MEN indica que el docente de aula lidera la valoración pedagógica y la elaboración del instrumento, con participación de apoyo y otros profesionales cuando estén disponibles; también propone como mínimo tres seguimientos durante el año. Esa frecuencia es una orientación del instructivo, no una periodicidad agregada por el software como obligación legal general.

La valoración y las barreras observadas guían el PIAR. Los informes médicos son un insumo cuando existen y aportan a definir ajustes; no son una condición de creación del PIAR en este flujo de software. Esta decisión de producto sigue las orientaciones MEN sobre valoración pedagógica y no interpreta el requisito documental de acceso/matrícula del artículo 2.3.3.5.2.3.3 como requisito para formular el PIAR.

## Modelo y ciclo disponible

Se reutilizan `estudiante` (contexto, valoración, fortalezas, barreras y apoyos), `piar` (caracterización, objetivos, metas, estrategias, informes, proyectos), `piar_ajuste` (área, tipo, estrategia, recursos y avance), `seguimiento`, `observacion` e `historial`. La migración aditiva 006 añade solo los vacíos identificados: actividades de receso, otra información, acta/compromisos, informe anual y entrega pedagógica. El detalle del PIAR muestra estos registros y seguimientos. Los docentes asignados pueden crear el PIAR del año siguiente para estudiantes de su ámbito; la primera asignación de un estudiante sin PIAR anterior aún debe hacerla Coordinación, Rectoría o Administración mediante el flujo institucional existente, pues el esquema no contiene otra relación docente-estudiante.

## Contraste normativo y decisiones de diseño

El artículo 2.3.3.5.2.3.5 del Decreto 1075 de 2015 (incorporado por el Decreto 1421 de 2017) exige que el PIAR incluya contexto general dentro y fuera del establecimiento, valoración pedagógica, informes de salud que aporten a definir ajustes, metas, ajustes curriculares/didácticos/evaluativos/metodológicos si se requieren, recursos necesarios, proyectos pertinentes, otra información relevante y actividades en casa para recesos. El artículo 2.3.3.5.2.3.6 dispone el acta de acuerdos y estrategias familiares para recesos/transiciones; los artículos .7 y .8 contemplan informe anual, entrega pedagógica e historia escolar confidencial. El artículo .9 articula ajustes pertinentes con el plan de mejoramiento institucional. [Texto integrado oficial del Decreto 1075 — Función Pública](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?1075=&i=77913).

El MEN publica el Instrumento PIAR (Anexo 3) y sus instrucciones de diligenciamiento (Anexo 4). Sus orientaciones vinculan la valoración pedagógica con las barreras para aprendizaje/participación, metas y apoyos/ajustes, e indican seguimiento periódico. La periodicidad concreta debe armonizarse con el SIEE y la planeación institucional; no se fijó una regla legal universal de tres seguimientos. [Página oficial de educación inclusiva y anexos PIAR — MEN](https://www.mineducacion.gov.co/1780/w3-article-374740.html?_noredirect=1), [Permanencia accesible — MEN](https://www.mineducacion.gov.co/1780/articles-411706_recurso_3.pdf).

El decreto no exige el modelo relacional propuesto, una clasificación cerrada de contextos, indicadores en cada ajuste, evidencias digitales adjuntas ni una fecha prevista/real con esos nombres. Son decisiones de diseño para hacer trazable la implementación y su revisión, no requisitos normativos nuevos. Los contextos `aula`, `espacios_escolares`, `hogar`, `entorno_social`, `institucional` y `otro` son categorías de captura del producto, no una taxonomía legal.

La migración 008 implementa esa extensión de forma aditiva: tabla `piar_barrera`; vínculo opcional de barrera y usuario responsable en `piar_ajuste`, más resultado esperado, indicador y revisión prevista; tabla `piar_ajuste_evidencia` para descripción/referencia/fecha/autor (sin subir archivos); y vínculo opcional `seguimiento.id_ajuste`. La fecha del seguimiento existente es la revisión real; `evolucion` y `acuerdos` registran resultado observado y acciones siguientes. `piar.barreras` y los ajustes/seguimientos antiguos permanecen intactos, sin backfill inferido. Las barreras y evidencias nuevas son append-only por API; los ajustes no se eliminan cuando ya tienen evidencia por la restricción FK.

## Alcance por rol implementado

| Rol | Alcance funcional del servidor |
|---|---|
| Docente | Lectura de estudiantes/PIAR y registros relacionados solo por asignación `piar_docente` a un único perfil `docente` activo vinculado por `docente.id_usuario`; se admiten múltiples docentes por PIAR y múltiples PIAR por estudiante. Crea seguimientos y observaciones en su ámbito, crea/actualiza PIAR asignados y crea/edita ajustes. Sin perfil, perfil inactivo o perfiles duplicados: denegación por defecto. |
| Coordinador | Conserva el alcance institucional existente para coordinar los PIAR, asignaciones y registros pedagógicos; cierre y gestión institucional conforme a la matriz existente. |
| Rector | Conserva lectura institucional y las funciones directivas existentes; no aprueba cuentas mientras no exista aprovisionamiento de identidad/rol validado. |
| Psicóloga | Conserva las funciones clínicas/pedagógicas definidas por la matriz existente, incluida creación de registros de diagnóstico. El esquema actual no vincula `psicologa` con `usuario`; por ello no se puede verificar una identidad profesional/perfil único desde la base. Esta excepción institucional requiere aprobar y modelar la vinculación antes de datos reales. |
| Administrador | Conserva gestión de usuarios y perfiles, así como el alcance de datos definido actualmente en backend. La institución debe confirmar formalmente si el rol de administración requiere lectura global de historias escolares y datos de salud. |

Coordinación y Rectoría se tratan hoy como perfiles institucionales de un único colegio; el servidor aún no tiene una relación de curso/grado que permita segmentar estos roles. No se inventó una relación de curso ni se infirió asignación a partir del correo. Las lecturas administrativas/clínicas globales que ya permite la matriz de roles requieren validación de necesidad institucional antes de operar historias reales.

## Seguridad aplicada

- Las consultas de listado y detalle docente filtran en SQL por `piar_docente`; las rutas por identificador, historial, reportes, dashboard, estudiantes, PIAR, diagnósticos, seguimientos y observaciones aplican el mismo alcance. Un identificador ajeno devuelve una respuesta genérica 404.
- El dashboard Docente devuelve agregados del ámbito asignado; los listados de historial/reportes no contienen registros ajenos. Los reportes generados en cliente consumen el estado ya limitado por la API.
- Se reemplazaron proyecciones `SELECT *` en las rutas de historia escolar, autenticación y recursos de estudiante/salud por columnas explícitas. El historial API no devuelve snapshots `valor_anterior`/`valor_nuevo`.
- La migración 007 y middleware registran actor, acción, tipo/identificador de recurso, resultado y estado HTTP; no guardan cuerpo, tokens, contraseñas ni contenido de salud. Hace falta aprobar retención, consulta y responsables de auditoría según la política institucional.
- La protección de salud y demás datos personales se apoya en finalidad, seguridad y confidencialidad de la Ley 1581 de 2012. El software no sustituye la definición institucional de autorización y aviso de privacidad.

### Vacíos pedagógicos identificados en esta revisión

- Las barreras están guardadas como texto general en estudiante/PIAR; no se registran de forma estructurada por contexto (aula, institución, familia/comunidad), actividad, fecha de identificación ni condición del entorno. Esto limita priorización y comparación de cambios.
- Cada ajuste registra área, tipo, estrategia, recursos, responsable en texto y porcentaje de avance, pero no tiene indicador de logro, fecha de inicio/vencimiento, estado de implementación verificable ni vínculo a la barrera que busca eliminar.
- Seguimientos y observaciones se relacionan con PIAR/estudiante, pero no con un ajuste individual. No existe una cadena de trazabilidad barrera → ajuste razonable → evidencia → seguimiento → resultado.
- No hay entidad para adjuntar/ubicar evidencias (artefactos, fecha, autor, descripción, permiso de acceso o conservación), ni un flujo de revisión/aprobación de evidencias. Los textos de observación no sustituyen evidencia documental.
- El responsable del ajuste es un nombre libre, no una asignación a usuario/perfil validado. Aunque seguimientos admiten `id_usuario_responsable`, faltan responsables por ajuste, fechas programadas y alertas de revisión.
- No se modelan de forma explícita línea base, indicador/criterio de éxito, decisión de mantener/adaptar/retirar un ajuste, ni ciclo de revisión ligado a las metas. El avance porcentual por sí solo no demuestra efecto pedagógico.

Completar estos puntos requiere diseño de producto y esquema aditivo (identificadores de barrera/ajuste, responsable validado, fechas e indicadores, y metadatos de evidencias); no se agregaron campos especulativos ni migraciones durante esta auditoría. La captura de actividades de receso, acta, informe anual y entrega pedagógica sí está prevista por la migración 006, pero continúa pendiente de validación en una base aislada compatible.

### Revalidación de permisos

El 24 de octubre de 2026, `npm.cmd test` aprobó 101/101 pruebas unitarias. La matriz en memoria cubre Administrador, Rector, Coordinador, Psicóloga, Docente y Estudiante; las pruebas añadidas cubren validación pedagógica, responsable activo/asignado, permisos append-only y formularios. La suite `tests/integration.test.js` contiene casos HTTP/MySQL para aislamiento docente y trazabilidad barrera-ajuste-evidencia-seguimiento, pero no se ejecutó porque limpia fixtures al terminar. No se aplicó la migración 008; las nuevas rutas no se han validado por HTTP/MySQL.

No se identificó en el código auditado una brecha que justifique cambiar los permisos existentes sin política institucional adicional. Continúan pendientes la vinculación verificable de Psicóloga a su perfil, validación/aprovisionamiento de Rector, y definición formal del alcance de lectura de roles institucionales con datos reales.

## Compatibilidad y límites

Las migraciones 006 y 007 son aditivas e idempotentes, pero no se ejecutaron. El backend actualizado requiere esas columnas y tabla para crear PIAR nuevos y guardar auditoría; antes de desplegarlo, se debe respaldar el esquema institucional, verificar el destino y probar la migración en una copia aislada compatible. No ejecutar sobre `piar` sin revisión de compatibilidad y autorización.

La historia escolar completa incluye anexos/documentos recibidos, informes de seguimiento e información de traslados/retiros. El modelo actual solo admite texto y registros relacionados; no hay gestión versionada de archivos, firmas electrónicas ni flujo controlado de entrega/recepción. Los campos añadidos completan captura básica, no certifican por sí solos conservación documental ni validez de firmas.

## Fuentes

- Decreto 1075 de 2015, artículos 2.3.3.5.2.3.3 y 2.3.3.5.2.3.5 a 2.3.3.5.2.3.9, Gestor Normativo de Función Pública.
- Ministerio de Educación Nacional, *Plan Individual de Ajustes Razonables – Instructivo instrumentos* (2017).
- Ministerio de Educación Nacional, *Permanencia accesible*, sección sobre PIAR y valoración pedagógica.
- Ley 1581 de 2012, especialmente principios de seguridad/confidencialidad y artículos 5 y 6 sobre datos sensibles.
