# Auditoría del estado real — 4 de noviembre de 2026

## Alcance y preservación

Se revisó el informe de continuación y el estado del repositorio antes de continuar. El árbol de trabajo contiene numerosas modificaciones, archivos nuevos y eliminaciones locales, incluidos cambios amplios en backend, interfaz, migraciones, pruebas y documentación. Se conservaron todos. No se ejecutaron `git reset`, `git restore`, `git clean`, commit, push ni despliegue. No se leyeron `.env`, `.env.test` ni archivos locales de datos/cookies.

La rama observada es `security/fase-1-hardening`. La lista de instrucciones de repositorio previamente revisada no encontró `AGENTS.md`, `CLAUDE.md` ni instrucciones de Copilot; sí hay skills locales en `.claude/skills`. Se aplicaron las guías disponibles de arquitectura, backend, base de datos, autorización, pruebas y refactorización.

## Resumen de arquitectura y hallazgos

- **Backend:** servidor HTTP de Node.js y MySQL2. Autenticación y varios controles se separaron en módulos; gran parte del enrutamiento sigue concentrado en `backend/server.js`.
- **Frontend:** SPA JavaScript sin framework, servida desde `public/`. `public/js/api.js` centraliza las llamadas principales; `public/js/app.js` conserva bastante lógica de presentación y flujo en un archivo grande.
- **Base y migraciones:** esquema MySQL versionado en `database/migrations`. La migración 011 agrega `password_change_required`; su estado en una base activa no se ha podido consultar.
- **Autenticación:** el código implementa registro, sesiones, hash de contraseñas, límites de intentos, verificación, restablecimiento y controles de aprobación/cambio inicial. Las pruebas automatizadas cubren flujos simulados. La operación real de correo, administrador inicial y verificación depende de credenciales y acciones humanas aún pendientes.
- **Autorización:** hay controles de rol en backend y restricciones de alcance docente por asignación. La política revisada niega acceso a estudiantes y a psicología en rutas sensibles cuando no puede asociarse una relación institucional comprobada. No se debe ampliar ese acceso sin una decisión institucional sobre el vínculo y alcance de los registros.
- **Módulos pedagógicos:** hay rutas y vistas para estudiantes, PIAR, diagnósticos, ajustes y seguimientos, sujetas a la base y autorización. No se encontró una implementación identificable de DUA. La validación funcional completa con persistencia MySQL queda pendiente.
- **Reportes:** el listado/detalle se obtiene desde el backend, mientras que la impresión se construye en el navegador con `window.print()`. No se encontró generación PDF en servidor ni una ruta de persistencia de reportes. No se declara validado un PDF.
- **Datos de demostración:** existe un servidor de demostración que declara ser de solo lectura y usa datos ficticios; no es evidencia de integración real. `data/db.json` y un archivo local de cookies existen, pero su contenido no se inspeccionó ni alteró.

## Hallazgos priorizados

### Crítico

- **Persistencia real no comprobada:** no se ha demostrado login, aprobación ni recorrido PIAR contra una base MySQL accesible en esta sesión. No declarar el sistema listo para uso institucional.
- **Migración de inicio de administrador:** el código de autenticación consulta la columna de cambio obligatorio; el informe previo indica que no se confirmó ni aplicó la migración 011. No ejecutar hasta verificar el destino y una identidad autorizada.
- **Integración de identidad/correo pendiente:** no se creó el administrador inicial ni se envió un correo real; faltan las credenciales SMTP y la interacción del operador con el correo.

### Alto

- **Reglas de alcance institucional por cerrar:** el acceso de estudiante y psicología está cerrado cuando no existe un vínculo comprobado; se necesita una regla institucional explícita antes de implementar acceso.
- **No hay módulo DUA localizado** en las rutas, vistas o esquema examinados.
- **El respaldo solicitado no existe:** la revisión previa encontró ausente `%TEMP%\PIAR-SISTEMA-secure-backups`; no se pudo verificar restauración aislada. No detener ni recrear el contenedor de pruebas que mantiene datos en memoria.

### Medio

- Concentración de rutas y lógica en archivos grandes (`backend/server.js`, `public/js/app.js`) aumenta el costo de mantenimiento.
- Algunas listas carecen de paginación y límites visibles; conviene revisar exposición y consumo cuando se defina volumen real.
- La impresión depende del navegador; generación PDF consistente sigue pendiente.
- Hay incoherencias históricas en configuración/puertos de scripts de prueba. Mantener infraestructura de pruebas separada y documentar el perfil local antes de retirar Compose.

### Bajo

- Hay residuos documentales del piloto y reportes históricos extensos. Los archivos ya eliminados localmente no se restauraron; no se retiraron otros archivos durante esta auditoría.
- La codificación de consola del informe de continuación aparece alterada en PowerShell, pero el archivo se conservó y se añadió una entrada nueva UTF-8.

## Piloto y contenedores

El inventario de Docker registrado en la continuación el 3 de noviembre identificó `piar-mysql-test-fresh` en `127.0.0.1:3308`, `piar-mysql-test` en `127.0.0.1:3307` con volumen persistente y `piar-backend` detenido con puerto 8080. El datadir de `piar-mysql-test-fresh` estaba en `tmpfs`; detenerlo o reiniciarlo perdería su estado actual. El contenido del volumen asociado a `piar-mysql-test` no se verificó. Ningún contenedor o volumen se eliminó ni se modificó.

Los Compose de prueba y scripts que requieren la base efímera son herramientas de QA, no deben clasificarse como exclusivamente piloto hasta que exista una alternativa local comprobada. `database/migrations/000_railway_schema.sql` contiene el esquema base compartido y no debe retirarse por su nombre. Las evidencias históricas se conservan.

## Corrección segura aplicada

Se restringió el runner de migraciones locales a hosts loopback y nombres de base que coinciden con `piar_dev` o `piar_test` (incluidos sufijos locales). Se añadió una prueba para rechazar hosts externos y nombres institucionales/de producción, y un comando explícito para migración 011. Esto reduce el riesgo de que el runner se apunte accidentalmente a otra base; no ejecuta SQL por sí solo.

Verificaciones registradas tras esa corrección: `node --check` para el runner y la configuración, **4/4** pruebas del módulo de configuración y la suite `npm test` con **160 aprobadas, 0 fallidas**. Son pruebas de código/unitarias; no prueban conexión ni persistencia MySQL.

## Estado observado el 4 de noviembre

- El servicio de Windows `MySQL80` aparece como `Running`.
- Las consultas de escucha de esta sesión no detectaron endpoints en 3306, 3307 ni 3308. El proceso `mysqld` aparece en la lista de procesos, pero no se pudo demostrar un listener accesible. No se realizó conexión SQL ni se usaron credenciales.
- El backend no escucha en 8081.
- No se inspeccionaron variables de entorno del proceso, archivos secretos ni bases de datos.
- No se aplicó la migración 011, no se inició el backend y no se ejecutaron pruebas de integración contra MySQL.

El hecho de que el servicio esté iniciado no basta para demostrar el host/puerto, el esquema seleccionado ni la identidad SQL. Antes de cualquier operación de base se requiere confirmar una configuración local que apunte exclusivamente a `piar_dev` o `piar_test` y capturar la credencial necesaria mediante prompt oculto, sin pasarla por chat. Para migrar se requiere además identidad autorizada de alcance mínimo.

## Próximas acciones seguras

1. Resolver por qué `MySQL80` no presenta un listener local detectable y confirmar explícitamente el puerto y nombre de una base de desarrollo, sin leer ni imprimir secretos.
2. Conectar primero con una consulta de solo lectura y verificar host, puerto, esquema e identidad antes de ejecutar pruebas con escritura.
3. Verificar la migración 011 y aplicar únicamente a una base local autorizada si falta.
4. Ejecutar pruebas de integración y persistencia usando datos sintéticos identificables.
5. Acordar el alcance institucional de estudiante y psicología, completar DUA/PDF si son requisitos, y continuar revisión de paginación, errores y accesibilidad.
6. Inventariar y validar respaldo de datos de prueba antes de solicitar autorización para retirar contenedores/volúmenes del piloto.

