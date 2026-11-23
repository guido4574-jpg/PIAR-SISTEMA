# 18. Plan de pruebas y resultados

<!-- sub: Pruebas ejecutadas, con resultados reales y sus limitaciones -->

## 18.1 Estrategia de pruebas

Tabla: Niveles de prueba

| Nivel | Comando | Qué cubre | Necesita |
|---|---|---|---|
| Unitarias | `npm test` | 44 archivos: autenticación, sesiones, registro y aprobación, autorización por rol, portal del Estudiante, PIAR y trazabilidad, DUA, reportes, correo y OIDC simulados, límites, seguridad HTTP, CSP, migraciones, configuración de producción, traslado de la Administradora, delegación de eventos e interfaz por rol | Nada (sin MySQL) |
| Integración | `npm run test:integration:local` o perfil `ensayo` | HTTP y SQL reales: permisos, alcance docente, PIAR, trazabilidad, registros, historial, reportes, registro y aprobación | MySQL local en el puerto 3307 y una cuenta solo DML; el perfil `ensayo` usa una copia desechable |
| Extremo a extremo (e2e) | `npm run test:e2e` | Flujos completos por rol con MySQL real y reinicio del backend | Esquema desechable vacío y migrado |
| Seguridad del repositorio | `npm run check:secrets` | Secretos, hashes, volcados y archivos de entorno | Nada |
| Dependencias | `npm audit --omit=dev` | Vulnerabilidades conocidas | Conexión a Internet |
| Interfaz | Chrome sin interfaz (protocolo DevTools) | Navegación por rol, CSP, errores de JavaScript, diseño a 1440 y 390 px | Demo visual o backend local |
| Producción | Comprobaciones HTTP y verificador de solo lectura | Cabeceras, códigos de estado, esquema y cuentas de la base | Acceso autorizado |

## 18.2 Casos de prueba representativos

Tabla: Casos de prueba

| ID | Caso | Entrada | Resultado esperado | Resultado obtenido | Estado |
|---|---|---|---|---|---|
| CP-01 | Inicio de sesión con credenciales inválidas | Correo inexistente | 401 con mensaje genérico; botón restablecido | 401 en 451 ms en producción; 0 errores de JavaScript | Aprobado [PRODUCCIÓN] |
| CP-02 | Escritura desde otro origen | `POST` con `Origin` ajeno | 403 | 403 | Aprobado [PRODUCCIÓN] |
| CP-03 | Ruta protegida sin sesión | `GET /api/piar` sin cookie | 401 | 401 | Aprobado [PRODUCCIÓN] |
| CP-04 | Ruta retirada | `GET /api/data` | 410 | 410 | Aprobado [PRODUCCIÓN] |
| CP-05 | Docente fuera de su alcance | Docente consulta un PIAR no asignado | 403 o 404 | Rechazado | Aprobado [PROBADO LOCAL] |
| CP-06 | Escritura en PIAR cerrado | Registrar un ajuste en un PIAR cerrado | 409 | 409 | Aprobado [PROBADO LOCAL] |
| CP-07 | Reapertura sin justificación | `POST /reapertura` sin texto | 400 | 400 | Aprobado [PROBADO LOCAL] |
| CP-08 | Ajuste con barrera de otro PIAR | `id_barrera` ajeno | Rechazo | Rechazado por validación y clave foránea compuesta | Aprobado [PROBADO LOCAL] |
| CP-09 | Estudiante consulta un PIAR ajeno | ID de otro estudiante | 404, igual que uno inexistente | 404 | Aprobado [PROBADO LOCAL] |
| CP-10 | Cuenta Estudiante sin autorización del acudiente | `autorizacion_acudiente` ausente | Rechazo sin cambios | Rechazado | Aprobado [PROBADO LOCAL] |
| CP-11 | Rechazo de solicitud | Rechazo con motivo | Estado `rechazado`; el aviso no incluye el motivo | Correcto | Aprobado [PROBADO LOCAL] |
| CP-12 | Cambio de correo | Nuevo correo sin confirmar | El correo anterior sigue vigente; al confirmar se revocan las sesiones | Correcto | Aprobado [PROBADO LOCAL] |
| CP-13 | Migraciones desde cero | Esquema vacío | 16 aplicadas; la repetición no encuentra pendientes | Correcto | Aprobado [PROBADO LOCAL] |
| CP-14 | Arranque con configuración insegura | Imagen Docker sin variables | El servidor se niega a arrancar | Correcto | Aprobado [PROBADO LOCAL] |
| CP-15 | Formulario de acceso con delegación de eventos | Envío del formulario | `currentTarget` es el formulario y se envía la petición | Correcto (regresión del commit `6158d9a`) | Aprobado [PROBADO LOCAL] [PRODUCCIÓN] |

## 18.3 Resultados de la última ejecución

Tabla: Resultados registrados

| Prueba | Fecha | Resultado |
|---|---|---|
| `npm test` (commit `6158d9a`, Node.js 22.20.0) | 22 nov 2026, 23:08 UTC | **352 de 352 aprobadas**, 0 fallidas, 52,9 s |
| Integración, perfil `ensayo` (copia con migraciones 000–016) | 22 nov 2026 | **12 aprobadas, 0 fallidas, 1 omitida por diseño** (el flujo Estudiante se cubre en la e2e) |
| e2e (`piar_test_ensayo_e2e`) | 22 nov 2026 | **1 de 1 aprobada**, con registro, aprobación, rechazo, cambio de correo, cuenta Estudiante y vaciado de campos |
| Migraciones 000–016 desde cero | 22 nov 2026 | 16 aplicadas; segunda ejecución sin pendientes; reaplicadas una por una sin errores |
| `npm audit --omit=dev` | 22 nov 2026 | 0 vulnerabilidades |
| `npm run check:secrets` | 22 nov 2026 | Sin hallazgos |
| Clon limpio en Windows con `npm ci` (commit `a67b0ee`) | 22 nov 2026 | 337 de 337 aprobadas |
| Interfaz en Chrome (CSP sin `'unsafe-inline'`) | 22 nov 2026 | 8 secciones del Administrador, 6 del Docente y solo «Mi PIAR» para el Estudiante; 0 excepciones y 0 violaciones de CSP |

> **Nota:** una ejecución anterior de `npm test` el mismo día terminó con 3 fallos (332 pruebas) por falta de memoria en el equipo (unos 450 MB libres). Los tres archivos afectados pasaron al ejecutarlos por separado (12/12, 13/13 y 8/8) y la repetición completa dio 352 de 352. Se registra para no ocultar el incidente.

## 18.4 Verificaciones en producción

Tabla: Comprobaciones realizadas sobre Railway

| Comprobación | Resultado |
|---|---|
| Despliegue `95d15fdd` con el commit `6158d9a` | SUCCESS |
| `GET /api/health` | 200, con HSTS y CSP en las cabeceras |
| Rutas protegidas sin sesión | 401 |
| `/api/data` | 410 |
| Buzón de correo de desarrollo | 404 |
| Escritura desde otro origen | 403 |
| Formulario de acceso con un correo inexistente | `POST /api/auth/login`, 401 en 451 ms, botón restablecido, 0 errores de JavaScript |
| Base `piar_produccion` (verificador de solo lectura) | 28 tablas, 16 de 16 migraciones, una sola cuenta (la Administradora 178) con huella idéntica al origen, TLS activo, `piar_app` solo DML y `piar_migrador` bloqueada |

## 18.5 No probado

> **Pendiente:** estas pruebas no se han realizado y no deben darse por superadas.

- Creación y edición reales de estudiantes y PIAR en producción.
- Primer acceso de la Administradora 178 en producción (requiere que la titular escriba su contraseña).
- Entrega real de correo (falta la clave de Resend y un dominio verificado).
- Inicio de sesión con Google, Microsoft o Apple con credenciales reales.
- Pruebas de carga y de concurrencia.
- Auditoría de accesibilidad con lector de pantalla.

## 18.6 Buenas prácticas de calidad aplicadas

- Prueba de regresión para cada error corregido (por ejemplo, las dos pruebas de `tests/produccion-d7.test.js` del inicio de sesión).
- Bases de datos de ensayo desechables: las pruebas nunca escriben en la base de pruebas principal ni en producción.
- Ejecución secuencial (`--test-concurrency=1`) para que los resultados sean estables en un equipo con poca memoria.
- Detector de secretos antes de cada commit y auditoría de dependencias.
