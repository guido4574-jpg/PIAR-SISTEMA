# Matriz de pruebas PIAR-SISTEMA

Ejecución actual: 20 de octubre de 2026, rama `security/fase-1-hardening`.

| Área | Pruebas | Alcance de evidencia |
|---|---|---|
| Registro, login y sesión | `auth-registration.test.js`, `auth-session.test.js` | Mocks; rol Docente, hash, duplicados, estados, comparación bcrypt para usuario inexistente, cookie y sesión |
| Autorización | `authorization.test.js` | Matriz de roles/rutas en memoria; no conexión MySQL |
| Asignación administrativa | `registration-approval.test.js`, `registration-requests-ui.test.js` | Actor/fecha, estados admisibles y UI simulada |
| Verificación y correo | `email-verification.test.js`, `email-delivery.test.js` | Tokens y transportes simulados; no prueba entrega real |
| Recuperación | `password-reset.test.js` | Expiración, un uso, concurrencia, transacción, rollback y revocación con mocks |
| Bootstrap | `bootstrap-local-primary-admin.test.js`, `primary-admin-bootstrap.test.js` | Destino local fijado y creación transaccional simulada; no se creó cuenta real |
| Rate limiting | `rate-limit.test.js` | Ventana, llaves y límite en memoria |
| Base de datos | `database-config.test.js`, `local-piar-test-config.test.js` | Variables obligatorias, rechazo de root/piar y destino de integración exacto |
| Origen/rutas estáticas/XSS | `security-controls.test.js`, `security-output.test.js` | Origin exacto, wildcard rechazado, traversal y escape HTML |
| Migraciones | `migration-validator.test.js` | Compatibilidad/propiedades del SQL fuente; no ejecuta migraciones |
| OIDC | `oidc.test.js` | Mocks para configuración, state/nonce/PKCE, claims y vínculo; no prueba proveedor real |
| Integración HTTP/MySQL | `integration.test.js` | **No ejecutada**: requiere fixtures escribibles en `127.0.0.1:3307/piar_test` |
| Navegador/PDF/correo/SSO real | — | Pendiente de entorno y servicios autorizados |

## Resultados ejecutados en esta continuación

- Árbol actual: `npm.cmd test` pasó **77/77**, 0 fallidas, 0 omitidas.
- Pruebas enfocadas tras las correcciones de config/login/origen/rutas: `node --test tests/auth-registration.test.js tests/database-config.test.js tests/security-controls.test.js` pasó **13/13**.
- `node --check` pasó para **47** archivos JavaScript de backend, frontend, scripts y pruebas; `npm ls --depth=0` confirmó las dependencias directas instaladas.
- `npm audit` online pasó con **0 avisos** (17 dependencias totales según npm). `npm audit --offline` también informó 0, aunque esa caché por sí sola no era suficiente para vigencia.
- Verificación MySQL dirigida al único destino permitido, `127.0.0.1:3307/piar_test`: **ECONNREFUSED**. El servicio Windows `MySQL80` aparece Running, no hay listener TCP en 3306, 3307 o 8081, y Docker CLI no está instalado. No se ejecutó test de integración y no hubo escrituras; no se inició el servicio.
- No se ejecutaron migraciones, pruebas de correo real ni proveedores OIDC reales.

Comandos:

```powershell
npm test
npm run test:integration:local
```

El segundo comando requiere servicio MySQL de pruebas ya iniciado por el operador, contraseña ingresada de forma interactiva y preflight satisfactorio. No apunta a `piar`/3306. `docker-compose.test.yml` es solo un mecanismo opcional para MySQL temporal de pruebas y no un despliegue de la app.

## Ejecución actual de Codex — 20 de octubre de 2026

- `npm.cmd test`: **77 aprobadas, 0 fallidas, 0 omitidas**. Incluye pruebas aisladas/mock de autenticación, aprobación, recuperación, rate limiting, autorización, OIDC, configuración y SQL estático.
- `node --check` sobre JavaScript de `backend/`, `public/js/`, `scripts/` y `tests/`: aprobado. `npm.cmd ls --depth=0`: correcto. `npm.cmd audit --offline`: 0 vulnerabilidades en la caché local; este resultado no equivale a una auditoría online actual.
- `git diff --check`: aprobado.
- Integración HTTP/MySQL y CRUD persistente: bloqueados. Docker CLI no está disponible, por lo que no se pudo consultar el estado de `piar-mysql-test`, verificar el mapeo del puerto, ni contar tablas en `piar_test`. No se ejecutó el runner de escritura ni se accedió a MySQL80/3306.
- No se ejecutaron migraciones, correo real, proveedores OIDC reales, navegador ni pruebas PDF. Los flujos de correo y OIDC solo tienen cobertura simulada.

## Actualizacion de autenticacion y pruebas — 28 de octubre de 2026

- Registro publico: solo admite solicitar Docente. La creacion del usuario pendiente y su token de verificacion hash ahora es transaccional; el fallo al guardar el token revierte la cuenta. El endpoint aplica limites en memoria por IP (10/15 min) y correo normalizado (5/15 min).
- Aprobacion: endpoint `POST /api/usuarios/:id/aprobacion`, reservado a Administrador. El backend rechaza autoaprobacion; el rechazo requiere motivo de hasta 500 caracteres y lo persiste junto con decisor y fecha. La interfaz solicita el motivo.
- Cambio de esquema pendiente: `database/migrations/010_registration_decision_reason.sql` agrega `usuario.decision_reason VARCHAR(500) NULL` de forma aditiva. No se ejecuto; el servidor que use el nuevo endpoint necesita esta columna.
- Roles: solo Docente tiene flujo publico soportado. Administrador, Rector, Coordinador y Psicologa requieren alta interna autorizada; Estudiante y familia no son roles tradicionales de `usuario`. No existen endpoints de invitacion implementados: faltan vinculos y permisos institucionales validados para perfiles de Coordinacion/Psicologia.
- `npm.cmd test`: 147 aprobadas, 0 fallidas y 0 omitidas. Son pruebas unitarias con mocks y verificaciones estaticas; no validan MySQL ni el correo real.
- Integracion/esquema 3308 no verificados. No se ejecuto migracion, bootstrap, recuperacion ni prueba de integracion. No se leyeron ni cambiaron `.env` o `.env.test`.

### Actualización: servidor de demostración visual — 28 de octubre de 2026

- Se añadieron cinco pruebas unitarias para el servidor de demostración separado: vista pública no autenticada, datos ficticios de Docente/PIAR, rechazo de escrituras, cierre de la cookie sintética y contención de rutas.
- `npm.cmd run test:unit`: **152 aprobadas, 0 fallidas, 0 omitidas**; duración Node **70.177 ms (aprox. 70,2 s)**. Resultado posterior a la suite de 147 y correspondiente al código actual.
- La prueba ejercita el servicio HTTP aislado en loopback; no prueba navegador real, backend productivo, MySQL, correo, aprobación ni autorización del servidor real.
