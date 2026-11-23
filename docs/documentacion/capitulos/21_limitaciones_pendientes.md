# 21. Limitaciones, riesgos y pendientes

<!-- sub: Lo que falta para dar el sistema por completamente operativo -->

## 21.1 Pendientes de operación

Tabla: Pendientes priorizados

| # | Pendiente | Impacto | Responsable | Prioridad |
|---|---|---|---|---|
| P1 | Primer acceso de la Administradora 178 en producción | Sin él no se confirma que la cuenta trasladada funciona | Titular de la cuenta | Alta |
| P2 | Prueba real de creación y edición de estudiante y PIAR en producción | Falta evidencia del flujo principal en el entorno real | Administradora, con datos autorizados | Alta |
| P3 | Configurar Resend (clave y dominio verificado) | Sin correo no funcionan la verificación, la recuperación ni los avisos; las cuentas nuevas no pueden activarse | Institución | Alta |
| P4 | Configurar la verificación de salud `/api/health` en el panel de Railway | Railway no detecta un servicio degradado | Operador | Media |
| P5 | Ajustar `TRUSTED_PROXIES` con el procedimiento de diagnóstico | Los límites por IP pueden agrupar a todos tras la IP del proxy | Operador | Media |
| P6 | Investigar una sesión `railway ssh` no identificada (22 nov 2026, 07:30 UTC, despliegue anterior) | Posible acceso no atribuido | Titular del proyecto en Railway | Alta |
| P7 | Trasladar las contraseñas de producción a un gestor de contraseñas | Hoy están en un archivo temporal del equipo de despliegue | Operador | Alta |
| P8 | Rotar la credencial antigua expuesta en el historial de Git y limpiar el historial | Riesgo si la credencial sigue vigente en algún lugar | Titular, con autorización | Media |
| P9 | Retirar el acceso público al MySQL80 local (puertos 3306 y 33060 abiertos en el perfil público del firewall) | Exposición del equipo de desarrollo | Dueño del equipo | Alta |
| P10 | Cifrar los respaldos locales y restringir su lectura | Hoy son texto plano legible por otra cuenta del equipo | Dueño del equipo | Alta |
| P11 | Migrar `railway.json` antes del 1 de diciembre de 2026 (formato en retiro) | La configuración por archivo dejará de leerse | Operador | Media |
| P12 | Retirar la clave SSH dedicada al despliegue cuando ya no se necesite | Acceso residual | Operador | Baja |

## 21.2 Limitaciones técnicas

- **Correo desactivado** en producción (P3).
- **Una sola instancia** en el plan Trial: sin alta disponibilidad y con los límites del plan.
- **Archivos extensos:** `server.js` y `app.js` superan las 2.000 líneas; conviene dividirlos por módulo.
- **Carga inicial N+1:** el cliente pide los datos en varias consultas al arrancar.
- **Evidencias sin archivos:** solo texto y referencias.
- **OIDC oculto:** Google, Microsoft y Apple no están habilitados.

## 21.3 Riesgos y mitigación

Tabla: Matriz de riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Acceso no autorizado a datos de menores | Baja | Alto | Matriz de permisos en el servidor, auditoría, límites de intentos, sesiones revocables; resolver P6 y P7 |
| Pérdida de datos en producción | Baja | Alto | Volumen persistente, respaldos verificados con SHA-256, prueba de restauración semestral |
| Cuentas nuevas que no se activan por falta de correo | Alta | Medio | Configurar Resend (P3); mientras tanto, el Administrador crea las cuentas y comunica las credenciales por un canal seguro |
| Fin del plan Trial de Railway | Media | Alto | Presupuestar un plan pagado o migrar a otro proveedor con la misma imagen Docker |
| Error humano al migrar o configurar | Media | Alto | Ejecutor con confirmación de esquema, `GET_LOCK`, verificador de solo lectura y autorización previa |
| Dependencia vulnerable | Media | Medio | `npm audit` mensual; solo cuatro dependencias de producción |
| Regresiones al modificar archivos extensos | Media | Medio | 352 pruebas automáticas y prueba de regresión por cada error |

## 21.4 Contradicciones encontradas en la documentación anterior

Durante esta documentación se detectaron afirmaciones antiguas que ya no son ciertas:

- Los documentos académicos `docs/PIAR-DOC-01` a `PIAR-DOC-11` y `PIAR-DOCUMENTACION-CONSOLIDADA.md` describen `data/db.json`, `GET /api/data` y `POST /api/reset`. La persistencia en JSON se retiró y esas rutas responden hoy 410.
- La guía de documentación menciona **Bootstrap 5**. El sistema usa solo **Bootstrap Icons**, sin Bootstrap CSS ni JavaScript.
- `docs/MANUAL_USUARIO.md` menciona Gmail SMTP como el correo previsto. La opción vigente es Resend (D9), porque Railway bloquea el SMTP en el plan actual.
- `railway.json` declara una verificación de salud que Railway no aplicó.

Este documento reemplaza esas descripciones. Los documentos antiguos se conservan como histórico, sin modificarlos.

## 21.5 Pendientes de la entrega académica

- **Capacitación:** no hay registro de sesiones de capacitación ni actas firmadas. Se propone una sesión por perfil (Administrador, directivos, Psicólogo(a), docentes) de 60 a 90 minutos, con este manual como guía.
- **Acta de entrega y pruebas de aceptación:** pendientes de firma por la institución.
- **Datos de portada:** ficha y nombres del equipo, por completar.

## 21.6 Costos de operación conocidos

Tabla: Costos actuales y previstos

| Categoría | Detalle | Costo actual |
|---|---|---|
| Software y licencias | Node.js, MySQL Community, dependencias npm, Chart.js, Bootstrap Icons: todos de código abierto | Sin costo de licencia |
| Hospedaje | Railway, plan Trial (crédito de prueba limitado) | Sin cargo a la fecha; el uso continuo requiere un plan pagado |
| Dominio propio | No se ha comprado ninguno; se usa el dominio de Railway | Sin costo |
| Correo | Resend ofrece un plan gratuito con límites de envío; condiciones por confirmar al contratarlo | Sin contratar |
| Recursos humanos y hardware | Equipo del proyecto y equipo de desarrollo existentes | Por definir por la institución |

> **Nota:** este documento no incluye un presupuesto en dinero porque la institución no ha definido el plan de hospedaje ni los costos de personal. Las cifras deben confirmarse con las tarifas vigentes de cada proveedor al momento de contratar.
