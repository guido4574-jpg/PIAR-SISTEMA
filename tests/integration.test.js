"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { test } = require("node:test");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");
const { targetForProfile, mysqlConnectionConfig, integrationEnvironment, assertIntegrationGrants, assertFixtureRetentionDisabled } = require("../scripts/local-piar-test-config");
const { assertNoRetainedSyntheticFixtureUsers } = require("../scripts/integration-fixture-guard");

const ROOT = path.resolve(__dirname, "..");
const API_ORIGIN = "http://127.0.0.1:8081";
const REQUIRED_TABLES = [
    "usuario", "sesion_usuario", "recuperacion_contrasena", "verificacion_correo", "estudiante", "docente", "piar",
    "piar_docente", "piar_barrera", "piar_ajuste", "piar_ajuste_evidencia", "diagnostico", "observacion", "seguimiento", "oidc_login_transaction", "external_identity", "piar_auditoria"
];
const REQUIRED_COLUMNS = {
    usuario: ["id_usuario", "nombre", "documento", "correo", "rol", "contrasena", "password_hash", "estado", "ultimo_acceso_at", "correo_verificado_at", "aprobado_por_usuario_id", "rechazado_por_usuario_id", "decision_at", "decision_reason"],
    piar: ["id_piar", "id_estudiante", "objetivo_general", "metas", "caracterizacion", "barreras", "estrategias", "informes_salud", "proyectos", "actividades_receso", "otra_informacion", "acta_acuerdos", "informe_anual", "entrega_pedagogica"],
    sesion_usuario: ["id_sesion", "id_usuario", "token_hash", "expires_at", "revoked_at", "created_at"],
    verificacion_correo: ["id_verificacion", "id_usuario", "token_hash", "expires_at", "consumed_at", "created_at"],
    recuperacion_contrasena: ["id_recuperacion", "id_usuario", "token_hash", "expires_at", "consumed_at", "created_at"],
    oidc_login_transaction: ["state_hash", "provider", "nonce", "code_verifier", "link_user_id", "expires_at", "consumed_at"],
    external_identity: ["id_external_identity", "id_usuario", "issuer", "subject", "email", "email_verified", "created_at"],
    estudiante: ["id_estudiante", "id_usuario", "nombre", "documento", "estado"],
    docente: ["id_docente", "id_usuario", "nombre", "area", "correo", "documento", "estado"],
    piar: ["id_piar", "id_estudiante", "id_usuario_creador", "titulo", "periodo", "anio", "estado", "objetivo_general", "fecha_cierre"],
    piar_barrera: ["id_barrera", "id_piar", "contexto", "descripcion", "actividad", "condicion_entorno", "fecha_identificacion", "id_usuario_registro"],
    piar_docente: ["id_piar", "id_docente", "es_responsable_principal"],
    piar_ajuste: ["id_ajuste", "id_piar", "id_barrera", "id_usuario_responsable", "resultado_esperado", "indicador_logro", "fecha_revision_prevista"],
    piar_ajuste_evidencia: ["id_evidencia", "id_ajuste", "descripcion", "referencia", "fecha", "id_usuario_autor"],
    diagnostico: ["id_diagnostico", "tipo_diagnostico", "fecha", "descripcion", "id_estudiante", "id_psicologa", "id_piar", "id_usuario_creador"],
    observacion: ["id_observacion", "fecha", "descripcion", "docente_responsable", "id_estudiante", "id_docente", "id_piar", "id_usuario_autor", "tipo", "avance", "estado", "acuerdos"],
    seguimiento: ["id_seguimiento", "fecha", "descripcion", "responsable", "id_estudiante", "id_coordinador", "id_piar", "id_ajuste", "id_usuario_responsable", "estado", "acuerdos", "evolucion"]
};
const REQUIRED_FOREIGN_KEYS = [
    ["docente", "id_usuario", "usuario", "id_usuario"],
    ["estudiante", "id_usuario", "usuario", "id_usuario"],
    ["piar", "id_estudiante", "estudiante", "id_estudiante"],
    ["piar", "id_usuario_creador", "usuario", "id_usuario"],
    ["piar_docente", "id_piar", "piar", "id_piar"],
    ["piar_docente", "id_docente", "docente", "id_docente"],
    ["piar_barrera", "id_piar", "piar", "id_piar"],
    ["piar_barrera", "id_usuario_registro", "usuario", "id_usuario"],
    ["piar_ajuste", "id_usuario_responsable", "usuario", "id_usuario"],
    ["piar_ajuste_evidencia", "id_ajuste", "piar_ajuste", "id_ajuste"],
    ["piar_ajuste_evidencia", "id_usuario_autor", "usuario", "id_usuario"],
    ["diagnostico", "id_estudiante", "estudiante", "id_estudiante"],
    ["diagnostico", "id_piar", "piar", "id_piar"],
    ["diagnostico", "id_usuario_creador", "usuario", "id_usuario"],
    ["observacion", "id_estudiante", "estudiante", "id_estudiante"],
    ["observacion", "id_docente", "docente", "id_docente"],
    ["observacion", "id_piar", "piar", "id_piar"],
    ["observacion", "id_usuario_autor", "usuario", "id_usuario"],
    ["seguimiento", "id_estudiante", "estudiante", "id_estudiante"],
    ["seguimiento", "id_piar", "piar", "id_piar"],
    ["seguimiento", "id_ajuste", "piar_ajuste", "id_ajuste"],
    ["seguimiento", "id_usuario_responsable", "usuario", "id_usuario"],
    ["oidc_login_transaction", "link_user_id", "usuario", "id_usuario"],
    ["external_identity", "id_usuario", "usuario", "id_usuario"]
];
// Migration 015 adds Estudiante (own-PIAR, read-only access).
const DATABASE_ROLES = ["Docente", "Psicóloga", "Coordinador", "Administrador", "Rector", "Estudiante"];
const FIXTURE_ROLES = ["Administrador", "Rector", "Coordinador", "Psicóloga", "Docente", "Docente", "Docente"];

function assertTestEnvironment() {
    assertFixtureRetentionDisabled(process.env);
    const profile = process.env.PIAR_TEST_PROFILE || "";
    if (!["fresh", "local", "ensayo"].includes(profile)) throw new Error("Preflight rechazado: la integración solo admite los perfiles fresh o local en loopback.");
    const target = targetForProfile(profile);
    const expected = {
        DB_HOST: target.host,
        DB_PORT: String(target.port),
        DB_NAME: target.database,
        DB_USER: target.user,
        PORT: "8081"
    };
    for (const [name, value] of Object.entries(expected)) {
        if (process.env[name] !== value) {
            throw new Error(`Preflight rechazado: ${name} debe estar configurada para el entorno local de pruebas.`);
        }
    }
    if (!process.env.DB_PASSWORD) {
        throw new Error("Preflight rechazado: DB_PASSWORD no está disponible en este proceso.");
    }
}

function assertPortFree(port) {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once("error", error => {
            if (error.code === "EADDRINUSE") reject(new Error(`Preflight rechazado: el puerto local ${port} ya está ocupado.`));
            else reject(new Error(`Preflight de puerto falló (${error.code || "ERROR"}).`));
        });
        probe.listen(port, "127.0.0.1", () => probe.close(error => error
            ? reject(new Error(`No se pudo liberar la comprobación del puerto ${port}.`))
            : resolve()));
    });
}

function insertId(result) {
    return Number(result.insertId);
}

async function assertSafeDatabaseIdentityAndGrants(db) {
    const [identityRows] = await db.query("SELECT DATABASE() AS db, @@port AS port, CURRENT_USER() AS account, @@read_only AS readOnly");
    const identity = identityRows[0];
    const target = targetForProfile(process.env.PIAR_TEST_PROFILE || "existing");
    assert.equal(identity?.db, target.database, "La base conectada debe ser la base de pruebas seleccionada.");
    assert.equal(Number(identity?.port), 3306, "La conexión publicada en loopback debe llegar al MySQL interno del contenedor en el puerto 3306.");
    assert.equal(String(identity?.account || "").split("@")[0], target.user, "MySQL debe autenticar la cuenta de prueba esperada.");
    assert.equal(Number(identity?.readOnly), 0, "La base local no debe estar en modo read-only para fixtures.");

    const [grantRows] = await db.query("SHOW GRANTS");
    assert.doesNotThrow(() => assertIntegrationGrants(grantRows, target.database));
}

async function assertFixtureRolesAllowed(db) {
    const [rows] = await db.execute(
        "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuario' AND COLUMN_NAME = 'rol'"
    );
    const columnType = rows[0]?.COLUMN_TYPE;
    assert.ok(columnType, "No se encontró la columna usuario.rol en piar_test.");
    assert.match(columnType, /^enum\(/i, "Se esperaba un ENUM finito en usuario.rol; no se crearán fixtures con un esquema distinto.");
    const actualRoles = [...columnType.matchAll(/'((?:[^'\\]|\\.)*)'/g)]
        .map(match => match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\"));
    assert.deepEqual(
        [...actualRoles].sort(),
        [...DATABASE_ROLES].sort(),
        "Los valores ENUM de usuario.rol no coinciden con los roles definidos por la migración vigente."
    );
    const unsupportedFixtures = [...new Set(FIXTURE_ROLES)].filter(role => !actualRoles.includes(role));
    assert.deepEqual(unsupportedFixtures, [], "Un rol sintético no está permitido por usuario.rol.");
}

async function assertRequiredSchema(db) {
    const [rows] = await db.execute(
        "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()"
    );
    const columnsByTable = new Map();
    for (const row of rows) {
        if (!columnsByTable.has(row.TABLE_NAME)) columnsByTable.set(row.TABLE_NAME, new Map());
        columnsByTable.get(row.TABLE_NAME).set(row.COLUMN_NAME, row);
    }
    const missing = [];
    for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
        const actual = columnsByTable.get(table);
        for (const column of required) {
            if (!actual?.has(column)) missing.push(`${table}.${column}`);
        }
    }
    assert.deepEqual(missing, [], "Faltan columnas requeridas por autenticación o fixtures; no se ejecutarán escrituras.");

    const verifiedAt = columnsByTable.get("usuario").get("correo_verificado_at");
    assert.equal(verifiedAt.DATA_TYPE.toLowerCase(), "datetime", "usuario.correo_verificado_at debe ser DATETIME.");
    assert.equal(verifiedAt.IS_NULLABLE, "YES", "usuario.correo_verificado_at debe permitir NULL para cuentas sin verificar.");

    const stateColumn = columnsByTable.get("usuario").get("estado");
    assert.equal(stateColumn.DATA_TYPE.toLowerCase(), "varchar", "usuario.estado debe ser VARCHAR.");
    assert.ok(Number(stateColumn.CHARACTER_MAXIMUM_LENGTH) >= 22,
        "usuario.estado debe admitir al menos 22 caracteres (pendiente_verificacion); no se ejecutarán escrituras.");
    const verificationColumns = columnsByTable.get("verificacion_correo");
    assert.equal(verificationColumns.get("id_verificacion").DATA_TYPE.toLowerCase(), "bigint");
    assert.equal(verificationColumns.get("id_usuario").DATA_TYPE.toLowerCase(), "int");
    assert.equal(verificationColumns.get("token_hash").DATA_TYPE.toLowerCase(), "char");
    assert.equal(Number(verificationColumns.get("token_hash").CHARACTER_MAXIMUM_LENGTH), 64);
    assert.equal(verificationColumns.get("expires_at").DATA_TYPE.toLowerCase(), "datetime");
    assert.equal(verificationColumns.get("consumed_at").DATA_TYPE.toLowerCase(), "datetime");
    assert.equal(verificationColumns.get("created_at").DATA_TYPE.toLowerCase(), "datetime");

    const [constraints] = await db.execute(
        "SELECT tc.TABLE_NAME, tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME FROM information_schema.TABLE_CONSTRAINTS tc LEFT JOIN information_schema.KEY_COLUMN_USAGE kcu ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND kcu.TABLE_NAME = tc.TABLE_NAME AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA = DATABASE() ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION"
    );
    assert.ok(constraints.some(row => row.CONSTRAINT_TYPE === "PRIMARY KEY" && row.COLUMN_NAME === "id_verificacion"),
        "verificacion_correo requiere PK en id_verificacion.");
    assert.ok(constraints.some(row => row.CONSTRAINT_TYPE === "UNIQUE" && row.COLUMN_NAME === "token_hash"),
        "verificacion_correo.token_hash debe ser único.");
    assert.ok(constraints.some(row => row.CONSTRAINT_TYPE === "FOREIGN KEY" && row.COLUMN_NAME === "id_usuario" && row.REFERENCED_TABLE_NAME === "usuario" && row.REFERENCED_COLUMN_NAME === "id_usuario"),
        "verificacion_correo.id_usuario debe referenciar usuario.id_usuario.");
    const missingForeignKeys = REQUIRED_FOREIGN_KEYS.filter(([table, column, targetTable, targetColumn]) =>
        !constraints.some(row => row.TABLE_NAME === table && row.CONSTRAINT_TYPE === "FOREIGN KEY" && row.COLUMN_NAME === column && row.REFERENCED_TABLE_NAME === targetTable && row.REFERENCED_COLUMN_NAME === targetColumn)
    );
    assert.deepEqual(missingForeignKeys, [], "Faltan claves foráneas requeridas por las relaciones de fixtures; no se ejecutarán escrituras.");
    const assignmentPrimaryKey = constraints.filter(row => row.TABLE_NAME === "piar_docente" && row.CONSTRAINT_TYPE === "PRIMARY KEY").map(row => row.COLUMN_NAME);
    assert.deepEqual(assignmentPrimaryKey, ["id_piar", "id_docente"], "piar_docente requiere clave primaria compuesta para fixtures de asignación.");
}

async function fetchJson(pathname, { method = "GET", cookie, body, rawBody } = {}) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    let requestBody;
    if (rawBody !== undefined) {
        headers["Content-Type"] = "application/json";
        requestBody = rawBody;
    } else if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        requestBody = JSON.stringify(body);
    }
    const response = await fetch(`${API_ORIGIN}${pathname}`, { method, headers, body: requestBody });
    const payload = await response.json().catch(() => ({}));
    return { status: response.status, payload, response };
}

function cookieFrom(response) {
    const values = response.headers.getSetCookie?.() || [];
    const value = values.find(item => item.startsWith("piar_session="));
    assert.ok(value, "La respuesta de login debe emitir cookie de sesión.");
    return value.split(";", 1)[0];
}

async function waitForApi(child) {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error("El backend terminó antes de responder al health check.");
        try {
            const response = await fetch(`${API_ORIGIN}/api/health`);
            if (response.status === 200) return;
        } catch { /* server is still starting */ }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error("El backend local no respondió al health check dentro del tiempo esperado.");
}

async function makeFixture(db, fixture) {
    const { ids, marker, users } = fixture;
    const password = `Synthetic-${crypto.randomBytes(18).toString("hex")}`;
    fixture.password = password;
    const passwordHash = await bcrypt.hash(password, 4);
    const roles = FIXTURE_ROLES;

    for (let index = 0; index < roles.length; index++) {
        const role = roles[index];
        const userTag = `${marker}${index}`;
        const [result] = await db.execute(
            "INSERT INTO usuario (nombre, documento, correo, rol, contrasena, password_hash, estado) VALUES (?, ?, ?, ?, '', ?, 'activo')",
            [`Synthetic ${userTag}`, userTag, `${userTag.toLowerCase()}@example.invalid`, role, passwordHash]
        );
        users[`${role}${index}`] = { id: insertId(result), email: `${userTag.toLowerCase()}@example.invalid`, password };
        ids.users.push(insertId(result));
    }

    for (const index of [4, 5]) {
        const user = users[`Docente${index}`];
        const teacherTag = `${marker}T${index}`;
        const [result] = await db.execute(
            "INSERT INTO docente (nombre, area, correo, documento, estado, id_usuario) VALUES (?, ?, ?, ?, 'activo', ?)",
            [`Synthetic ${teacherTag}`, "Prueba", `${teacherTag.toLowerCase()}@example.invalid`, teacherTag, user.id]
        );
        ids.teachers.push(insertId(result));
    }

    for (let index = 1; index <= 2; index++) {
        const studentTag = `${marker}S${index}`;
        const [result] = await db.execute(
            "INSERT INTO estudiante (nombre, documento, estado) VALUES (?, ?, 'activo')",
            [`Synthetic ${studentTag}`, studentTag]
        );
        ids.students.push(insertId(result));
    }

    for (let index = 1; index <= 2; index++) {
        const [result] = await db.execute(
            "INSERT INTO piar (id_estudiante, id_usuario_creador, titulo, periodo, anio, estado) VALUES (?, ?, ?, 'Prueba integración', 2026, 'draft')",
            [ids.students[index - 1], users.Coordinador2.id, `${marker}P${index}`]
        );
        ids.piars.push(insertId(result));
    }

    const [assignment] = await db.execute(
        "INSERT INTO piar_docente (id_piar, id_docente, es_responsable_principal) VALUES (?, ?, TRUE)",
        [ids.piars[0], ids.teachers[0]]
    );
    assert.equal(assignment.affectedRows, 1);
    ids.assignments.push([ids.piars[0], ids.teachers[0]]);

}

async function cleanupFixture(db, fixture) {
    const { ids, marker } = fixture;
    async function recoverOwnedIds(target, sql, values, field) {
        const [rows] = await db.execute(sql, values);
        target.push(...rows.map(row => Number(row[field])));
        const unique = [...new Set(target)];
        target.splice(0, target.length, ...unique);
    }

    await db.beginTransaction();
    try {
    if (fixture.users.Coordinador2 && ids.students[0]) {
        await recoverOwnedIds(ids.piars,
            "SELECT id_piar FROM piar WHERE titulo = ? AND id_usuario_creador = ? AND id_estudiante = ?",
            [`${marker}API`, fixture.users.Coordinador2.id, ids.students[0]], "id_piar");
        if (ids.teachers[1]) {
            const [createdAssignments] = await db.execute(
                "SELECT pd.id_piar, pd.id_docente FROM piar_docente pd INNER JOIN piar p ON p.id_piar = pd.id_piar WHERE p.titulo = ? AND p.id_usuario_creador = ? AND p.id_estudiante = ? AND pd.id_docente = ?",
                [`${marker}API`, fixture.users.Coordinador2.id, ids.students[0], ids.teachers[1]]
            );
            ids.assignments.push(...createdAssignments.map(row => [Number(row.id_piar), Number(row.id_docente)]));
        }
    }
    if (ids.students.length && Object.keys(fixture.users).length) {
        const studentParams = ids.students.map(() => "?").join(",");
        const userIds = [...new Set(Object.values(fixture.users).map(user => Number(user.id)).filter(Number.isSafeInteger))];
        const userParams = userIds.map(() => "?").join(",");
        await recoverOwnedIds(ids.piars,
            `SELECT id_piar FROM piar WHERE id_estudiante IN (${studentParams}) AND id_usuario_creador IN (${userParams})`,
            [...ids.students, ...userIds], "id_piar");
    }
    if (ids.piars[0] && ids.teachers[1]) {
        const [testAssignments] = await db.execute(
            "SELECT id_piar, id_docente FROM piar_docente WHERE id_piar = ? AND id_docente = ?",
            [ids.piars[0], ids.teachers[1]]
        );
        ids.assignments.push(...testAssignments.map(row => [Number(row.id_piar), Number(row.id_docente)]));
    }
    if (fixture.users["Psicóloga3"] && ids.piars[0]) {
        await recoverOwnedIds(ids.diagnoses,
            "SELECT id_diagnostico FROM diagnostico WHERE descripcion = ? AND id_usuario_creador = ? AND id_piar = ?",
            [`${marker} diagnóstico`, fixture.users["Psicóloga3"].id, ids.piars[0]], "id_diagnostico");
    }
    if (fixture.users.Docente4 && ids.piars[0]) {
        await recoverOwnedIds(ids.observations,
            "SELECT id_observacion FROM observacion WHERE descripcion = ? AND id_usuario_autor = ? AND id_piar = ?",
            [`${marker} observación`, fixture.users.Docente4.id, ids.piars[0]], "id_observacion");
        await recoverOwnedIds(ids.followUps,
            "SELECT id_seguimiento FROM seguimiento WHERE descripcion = ? AND id_usuario_responsable = ? AND id_piar = ?",
            [`${marker} seguimiento`, fixture.users.Docente4.id, ids.piars[0]], "id_seguimiento");
    }
    const registered = await db.execute(
        "SELECT id_usuario FROM usuario WHERE documento = ? AND correo = ? AND rol = 'Docente'",
        [`${marker}R`, `${marker.toLowerCase()}r@example.invalid`]
    );
    const registeredId = Number(registered[0][0]?.id_usuario || 0);
    const userIds = [...new Set([...ids.users, ...(registeredId ? [registeredId] : [])])];

    async function deleteIds(table, column, values) {
        if (!values.length) return;
        const placeholders = values.map(() => "?").join(",");
        await db.execute(`DELETE FROM ${table} WHERE ${column} IN (${placeholders})`, values);
    }

    await deleteIds("piar_auditoria", "actor_user_id", userIds);
    // Eventos de seguridad de esta ejecución (tabla sin FK): por usuario sintético o por el
    // hash de los correos sintéticos con el marcador. Los eventos sin usuario ni correo no
    // son atribuibles con certeza y se conservan, igual que los 401 sin actor de piar_auditoria.
    const syntheticEmails = [
        ...Object.values(fixture.users).map(user => user.email),
        `${marker.toLowerCase()}r@example.invalid`,
        `${marker.toLowerCase()}x@example.invalid`,
        `unknown-${marker}@example.invalid`
    ].filter(Boolean).map(email => String(email).trim().toLowerCase());
    const syntheticEmailHashes = syntheticEmails.map(email => crypto.createHash("sha256").update(email).digest("hex"));
    await deleteIds("evento_seguridad", "id_usuario", userIds);
    await deleteIds("evento_seguridad", "correo_hash", syntheticEmailHashes);
    // Decisión D2: aprobar o rechazar una solicitud audita en admin_account_audit (FK a usuario).
    await deleteIds("admin_account_audit", "target_user_id", userIds);
    // Decisión D1: cambio_correo existe solo con la migración 016 (FK a usuario dos veces).
    const [emailChangeTable] = await db.execute("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cambio_correo'");
    if (emailChangeTable.length) {
        await deleteIds("cambio_correo", "id_usuario", userIds);
        await deleteIds("cambio_correo", "solicitado_por", userIds);
    }
    await deleteIds("external_identity", "id_usuario", userIds);
    await deleteIds("oidc_login_transaction", "link_user_id", userIds);
    await deleteIds("sesion_usuario", "id_usuario", userIds);
    await deleteIds("recuperacion_contrasena", "id_usuario", userIds);
    await deleteIds("verificacion_correo", "id_usuario", userIds);
    await deleteIds("historial_detalle", "id_usuario", userIds);
    await deleteIds("historial", "id_usuario_creador", userIds);
    await deleteIds("diagnostico", "id_diagnostico", ids.diagnoses);
    await deleteIds("diagnostico", "id_estudiante", ids.students);
    await deleteIds("diagnostico", "id_usuario_creador", userIds);
    await deleteIds("observacion", "id_observacion", ids.observations);
    await deleteIds("observacion", "id_estudiante", ids.students);
    await deleteIds("observacion", "id_usuario_autor", userIds);
    await deleteIds("observacion", "id_docente", ids.teachers);
    await deleteIds("seguimiento", "id_seguimiento", ids.followUps);
    await deleteIds("seguimiento", "id_estudiante", ids.students);
    await deleteIds("seguimiento", "id_usuario_responsable", userIds);
    await deleteIds("reporte", "id_usuario", userIds);
    await deleteIds("piar_ajuste_evidencia", "id_evidencia", ids.evidences || []);
    await deleteIds("piar_ajuste_evidencia", "id_usuario_autor", userIds);
    for (const [piarId, teacherId] of ids.assignments) {
        await db.execute("DELETE FROM piar_docente WHERE id_piar = ? AND id_docente = ?", [piarId, teacherId]);
    }
    await deleteIds("piar_docente", "id_docente", ids.teachers);
    await deleteIds("piar_ajuste", "id_ajuste", ids.adjustments || []);
    await deleteIds("piar_ajuste", "id_usuario_responsable", userIds);
    await deleteIds("piar_barrera", "id_barrera", ids.barriers || []);
    await deleteIds("piar_barrera", "id_usuario_registro", userIds);
    if (ids.piars.length) {
        const placeholders = ids.piars.map(() => "?").join(",");
        // Version history belongs to the synthetic PIAR fixture and must be
        // removed before its parent PIAR rows to satisfy fk_historial_piar.
        await db.execute(
            `DELETE hd FROM historial_detalle hd INNER JOIN historial h ON h.id_historial = hd.id_historial WHERE h.id_piar IN (${placeholders})`,
            ids.piars
        );
        await db.execute(`DELETE FROM historial WHERE id_piar IN (${placeholders})`, ids.piars);
    }
    // DUA (migración 013): hijo de piar y de usuario; hoy la prueba no crea DUA, pero
    // la limpieza no debe bloquearse si una prueba futura lo hace.
    await deleteIds("piar_dua", "id_piar", ids.piars);
    await deleteIds("piar_dua", "id_usuario_registro", userIds);
    await deleteIds("piar", "id_usuario_creador", userIds);
    // Guarded like deleteIds: a fixture that failed before creating users must not
    // produce "IN ()" and mask the original error.
    if (userIds.length) {
        await db.execute(
            `UPDATE usuario SET aprobado_por_usuario_id = NULL WHERE id_usuario IN (${userIds.map(() => "?").join(",")}) AND aprobado_por_usuario_id IN (${userIds.map(() => "?").join(",")})`,
            [...userIds, ...userIds]
        );
        await db.execute(
            `UPDATE usuario SET rechazado_por_usuario_id = NULL WHERE id_usuario IN (${userIds.map(() => "?").join(",")}) AND rechazado_por_usuario_id IN (${userIds.map(() => "?").join(",")})`,
            [...userIds, ...userIds]
        );
    }
    await deleteIds("piar", "id_piar", ids.piars);
    await deleteIds("observacion", "id_docente", ids.teachers);
    await deleteIds("piar_docente", "id_docente", ids.teachers);
    await deleteIds("docente", "id_usuario", userIds);
    await deleteIds("docente", "id_docente", ids.teachers);
    await deleteIds("estudiante", "id_estudiante", ids.students);
    await deleteIds("usuario", "id_usuario", userIds);
    await db.commit();
    } catch (error) {
        await db.rollback();
        throw error;
    }
}

test("integración HTTP y SQL aislada en piar_test", async t => {
    assertTestEnvironment();
    await assertPortFree(8081);

    let db;
    let backend;
    let mailServer;
    let fixture;
    try {
        db = await mysql.createConnection(mysqlConnectionConfig(process.env.DB_PASSWORD, process.env.PIAR_TEST_PROFILE || "existing"));
    } catch (error) {
        throw new Error(`Conexión de preflight a MySQL denegada (${error.code || "ERROR"}); no se escribieron datos.`);
    }

    try {
        await assertSafeDatabaseIdentityAndGrants(db);

        const [tableRows] = await db.execute(
            "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"
        );
        const tables = new Set(tableRows.map(row => row.TABLE_NAME));
        const missing = REQUIRED_TABLES.filter(name => !tables.has(name));
        assert.deepEqual(missing, [], "Faltan tablas requeridas; no se ejecutarán escrituras ni migraciones automáticas.");
        await assertRequiredSchema(db);
        await assertFixtureRolesAllowed(db);

        const marker = `IT${crypto.randomBytes(8).toString("hex")}`;
        fixture = {
            marker,
            users: {},
            ids: {
                users: [], students: [], teachers: [], piars: [], diagnoses: [],
                observations: [], followUps: [], assignments: [], adjustments: [], barriers: [], evidences: []
            }
        };
        await assertNoRetainedSyntheticFixtureUsers(db);
        await makeFixture(db, fixture);
        const deliverySecret = crypto.randomBytes(32).toString("hex");
        const deliveredMessages = [];
        let rejectDelivery = false;
        mailServer = http.createServer(async (request, response) => {
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            if (request.headers.authorization !== `Bearer ${deliverySecret}`) {
                response.writeHead(401).end();
                return;
            }
            let message;
            try { message = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
            catch { response.writeHead(400).end(); return; }
            if (rejectDelivery) { response.writeHead(503).end(); return; }
            deliveredMessages.push(message);
            response.writeHead(202).end();
        });
        await new Promise((resolve, reject) => {
            mailServer.once("error", reject);
            mailServer.listen(0, "127.0.0.1", resolve);
        });
        const mailPort = mailServer.address().port;
        const childEnv = {
            ...integrationEnvironment(process.env, process.env.DB_PASSWORD, process.env.PIAR_TEST_PROFILE || "existing"),
            NODE_ENV: "test",
            APP_BASE_URL: API_ORIGIN,
            PASSWORD_RESET_DELIVERY_URL: `http://127.0.0.1:${mailPort}`,
            PASSWORD_RESET_DELIVERY_SECRET: deliverySecret
        };
        backend = spawn(process.execPath, [path.join(ROOT, "backend", "server.js")], {
            cwd: ROOT,
            env: childEnv,
            stdio: "ignore",
            windowsHide: true
        });
        await waitForApi(backend);

        const login = async user => {
            const result = await fetchJson("/api/auth/login", { method: "POST", body: { correo: user.email, password: user.password } });
            assert.equal(result.status, 200, "El usuario sintético debe poder iniciar sesión.");
            return cookieFrom(result.response);
        };
        const waitForAuditEvent = async (actorId, resource, resourceId, status) => {
            for (let attempt = 0; attempt < 40; attempt += 1) {
                const [rows] = await db.execute(
                    "SELECT actor_user_id, action, resource_type, resource_id, result, http_status FROM piar_auditoria WHERE actor_user_id = ? AND resource_type = ? AND resource_id = ? AND http_status = ? ORDER BY id_evento DESC LIMIT 1",
                    [actorId, resource, resourceId, status]
                );
                if (rows.length) return rows[0];
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            assert.fail("No llegó el evento de auditoría esperado.");
        };
        let adminCookie = await login(fixture.users.Administrador0);
        const rectorCookie = await login(fixture.users.Rector1);
        const coordinatorCookie = await login(fixture.users.Coordinador2);
        const psychologistCookie = await login(fixture.users["Psicóloga3"]);
        const teacherCookie = await login(fixture.users.Docente4);
        const otherTeacherCookie = await login(fixture.users.Docente5);
        const unlinkedTeacherCookie = await login(fixture.users.Docente6);
        await t.test("password reset delivery and public responses", async () => {
            const known = fixture.users.Administrador0;
            const knownResult = await fetchJson("/api/auth/password-reset/request", { method: "POST", body: { correo: known.email } });
            const unknownResult = await fetchJson("/api/auth/password-reset/request", { method: "POST", body: { correo: `unknown-${marker}@example.invalid` } });
            assert.equal(knownResult.status, 200);
            assert.deepEqual(knownResult.payload, unknownResult.payload);
            const message = deliveredMessages.findLast(item => item.to === known.email && item.subject === "Recuperación de contraseña PIAR");
            assert.ok(message, "Known account should reach the local mail test server.");
            const token = message.text.match(/#reset=([A-Za-z0-9_-]+)/)?.[1];
            assert.ok(token);
            const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
            const [stored] = await db.execute("SELECT token_hash, consumed_at FROM recuperacion_contrasena WHERE token_hash = ?", [tokenHash]);
            assert.equal(stored[0]?.token_hash, tokenHash);
            assert.equal(stored[0]?.consumed_at, null);

            rejectDelivery = true;
            const failed = await fetchJson("/api/auth/password-reset/request", { method: "POST", body: { correo: fixture.users.Rector1.email } });
            rejectDelivery = false;
            assert.equal(failed.status, 200);
            assert.deepEqual(failed.payload, unknownResult.payload);
            const [consumed] = await db.execute("SELECT consumed_at FROM recuperacion_contrasena WHERE id_usuario = ? ORDER BY id_recuperacion DESC LIMIT 1", [fixture.users.Rector1.id]);
            assert.ok(consumed[0]?.consumed_at);
        });
        await t.test("autenticación, cookies inválidas y protección institucional", async () => {
            assert.equal((await fetchJson("/api/estudiantes")).status, 401);
            assert.equal((await fetchJson("/api/auth/me")).status, 401);
            assert.equal((await fetchJson("/api/estudiantes", { cookie: "piar_session=%E0%A4%A" })).status, 401);
        });

        await t.test("restablecimiento HTTP consume token sintético y revoca sesiones", async () => {
            const target = fixture.users.Administrador0;
            const token = crypto.randomBytes(32).toString("base64url");
            const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
            const [inserted] = await db.execute(
                "INSERT INTO recuperacion_contrasena (id_usuario, token_hash, expires_at) VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 30 MINUTE))",
                [target.id, tokenHash]
            );
            const resetId = insertId(inserted);
            const replacementPassword = `Synthetic-Reset-${crypto.randomBytes(18).toString("hex")}`;
            const reset = await fetchJson("/api/auth/password-reset/confirm", {
                method: "POST", body: { token, password: replacementPassword }
            });
            assert.equal(reset.status, 200);
            assert.ok(!JSON.stringify(reset.payload).includes(token), "La respuesta no debe revelar el token.");
            const [storedToken] = await db.execute("SELECT token_hash, consumed_at FROM recuperacion_contrasena WHERE id_recuperacion = ?", [resetId]);
            assert.equal(storedToken[0]?.token_hash, tokenHash);
            assert.ok(storedToken[0]?.consumed_at);
            const [sessions] = await db.execute("SELECT revoked_at FROM sesion_usuario WHERE id_usuario = ?", [target.id]);
            assert.ok(sessions.length > 0 && sessions.every(row => row.revoked_at), "Todas las sesiones deben quedar revocadas.");
            assert.equal((await fetchJson("/api/auth/password-reset/confirm", {
                method: "POST", body: { token, password: replacementPassword }
            })).status, 400, "El token consumido no debe poder reutilizarse.");
            const replacementLogin = await fetchJson("/api/auth/login", {
                method: "POST", body: { correo: target.email, password: replacementPassword }
            });
            assert.equal(replacementLogin.status, 200);
            assert.equal((await fetchJson("/api/auth/me", { cookie: adminCookie })).status, 401);
            adminCookie = cookieFrom(replacementLogin.response);
            assert.equal((await fetchJson("/api/auth/me", { cookie: adminCookie })).status, 200);
        });

        await t.test("Estudiante HTTP (no representable por el ENUM local)", {
            skip: "Cubierta en tests/e2e-flujos.test.js: alta institucional de la cuenta Estudiante (D7), verificación, cambio de contraseña temporal y aislamiento de su PIAR contra MySQL; también en tests/student-portal.test.js y tests/authorization.test.js."
        }, async () => {});

        await t.test("permisos institucionales y alcance docente por asignación", async () => {
            assert.equal((await fetchJson("/api/usuarios", { cookie: rectorCookie })).status, 403);
            assert.equal((await fetchJson("/api/usuarios", { cookie: coordinatorCookie })).status, 403);
            assert.equal((await fetchJson("/api/usuarios", { cookie: teacherCookie })).status, 403);
            assert.equal((await fetchJson("/api/diagnosticos", { method: "POST", cookie: teacherCookie, body: {} })).status, 403);
            assert.equal((await fetchJson("/api/observaciones", {
                method: "POST", cookie: unlinkedTeacherCookie,
                body: { id_piar: fixture.ids.piars[0], id_estudiante: fixture.ids.students[0], descripcion: "Sin perfil asignado" }
            })).status, 403);
            assert.equal((await fetchJson("/api/estudiantes", { cookie: coordinatorCookie })).status, 200);
            assert.equal((await fetchJson("/api/estudiantes", { cookie: teacherCookie })).status, 200);
            const teacherStudents = await fetchJson("/api/estudiantes", { cookie: teacherCookie });
            const teacherStudentRows = Array.isArray(teacherStudents.payload) ? teacherStudents.payload : teacherStudents.payload.data;
            assert.ok(teacherStudentRows.every(row => Number(row.id) === fixture.ids.students[0]));
            assert.equal((await fetchJson("/api/estudiantes", { cookie: unlinkedTeacherCookie })).status, 403);

            assert.equal((await fetchJson(`/api/estudiantes/${fixture.ids.students[0]}`, { cookie: teacherCookie })).status, 200);
            assert.equal((await fetchJson(`/api/estudiantes/${fixture.ids.students[1]}`, { cookie: teacherCookie })).status, 404);
            const deniedAudit = await waitForAuditEvent(fixture.users.Docente4.id, "estudiantes", fixture.ids.students[1], 404);
            assert.equal(deniedAudit.result, "denied");
            assert.equal(deniedAudit.action, "GET");
            assert.equal((await fetchJson(`/api/piar/${fixture.ids.piars[0]}`, { cookie: teacherCookie })).status, 200);
            assert.equal((await fetchJson(`/api/piar/${fixture.ids.piars[1]}`, { cookie: teacherCookie })).status, 404);
            const teacherPiars = await fetchJson("/api/piar", { cookie: teacherCookie });
            assert.equal(teacherPiars.status, 200);
            assert.ok(teacherPiars.payload.data.some(row => Number(row.id_piar) === fixture.ids.piars[0]));
            assert.ok(!teacherPiars.payload.data.some(row => Number(row.id_piar) === fixture.ids.piars[1]));

            const foreignPiarPayload = {
                id_estudiante: fixture.ids.students[1], titulo: `${fixture.marker}PIAR ajeno`,
                periodo: "Prueba", anio: 2026, teacherId: fixture.ids.teachers[0]
            };
            const foreignPiar = await fetchJson("/api/piar", { method: "POST", cookie: teacherCookie, body: foreignPiarPayload });
            const unknownPiar = await fetchJson("/api/piar", {
                method: "POST", cookie: teacherCookie,
                body: { ...foreignPiarPayload, id_estudiante: 2147483000 }
            });
            assert.equal(foreignPiar.status, 404);
            assert.deepEqual(foreignPiar.payload, unknownPiar.payload, "La denegación no debe revelar si existe un estudiante fuera de alcance.");
            const nextPiar = await fetchJson("/api/piar", {
                method: "POST", cookie: teacherCookie,
                body: {
                    id_estudiante: fixture.ids.students[0], titulo: `${fixture.marker}PIAR siguiente`,
                    periodo: "Prueba", anio: 2027, teacherId: fixture.ids.teachers[0]
                }
            });
            assert.equal(nextPiar.status, 201);
            fixture.ids.piars.push(Number(nextPiar.payload.data.id_piar));
            fixture.ids.assignments.push([Number(nextPiar.payload.data.id_piar), fixture.ids.teachers[0]]);
            assert.equal((await fetchJson(`/api/piar/${fixture.ids.piars[0]}`, { method: "PUT", cookie: teacherCookie, body: { titulo: `${fixture.marker} ajuste docente`, justificacion: "Corrección pedagógica" } })).status, 200);
            assert.equal((await fetchJson(`/api/piar/${fixture.ids.piars[0]}`, { cookie: otherTeacherCookie })).status, 404);
        });

        await t.test("creación, actualización, cierre y asignación de PIAR con Coordinador", async () => {
            const invalid = await fetchJson("/api/piar", { method: "POST", cookie: coordinatorCookie, body: { id_estudiante: fixture.ids.students[0] } });
            assert.equal(invalid.status, 400);
            const created = await fetchJson("/api/piar", {
                method: "POST", cookie: coordinatorCookie,
                body: { id_estudiante: fixture.ids.students[0], titulo: `${fixture.marker}API`, periodo: "Prueba", anio: 2026, teacherId: fixture.ids.teachers[1] }
            });
            assert.equal(created.status, 201);
            const createdPiar = Number(created.payload.data.id_piar);
            fixture.ids.piars.push(createdPiar);
            fixture.ids.assignments.push([createdPiar, fixture.ids.teachers[1]]);
            const teacherAfterAssignment = otherTeacherCookie;
            assert.equal((await fetchJson(`/api/piar/${createdPiar}`, { cookie: teacherAfterAssignment })).status, 200);

            const addedAssignment = await fetchJson(`/api/piar/${createdPiar}/docentes`, {
                method: "POST", cookie: coordinatorCookie,
                body: { id_docente: fixture.ids.teachers[0], es_responsable_principal: false, justificacion: "Asignación de apoyo" }
            });
            assert.equal(addedAssignment.status, 201);
            const assignmentVersion = await fetchJson(`/api/piar/${createdPiar}/versiones/${addedAssignment.payload.data.version_id}`, { cookie: teacherAfterAssignment });
            assert.equal(assignmentVersion.status, 200);
            assert.equal(assignmentVersion.payload.data.tipo_operacion, "piar_version:docente_asignado");
            assert.ok(assignmentVersion.payload.data.valor_nuevo.docentes.some(row => Number(row.id_docente) === fixture.ids.teachers[0]));
            const removedAssignment = await fetchJson(`/api/piar/${createdPiar}/docentes`, {
                method: "DELETE", cookie: coordinatorCookie, body: { id_docente: fixture.ids.teachers[0], justificacion: "Fin de asignación temporal" }
            });
            assert.equal(removedAssignment.status, 200);
            const removalVersion = await fetchJson(`/api/piar/${createdPiar}/versiones/${removedAssignment.payload.data.version_id}`, { cookie: teacherAfterAssignment });
            assert.equal(removalVersion.payload.data.tipo_operacion, "piar_version:docente_retirado");

            {
                const assignment = await fetchJson(`/api/piar/${fixture.ids.piars[0]}/docentes`, {
                    method: "POST", cookie: coordinatorCookie, body: { id_docente: fixture.ids.teachers[1] }
                });
                assert.equal(assignment.status, 201);
                fixture.ids.assignments.push([fixture.ids.piars[0], fixture.ids.teachers[1]]);
                assert.equal((await fetchJson(`/api/piar/${fixture.ids.piars[0]}/docentes`, {
                    method: "POST", cookie: coordinatorCookie, body: { id_docente: fixture.ids.teachers[1] }
                })).status, 409);
                assert.equal((await fetchJson(`/api/piar/${fixture.ids.piars[0]}/docentes`, {
                    method: "DELETE", cookie: coordinatorCookie, body: { id_docente: fixture.ids.teachers[1] }
                })).status, 200);
                fixture.ids.assignments = fixture.ids.assignments.filter(pair => !(pair[0] === fixture.ids.piars[0] && pair[1] === fixture.ids.teachers[1]));
                assert.equal((await fetchJson(`/api/piar/${fixture.ids.piars[0]}/docentes`, {
                    method: "DELETE", cookie: coordinatorCookie, body: { id_docente: fixture.ids.teachers[1] }
                })).status, 404);
            }
            assert.equal((await fetchJson(`/api/piar/${fixture.ids.piars[0]}/docentes`, {
                method: "POST", cookie: coordinatorCookie, body: { id_docente: -1 }
            })).status, 400);

            assert.equal((await fetchJson(`/api/piar/${createdPiar}`, {
                method: "PUT", cookie: coordinatorCookie, body: { objetivo_general: "Actualización sintética", justificacion: "Corrección de contenido" }
            })).status, 200);
            const unchangedPiar = await fetchJson(`/api/piar/${createdPiar}`, {
                method: "PUT", cookie: coordinatorCookie, body: { objetivo_general: "Actualización sintética", justificacion: "Verificación de actualización" }
            });
            assert.equal(unchangedPiar.status, 200);
            assert.equal(unchangedPiar.payload.data.unchanged, true);
            const [updated] = await db.execute("SELECT objetivo_general FROM piar WHERE id_piar = ?", [createdPiar]);
            assert.equal(updated[0]?.objetivo_general, "Actualización sintética");
            const versions = await fetchJson(`/api/piar/${createdPiar}/versiones`, { cookie: teacherAfterAssignment });
            assert.equal(versions.status, 200);
            const contentVersions = versions.payload.data.filter(row => row.tipo_operacion === "piar_version:actualizacion_piar");
            assert.equal(contentVersions.length, 1, "una actualización sin cambios no crea una versión duplicada");
            const versionId = Number(contentVersions[0].version_id);
            assert.equal(contentVersions[0].justificacion, "Corrección de contenido");
            const version = await fetchJson(`/api/piar/${createdPiar}/versiones/${versionId}`, { cookie: teacherAfterAssignment });
            assert.equal(version.status, 200);
            assert.equal(version.payload.data.valor_anterior.piar.objetivo_general, null);
            assert.equal(version.payload.data.valor_nuevo.piar.objetivo_general, "Actualización sintética");
            assert.equal((await fetchJson(`/api/piar/${createdPiar}/versiones/${versionId}`, { cookie: teacherCookie })).status, 404);

            assert.equal((await fetchJson(`/api/piar/${createdPiar}`, { method: "DELETE", cookie: coordinatorCookie, body: { justificacion: "Cierre del periodo" } })).status, 200);
            const [closed] = await db.execute("SELECT estado FROM piar WHERE id_piar = ?", [createdPiar]);
            assert.equal(closed[0]?.estado, "cerrado");
            assert.equal((await fetchJson(`/api/piar/${createdPiar}`, { method: "PUT", cookie: teacherAfterAssignment, body: { titulo: "Edición prohibida", justificacion: "Intento" } })).status, 409);
            assert.equal((await fetchJson(`/api/piar/${createdPiar}/reapertura`, { method: "POST", cookie: rectorCookie, body: { justificacion: "Sin permiso" } })).status, 403);
            assert.equal((await fetchJson(`/api/piar/${createdPiar}/reapertura`, { method: "POST", cookie: teacherAfterAssignment, body: { justificacion: "Sin permiso" } })).status, 403);
            const reopened = await fetchJson(`/api/piar/${createdPiar}/reapertura`, { method: "POST", cookie: coordinatorCookie, body: { justificacion: "Corrección requerida" } });
            assert.equal(reopened.status, 200);
            assert.equal(reopened.payload.data.estado, "revision");
            const [reopenedRow] = await db.execute("SELECT estado, fecha_cierre FROM piar WHERE id_piar = ?", [createdPiar]);
            assert.equal(reopenedRow[0]?.estado, "revision");
            assert.equal(reopenedRow[0]?.fecha_cierre, null);
        });

        await t.test("trazabilidad pedagógica: barrera, ajuste, evidencia y seguimiento del mismo PIAR", async () => {
            assert.equal((await fetchJson(`/api/piar/${fixture.ids.piars[0]}`, {
                method: "PUT", cookie: otherTeacherCookie, body: { objetivo_general: "Debe denegarse" }
            })).status, 404, "El docente no asignado no puede modificar el PIAR.");
            assert.equal((await fetchJson("/api/seguimientos", {
                method: "POST", cookie: otherTeacherCookie,
                body: { id_piar: fixture.ids.piars[0], id_estudiante: fixture.ids.students[0], fecha: "2026-01-02", descripcion: "Debe denegarse" }
            })).status, 403, "El docente no asignado no puede agregar seguimientos al PIAR.");

            const barrier = await fetchJson(`/api/piar/${fixture.ids.piars[0]}/barreras`, {
                method: "POST", cookie: teacherCookie,
                body: { contexto: "aula", descripcion: `${fixture.marker} instrucciones solo orales`, actividad: "Lectura", condicion_entorno: "Sin apoyo visual", fecha_identificacion: "2026-01-02" }
            });
            assert.equal(barrier.status, 201);
            const barrierId = Number(barrier.payload.data.id_barrera);
            fixture.ids.barriers.push(barrierId);
            const barrierVersion = await fetchJson(`/api/piar/${fixture.ids.piars[0]}/versiones/${barrier.payload.data.version_id}`, { cookie: teacherCookie });
            assert.equal(barrierVersion.status, 200);
            assert.equal(barrierVersion.payload.data.tipo_operacion, "piar_version:barrera_creada");
            assert.ok(barrierVersion.payload.data.valor_nuevo.barreras.some(row => Number(row.id_barrera) === barrierId));
            assert.equal((await fetchJson(`/api/piar/${fixture.ids.piars[0]}/barreras`, { cookie: teacherCookie })).payload.data.some(row => Number(row.id_barrera) === barrierId), true);
            assert.equal((await fetchJson(`/api/piar/${fixture.ids.piars[1]}/barreras`, { cookie: teacherCookie })).status, 404);
            assert.equal((await fetchJson(`/api/piar/${fixture.ids.piars[0]}/barreras`, {
                method: "POST", cookie: otherTeacherCookie,
                body: { contexto: "aula", descripcion: "Debe denegarse", fecha_identificacion: "2026-01-02" }
            })).status, 404);

            const malformedBarrier = await fetchJson(`/api/piar/${fixture.ids.piars[0]}/barreras`, {
                method: "POST", cookie: teacherCookie,
                body: { contexto: "clínico", descripcion: "No es contexto válido", fecha_identificacion: "2026-02-31" }
            });
            assert.equal(malformedBarrier.status, 400);

            const adjustment = await fetchJson(`/api/piar/${fixture.ids.piars[0]}/ajustes`, {
                method: "POST", cookie: teacherCookie,
                body: {
                    id_barrera: barrierId, id_usuario_responsable: fixture.users.Docente4.id,
                    area: "Lenguaje", tipo: "Didáctico", estrategia: `${fixture.marker} guía visual`, recursos: "Tarjetas",
                    resultado_esperado: "Participa en lectura", indicador_logro: "Responde 4 de 5 preguntas",
                    fecha_revision_prevista: "2026-02-02", avance: 0
                }
            });
            assert.equal(adjustment.status, 201);
            const adjustmentId = Number(adjustment.payload.data.id_ajuste);
            fixture.ids.adjustments.push(adjustmentId);
            const adjustmentVersion = await fetchJson(`/api/piar/${fixture.ids.piars[0]}/versiones/${adjustment.payload.data.version_id}`, { cookie: teacherCookie });
            assert.equal(adjustmentVersion.payload.data.tipo_operacion, "piar_version:ajuste_creado");
            assert.ok(adjustmentVersion.payload.data.valor_nuevo.ajustes.some(row => Number(row.id_ajuste) === adjustmentId));
            const adjustmentUpdate = await fetchJson(`/api/piar/${fixture.ids.piars[0]}/ajustes/${adjustmentId}`, {
                method: "PUT", cookie: teacherCookie, body: { avance: 25, justificacion: "Seguimiento del avance" }
            });
            assert.equal(adjustmentUpdate.status, 200);
            const updatedAdjustmentVersion = await fetchJson(`/api/piar/${fixture.ids.piars[0]}/versiones/${adjustmentUpdate.payload.data.version_id}`, { cookie: teacherCookie });
            assert.equal(updatedAdjustmentVersion.payload.data.tipo_operacion, "piar_version:ajuste_actualizado");
            assert.equal(Number(updatedAdjustmentVersion.payload.data.valor_nuevo.ajustes.find(row => Number(row.id_ajuste) === adjustmentId).avance), 25);

            const crossPiarAdjustment = await fetchJson(`/api/piar/${fixture.ids.piars[1]}/ajustes`, {
                method: "POST", cookie: coordinatorCookie,
                body: { id_barrera: barrierId, area: "Lenguaje", tipo: "Didáctico", estrategia: "No debe cruzar PIAR" }
            });
            assert.equal(crossPiarAdjustment.status, 400);

            const evidence = await fetchJson(`/api/piar/${fixture.ids.piars[0]}/ajustes/${adjustmentId}/evidencias`, {
                method: "POST", cookie: teacherCookie,
                body: { descripcion: `${fixture.marker} material visual aplicado`, referencia: "Registro de aula", fecha: "2026-01-03" }
            });
            assert.equal(evidence.status, 201);
            fixture.ids.evidences.push(Number(evidence.payload.data.id_evidencia));
            const evidenceVersion = await fetchJson(`/api/piar/${fixture.ids.piars[0]}/versiones/${evidence.payload.data.version_id}`, { cookie: teacherCookie });
            assert.equal(evidenceVersion.payload.data.tipo_operacion, "piar_version:evidencia_creada");
            assert.ok(evidenceVersion.payload.data.valor_nuevo.ajustes.find(row => Number(row.id_ajuste) === adjustmentId).evidencias.some(row => Number(row.id_evidencia) === Number(evidence.payload.data.id_evidencia)));
            assert.equal((await fetchJson(`/api/piar/${fixture.ids.piars[0]}/ajustes/${adjustmentId}/evidencias`, { cookie: teacherCookie })).payload.data.length, 1);
            assert.equal((await fetchJson(`/api/piar/${fixture.ids.piars[1]}/ajustes/${adjustmentId}/evidencias`, { cookie: otherTeacherCookie })).status, 404);
            assert.equal((await fetchJson(`/api/piar/${fixture.ids.piars[0]}/ajustes/${adjustmentId}/evidencias`, {
                method: "POST", cookie: otherTeacherCookie,
                body: { descripcion: "Debe denegarse", fecha: "2026-01-03" }
            })).status, 404);

            const followUp = await fetchJson("/api/seguimientos", {
                method: "POST", cookie: teacherCookie,
                body: { id_piar: fixture.ids.piars[0], id_ajuste: adjustmentId, id_estudiante: fixture.ids.students[0], fecha: "2026-02-02", descripcion: "Resultado observado", evolucion: "Avance esperado", acuerdos: "Mantener apoyo" }
            });
            assert.equal(followUp.status, 201);
            fixture.ids.followUps.push(Number(followUp.payload.data.id));
            const followUpVersion = await fetchJson(`/api/piar/${fixture.ids.piars[0]}/versiones/${followUp.payload.data.version_id}`, { cookie: teacherCookie });
            assert.equal(followUpVersion.payload.data.tipo_operacion, "piar_version:seguimiento_creado");
            assert.ok(followUpVersion.payload.data.valor_nuevo.seguimientos.some(row => Number(row.id_seguimiento) === Number(followUp.payload.data.id)));
            const wrongFollowUp = await fetchJson("/api/seguimientos", {
                method: "POST", cookie: coordinatorCookie,
                body: { id_piar: fixture.ids.piars[1], id_ajuste: adjustmentId, id_estudiante: fixture.ids.students[1], fecha: "2026-02-02", descripcion: "Relación cruzada" }
            });
            assert.equal(wrongFollowUp.status, 400);

            const detail = await fetchJson(`/api/piar/${fixture.ids.piars[0]}`, { cookie: teacherCookie });
            assert.equal(detail.status, 200);
            assert.equal(detail.payload.data.barreras.some(row => Number(row.id_barrera) === barrierId), true);
            const tracedAdjustment = detail.payload.data.ajustes.find(row => Number(row.id_ajuste) === adjustmentId);
            assert.equal(Number(tracedAdjustment.id_barrera), barrierId);
            assert.equal(tracedAdjustment.evidencias.length, 1);
            assert.equal(detail.payload.data.seguimientos.some(row => Number(row.id_ajuste) === adjustmentId), true);
            const protectedDelete = await fetchJson(`/api/piar/${fixture.ids.piars[0]}/ajustes/${adjustmentId}`, { method: "DELETE", cookie: coordinatorCookie });
            assert.equal(protectedDelete.status, 409, "La traza existente debe impedir eliminar el ajuste relacionado.");
            const protectedUpdate = await fetchJson(`/api/piar/${fixture.ids.piars[0]}/ajustes/${adjustmentId}`, {
                method: "PUT", cookie: coordinatorCookie, body: { estrategia: "No debe reemplazar una traza histórica" }
            });
            assert.equal(protectedUpdate.status, 409, "La traza existente debe impedir reescribir el ajuste relacionado.");
        });

        await t.test("diagnósticos: permisos, relación estudiante/PIAR y alcance", async () => {
            const mismatch = await fetchJson("/api/diagnosticos", {
                method: "POST", cookie: coordinatorCookie,
                body: { tipo_diagnostico: "Sintético", fecha: "2026-01-02", descripcion: "Prueba sintética", id_estudiante: fixture.ids.students[1], id_piar: fixture.ids.piars[0] }
            });
            assert.equal(mismatch.status, 400);
            assert.equal((await fetchJson("/api/diagnosticos", {
                method: "POST", cookie: teacherCookie, body: {}
            })).status, 403);

            const created = await fetchJson("/api/diagnosticos", {
                method: "POST", cookie: coordinatorCookie,
                body: { tipo_diagnostico: "Sintético", fecha: "2026-01-02", descripcion: `${fixture.marker} diagnóstico`, id_estudiante: fixture.ids.students[0], id_piar: fixture.ids.piars[0] }
            });
            assert.equal(created.status, 201);
            const diagnosisId = Number(created.payload.data.id);
            fixture.ids.diagnoses.push(diagnosisId);
            const diagnosisVersion = await fetchJson(`/api/piar/${fixture.ids.piars[0]}/versiones/${created.payload.data.version_id}`, { cookie: teacherCookie });
            assert.equal(diagnosisVersion.payload.data.tipo_operacion, "piar_version:diagnostico_creado");
            assert.ok(diagnosisVersion.payload.data.valor_nuevo.diagnosticos.some(row => Number(row.id_diagnostico) === diagnosisId));
            const [stored] = await db.execute("SELECT id_estudiante, id_piar FROM diagnostico WHERE id_diagnostico = ?", [diagnosisId]);
            assert.equal(Number(stored[0]?.id_estudiante), fixture.ids.students[0]);
            assert.equal(Number(stored[0]?.id_piar), fixture.ids.piars[0]);
            assert.equal((await fetchJson(`/api/diagnosticos/${diagnosisId}`, { cookie: teacherCookie })).status, 200);
            assert.equal((await fetchJson(`/api/diagnosticos/${diagnosisId}`, { cookie: otherTeacherCookie })).status, 404);
            // Psicóloga has institution-wide read scope for diagnoses.
            assert.equal((await fetchJson(`/api/diagnosticos/${diagnosisId}`, { cookie: psychologistCookie })).status, 200);

            const foreignDiagnosis = await fetchJson("/api/diagnosticos", {
                method: "POST", cookie: coordinatorCookie,
                body: { tipo_diagnostico: "Sintético", fecha: "2026-01-03", descripcion: `${fixture.marker} diagnóstico ajeno`, id_estudiante: fixture.ids.students[1], id_piar: fixture.ids.piars[1] }
            });
            assert.equal(foreignDiagnosis.status, 201);
            const foreignDiagnosisId = Number(foreignDiagnosis.payload.data.id);
            fixture.ids.diagnoses.push(foreignDiagnosisId);
            assert.equal((await fetchJson(`/api/diagnosticos/${foreignDiagnosisId}`, { cookie: teacherCookie })).status, 404);
            const teacherDiagnoses = await fetchJson("/api/diagnosticos", { cookie: teacherCookie });
            assert.equal(teacherDiagnoses.status, 200);
            assert.ok(teacherDiagnoses.payload.data.some(row => Number(row.id_diagnostico) === diagnosisId));
            assert.ok(!teacherDiagnoses.payload.data.some(row => Number(row.id_diagnostico) === foreignDiagnosisId));

            const relationUpdate = await fetchJson(`/api/diagnosticos/${diagnosisId}`, {
                method: "PUT", cookie: coordinatorCookie,
                body: { id_estudiante: fixture.ids.students[1], id_piar: fixture.ids.piars[0] }
            });
            assert.equal(relationUpdate.status, 400);
            assert.equal((await fetchJson(`/api/diagnosticos/${diagnosisId}`, {
                method: "PUT", cookie: psychologistCookie, body: { descripcion: "Actualización sintética" }
            })).status, 200);
            assert.equal((await fetchJson(`/api/diagnosticos/${diagnosisId}`, { method: "DELETE", cookie: psychologistCookie })).status, 403);
            const diagnosisUpdate = await fetchJson(`/api/diagnosticos/${diagnosisId}`, {
                method: "PUT", cookie: coordinatorCookie, body: { descripcion: "Actualización institucional" }
            });
            assert.equal(diagnosisUpdate.status, 200);
            const diagnosisUpdateVersion = await fetchJson(`/api/piar/${fixture.ids.piars[0]}/versiones/${diagnosisUpdate.payload.data.version_ids[fixture.ids.piars[0]]}`, { cookie: teacherCookie });
            assert.equal(diagnosisUpdateVersion.payload.data.tipo_operacion, "piar_version:diagnostico_actualizado");
            assert.equal((await fetchJson(`/api/diagnosticos/${diagnosisId}`, {
                method: "DELETE", cookie: coordinatorCookie
            })).status, 200);
            const diagnosisHistory = await fetchJson(`/api/piar/${fixture.ids.piars[0]}/versiones`, { cookie: teacherCookie });
            const diagnosisDeletion = diagnosisHistory.payload.data.find(row => row.tipo_operacion === "piar_version:diagnostico_eliminado");
            assert.ok(diagnosisDeletion);
            const diagnosisDeletionVersion = await fetchJson(`/api/piar/${fixture.ids.piars[0]}/versiones/${diagnosisDeletion.version_id}`, { cookie: teacherCookie });
            assert.ok(diagnosisDeletionVersion.payload.data.valor_anterior.diagnosticos.some(row => Number(row.id_diagnostico) === diagnosisId));
            assert.ok(!diagnosisDeletionVersion.payload.data.valor_nuevo.diagnosticos.some(row => Number(row.id_diagnostico) === diagnosisId));
            assert.equal((await fetchJson(`/api/diagnosticos/${diagnosisId}`, { cookie: coordinatorCookie })).status, 404);
            assert.equal((await fetchJson("/api/diagnosticos/2147483000", { cookie: coordinatorCookie })).status, 404);
        });

        await t.test("observaciones y seguimientos: alcance, persistencia e inmutabilidad", async () => {
            const rejectedObservation = await fetchJson("/api/observaciones", {
                method: "POST", cookie: teacherCookie,
                body: { id_piar: fixture.ids.piars[0], id_estudiante: fixture.ids.students[1], descripcion: "Debe rechazarse" }
            });
            assert.equal(rejectedObservation.status, 403);

            const observation = await fetchJson("/api/observaciones", {
                method: "POST", cookie: teacherCookie,
                body: { id_piar: fixture.ids.piars[0], id_estudiante: fixture.ids.students[0], descripcion: `${fixture.marker} observación`, fecha: "2026-01-02" }
            });
            assert.equal(observation.status, 201);
            const observationId = Number(observation.payload.data.id);
            fixture.ids.observations.push(observationId);
            const observationVersion = await fetchJson(`/api/piar/${fixture.ids.piars[0]}/versiones/${observation.payload.data.version_id}`, { cookie: teacherCookie });
            assert.equal(observationVersion.payload.data.tipo_operacion, "piar_version:observacion_creado");
            assert.equal((await fetchJson(`/api/observaciones/${observationId}`, { cookie: teacherCookie })).status, 200);
            assert.equal((await fetchJson(`/api/observaciones/${observationId}`, { cookie: otherTeacherCookie })).status, 404);
            const teacherObservations = await fetchJson("/api/observaciones", { cookie: teacherCookie });
            assert.equal(teacherObservations.status, 200);
            assert.ok(teacherObservations.payload.data.every(row => Number(row.id_piar) === fixture.ids.piars[0]));
            const foreignObservation = await fetchJson("/api/observaciones", {
                method: "POST", cookie: coordinatorCookie,
                body: { id_piar: fixture.ids.piars[1], id_estudiante: fixture.ids.students[1], descripcion: `${fixture.marker} observación ajena`, fecha: "2026-01-03" }
            });
            assert.equal(foreignObservation.status, 201);
            const foreignObservationId = Number(foreignObservation.payload.data.id);
            fixture.ids.observations.push(foreignObservationId);
            assert.equal((await fetchJson(`/api/observaciones/${foreignObservationId}`, { cookie: teacherCookie })).status, 404);
            assert.ok(!(await fetchJson("/api/observaciones", { cookie: teacherCookie })).payload.data.some(row => Number(row.id_observacion) === foreignObservationId));
            assert.equal((await fetchJson(`/api/observaciones/${observationId}`, {
                method: "PUT", cookie: coordinatorCookie, body: { descripcion: "Intento de edición" }
            })).status, 403);
            assert.equal((await fetchJson(`/api/observaciones/${observationId}`, {
                method: "DELETE", cookie: coordinatorCookie
            })).status, 403);
            const [observationStored] = await db.execute("SELECT descripcion FROM observacion WHERE id_observacion = ?", [observationId]);
            assert.equal(observationStored[0]?.descripcion, `${fixture.marker} observación`);

            const followUp = await fetchJson("/api/seguimientos", {
                method: "POST", cookie: teacherCookie,
                body: { id_piar: fixture.ids.piars[0], id_estudiante: fixture.ids.students[0], descripcion: `${fixture.marker} seguimiento`, fecha: "2026-01-02" }
            });
            assert.equal(followUp.status, 201);
            const followUpId = Number(followUp.payload.data.id);
            fixture.ids.followUps.push(followUpId);
            const followUpVersion = await fetchJson(`/api/piar/${fixture.ids.piars[0]}/versiones/${followUp.payload.data.version_id}`, { cookie: teacherCookie });
            assert.equal(followUpVersion.payload.data.tipo_operacion, "piar_version:seguimiento_creado");
            assert.equal((await fetchJson(`/api/seguimientos/${followUpId}`, { cookie: teacherCookie })).status, 200);
            assert.equal((await fetchJson(`/api/seguimientos/${followUpId}`, { cookie: otherTeacherCookie })).status, 404);
            const teacherFollowUps = await fetchJson("/api/seguimientos", { cookie: teacherCookie });
            assert.equal(teacherFollowUps.status, 200);
            assert.ok(teacherFollowUps.payload.data.every(row => Number(row.id_piar) === fixture.ids.piars[0]));
            const foreignFollowUp = await fetchJson("/api/seguimientos", {
                method: "POST", cookie: coordinatorCookie,
                body: { id_piar: fixture.ids.piars[1], id_estudiante: fixture.ids.students[1], descripcion: `${fixture.marker} seguimiento ajeno`, fecha: "2026-01-03" }
            });
            assert.equal(foreignFollowUp.status, 201);
            const foreignFollowUpId = Number(foreignFollowUp.payload.data.id);
            fixture.ids.followUps.push(foreignFollowUpId);
            assert.equal((await fetchJson(`/api/seguimientos/${foreignFollowUpId}`, { cookie: teacherCookie })).status, 404);
            assert.ok(!(await fetchJson("/api/seguimientos", { cookie: teacherCookie })).payload.data.some(row => Number(row.id_seguimiento) === foreignFollowUpId));
            assert.equal((await fetchJson(`/api/seguimientos/${followUpId}`, {
                method: "PUT", cookie: coordinatorCookie, body: { descripcion: "Intento de edición" }
            })).status, 403);
            assert.equal((await fetchJson(`/api/seguimientos/${followUpId}`, {
                method: "DELETE", cookie: psychologistCookie
            })).status, 403);
            const [followUpStored] = await db.execute("SELECT descripcion FROM seguimiento WHERE id_seguimiento = ?", [followUpId]);
            assert.equal(followUpStored[0]?.descripcion, `${fixture.marker} seguimiento`);
        });

        await t.test("historial, reportes y dashboard docentes se limitan a PIAR asignados", async () => {
            const [ownHistory] = await db.execute("INSERT INTO historial (id_piar, id_usuario_creador, tipo_registro, descripcion) VALUES (?, ?, 'seguimiento', ?)", [fixture.ids.piars[0], fixture.users.Docente4.id, `${fixture.marker} historial propio`]);
            const [foreignHistory] = await db.execute("INSERT INTO historial (id_piar, id_usuario_creador, tipo_registro, descripcion) VALUES (?, ?, 'seguimiento', ?)", [fixture.ids.piars[1], fixture.users.Docente5.id, `${fixture.marker} historial ajeno`]);
            const ownHistoryId = insertId(ownHistory);
            const foreignHistoryId = insertId(foreignHistory);
            const [ownReport] = await db.execute("INSERT INTO reporte (id_piar, id_usuario, tipo, formato) VALUES (?, ?, 'individual', 'html')", [fixture.ids.piars[0], fixture.users.Docente4.id]);
            const [foreignReport] = await db.execute("INSERT INTO reporte (id_piar, id_usuario, tipo, formato) VALUES (?, ?, 'individual', 'html')", [fixture.ids.piars[1], fixture.users.Docente5.id]);
            const ownReportId = insertId(ownReport);
            const foreignReportId = insertId(foreignReport);
            try {
                const histories = await fetchJson("/api/historial", { cookie: teacherCookie });
                assert.equal(histories.status, 200);
                assert.ok(histories.payload.data.some(row => Number(row.id_historial) === ownHistoryId));
                assert.ok(!histories.payload.data.some(row => Number(row.id_historial) === foreignHistoryId));
                assert.equal((await fetchJson(`/api/historial/${foreignHistoryId}`, { cookie: teacherCookie })).status, 404);
                const reports = await fetchJson("/api/reportes", { cookie: teacherCookie });
                assert.equal(reports.status, 200);
                assert.ok(reports.payload.data.some(row => Number(row.id_reporte) === ownReportId));
                assert.ok(!reports.payload.data.some(row => Number(row.id_reporte) === foreignReportId));
                assert.equal((await fetchJson(`/api/reportes/${foreignReportId}`, { cookie: teacherCookie })).status, 404);
                const dashboard = await fetchJson("/api/dashboard/resumen", { cookie: teacherCookie });
                assert.equal(dashboard.status, 200);
                assert.equal(Number(dashboard.payload.data.estudiantes), 1);
                assert.equal(Number(dashboard.payload.data.docentes), 1);
            } finally {
                await db.execute("DELETE FROM historial WHERE id_historial IN (?, ?)", [ownHistoryId, foreignHistoryId]);
                await db.execute("DELETE FROM reporte WHERE id_reporte IN (?, ?)", [ownReportId, foreignReportId]);
            }
        });

        await t.test("registro público pendiente, aprobación y ciclo de sesión", async () => {
            const email = `${fixture.marker.toLowerCase()}r@example.invalid`;
            const document = `${fixture.marker}R`;
            const registrationPassword = `Synthetic-${crypto.randomBytes(18).toString("hex")}`;
            const privilegedEmail = `${fixture.marker.toLowerCase()}x@example.invalid`;
            const privilegedDocument = `${fixture.marker}X`;
            const rejectedPrivilegedRequest = await fetchJson("/api/auth/register", {
                method: "POST", body: {
                    nombre: "Synthetic", apellidos: fixture.marker, documento: privilegedDocument,
                    correo: privilegedEmail, password: registrationPassword, rol: "Administrador"
                }
            });
            assert.equal(rejectedPrivilegedRequest.status, 400);
            const [privilegedRows] = await db.execute("SELECT id_usuario FROM usuario WHERE documento = ? OR correo = ?", [privilegedDocument, privilegedEmail]);
            assert.equal(privilegedRows.length, 0, "La solicitud de un rol privilegiado no debe crear ni degradar silenciosamente una cuenta.");

            const registration = await fetchJson("/api/auth/register", {
                method: "POST", body: {
                    nombre: "Synthetic", apellidos: fixture.marker, documento: document,
                    correo: email, password: registrationPassword, rol: "Docente"
                }
            });
            assert.equal(registration.status, 202);
            const [newUsers] = await db.execute("SELECT id_usuario, rol, estado, correo_verificado_at FROM usuario WHERE documento = ? AND correo = ?", [document, email]);
            assert.equal(newUsers.length, 1);
            const registeredId = Number(newUsers[0].id_usuario);
            assert.equal(newUsers[0].rol, "Docente", "El registro público no debe conceder roles privilegiados.");
            assert.equal(newUsers[0].estado, "pendiente_verificacion");
            assert.equal(newUsers[0].correo_verificado_at, null);
            const verificationEmail = deliveredMessages.find(message => message.to === email && message.subject === "Verifica tu correo de PIAR");
            assert.ok(verificationEmail, "El correo de verificación debe llegar al proveedor local simulado.");
            const verificationToken = verificationEmail.text.match(/#verify-email=([A-Za-z0-9_-]+)/)?.[1];
            assert.ok(verificationToken);
            const verified = await fetchJson("/api/auth/email-verification/confirm", { method: "POST", body: { token: verificationToken } });
            assert.equal(verified.status, 200);
            assert.ok(!JSON.stringify(verified.payload).includes(verificationToken));
            const [verifiedUser] = await db.execute("SELECT estado, correo_verificado_at FROM usuario WHERE id_usuario = ?", [registeredId]);
            assert.equal(verifiedUser[0].estado, "pendiente");
            assert.ok(verifiedUser[0].correo_verificado_at);
            assert.equal((await fetchJson("/api/auth/email-verification/confirm", { method: "POST", body: { token: verificationToken } })).status, 400);
            assert.equal((await fetchJson("/api/auth/login", { method: "POST", body: { correo: email, password: registrationPassword } })).status, 401);
            assert.equal((await fetchJson("/api/usuarios", { cookie: rectorCookie })).status, 403);
            assert.equal((await fetchJson(`/api/usuarios/${registeredId}/aprobacion`, {
                method: "POST", cookie: rectorCookie, body: { decision: "aprobar" }
            })).status, 403);
            assert.equal((await fetchJson(`/api/usuarios/${registeredId}/aprobacion`, {
                method: "POST", cookie: adminCookie, body: { decision: "aprobar" }
            })).status, 200);
            const [approvedProfiles] = await db.execute("SELECT id_docente, id_usuario, estado FROM docente WHERE id_usuario = ?", [registeredId]);
            assert.equal(approvedProfiles.length, 1, "La aprobación debe aprovisionar exactamente un perfil docente vinculado.");
            assert.equal(Number(approvedProfiles[0].id_usuario), registeredId);
            assert.equal(approvedProfiles[0].estado, "activo");
            const approvedLogin = await fetchJson("/api/auth/login", { method: "POST", body: { correo: email, password: registrationPassword } });
            assert.equal(approvedLogin.status, 200);
            const approvedCookie = cookieFrom(approvedLogin.response);
            assert.equal((await fetchJson("/api/auth/me", { cookie: approvedCookie })).status, 200);
            assert.equal((await fetchJson("/api/auth/logout", { method: "POST", cookie: approvedCookie })).status, 200);
            assert.equal((await fetchJson("/api/auth/me", { cookie: approvedCookie })).status, 401);
        });

        await t.test("validación HTTP y endpoints retirados", async () => {
            assert.equal((await fetchJson("/api/piar", { method: "POST", cookie: coordinatorCookie, rawBody: "{" })).status, 400);
            assert.equal((await fetchJson("/api/data")).status, 410);
            assert.equal((await fetchJson("/api/reset")).status, 410);
        });
    } finally {
        if (backend && backend.exitCode === null) {
            backend.kill();
            await new Promise(resolve => {
                const timeout = setTimeout(resolve, 3000);
                backend.once("exit", () => { clearTimeout(timeout); resolve(); });
            });
        }
        // El servidor de correo simulado se cierra siempre: si la limpieza falla, un
        // servidor abierto mantenía vivo el proceso de la prueba (2026-11-22).
        try {
            if (db) {
                try {
                    if (fixture) await cleanupFixture(db, fixture);
                } finally {
                    await db.end();
                }
            }
        } finally {
            if (mailServer?.listening) await new Promise(resolve => mailServer.close(resolve));
        }
    }
});



