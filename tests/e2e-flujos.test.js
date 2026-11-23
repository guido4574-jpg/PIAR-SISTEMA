"use strict";

// End-to-end flows against a real MySQL schema: frontend contract -> API ->
// authorization -> MySQL -> response, for every role the schema supports,
// including a backend restart to prove persistence.
//
// Requires a DISPOSABLE, fully migrated and empty schema on loopback:
//   PIAR_E2E_DB_PORT, PIAR_E2E_DB_NAME (piar_dev_* | piar_test_*),
//   PIAR_E2E_DB_USER, PIAR_E2E_DB_PASSWORD (DML-only account)
//   npm run test:e2e
// Synthetic fixtures are left in that schema on purpose; drop the schema afterwards.

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { test } = require("node:test");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");
const http = require("node:http");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const API_PORT = Number(process.env.PIAR_E2E_API_PORT || 8090);
const BASE = `http://127.0.0.1:${API_PORT}`;
const PASSWORD = "Frase sintetica e2e 2026";
const ROLES = ["Administrador", "Rector", "Coordinador", "Psicóloga", "Docente", "Docente"];

function e2eConfig() {
    const env = process.env;
    const name = String(env.PIAR_E2E_DB_NAME || "");
    if (!/^piar_(dev|test)_[a-z0-9_]+$/.test(name)) throw new Error("PIAR_E2E_DB_NAME debe ser un esquema desechable piar_dev_* o piar_test_*.");
    if (!env.PIAR_E2E_DB_USER || !env.PIAR_E2E_DB_PASSWORD) throw new Error("PIAR_E2E_DB_USER y PIAR_E2E_DB_PASSWORD son obligatorias.");
    return { host: "127.0.0.1", port: Number(env.PIAR_E2E_DB_PORT || 3306), database: name, user: env.PIAR_E2E_DB_USER, password: env.PIAR_E2E_DB_PASSWORD };
}

const MAILBOX = { messages: [], url: "", secret: crypto.randomBytes(32).toString("hex") };

async function startMailbox() {
    const server = http.createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        if (request.headers.authorization !== `Bearer ${MAILBOX.secret}`) { response.writeHead(401).end(); return; }
        try { MAILBOX.messages.push(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { response.writeHead(400).end(); return; }
        response.writeHead(202).end();
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    MAILBOX.url = `http://127.0.0.1:${server.address().port}`;
    return server;
}

// Último enlace enviado a un correo: devuelve el token del fragmento indicado.
function lastToken(to, fragment) {
    const message = [...MAILBOX.messages].reverse().find(item => item.to === to && item.text.includes(`#${fragment}=`));
    assert.ok(message, `no llegó el correo ${fragment} a ${to}`);
    return decodeURIComponent(message.text.match(new RegExp(`#${fragment}=([A-Za-z0-9_%-]+)`))[1]);
}

function serverEnv(config) {
    return {
        EMAIL_TRANSPORT: "api", PASSWORD_RESET_DELIVERY_URL: MAILBOX.url, PASSWORD_RESET_DELIVERY_SECRET: MAILBOX.secret, EMAIL_FROM: "piar@example.invalid",
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(API_PORT), APP_BASE_URL: BASE,
        DB_HOST: config.host, DB_PORT: String(config.port), DB_NAME: config.database, DB_USER: config.user, DB_PASSWORD: config.password,
        CORS_ORIGIN: BASE, RATE_LIMIT_STORE: "mysql", TRUSTED_PROXIES: "loopback", MAINTENANCE_INTERVAL_MINUTES: "0"
    };
}

async function startServer(config) {
    const child = spawn(process.execPath, ["backend/server.js"], { cwd: ROOT, env: serverEnv(config), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    for (let attempt = 0; attempt < 50; attempt += 1) {
        try {
            const response = await fetch(`${BASE}/api/health`);
            if (response.ok) return child;
        } catch { /* not listening yet */ }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    child.kill();
    throw new Error(`El backend no arrancó: ${output.slice(-500)}`);
}

async function stopServer(child) {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill();
    await exited;
}

function client(forwardedFor) {
    let cookie = "";
    return async function call(method, url, body) {
        const response = await fetch(`${BASE}${url}`, {
            method,
            headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
        const setCookie = response.headers.get("set-cookie");
        if (setCookie?.startsWith("piar_session=")) cookie = setCookie.split(";")[0];
        const payload = await response.json().catch(() => ({}));
        return { status: response.status, body: payload, headers: response.headers };
    };
}

async function seedUsers(db) {
    const [[{ total }]] = await db.query("SELECT COUNT(*) AS total FROM usuario");
    if (Number(total) !== 0) throw new Error("El esquema e2e debe estar vacío (usuario sin filas).");
    const hash = await bcrypt.hash(PASSWORD, 12);
    const users = [];
    for (const [index, rol] of ROLES.entries()) {
        const correo = `e2e-${index}@example.invalid`;
        const [result] = await db.query(
            "INSERT INTO usuario (nombre, documento, correo, rol, contrasena, password_hash, estado, correo_verificado_at) VALUES (?, ?, ?, ?, '', ?, 'activo', CURRENT_TIMESTAMP)",
            [`Usuario sintetico ${index}`, `E2E${index}`, correo, rol, hash]
        );
        const user = { id: result.insertId, rol, correo };
        if (rol === "Docente") {
            const [teacher] = await db.query("INSERT INTO docente (nombre, area, correo, documento, estado, id_usuario) VALUES (?, 'Matemáticas', ?, ?, 'activo', ?)",
                [`Docente sintetico ${index}`, correo, `E2E${index}`, result.insertId]);
            user.teacherId = teacher.insertId;
        }
        users.push(user);
    }
    return { admin: users[0], rector: users[1], coord: users[2], psico: users[3], doc1: users[4], doc2: users[5] };
}

async function login(user, forwardedFor) {
    const call = client(forwardedFor);
    const result = await call("POST", "/api/auth/login", { correo: user.correo, password: PASSWORD });
    assert.equal(result.status, 200, `login ${user.rol}: ${JSON.stringify(result.body)}`);
    return call;
}

test("flujos institucionales de extremo a extremo con MySQL real y reinicio", { timeout: 180000 }, async () => {
    const config = e2eConfig();
    const db = await mysql.createConnection(config);
    let server;
    const mailbox = await startMailbox();
    try {
        const [[{ pending }]] = await db.query("SELECT 13 - COUNT(*) AS pending FROM schema_migrations WHERE version <= '013'");
        assert.ok(Number(pending) <= 1, "El esquema debe tener aplicadas las migraciones 000-013 (004 no existe).");
        const users = await seedUsers(db);
        server = await startServer(config);

        // Static shell carries CSP; API responses are not cacheable.
        const page = await fetch(`${BASE}/`);
        assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
        const health = await fetch(`${BASE}/api/health`);
        assert.equal(health.headers.get("cache-control"), "no-store");

        const coord = await login(users.coord);
        const admin = await login(users.admin);
        const rector = await login(users.rector);
        const doc1 = await login(users.doc1);
        const doc2 = await login(users.doc2);
        const psico = await login(users.psico);

        // Session expiry is written with the MySQL clock: 8 hours.
        const [[session]] = await db.query("SELECT TIMESTAMPDIFF(MINUTE, created_at, expires_at) AS minutes FROM sesion_usuario ORDER BY id_sesion DESC LIMIT 1");
        assert.ok(Math.abs(Number(session.minutes) - 480) <= 1, `duración de sesión ${session.minutes} min`);

        // Student and PIAR creation by Coordinación, assigned to Docente 1.
        const student = await coord("POST", "/api/estudiantes", { nombres: "Estudiante", apellidos: "Sintetico", documento: "E2E-EST-1", grado: "Quinto", discapacidad: "Discapacidad visual", jornada: "Mañana" });
        assert.ok([200, 201].includes(student.status), JSON.stringify(student.body));
        const studentId = Number(student.body.data?.id ?? student.body.id ?? student.body.data?.id_estudiante);
        const created = await coord("POST", "/api/piar", { id_estudiante: studentId, titulo: "PIAR e2e", periodo: "2026-1", anio: 2026, id_docente: users.doc1.teacherId, es_responsable_principal: true, objetivo_general: "Objetivo inicial" });
        assert.ok([200, 201].includes(created.status), JSON.stringify(created.body));
        const piarId = Number(created.body.data?.id ?? created.body.data?.id_piar ?? created.body.id);
        assert.ok(piarId > 0);

        // Teacher scope: assigned teacher sees it, the other gets 404 everywhere.
        assert.equal((await doc1("GET", `/api/piar/${piarId}`)).status, 200);
        assert.equal((await doc2("GET", `/api/piar/${piarId}`)).status, 404);
        assert.equal((await doc2("GET", `/api/piar/${piarId}/dua`)).status, 404);
        assert.equal((await doc2("POST", `/api/piar/${piarId}/dua`, { principio: "implicacion", estrategia: "x" })).status, 404);
        assert.equal((await doc1("GET", `/api/docentes/${users.doc2.teacherId}`)).status, 404);
        assert.equal((await doc1("GET", `/api/docentes/${users.doc1.teacherId}`)).status, 200);

        // DUA: create (Coordinación and assigned Docente), edit, validation.
        const duaCoord = await coord("POST", `/api/piar/${piarId}/dua`, { principio: "representacion", area: "Matemáticas", estrategia: "Material concreto y apoyos visuales", recursos: "Ábaco" });
        assert.equal(duaCoord.status, 201, JSON.stringify(duaCoord.body));
        const duaDoc = await doc1("POST", `/api/piar/${piarId}/dua`, { principio: "accion_expresion", estrategia: "Respuesta oral o escrita a elección" });
        assert.equal(duaDoc.status, 201);
        assert.equal((await coord("POST", `/api/piar/${piarId}/dua`, { principio: "otro", estrategia: "x" })).status, 400);
        const duaEdit = await doc1("PUT", `/api/piar/${piarId}/dua/${duaCoord.body.data.id_dua}`, { principio: "representacion", area: "Matemáticas", estrategia: "Material concreto, apoyos visuales y audio", recursos: "Ábaco" });
        assert.equal(duaEdit.status, 200, JSON.stringify(duaEdit.body));
        // Psicóloga consults DUA but cannot register it.
        assert.equal((await psico("GET", `/api/piar/${piarId}/dua`)).status, 200);
        assert.equal((await psico("POST", `/api/piar/${piarId}/dua`, { principio: "implicacion", estrategia: "x" })).status, 403);

        // PIAR edit with justification creates a version.
        assert.equal((await coord("PUT", `/api/piar/${piarId}`, { objetivo_general: "Objetivo actualizado" })).status, 400);
        assert.equal((await coord("PUT", `/api/piar/${piarId}`, { objetivo_general: "Objetivo actualizado", justificacion: "Ajuste tras comité" })).status, 200);
        const versions = await coord("GET", `/api/piar/${piarId}/versiones`);
        assert.equal(versions.status, 200);
        assert.ok((versions.body.data || []).length >= 3, "DUA y actualización deben quedar versionados");

        // Teacher assignment management.
        assert.equal((await doc1("POST", `/api/piar/${piarId}/docentes`, { id_docente: users.doc2.teacherId })).status, 403);
        assert.equal((await coord("POST", `/api/piar/${piarId}/docentes`, { id_docente: users.doc2.teacherId })).status, 201);
        assert.equal((await doc2("GET", `/api/piar/${piarId}`)).status, 200);
        assert.equal((await coord("DELETE", `/api/piar/${piarId}/docentes`, { id_docente: users.doc2.teacherId })).status, 200);
        assert.equal((await doc2("GET", `/api/piar/${piarId}`)).status, 404);

        // Child records on an open PIAR (positive controls for the closed checks below).
        const barrier = { contexto: "aula", descripcion: "Barrera sintética", fecha_identificacion: "2026-02-01" };
        const adjustment = { area: "Matemáticas", tipo: "Metodológico", estrategia: "Guía visual", recursos: "Fichas", resultado_esperado: "Comprende el enunciado", indicador_logro: "3 de 4 ejercicios", fecha_revision_prevista: "2026-04-01" };
        const diagnosis = { tipo_diagnostico: "Sintético", fecha: "2026-02-02", descripcion: "Diagnóstico sintético", id_estudiante: studentId, id_piar: piarId };
        const note = { fecha: "2026-02-03", descripcion: "Observación profesional sintética", tipo: "Seguimiento", id_estudiante: studentId, id_piar: piarId, docente_responsable: "Psicología" };
        const followUp = { fecha: "2026-02-04", descripcion: "Seguimiento sintético", id_estudiante: studentId, id_piar: piarId };
        const createdBarrier = await doc1("POST", `/api/piar/${piarId}/barreras`, barrier);
        assert.equal(createdBarrier.status, 201, JSON.stringify(createdBarrier.body));
        const createdAdjustment = await doc1("POST", `/api/piar/${piarId}/ajustes`, adjustment);
        assert.equal(createdAdjustment.status, 201, JSON.stringify(createdAdjustment.body));
        const adjustmentId = Number(createdAdjustment.body.data?.id_ajuste ?? createdAdjustment.body.data?.id);
        const evidence = { descripcion: "Evidencia sintética", fecha: "2026-02-05" };
        assert.equal((await doc1("POST", `/api/piar/${piarId}/ajustes/${adjustmentId}/evidencias`, evidence)).status, 201);
        assert.equal((await psico("POST", "/api/diagnosticos", diagnosis)).status, 201);
        assert.equal((await psico("POST", "/api/observaciones", note)).status, 201);
        assert.equal((await psico("POST", "/api/seguimientos", followUp)).status, 403);
        assert.equal((await coord("POST", "/api/seguimientos", followUp)).status, 201);
        assert.equal((await psico("POST", `/api/piar/${piarId}/barreras`, barrier)).status, 403);

        // Close (Administrador), closed PIAR is read-only, reopen only by Coordinación.
        assert.equal((await doc1("DELETE", `/api/piar/${piarId}`, { justificacion: "x" })).status, 403);
        assert.equal((await admin("DELETE", `/api/piar/${piarId}`, { justificacion: "Fin del periodo" })).status, 200);
        assert.equal((await doc1("POST", `/api/piar/${piarId}/dua`, { principio: "implicacion", estrategia: "Nueva" })).status, 409);
        // Every child mutation is rejected by the API while closed, not only hidden in the UI.
        assert.equal((await doc1("POST", `/api/piar/${piarId}/barreras`, barrier)).status, 409);
        assert.equal((await doc1("POST", `/api/piar/${piarId}/ajustes`, adjustment)).status, 409);
        assert.equal((await doc1("PUT", `/api/piar/${piarId}/ajustes/${adjustmentId}`, { ...adjustment, estrategia: "Cambio" })).status, 409);
        assert.equal((await doc1("POST", `/api/piar/${piarId}/ajustes/${adjustmentId}/evidencias`, evidence)).status, 409);
        assert.equal((await psico("POST", "/api/diagnosticos", diagnosis)).status, 409);
        assert.equal((await psico("POST", "/api/observaciones", note)).status, 409);
        assert.equal((await coord("POST", "/api/seguimientos", followUp)).status, 409);
        assert.equal((await coord("PUT", `/api/piar/${piarId}`, { objetivo_general: "x", justificacion: "x" })).status, 409);
        const [[closedCounts]] = await db.query("SELECT (SELECT COUNT(*) FROM piar_barrera WHERE id_piar = ?) AS barreras, (SELECT COUNT(*) FROM piar_ajuste WHERE id_piar = ?) AS ajustes, (SELECT COUNT(*) FROM observacion WHERE id_piar = ?) AS observaciones", [piarId, piarId, piarId]);
        assert.deepEqual([Number(closedCounts.barreras), Number(closedCounts.ajustes), Number(closedCounts.observaciones)], [1, 1, 1]);
        assert.equal((await rector("POST", `/api/piar/${piarId}/reapertura`, { justificacion: "x" })).status, 403);
        assert.equal((await coord("POST", `/api/piar/${piarId}/reapertura`, { justificacion: "Nueva valoración" })).status, 200);

        // Report persistence (migration 014): saved with author/student, deduplicated, scoped, historic.
        const [[reportColumns]] = await db.query("SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reporte' AND COLUMN_NAME = 'contenido_hash'");
        const reportRequest = { tipo: "Seguimiento individual", id_piar: piarId, periodo: "2026-1" };
        if (Number(reportColumns.total) === 1) {
            const saved = await doc1("POST", "/api/reportes", reportRequest);
            assert.equal(saved.status, 201, JSON.stringify(saved.body));
            const again = await doc1("POST", "/api/reportes", reportRequest);
            assert.deepEqual(again.body.data, { id_reporte: saved.body.data.id_reporte, duplicado: true });
            assert.equal((await doc2("POST", "/api/reportes", reportRequest)).status, 404);
            const history = await coord("GET", `/api/reportes?estudiante=${studentId}`);
            const row = history.body.data.find(item => item.id_reporte === saved.body.data.id_reporte);
            assert.equal(row.id_usuario, users.doc1.id);
            assert.equal(row.id_estudiante, studentId);
            const detail = await psico("GET", `/api/reportes/${saved.body.data.id_reporte}`);
            assert.equal(detail.body.data.contenido.piar.id_piar, piarId);
            assert.equal((await doc2("GET", `/api/reportes/${saved.body.data.id_reporte}`)).status, 404);
        } else {
            assert.equal((await doc1("POST", "/api/reportes", reportRequest)).status, 503);
        }

        // Role reads: Rector, Administración and Psicóloga read institutional data.
        assert.equal((await rector("GET", "/api/piar")).status, 200);
        assert.equal((await admin("GET", "/api/usuarios")).status, 200);
        assert.equal((await coord("GET", "/api/usuarios")).status, 403);
        assert.equal((await psico("GET", "/api/estudiantes")).status, 200);
        assert.equal((await psico("POST", "/api/estudiantes", { nombres: "X", apellidos: "Y", documento: "E2E-PSI" })).status, 403);
        assert.equal((await psico("GET", "/api/auth/me")).status, 200);
        assert.equal((await coord("GET", "/api/reportes")).status, 200);
        assert.equal((await doc1("GET", "/api/dashboard/resumen")).status, 200);

        // Estudiante is not representable in the schema and cannot self-register.
        const studentRole = await client()("POST", "/api/auth/register", { nombre: "A", apellidos: "B", documento: "E2E-X", correo: "e2e-x@example.invalid", password: PASSWORD, rol: "Estudiante" });
        assert.equal(studentRole.status, 400);

        // Anti-lockout behind a trusted proxy: an attacker exhausting its
        // (IP, account) budget does not block the owner from another address.
        const attacker = client("198.51.100.66");
        for (let attempt = 0; attempt < 5; attempt += 1) {
            assert.equal((await attacker("POST", "/api/auth/login", { correo: users.rector.correo, password: "contraseña incorrecta" })).status, 401);
        }
        assert.equal((await attacker("POST", "/api/auth/login", { correo: users.rector.correo, password: PASSWORD })).status, 429);
        await login(users.rector, "203.0.113.10");
        const [[limits]] = await db.query("SELECT COUNT(*) AS total FROM limite_solicitudes");
        assert.ok(Number(limits.total) > 0, "RATE_LIMIT_STORE=mysql debe persistir contadores");
        const [[events]] = await db.query("SELECT SUM(tipo = 'login_fallido') AS fallidos, SUM(tipo = 'login_bloqueado') AS bloqueados, SUM(red_origen = '198.51.100.0/24') AS atacante FROM evento_seguridad");
        assert.ok(Number(events.fallidos) >= 5 && Number(events.bloqueados) >= 1 && Number(events.atacante) >= 6);

        // Account administration: self-deactivation is blocked, deactivation
        // revokes sessions, reactivation restores access, all audited.
        assert.equal((await admin("DELETE", `/api/usuarios/${users.admin.id}`)).status, 409);
        assert.equal((await coord("DELETE", `/api/usuarios/${users.doc2.id}`)).status, 403);
        assert.equal((await admin("PUT", `/api/usuarios/${users.doc2.id}`, { correo: users.doc1.correo })).status, 409);
        assert.equal((await admin("PUT", `/api/usuarios/${users.doc2.id}`, { correo: "no-es-correo" })).status, 400);
        assert.equal((await admin("DELETE", `/api/usuarios/${users.doc2.id}`)).status, 200);
        assert.equal((await doc2("GET", "/api/auth/me")).status, 401);
        assert.equal((await admin("POST", `/api/usuarios/${users.doc2.id}/reactivacion`, {})).status, 200);
        await login(users.doc2);
        const [[adminAudit]] = await db.query("SELECT SUM(operation = 'account_deactivated') AS deactivated, SUM(operation = 'account_reactivated') AS reactivated FROM admin_account_audit WHERE target_user_id = ?", [users.doc2.id]);
        assert.equal(Number(adminAudit.deactivated), 1);
        assert.equal(Number(adminAudit.reactivated), 1);

        // Edición parcial: un campo opcional se puede vaciar; uno obligatorio no.
        assert.equal((await coord("PUT", `/api/piar/${piarId}`, { metas: "Meta temporal", justificacion: "Registrar meta" })).status, 200);
        assert.equal((await coord("PUT", `/api/piar/${piarId}`, { metas: "", justificacion: "Retirar meta" })).status, 200);
        const [[clearedPiar]] = await db.query("SELECT metas, titulo FROM piar WHERE id_piar = ?", [piarId]);
        assert.equal(clearedPiar.metas, null);
        assert.equal((await coord("PUT", `/api/piar/${piarId}`, { titulo: "", justificacion: "x" })).status, 400);
        assert.equal((await coord("PUT", `/api/piar/${piarId}`, { fecha_revision: "31/12/2026", justificacion: "x" })).status, 400);
        assert.equal(clearedPiar.titulo, "PIAR e2e");

        // Registro público (D2) con aprobación manual: sin enlace de verificación, pendiente sin acceso,
        // aprobación por Rector (perfiles no Rector) o Administrador, y rechazo con motivo.
        const visitor = client();
        const applicant = { nombre: "Paula", apellidos: "Psicologa Sintetica", documento: "E2E-PSI-REG", correo: "e2e-psi@example.invalid", password: PASSWORD, rol: "Psicóloga" };
        const mailsBeforeRegistration = MAILBOX.messages.length;
        assert.equal((await visitor("POST", "/api/auth/register", applicant)).status, 202);
        assert.equal((await visitor("POST", "/api/auth/register", { ...applicant, rol: "Administrador" })).status, 400);
        assert.equal(MAILBOX.messages.length, mailsBeforeRegistration, "el registro no envía enlace de verificación");
        assert.notEqual((await client()("POST", "/api/auth/login", { correo: applicant.correo, password: PASSWORD })).status, 200, "pendiente no ingresa");
        const [[pendingUser]] = await db.query("SELECT id_usuario, estado, correo_verificado_at FROM usuario WHERE correo = ?", [applicant.correo]);
        assert.equal(pendingUser.estado, "pendiente");
        assert.equal(pendingUser.correo_verificado_at, null);
        const [[tokens]] = await db.query("SELECT COUNT(*) AS total FROM verificacion_correo WHERE id_usuario = ?", [pendingUser.id_usuario]);
        assert.equal(Number(tokens.total), 0);
        const rectorRequests = await rector("GET", "/api/usuarios/solicitudes");
        assert.equal(rectorRequests.status, 200);
        assert.ok(rectorRequests.body.data.some(item => item.id_usuario === pendingUser.id_usuario));
        assert.equal((await rector("GET", "/api/usuarios")).status, 403, "el Rector no administra cuentas");
        assert.equal((await coord("GET", "/api/usuarios/solicitudes")).status, 403);
        assert.equal((await coord("POST", `/api/usuarios/${pendingUser.id_usuario}/aprobacion`, { decision: "aprobar" })).status, 403);
        const approved = await rector("POST", `/api/usuarios/${pendingUser.id_usuario}/aprobacion`, { decision: "aprobar" });
        assert.equal(approved.status, 200, JSON.stringify(approved.body));
        assert.equal(approved.body.notificacion, "enviada");
        assert.ok(MAILBOX.messages.some(item => item.to === applicant.correo && /aprobada/.test(item.subject)));
        const [[approvedUser]] = await db.query("SELECT estado, correo_verificado_at, aprobado_por_usuario_id, decision_at FROM usuario WHERE id_usuario = ?", [pendingUser.id_usuario]);
        assert.equal(approvedUser.estado, "activo");
        assert.equal(approvedUser.correo_verificado_at, null, "aprobar no marca el correo como verificado");
        assert.equal(Number(approvedUser.aprobado_por_usuario_id), users.rector.id);
        assert.ok(approvedUser.decision_at);
        let newPsico = await login({ correo: applicant.correo, rol: "Psicóloga" });
        assert.equal((await newPsico("GET", "/api/piar")).status, 200);
        // Una cuenta aprobada sin correo verificado se puede desactivar y reactivar; inactiva no ingresa.
        assert.equal((await admin("DELETE", `/api/usuarios/${pendingUser.id_usuario}`)).status, 200);
        assert.equal((await client()("POST", "/api/auth/login", { correo: applicant.correo, password: PASSWORD })).status, 401, "inactiva no ingresa");
        assert.equal((await admin("POST", `/api/usuarios/${pendingUser.id_usuario}/reactivacion`, {})).status, 200);
        newPsico = await login({ correo: applicant.correo, rol: "Psicóloga" });

        // Registro de Coordinador aprobado por el Administrador; nadie decide su propia cuenta.
        const coordApplicant = { nombre: "Ciro", apellidos: "Coordinador Sintetico", documento: "E2E-COO-REG", correo: "e2e-coo@example.invalid", password: PASSWORD, rol: "Coordinador" };
        assert.equal((await visitor("POST", "/api/auth/register", coordApplicant)).status, 202);
        assert.notEqual((await client()("POST", "/api/auth/login", { correo: coordApplicant.correo, password: PASSWORD })).status, 200, "pendiente no ingresa");
        const [[coordRequest]] = await db.query("SELECT id_usuario, estado FROM usuario WHERE correo = ?", [coordApplicant.correo]);
        assert.equal(coordRequest.estado, "pendiente");
        assert.equal((await admin("POST", `/api/usuarios/${users.admin.id}/aprobacion`, { decision: "aprobar" })).status, 403, "autoaprobación del Administrador");
        assert.equal((await rector("POST", `/api/usuarios/${users.rector.id}/aprobacion`, { decision: "aprobar" })).status, 403, "autoaprobación del Rector");
        const coordApproved = await admin("POST", `/api/usuarios/${coordRequest.id_usuario}/aprobacion`, { decision: "aprobar" });
        assert.equal(coordApproved.status, 200, JSON.stringify(coordApproved.body));
        const [[coordDecision]] = await db.query("SELECT estado, correo_verificado_at, aprobado_por_usuario_id FROM usuario WHERE id_usuario = ?", [coordRequest.id_usuario]);
        assert.deepEqual([coordDecision.estado, coordDecision.correo_verificado_at, Number(coordDecision.aprobado_por_usuario_id)], ["activo", null, users.admin.id]);
        await login({ correo: coordApplicant.correo, rol: "Coordinador" });

        const rejectedApplicant = { ...applicant, nombre: "Rene", documento: "E2E-REC-REG", correo: "e2e-rec@example.invalid", rol: "Rector" };
        assert.equal((await visitor("POST", "/api/auth/register", rejectedApplicant)).status, 202);
        const [[rejectedUser]] = await db.query("SELECT id_usuario FROM usuario WHERE correo = ?", [rejectedApplicant.correo]);
        assert.equal((await rector("GET", "/api/usuarios/solicitudes")).body.data.some(item => item.id_usuario === rejectedUser.id_usuario), false, "el Rector no ve solicitudes de perfil Rector");
        assert.equal((await rector("POST", `/api/usuarios/${rejectedUser.id_usuario}/aprobacion`, { decision: "aprobar" })).status, 403, "las solicitudes de perfil Rector las decide el Administrador");
        assert.equal((await admin("POST", `/api/usuarios/${rejectedUser.id_usuario}/aprobacion`, { decision: "rechazar" })).status, 400, "el rechazo exige motivo");
        assert.equal((await admin("POST", `/api/usuarios/${rejectedUser.id_usuario}/aprobacion`, { decision: "rechazar", reason: "Documento no corresponde" })).status, 200);
        const rejectionMail = MAILBOX.messages.find(item => item.to === rejectedApplicant.correo && /no fue aprobada/.test(item.subject));
        assert.ok(rejectionMail);
        assert.doesNotMatch(rejectionMail.text, /Documento no corresponde/, "el aviso no expone el motivo interno");
        assert.notEqual((await client()("POST", "/api/auth/login", { correo: rejectedApplicant.correo, password: PASSWORD })).status, 200);
        const [[decisions]] = await db.query("SELECT SUM(operation = 'registration_approved') AS aprobadas, SUM(operation = 'registration_rejected') AS rechazadas FROM admin_account_audit");
        assert.equal(Number(decisions.aprobadas), 2, "Psicóloga por el Rector y Coordinador por el Administrador");
        assert.equal(Number(decisions.rechazadas), 1);

        // Cambio de correo (D1, migración 016): el correo actual sigue vigente hasta confirmar.
        const changedEmail = "e2e-psi-nuevo@example.invalid";
        const changeRequest = await admin("PUT", `/api/usuarios/${pendingUser.id_usuario}`, { correo: changedEmail });
        assert.equal(changeRequest.status, 202, JSON.stringify(changeRequest.body));
        assert.equal((await newPsico("GET", "/api/auth/me")).status, 200, "el correo actual sigue vigente");
        assert.equal((await visitor("POST", "/api/auth/email-change/confirm", { token: lastToken(changedEmail, "verify-email-change") })).status, 200);
        assert.equal((await newPsico("GET", "/api/auth/me")).status, 401, "confirmar el cambio revoca las sesiones");
        assert.notEqual((await client()("POST", "/api/auth/login", { correo: applicant.correo, password: PASSWORD })).status, 200);
        await login({ correo: changedEmail, rol: "Psicóloga" });
        // Confirmar el enlace enviado a la dirección nueva sí verifica esa dirección.
        const [[changedUser]] = await db.query("SELECT correo, correo_verificado_at FROM usuario WHERE id_usuario = ?", [pendingUser.id_usuario]);
        assert.equal(changedUser.correo, changedEmail);
        assert.ok(changedUser.correo_verificado_at);

        // Cuenta Estudiante (D7): la crea el Administrador, vinculada y con autorización del acudiente.
        const studentAccount = { nombre: "Estudiante", apellidos: "Sintetico", documento: "E2E-EST-1", correo: "e2e-est@example.invalid", password: PASSWORD, rol: "Estudiante", id_estudiante: studentId };
        assert.equal((await coord("POST", "/api/usuarios", { ...studentAccount, autorizacion_acudiente: true })).status, 403);
        assert.equal((await admin("POST", "/api/usuarios", studentAccount)).status, 400, "sin autorización del acudiente");
        const createdStudentAccount = await admin("POST", "/api/usuarios", { ...studentAccount, autorizacion_acudiente: true });
        assert.equal(createdStudentAccount.status, 201, JSON.stringify(createdStudentAccount.body));
        const secondLink = await admin("POST", "/api/usuarios", { ...studentAccount, documento: "E2E-EST-1B", correo: "e2e-est2@example.invalid", autorizacion_acudiente: true });
        assert.equal(secondLink.status, 409, "un estudiante tiene una sola cuenta");
        const adminStudents = await admin("GET", "/api/estudiantes");
        assert.equal(adminStudents.body.find(item => Number(item.id) === studentId).cuenta_vinculada, true);
        assert.equal((await coord("GET", "/api/estudiantes")).body.find(item => Number(item.id) === studentId).cuenta_vinculada, undefined);
        // La cuenta Estudiante conserva la verificación obligatoria: sin confirmar el correo no ingresa.
        const [[studentBefore]] = await db.query("SELECT estado, correo_verificado_at FROM usuario WHERE correo = ?", [studentAccount.correo]);
        assert.deepEqual([studentBefore.estado, studentBefore.correo_verificado_at], ["pendiente_verificacion", null]);
        assert.notEqual((await client()("POST", "/api/auth/login", { correo: studentAccount.correo, password: PASSWORD })).status, 200, "Estudiante sin verificar no ingresa");
        assert.equal((await rector("GET", "/api/usuarios/solicitudes")).body.data.some(item => item.rol === "Estudiante"), false, "la cuenta Estudiante no pasa por Solicitudes");
        assert.equal((await visitor("POST", "/api/auth/email-verification/confirm", { token: lastToken(studentAccount.correo, "verify-email") })).status, 200);
        const learner = await login({ correo: studentAccount.correo, rol: "Estudiante" });
        assert.equal((await learner("GET", "/api/piar")).status, 403, "contraseña temporal: debe cambiarla primero");
        const newStudentPassword = "Frase propia del estudiante 2026";
        assert.equal((await learner("POST", "/api/auth/initial-password-change", { password: newStudentPassword })).status, 200);
        const learnerSession = client();
        assert.equal((await learnerSession("POST", "/api/auth/login", { correo: studentAccount.correo, password: newStudentPassword })).status, 200);
        const ownList = await learnerSession("GET", "/api/piar");
        assert.equal(ownList.status, 200);
        const ownPiars = ownList.body.data || ownList.body;
        assert.ok(ownPiars.length >= 1 && ownPiars.every(item => Number(item.id_estudiante ?? item.studentId) === studentId));
        const ownDetail = await learnerSession("GET", `/api/piar/${piarId}`);
        assert.equal(ownDetail.status, 200);
        assert.doesNotMatch(JSON.stringify(ownDetail.body), /diagnostic|observacion|seguimiento|informes_salud/i);
        const otherStudent = await coord("POST", "/api/estudiantes", { nombres: "Otro", apellidos: "Sintetico", documento: "E2E-EST-2", grado: "Quinto", discapacidad: "Discapacidad visual", jornada: "Mañana" });
        const otherStudentId = Number(otherStudent.body.data?.id ?? otherStudent.body.id ?? otherStudent.body.data?.id_estudiante);
        const otherPiar = await coord("POST", "/api/piar", { id_estudiante: otherStudentId, titulo: "PIAR ajeno", periodo: "2026-1", anio: 2026, id_docente: users.doc1.teacherId, es_responsable_principal: true });
        const otherPiarId = Number(otherPiar.body.data?.id ?? otherPiar.body.data?.id_piar ?? otherPiar.body.id);
        assert.equal((await learnerSession("GET", `/api/piar/${otherPiarId}`)).status, 404, "PIAR ajeno igual que inexistente");
        assert.equal((await learnerSession("GET", "/api/piar/999999")).status, 404);
        for (const route of ["/api/diagnosticos", "/api/observaciones", "/api/seguimientos", "/api/estudiantes", "/api/usuarios", "/api/reportes", `/api/piar/${piarId}/versiones`]) {
            assert.equal((await learnerSession("GET", route)).status, 403, route);
        }
        assert.equal((await learnerSession("PUT", `/api/piar/${piarId}`, { objetivo_general: "x", justificacion: "x" })).status, 403);
        const [[studentAudit]] = await db.query("SELECT COUNT(*) AS total FROM admin_account_audit WHERE operation = 'account_created' AND authorization_reference = 'autorizacion_acudiente_confirmada'");
        assert.equal(Number(studentAudit.total), 1);

        // Persistence across a backend restart (data and sessions live in MySQL).
        await stopServer(server);
        server = await startServer(config);
        const after = await coord("GET", `/api/piar/${piarId}`);
        assert.equal(after.status, 200, "la sesión debe sobrevivir al reinicio");
        assert.equal(after.body.data.objetivo_general, "Objetivo actualizado");
        assert.equal(after.body.data.estado, "revision");
        assert.equal(after.body.data.teacherId, users.doc1.teacherId);
        assert.deepEqual(after.body.data.dua.map(item => item.principio).sort(), ["accion_expresion", "representacion"]);
        assert.match(after.body.data.dua.find(item => item.principio === "representacion").estrategia, /audio/);
        const studentAfter = await coord("GET", `/api/estudiantes/${studentId}`);
        assert.equal(studentAfter.status, 200);

        // Logout revokes the session server-side.
        assert.equal((await coord("POST", "/api/auth/logout")).status, 200);
        assert.equal((await coord("GET", "/api/auth/me")).status, 401);
    } finally {
        await stopServer(server);
        await db.end();
        await new Promise(resolve => mailbox.close(resolve));
    }
});
