"use strict";

// Estudiante role: read-only access to the student's OWN PIAR, without
// diagnoses, professional observations, follow-ups, versions or reports.
// Covers the route policy, the ownership/projection module and the real HTTP
// server (backend/server.js) running against an in-memory database.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { authorizationStatus } = require("../backend/authorization");
const { STUDENT_FORBIDDEN_KEYS, resolveStudentProfile, handleStudentPortalRequest } = require("../backend/student-portal");

const ROOT = path.resolve(__dirname, "..");
const status = (method, pathname) => authorizationStatus({ rol: "Estudiante" }, method, pathname);

function collectKeys(value, keys = new Set()) {
    if (Array.isArray(value)) value.forEach(item => collectKeys(item, keys));
    else if (value && typeof value === "object") {
        for (const [key, nested] of Object.entries(value)) {
            keys.add(key);
            collectKeys(nested, keys);
        }
    }
    return keys;
}

function assertNoProfessionalData(body, label) {
    const keys = collectKeys(body);
    for (const key of STUDENT_FORBIDDEN_KEYS) assert.ok(!keys.has(key), `${label}: la respuesta no debe incluir "${key}"`);
    assert.doesNotMatch(JSON.stringify(body), /SECRETO/, `${label}: la respuesta expone información profesional o ajena`);
}

// ---------------------------------------------------------------------------
// Route policy (authorization.js)
// ---------------------------------------------------------------------------

test("Estudiante may only read the PIAR list and a PIAR detail", () => {
    assert.equal(status("GET", "/api/piar"), 200);
    assert.equal(status("GET", "/api/piar/101"), 200);
});

test("Estudiante cannot read diagnoses, observations, follow-ups or any other professional resource", () => {
    const denied = [
        "/api/diagnosticos", "/api/diagnosticos/1", "/api/observaciones", "/api/observaciones/1",
        "/api/seguimientos", "/api/seguimientos/1", "/api/historial", "/api/historial/1",
        "/api/reportes", "/api/reportes/1", "/api/dashboard/resumen",
        "/api/piar/101/versiones", "/api/piar/101/versiones/3", "/api/piar/101/docentes",
        "/api/piar/101/ajustes", "/api/piar/101/barreras", "/api/piar/101/dua", "/api/piar/101/ajustes/201/evidencias",
        "/api/estudiantes", "/api/estudiantes/11", "/api/docentes", "/api/docentes/7",
        "/api/usuarios", "/api/usuarios/501", "/api/ruta-desconocida"
    ];
    for (const pathname of denied) assert.equal(status("GET", pathname), 403, `GET ${pathname}`);
});

test("Estudiante cannot modify anything, including its own PIAR", () => {
    const mutations = [
        ["POST", "/api/piar"], ["PUT", "/api/piar/101"], ["DELETE", "/api/piar/101"], ["POST", "/api/piar/101/reapertura"],
        ["POST", "/api/piar/101/ajustes"], ["PUT", "/api/piar/101/ajustes/201"], ["DELETE", "/api/piar/101/ajustes/201"],
        ["POST", "/api/piar/101/barreras"], ["POST", "/api/piar/101/ajustes/201/evidencias"],
        ["POST", "/api/piar/101/dua"], ["PUT", "/api/piar/101/dua/501"], ["POST", "/api/piar/101/docentes"],
        ["POST", "/api/diagnosticos"], ["PUT", "/api/diagnosticos/1"], ["DELETE", "/api/diagnosticos/1"],
        ["POST", "/api/observaciones"], ["POST", "/api/seguimientos"], ["POST", "/api/reportes"],
        ["POST", "/api/estudiantes"], ["PUT", "/api/estudiantes/11"], ["DELETE", "/api/estudiantes/11"],
        ["PATCH", "/api/piar/101"]
    ];
    for (const [method, pathname] of mutations) assert.equal(status(method, pathname), 403, `${method} ${pathname}`);
});

test("Psicóloga permissions stay as approved: consults professional data, registers observations and diagnoses, never edits the PIAR", () => {
    const psy = (method, pathname) => authorizationStatus({ rol: "Psicóloga" }, method, pathname);
    for (const [method, pathname] of [["GET", "/api/estudiantes"], ["GET", "/api/piar/101"], ["GET", "/api/diagnosticos"], ["GET", "/api/seguimientos"],
        ["GET", "/api/observaciones"], ["POST", "/api/observaciones"], ["POST", "/api/diagnosticos"], ["PUT", "/api/diagnosticos/1"]]) {
        assert.equal(psy(method, pathname), 200, `${method} ${pathname}`);
    }
    for (const [method, pathname] of [["PUT", "/api/piar/101"], ["POST", "/api/piar"], ["DELETE", "/api/piar/101"], ["POST", "/api/piar/101/ajustes"],
        ["PUT", "/api/piar/101/ajustes/201"], ["DELETE", "/api/piar/101/ajustes/201"], ["POST", "/api/piar/101/dua"], ["PUT", "/api/piar/101/dua/501"],
        ["POST", "/api/piar/101/barreras"], ["POST", "/api/piar/101/ajustes/201/evidencias"], ["POST", "/api/piar/101/docentes"], ["POST", "/api/seguimientos"]]) {
        assert.equal(psy(method, pathname), 403, `${method} ${pathname}`);
    }
});

// ---------------------------------------------------------------------------
// Ownership and projection (student-portal.js)
// ---------------------------------------------------------------------------

test("student profile resolution fails closed for missing, inactive, duplicate or unmigrated links", async () => {
    assert.equal(await resolveStudentProfile(async () => [], 501), null);
    assert.equal(await resolveStudentProfile(async () => [{ id_estudiante: 11, estado: "inactivo" }], 501), null);
    assert.equal(await resolveStudentProfile(async () => [{ id_estudiante: 11, estado: "activo" }, { id_estudiante: 12, estado: "activo" }], 501), null);
    assert.equal(await resolveStudentProfile(async () => { throw Object.assign(new Error("x"), { code: "ER_BAD_FIELD_ERROR" }); }, 501), null);
    assert.equal(await resolveStudentProfile(async () => { throw new Error("must not be called"); }, "abc"), null);
    await assert.rejects(resolveStudentProfile(async () => { throw Object.assign(new Error("down"), { code: "ECONNREFUSED" }); }, 501));
    assert.deepEqual(await resolveStudentProfile(async () => [{ id_estudiante: 11, estado: "activo" }], 501), { id_estudiante: 11 });
});

test("student scope comes from the session link, never from the requested identifier", async () => {
    const calls = [];
    const query = async (sql, params) => {
        calls.push({ sql, params });
        if (/FROM estudiante WHERE id_usuario = \?/.test(sql)) return [{ id_estudiante: 11, estado: "activo" }];
        return [];
    };
    const result = await handleStudentPortalRequest({ query, userId: 501, method: "GET", pathname: "/api/piar/102" });
    assert.equal(result.status, 404);
    assert.deepEqual(calls[0].params, [501]);
    const detail = calls.find(call => /WHERE p\.id_piar = \? AND p\.id_estudiante = \?/.test(call.sql));
    assert.deepEqual(detail.params, [102, 11], "the PIAR lookup must be bound to the session student");
    assert.equal(calls.length, 2, "nothing else is queried for a PIAR outside the student's scope");
});

test("student handler denies mutations and non-PIAR routes before touching the database", async () => {
    const query = async () => { throw new Error("database must not be queried"); };
    for (const [method, pathname] of [["PUT", "/api/piar/101"], ["POST", "/api/piar"], ["DELETE", "/api/piar/101"],
        ["GET", "/api/diagnosticos"], ["GET", "/api/observaciones"], ["GET", "/api/piar/101/versiones"]]) {
        const result = await handleStudentPortalRequest({ query, userId: 501, method, pathname });
        assert.equal(result.status, 403, `${method} ${pathname}`);
    }
});

test("student projection never reads professional tables", () => {
    const source = fs.readFileSync(path.join(ROOT, "backend/student-portal.js"), "utf8");
    const sqlStrings = [...source.matchAll(/"(SELECT [^"]+)"|`(SELECT [^`]+)`/g)].map(match => match[1] || match[2]);
    assert.ok(sqlStrings.length >= 6);
    for (const sql of sqlStrings) {
        assert.doesNotMatch(sql, /\b(diagnostico|observacion|seguimiento|historial|reporte|psicologa)\b/i, sql);
        assert.doesNotMatch(sql, /informes_salud|\*/, sql);
    }
});

test("server dispatches every Estudiante request to the student portal before institutional handlers", () => {
    const server = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
    const authorizationCheck = server.indexOf("const accessStatus = authorizationStatus(sessionUser, method, path);");
    const studentDispatch = server.indexOf("if (role === STUDENT_ROLE) {");
    const firstInstitutionalHandler = server.indexOf("const approvalMatch = path.match(");
    assert.ok(authorizationCheck > 0 && studentDispatch > authorizationCheck && studentDispatch < firstInstitutionalHandler);
});

test("migration 015 adds the Estudiante role and a unique, referenced student account link", () => {
    const sql = fs.readFileSync(path.join(ROOT, "database/migrations/015_student_account_link.sql"), "utf8");
    assert.match(sql, /ENUM\(''Docente'',''Psicóloga'',''Coordinador'',''Administrador'',''Rector'',''Estudiante''\)/);
    assert.match(sql, /ADD COLUMN id_usuario INT NULL/);
    assert.match(sql, /ADD UNIQUE KEY uq_estudiante_usuario \(id_usuario\)/);
    assert.match(sql, /FOREIGN KEY \(id_usuario\) REFERENCES usuario \(id_usuario\)/);
    assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE)\b/i);
});

// ---------------------------------------------------------------------------
// Real HTTP server with an in-memory database
// ---------------------------------------------------------------------------

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

async function startFakeServer() {
    const port = await freePort();
    const child = spawn(process.execPath, [path.join(__dirname, "helpers/student-portal-fake-server.js")], {
        cwd: ROOT,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(port),
            MAINTENANCE_INTERVAL_MINUTES: "0", RATE_LIMIT_STORE: "memory", CORS_ORIGIN: `http://127.0.0.1:${port}` },
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
    return {
        sql,
        output: () => output,
        async request(method, pathname, token, body) {
            const headers = { Cookie: `piar_session=${token}` };
            if (body !== undefined) headers["Content-Type"] = "application/json";
            const response = await fetch(base + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
            return { status: response.status, body: await response.json().catch(() => ({})) };
        },
        stop() { child.kill(); }
    };
}

test("HTTP: a student only sees and reads its own PIAR, without professional information", async t => {
    const server = await startFakeServer();
    t.after(() => server.stop());
    const studentA = "token-estudiante-a";
    const studentB = "token-estudiante-b";

    await t.test("list returns only the session student's PIARs", async () => {
        const list = await server.request("GET", "/api/piar", studentA);
        assert.equal(list.status, 200);
        assert.deepEqual(list.body.data.map(piar => piar.id_piar).sort(), [101, 103]);
        assert.ok(list.body.data.every(piar => piar.id_estudiante === 11));
        assertNoProfessionalData(list.body, "lista A");

        const listB = await server.request("GET", "/api/piar", studentB);
        assert.deepEqual(listB.body.data.map(piar => piar.id_piar), [102]);
    });

    await t.test("own PIAR detail keeps pedagogical content and drops professional data", async () => {
        const detail = await server.request("GET", "/api/piar/101", studentA);
        assert.equal(detail.status, 200);
        const piar = detail.body.data;
        assert.equal(piar.id_piar, 101);
        assert.equal(piar.objetivo_general, "Objetivo A");
        assert.deepEqual(piar.estudiante, { id_estudiante: 11, nombre: "Ana Sintética" });
        assert.equal(piar.ajustes.length, 1);
        assert.equal(piar.ajustes[0].estrategia, "Material concreto A");
        assert.deepEqual(piar.ajustes[0].evidencias, [{ id_evidencia: 401, descripcion: "Evidencia A", fecha: "2026-03-01" }]);
        assert.equal(piar.barreras[0].descripcion, "Barrera A");
        assert.equal(piar.dua[0].estrategia, "Apoyo visual A");
        assert.deepEqual(piar.docentes, [{ id_docente: 7, nombre: "Docente Uno", area: "Matemáticas", es_responsable_principal: 1 }]);
        assertNoProfessionalData(detail.body, "detalle A");
        // Profile "contexto" is caught by the SECRETO sentinel; barriers legitimately have a "contexto" field.
        for (const key of ["valoracion", "documento", "id_usuario", "id_usuario_responsable", "id_usuario_registro", "autor_nombre", "referencia", "correo"]) {
            assert.ok(!collectKeys(detail.body).has(key), `detalle A no debe incluir "${key}"`);
        }
    });

    await t.test("another student's PIAR is indistinguishable from a missing one", async () => {
        const foreign = await server.request("GET", "/api/piar/102", studentA);
        const missing = await server.request("GET", "/api/piar/999", studentA);
        assert.equal(foreign.status, 404);
        assert.deepEqual(foreign.body, missing.body);
        assertNoProfessionalData(foreign.body, "PIAR ajeno");
        const reverse = await server.request("GET", "/api/piar/101", studentB);
        assert.equal(reverse.status, 404);
    });

    await t.test("professional, historical and profile routes are denied", async () => {
        for (const pathname of ["/api/diagnosticos", "/api/diagnosticos/1", "/api/observaciones", "/api/observaciones/1", "/api/seguimientos",
            "/api/historial", "/api/reportes", "/api/dashboard/resumen", "/api/piar/101/versiones", "/api/piar/101/dua", "/api/piar/101/barreras",
            "/api/piar/101/ajustes", "/api/piar/101/docentes", "/api/estudiantes", "/api/estudiantes/11", "/api/docentes"]) {
            const result = await server.request("GET", pathname, studentA);
            assert.equal(result.status, 403, pathname);
            assertNoProfessionalData(result.body, pathname);
        }
    });

    await t.test("every write is denied, including on the student's own PIAR", async () => {
        for (const [method, pathname] of [["PUT", "/api/piar/101"], ["DELETE", "/api/piar/101"], ["POST", "/api/piar"],
            ["POST", "/api/piar/101/ajustes"], ["PUT", "/api/piar/101/ajustes/201"], ["POST", "/api/piar/101/dua"],
            ["POST", "/api/observaciones"], ["POST", "/api/diagnosticos"], ["POST", "/api/reportes"], ["PUT", "/api/estudiantes/11"]]) {
            const result = await server.request(method, pathname, studentA, { titulo: "x", justificacion: "x", id_piar: 101, id_estudiante: 11 });
            assert.equal(result.status, 403, `${method} ${pathname}`);
        }
    });

    await t.test("students without an active, unique profile link get no data", async () => {
        for (const token of ["token-estudiante-perfil-inactivo", "token-estudiante-sin-vinculo"]) {
            const list = await server.request("GET", "/api/piar", token);
            assert.equal(list.status, 403, token);
            assert.equal(list.body.data, undefined);
            const detail = await server.request("GET", "/api/piar/101", token);
            assert.equal(detail.status, 403, token);
        }
    });

    await t.test("no student request queried professional tables or wrote PIAR data", () => {
        const professional = server.sql.filter(entry => entry.kind === "professional");
        assert.deepEqual(professional, [], "se consultaron tablas profesionales");
        const unhandled = server.sql.filter(entry => entry.kind === "unhandled");
        assert.deepEqual(unhandled, [], "consultas no previstas por la prueba");
        const writes = server.sql.filter(entry => /^(INSERT|UPDATE|DELETE)\b/i.test(entry.sql) && entry.kind !== "audit" && entry.kind !== "session");
        assert.deepEqual(writes, []);
        assert.ok(server.sql.some(entry => entry.kind === "audit"), "las consultas del estudiante quedan auditadas");
    });
});
