# Matriz e informe de pruebas — PIAR-SISTEMA

Actualizado: 2026-11-22, rama `security/fase-1-hardening`, código sin commit. La versión anterior está en `docs/historico/MATRIZ_PRUEBAS_PIAR_hasta_2026-11-22.md`.

## 1. Suites

| Comando | Cubre | Necesita |
|---|---|---|
| `npm test` | 42 archivos unitarios: autenticación, sesiones, registro y aprobación, autorización por rol, portal del Estudiante, PIAR y trazabilidad, DUA, reportes, correo simulado, OIDC simulado, límites, seguridad HTTP, CSP, migraciones (estático), configuración de producción, traslado de la Administradora, delegación de eventos e interfaz por rol | Nada (sin MySQL) |
| `npm run test:integration:local` (perfil `local`) o `node scripts/run-local-integration-test.js ensayo` | HTTP y SQL reales: permisos, alcance docente, PIAR, trazabilidad, diagnósticos, observaciones, seguimientos, historial, reportes, registro y aprobación, validación | MySQL 3307 y una cuenta solo DML. El perfil `ensayo` usa una copia `piar_test_ensayo_*` y nunca escribe en `piar_test` |
| `npm run test:e2e` | Flujos completos por rol con MySQL real y reinicio del backend (detalle en §3) | Esquema desechable vacío y migrado (`PIAR_E2E_DB_*`) |
| `npm run check:secrets` | Secretos, hashes de contraseña, volcados y archivos de entorno en archivos versionados **y** pendientes de agregar | Nada |

## 2. Resultados reales del 2026-11-22

| Prueba | Resultado |
|---|---|
| `npm test` | **332 de 332 aprobadas**, 0 fallidas, 0 omitidas. Incluye 16 pruebas nuevas en `tests/produccion-d7.test.js` |
| `node --check` | 110 archivos JavaScript, 0 errores |
| `npm run check:secrets` | Sin hallazgos en 218 archivos |
| `npm audit --omit=dev` | 0 vulnerabilidades (`nodemailer` 10.6.1, `openid-client` 6.9.1) |
| Migraciones 000–016 desde cero (`piar_test_ensayo_mig` y `piar_test_ensayo_e2e`) | 16 aplicadas en cada esquema; la segunda ejecución no encontró pendientes; las 16 reaplicadas una por una sin errores |
| Comparación de esquema con `piar_test` (columnas, índices, claves foráneas y reglas `ON DELETE/UPDATE`) | Idéntico, salvo dos diferencias esperadas. La primera es `cambio_correo`, que crea la 016. La segunda es la colación de `verificacion_correo.token_hash`, que en `piar_test` es `utf8mb4_0900_ai_ci` por su historia y en una base nueva es `utf8mb4_unicode_ci` |
| 016 sobre una copia de `piar_test` (`piar_test_ensayo_copia`) | Aplicada. Las 26 tablas previas quedaron idénticas según `CHECKSUM TABLE … EXTENDED` |
| Integración (perfil `ensayo`, sobre la copia con 000–016) | **12 aprobadas, 0 fallidas, 1 omitida por diseño**: el flujo Estudiante, cubierto en la e2e. La limpieza eliminó todos los datos sintéticos. Quedaron 6 filas anónimas sin atribución posible (4 en `evento_seguridad` y 2 de tipo 401 en `piar_auditoria`), que se conservan por diseño |
| e2e (`piar_test_ensayo_e2e`, con 000–016) | **Aprobada** (1 de 1), incluidos los flujos nuevos de §3 |
| Traslado de la Administradora 178 (`piar_test` → `piar_test_ensayo_mig` y `piar_produccion_ensayo`) | Huella SHA-256 idéntica en origen y destinos. Se rechazaron una importación sin confirmación y una importación duplicada. La reversión borró solo esa fila y la cuenta se importó de nuevo. En el destino quedaron 0 filas de otras tablas |
| Imagen Docker de producción | Construida. Con una configuración insegura se negó a arrancar. Con una configuración válida: proceso como `node`, escucha en `0.0.0.0`, health 200, HSTS, 401 en una cuenta inexistente, 403 a otro origen, 404 en el buzón de desarrollo y salida 0 con `SIGTERM` |
| Migración remota desde el contenedor (TLS, `--remote`) | Sin confirmación: rechazada. Con TLS: 16 aplicadas; la repetición no encontró pendientes; 28 tablas |
| Chrome sin interfaz sobre la demo visual (CSP sin `'unsafe-inline'`) | Acceso, registro con 4 perfiles, mostrar contraseña y recuperación: correctos. Las 8 secciones del Administrador navegan; «Nueva cuenta» muestra el bloque Estudiante y lo rellena; el detalle y la edición del PIAR abren. Docente: 6 secciones. Estudiante: solo «Mi PIAR». 0 excepciones, 0 violaciones de CSP, 0 peticiones distintas de GET. Único error: el 401 esperado de `/api/auth/me` antes del acceso |
| `piar_test` | Idéntica a su huella inicial (27 tablas, `CHECKSUM TABLE … EXTENDED`) al terminar todas las pruebas |

### 2.1 Segunda revisión (2026-11-22, tarde)

| Prueba | Resultado |
|---|---|
| `npm test` | **337 de 337 aprobadas**, incluidas 5 nuevas en `tests/cierre-produccion.test.js` |
| `node --check` | 113 archivos, 0 errores |
| `npm audit --omit=dev` | 0 vulnerabilidades |
| `npm run check:secrets` | **Falla a propósito:** la regla nueva «correo personal» detecta el correo real de la Administradora en 4 archivos (decisión pendiente, `docs/PROCEDIMIENTOS_PENDIENTES.md` §J) |
| Historial de Git (16 commits, todas las referencias) | 4 rutas con datos sensibles confirmadas y 1 falso positivo corregido |
| Credencial expuesta frente a `piar_test` | No coincide con ninguna cuenta (solo lectura; resultados verdadero/falso) |
| Respaldos (`.sha256`) | 15 de 15 correctos |
| Respaldo nuevo de `piar_test` antes de la 016 | Restaurado en `piar_test_ensayo_verif`: 27 de 27 tablas idénticas |
| `npm run db:verificar` | `piar_produccion_ensayo` por TLS: 28 tablas, 16/16, huella de la Administradora correcta. `piar_test`: detecta la 016 pendiente y la falta de `cambio_correo` |
| Imagen `piar-sistema:ensayo-produccion-2` | Verificador y probador de correo funcionan dentro del contenedor. Sin variables, el servidor se niega a arrancar |

### 2.2 Validación de cierre de la entrega (2026-11-22)

Solo se repitió lo que cambió después de la segunda revisión: la retirada del correo real y el detector.

| Prueba | Resultado |
|---|---|
| `npm test` | **337 de 337 aprobadas** (38 s), ejecutado justo antes de los commits |
| `npm run check:secrets` | Sin hallazgos en 230 archivos (el correo real de la Administradora ya no está en archivos versionables) |
| Backend final (puerto 8096, contra `piar_test`, sin purga) + interfaz real en Chrome, a 1440 y 390 px | Acceso, registro (4 perfiles), mostrar contraseña y recuperación funcionan con la delegación de eventos y la CSP sin `'unsafe-inline'`. 0 excepciones, 0 desbordamientos, 0 textos «undefined/null/NaN», 0 peticiones distintas de GET (solo `/api/config` y `/api/auth/me`). Únicos errores: el 401 esperado de `/api/auth/me` |
| Huella de `piar_test` antes y después de esa revisión | Idéntica (27 tablas, `CHECKSUM TABLE … EXTENDED`) |
| Contenido commiteado, extraído en una copia limpia | Primer intento: 335 de 337. En Windows, `core.autocrlf` convertía los archivos a CRLF y 2 pruebas que comparan texto exacto fallaban. Corregido con `* text=auto eol=lf` en `.gitattributes`. Resultado: **337 de 337** |

### 2.3 Transporte Resend (2026-11-22)

| Prueba | Resultado |
|---|---|
| `npm test` | **348 de 348 aprobadas** (337 anteriores, incluidas las de correo, registro, verificación, recuperación y notificaciones, más 11 nuevas en `tests/email-resend.test.js`) |
| `tests/email-resend.test.js`, contra un servidor local que imita la API de Resend | La petición es `POST /emails` con `Bearer`, `User-Agent` y JSON `{from, to, subject, text}`; el remitente admite nombre visible. Las respuestas 401, 403, 429 (con `retry-after` y cuota diaria), 500 y 502 no JSON, y una respuesta sin `id`, se rechazan con un diagnóstico sin la clave ni el destinatario. El tiempo de espera (200 ms) y la conexión rechazada se detectan. Sin clave, con una clave mal formada o con un remitente inválido, o con inyección CRLF en el destinatario, no se hace ninguna petición. En producción solo se admite la API oficial por HTTPS. La validación de producción admite `resend` y advierte del remitente `resend.dev`. La verificación del dominio informa `verified`, `pending`, `no_registrado` y `restricted_api_key`. Registro, recuperación y aviso de decisión llegan por Resend; con Resend caído, la respuesta pública no cambia y el enlace no entregado se invalida |
| `npm run check:secrets` | Sin hallazgos en 231 archivos. Nueva regla para claves `re_…` y `RESEND_API_KEY` con valor |
| Envío real | **No realizado** (requiere cuenta, clave, dominio y autorización) |

## 3. Cobertura funcional con MySQL real

| Funcionalidad | Integración | e2e |
|---|---|---|
| Inicio y cierre de sesión, sesión de 8 h, persistencia tras reiniciar | ✔ | ✔ |
| Anti-bloqueo tras proxy, límites en MySQL, eventos de seguridad | — | ✔ |
| Permisos de los 6 roles y alcance del Docente por asignación | ✔ | ✔ |
| Estudiantes y docentes (crear, editar, consultar) | ✔ | ✔ |
| PIAR: crear, editar con versión, cerrar, reabrir y asignar docentes | ✔ | ✔ |
| Vaciar un campo opcional del PIAR; rechazar el vaciado del título o una fecha no válida | — | ✔ |
| Barreras, ajustes, evidencias, DUA, diagnósticos, observaciones, seguimientos; PIAR cerrado en solo lectura | ✔ | ✔ |
| Historial, versiones, reportes persistentes, dashboard | ✔ | ✔ |
| Registro público (D2): verificación, pendiente sin acceso, aprobación con aviso por correo, rechazo con motivo (el aviso no lo expone) | ✔ (aprobación) | ✔ |
| Cambio de correo (D1, 016): el correo anterior sigue vigente hasta confirmar; al confirmar se revocan las sesiones | — | ✔ |
| Cuenta Estudiante (D7) | — | ✔ |
| Administración de cuentas (desactivar, reactivar, duplicados) | ✔ | ✔ |

Detalle de la cuenta Estudiante (D7) en la e2e:
- Solo el Administrador la crea, y exige la autorización del acudiente.
- Hay una única cuenta por estudiante.
- Después de verificar el correo, debe cambiar la contraseña temporal.
- Solo ve su PIAR: un PIAR ajeno responde 404, igual que uno inexistente.
- Las rutas profesionales responden 403 y la respuesta no contiene información profesional.

## 4. No probado (limitaciones reales)

- Entrega real de correo con Gmail SMTP: falta la contraseña de aplicación y la prueba autorizada. Además, Railway bloquea el SMTP en los planes Free, Trial y Hobby.
- Despliegue real en Railway, TLS contra su proxy público y el rango de su proxy para `TRUSTED_PROXIES`.
- Inicio de sesión con la cuenta Administradora 178 en un destino trasladado: requiere que la titular escriba su contraseña. Se comprobó la igualdad exacta de la fila, incluido el hash.
- Proveedores externos (Google, Microsoft y Apple): solo simulaciones; están ocultos en la interfaz.
- Revisión visual con datos reales guardados (el backend en 8090 sigue ejecutando el código previo a esta fase).
