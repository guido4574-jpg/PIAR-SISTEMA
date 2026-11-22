# Procedimientos pendientes de autorización

Actualizado: 2026-11-22. Cada sección es ejecutable. Las marcadas con 🔒 no se ejecutan sin autorización específica.
- **Convenciones:** los comandos son de PowerShell, desde la raíz del proyecto (`C:\Users\Catalina Plazas\Desktop\PIAR-SISTEMA`), salvo que se indique otra cosa.
- **Secretos:** nunca se imprimen ni se guardan en archivos.

**Variables de apoyo para las operaciones locales con root**, que leen la contraseña de `.env.test` sin mostrarla:
```powershell
$rootPw = ((Get-Content .env.test | Where-Object { $_ -match '^MYSQL_ROOT_PASSWORD=' }) -replace '^MYSQL_ROOT_PASSWORD=','').Trim('"',"'")
function Invoke-PiarRoot([string]$Sql) { docker exec -e MYSQL_PWD=$rootPw piar-mysql-test mysql -uroot -N -e $Sql }
```

## Orden recomendado

| Paso | Sección | Motivo del orden |
|---|---|---|
| 1 | C. Restringir MySQL80 | Riesgo alto y actual: está abierto a la red pública |
| 2 | D. Proteger los respaldos | Contienen datos y el hash de la Administradora |
| 3 | J. Decidir el correo real en 4 archivos | Bloquea los commits (`check:secrets` falla) |
| 4 | A. Commits | Requisito para rotar el historial y desplegar |
| 5 | B. Credencial antigua e historial | Después de los commits, para no perder trabajo |
| 6 | E y F. 016 en `piar_test` y reinicio de 8090 | Alinea el entorno local con el código |
| 7 | G y H. Railway y correo | `docs/DESPLIEGUE_RAILWAY.md` |
| 8 | I. Limpieza | Al final, cuando ya no se necesiten los ensayos |

## A. Commits separados 🔒

La rama `security/fase-1-hardening` tiene 221 rutas pendientes: 1 preparada (el borrado de `data/db.json`), 25 modificadas, 2 borradas sin preparar y 193 nuevas. Se verificó con `git add --dry-run` que los 7 grupos cubren las 221 rutas una sola vez.

**Requisitos antes del primer commit:**
- `npm test` en verde;
- `npm run check:secrets` sin hallazgos (cumplido el 2026-11-22 tras resolver la sección J.1).

**Estado:** los siete commits se hicieron en local el 2026-11-22 (`git log --oneline -8`). Falta el `push` 🔒.

**Mensaje de cada commit:** el título del grupo, una línea en blanco y la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

| N.º | Comando `git add` | Rutas esperadas en `git diff --cached --name-only` | Título del commit |
|---|---|---|---|
| 1 | `git add -A -- .gitignore .gitattributes scripts/check-sensitive-files.js tests/security-guard.test.js` | 5 (incluye `data/db.json`, ya preparado) | `seguridad: retira datos sensibles y amplía el detector de secretos` |
| 2 | `git add -A -- database backend/migrations.js backend/run-migration.js backend/database-config.js backend/db.js` | 25 | `bd: migraciones 000-016 versionadas con checksum y ejecutor local/remoto` |
| 3 | `git add -A -- backend package.json package-lock.json` | 34 | `backend: autenticación, permisos por rol, PIAR, cuentas y configuración de producción` |
| 4 | `git add -A -- public` | 24 | `frontend: rediseño, módulos por rol y CSP sin scripts en línea` |
| 5 | `git add -A -- tests scripts .github docker-compose.test.yml docker-compose.test.fresh.yml .env.test.example` | 69 | `pruebas: unitarias, integración, e2e y herramientas locales` |
| 6 | `git add -A -- Dockerfile .dockerignore railway.json .env.example docs/RAILWAY_DATABASE_SETUP.md` | 5 | `despliegue: Dockerfile, railway.json y plantilla de variables` |
| 7 | `git add -A -- README.md docs` | 59 | `docs: manuales, guías de MySQL y Railway, estado final e histórico` |

**Por cada grupo:**
```powershell
git add -A -- <rutas del grupo>
(git diff --cached --name-only | Measure-Object).Count    # debe coincidir con la tabla
git diff --cached --name-only | Select-String '(^|/)\.env(\.test)?$|respaldo|admin-row|\.sql\.gz$|\.dump$|\.p8$|\.pem$'   # debe salir vacío (las migraciones .sql sí se versionan)
git commit -F <archivo con el mensaje>
```

**Al terminar:**
- `git status --porcelain` debe quedar vacío (`.claude/`, `.env` y `.env.test` están ignorados).
- `git log --oneline -8` debe mostrar los 7 commits.
- `npm test` debe seguir en verde.

**Nota:** cada commit es revisable por área, pero solo el último deja el árbol completo y probado; los intermedios no se ejecutan por separado.

**Reversión (antes del push):** `git reset --soft HEAD~7` devuelve todos los cambios al índice sin perder nada. Es una operación sobre Git que también requiere autorización.

## B. Credencial antigua e historial 🔒

**Exposición verificada hoy** con las reglas de `check:secrets` sobre los 16 commits de todas las referencias. Solo se informan rutas, nunca valores:

| Ruta | Regla | Commits |
|---|---|---|
| `data/db.json` | datos locales (credencial de demostración y datos personales) | los 16, incluido `27a87f8` (= `origin/main`) |
| `docs/PIAR-DOC-05-MODULOS.md` | credencial de demostración | 14 (desde `f79315b`) |
| `public/js/data.js` | credencial de demostración | 7 (desde `2ae1f9c`) |
| `backend/server.js` | credencial de demostración | `f79315b`, `b898bef`, `2ae1f9c` |
| `docs/RAILWAY_DATABASE_SETUP.md` | falso positivo: el valor es una referencia de Railway `${{…}}`, no un secreto | `27a87f8` |

**Alcance:**
- **Dónde está:** la credencial es un correo de Gmail con una contraseña de 8 caracteres. También aparece en las referencias locales de herramientas (`refs/agents/…`, `refs/codex/…`), que no están publicadas.
- **Cuentas de PIAR:** comprobado en solo lectura, **no coincide** con ninguna cuenta de `piar_test` (correo y contraseña distintos de las cuentas 1, 80 y 178). Rotarla no afecta el acceso a PIAR.
- **Lo que no se puede comprobar desde aquí:** si esa contraseña se usa en la cuenta de Gmail del historial o en otro servicio, y si el repositorio es público hoy. `gh` no está instalado; la visibilidad se confirma en GitHub → Settings → General → Danger Zone.

**Rotación sin perder acceso:**
1. La persona titular inicia sesión en la cuenta de Gmail del historial y comprueba si su contraseña es la publicada. Si lo es, la cambia, activa la verificación en dos pasos y cierra las sesiones abiertas (Seguridad → Dispositivos).
2. Si esa contraseña se reutilizó en otros servicios, la cambia allí también.
3. PIAR no necesita cambios, porque ninguna cuenta usa esa credencial.

**Limpieza del historial:** el procedimiento detallado está en `docs/seguridad/PLAN_LIMPIEZA_HISTORIAL.md`. Necesita:
- los commits de la sección A hechos;
- `pip install git-filter-repo`, que hoy no está instalado;
- un respaldo espejo;
- `push --force` coordinado.

## C. Restringir MySQL80 (riesgo alto) 🔒

**Estado verificado en solo lectura:**
- `mysqld` (servicio `MySQL80`, inicio manual) escucha en `::` y `0.0.0.0`, en los puertos **3306** y **33060** (protocolo X).
- `my.ini` (`C:\ProgramData\MySQL\MySQL Server 8.0\my.ini`) no define `bind-address`.
- Hay dos reglas de entrada, «Port 3306» y «Port 33060», con acción Permitir en **cualquier perfil**.
- El perfil de red activo es **Público**: cualquier equipo de la misma red puede intentar conectarse. Ese MySQL aloja la base institucional `piar`.

**Dependencias:**
- Las aplicaciones locales conectan por `127.0.0.1` y no se ven afectadas.
- El contenedor piloto `piar-backend` (detenido) usaba `host.docker.internal:3306` y dejaría de conectar. Ya está decidido no arrancarlo.

**Paso 1, inmediato y reversible, sin reiniciar MySQL.** En PowerShell como administrador:
```powershell
Get-NetFirewallRule -DisplayName "Port 3306","Port 33060" | Format-Table DisplayName, Enabled, Profile, Action
Disable-NetFirewallRule -DisplayName "Port 3306","Port 33060"
Get-NetFirewallRule -DisplayName "Port 3306","Port 33060" | Format-Table DisplayName, Enabled     # Enabled = False
# Reversión: Enable-NetFirewallRule -DisplayName "Port 3306","Port 33060"
```
El firewall de Windows bloquea por omisión las entradas sin regla que las permita, y el tráfico de loopback no pasa por estas reglas.

**Paso 2, en una ventana de mantenimiento (reinicia MySQL80 unos segundos):**
```powershell
Copy-Item "C:\ProgramData\MySQL\MySQL Server 8.0\my.ini" "$HOME\Desktop\PIAR-SISTEMA-respaldos\my.ini.antes-bind-$(Get-Date -Format yyyyMMdd).bak"
# Editar my.ini como administrador: en [mysqld], justo debajo de la línea 91 "port=3306", agregar:
#   bind-address=127.0.0.1
#   mysqlx-bind-address=127.0.0.1
Restart-Service MySQL80
Get-NetTCPConnection -State Listen -LocalPort 3306,33060 | Format-Table LocalAddress, LocalPort   # solo 127.0.0.1
# Reversión: restaurar la copia de my.ini y Restart-Service MySQL80
```

## D. Proteger los respaldos 🔒

**Estado verificado:**
- Todos los `.sha256` de `Desktop\PIAR-SISTEMA-respaldos` verifican OK (15 archivos de hash).
- La carpeta está fuera del repositorio y no está en OneDrive.
- **Riesgo 1:** la carpeta hereda permiso de lectura para el grupo `FABIAN\CodexSandboxUsers`, el de otra herramienta de IA.
- **Riesgo 2:** junto a las copias cifradas `.gpg` hay copias **en claro**:
  - en `respaldo-bd-20261122_070036Z\`: `piar_3306_completo.sql`, `piar_test_3307_completo.sql`, `piar_test_3307_cuenta_admin_178.sql`, `piar_test_3307_cuenta_admin_178_columnas.sql`;
  - en la raíz: los volcados `piar_test_3307_*.sql`, incluido el de hoy `piar_test_3307_20261122_173846Z_pre016.sql`;
  - `transferencia-admin\admin-row-178-20261122T170030Z.json`, que contiene el hash de la Administradora.

**Retirar el permiso heredado** (reversible con la copia de las ACL):
```powershell
$r = "$HOME\Desktop\PIAR-SISTEMA-respaldos"
icacls $r /save "$HOME\Desktop\acl-respaldos-antes.txt" /T
icacls $r /inheritance:d
icacls $r /remove:g "FABIAN\CodexSandboxUsers" /T
icacls $r            # solo SYSTEM, Administradores y FABIAN\Fabian.R
# Reversión: icacls "$HOME\Desktop" /restore "$HOME\Desktop\acl-respaldos-antes.txt"
```

**Cifrar los volcados en claro**, con el mismo método que el 22-nov 07:29:
```powershell
gpg --symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 --s2k-count 65011712 --no-symkey-cache "<archivo>.sql"
gpg --decrypt "<archivo>.sql.gpg" | Get-FileHash -Algorithm SHA256   # debe coincidir con el .sha256 del archivo en claro
```
Borrar las copias en claro es una eliminación y requiere autorización aparte. El paquete de traslado se cifra igual y se descifra solo para el paso 5.4 de Railway.

## E. Migración 016 en `piar_test` 🔒

**Revisión:**
- `016_email_change_request.sql` solo crea la tabla `cambio_correo`, con `IF NOT EXISTS`, clave primaria, token único, índices y dos claves foráneas a `usuario` (`NO ACTION`).
- No modifica tablas ni filas existentes. Necesita `CREATE`, `INDEX` y `REFERENCES`.

**Efectos:**
- se activa el cambio de correo con verificación (antes respondía 503);
- la purga horaria empieza a limpiar los enlaces vencidos de `cambio_correo`;
- `usuario` no cambia.

**Compatibilidad:**
- Ensayada en dos esquemas nuevos y en una copia de `piar_test`: las 26 tablas previas quedaron idénticas por `CHECKSUM TABLE`.
- El backend de 8090 (código anterior) ya incluye D1, así que también la usa.

**Respaldo:** `piar_test_3307_20261122_173846Z_pre016.sql` (+ `.sha256`), verificado hoy restaurándolo en `piar_test_ensayo_verif`: 27 de 27 tablas idénticas. Si `piar_test` cambia antes de ejecutar, repetir el respaldo (paso 1).

**Procedimiento:**
```powershell
# 1. Respaldo y huella previos
$ts = (Get-Date).ToUniversalTime().ToString("yyyyMMdd_HHmmssZ"); $f = "$HOME\Desktop\PIAR-SISTEMA-respaldos\piar_test_3307_${ts}_pre016.sql"
docker exec -e MYSQL_PWD=$rootPw piar-mysql-test mysqldump -uroot --single-transaction --routines --triggers --events --hex-blob --skip-extended-insert --no-tablespaces --set-gtid-purged=OFF piar_test > $f
Get-FileHash $f -Algorithm SHA256
$tablas = Invoke-PiarRoot "SELECT GROUP_CONCAT(CONCAT('piar_test.',table_name)) FROM information_schema.tables WHERE table_schema='piar_test'"
Invoke-PiarRoot "CHECKSUM TABLE $tablas EXTENDED" > "$HOME\Desktop\PIAR-SISTEMA-respaldos\checksums_piar_test_antes_016.tsv"
# 2. Cuenta migradora temporal (solo sobre piar_test)
$migPw = node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
Invoke-PiarRoot "CREATE USER 'piar_migrador_test'@'%' IDENTIFIED BY '$migPw'; GRANT CREATE, ALTER, INDEX, REFERENCES, SELECT, INSERT, UPDATE, DELETE ON piar_test.* TO 'piar_migrador_test'@'%';"
# 3. Estado y aplicación
$env:NODE_ENV="test"; $env:DB_HOST="127.0.0.1"; $env:DB_PORT="3307"; $env:DB_NAME="piar_test"; $env:DB_USER="piar_migrador_test"; $env:DB_PASSWORD=$migPw
node backend/run-migration.js --status     # 15 aplicadas, 016 pendiente
node backend/run-migration.js              # «Migraciones aplicadas en piar_test: 1»
node backend/run-migration.js              # «Sin migraciones pendientes»
# 4. Bloquear la cuenta temporal
Invoke-PiarRoot "ALTER USER 'piar_migrador_test'@'%' ACCOUNT LOCK;"
Remove-Item Env:DB_PASSWORD; Remove-Variable migPw
```

**Verificación:**
```powershell
$env:DB_USER = ((Get-Content .env.test | Where-Object { $_ -match '^DB_USER=' }) -replace '^DB_USER=','').Trim('"',"'")
$env:DB_PASSWORD = ((Get-Content .env.test | Where-Object { $_ -match '^DB_PASSWORD=' }) -replace '^DB_PASSWORD=','').Trim('"',"'")
npm run db:verificar -- --paquete "$HOME\Desktop\PIAR-SISTEMA-respaldos\transferencia-admin\admin-row-178-20261122T170030Z.json"
#   esperado: tablas 28, migraciones 16/16, privilegios solo_dml, huellaAdmin true → «VERIFICACIÓN SUPERADA.»
$tablas = Invoke-PiarRoot "SELECT GROUP_CONCAT(CONCAT('piar_test.',table_name)) FROM information_schema.tables WHERE table_schema='piar_test' AND table_name NOT IN ('cambio_correo','schema_migrations')"
Invoke-PiarRoot "CHECKSUM TABLE $tablas EXTENDED"   # comparar con el archivo previo: 26 tablas idénticas
```
Si `sesion_usuario` o `evento_seguridad` cambian entre las dos huellas, la causa es el uso del backend de 8090, no la migración. Para evitarlo, detener 8090 antes del paso 1 (sección F).

**Reversión:** restaurar el respaldo del paso 1, con su autorización.

## F. Backend local del puerto 8090 🔒

**Estado verificado:**
- PID 24564 (`node backend/server.js`), hijo de PID 23944 (`node scripts/start-local-backend.js`), iniciado el 22-nov a las 10:59.
- Ejecuta el backend **anterior** a esta fase: 9 archivos de `backend/` cambiaron después.
- Sirve en vivo `public/`, así que el navegador recibe la interfaz nueva contra el backend viejo. Por ejemplo, «Nueva cuenta → Estudiante» responde 403 hasta reiniciarlo.

**Actualización:**
```powershell
Get-NetTCPConnection -State Listen -LocalPort 8090 | Select-Object OwningProcess              # confirmar el PID antes de detener
Get-CimInstance Win32_Process -Filter "ProcessId=24564 OR ProcessId=23944" | Select-Object ProcessId, CommandLine
Stop-Process -Id 23944, 24564
$env:MAINTENANCE_INTERVAL_MINUTES = "0"; Start-Process -NoNewWindow node "scripts/start-local-backend.js"
```

**Verificación** (solo GET públicos, que no escriben en `piar_test`):
```powershell
(Invoke-WebRequest http://127.0.0.1:8090/api/health).StatusCode                                      # 200
(Invoke-WebRequest http://127.0.0.1:8090/).Headers["Content-Security-Policy"] -match "unsafe-inline"   # solo en style-src
```
Después, la Administradora inicia sesión y comprueba Usuarios → Nueva cuenta → Estudiante (sin guardar).

## G. Railway 🔒
Procedimiento completo y verificaciones: `docs/DESPLIEGUE_RAILWAY.md` (§2 a §9). Lo primero es la decisión de correo del §0.

## H. Correo 🔒
- **Configuración y prueba:** `docs/DESPLIEGUE_RAILWAY.md` §7.
- **Herramienta:** `npm run correo:probar -- --verificar`, y para enviar, `-- --enviar <destino>` con `PIAR_CONFIRMAR_ENVIO=SI`.
- **Decisión pendiente:** el plan de Railway (§0), porque Hobby bloquea el SMTP.

## I. Inventario de elementos de ensayo (no se ha eliminado nada)

**Esquemas en `piar-mysql-test`.** Todos están en el volumen `c3c5424b…`, que también contiene `piar_test`. Se eliminan con `DROP DATABASE`, **nunca** borrando el volumen.

| Esquema | Tablas | Usuarios | Contenido sensible | Dependencias |
|---|---|---|---|---|
| `piar_test_ensayo_mig` | 28 | 1 | Fila de la Administradora 178 (hash) | Permisos de `piar_ensayo_mig` y `piar_ensayo_app` |
| `piar_test_ensayo_e2e` | 28 | 9 | Solo datos sintéticos de la e2e | Permisos de `piar_ensayo_mig` y `piar_ensayo_app` |
| `piar_test_ensayo_copia` | 28 | 3 | Copia completa de `piar_test` (incluye la 178) + 016 + 6 filas anónimas | Permisos de las tres cuentas de ensayo |
| `piar_produccion_ensayo` | 28 | 1 | Fila de la Administradora 178 | Permisos de `piar_ensayo_mig` y `piar_ensayo_app` |
| `piar_test_ensayo_verif` | 27 | 3 | Restauración del respaldo de hoy (igual a `piar_test`) | Ninguna cuenta con permisos |

**Las 6 filas anónimas investigadas** (solo en `piar_test_ensayo_copia`; ninguna en `piar_test`):

| Tabla | id | Tipo | Paso de la integración que la generó |
|---|---|---|---|
| `piar_auditoria` | 1627 | GET estudiantes, 401, sin actor | Petición sin sesión (`tests/integration.test.js:557`) |
| `piar_auditoria` | 1628 | GET estudiantes, 401, sin actor | Cookie mal formada (`:559`) |
| `evento_seguridad` | 135 | `reset_completado` | Restablecimiento con token sintético (`:572`) |
| `evento_seguridad` | 136 | `reset_fallido` | Reutilización del mismo token (`:582`) |
| `evento_seguridad` | 140 | `correo_verificado` éxito | Verificación del registro sintético (`:1050`) |
| `evento_seguridad` | 141 | `correo_verificado` fallo | Reutilización del token (`:1056`) |

- **Contenido:** ninguna tiene usuario, correo, hash ni detalle; solo la red `127.0.0.0/24`.
- **Momento:** se crearon entre las 17:04:38 y las 17:05:01 UTC, durante la integración.
- **Por qué no se atribuyen:** el servidor registra esos eventos sin identificar la cuenta, por diseño, y la limpieza no puede atribuirlos con certeza.
- **Limpieza:** desaparecen al eliminar la copia; no requieren otra acción.

**Cuentas MySQL**, todas bloqueadas (`account_locked = Y`) y sin privilegios globales:

| Cuenta | Privilegios |
|---|---|
| `piar_ensayo_mig@%` | DDL+DML sobre `_mig`, `_e2e`, `_copia` y `piar_produccion_ensayo` |
| `piar_ensayo_app@%` | DML sobre `_mig`, `_e2e`, `_copia` y `piar_produccion_ensayo` |
| `piar_ensayo_int@%` | DML sobre `_copia` |

**Docker.** Ningún contenedor tiene volúmenes, montajes ni reinicio automático. Todos dependen de una de las dos imágenes. Las variables de los contenedores (visibles con `docker inspect`) incluyen las contraseñas de las cuentas de ensayo bloqueadas y una contraseña SMTP ficticia.

| Contenedores (10, detenidos) | Imagen |
|---|---|
| `piar-ensayo-app`, `piar-ensayo-mig-1` a `-4`, `piar-ensayo-produccion`, `piar-ensayo-config-invalida` | `piar-sistema:ensayo-produccion` (`6c4eacc84792`, 254 MB) |
| `piar-ensayo-v2-verificar`, `piar-ensayo-v2-correo`, `piar-ensayo-v2-arranque` | `piar-sistema:ensayo-produccion-2` (actual, con las herramientas de verificación) |

No se tocan: `piar-mysql-test` y su volumen, `piar-backend` y su imagen, ni `mysql:8.0`.

**Archivos:**
| Archivo | Contenido | Estado |
|---|---|---|
| `Desktop\PIAR-SISTEMA-respaldos\transferencia-admin\admin-row-178-20261122T170030Z.json` (+ `.sha256`) | Fila de la Administradora con su hash | Verificado OK. Necesario para el traslado real. Cifrar (sección D) |
| `Desktop\PIAR-SISTEMA-respaldos\piar_test_3307_20261122_173846Z_pre016.sql` (+ `.sha256`) | Respaldo completo de `piar_test` | Verificado OK por restauración. Cifrar |
| Carpeta temporal de la sesión: `C:\Users\CATALI~1\AppData\Local\Temp\claude\53bf70dc28543917\ad28f268-7293-48df-a069-5e26f8fe18e5\scratchpad` | `ensayo.env` y `produccion-ensayo.env` (contraseñas de las cuentas de ensayo), perfil de Chrome, registros | Temporal. Sus credenciales solo sirven para cuentas bloqueadas |

**Orden de limpieza**, cuando se autorice:
1. `docker rm` de los 10 contenedores. Hay que hacerlo antes de retirar las imágenes, porque dependen de ellas.
2. `docker rmi piar-sistema:ensayo-produccion` (y `-2` si ya no se necesita).
3. `DROP DATABASE` de los 5 esquemas.
4. `DROP USER` de las 3 cuentas. Es seguro después del paso 3.
5. Borrar los archivos temporales de la sesión.

Antes del paso 3, comprobar con `npm run db:verificar` que `piar_test` sigue intacta. Nunca se ejecuta `docker volume rm` ni `docker system prune`.

## J. Decisiones pendientes

1. ~~Correo real de la Administradora en archivos que entrarían en Git~~ **Resuelto el 2026-11-22, antes de los commits.** Estaba en 4 archivos:
   - `scripts/bootstrap-local-primary-admin.js`
   - `tests/bootstrap-local-primary-admin.test.js`
   - `tests/initial-password-change.test.js`
   - `docs/CONTINUACION_VALIDACION_2026-10-30.md`

   Cambio aplicado:
   - el script lee `PIAR_BOOTSTRAP_ADMIN_EMAIL` y, sin esa variable, se detiene antes de cualquier consulta;
   - las pruebas usan un correo `.invalid`;
   - el documento lleva un marcador.

   La cuenta 178 no se tocó. `check:secrets` queda sin hallazgos.
2. **Correo en Railway:** plan Pro (Gmail SMTP) u otro proveedor por HTTPS (`docs/DESPLIEGUE_RAILWAY.md` §0).
3. **D7:** confirmar que solo el Administrador crea las cuentas Estudiante y cómo se custodia la autorización del acudiente.
