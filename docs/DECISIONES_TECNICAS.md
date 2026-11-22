# Decisiones técnicas e institucionales de PIAR-SISTEMA

Actualizado: 2026-11-22 · Rama `security/fase-1-hardening`.

Este documento recoge las decisiones vigentes. Ante cualquier contradicción con informes anteriores de `docs/` (incluidos `ESTADO_ACTUAL_PROYECTO.md` y `seguridad/AUTENTICACION-EXTERNA-PENDIENTES.md`), prevalece este.

## 1. Decisiones institucionales

| Tema | Decisión |
|---|---|
| Registro público | Docente, Psicólogo(a), Coordinador y Rector pueden solicitar una cuenta. Todas quedan pendientes de aprobación del Administrador. |
| Rol interno | Se conserva el valor `Psicóloga` en la base y en la matriz de permisos; la interfaz muestra "Psicólogo(a)". |
| Estudiantes | Sin registro público. Solo Administrador, Rector o Coordinador crean, editan y desactivan registros de estudiantes. La **cuenta** de acceso de un estudiante la crea solo el Administrador (D7). No cambian las reglas de visibilidad del PIAR. |
| Google | Cuentas Google personales. |
| Microsoft | Cuentas personales (Outlook) y cuentas organizacionales Microsoft 365 de tenants autorizados. |
| Apple | Apple ID. |
| Administrador principal | Se conserva la cuenta existente. No se crea otra, no se repite el bootstrap y no se cambian su correo, identificador, contraseña, rol ni permisos. |
| Correo de producción | Gmail SMTP, con contraseña de aplicación configurada por la institución en el entorno privado. |

Reglas comunes: seleccionar un perfil no concede permisos; el backend decide el estado de cada cuenta; no hay autoaprobación; una cuenta pendiente no accede al dashboard ni a información institucional; la matriz de `backend/authorization.js` no se modifica.

## 2. Decisiones D1 a D6

### D1. Cambio de correo con verificación (opción A)
- El Administrador solicita el cambio con `PUT /api/usuarios/:id` (`correo`). El correo actual **sigue vigente** hasta que se verifique el nuevo.
- Migración **016** (`016_email_change_request.sql`): tabla `cambio_correo` con el correo nuevo, el hash SHA-256 del token, quién lo solicitó, vencimiento (24 h) y consumo. Preparada y probada de forma estática; **no se ha ejecutado en ninguna base**.
- Se envía un enlace de un solo uso al correo nuevo (`/#verify-email-change=<token>`). Al confirmarlo (`POST /api/auth/email-change/confirm`), en una sola transacción:
  - se actualiza `usuario.correo` y `correo_verificado_at`;
  - se revocan todas las sesiones de la cuenta;
  - se invalidan los enlaces pendientes de recuperación de contraseña y de verificación (fueron enviados al correo anterior);
  - se registra `email_changed` en `admin_account_audit`.
- La solicitud queda en `admin_account_audit` como `email_change_requested`. Una nueva solicitud invalida la anterior.
- No se admite para cuentas que aún no verificaron su correo inicial (`pendiente_verificacion`).
- Sin la migración 016, la solicitud responde 503 y el correo no cambia.

### D2. Aprobación de los cuatro perfiles
- Docente: se conserva el flujo actual (crea o activa su perfil `docente`).
- Psicólogo(a), Coordinador y Rector: la aprobación activa la cuenta **sin crear perfil adicional**. La tabla `psicologa` no tiene vínculo con `usuario` y no se usa para autorizar; si una necesidad técnica obligara a crear perfil, se detendrá el trabajo para presentarla.
- Administrador y Estudiante nunca son solicitables (prueba de regresión obligatoria: `verifyEmail` activa directamente a un Administrador).

### D3. Creación institucional de usuarios
- `POST /api/usuarios` (solo Administrador) admite los mismos cuatro perfiles y sigue el mismo mecanismo: verificación del correo y aprobación posterior del Administrador.
- La creación, la aprobación y el rechazo quedan registrados en `admin_account_audit`, además de las columnas de decisión de `usuario`.
- Estudiantes: sin cambios; solo Administrador, Rector o Coordinador.

### D4. Microsoft personal y organizacional
- Lista configurable de tenants autorizados mediante variables de entorno (nombres definitivos en la fase 3, documentados en `.env.example` sin valores reales). Las cuentas personales se aceptan con el tenant de consumidores de Microsoft.
- El emisor del token se valida contra el tenant (`tid`) del propio token y la lista autorizada. Si la biblioteca `openid-client` no permite esa validación, se presentará la alternativa antes de implementarla; no se escribirá validación criptográfica manual.
- No se incorporan Tenant IDs ficticios.

### D5. Gestión de identidades externas
- Rutas propias de la cuenta autenticada: consultar, vincular y desvincular sus identidades. No dan acceso a datos de otras cuentas ni modifican la matriz de roles.
- Vincular y desvincular exigen sesión válida y reautenticación con la contraseña local.
- No se puede desvincular el único método de acceso de la cuenta.
- La vinculación exige identidad verificada por el proveedor (`email_verified` cuando el proveedor lo emite; en Microsoft, token firmado de un tenant autorizado).
- Nunca se vincula por coincidencia de correo. La identidad externa nunca concede un rol.
- Todas las operaciones quedan en `evento_seguridad`.
- Apple: callback por POST (`response_mode=form_post`) con continuación por GET en el mismo sitio, ámbitos `openid email name` y tratamiento del nombre, que Apple solo envía la primera vez. Requiere dominio HTTPS público; no se puede probar en local.

### D6. Conservación del Administrador en producción (opción A)
Procedimiento a documentar y ensayar antes de cualquier ejecución:
1. Comprobar que origen y destino tienen las mismas migraciones (`schema_migrations`, checksums) y los mismos tipos de columna de `usuario`.
2. Exportar **solo la fila** de esa cuenta en `usuario` (mismo `id_usuario`, correo, hash de contraseña, rol, estado y fechas de verificación).
3. Excluir sesiones, tokens de verificación y recuperación, transacciones OIDC, contadores de límites, eventos de seguridad y cualquier otra tabla.
4. Verificar la integridad con un hash de la fila calculado igual en origen y destino, y con consultas de comprobación.
5. Ensayo previo en un esquema desechable, con autorización propia.
El traslado a producción requiere autorización independiente y expresa. No se crea otra cuenta Administradora.

## 3. Plan de implementación ajustado

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Respaldo verificado del árbol de trabajo | Hecho (`respaldo-pre-fase-1-20261121_035001Z.tar.gz`) |
| 0 | Ampliar `check:secrets` a archivos sin seguimiento | Pendiente de autorización |
| 1 | `PUT` parcial de estudiantes; D1 (cambio de correo y migración 016 preparada); validación de docentes; auditoría OIDC; WOFF2; favicon | Hecho y revisado (migración 016 sin ejecutar) |
| 2 | D2 y D3: registro de cuatro perfiles, aprobación, mensajes de estado seguros, notificaciones por correo, diálogos accesibles | Hecho el 2026-11-21 (registro, aprobación, creación institucional y auditoría). Sin notificación por correo de la decisión. |
| 3 | D4 y D5: Microsoft por tenants, Apple con `form_post`, identidades externas | Implementado el 2026-11-21 y probado con simulaciones. Falta probarlo con credenciales reales y, para Apple, con un dominio HTTPS público. |
| 4 | Dashboard (fase 4 del rediseño) | Pendiente de autorización |
| 5 | Deuda técnica | 2026-11-22: CSP sin `'unsafe-inline'` en scripts, edición parcial sin `COALESCE` (PIAR y docentes), dependencias menores actualizadas. Pendiente: dividir `server.js` y paginar la carga inicial |
| 6 | Integración y e2e con MySQL | 2026-11-22: ejecutadas en esquemas desechables y aprobadas (`docs/MATRIZ_PRUEBAS_PIAR.md`) |
| 7 | Documentación, preparación de producción y procedimiento D6 | 2026-11-22: preparado y ensayado en local (D8). Cada paso en Railway requiere autorización |

Restricciones permanentes: sin migraciones ejecutadas, sin escrituras en MySQL, sin cambios en `.env`/`.env.test`, sin commits ni despliegues, sin cambios en la cuenta Administradora, salvo autorización expresa.

## 4. Implementación de D2 a D5 (2026-11-21)

- **D2:** `PUBLIC_REGISTRATION_ROLES` (`backend/auth.js`) = Docente, Psicóloga, Coordinador, Rector. La aprobación (`backend/registration-approval.js`) solo crea o activa el perfil `docente` para Docente; los otros tres perfiles se activan sin perfil adicional. La aprobación y el rechazo quedan en `admin_account_audit` (`registration_approved`, `registration_rejected`).
- **D3:** `POST /api/usuarios` (solo Administrador) admite los mismos cuatro perfiles. La cuenta queda en `pendiente_verificacion`, la contraseña asignada es temporal (`password_change_required = 1`) y la creación se audita como `account_created`. Un documento o correo duplicado responde 409 al Administrador; el registro público sigue sin revelarlo.
- **D4:** `MICROSOFT_TENANT_IDS` y `MICROSOFT_ALLOW_PERSONAL_ACCOUNTS` (`MICROSOFT_TENANT_ID` sigue admitido). Con varios tenants se usa la autoridad `organizations` o `common`. `openid-client` 6.8.8 valida la firma y el emisor de Entra ID con el `tid` del token; PIAR exige además que el `tid` esté autorizado y que `iss` sea el de ese tenant. Cualquier valor no válido deja el proveedor deshabilitado.
- **D5:** `GET /api/auth/identities` y `DELETE /api/auth/identities/:id` operan solo sobre la cuenta autenticada. Vincular (`POST /api/auth/oidc/:proveedor/link`) y desvincular exigen la contraseña local. Solo se vincula una identidad verificada: Google y Apple con `email_verified`, Microsoft con un token firmado de un tenant autorizado. No se desvincula el único método de acceso. Los eventos quedan en `evento_seguridad` (`oidc_vinculada`, `oidc_desvinculada`, `reautenticacion_fallida`).
- **Apple:** ámbitos `openid email name`, `response_mode=form_post`, y `client_secret` JWT ES256 de 5 minutos. `POST /api/auth/oidc/apple/callback` (único POST aceptado desde `https://appleid.apple.com`) solo reenvía `code`, `state` y `error` saneados al GET del mismo callback, donde se validan la cookie de estado, la transacción, el nonce y los tokens. El nombre que Apple envía la primera vez no se usa, porque PIAR no crea cuentas desde un proveedor externo.
- No se modificaron `backend/authorization.js` ni la cuenta Administradora (D6). No se ejecutó ninguna migración.

## 5. Decisiones del 2026-11-22

### D7. Cuenta de acceso del Estudiante
Recomendación adoptada para que el rol Estudiante sea operable; la institución puede revisarla.
- **Quién la crea:** solo el Administrador, desde Usuarios → Nueva cuenta → perfil Estudiante (`POST /api/usuarios`). Nunca hay registro público.
- **Vínculo:** con un registro de estudiante activo y sin cuenta (`estudiante.id_usuario`, único). Hay una sola cuenta por estudiante.
- **Autorización del acudiente:** el Administrador debe confirmar que la institución la tiene (Ley 1581, menores de edad). Queda en `admin_account_audit` con la referencia fija `autorizacion_acudiente_confirmada`. PIAR registra esa confirmación, pero no custodia el documento de autorización.
- **Activación:** la contraseña es temporal. Al verificar el correo, la cuenta queda activa sin pasar por Solicitudes, porque ya la creó el Administrador; en el primer acceso debe cambiar la contraseña.
- **Lo que no cambia:** la visibilidad del Estudiante (solo su PIAR, sin información profesional) y la matriz de `authorization.js`.

### D8. Producción
- **Base de datos:** se llama `piar_produccion`, con dos cuentas: `piar_app` (solo DML) para la aplicación y `piar_migrador` para migrar, que se bloquea al terminar. La aplicación nunca usa `root`.
- **Migraciones:** con `npm run db:migrate:remote`, que exige `PIAR_MIGRATION_CONFIRM_DATABASE` igual a `DB_NAME` y rechaza loopback y esquemas de prueba.
- **Arranque:** con `NODE_ENV=production` el servidor no arranca con una configuración insegura (`backend/production-config.js`). `HOST` vale `0.0.0.0` por omisión en producción.
- **Construcción:** `Dockerfile` y `railway.json` (comprobación de salud `/api/health`).
- **Administradora 178 (D6):** se traslada con `scripts/admin-transfer.js` (solo la fila, verificada con su huella, y reversible antes del primer uso).
- **Otros cambios:**
  - aviso por correo de la decisión sobre una solicitud, sin incluir el motivo del rechazo;
  - un campo opcional vaciado al editar un PIAR o un docente se guarda vacío;
  - CSP sin `'unsafe-inline'` en `script-src` (delegación de eventos en `public/js/event-actions.js`).
