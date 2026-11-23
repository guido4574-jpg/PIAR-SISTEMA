"use strict";

// Pruebas de regresión de la fase 1 (seguridad del backend). Sin MySQL: las
// pruebas HTTP arrancan el server.js real con una base en memoria
// (tests/helpers/fase1-fake-server.js) y el resto usa conexiones simuladas.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const { buildStudentUpdate } = require("../backend/student-update");
const { validateTeacherPayload } = require("../backend/teacher-validation");
const accountEmail = require("../backend/account-email");
const { validateAdminEvent } = require("../backend/admin-account-audit");
const { EVENT_TYPES } = require("../backend/security-events");
const { purgeExpiredRecords } = require("../backend/maintenance");
const { listMigrations, splitSqlStatements } = require("../backend/migrations");

const ADMIN = "token-admin-sintetico";

function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

async function startServer() {
    const port = await freePort();
    const child = spawn(process.execPath, [path.join(__dirname, "helpers/fase1-fake-server.js")], {
        cwd: ROOT,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(port),
            MAINTENANCE_INTERVAL_MINUTES: "0", RATE_LIMIT_STORE: "memory", CORS_ORIGIN: `http://127.0.0.1:${port}`, APP_BASE_URL: `http://127.0.0.1:${port}` },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
    });
    const sql = [];
    let output = "";
    let buffer = "";
    child.stdout.on("data", chunk => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
            if (line.startsWith("FAKEDB ")) sql.push(JSON.parse(line.slice(7)));
            else output += `${line}\n`;
        }
    });
    child.stderr.on("data", chunk => { output += chunk; });
    const deadline = Date.now() + 10000;
    while (!output.includes("PIAR API y app disponibles")) {
        if (child.exitCode !== null || Date.now() > deadline) {
            child.kill();
            throw new Error(`El servidor de prueba no inició:\n${output}`);
        }
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    const base = `http://127.0.0.1:${port}`;
    const settle = () => new Promise(resolve => setTimeout(resolve, 60));
    return {
        sql,
        async request(method, pathname, { token, body, cookie } = {}) {
            const headers = {};
            const cookies = [token ? `piar_session=${token}` : "", cookie || ""].filter(Boolean).join("; ");
            if (cookies) headers.Cookie = cookies;
            if (body !== undefined) headers["Content-Type"] = "application/json";
            const response = await fetch(base + pathname, { method, headers, redirect: "manual", body: body === undefined ? undefined : JSON.stringify(body) });
            const text = await response.text();
            let json = {};
            try { json = JSON.parse(text); } catch { /* recursos estáticos */ }
            await settle();
            return { status: response.status, headers: response.headers, text, body: json };
        },
        stop() { child.kill(); }
    };
}

// Conexión simulada con respuestas programadas por patrón; registra cada sentencia.
function scriptedDb(handlers) {
    const calls = [];
    const run = async (sql, params = []) => {
        const text = String(sql).replace(/\s+/g, " ").trim();
        calls.push({ sql: text, params });
        for (const [pattern, reply] of handlers) {
            if (pattern.test(text)) {
                const value = typeof reply === "function" ? reply(params, text) : reply;
                if (value instanceof Error) throw value;
                return [value, []];
            }
        }
        if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return [{}, []];
        return [{ affectedRows: 1 }, []];
    };
    const connection = {
        query: run, execute: run,
        beginTransaction: async () => calls.push({ sql: "BEGIN" }),
        commit: async () => calls.push({ sql: "COMMIT" }),
        rollback: async () => calls.push({ sql: "ROLLBACK" }),
        release() {}
    };
    return { calls, db: { promise: () => ({ query: run, getConnection: async () => connection }) } };
}

function dbError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

// ---------------------------------------------------------------------------
// PUT /api/estudiantes/:id — actualización parcial
// ---------------------------------------------------------------------------

test("estudiantes: solo se actualizan los campos presentes en la petición", () => {
    const plan = buildStudentUpdate({ telefono: "3110000000" }, { nombres: "Ana", apellidos: "Prueba" });
    assert.deepEqual(plan, { columns: ["telefono"], values: ["3110000000"] });
});

test("estudiantes: los nombres heredados del formulario se aceptan y el nombre completo se recompone", () => {
    const plan = buildStudentUpdate({ apellidos: "Nueva", grado: "Séptimo", apoyosRequeridos: "Apoyo visual, Tiempo extra" }, { nombres: "Ana", apellidos: "Prueba" });
    assert.deepEqual(plan.columns, ["curso", "apellidos", "apoyos_requeridos", "nombre"]);
    assert.deepEqual(plan.values, ["Séptimo", "Nueva", JSON.stringify(["Apoyo visual", "Tiempo extra"]), "Ana Nueva"]);
});

test("estudiantes: un campo opcional vacío se vacía; uno obligatorio vacío se rechaza", () => {
    assert.deepEqual(buildStudentUpdate({ acudiente: "" }), { columns: ["acudiente"], values: [null] });
    assert.deepEqual(buildStudentUpdate({ fortalezas: [] }), { columns: ["fortalezas"], values: ["[]"] });
    assert.match(buildStudentUpdate({ documento: " " }).error, /documento es obligatorio/);
    assert.match(buildStudentUpdate({ estado: "" }).error, /estado es obligatorio/);
});

test("estudiantes: se validan tipos, longitudes, fechas y estados", () => {
    assert.match(buildStudentUpdate({ estado: "eliminado" }).error, /estado no es válido/);
    assert.match(buildStudentUpdate({ edad: "doce" }).error, /edad/);
    assert.match(buildStudentUpdate({ fechaNacimiento: "03/05/2014" }).error, /AAAA-MM-DD/);
    assert.match(buildStudentUpdate({ nombre: "x".repeat(201) }).error, /200 caracteres/);
    assert.match(buildStudentUpdate({ telefono: { a: 1 } }).error, /debe ser texto/);
    assert.match(buildStudentUpdate({ id: 5 }).error, /No hay campos/);
    assert.match(buildStudentUpdate([]).error, /no es válido/);
    for (const estado of ["activo", "revision", "cerrado", "inactivo"]) assert.deepEqual(buildStudentUpdate({ estado }).values, [estado]);
});

test("HTTP estudiantes: PUT parcial conserva los campos omitidos y devuelve la fecha en AAAA-MM-DD", async t => {
    const server = await startServer();
    t.after(() => server.stop());

    const result = await server.request("PUT", "/api/estudiantes/21", { token: ADMIN, body: { telefono: "3119999999" } });
    assert.equal(result.status, 200);
    assert.equal(result.body.telefono, "3119999999");
    assert.equal(result.body.contexto, "Contexto previo");
    assert.equal(result.body.valoracion, "Valoración previa");
    assert.equal(result.body.documento, "EST-21");
    assert.equal(result.body.fechaNacimiento, "2014-05-03");
    const updates = server.sql.filter(item => item.kind === "student-update");
    assert.equal(updates.length, 1);
    assert.equal(updates[0].sql, "UPDATE estudiante SET telefono = ? WHERE id_estudiante = ?");
    assert.deepEqual(updates[0].params, ["3119999999", 21]);

    const missing = await server.request("PUT", "/api/estudiantes/9999", { token: ADMIN, body: { telefono: "1" } });
    assert.equal(missing.status, 404);
    const invalid = await server.request("PUT", "/api/estudiantes/21", { token: ADMIN, body: { documento: "" } });
    assert.equal(invalid.status, 400);
    assert.equal(server.sql.filter(item => item.kind === "student-update").length, 1, "una petición inválida no escribe");

    const denied = await server.request("PUT", "/api/estudiantes/21", { token: "token-docente-sin-perfil", body: { telefono: "1" } });
    assert.equal(denied.status, 403, "la matriz de permisos no cambia: el Docente no edita estudiantes");
});

// ---------------------------------------------------------------------------
// POST /api/docentes — validación
// ---------------------------------------------------------------------------

test("docentes: se validan longitudes, tipos, correo y estado", () => {
    assert.match(validateTeacherPayload({ nombre: "Docente", estado: "suspendido" }).error, /activo o inactivo/);
    assert.match(validateTeacherPayload({ nombre: "D".repeat(151) }).error, /150 caracteres/);
    assert.match(validateTeacherPayload({ nombre: "Docente", documento: "1".repeat(31) }).error, /30 caracteres/);
    assert.match(validateTeacherPayload({ nombre: "Docente", correo: "no-es-correo" }).error, /correo/);
    assert.match(validateTeacherPayload({ nombre: "Docente", area: ["x"] }).error, /debe ser texto/);
    assert.match(validateTeacherPayload({}).error, /obligatorio/);
    assert.deepEqual(validateTeacherPayload({ nombres: "Luis", apellidos: "Pérez", area: "Matemáticas" }).values,
        { nombres: "Luis", apellidos: "Pérez", area: "Matemáticas", nombre: "Luis Pérez", estado: "activo" });
    assert.deepEqual(validateTeacherPayload({ estado: "inactivo" }, { partial: true }).values, { estado: "inactivo" });
    assert.match(validateTeacherPayload({ nombre: "" }, { partial: true }).error, /no se puede vaciar/);
});

test("HTTP docentes: POST rechaza datos inválidos sin escribir y acepta los válidos", async t => {
    const server = await startServer();
    t.after(() => server.stop());

    const invalidState = await server.request("POST", "/api/docentes", { token: ADMIN, body: { nombre: "Docente", estado: "admin" } });
    assert.equal(invalidState.status, 400);
    const tooLong = await server.request("POST", "/api/docentes", { token: ADMIN, body: { nombre: "D".repeat(151) } });
    assert.equal(tooLong.status, 400);
    assert.equal(server.sql.filter(item => item.kind === "teacher-insert").length, 0);

    const created = await server.request("POST", "/api/docentes", { token: ADMIN, body: { nombres: "Luis", apellidos: "Pérez", area: "Matemáticas", estado: "activo" } });
    assert.equal(created.status, 201);
    const inserts = server.sql.filter(item => item.kind === "teacher-insert");
    assert.equal(inserts.length, 1);
    assert.deepEqual(inserts[0].params, ["Luis Pérez", "Matemáticas", null, "Luis", "Pérez", null, null, null, null, "activo"]);
});

test("HTTP usuarios (D3): el Administrador crea solo los cuatro perfiles, con auditoría y contraseña temporal", async t => {
    const server = await startServer();
    t.after(() => server.stop());
    const body = { nombre: "Rosa", apellidos: "Rectora Sintética", documento: "REC-1", correo: "rectora@example.invalid", password: "Frase temporal sintética 2026" };

    for (const rol of ["Administrador", "SuperUsuario", undefined]) {
        const denied = await server.request("POST", "/api/usuarios", { token: ADMIN, body: { ...body, rol } });
        assert.equal(denied.status, 403, String(rol));
    }
    // D7: una cuenta Estudiante exige el estudiante vinculado y la autorización del acudiente.
    const studentWithoutLink = await server.request("POST", "/api/usuarios", { token: ADMIN, body: { ...body, rol: "Estudiante" } });
    assert.equal(studentWithoutLink.status, 400);
    const notAdmin = await server.request("POST", "/api/usuarios", { token: "token-psicologa-sintetica", body: { ...body, rol: "Rector" } });
    assert.equal(notAdmin.status, 403);
    assert.equal(server.sql.filter(item => item.kind === "user-insert").length, 0, "ninguna petición rechazada escribe");

    const created = await server.request("POST", "/api/usuarios", { token: ADMIN, body: { ...body, rol: "Rector" } });
    assert.equal(created.status, 201);
    assert.equal(created.body.pendingApproval, true);
    const insert = server.sql.find(item => item.kind === "user-insert");
    assert.match(insert.sql, /password_change_required\) VALUES \(\?, \?, \?, \?, \?, \?, \?, 1\)$/);
    assert.deepEqual([insert.params[0], insert.params[3], insert.params[6]], ["Rosa Rectora Sintética", "Rector", "pendiente"]);
    const audit = server.sql.find(item => item.kind === "admin-audit");
    assert.deepEqual(audit.params.slice(0, 5), [950, "account_created", "pending_approval", "900", "admin_session"]);
    assert.doesNotMatch(JSON.stringify(created.body), /hash|password|token/i);
});

test("HTTP docentes: GET devuelve el perfil completo solo a quien puede editarlo", async t => {
    const server = await startServer();
    t.after(() => server.stop());
    const full = ["id_docente", "nombre", "nombres", "apellidos", "documento", "area", "correo", "cargo", "telefono", "perfil", "estado"];
    const summary = ["id_docente", "nombre", "area", "correo", "cargo", "estado"];

    const list = await server.request("GET", "/api/docentes", { token: ADMIN });
    assert.equal(list.status, 200);
    assert.deepEqual(Object.keys(list.body.data[0]).sort(), [...full].sort());
    assert.equal(list.body.data[0].documento, "DOC-31");
    assert.equal(list.body.data[0].telefono, "3001112233");
    assert.equal(list.body.data[0].perfil, "Perfil sintético");
    assert.equal(list.body.data[0].nombres, "Laura");
    assert.equal(list.body.data[0].apellidos, "Docente Sintética");
    assert.equal(Object.hasOwn(list.body.data[0], "id_usuario"), false, "no expone el vínculo de cuenta");

    const detail = await server.request("GET", "/api/docentes/31", { token: ADMIN });
    assert.equal(detail.status, 200);
    assert.deepEqual(Object.keys(detail.body.data).sort(), [...full].sort());

    // Psicóloga consulta docentes pero no los edita: conserva la proyección mínima.
    const psicoList = await server.request("GET", "/api/docentes", { token: "token-psicologa-sintetica" });
    assert.equal(psicoList.status, 200);
    assert.deepEqual(Object.keys(psicoList.body.data[0]).sort(), [...summary].sort());
    const psicoDetail = await server.request("GET", "/api/docentes/31", { token: "token-psicologa-sintetica" });
    assert.deepEqual(Object.keys(psicoDetail.body.data).sort(), [...summary].sort());

    const missing = await server.request("GET", "/api/docentes/999", { token: ADMIN });
    assert.equal(missing.status, 404);
    assert.equal(server.sql.filter(item => /^(INSERT|UPDATE|DELETE)/i.test(item.sql) && item.kind !== "audit" && item.kind !== "session").length, 0, "las lecturas no escriben");
});

// ---------------------------------------------------------------------------
// D1 — cambio de correo con verificación (migración 016)
// ---------------------------------------------------------------------------

test("migración 016: es aditiva, re-ejecutable y guarda solo el hash del token", async () => {
    const file = path.join(ROOT, "database/migrations/016_email_change_request.sql");
    const sql = fs.readFileSync(file, "utf8");
    const statements = splitSqlStatements(sql);
    assert.equal(statements.length, 1);
    assert.match(statements[0], /^CREATE TABLE IF NOT EXISTS cambio_correo/);
    assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE|ALTER TABLE usuario|UPDATE)\b/i);
    assert.match(sql, /token_hash CHAR\(64\) NOT NULL/);
    assert.match(sql, /UNIQUE KEY uq_cambio_correo_token_hash \(token_hash\)/);
    assert.match(sql, /FOREIGN KEY \(id_usuario\) REFERENCES usuario \(id_usuario\)/);
    assert.match(sql, /FOREIGN KEY \(solicitado_por\) REFERENCES usuario \(id_usuario\)/);
    assert.doesNotMatch(sql, /\btoken\b\s+(VARCHAR|TEXT)/i, "no se guarda el token en claro");
    const migrations = await listMigrations();
    assert.equal(migrations.at(-1).name, "016_email_change_request.sql");
    assert.equal(new Set(migrations.map(item => item.version)).size, migrations.length);
});

test("auditoría administrativa: admite las operaciones de D1 y rechaza combinaciones incorrectas", () => {
    const session = { operatorIdentityClaim: "900", operatorIdentitySource: "admin_session", authorizationReference: null, reason: null };
    assert.doesNotThrow(() => validateAdminEvent({ targetUserId: 902, operation: "email_change_requested", outcome: "pending_verification", ...session }));
    assert.doesNotThrow(() => validateAdminEvent({ targetUserId: 902, operation: "account_updated", outcome: "success", ...session }));
    assert.doesNotThrow(() => validateAdminEvent({ targetUserId: 902, operation: "email_changed", outcome: "success", operatorIdentityClaim: null, operatorIdentitySource: "email_verification_token", authorizationReference: null, reason: null }));
    assert.throws(() => validateAdminEvent({ targetUserId: 902, operation: "email_changed", outcome: "success", ...session }), /do not match/);
    assert.throws(() => validateAdminEvent({ targetUserId: 902, operation: "email_change_requested", outcome: "success", ...session }), /do not match/);
    assert.throws(() => validateAdminEvent({ targetUserId: 902, operation: "account_updated", outcome: "success", operatorIdentityClaim: null, operatorIdentitySource: "email_verification_token", authorizationReference: null, reason: null }), /do not match/);
    // Las operaciones existentes conservan sus reglas.
    assert.doesNotThrow(() => validateAdminEvent({ targetUserId: 902, operation: "account_deactivated", outcome: "success", ...session }));
    assert.throws(() => validateAdminEvent({ targetUserId: 902, operation: "account_deactivated", outcome: "pending_verification", ...session }), /do not match/);
    assert.doesNotThrow(() => validateAdminEvent({ targetUserId: 902, operation: "email_verified", outcome: "success", operatorIdentityClaim: null, operatorIdentitySource: "email_verification_token", authorizationReference: null, reason: null }));
});

const verifiedUser = { id_usuario: 902, correo: "docente@example.invalid", estado: "activo", correo_verificado_at: "2026-01-01 00:00:00" };

test("cambio de correo: la solicitud no cambia el correo actual, invalida la anterior, audita y envía el enlace al nuevo", async () => {
    const { calls, db } = scriptedDb([
        [/FROM usuario WHERE id_usuario = \? FOR UPDATE/, [verifiedUser]],
        [/^SELECT id_usuario FROM usuario WHERE correo = \?/, []]
    ]);
    const sent = [];
    const result = await accountEmail.requestEmailChange(db, { userId: 902, newEmail: " Nuevo@Example.Invalid ", actorId: 900 }, async (to, fragment) => sent.push({ to, fragment }));
    assert.equal(result.status, 202);
    assert.equal(result.body.pendingVerification, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "nuevo@example.invalid");
    assert.match(sent[0].fragment, /^\/#verify-email-change=[A-Za-z0-9_-]{43}$/);
    const sqls = calls.map(call => call.sql);
    assert.ok(!sqls.some(sql => /^UPDATE usuario\b/.test(sql)), "el correo actual no cambia al solicitar");
    assert.ok(sqls.includes("UPDATE cambio_correo SET consumed_at = CURRENT_TIMESTAMP WHERE id_usuario = ? AND consumed_at IS NULL"));
    const insert = calls.find(call => /^INSERT INTO cambio_correo/.test(call.sql));
    assert.equal(insert.params[1], "nuevo@example.invalid");
    assert.match(insert.params[2], /^[0-9a-f]{64}$/);
    assert.ok(!insert.params.includes(sent[0].fragment.split("=")[1]), "se guarda el hash, no el token");
    const audit = calls.find(call => /^INSERT INTO admin_account_audit/.test(call.sql));
    assert.deepEqual(audit.params, [902, "email_change_requested", "pending_verification", "900", "admin_session", null, null]);
    assert.equal(sqls.indexOf("COMMIT") < sqls.length, true);
});

test("cambio de correo: casos rechazados sin escritura ni envío", async () => {
    const neverSend = async () => assert.fail("no debe enviarse correo");
    const same = scriptedDb([[/FOR UPDATE/, [verifiedUser]]]);
    assert.equal((await accountEmail.requestEmailChange(same.db, { userId: 902, newEmail: "DOCENTE@example.invalid", actorId: 900 }, neverSend)).body.unchanged, true);

    const taken = scriptedDb([[/FOR UPDATE/, [verifiedUser]], [/^SELECT id_usuario FROM usuario WHERE correo/, [{ id_usuario: 5 }]]]);
    assert.equal((await accountEmail.requestEmailChange(taken.db, { userId: 902, newEmail: "otro@example.invalid", actorId: 900 }, neverSend)).status, 409);

    const unverified = scriptedDb([[/FOR UPDATE/, [{ ...verifiedUser, estado: "pendiente_verificacion", correo_verificado_at: null }]]]);
    assert.equal((await accountEmail.requestEmailChange(unverified.db, { userId: 902, newEmail: "otro@example.invalid", actorId: 900 }, neverSend)).status, 409);

    const missing = scriptedDb([[/FOR UPDATE/, []]]);
    assert.equal((await accountEmail.requestEmailChange(missing.db, { userId: 999, newEmail: "otro@example.invalid", actorId: 900 }, neverSend)).status, 404);

    assert.equal((await accountEmail.requestEmailChange(missing.db, { userId: 902, newEmail: "sin-arroba", actorId: 900 }, neverSend)).status, 400);

    const noMigration = scriptedDb([[/FOR UPDATE/, [verifiedUser]], [/^SELECT id_usuario FROM usuario WHERE correo/, []], [/cambio_correo/, dbError("ER_NO_SUCH_TABLE")]]);
    const result = await accountEmail.requestEmailChange(noMigration.db, { userId: 902, newEmail: "otro@example.invalid", actorId: 900 }, neverSend);
    assert.equal(result.status, 503);
    assert.match(result.body.message, /migración 016/);
    for (const { calls } of [same, taken, unverified, noMigration]) {
        assert.ok(!calls.some(call => /^(INSERT INTO cambio_correo|UPDATE usuario|INSERT INTO admin_account_audit)/.test(call.sql)));
    }
});

test("cambio de correo: si falla el envío, el enlace queda inutilizado y el correo actual sigue vigente", async () => {
    const { calls, db } = scriptedDb([[/FOR UPDATE/, [verifiedUser]], [/^SELECT id_usuario FROM usuario WHERE correo/, []]]);
    const result = await accountEmail.requestEmailChange(db, { userId: 902, newEmail: "nuevo@example.invalid", actorId: 900 }, async () => { throw new Error("smtp"); });
    assert.equal(result.status, 503);
    const insert = calls.find(call => /^INSERT INTO cambio_correo/.test(call.sql));
    const consumed = calls.at(-1);
    assert.equal(consumed.sql, "UPDATE cambio_correo SET consumed_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND consumed_at IS NULL");
    assert.deepEqual(consumed.params, [insert.params[2]]);
    assert.ok(!calls.some(call => /^UPDATE usuario\b/.test(call.sql)));
});

test("cambio de correo: la confirmación aplica el correo, revoca sesiones, invalida enlaces previos y audita", async () => {
    const token = "A".repeat(43);
    const { calls, db } = scriptedDb([
        [/^SELECT c\.id_cambio/, [{ id_cambio: 3, id_usuario: 902, correo_nuevo: "nuevo@example.invalid" }]],
        [/^UPDATE cambio_correo SET consumed_at = CURRENT_TIMESTAMP WHERE id_cambio/, { affectedRows: 1 }]
    ]);
    const result = await accountEmail.confirmEmailChange(db, token);
    assert.equal(result.status, 200);
    assert.equal(result.userId, 902);
    const sqls = calls.map(call => call.sql);
    const order = [
        "UPDATE usuario SET correo = ?, correo_verificado_at = CURRENT_TIMESTAMP WHERE id_usuario = ?",
        "UPDATE sesion_usuario SET revoked_at = CURRENT_TIMESTAMP WHERE id_usuario = ? AND revoked_at IS NULL",
        "UPDATE recuperacion_contrasena SET consumed_at = CURRENT_TIMESTAMP WHERE id_usuario = ? AND consumed_at IS NULL",
        "UPDATE verificacion_correo SET consumed_at = CURRENT_TIMESTAMP WHERE id_usuario = ? AND consumed_at IS NULL"
    ].map(sql => sqls.indexOf(sql));
    assert.ok(order.every(index => index > 0), "faltan sentencias de la confirmación");
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.deepEqual(calls.find(call => /^UPDATE usuario SET correo/.test(call.sql)).params, ["nuevo@example.invalid", 902]);
    const audit = calls.find(call => /^INSERT INTO admin_account_audit/.test(call.sql));
    assert.deepEqual(audit.params, [902, "email_changed", "success", null, "email_verification_token", null, null]);
    assert.equal(sqls.at(-1), "COMMIT");
});

test("cambio de correo: enlaces inválidos, vencidos, reutilizados o en conflicto no cambian nada", async () => {
    const fresh = () => scriptedDb([[/^SELECT c\.id_cambio/, []]]);
    assert.equal((await accountEmail.confirmEmailChange(fresh().db, "corto")).status, 400);
    const expired = fresh();
    assert.equal((await accountEmail.confirmEmailChange(expired.db, "B".repeat(43))).status, 400);

    const race = scriptedDb([[/^SELECT c\.id_cambio/, [{ id_cambio: 3, id_usuario: 902, correo_nuevo: "n@example.invalid" }]], [/WHERE id_cambio = \?/, { affectedRows: 0 }]]);
    assert.equal((await accountEmail.confirmEmailChange(race.db, "C".repeat(43))).status, 400);

    const duplicate = scriptedDb([
        [/^SELECT c\.id_cambio/, [{ id_cambio: 3, id_usuario: 902, correo_nuevo: "n@example.invalid" }]],
        [/WHERE id_cambio = \?/, { affectedRows: 1 }],
        [/^UPDATE usuario SET correo/, dbError("ER_DUP_ENTRY")]
    ]);
    assert.equal((await accountEmail.confirmEmailChange(duplicate.db, "D".repeat(43))).status, 409);
    assert.equal(duplicate.calls.at(-1).sql, "ROLLBACK");

    for (const { calls } of [expired, race, duplicate]) {
        assert.ok(!calls.some(call => /^(UPDATE sesion_usuario|INSERT INTO admin_account_audit)/.test(call.sql)));
    }
});

test("HTTP usuarios: sin la migración 016, cambiar el correo responde 503 y no toca usuario.correo", async t => {
    const server = await startServer();
    t.after(() => server.stop());
    const result = await server.request("PUT", "/api/usuarios/902", { token: ADMIN, body: { correo: "nuevo@example.invalid" } });
    assert.equal(result.status, 503);
    assert.match(result.body.message, /migración 016/);
    assert.ok(!server.sql.some(item => /UPDATE usuario SET correo/.test(item.sql)));
    assert.ok(server.sql.some(item => item.kind === "email-change"));

    const confirm = await server.request("POST", "/api/auth/email-change/confirm", { body: { token: "E".repeat(43) } });
    assert.equal(confirm.status, 400);
    const event = server.sql.find(item => item.kind === "audit" && /evento_seguridad/.test(item.sql) && item.params[0] === "correo_cambiado");
    assert.ok(event, "la confirmación queda en evento_seguridad");
    assert.equal(event.params[1], "fallo");
});

test("mantenimiento: purga cambio_correo y tolera que la migración 016 no esté aplicada", async () => {
    const calls = [];
    const db = { promise: () => ({ query: async sql => {
        calls.push(sql);
        if (sql.includes("cambio_correo")) throw dbError("ER_NO_SUCH_TABLE");
        return [{ affectedRows: 0 }];
    } }) };
    const summary = await purgeExpiredRecords(db, { env: {} });
    assert.equal(summary.cambio_correo, "tabla ausente");
    assert.equal(summary.sesion_usuario, 0);
});

// ---------------------------------------------------------------------------
// Auditoría OIDC, WOFF2 y favicon
// ---------------------------------------------------------------------------

test("eventos de seguridad: existen los tipos de acceso externo y de cambio de correo", () => {
    for (const type of ["oidc_login", "oidc_fallido", "oidc_vinculada", "correo_cambiado"]) assert.ok(EVENT_TYPES.includes(type), type);
    const server = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
    const callback = server.slice(server.indexOf("async function completeOidc"), server.indexOf("function configuredAppOrigin"));
    assert.match(callback, /audit\("oidc_login", "exito", "login"/);
    assert.match(callback, /audit\("oidc_vinculada", "exito", "vinculada"/);
    assert.match(callback, /audit\("oidc_fallido", "fallo", "validacion_proveedor"\)/);
    assert.ok((callback.match(/return redirectAuthResult/g) || []).length <= (callback.match(/await audit\(/g) || []).length,
        "cada salida del callback queda auditada");
});

test("HTTP OIDC: los callbacks rechazados quedan en evento_seguridad sin datos del proveedor", async t => {
    const server = await startServer();
    t.after(() => server.stop());
    const state = "S".repeat(43);
    const cases = [
        [{ query: "?state=corto" }, "google:estado_invalido"],
        [{ query: `?state=${state}&code=x` }, "microsoft:estado_no_coincide"],
        [{ query: `?state=${state}&code=x`, cookie: `piar_oidc_${state}=${state}` }, "apple:transaccion_invalida"]
    ];
    for (const [{ query, cookie }, detail] of cases) {
        const provider = detail.split(":")[0];
        const result = await server.request("GET", `/api/auth/oidc/${provider}/callback${query}`, { cookie });
        assert.equal(result.status, 303);
        assert.match(result.headers.get("location"), /auth=oidc-error/);
        const event = server.sql.filter(item => item.kind === "audit" && /evento_seguridad/.test(item.sql)).find(item => item.params[5] === detail);
        assert.ok(event, `falta el evento ${detail}`);
        assert.equal(event.params[0], "oidc_fallido");
        assert.equal(event.params[1], "fallo");
        assert.ok(!JSON.stringify(event.params).includes(state), "no se registra el state");
    }
});

test("HTTP estáticos: las fuentes WOFF2 se sirven como font/woff2 y existe el favicon", async t => {
    const server = await startServer();
    t.after(() => server.stop());
    const font = await server.request("GET", "/fonts/poppins/poppins-latin-400-normal.woff2");
    assert.equal(font.status, 200);
    assert.equal(font.headers.get("content-type"), "font/woff2");
    assert.equal(font.headers.get("x-content-type-options"), "nosniff");
    const icon = await server.request("GET", "/favicon.svg");
    assert.equal(icon.status, 200);
    assert.equal(icon.headers.get("content-type"), "image/svg+xml");
    assert.match(icon.text, /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.doesNotMatch(icon.text, /<script|href=|xlink/i, "el favicon no contiene scripts ni referencias externas");
    const page = await server.request("GET", "/");
    assert.match(page.text, /<link rel="icon" href="favicon\.svg" type="image\/svg\+xml">/);
    const demo = fs.readFileSync(path.join(ROOT, "scripts/visual-demo-server.js"), "utf8");
    assert.match(demo, /"\.woff2": "font\/woff2"/);
});
