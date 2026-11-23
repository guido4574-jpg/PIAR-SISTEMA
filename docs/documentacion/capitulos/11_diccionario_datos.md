# 11. Diccionario de datos

<!-- sub: Estructura real de las 28 tablas, generada desde el esquema migrado -->

> Generado automáticamente por `docs/documentacion/herramientas/generar-modelo-datos.js` a partir de la **estructura** (no de los datos) de un esquema MySQL creado con las migraciones 000–016, idéntico en estructura a `piar_produccion`. Fecha de generación: 2026-11-22.

**Resumen:** 28 tablas, 278 columnas, 47 relaciones de clave foránea (todas con `ON DELETE NO ACTION`) y 105 índices. Motor InnoDB y juego de caracteres `utf8mb4`.

Las columnas marcadas con 🔒 guardan valores derivados de secretos (hashes o tokens). Nunca se muestran en la interfaz, en los registros ni en esta documentación.

## 11.1 Inventario de tablas

Tabla: Inventario de las 28 tablas del esquema

| Tabla | Grupo | Propósito | Columnas |
|---|---|---|---|
| `admin_account_audit` | Cuentas y seguridad | Auditoría de operaciones administrativas sobre cuentas: creación, aprobación, rechazo, desactivación, reactivación y cambio de correo (migración 009). | 9 |
| `cambio_correo` | Cuentas y seguridad | Solicitudes de cambio de correo pendientes de confirmar; guarda solo el hash del token, con vencimiento de 24 h (migración 016, decisión D1). | 8 |
| `coordinador` | Pedagógico | Perfil de coordinación referenciado por los seguimientos (id_coordinador). No se vincula con usuario. | 7 |
| `diagnostico` | Pedagógico | Diagnósticos asociados a un estudiante y, opcionalmente, a un PIAR; registra el autor (id_usuario_creador). | 10 |
| `docente` | Pedagógico | Perfil docente; se vincula con la cuenta mediante id_usuario y con los PIAR mediante piar_docente. | 14 |
| `estudiante` | Pedagógico | Registro del estudiante: identificación, caracterización, contexto y, desde la migración 015, la cuenta de acceso vinculada (id_usuario, única). | 22 |
| `evento_seguridad` | Cuentas y seguridad | Eventos de autenticación y seguridad con el correo en hash y la red de origen truncada (migración 012). | 8 |
| `external_identity` | Cuentas y seguridad | Identidades de proveedores externos (Google, Microsoft, Apple) vinculadas a una cuenta; único por issuer y subject (migración 003). | 7 |
| `historial` | Pedagógico | Cabecera de cada versión o evento del historial de un PIAR. | 8 |
| `historial_detalle` | Pedagógico | Detalle de cada cambio versionado: valores anterior y nuevo en JSON, tipo de registro y autor. | 9 |
| `limite_solicitudes` | Cuentas y seguridad | Contadores de límites de intentos compartidos entre instancias cuando RATE_LIMIT_STORE=mysql; la clave es un hash. | 3 |
| `observacion` | Pedagógico | Observaciones pedagógicas del estudiante o del PIAR; inmutables una vez registradas. | 14 |
| `oidc_login_transaction` | Cuentas y seguridad | Transacciones de un solo uso del inicio de sesión externo: state, nonce y verificador PKCE. | 8 |
| `piar` | Pedagógico | Plan Individual de Ajustes Razonables: componentes pedagógicos del Decreto 1421 de 2017, estado y fechas de revisión y cierre. | 24 |
| `piar_ajuste` | Pedagógico | Ajustes razonables del PIAR, con trazabilidad a la barrera (clave compuesta id_piar, id_barrera), responsable, indicador y avance (0–100). | 16 |
| `piar_ajuste_evidencia` | Pedagógico | Evidencias descriptivas de la aplicación de un ajuste (no almacena archivos). | 7 |
| `piar_auditoria` | Cuentas y seguridad | Auditoría de acceso a recursos pedagógicos: actor, acción, recurso, resultado y código HTTP, sin contenido (migración 007). | 8 |
| `piar_barrera` | Pedagógico | Barreras para el aprendizaje y la participación identificadas por contexto (migración 008). | 9 |
| `piar_docente` | Pedagógico | Relación N:M entre PIAR y docentes; indica el responsable principal y define el alcance del rol Docente. | 4 |
| `piar_dua` | Pedagógico | Estrategias del Diseño Universal para el Aprendizaje por principio: representación, acción y expresión, implicación (migración 013). | 9 |
| `psicologa` | Pedagógico | Perfil de psicología referenciado por los diagnósticos (id_psicologa). No se usa para autorizar. | 7 |
| `recuperacion_contrasena` | Cuentas y seguridad | Tokens de recuperación de contraseña (hash, un solo uso, 30 minutos). | 6 |
| `reporte` | Pedagógico | Informes persistentes de un PIAR: instantánea del contenido construida por el servidor, con su hash, autor y fecha (migración 014). | 14 |
| `schema_migrations` | Control | Registro de migraciones aplicadas con su checksum SHA-256. | 4 |
| `seguimiento` | Pedagógico | Seguimientos del PIAR, opcionalmente enlazados a un ajuste; inmutables una vez registrados. | 14 |
| `sesion_usuario` | Cuentas y seguridad | Sesiones activas: hash del token, vencimiento (8 h) y revocación. | 6 |
| `usuario` | Cuentas y seguridad | Cuentas de acceso: rol, estado, hash de la contraseña (bcrypt), verificación del correo, contraseña temporal y decisión de aprobación. | 17 |
| `verificacion_correo` | Cuentas y seguridad | Tokens de verificación del correo (hash, un solo uso, 24 h). | 6 |

## 11.2 `admin_account_audit`

Auditoría de operaciones administrativas sobre cuentas: creación, aprobación, rechazo, desactivación, reactivación y cambio de correo (migración 009).

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_evento` | `bigint` | No | — | PK | auto_increment |
| 2 | `target_user_id` | `int` | Sí | — | IDX | FK → `usuario.id_usuario` |
| 3 | `operation` | `varchar(32)` | No | — | IDX |  |
| 4 | `outcome` | `varchar(24)` | No | — |  |  |
| 5 | `operator_identity_claim` | `varchar(150)` | Sí | — |  |  |
| 6 | `operator_identity_source` | `varchar(32)` | No | — |  |  |
| 7 | `authorization_reference` | `varchar(128)` | Sí | — |  |  |
| 8 | `reason` | `varchar(500)` | Sí | — |  |  |
| 9 | `occurred_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |

**Índices:** `idx_admin_account_audit_operation_time` (no único: operation,occurred_at) · `idx_admin_account_audit_target_time` (no único: target_user_id,occurred_at) · `PRIMARY` (único: id_evento)

## 11.3 `cambio_correo`

Solicitudes de cambio de correo pendientes de confirmar; guarda solo el hash del token, con vencimiento de 24 h (migración 016, decisión D1).

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_cambio` | `bigint` | No | — | PK | auto_increment |
| 2 | `id_usuario` | `int` | No | — | IDX | FK → `usuario.id_usuario` |
| 3 | `correo_nuevo` | `varchar(150)` | No | — |  |  |
| 4 | `token_hash` | `char(64)` | No | — | UQ | 🔒 valor derivado de un secreto |
| 5 | `solicitado_por` | `int` | No | — | IDX | FK → `usuario.id_usuario` |
| 6 | `expires_at` | `datetime` | No | — | IDX |  |
| 7 | `consumed_at` | `datetime` | Sí | — |  |  |
| 8 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |

**Índices:** `fk_cambio_correo_solicitante` (no único: solicitado_por) · `idx_cambio_correo_expira` (no único: expires_at) · `idx_cambio_correo_usuario` (no único: id_usuario,consumed_at) · `PRIMARY` (único: id_cambio) · `uq_cambio_correo_token_hash` (único: token_hash)

## 11.4 `coordinador`

Perfil de coordinación referenciado por los seguimientos (id_coordinador). No se vincula con usuario.

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_coordinador` | `int` | No | — | PK | auto_increment |
| 2 | `nombre` | `varchar(150)` | No | — |  |  |
| 3 | `correo` | `varchar(150)` | Sí | — |  |  |
| 4 | `documento` | `varchar(30)` | Sí | — |  |  |
| 5 | `estado` | `varchar(20)` | No | `activo` |  |  |
| 6 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |
| 7 | `updated_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  | on update CURRENT_TIMESTAMP |

**Índices:** `PRIMARY` (único: id_coordinador)

## 11.5 `diagnostico`

Diagnósticos asociados a un estudiante y, opcionalmente, a un PIAR; registra el autor (id_usuario_creador).

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_diagnostico` | `int` | No | — | PK | auto_increment |
| 2 | `tipo_diagnostico` | `varchar(100)` | No | — |  |  |
| 3 | `fecha` | `date` | Sí | — |  |  |
| 4 | `descripcion` | `text` | Sí | — |  |  |
| 5 | `id_estudiante` | `int` | Sí | — | IDX | FK → `estudiante.id_estudiante` |
| 6 | `id_psicologa` | `int` | Sí | — | IDX | FK → `psicologa.id_psicologa` |
| 7 | `id_piar` | `int` | Sí | — | IDX | FK → `piar.id_piar` |
| 8 | `id_usuario_creador` | `int` | Sí | — | IDX | FK → `usuario.id_usuario` |
| 9 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |
| 10 | `updated_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  | on update CURRENT_TIMESTAMP |

**Índices:** `idx_diagnostico_estudiante` (no único: id_estudiante) · `idx_diagnostico_piar` (no único: id_piar) · `idx_diagnostico_psicologa` (no único: id_psicologa) · `idx_diagnostico_usuario` (no único: id_usuario_creador) · `PRIMARY` (único: id_diagnostico)

## 11.6 `docente`

Perfil docente; se vincula con la cuenta mediante id_usuario y con los PIAR mediante piar_docente.

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_docente` | `int` | No | — | PK | auto_increment |
| 2 | `nombre` | `varchar(150)` | No | — |  |  |
| 3 | `area` | `varchar(100)` | Sí | — |  |  |
| 4 | `correo` | `varchar(150)` | Sí | — |  |  |
| 5 | `nombres` | `varchar(100)` | Sí | — |  |  |
| 6 | `apellidos` | `varchar(100)` | Sí | — |  |  |
| 7 | `documento` | `varchar(30)` | Sí | — |  |  |
| 8 | `cargo` | `varchar(100)` | Sí | — |  |  |
| 9 | `telefono` | `varchar(30)` | Sí | — |  |  |
| 10 | `perfil` | `text` | Sí | — |  |  |
| 11 | `estado` | `varchar(20)` | No | `activo` | IDX |  |
| 12 | `id_usuario` | `int` | Sí | — | IDX | FK → `usuario.id_usuario` |
| 13 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |
| 14 | `updated_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  | on update CURRENT_TIMESTAMP |

**Índices:** `idx_docente_estado` (no único: estado) · `idx_docente_usuario` (no único: id_usuario) · `PRIMARY` (único: id_docente)

## 11.7 `estudiante`

Registro del estudiante: identificación, caracterización, contexto y, desde la migración 015, la cuenta de acceso vinculada (id_usuario, única).

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_estudiante` | `int` | No | — | PK | auto_increment |
| 2 | `id_usuario` | `int` | Sí | — | UQ | FK → `usuario.id_usuario` |
| 3 | `nombre` | `varchar(200)` | No | — |  |  |
| 4 | `documento` | `varchar(30)` | No | — | UQ |  |
| 5 | `edad` | `int` | Sí | — |  |  |
| 6 | `curso` | `varchar(50)` | Sí | — | IDX |  |
| 7 | `condicion_especial` | `varchar(150)` | Sí | — | IDX |  |
| 8 | `nombres` | `varchar(100)` | Sí | — |  |  |
| 9 | `apellidos` | `varchar(100)` | Sí | — |  |  |
| 10 | `fecha_nacimiento` | `date` | Sí | — |  |  |
| 11 | `jornada` | `varchar(30)` | Sí | — |  |  |
| 12 | `estado` | `varchar(20)` | No | `activo` | IDX |  |
| 13 | `acudiente` | `varchar(150)` | Sí | — |  |  |
| 14 | `telefono` | `varchar(30)` | Sí | — |  |  |
| 15 | `contexto` | `text` | Sí | — |  |  |
| 16 | `valoracion` | `text` | Sí | — |  |  |
| 17 | `fortalezas` | `json` | Sí | — |  |  |
| 18 | `barreras` | `json` | Sí | — |  |  |
| 19 | `apoyos_requeridos` | `json` | Sí | — |  |  |
| 20 | `actividades_casa` | `text` | Sí | — |  |  |
| 21 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |
| 22 | `updated_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  | on update CURRENT_TIMESTAMP |

**Índices:** `idx_estudiante_condicion` (no único: condicion_especial) · `idx_estudiante_curso` (no único: curso) · `idx_estudiante_estado` (no único: estado) · `PRIMARY` (único: id_estudiante) · `uq_estudiante_documento` (único: documento) · `uq_estudiante_usuario` (único: id_usuario)

## 11.8 `evento_seguridad`

Eventos de autenticación y seguridad con el correo en hash y la red de origen truncada (migración 012).

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_evento` | `bigint` | No | — | PK | auto_increment |
| 2 | `tipo` | `varchar(40)` | No | — | IDX |  |
| 3 | `resultado` | `varchar(16)` | No | — |  |  |
| 4 | `id_usuario` | `int` | Sí | — | IDX |  |
| 5 | `correo_hash` | `char(64)` | Sí | — | IDX | 🔒 valor derivado de un secreto |
| 6 | `red_origen` | `varchar(50)` | Sí | — |  |  |
| 7 | `detalle` | `varchar(120)` | Sí | — |  |  |
| 8 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` | IDX |  |

**Índices:** `idx_evento_seguridad_correo_fecha` (no único: correo_hash,created_at) · `idx_evento_seguridad_fecha` (no único: created_at) · `idx_evento_seguridad_tipo_fecha` (no único: tipo,created_at) · `idx_evento_seguridad_usuario_fecha` (no único: id_usuario,created_at) · `PRIMARY` (único: id_evento)

## 11.9 `external_identity`

Identidades de proveedores externos (Google, Microsoft, Apple) vinculadas a una cuenta; único por issuer y subject (migración 003).

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_external_identity` | `bigint` | No | — | PK | auto_increment |
| 2 | `id_usuario` | `int` | No | — | IDX | FK → `usuario.id_usuario` |
| 3 | `issuer` | `varchar(255)` | No | — | IDX |  |
| 4 | `subject` | `varchar(255)` | No | — |  |  |
| 5 | `email` | `varchar(254)` | Sí | — |  |  |
| 6 | `email_verified` | `tinyint(1)` | No | `0` |  |  |
| 7 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |

**Índices:** `idx_external_identity_user` (no único: id_usuario) · `PRIMARY` (único: id_external_identity) · `uq_external_identity_issuer_subject` (único: issuer,subject)

## 11.10 `historial`

Cabecera de cada versión o evento del historial de un PIAR.

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_historial` | `int` | No | — | PK | auto_increment |
| 2 | `id_piar` | `int` | Sí | — | IDX | FK → `piar.id_piar` |
| 3 | `id_usuario_creador` | `int` | Sí | — | IDX | FK → `usuario.id_usuario` |
| 4 | `tipo_registro` | `varchar(50)` | Sí | — |  |  |
| 5 | `id_referencia` | `int` | Sí | — |  |  |
| 6 | `descripcion` | `text` | Sí | — |  |  |
| 7 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |
| 8 | `updated_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  | on update CURRENT_TIMESTAMP |

**Índices:** `idx_historial_piar` (no único: id_piar) · `idx_historial_usuario` (no único: id_usuario_creador) · `PRIMARY` (único: id_historial)

## 11.11 `historial_detalle`

Detalle de cada cambio versionado: valores anterior y nuevo en JSON, tipo de registro y autor.

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_detalle` | `int` | No | — | PK | auto_increment |
| 2 | `id_historial` | `int` | No | — | IDX | FK → `historial.id_historial` |
| 3 | `tipo_registro` | `varchar(50)` | Sí | — |  |  |
| 4 | `id_referencia` | `int` | Sí | — |  |  |
| 5 | `id_usuario` | `int` | Sí | — | IDX | FK → `usuario.id_usuario` |
| 6 | `descripcion` | `text` | Sí | — |  |  |
| 7 | `fecha_evento` | `datetime` | No | `CURRENT_TIMESTAMP` | IDX |  |
| 8 | `valor_anterior` | `json` | Sí | — |  |  |
| 9 | `valor_nuevo` | `json` | Sí | — |  |  |

**Índices:** `idx_historial_detalle_fecha` (no único: fecha_evento) · `idx_historial_detalle_historial` (no único: id_historial) · `idx_historial_detalle_usuario` (no único: id_usuario) · `PRIMARY` (único: id_detalle)

## 11.12 `limite_solicitudes`

Contadores de límites de intentos compartidos entre instancias cuando RATE_LIMIT_STORE=mysql; la clave es un hash.

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `clave` | `char(64)` | No | — | PK |  |
| 2 | `conteo` | `int unsigned` | No | `1` |  |  |
| 3 | `expira_at` | `datetime(3)` | No | — | IDX |  |

**Índices:** `idx_limite_solicitudes_expira` (no único: expira_at) · `PRIMARY` (único: clave)

## 11.13 `observacion`

Observaciones pedagógicas del estudiante o del PIAR; inmutables una vez registradas.

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_observacion` | `int` | No | — | PK | auto_increment |
| 2 | `fecha` | `date` | Sí | — |  |  |
| 3 | `descripcion` | `text` | Sí | — |  |  |
| 4 | `docente_responsable` | `varchar(150)` | Sí | — |  |  |
| 5 | `id_estudiante` | `int` | Sí | — | IDX | FK → `estudiante.id_estudiante` |
| 6 | `id_docente` | `int` | Sí | — | IDX | FK → `docente.id_docente` |
| 7 | `id_piar` | `int` | Sí | — | IDX | FK → `piar.id_piar` |
| 8 | `id_usuario_autor` | `int` | Sí | — | IDX | FK → `usuario.id_usuario` |
| 9 | `tipo` | `varchar(50)` | Sí | — |  |  |
| 10 | `avance` | `decimal(5,2)` | Sí | — |  |  |
| 11 | `estado` | `varchar(30)` | Sí | — |  |  |
| 12 | `acuerdos` | `text` | Sí | — |  |  |
| 13 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |
| 14 | `updated_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  | on update CURRENT_TIMESTAMP |

**Índices:** `idx_observacion_docente` (no único: id_docente) · `idx_observacion_estudiante` (no único: id_estudiante) · `idx_observacion_piar` (no único: id_piar) · `idx_observacion_usuario` (no único: id_usuario_autor) · `PRIMARY` (único: id_observacion)

## 11.14 `oidc_login_transaction`

Transacciones de un solo uso del inicio de sesión externo: state, nonce y verificador PKCE.

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `state_hash` | `char(64)` | No | — | PK | 🔒 valor derivado de un secreto |
| 2 | `provider` | `varchar(20)` | No | — |  |  |
| 3 | `nonce` | `varchar(100)` | No | — |  | 🔒 valor derivado de un secreto |
| 4 | `code_verifier` | `varchar(100)` | No | — |  | 🔒 valor derivado de un secreto |
| 5 | `link_user_id` | `int` | Sí | — | IDX | FK → `usuario.id_usuario` |
| 6 | `expires_at` | `datetime` | No | — | IDX |  |
| 7 | `consumed_at` | `datetime` | Sí | — |  |  |
| 8 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |

**Índices:** `fk_oidc_transaction_user` (no único: link_user_id) · `idx_oidc_transaction_expiry` (no único: expires_at) · `PRIMARY` (único: state_hash)

## 11.15 `piar`

Plan Individual de Ajustes Razonables: componentes pedagógicos del Decreto 1421 de 2017, estado y fechas de revisión y cierre.

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_piar` | `int` | No | — | PK | auto_increment |
| 2 | `id_estudiante` | `int` | No | — | IDX | FK → `estudiante.id_estudiante` |
| 3 | `id_usuario_creador` | `int` | Sí | — | IDX | FK → `usuario.id_usuario` |
| 4 | `titulo` | `varchar(200)` | No | — |  |  |
| 5 | `periodo` | `varchar(50)` | No | — |  |  |
| 6 | `anio` | `int` | No | — |  |  |
| 7 | `estado` | `varchar(30)` | No | `draft` | IDX |  |
| 8 | `objetivo_general` | `text` | Sí | — |  |  |
| 9 | `metas` | `text` | Sí | — |  |  |
| 10 | `caracterizacion` | `text` | Sí | — |  |  |
| 11 | `barreras` | `text` | Sí | — |  |  |
| 12 | `estrategias` | `text` | Sí | — |  |  |
| 13 | `informes_salud` | `text` | Sí | — |  |  |
| 14 | `proyectos` | `text` | Sí | — |  |  |
| 15 | `actividades_receso` | `text` | Sí | — |  |  |
| 16 | `otra_informacion` | `text` | Sí | — |  |  |
| 17 | `acta_acuerdos` | `text` | Sí | — |  |  |
| 18 | `informe_anual` | `text` | Sí | — |  |  |
| 19 | `entrega_pedagogica` | `text` | Sí | — |  |  |
| 20 | `fecha_creacion` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |
| 21 | `fecha_revision` | `date` | Sí | — |  |  |
| 22 | `fecha_cierre` | `datetime` | Sí | — |  |  |
| 23 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |
| 24 | `updated_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  | on update CURRENT_TIMESTAMP |

**Índices:** `idx_piar_estado` (no único: estado) · `idx_piar_estudiante` (no único: id_estudiante) · `idx_piar_usuario_creador` (no único: id_usuario_creador) · `PRIMARY` (único: id_piar)

## 11.16 `piar_ajuste`

Ajustes razonables del PIAR, con trazabilidad a la barrera (clave compuesta id_piar, id_barrera), responsable, indicador y avance (0–100).

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_ajuste` | `int` | No | — | PK | auto_increment |
| 2 | `id_piar` | `int` | No | — | IDX | FK → `piar_barrera.id_piar` |
| 3 | `area` | `varchar(100)` | No | — |  |  |
| 4 | `tipo` | `varchar(100)` | No | — |  |  |
| 5 | `estrategia` | `text` | No | — |  |  |
| 6 | `recursos` | `text` | Sí | — |  |  |
| 7 | `responsable` | `varchar(150)` | Sí | — |  |  |
| 8 | `avance` | `decimal(5,2)` | No | `0.00` |  |  |
| 9 | `estado` | `varchar(20)` | No | `activo` |  |  |
| 10 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |
| 11 | `updated_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  | on update CURRENT_TIMESTAMP |
| 12 | `id_barrera` | `int` | Sí | — |  | FK → `piar_barrera.id_barrera` |
| 13 | `id_usuario_responsable` | `int` | Sí | — | IDX | FK → `usuario.id_usuario` |
| 14 | `resultado_esperado` | `text` | Sí | — |  |  |
| 15 | `indicador_logro` | `text` | Sí | — |  |  |
| 16 | `fecha_revision_prevista` | `date` | Sí | — |  |  |

**Índices:** `fk_piar_ajuste_barrera` (no único: id_piar,id_barrera) · `fk_piar_ajuste_responsable` (no único: id_usuario_responsable) · `idx_piar_ajuste_piar` (no único: id_piar) · `PRIMARY` (único: id_ajuste) · `uq_piar_ajuste_contexto` (único: id_piar,id_ajuste)

## 11.17 `piar_ajuste_evidencia`

Evidencias descriptivas de la aplicación de un ajuste (no almacena archivos).

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_evidencia` | `int` | No | — | PK | auto_increment |
| 2 | `id_ajuste` | `int` | No | — | IDX | FK → `piar_ajuste.id_ajuste` |
| 3 | `descripcion` | `text` | No | — |  |  |
| 4 | `referencia` | `varchar(500)` | Sí | — |  |  |
| 5 | `fecha` | `date` | No | — |  |  |
| 6 | `id_usuario_autor` | `int` | No | — | IDX | FK → `usuario.id_usuario` |
| 7 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |

**Índices:** `idx_piar_evidencia_ajuste` (no único: id_ajuste) · `idx_piar_evidencia_autor` (no único: id_usuario_autor) · `PRIMARY` (único: id_evidencia)

## 11.18 `piar_auditoria`

Auditoría de acceso a recursos pedagógicos: actor, acción, recurso, resultado y código HTTP, sin contenido (migración 007).

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_evento` | `bigint` | No | — | PK | auto_increment |
| 2 | `actor_user_id` | `int` | Sí | — | IDX |  |
| 3 | `action` | `varchar(12)` | No | — |  |  |
| 4 | `resource_type` | `varchar(40)` | No | — | IDX |  |
| 5 | `resource_id` | `bigint` | Sí | — |  |  |
| 6 | `result` | `varchar(12)` | No | — |  |  |
| 7 | `http_status` | `smallint` | No | — |  |  |
| 8 | `occurred_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |

**Índices:** `idx_piar_auditoria_actor_time` (no único: actor_user_id,occurred_at) · `idx_piar_auditoria_resource_time` (no único: resource_type,resource_id,occurred_at) · `PRIMARY` (único: id_evento)

## 11.19 `piar_barrera`

Barreras para el aprendizaje y la participación identificadas por contexto (migración 008).

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_barrera` | `int` | No | — | PK | auto_increment |
| 2 | `id_piar` | `int` | No | — | IDX | FK → `piar.id_piar` |
| 3 | `contexto` | `varchar(40)` | No | — |  |  |
| 4 | `descripcion` | `text` | No | — |  |  |
| 5 | `actividad` | `text` | Sí | — |  |  |
| 6 | `condicion_entorno` | `text` | Sí | — |  |  |
| 7 | `fecha_identificacion` | `date` | No | — |  |  |
| 8 | `id_usuario_registro` | `int` | No | — | IDX | FK → `usuario.id_usuario` |
| 9 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |

**Índices:** `fk_piar_barrera_usuario` (no único: id_usuario_registro) · `idx_piar_barrera_piar` (no único: id_piar) · `PRIMARY` (único: id_barrera) · `uq_piar_barrera_contexto` (único: id_piar,id_barrera)

## 11.20 `piar_docente`

Relación N:M entre PIAR y docentes; indica el responsable principal y define el alcance del rol Docente.

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_piar` | `int` | No | — | PK | FK → `piar.id_piar` |
| 2 | `id_docente` | `int` | No | — | PK | FK → `docente.id_docente` |
| 3 | `es_responsable_principal` | `tinyint(1)` | No | `0` |  |  |
| 4 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |

**Índices:** `idx_piar_docente_docente` (no único: id_docente) · `PRIMARY` (único: id_piar,id_docente)

## 11.21 `piar_dua`

Estrategias del Diseño Universal para el Aprendizaje por principio: representación, acción y expresión, implicación (migración 013).

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_dua` | `int` | No | — | PK | auto_increment |
| 2 | `id_piar` | `int` | No | — | IDX | FK → `piar.id_piar` |
| 3 | `principio` | `enum('representacion','accion_expresion','implicacion')` | No | — |  |  |
| 4 | `area` | `varchar(100)` | Sí | — |  |  |
| 5 | `estrategia` | `text` | No | — |  |  |
| 6 | `recursos` | `text` | Sí | — |  |  |
| 7 | `id_usuario_registro` | `int` | No | — | IDX | FK → `usuario.id_usuario` |
| 8 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |
| 9 | `updated_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  | on update CURRENT_TIMESTAMP |

**Índices:** `idx_piar_dua_piar` (no único: id_piar,principio) · `idx_piar_dua_usuario` (no único: id_usuario_registro) · `PRIMARY` (único: id_dua)

## 11.22 `psicologa`

Perfil de psicología referenciado por los diagnósticos (id_psicologa). No se usa para autorizar.

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_psicologa` | `int` | No | — | PK | auto_increment |
| 2 | `nombre` | `varchar(150)` | No | — |  |  |
| 3 | `correo` | `varchar(150)` | Sí | — |  |  |
| 4 | `documento` | `varchar(30)` | Sí | — |  |  |
| 5 | `estado` | `varchar(20)` | No | `activo` |  |  |
| 6 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |
| 7 | `updated_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  | on update CURRENT_TIMESTAMP |

**Índices:** `PRIMARY` (único: id_psicologa)

## 11.23 `recuperacion_contrasena`

Tokens de recuperación de contraseña (hash, un solo uso, 30 minutos).

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_recuperacion` | `bigint` | No | — | PK | auto_increment |
| 2 | `id_usuario` | `int` | No | — | IDX | FK → `usuario.id_usuario` |
| 3 | `token_hash` | `char(64)` | No | — | UQ | 🔒 valor derivado de un secreto |
| 4 | `expires_at` | `datetime` | No | — | IDX |  |
| 5 | `consumed_at` | `datetime` | Sí | — |  |  |
| 6 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |

**Índices:** `idx_recuperacion_expira` (no único: expires_at) · `idx_recuperacion_usuario` (no único: id_usuario) · `PRIMARY` (único: id_recuperacion) · `uq_recuperacion_token_hash` (único: token_hash)

## 11.24 `reporte`

Informes persistentes de un PIAR: instantánea del contenido construida por el servidor, con su hash, autor y fecha (migración 014).

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_reporte` | `int` | No | — | PK | auto_increment |
| 2 | `id_piar` | `int` | Sí | — | IDX | FK → `piar.id_piar` |
| 3 | `id_estudiante` | `int` | Sí | — | IDX | FK → `estudiante.id_estudiante` |
| 4 | `id_usuario` | `int` | Sí | — | IDX | FK → `usuario.id_usuario` |
| 5 | `tipo` | `varchar(100)` | Sí | — |  |  |
| 6 | `periodo` | `varchar(50)` | Sí | — |  |  |
| 7 | `formato` | `varchar(20)` | Sí | — |  |  |
| 8 | `filtros` | `json` | Sí | — |  |  |
| 9 | `contenido` | `json` | Sí | — |  |  |
| 10 | `contenido_hash` | `char(64)` | Sí | — |  |  |
| 11 | `nombre_archivo` | `varchar(255)` | Sí | — |  |  |
| 12 | `ruta_archivo` | `varchar(500)` | Sí | — |  |  |
| 13 | `estado` | `varchar(30)` | No | `generado` | IDX |  |
| 14 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |

**Índices:** `idx_reporte_dedupe` (no único: id_usuario,id_piar,contenido_hash,created_at) · `idx_reporte_estado` (no único: estado) · `idx_reporte_estudiante` (no único: id_estudiante,created_at) · `idx_reporte_piar` (no único: id_piar) · `idx_reporte_usuario` (no único: id_usuario) · `PRIMARY` (único: id_reporte)

## 11.25 `schema_migrations`

Registro de migraciones aplicadas con su checksum SHA-256.

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `version` | `char(3)` | No | — | PK |  |
| 2 | `nombre` | `varchar(120)` | No | — |  |  |
| 3 | `checksum` | `char(64)` | No | — |  |  |
| 4 | `applied_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |

**Índices:** `PRIMARY` (único: version)

## 11.26 `seguimiento`

Seguimientos del PIAR, opcionalmente enlazados a un ajuste; inmutables una vez registrados.

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_seguimiento` | `int` | No | — | PK | auto_increment |
| 2 | `fecha` | `date` | Sí | — |  |  |
| 3 | `descripcion` | `text` | Sí | — |  |  |
| 4 | `responsable` | `varchar(150)` | Sí | — |  |  |
| 5 | `id_estudiante` | `int` | Sí | — | IDX | FK → `estudiante.id_estudiante` |
| 6 | `id_coordinador` | `int` | Sí | — | IDX | FK → `coordinador.id_coordinador` |
| 7 | `id_piar` | `int` | Sí | — | IDX | FK → `piar_ajuste.id_piar` |
| 8 | `id_usuario_responsable` | `int` | Sí | — | IDX | FK → `usuario.id_usuario` |
| 9 | `estado` | `varchar(30)` | Sí | — |  |  |
| 10 | `acuerdos` | `text` | Sí | — |  |  |
| 11 | `evolucion` | `text` | Sí | — |  |  |
| 12 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |
| 13 | `updated_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  | on update CURRENT_TIMESTAMP |
| 14 | `id_ajuste` | `int` | Sí | — | IDX | FK → `piar_ajuste.id_ajuste` |

**Índices:** `fk_seguimiento_ajuste` (no único: id_piar,id_ajuste) · `idx_seguimiento_ajuste` (no único: id_ajuste) · `idx_seguimiento_coordinador` (no único: id_coordinador) · `idx_seguimiento_estudiante` (no único: id_estudiante) · `idx_seguimiento_piar` (no único: id_piar) · `idx_seguimiento_usuario` (no único: id_usuario_responsable) · `PRIMARY` (único: id_seguimiento)

## 11.27 `sesion_usuario`

Sesiones activas: hash del token, vencimiento (8 h) y revocación.

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_sesion` | `int` | No | — | PK | auto_increment |
| 2 | `id_usuario` | `int` | No | — | IDX | FK → `usuario.id_usuario` |
| 3 | `token_hash` | `char(64)` | No | — | UQ | 🔒 valor derivado de un secreto |
| 4 | `expires_at` | `datetime` | No | — | IDX |  |
| 5 | `revoked_at` | `datetime` | Sí | — |  |  |
| 6 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |

**Índices:** `idx_sesion_usuario_expires` (no único: expires_at) · `idx_sesion_usuario_usuario` (no único: id_usuario) · `PRIMARY` (único: id_sesion) · `uq_sesion_usuario_token_hash` (único: token_hash)

## 11.28 `usuario`

Cuentas de acceso: rol, estado, hash de la contraseña (bcrypt), verificación del correo, contraseña temporal y decisión de aprobación.

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_usuario` | `int` | No | — | PK | auto_increment |
| 2 | `nombre` | `varchar(150)` | No | — |  |  |
| 3 | `documento` | `varchar(30)` | No | — | UQ |  |
| 4 | `correo` | `varchar(150)` | No | — | UQ |  |
| 5 | `rol` | `enum('Docente','Psicóloga','Coordinador','Administrador','Rector','Estudiante')` | No | — |  |  |
| 6 | `contrasena` | `varchar(255)` | No | `` |  | 🔒 valor derivado de un secreto |
| 7 | `password_hash` | `varchar(255)` | Sí | — |  | 🔒 valor derivado de un secreto |
| 8 | `estado` | `varchar(30)` | No | `activo` | IDX |  |
| 9 | `correo_verificado_at` | `datetime` | Sí | — |  |  |
| 10 | `password_change_required` | `tinyint(1)` | No | `0` |  |  |
| 11 | `ultimo_acceso_at` | `datetime` | Sí | — |  |  |
| 12 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |
| 13 | `updated_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  | on update CURRENT_TIMESTAMP |
| 14 | `aprobado_por_usuario_id` | `int` | Sí | — | IDX | FK → `usuario.id_usuario` |
| 15 | `rechazado_por_usuario_id` | `int` | Sí | — | IDX | FK → `usuario.id_usuario` |
| 16 | `decision_at` | `datetime` | Sí | — |  |  |
| 17 | `decision_reason` | `varchar(500)` | Sí | — |  |  |

**Índices:** `fk_usuario_aprobado_por` (no único: aprobado_por_usuario_id) · `fk_usuario_rechazado_por` (no único: rechazado_por_usuario_id) · `idx_usuario_estado` (no único: estado) · `PRIMARY` (único: id_usuario) · `uq_usuario_correo` (único: correo) · `uq_usuario_documento` (único: documento)

## 11.29 `verificacion_correo`

Tokens de verificación del correo (hash, un solo uso, 24 h).

| # | Columna | Tipo | Nulo | Predeterminado | Clave | Observaciones |
|---|---|---|---|---|---|---|
| 1 | `id_verificacion` | `bigint` | No | — | PK | auto_increment |
| 2 | `id_usuario` | `int` | No | — | IDX | FK → `usuario.id_usuario` |
| 3 | `token_hash` | `char(64)` | No | — | UQ | 🔒 valor derivado de un secreto |
| 4 | `expires_at` | `datetime` | No | — | IDX |  |
| 5 | `consumed_at` | `datetime` | Sí | — |  |  |
| 6 | `created_at` | `datetime` | No | `CURRENT_TIMESTAMP` |  |  |

**Índices:** `idx_verificacion_correo_expira` (no único: expires_at) · `idx_verificacion_correo_usuario` (no único: id_usuario) · `PRIMARY` (único: id_verificacion) · `uq_verificacion_correo_token_hash` (único: token_hash)

