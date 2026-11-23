# 5. Alcance y limitaciones

<!-- sub: Qué incluye el sistema y qué queda fuera -->

## 5.1 Alcance funcional

Tabla: Módulos incluidos en la versión 6158d9a

| Módulo | Incluye | Estado |
|---|---|---|
| Acceso y cuentas | Inicio y cierre de sesión, registro público de cuatro perfiles, verificación del correo, recuperación de contraseña, cambio obligatorio de contraseña temporal, cambio de correo verificado | [IMPLEMENTADO] [PROBADO LOCAL] |
| Solicitudes y usuarios | Aprobación o rechazo con motivo, creación institucional de cuentas, cuenta Estudiante vinculada, edición, desactivación y reactivación | [IMPLEMENTADO] [PROBADO LOCAL] |
| Estudiantes y docentes | Alta, edición, consulta y desactivación; alcance del Docente limitado a sus asignaciones | [IMPLEMENTADO] [PROBADO LOCAL] |
| PIAR | Creación, edición con justificación y versión, asignación de docentes, cierre, reapertura, historial de versiones | [IMPLEMENTADO] [PROBADO LOCAL] |
| Componentes pedagógicos | Barreras, ajustes razonables, evidencias, DUA, diagnósticos, observaciones, seguimientos | [IMPLEMENTADO] [PROBADO LOCAL] |
| Reportes y tablero | Informes con instantánea, impresión, tablero con indicadores y gráficas | [IMPLEMENTADO] [PROBADO LOCAL] |
| Portal del Estudiante | Consulta de solo lectura del propio PIAR, sin datos clínicos ni profesionales | [IMPLEMENTADO] [PROBADO LOCAL] |
| Seguridad y auditoría | Matriz de permisos, CSP, control de origen, límites de intentos, eventos de seguridad, auditoría | [IMPLEMENTADO] [PROBADO LOCAL] |
| Producción | Imagen Docker, migraciones remotas, verificación de la base, traslado de la Administradora | [PRODUCCIÓN] |

## 5.2 Fuera de alcance

- **Almacenamiento de archivos:** las evidencias son descriptivas (texto y referencia). El sistema no guarda documentos ni imágenes subidas.
- **Inicio de sesión con Google, Microsoft o Apple:** el código existe (`oidc.js`), pero la interfaz lo oculta y no hay credenciales configuradas (decisiones D4 y D5).
- **Aplicación móvil nativa:** la interfaz web es adaptable a pantallas pequeñas, pero no hay aplicación para tiendas.
- **Integración con el SIMAT** u otros sistemas oficiales del Ministerio de Educación.
- **Firma electrónica** de actas y del PIAR.
- **Exportación a PDF o Excel desde el servidor:** el informe se imprime desde el navegador.

## 5.3 Limitaciones conocidas

> **Atención:** estas limitaciones afectan el uso real del sistema y se detallan en el capítulo 21.

- **Correo desactivado en producción:** los enlaces de verificación, recuperación y cambio de correo no se entregan. Por eso, una cuenta nueva no puede completar la verificación hasta que se configure Resend.
- **Flujo pedagógico sin evidencia en producción:** las pruebas de creación y edición de estudiantes y PIAR se hicieron en local con datos sintéticos.
- **Instancia única:** el servicio corre en una sola réplica del plan Trial de Railway.
- **Archivos grandes en el código:** `backend/server.js` (2.086 líneas) y `public/js/app.js` (2.372 líneas) concentran muchas responsabilidades, lo que dificulta el mantenimiento.
- **Carga inicial con consultas N+1:** el frontend pide los datos por separado en el arranque; con muchos registros será más lento.
