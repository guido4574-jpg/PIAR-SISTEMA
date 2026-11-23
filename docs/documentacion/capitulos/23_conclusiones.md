# 23. Conclusiones

<!-- sub: Resultados alcanzados, aprendizajes y recomendaciones -->

## 23.1 Resultados alcanzados

- El sistema cubre el ciclo completo del PIAR que define el Decreto 1421 de 2017: caracterización, barreras, ajustes razonables con evidencias, estrategias DUA, seguimiento, cierre y entrega mediante informes persistentes.
- El control de acceso por rol se aplica en el servidor para seis perfiles. El portal del Estudiante protege la información clínica y profesional.
- La trazabilidad es completa: cada edición del PIAR exige justificación y queda versionada; observaciones y seguimientos son inmutables.
- La calidad está respaldada por 352 pruebas unitarias aprobadas, pruebas de integración y e2e con MySQL real, y verificaciones en producción.
- El sistema está publicado en Railway con una base de datos privada, una cuenta de aplicación con privilegios mínimos y la Administradora trasladada sin alterar su identidad.

Siete de los ocho objetivos específicos se cumplieron. El octavo, la comunicación por correo, está implementado pero espera que la institución configure el proveedor.

## 23.2 Competencias desarrolladas

- **Técnicas:** desarrollo de servidores HTTP sin frameworks, diseño de bases de datos relacionales con integridad referencial, migraciones versionadas, seguridad web (CSP, sesiones, control de origen, límites de intentos), pruebas automatizadas en varios niveles, contenedores y despliegue en la nube.
- **De gestión:** trabajo por fases con autorización previa, registro de decisiones (D1–D9), respaldo antes de cada cambio y reporte honesto de lo probado y lo pendiente.

## 23.3 Aprendizajes

- **La seguridad cambia el diseño de la interfaz:** retirar los scripts en línea para tener una CSP estricta obligó a crear un despachador de eventos, que a su vez provocó el error del inicio de sesión corregido en `6158d9a`. Cada control de seguridad necesita sus propias pruebas de regresión.
- **Una prueba local no reemplaza la verificación en producción:** el bloqueo del SMTP en Railway solo apareció al preparar el despliegue y obligó a implementar Resend.
- **La trazabilidad es un requisito, no un extra:** el versionado del PIAR y la auditoría hicieron posible demostrar quién cambió qué.
- **Documentar el estado real evita confusiones:** varios documentos antiguos describían funciones retiradas.

## 23.4 Recomendaciones

1. Resolver los pendientes de prioridad alta del capítulo 21 antes de cargar datos reales, en especial el correo, el primer acceso de la Administradora y la revisión de la sesión SSH no identificada.
2. Realizar una prueba piloto con un grupo pequeño de docentes y datos autorizados, y registrar el resultado como prueba de aceptación.
3. Dividir `server.js` y `app.js` en módulos por dominio y optimizar la carga inicial.
4. Presupuestar un plan de Railway que permita alta disponibilidad, o un proveedor alternativo, antes de que termine el plan Trial.
5. Programar respaldos automáticos cifrados y una prueba de restauración cada semestre.
6. Capacitar a cada perfil con el manual de usuario y firmar las actas de capacitación y entrega.
