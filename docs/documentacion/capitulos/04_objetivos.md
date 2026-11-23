# 4. Objetivos

<!-- sub: Lo que el proyecto se propuso lograr y su grado de cumplimiento -->

## 4.1 Objetivo general

Desarrollar una aplicación web segura que permita al Colegio Reinaldo Matiz elaborar, hacer seguimiento y conservar el Plan Individual de Ajustes Razonables de sus estudiantes, con control de acceso por rol y trazabilidad de cada cambio.

## 4.2 Objetivos específicos

Tabla: Objetivos específicos y su estado

| # | Objetivo | Evidencia | Estado |
|---|---|---|---|
| OE1 | Implementar la gestión de estudiantes y docentes con caracterización completa | Rutas `/api/estudiantes` y `/api/docentes`; pruebas de integración y e2e | [IMPLEMENTADO] [PROBADO LOCAL] |
| OE2 | Implementar el ciclo de vida del PIAR: creación, edición versionada, cierre y reapertura | `piar-versioning.js`; e2e con edición, cierre (409 a escrituras) y reapertura | [IMPLEMENTADO] [PROBADO LOCAL] |
| OE3 | Registrar barreras, ajustes razonables con evidencias y estrategias DUA vinculadas entre sí | Migraciones 008 y 013; `pedagogical-validation.js` | [IMPLEMENTADO] [PROBADO LOCAL] |
| OE4 | Aplicar un control de acceso por rol en el servidor para seis perfiles | `authorization.js` con denegación por omisión; pruebas de los 6 roles | [IMPLEMENTADO] [PROBADO LOCAL] |
| OE5 | Garantizar la seguridad de la autenticación y de los datos personales | bcrypt, sesiones en MySQL, CSP, límites de intentos, auditoría | [IMPLEMENTADO] [PROBADO LOCAL] |
| OE6 | Generar informes persistentes e indicadores en un tablero | `reports.js`, `/api/dashboard/resumen` | [IMPLEMENTADO] [PROBADO LOCAL] |
| OE7 | Desplegar el sistema en un entorno de producción con base de datos privada | Railway, despliegue `95d15fdd`, esquema `piar_produccion` con 28 tablas | [PRODUCCIÓN] |
| OE8 | Habilitar la comunicación por correo (verificación, recuperación, avisos) | Transporte Resend implementado y probado contra un simulador | [IMPLEMENTADO] [PENDIENTE] en producción |

## 4.3 Cumplimiento

Siete de los ocho objetivos se cumplieron en el código y en las pruebas locales, y el despliegue (OE7) está verificado en producción. El objetivo OE8 está implementado, pero en producción el correo sigue desactivado (`EMAIL_TRANSPORT=desactivado`) hasta que la institución configure una clave de Resend y un dominio verificado (capítulo 21).
