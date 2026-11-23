# 20. Mantenimiento y solución de problemas

<!-- sub: Tareas periódicas, respaldos y diagnóstico de fallas frecuentes -->

## 20.1 Plan de mantenimiento

Tabla: Tareas de mantenimiento

| Tarea | Frecuencia | Responsable | Cómo |
|---|---|---|---|
| Purga de tokens, sesiones y eventos vencidos | Automática cada 60 minutos | Sistema | `MAINTENANCE_INTERVAL_MINUTES=60`; manual con `npm run db:purge-expired` |
| Respaldo de la base de datos | Antes de cada cambio y periódicamente | Operador autorizado | `mysqldump` por la conexión de Railway, con suma SHA-256 y almacenamiento cifrado |
| Revisión de dependencias | Mensual | Desarrollo | `npm audit --omit=dev` y actualización controlada |
| Revisión de eventos de seguridad | Mensual | Administrador o soporte | Consultas de solo lectura sobre `evento_seguridad` y `piar_auditoria` |
| Verificación de la base | Tras cada migración o restauración | Operador | `npm run db:verificar` |
| Revisión de cuentas | Cada periodo académico | Administrador | Desactivar las cuentas de personal que ya no trabaja en la institución |
| Prueba de restauración | Semestral | Operador | Restaurar un respaldo en un esquema de ensayo y comparar con `CHECKSUM TABLE` |

## 20.2 Plan de respaldo y recuperación

- **Qué se respalda:** el esquema `piar_produccion` completo (estructura y datos).
- **Cuándo:** antes de toda migración, traslado o cambio de configuración de MySQL, y de forma periódica.
- **Cómo se verifica:** cada respaldo lleva su archivo `.sha256`. En la fase de cierre se comprobaron 15 de 15 respaldos y se restauró uno en una base de ensayo con 27 de 27 tablas idénticas.
- **Dónde se guarda:** fuera del repositorio y con acceso restringido.

> **Pendiente:** los respaldos locales actuales están en texto plano y son legibles por otra cuenta del equipo. Hay que cifrarlos y restringir sus permisos (capítulo 21).

## 20.3 Solución de problemas

Tabla: Problemas frecuentes y solución

| Síntoma | Causa probable | Solución |
|---|---|---|
| El botón queda en «Ingresando…» | Versión anterior al commit `6158d9a`: el evento delegado tenía `currentTarget = document` | Desplegar `6158d9a` o posterior; la petición también se cancela a los 30 s |
| «Correo o contraseña incorrectos» con la contraseña correcta | La cuenta está pendiente, rechazada o desactivada | El Administrador revisa el estado en **Usuarios** |
| No llega el correo de verificación o recuperación | `EMAIL_TRANSPORT=desactivado` o Resend sin dominio verificado | Configurar Resend (capítulo 19.5) |
| Respuesta 429 | Se superó el límite de intentos | Esperar el tiempo indicado en `Retry-After` |
| Respuesta 403 al guardar | Rol sin permiso u origen no incluido en `CORS_ORIGIN` | Revisar la matriz de permisos o la variable `CORS_ORIGIN` |
| Respuesta 409 al editar un PIAR | El PIAR está cerrado | El Coordinador lo reabre con justificación |
| El servidor no arranca en Railway | `production-config.js` detectó una configuración insegura | Leer el registro del despliegue, corregir la variable indicada y redesplegar |
| `/api/health` responde 503 | El servidor no alcanza MySQL | Revisar el servicio MySQL, `DB_HOST` y las credenciales de `piar_app` |
| `npm start` no conecta en local | El `.env` local no define `DB_USER` | Usar `node scripts/start-local-backend.js` |
| Pruebas que fallan de forma aleatoria en local | Memoria insuficiente | Cerrar programas y repetir; ejecutar el archivo afectado por separado |
| Error de checksum al migrar | Se editó una migración ya aplicada | Restaurar el archivo original y crear una migración nueva |

## 20.4 Soporte

- **Primer nivel:** el Administrador del sistema atiende cuentas, contraseñas y permisos.
- **Segundo nivel:** el equipo técnico atiende fallas, despliegues y restauraciones, siguiendo `docs/PROCEDIMIENTOS_PENDIENTES.md`.
- **Regla de operación:** ningún cambio en producción (variables, migraciones, cuentas) se hace sin autorización expresa y sin respaldo previo verificado.
