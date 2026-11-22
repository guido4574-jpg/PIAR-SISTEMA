> **Documento histórico.** El estado vigente está en `docs/ESTADO_FINAL_PROYECTO.md` (2026-11-22) y las decisiones en `docs/DECISIONES_TECNICAS.md`. Este informe se conserva como registro y puede contradecirlos.

# Informe de entrega — PIAR-SISTEMA

Fecha: 2026-11-21 · Rama: `security/fase-1-hardening` · Ningún cambio está commiteado ni desplegado.

Este informe describe el estado real del sistema en el árbol local. Las decisiones vigentes están en `docs/DECISIONES_TECNICAS.md`; el uso por rol, en `docs/MANUAL_USUARIO.md`; la instalación, en el `README.md`.

## 0. Decisión de entrega académica: solo correo y contraseña

El acceso se hace únicamente con correo y contraseña. Se mantienen el registro, la verificación del correo, la aprobación administrativa, la recuperación de contraseña y la gestión de cuentas.

- **Qué se oculta:** los botones de Google, Microsoft y Apple de la pantalla de acceso (el registro nunca tuvo botones externos) y la opción «Identidades externas» del menú de la cuenta.
- **Cómo:** con `features.externalAuth: false` en `public/js/config.js`.
- **Qué no cambia:** el código OAuth/OIDC, la vinculación de identidades (D4 y D5), sus rutas del backend, sus pruebas y sus variables de entorno. Quedan para una fase futura; se reactivan con `externalAuth: true` y las credenciales de cada proveedor.
- **Qué no se modificó:** la base de datos, los permisos y la cuenta Administradora.

## 1. Qué hace el sistema

PIAR-SISTEMA gestiona el Plan Individual de Ajustes Razonables del Colegio Reinaldo Matiz. Sus funciones son:

- estudiantes y docentes;
- PIAR con barreras, ajustes razonables y evidencias, DUA, diagnósticos, observaciones y seguimientos;
- historial de versiones, cierre y reapertura;
- informes guardados;
- cuentas con seis roles: Administrador, Rector, Coordinador, Psicólogo(a), Docente y Estudiante.

Tecnología: Node.js con HTTP nativo, `mysql2`, MySQL 8, y HTML, CSS y JavaScript sin frameworks, con Chart.js y Poppins alojada localmente.

## 2. Estado por módulo

Escala:
- **Terminado y probado:** pruebas automáticas, y además integración o e2e con MySQL.
- **Implementado sin validación completa:** pruebas automáticas aisladas (sin MySQL), sin ejecución real contra MySQL después del último cambio.
- **Bloqueado:** depende de configuración externa.

| Módulo | Estado | Evidencia |
|---|---|---|
| Inicio y cierre de sesión, expiración (8 h), protección de rutas, límites de intentos | Terminado y probado | Pruebas unitarias; integración, e2e y matriz HTTP de 6 roles (127/127) del 2026-11-09 |
| Recuperación de contraseña (token de un solo uso, 30 min, respuesta que no revela si la cuenta existe) | Terminado y probado (sin correo real) | `password-reset.test.js`; integración del 2026-11-09 |
| Matriz de permisos por rol, aislamiento del Estudiante, alcance del Docente | Terminado y probado | `authorization.test.js`, `student-portal.test.js`; matriz HTTP del 2026-11-09 |
| Estudiantes (creación, edición parcial, consulta) | Terminado y probado | e2e del 2026-11-09; edición parcial y etiquetas de la fase 1 en pruebas aisladas y revisión visual |
| Docentes (creación, edición, consulta) | Terminado y probado; los cambios de hoy, sin MySQL | e2e del 2026-11-09. Hoy: proyección completa para quien edita, etiquetas visibles y nombre sincronizado (pruebas aisladas y revisión visual) |
| PIAR, barreras, ajustes, evidencias, DUA, diagnósticos, observaciones, seguimientos, versiones, cierre y reapertura | Terminado y probado | e2e e integración del 2026-11-09 |
| Reportes persistentes (migración 014) | Terminado y probado | `reports.test.js`; e2e del 2026-11-09 |
| Dashboard por rol (fechas, tildes, «Nueva observación» según permisos) | Implementado sin validación completa | `ui-phase1-review.test.js`; revisión visual aislada en escritorio y móvil |
| Registro de cuatro perfiles (D2) | Implementado sin validación completa | `auth-registration.test.js`, `login-scene.test.js`, `ui-permissions.test.js`; revisión visual |
| Aprobación y rechazo de los cuatro perfiles con auditoría (D2) | Implementado sin validación completa | `registration-approval.test.js`, `registration-requests-ui.test.js`; revisión visual |
| Creación institucional de cuentas por el Administrador (D3) | Implementado sin validación completa | `auth-registration.test.js`; prueba HTTP en `backend-phase1.test.js`; revisión visual |
| Editar, desactivar y reactivar cuentas | Terminado y probado | `admin-account-operations.test.js`; e2e del 2026-11-09 |
| Cambio de correo con verificación (D1) | Implementado; **bloqueado por la migración 016** | `backend-phase1.test.js`. Sin la 016 responde 503 y el correo no cambia |
| Microsoft por tenants autorizados (D4) | Implementado y probado con simulaciones; **bloqueado por credenciales** | `oidc-identities.test.js` |
| Gestión de identidades externas: consultar, vincular con reautenticación, desvincular (D5) | Implementado y probado con simulaciones; **bloqueado por credenciales** | `oidc-identities.test.js` (incluye HTTP contra el `server.js` real); revisión visual |
| Google | Implementado y **oculto en la interfaz** (fase futura); bloqueado por credenciales | `oidc.test.js` |
| Apple (`form_post`, `client_secret` ES256, ámbito `name`) | Implementado y probado con simulaciones; **bloqueado** por credenciales y por falta de dominio HTTPS público | `oidc-identities.test.js` |
| Entrega de correo (verificación, recuperación, cambio de correo) | **Bloqueado** | Falta la contraseña de aplicación de Gmail SMTP en el entorno privado |
| Conservación del Administrador en producción (D6) | **Pendiente**: el procedimiento está documentado, pero no ensayado | `DECISIONES_TECNICAS.md` §D6 |

### Botones de acceso y registro

Comprobado en código, con pruebas y en la revisión visual:

- **Iniciar sesión:** `POST /api/auth/login`. Una cuenta no activa recibe el mismo mensaje genérico.
- **Registrarse / Crear una cuenta:** abre el formulario con el selector de los cuatro perfiles. Administrador y Estudiante no se ofrecen y el servidor los rechaza (400).
- **¿Olvidaste tu contraseña? / Reenviar verificación de correo:** formularios reales con respuestas genéricas.
- **Google, Microsoft y Apple:** ocultos en esta entrega (sección 0). Si se reactivan, sin credenciales aparecen deshabilitados; con credenciales, solo entran a cuentas que ya tienen el proveedor vinculado y nunca crean cuentas ni conceden roles.
- **Accesos rápidos:**
  - «Nueva observación» del dashboard y «Observación» de las tarjetas PIAR: solo para Coordinador, Psicóloga y Docente, y nunca en un PIAR cerrado.
  - «Nuevo estudiante», «Nuevo docente» y «Nueva cuenta»: solo para los roles autorizados.
  - Menú de cuenta: «Institución» y «Cerrar sesión». «Identidades externas» está oculto mientras el acceso externo no se reactive.

## 3. Pruebas ejecutadas hoy (resultados reales)

| Prueba | Resultado |
|---|---|
| `node --check` (105 archivos JavaScript de `backend/`, `public/js/`, `tests/` y `scripts/`) | Sin errores |
| `npm test` | **316 de 316 aprobadas**, 0 fallidas, 0 omitidas (última ejecución, 2026-11-22, con `tests/integration-cleanup.test.js`) |
| `npm run check:secrets` | Sin hallazgos |
| Pruebas HTTP contra el `server.js` real con base en memoria | Creación de cuentas (D3), proyección de docentes, reenvío del POST de Apple, identidades (D5), cambio de correo sin la 016 |
| Comprobación de las pruebas nuevas | Se reintrodujo cada defecto corregido en copias aisladas: 7 mutaciones de interfaz y 2 de backend. Todas las pruebas fallaron como debían |
| Revisión visual (Chrome sin interfaz, 1440 y 390 px, instancia aislada en 8091 sin MySQL) | Registro, Solicitudes, Nueva cuenta, Identidades externas, formulario de docente y PIAR (Administrador y Coordinador). 0 excepciones de JavaScript, 0 desbordamientos horizontales, 0 peticiones de escritura. Único error de consola: el 401 esperado de `/api/auth/me` antes del acceso |

**Integración con MySQL (2026-11-22, autorizada, `piar_test`):** 11 subpruebas aprobadas, 1 omitida por diseño (Estudiante) y **la limpieza final falló**. La auditoría de aprobaciones de D2 escribe en `admin_account_audit` y la limpieza no la borraba; además, el servidor de correo simulado quedaba abierto y el proceso se colgó.
- Quedaron 218 filas sintéticas (usuarios 179–186). Se eliminaron con autorización, en una sola transacción y con conteo exacto por sentencia. El primer intento hizo ROLLBACK por un error de orden del plan (`seguimiento` → `piar_ajuste`); el segundo terminó bien.
- Resultado: `piar_test` quedó idéntica a la huella previa (27 tablas, 254 filas, mismos checksums). Se conservó el usuario sintético 80.
- Corregido en `tests/integration.test.js`: borrado de `admin_account_audit`, de `cambio_correo` si existe (016), de `piar_dua` y de los eventos de seguridad atribuibles; además, el servidor de correo se cierra aunque la limpieza falle. `tests/integration-cleanup.test.js` fija el orden frente a las claves foráneas reales y detectó las tres mutaciones probadas.
- **Pendiente:** repetir la integración con la limpieza corregida (requiere autorización).

**e2e: no ejecutada.** Exige un esquema desechable `piar_test_<sufijo>` vacío y migrado (procedimiento en `docs/DESPLIEGUE_RAILWAY.md` §8; requiere autorización). Su último resultado es del 2026-11-09.

### 3.1 Revisión funcional con el backend real (8090, `piar_test`)

- **Backend:** se detuvo el proceso anterior del puerto 8090, que ejecutaba código previo a los cambios de hoy, y se inició el actual con `node scripts/start-local-backend.js` y `MAINTENANCE_INTERVAL_MINUTES=0`. Responde en `http://127.0.0.1:8090` contra `127.0.0.1:3307/piar_test`.
- **Sin sesión (Chrome, 1440 y 390 px):**
  - Pantalla de acceso, registro con los cuatro perfiles y recuperación de contraseña.
  - Google, Microsoft y Apple deshabilitados con «No disponible».
  - Solo peticiones GET; el único error es el 401 esperado de `/api/auth/me`.
- **Con la sesión del Administrador:** el Administrador inició sesión personalmente en una ventana dedicada. La contraseña no se vio, no se capturó y no se almacenó. La revisión solo navegó; no se envió ningún formulario.
  - **Pantallas revisadas en escritorio y móvil:**
    - Dashboard, Solicitudes, Usuarios, Estudiantes, Docentes, PIAR / PR, Reportes y Configuración.
    - Formularios de edición de estudiante y de docente.
    - Perfiles de estudiante y de docente.
    - Detalle del PIAR: DUA, ajustes razonables, barreras, diagnósticos, observaciones, seguimientos y versiones.
    - Formularios «Nuevo PIAR», «Nueva cuenta» e «Identidades externas».
  - **Resultado:** 0 excepciones de JavaScript, 0 errores HTTP, 0 desbordamientos horizontales, 0 peticiones distintas de GET, ninguna fecha en formato ISO y ningún «undefined», «null» ni «NaN» en pantalla. Todos los campos de los formularios tienen etiqueta y ningún botón queda sin acción.
  - **Permisos comprobados en pantalla:**
    - Menú con las ocho secciones del Administrador.
    - «Nueva observación» no aparece, ni en el dashboard ni en las tarjetas PIAR, y su formulario no se abre: el Administrador no registra observaciones.
    - El detalle del PIAR ofrece Editar, Docentes asignados, Cerrar, Imprimir y registrar DUA, barrera y ajuste.
- **Defectos corregidos en esta revisión (solo presentación, `public/js/app.js`):**
  - Tildes en títulos, perfiles, detalle del PIAR, mensajes vacíos e informe imprimible.
  - Fechas de las tarjetas y del detalle del PIAR (revisión, observaciones y seguimientos), y del informe, con el mismo formato que el dashboard.
  - El estado `draft`, que asigna el backend por omisión, se mostraba sin traducir; ahora aparece como «Borrador».
  - Etiquetas visibles en los 26 campos del formulario «Nuevo PIAR / PR».
  - Pruebas añadidas en `tests/ui-phase1-review.test.js`.
- **No se probó, por requerir escrituras funcionales:** guardar estudiantes, docentes, PIAR, diagnósticos, barreras, ajustes, DUA, observaciones y seguimientos; crear, aprobar, rechazar, desactivar o editar cuentas; generar y guardar informes; vincular identidades.
- **Dato con caracteres dañados en `piar_test`:** el PIAR de prueba existente muestra «Validaci?n UI» y «pedag?gica». Los caracteres se guardaron así en la base (probablemente por una prueba anterior); no es un defecto de la interfaz y no se modificó.

## 4. Migraciones

| Migración | Estado en `piar_test` |
|---|---|
| 000–003, 005–015 | Aplicadas (2026-11-09), con checksum en `schema_migrations` |
| 016 `016_email_change_request.sql` (D1) | Preparada; **no se ha ejecutado en ninguna base** |

Los cambios de hoy no necesitan migraciones nuevas:
- `admin_account_audit.operation` es VARCHAR(32);
- `evento_seguridad.tipo` es VARCHAR(40);
- `usuario.password_change_required` existe desde la 011.

La base institucional `piar` no se tocó.

## 5. Configuración pendiente para producción

El procedimiento completo (variables, migraciones, respaldo, usuario MySQL dedicado, Dockerfile propuesto y orden de publicación) está en `docs/DESPLIEGUE_RAILWAY.md`.

1. **Correo:** `EMAIL_TRANSPORT=smtp` con Gmail (`EMAIL_SMTP_*`, `EMAIL_FROM`) y una contraseña de aplicación en el entorno privado, más una prueba de envío autorizada.
2. **`APP_BASE_URL`:** con HTTPS y el dominio definitivo.
3. **Google:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y el URI de redirección registrado en Google Cloud.
4. **Microsoft:** registro en Entra ID (`MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, URI de redirección). Además, `MICROSOFT_TENANT_IDS` con los Tenant IDs reales autorizados y `MICROSOFT_ALLOW_PERSONAL_ACCOUNTS=true` si se aceptan cuentas Outlook. Con varios tenants, la aplicación debe registrarse como multiinquilino.
5. **Apple:** Services ID, Team ID, Key ID y clave privada `.p8` (`APPLE_*`), más un dominio HTTPS público verificado en Apple. No se puede probar en local.
6. **Migración 016:** aplicarla con un ensayo previo en una copia.
7. **D6:** ensayar y ejecutar el traslado de la cuenta Administradora con el procedimiento documentado.
8. **Escrituras funcionales contra MySQL:** el backend local en 8090 ya ejecuta el código actual (ver §3.1). Falta repetir con autorización la integración (ya con la limpieza corregida) y ejecutar la e2e en un esquema desechable.

## 6. Limitaciones conocidas

- Aprobar o rechazar una solicitud no envía un correo con la decisión.
- Las fechas del dashboard dependen de que el navegador esté en la misma zona horaria que el servidor.
- La demostración visual (`npm run demo:visual`) no implementa `/api/auth/identities`. Solo afecta si se reactiva el acceso externo.
- El rol de una cuenta existente no se cambia desde la interfaz (decisión vigente).

## 7. Estado de entrega

**Listo para entrega académica, con las limitaciones documentadas, y para demostración local** con `npm run demo:visual` o con el backend sobre `piar_test` una vez autorizado el reinicio.

**No está listo para producción institucional.** Faltan el correo real, las credenciales de los proveedores externos, la migración 016, el procedimiento D6, HTTPS y la validación con MySQL de los cambios de la fase 1 y de hoy.
