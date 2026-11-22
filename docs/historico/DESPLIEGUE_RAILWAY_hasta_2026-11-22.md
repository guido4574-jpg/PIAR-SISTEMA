# Despliegue en Railway, migraciones y respaldo

Fecha: 2026-11-22 · Rama `security/fase-1-hardening` · Nada de esto está commiteado ni desplegado.

Este documento prepara la publicación. **Ningún paso se ha ejecutado contra Railway ni contra producción.** Cada operación marcada con 🔒 requiere autorización expresa.

## 1. Estado verificado

| Punto | Estado real |
|---|---|
| Rama y commit | `security/fase-1-hardening` = `27a87f8` = `origin/main` según la copia local (sin `fetch`). Todo el trabajo posterior está sin commitear: 22 archivos modificados, 5 borrados y 78 sin seguimiento. |
| Lo que ejecuta Railway | **No verificado.** La sesión de la CLI (`railway` 5.58.0) venció. Por los mensajes de commit, el último despliegue sería `27a87f8`, anterior al endurecimiento. Hay que comprobarlo con `railway status` tras `railway login`. |
| `Dockerfile` / `.dockerignore` | Existen en `HEAD`, pero se retiraron del árbol en una fase anterior («Retiro piloto», `docs/INFORME_CORRECCIONES_PIAR.md`). Si se commitea el árbol tal cual, Railway pierde el `Dockerfile`. Propuesta en §6 🔒. |
| HOST | Por omisión `127.0.0.1`, lo correcto para el uso local. En el contenedor debe ser `HOST=0.0.0.0`; si no, Railway no recibe tráfico. |
| PORT | Railway lo inyecta; el servidor lo respeta. |
| Usuario MySQL | La aplicación rechaza `root` (`backend/database-config.js`). El usuario por omisión del MySQL de Railway suele ser `root`, así que hace falta uno dedicado con solo DML (§4) 🔒. |
| Migraciones | El ejecutor solo admite loopback y esquemas `piar_dev*` o `piar_test*` (`assertLocalMigrationTarget`). No puede migrar la base de Railway (normalmente `railway`); ver §3. |
| HTTPS y sesiones | Con `NODE_ENV=production`: cookie `HttpOnly; SameSite=Lax; Secure`, HSTS, CSP y `X-Frame-Options: DENY`. Las sesiones se guardan en MySQL (`sesion_usuario`) y sobreviven a los reinicios. `APP_BASE_URL` debe usar `https`. |
| CORS y origen | Toda petición POST, PUT o DELETE exige un origen incluido en `CORS_ORIGIN`. Sin el dominio público ahí, todo responde 403. |
| Proxy | Sin `TRUSTED_PROXIES`, la IP del cliente es la del proxy de Railway: todos los usuarios comparten el límite de intentos de acceso y los eventos de seguridad pierden la red de origen. El rango del proxy no está verificado; hay que comprobar qué dirección llega al servidor tras el primer despliegue. |
| Límites de intentos | `RATE_LIMIT_STORE=memory` sirve para una sola instancia (se reinicia con cada despliegue). Con varias instancias, usar `mysql` (tabla de la migración 012). |
| Correo | `EMAIL_TRANSPORT=smtp` con Gmail y contraseña de aplicación. Sin él, registro y recuperación responden igual, pero no llega ningún enlace. `memory` está deshabilitado en producción. |
| Errores y registros | Las respuestas 500 no exponen trazas («Error interno del servidor»). Los registros no imprimen tokens ni contraseñas. `/api/dev/email-outbox` responde 404 en producción. |
| Salud | `GET /api/health` responde 200 si MySQL responde y 503 si no. Sirve como comprobación de salud en Railway. |
| Cierre ordenado | No hay manejador de `SIGTERM`: al redesplegar se cortan las peticiones en curso. Riesgo menor; no se cambió por no poder probarlo en este equipo (Windows). |
| Acceso externo | Oculto (`features.externalAuth: false`); no necesita variables de proveedores. |

## 2. Variables de entorno en Railway

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` (o `ENV` en el `Dockerfile`) |
| `PORT` | Lo inyecta Railway |
| `DB_HOST`, `DB_PORT`, `DB_NAME` | `${{MySQL.MYSQLHOST}}`, `${{MySQL.MYSQLPORT}}`, `${{MySQL.MYSQLDATABASE}}` |
| `DB_USER`, `DB_PASSWORD` | Usuario dedicado con solo DML (§4). **Nunca** `root`. |
| `DB_CONNECTION_LIMIT` | `10` |
| `APP_BASE_URL` | `https://<dominio público>` |
| `CORS_ORIGIN` | `https://<dominio público>` |
| `TRUSTED_PROXIES` | Rango del proxy de Railway, una vez verificado |
| `RATE_LIMIT_STORE` | `memory` (una instancia) o `mysql` |
| `MAINTENANCE_INTERVAL_MINUTES` | `60` |
| `SECURITY_EVENT_RETENTION_DAYS` | `365` |
| `EMAIL_TRANSPORT`, `EMAIL_FROM` | `smtp` y el remitente institucional |
| `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_SECURE` | `smtp.gmail.com`, `465`/`true` o `587`/`false` |
| `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASSWORD` | Cuenta y contraseña de aplicación de Gmail (solo en Railway) |

Los secretos se configuran solo en Railway. No van en el repositorio ni en `.env.example`.

## 3. Migraciones

### 3.1 Inventario y orden

Se aplican en orden numérico; no existe la 004. Todas son re-ejecutables (`IF NOT EXISTS` o comprobación previa en `information_schema`).

| Migración | Contenido | Riesgo |
|---|---|---|
| 000 `base_schema` | Esquema base: usuarios, sesiones, tokens, perfiles, PIAR, diagnóstico, seguimiento, observación, historial, reporte y auditoría | Sustituye a la antigua `000_railway_schema` (15 tablas); son compatibles con `IF NOT EXISTS` |
| 001 `mvp_core` | Columnas y claves del núcleo | `MODIFY COLUMN usuario.rol` (ENUM): falla si existen valores fuera de la lista |
| 002, 010 | Auditoría y motivo de las decisiones de registro | Aditivas |
| 003 | Transacciones OIDC e identidades externas | Aditiva |
| 005 | `usuario.estado` a VARCHAR(30) | Reconstruye la tabla (bloqueo breve) |
| 006, 008 | Campos pedagógicos y trazabilidad (barreras, ajustes, evidencias, seguimientos) | Aditivas; la 008 depende de `piar`, `usuario`, `piar_ajuste` y `seguimiento` |
| 007 | `piar_auditoria` | Aditiva |
| 009 | `admin_account_audit` | Aditiva |
| 011 | `usuario.password_change_required` | Aditiva |
| 012 | `evento_seguridad`, límites de intentos y `docente.documento` a 30 | Ampliación de columna |
| 013 | DUA | Aditiva |
| 014 | Informes persistentes | Aditiva |
| 015 | Rol Estudiante y `estudiante.id_usuario` | `MODIFY COLUMN usuario.rol` (ENUM); conserva los valores existentes |
| 016 | `cambio_correo` (D1) | Aditiva; **no se ha aplicado en ninguna base** |

Estado conocido: en `piar_test` están aplicadas de la 000 a la 015, con checksum en `schema_migrations`. **En producción el estado es desconocido**: probablemente solo tiene `000_railway_schema`, sin `schema_migrations`.

### 3.2 Procedimiento de respaldo y recuperación (antes de cualquier cambio)
1. 🔒 Inspección de solo lectura en producción: tablas, existencia de `schema_migrations`, valores distintos de `usuario.rol`, longitudes máximas de `usuario.estado` y `docente.documento`, y filas por tabla.
2. 🔒 Volcado completo: `mysqldump --single-transaction --routines --triggers --skip-extended-insert` a través de una conexión TCP de Railway. Se guarda fuera del repositorio, en `Desktop/PIAR-SISTEMA-respaldos/`, con su `.sha256`.
3. Verificar el volcado restaurándolo en un esquema desechable local (`piar_test_prod_<fecha>`) y comparando filas y `CHECKSUM TABLE` por tabla.
4. Recuperación: restaurar el volcado en la base de Railway y redesplegar el despliegue anterior desde el panel de Railway.

### 3.3 Ensayo sobre una copia desechable
1. 🔒 Como `root` dentro de `piar-mysql-test` (con la contraseña tomada de `.env.test`, sin imprimirla): crear `piar_test_prod_<fecha>`, restaurar el volcado y crear una cuenta migradora temporal con permisos solo sobre ese esquema.
2. 🔒 `npm run db:migrate` con `DB_NAME=piar_test_prod_<fecha>` y la cuenta migradora. El ejecutor lo admite porque es loopback y `piar_test_*`.
3. Comprobar que las filas previas siguen idénticas, que no hay errores de ENUM y que `npm run db:migrate:status` da 16/16 aplicadas.
4. Arrancar el backend contra la copia (`PIAR_LOCAL_DB_NAME=piar_test_prod_<fecha> PORT=8092 MAINTENANCE_INTERVAL_MINUTES=0 node scripts/start-local-backend.js`) y revisar el acceso en modo lectura.
5. 🔒 Eliminar la copia y la cuenta migradora.

### 3.4 Aplicación en producción (elegir una vía) 🔒
- **A.** Un ajuste controlado del ejecutor: un perfil explícito de producción que pida confirmar el nombre de la base y que solo lo use una cuenta migradora temporal. Cambia un control de seguridad y requiere aprobación.
- **B.** Aplicar los archivos 000–016 en orden con el cliente `mysql`, en una ventana de mantenimiento, y registrar después cada versión en `schema_migrations` con su checksum, igual que lo hace el ejecutor.

## 4. Usuario MySQL dedicado 🔒
Con una cuenta administradora de la base de Railway:
`CREATE USER 'piar_app'@'%' IDENTIFIED BY '<secreto generado fuera del repositorio>'; GRANT SELECT, INSERT, UPDATE, DELETE ON <base>.* TO 'piar_app'@'%';`
La aplicación usa solo esta cuenta. Las migraciones se hacen con una cuenta migradora temporal que se elimina después.

## 5. Cuenta Administradora (D6) 🔒
Se aplica el procedimiento de `docs/DECISIONES_TECNICAS.md` §D6: exportar solo la fila de la cuenta existente, excluir sesiones y tokens, verificar con un hash de la fila y ensayar en una copia. No se crea otra cuenta ni se ejecuta el *bootstrap*.

## 6. Dockerfile propuesto 🔒
Requiere autorización, porque revierte el retiro del piloto. Imagen mínima, sin dependencias de desarrollo y sin ejecutarse como `root`:

```dockerfile
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY backend ./backend
COPY public ./public
COPY database ./database
USER node
EXPOSE 8080
CMD ["node", "backend/server.js"]
```

`.dockerignore`: `.git`, `.env`, `.env.*`, `!.env.example`, `node_modules`, `data`, `tests`, `docs`, `scripts`, `.claude`, `.github`, `*.log`.
En Railway, configurar `/api/health` como ruta de comprobación de salud.

## 7. Credencial antigua del historial 🔒
El procedimiento está en `docs/seguridad/PLAN_LIMPIEZA_HISTORIAL.md`. Orden obligatorio:
1. Rotar la credencial y no reutilizarla.
2. Commitear el trabajo local.
3. Hacer un respaldo espejo.
4. Reescribir el historial con un archivo de reemplazos que quede fuera del repositorio.
5. Verificar con `git log --all -S`.
6. `push --force` coordinado.

La credencial no se reproduce en ningún documento.

## 8. Esquema e2e desechable 🔒
La prueba e2e exige un esquema `piar_test_<sufijo>` vacío y migrado y deja datos a propósito. El procedimiento es el de §3.3, sin restaurar ningún volcado:
1. Crear `piar_test_e2e_<fecha>` y aplicar 000–015 (o hasta la 016).
2. Dar a la cuenta de la aplicación solo DML sobre ese esquema.
3. Ejecutar `npm run test:e2e` con `PIAR_E2E_DB_NAME`, `PIAR_E2E_DB_PORT=3307` y `PIAR_E2E_DB_USER`/`PASSWORD`, más `PIAR_E2E_API_PORT` distinto de 8090.
4. Eliminar el esquema.

## 9. Secuencia de publicación
1. `railway login` y consulta de solo lectura (servicio, dominio, commit desplegado y nombres de variables).
2. 🔒 Rotar la credencial antigua.
3. 🔒 Restaurar o crear el `Dockerfile` y el `.dockerignore` (§6).
4. 🔒 Commit en la rama, `push`, y PR o fusión con `main`, o apuntar Railway a la rama.
5. 🔒 Respaldo y ensayo de migraciones (§3.2 y §3.3).
6. 🔒 Migraciones en producción (§3.4) y usuario dedicado (§4).
7. 🔒 Cuenta Administradora (§5).
8. 🔒 Variables (§2), despliegue y comprobación rápida: `/api/health`, acceso, cookie `Secure`, CSP, y una prueba de correo autorizada.
9. Verificar `TRUSTED_PROXIES` con la dirección real que llega al servidor.
