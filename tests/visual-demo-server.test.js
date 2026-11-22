"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createVisualDemoServer, DEMO_PIAR_ID, DEMO_STUDENT_ID } = require("../scripts/visual-demo-server");

async function withServer(callback) {
    const server = createVisualDemoServer();
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    try {
        await callback(`http://127.0.0.1:${address.port}`);
    } finally {
        server.closeAllConnections?.();
        await new Promise(resolve => server.close(resolve));
    }
}

test("visual demo serves the real frontend with an explicit isolated-demo banner", async () => {
    await withServer(async base => {
        const response = await fetch(base);
        const html = await response.text();
        assert.equal(response.status, 200);
        assert.match(html, /<title>PIAR/);
        assert.match(html, /DEMO VISUAL AISLADA/);
        assert.match(html, /todas las escrituras están bloqueadas/);
        assert.match(html, /visual-demo-status/);
    });
});

test("public visual mode returns an unauthenticated response and never connects to a database", async () => {
    await withServer(async base => {
        const [config, session, health] = await Promise.all([
            fetch(`${base}/api/config`),
            fetch(`${base}/api/auth/me`),
            fetch(`${base}/api/health`)
        ]);
        assert.deepEqual(await config.json(), { institution: { name: "Colegio Reinaldo Matiz" } });
        assert.equal(session.status, 401);
        assert.equal((await health.json()).database, "not-connected");
    });
});

test("synthetic Docente view exposes only fictitious assigned records", async () => {
    await withServer(async base => {
        const activation = await fetch(`${base}/visual/docente`, { redirect: "manual" });
        const cookie = activation.headers.get("set-cookie").split(";")[0];
        assert.equal(activation.status, 303);
        const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
        assert.equal((await me.json()).user.rol, "Docente");
        const [studentsResponse, teachersResponse, piarsResponse, detailResponse, versionsResponse] = await Promise.all([
            fetch(`${base}/api/estudiantes`, { headers: { Cookie: cookie } }),
            fetch(`${base}/api/docentes`, { headers: { Cookie: cookie } }),
            fetch(`${base}/api/piar`, { headers: { Cookie: cookie } }),
            fetch(`${base}/api/piar/${DEMO_PIAR_ID}`, { headers: { Cookie: cookie } }),
            fetch(`${base}/api/piar/${DEMO_PIAR_ID}/versiones`, { headers: { Cookie: cookie } })
        ]);
        const students = (await studentsResponse.json()).data;
        const teachers = (await teachersResponse.json()).data;
        const piars = (await piarsResponse.json()).data;
        const detail = (await detailResponse.json()).data;
        assert.deepEqual(students.map(row => row.id), [DEMO_STUDENT_ID]);
        assert.deepEqual(teachers.map(row => row.id_docente), [990001]);
        assert.deepEqual(piars.map(row => row.id_piar), [DEMO_PIAR_ID]);
        assert.equal(detail.id_estudiante, DEMO_STUDENT_ID);
        assert.equal(detail.docentes.length, 1);
        assert.equal((await versionsResponse.json()).data.length, 0);
        assert.match(teachers[0].correo, /\.invalid$/);
        assert.match(detail.estudiante.documento, /^DEMO-/);
    });
});

test("visual demo rejects registration and every data mutation without echoing request content", async () => {
    await withServer(async base => {
        const marker = "PRIVATE-DEMO-PAYLOAD-MUST-NOT-ECHO";
        const registration = await fetch(`${base}/api/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ correo: marker, password: marker })
        });
        const responseBody = await registration.text();
        assert.equal(registration.status, 403);
        assert.match(responseBody, /solo lectura/);
        assert.equal(responseBody.includes(marker), false);
        const mutation = await fetch(`${base}/api/piar/${DEMO_PIAR_ID}`, { method: "DELETE" });
        assert.equal(mutation.status, 403);
    });
});

// --- Vistas sintéticas por rol y política de seguridad equivalente a la real ---
const fs = require("node:fs");
const path = require("node:path");
const { CONTENT_SECURITY_POLICY } = require("../scripts/visual-demo-server");
const { STUDENT_FORBIDDEN_KEYS } = require("../backend/student-portal");

async function activate(base, route) {
    const activation = await fetch(`${base}${route}`, { redirect: "manual" });
    assert.equal(activation.status, 303);
    return { Cookie: activation.headers.get("set-cookie").split(";")[0] };
}

test("la demo envía la misma CSP que backend/server.js en las páginas y recursos", async () => {
    const server = fs.readFileSync(path.join(__dirname, "../backend/server.js"), "utf8");
    const block = server.match(/const CONTENT_SECURITY_POLICY = \[([\s\S]*?)\]\.join\("; "\);/);
    assert.ok(block, "No se encontró la CSP en backend/server.js");
    const directives = [...block[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
    assert.equal(CONTENT_SECURITY_POLICY, directives.join("; "));
    await withServer(async base => {
        for (const resource of ["/", "/css/main.css", "/fonts/poppins/poppins-latin-400-normal.woff2"]) {
            const response = await fetch(`${base}${resource}`);
            assert.equal(response.status, 200, resource);
            assert.equal(response.headers.get("content-security-policy"), CONTENT_SECURITY_POLICY, resource);
        }
        const html = await (await fetch(base)).text();
        for (const route of ["/visual/administrador", "/visual/docente", "/visual/estudiante"]) assert.match(html, new RegExp(`href="${route}"`));
    });
});

test("la vista Administrador sintética consulta cuentas ficticias para Solicitudes y Usuarios", async () => {
    await withServer(async base => {
        const headers = await activate(base, "/visual/administrador");
        const me = await (await fetch(`${base}/api/auth/me`, { headers })).json();
        assert.equal(me.user.rol, "Administrador");
        const accounts = (await (await fetch(`${base}/api/usuarios`, { headers })).json()).data;
        assert.ok(accounts.length >= 4);
        assert.ok(accounts.every(account => /\.invalid$/.test(account.correo) && /^DEMO-/.test(account.documento)));
        assert.ok(accounts.some(account => account.estado === "pendiente" && account.correo_verificado_at), "Falta una solicitud con correo verificado");
        assert.ok(accounts.some(account => account.estado === "pendiente_verificacion"), "Falta una solicitud sin verificar");
        const write = await fetch(`${base}/api/usuarios/990030/aprobacion`, { method: "POST", headers });
        assert.equal(write.status, 403);
    });
});

test("la vista Docente sintética no puede consultar la administración de cuentas", async () => {
    await withServer(async base => {
        const headers = await activate(base, "/visual/docente");
        assert.equal((await fetch(`${base}/api/usuarios`, { headers })).status, 403);
    });
});

test("la vista Estudiante sintética solo lee su PIAR con la proyección del portal estudiantil", async () => {
    await withServer(async base => {
        const headers = await activate(base, "/visual/estudiante");
        const me = await (await fetch(`${base}/api/auth/me`, { headers })).json();
        assert.equal(me.user.rol, "Estudiante");
        const list = (await (await fetch(`${base}/api/piar`, { headers })).json()).data;
        assert.deepEqual(list.map(piar => piar.id_piar), [DEMO_PIAR_ID]);
        const detail = (await (await fetch(`${base}/api/piar/${DEMO_PIAR_ID}`, { headers })).json()).data;
        for (const key of STUDENT_FORBIDDEN_KEYS) assert.equal(Object.hasOwn(detail, key), false, `El Estudiante no debe recibir ${key}`);
        assert.equal(detail.estudiante.id_estudiante, DEMO_STUDENT_ID);
        for (const route of ["/api/estudiantes", "/api/docentes", "/api/usuarios", "/api/diagnosticos", "/api/observaciones", "/api/historial", "/api/reportes", `/api/piar/${DEMO_PIAR_ID}/versiones`]) {
            assert.equal((await fetch(`${base}${route}`, { headers })).status, 403, route);
        }
    });
});

test("el estudiante sintético tiene la misma forma de datos que la API real", async () => {
    const server = fs.readFileSync(path.join(__dirname, "../backend/server.js"), "utf8");
    const mapper = server.match(/function mapStudentRowToFrontend\(row\) \{[\s\S]*?return \{([\s\S]*?)\};\n\}/);
    assert.ok(mapper, "No se encontró mapStudentRowToFrontend en backend/server.js");
    const realKeys = [...mapper[1].matchAll(/^\s*([a-zA-Z_]+):/gm)].map(match => match[1]);
    await withServer(async base => {
        const headers = await activate(base, "/visual/docente");
        const [demoStudent] = (await (await fetch(`${base}/api/estudiantes`, { headers })).json()).data;
        for (const key of ["fortalezas", "barreras", "apoyosRequeridos"]) {
            assert.ok(realKeys.includes(key), `La API real ya no devuelve ${key}`);
            assert.ok(Array.isArray(demoStudent[key]), `El estudiante sintético debe traer ${key} como lista`);
        }
    });
});

test("la demo ignora valores de cookie que no corresponden a una vista sintética", async () => {
    await withServer(async base => {
        const response = await fetch(`${base}/api/auth/me`, { headers: { Cookie: "piar_visual_demo=Administrador" } });
        assert.equal(response.status, 401);
    });
});

test("visual demo clears only its synthetic view cookie and blocks path traversal", async () => {
    await withServer(async base => {
        const logout = await fetch(`${base}/api/auth/logout`, { method: "POST", redirect: "manual" });
        assert.equal(logout.status, 200);
        assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
        const escaped = await fetch(`${base}/%2e%2e/package.json`);
        assert.equal(escaped.status, 404);
    });
});
