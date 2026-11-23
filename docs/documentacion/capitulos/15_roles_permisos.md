# 15. Usuarios, roles y permisos

<!-- sub: Matriz de autorización aplicada por el servidor -->

## 15.1 Roles

Tabla: Descripción de los roles

| Rol | Valor en la base de datos | Descripción |
|---|---|---|
| Administrador | `Administrador` | Gestiona cuentas y solicitudes; administra estudiantes, docentes y PIAR. La cuenta principal (ID 178) se conserva por decisión D6 |
| Rector | `Rector` | Dirección: gestiona estudiantes, docentes y PIAR, y consulta reportes |
| Coordinador | `Coordinador` | Supervisión pedagógica: además de lo del Rector, reabre PIAR y registra diagnósticos, observaciones y seguimientos |
| Psicólogo(a) | `Psicóloga` (se muestra como «Psicólogo(a)») | Valoración: diagnósticos y observaciones; no modifica el plan |
| Docente | `Docente` | Solo los PIAR y estudiantes que tiene asignados |
| Estudiante | `Estudiante` | Consulta de solo lectura de su propio PIAR (decisión D7) |

## 15.2 Matriz de permisos

La matriz está definida en `backend/authorization.js` con **denegación por omisión**: toda ruta que no tenga un permiso declarado se rechaza.

Tabla: Matriz de permisos por rol

| Recurso | Administrador | Rector | Coordinador | Psicólogo(a) | Docente | Estudiante |
|---|---|---|---|---|---|---|
| Solicitudes y usuarios | Todo | — | — | — | — | — |
| Estudiantes y docentes: consultar | Sí | Sí | Sí | Sí | Asignados o su perfil | — |
| Estudiantes y docentes: crear, editar, desactivar | Sí | Sí | Sí | — | — | — |
| PIAR: consultar | Sí | Sí | Sí | Sí | Asignados | Solo el propio, reducido |
| PIAR: crear y editar | Sí | Sí | Sí | — | Asignados | — |
| PIAR: cerrar y asignar docentes | Sí | Sí | Sí | — | — | — |
| PIAR: reabrir | — | — | Sí | — | — | — |
| Barreras, ajustes, evidencias, DUA | Sí, incluso eliminar ajustes | Sí, incluso eliminar ajustes | Sí, incluso eliminar ajustes | Consulta | Crear y editar en asignados | — |
| Diagnósticos | Editar y eliminar | Editar y eliminar | Crear, editar y eliminar | Crear y editar | Consulta en asignados | — |
| Observaciones | Consulta | Consulta | Crear | Crear | Crear en asignados | — |
| Seguimientos | Consulta | Consulta | Crear | Consulta | Crear en asignados | — |
| Historial, versiones, reportes, tablero | Sí | Sí | Sí | Sí | Asignados | — |

Estado: [IMPLEMENTADO] [PROBADO LOCAL]. Las pruebas de integración y e2e comprueban los seis roles y el alcance del Docente por asignación.

## 15.3 Estados de una cuenta

Tabla: Estados de la cuenta

| Estado | Significado | Puede ingresar |
|---|---|---|
| `pendiente_verificacion` | Cuenta creada; falta confirmar el correo | No |
| `pendiente` | Correo verificado; espera la decisión del Administrador | No |
| `activo` | Aprobada o creada y verificada | Sí |
| `rechazado` | Solicitud rechazada con motivo | No |
| `inactivo` | Desactivada por el Administrador; sus sesiones se revocaron | No |

## 15.4 Reglas de protección de cuentas

- La institución no puede quedarse sin Administrador activo, y un Administrador no puede desactivarse a sí mismo.
- El rol no se cambia desde la interfaz.
- La cuenta Administradora 178 se trasladó a producción con `scripts/admin-transfer.js`, conservando exactamente su identidad y su hash de contraseña (huella SHA-256 idéntica en origen y destino) [PRODUCCIÓN]. Su titular aún debe realizar el primer acceso [PENDIENTE].
- Toda operación administrativa sobre cuentas queda en `admin_account_audit`.
