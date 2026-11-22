# Estado final del proyecto PIAR-SISTEMA

Fecha: 2026-11-22 (cierre de la entrega) · Rama `security/fase-1-hardening` · **Siete commits locales; nada publicado (`push`) ni desplegado.** Railway no se ha desplegado ni probado.

Los procedimientos ejecutables de lo pendiente, con su orden y sus verificaciones, están en `docs/PROCEDIMIENTOS_PENDIENTES.md`. El inventario actualizado de los elementos de ensayo está en su §I; la §4 de este documento es la versión anterior.

Este documento sustituye como referencia a `docs/ESTADO_ACTUAL_PROYECTO.md` y a `docs/INFORME_ENTREGA_PIAR.md`, que se conservan como histórico.

## 1. Estado por módulo

**Escala:**
- **Operativo y probado:** pruebas unitarias, más integración o e2e con MySQL real el 2026-11-22.
- **Implementado:** pruebas sin MySQL o simuladas.
- **Bloqueado:** depende de configuración externa.

| Módulo | Estado |
|---|---|
| Inicio y cierre de sesión, sesiones de 8 h, límites de intentos, recuperación de contraseña (sin correo real) | Operativo y probado |
| Matriz de permisos de los 6 roles, alcance del Docente, aislamiento del Estudiante | Operativo y probado |
| Estudiantes y docentes | Operativo y probado |
| PIAR completo: barreras, ajustes, evidencias, DUA, diagnósticos, observaciones, seguimientos, versiones, cierre y reapertura, edición parcial con campos vaciables | Operativo y probado |
| Reportes persistentes, historial, dashboard | Operativo y probado |
| Registro de 4 perfiles, aprobación y rechazo con auditoría y aviso por correo (D2) | Operativo y probado (correo con buzón local simulado) |
| Creación institucional de cuentas (D3) y cuentas Estudiante vinculadas (D7) | Operativo y probado |
| Cambio de correo con verificación (D1, migración 016) | Operativo y probado en esquemas desechables. En `piar_test` y producción falta aplicar la 016 |
| Administración de cuentas (editar, desactivar, reactivar) | Operativo y probado |
| Interfaz con CSP sin scripts en línea | Probado en Chrome sin interfaz (demo visual). Sin revisión con datos reales guardados |
| Imagen de producción y migración remota | Probadas en local con Docker y TLS. Railway no está probado |
| Traslado de la Administradora 178 (D6) | Ensayado y verificado en dos esquemas desechables |
| Envío real de correo (Gmail SMTP) | **Bloqueado**: falta la contraseña de aplicación y la prueba autorizada. Además, Railway bloquea el SMTP saliente en los planes Free, Trial y Hobby (`docs/DESPLIEGUE_RAILWAY.md` §0) |
| Google, Microsoft y Apple | Implementados con simulaciones y **ocultos**; sin credenciales |

## 2. Trabajo de esta fase

**Seguridad:**
- `check:secrets` revisa también los archivos no versionados y detecta hashes de contraseña y exportaciones.
- `.claude/` está excluida de Git.
- CSP sin `'unsafe-inline'` en `script-src`: 92 manejadores en línea sustituidos por delegación con lista permitida.

**Producción:**
- `backend/production-config.js` valida la configuración al arrancar.
- `HOST=0.0.0.0` en producción y cierre ordenado con `SIGTERM`.
- TLS opcional para MySQL (`DB_SSL`).
- Ejecutor de migraciones `--remote` con confirmación y bloqueo.
- `Dockerfile`, `.dockerignore`, `railway.json`.
- `scripts/admin-transfer.js`: exportación, comprobación, importación, verificación y reversión de la fila de la Administradora, sin imprimir el hash.

**Funcionalidad:**
- Cuentas Estudiante (D7).
- Aviso por correo de la decisión sobre una solicitud.
- Edición parcial del PIAR y de docentes: ya se puede vaciar un campo opcional.

**Pruebas:**
- 16 pruebas unitarias nuevas.
- La e2e cubre registro, aprobación, rechazo, cambio de correo, cuenta Estudiante y vaciado de campos.
- La integración admite el perfil `ensayo`, que trabaja sobre una copia y nunca escribe en `piar_test`.

**Dependencias:** `nodemailer` 10.6.1 y `openid-client` 6.9.1 (0 vulnerabilidades).

**Documentación:**
- Reescritos: README, manual técnico, manual de usuario, guía de Railway y matriz de pruebas.
- Nuevos: guía de MySQL y migraciones, este documento e índice `docs/README.md`.
- Las versiones anteriores están en `docs/historico/`.

Resultados de las pruebas: `docs/MATRIZ_PRUEBAS_PIAR.md`.

## 3. Pendientes reales

1. **Correo:** Railway bloquea el SMTP en los planes Free, Trial y Hobby. Hay que decidir entre el plan Pro (Gmail SMTP) y un proveedor por HTTPS, y después hacer una prueba autorizada (`docs/DESPLIEGUE_RAILWAY.md` §0 y §7).
2. **Railway:** crear `piar_produccion` y sus cuentas, migrar, verificar con `npm run db:verificar`, trasladar la cuenta 178, configurar variables y desplegar (`docs/DESPLIEGUE_RAILWAY.md` §5).
3. **`TRUSTED_PROXIES`:** verificar el rango del proxy de Railway después del primer despliegue.
4. **Repositorio:**
   - rotar la credencial antigua que sigue en el historial de `origin/main` y decidir la limpieza del historial (`docs/PROCEDIMIENTOS_PENDIENTES.md` §B);
   - `push` de los siete commits locales, con autorización;
   - el correo real de la Administradora ya no está en los archivos versionados: el *bootstrap* lo toma de `PIAR_BOOTSTRAP_ADMIN_EMAIL` y la cuenta 178 no cambió.
5. **`piar_test`:**
   - aplicar la 016 (ensayada en la copia);
   - corregir los caracteres dañados del PIAR de prueba («Validaci?n»);
   - reiniciar el backend de 8090 para que ejecute el código actual.
6. **Deuda técnica:**
   - dividir `backend/server.js` (unas 2100 líneas);
   - paginar la carga inicial (hoy hace una petición `GET /api/piar/:id` por cada PIAR);
   - la edición de ajustes por API aún no permite vaciar campos de trazabilidad (la interfaz no edita ajustes).
7. **Equipo local:** el MySQL80 nativo escucha en todas las interfaces (3306 y 33060), con reglas de firewall abiertas y la red en perfil Público. El procedimiento reversible está en `docs/PROCEDIMIENTOS_PENDIENTES.md` §C. Los respaldos deben protegerse (§D).
8. **Decisión institucional:** confirmar D7 (quién crea las cuentas Estudiante y cómo se custodia la autorización del acudiente).

## 4. Elementos de ensayo que quedaron en este equipo

No se borraron, por instrucción expresa. Se eliminan solo con autorización. **El inventario vigente y completo es `docs/PROCEDIMIENTOS_PENDIENTES.md` §I**: 5 esquemas, 3 cuentas bloqueadas, 10 contenedores y 2 imágenes. La tabla siguiente es la versión anterior.

| Elemento | Situación |
|---|---|
| Esquemas `piar_test_ensayo_mig`, `piar_test_ensayo_e2e`, `piar_test_ensayo_copia`, `piar_produccion_ensayo` (en `piar-mysql-test`) | Desechables. `piar_test_ensayo_copia` y los dos que recibieron el traslado (`piar_test_ensayo_mig` y `piar_produccion_ensayo`) contienen la fila de la Administradora; la copia contiene además los datos de `piar_test` |
| Cuentas MySQL `piar_ensayo_mig`, `piar_ensayo_app`, `piar_ensayo_int` | Bloqueadas (`ACCOUNT LOCK`) |
| Imagen `piar-sistema:ensayo-produccion` y contenedores detenidos `piar-ensayo-*` | Del ensayo de producción |
| Paquete `Desktop/PIAR-SISTEMA-respaldos/transferencia-admin/admin-row-178-20261122T170030Z.json` (+ `.sha256`) | Contiene el hash de la contraseña; sirve para el traslado real |
| Respaldo `Desktop/PIAR-SISTEMA-respaldos/respaldo-pre-mision-final-20261122_163511Z.tar.gz` (+ `.sha256`) | Árbol de trabajo antes de esta fase |

Comandos de limpieza, para ejecutar solo con autorización:
- `DROP DATABASE <esquema>;`
- `DROP USER '<cuenta>'@'%';`
- `docker rm piar-ensayo-<nombre>`
- `docker rmi piar-sistema:ensayo-produccion`

## 5. Autorizaciones necesarias

1. Operaciones en Railway: crear la base y sus cuentas, migrar, trasladar la cuenta 178, configurar variables y desplegar.
2. `push` y fusión de los siete commits locales.
3. Rotación de la credencial antigua y, si se decide, la reescritura del historial.
4. Prueba real de envío de correo.
5. Aplicar la 016 en `piar_test` y reiniciar el backend de 8090.
6. Eliminar los elementos de ensayo de §4.
