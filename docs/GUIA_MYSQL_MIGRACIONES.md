# Guía de MySQL y migraciones

Actualizada: 2026-11-22. La puesta en producción en Railway está en `docs/DESPLIEGUE_RAILWAY.md`; esta guía explica la base de datos, las migraciones y cómo verificarlas.

## 1. Variables que lee el backend

El backend solo usa variables `DB_*`; no lee `MYSQL_URL` ni `DATABASE_URL`.

| Variable | Obligatoria | Uso |
|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME` | Sí | Servidor y esquema. En producción `DB_HOST` no puede ser localhost y `DB_NAME` no puede ser `piar_test*` ni `piar_dev*`. El esquema `piar` está bloqueado siempre (`backend/db.js`). |
| `DB_USER`, `DB_PASSWORD` | Sí | Cuenta de la aplicación. Se rechaza `root`. Debe tener solo `SELECT, INSERT, UPDATE, DELETE`. |
| `DB_CONNECTION_LIMIT` | No (10) | Tamaño del grupo de conexiones (1–100). |
| `DB_SSL` | No (`off`) | `required` cifra sin verificar el certificado; `verify` cifra y verifica con `DB_SSL_CA` (PEM; se admiten saltos escritos como `\n`). |
| `MIGRATION_DB_USER`, `MIGRATION_DB_PASSWORD` | Solo para migrar | Cuenta migradora. Sustituye a `DB_USER`/`DB_PASSWORD` únicamente en el proceso del ejecutor. |
| `PIAR_MIGRATION_CONFIRM_DATABASE` | Solo en modo remoto | Debe ser igual a `DB_NAME`. |

## 2. Cuentas MySQL

| Cuenta | Privilegios | Quién la usa |
|---|---|---|
| Aplicación (`piar_app`) | `SELECT, INSERT, UPDATE, DELETE` sobre el esquema | El servidor |
| Migradora (`piar_migrador` o `root` de Railway) | `CREATE, ALTER, INDEX, REFERENCES` más DML sobre el esquema | Solo el ejecutor de migraciones. Al terminar se bloquea (`ALTER USER … ACCOUNT LOCK`). |

## 3. Migraciones

- Están en `database/migrations/NNN_nombre.sql`: de la 000 a la 016 (no existe la 004).
- Cada una queda registrada en `schema_migrations` con su checksum SHA-256.
- `database/migrations/local/` es histórica y no forma parte de la secuencia.
- Todas son re-ejecutables: usan `IF NOT EXISTS` o una comprobación previa en `information_schema`.
- Si se edita una migración ya aplicada, el ejecutor se detiene (estado `modificada`): hay que crear una migración nueva.
- La aplicación **nunca** migra al arrancar.

| Versión | Contenido |
|---|---|
| 000 | Esquema base: usuarios, sesiones, tokens, perfiles, PIAR, diagnóstico, seguimiento, observación, historial, reporte |
| 001 | Núcleo del MVP: columnas, claves y tablas de verificación y recuperación (condicional sobre bases antiguas) |
| 002, 010 | Auditoría y motivo de las decisiones de registro |
| 003 | Identidades OIDC y transacciones de inicio externo |
| 005 | `usuario.estado` de 30 caracteres |
| 006, 008 | Campos pedagógicos y trazabilidad barrera–ajuste–evidencia–seguimiento |
| 007 | `piar_auditoria` |
| 009, 011 | `admin_account_audit` y `usuario.password_change_required` |
| 012 | `evento_seguridad` y `limite_solicitudes`; `docente.documento` de 30 caracteres |
| 013 | `piar_dua` |
| 014 | Informes persistentes (`reporte` con instantánea) |
| 015 | Rol `Estudiante` y `estudiante.id_usuario` (único) |
| 016 | `cambio_correo` (cambio de correo con verificación, D1) |

### Comandos

| Comando | Destino admitido | Qué hace |
|---|---|---|
| `npm run db:migrate:status` | Loopback, `piar_dev*` o `piar_test*` | Lista el estado (solo lectura; no crea tablas) |
| `npm run db:migrate` | Igual | Aplica las pendientes en orden |
| `npm run db:migrate:remote:status` | Remoto, no loopback, ni `piar`, ni `piar_test*`, ni `piar_dev*` | Estado, solo lectura |
| `npm run db:migrate:remote` | Igual | Aplica las pendientes con `GET_LOCK` (evita dos ejecuciones simultáneas) |

El modo remoto exige `PIAR_MIGRATION_CONFIRM_DATABASE` igual a `DB_NAME`. Solo en este modo se admite `root`, y únicamente como `MIGRATION_DB_USER`.

## 4. Esquema esperado tras 000–016

**28 tablas**, en orden alfabético:
- `admin_account_audit`
- `cambio_correo`
- `coordinador`
- `diagnostico`
- `docente`
- `estudiante`
- `evento_seguridad`
- `external_identity`
- `historial`
- `historial_detalle`
- `limite_solicitudes`
- `observacion`
- `oidc_login_transaction`
- `piar`
- `piar_ajuste`
- `piar_ajuste_evidencia`
- `piar_auditoria`
- `piar_barrera`
- `piar_docente`
- `piar_dua`
- `psicologa`
- `recuperacion_contrasena`
- `reporte`
- `schema_migrations`
- `seguimiento`
- `sesion_usuario`
- `usuario`
- `verificacion_correo`

`piar_test` tiene 27, porque todavía no tiene la 016.

Consultas de verificación (solo lectura):

```sql
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();          -- 28
SELECT COUNT(*), MIN(version), MAX(version) FROM schema_migrations;                      -- 16, 000, 016
SELECT version, LEFT(checksum, 8) FROM schema_migrations ORDER BY version;              -- comparar con la tabla siguiente
SELECT COLUMN_TYPE FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'usuario' AND column_name = 'rol';     -- enum con 'Estudiante'
```

Checksums esperados (los 8 primeros caracteres; `npm run db:migrate:status` los compara completos):

| 000 | 001 | 002 | 003 | 005 | 006 | 007 | 008 |
|---|---|---|---|---|---|---|---|
| e9eaaafc | 2775f696 | d6b5ff9f | 6fbec4fc | 5860c0f2 | 4e183960 | 4eb3ecf9 | 91469c1b |

| 009 | 010 | 011 | 012 | 013 | 014 | 015 | 016 |
|---|---|---|---|---|---|---|---|
| c4f849ce | a3d1b04f | 502ff100 | 437dd05b | 949a679f | 17e4c19f | 7c4e6462 | b74ae566 |

## 5. Ensayo en una base local desechable

Este es el procedimiento que se usó el 2026-11-22 (resultados en `docs/MATRIZ_PRUEBAS_PIAR.md`).

1. Como root dentro de `piar-mysql-test`:
   - crear `piar_test_ensayo_<sufijo>` con `utf8mb4_unicode_ci`;
   - crear una cuenta migradora y otra de aplicación, con privilegios solo sobre ese esquema.
2. Ejecutar `npm run db:migrate` con `NODE_ENV=test` y las variables `DB_*` de la cuenta migradora, apuntando a `127.0.0.1:3307`.
3. Repetir el paso 2: debe responder «Sin migraciones pendientes».
4. Reaplicar cada archivo: `node backend/run-migration.js database/migrations/NNN_x.sql`. Ninguno debe fallar.
5. Comparar columnas, índices y claves foráneas con `piar_test` mediante `information_schema`.
6. Bloquear las cuentas temporales con `ACCOUNT LOCK`. El esquema solo se elimina con autorización.

**Actualizar una base existente**, como `piar_test` para aplicar la 016:
1. Respaldar con `mysqldump --single-transaction --skip-extended-insert`.
2. Restaurar la copia en `piar_test_ensayo_<sufijo>`.
3. Aplicar las pendientes en la copia y comparar `CHECKSUM TABLE … EXTENDED` de las tablas previas.
4. Solo después, y con autorización, aplicarlas en la base real.

## 6. Respaldo y recuperación

- **Respaldo:** `mysqldump --single-transaction --routines --triggers --no-tablespaces --set-gtid-purged=OFF <esquema>`.
  - Se guarda fuera del repositorio (`Desktop/PIAR-SISTEMA-respaldos/`) con su `.sha256`.
  - `check:secrets` rechaza volcados dentro del repositorio.
- **Verificación:** restaurar en un esquema de ensayo y comparar `CHECKSUM TABLE … EXTENDED` tabla por tabla. Así se hizo el 2026-11-22 con `piar_test` → `piar_test_ensayo_copia`: 27 de 27 idénticas.
- **Recuperación:** restaurar el volcado verificado en el esquema de destino, con autorización y con la aplicación detenida. Las migraciones son aditivas: no hay migraciones «de bajada», así que revertir una migración consiste en restaurar el respaldo previo.
