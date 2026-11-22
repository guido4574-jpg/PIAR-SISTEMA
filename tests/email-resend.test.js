"use strict";

// Transporte Resend (API HTTPS) contra un servidor local que imita la API documentada
// (POST /emails, GET /domains). Sin red externa ni correos reales.
const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const email = require("../backend/email");
const { assertRuntimeConfig, productionConfigReport } = require("../backend/production-config");

// Clave ficticia armada en tiempo de ejecución para que el archivo no contenga una clave literal.
const FAKE_KEY = ["re", "Prueba1234567890ABCDEFxyz"].join("_");

async function withEnv(values, action) {
    const previous = {};
    for (const [key, value] of Object.entries(values)) {
        previous[key] = process.env[key];
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    try { return await action(); } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
}

// Servidor que imita Resend. handler(request, body) devuelve { status, json, headers, raw, hang }.
async function fakeResend(handler) {
    const requests = [];
    const server = http.createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = chunks.length ? Buffer.concat(chunks).toString("utf8") : "";
        requests.push({ method: request.method, url: request.url, headers: request.headers, body: body ? JSON.parse(body) : null });
        const result = await handler(request, body);
        if (result.hang) return; // nunca responde: simula un tiempo de espera
        response.writeHead(result.status, { "Content-Type": "application/json", ...(result.headers || {}) });
        response.end(result.raw !== undefined ? result.raw : JSON.stringify(result.json || {}));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    return { url, requests, close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }) };
}

function resendEnv(url, extra = {}) {
    return { NODE_ENV: "test", EMAIL_TRANSPORT: "resend", RESEND_API_KEY: FAKE_KEY, RESEND_API_BASE_URL: url, EMAIL_FROM: "piar@example.invalid", EMAIL_FROM_NAME: "PIAR Colegio", EMAIL_TIMEOUT_MS: "2000", ...extra };
}

async function captureConsoleError(action) {
    const lines = [];
    const original = console.error;
    console.error = (...args) => lines.push(args.join(" "));
    try { await action(); } finally { console.error = original; }
    return lines.join("\n");
}

test("Resend: envía por POST /emails con Bearer, User-Agent, JSON y remitente con nombre", async t => {
    const api = await fakeResend(() => ({ status: 200, json: { id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" } }));
    t.after(api.close);
    const result = await withEnv(resendEnv(api.url), () => email.deliverEmail("persona@example.invalid", "Asunto de prueba", "Cuerpo del mensaje"));
    assert.deepEqual(result, { id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" });
    assert.equal(api.requests.length, 1);
    const [request] = api.requests;
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/emails");
    assert.equal(request.headers.authorization, `Bearer ${FAKE_KEY}`);
    assert.match(request.headers["content-type"], /^application\/json/);
    assert.equal(request.headers["user-agent"], email.RESEND_USER_AGENT);
    assert.deepEqual(request.body, { from: "PIAR Colegio <piar@example.invalid>", to: ["persona@example.invalid"], subject: "Asunto de prueba", text: "Cuerpo del mensaje" });
});

test("Resend: las respuestas fallidas dan un diagnóstico depurado, sin clave ni destinatario", async t => {
    const cases = [
        [403, { statusCode: 403, name: "validation_error", message: "The example.invalid domain is not verified." }, {}, /dominio de EMAIL_FROM no está verificado/],
        [401, { statusCode: 401, name: "missing_api_key", message: "Missing API Key" }, {}, /revisa RESEND_API_KEY/],
        [429, { statusCode: 429, name: "rate_limit_exceeded", message: "Too many requests" }, { "retry-after": "2" }, /límite de velocidad/],
        [429, { statusCode: 429, name: "daily_quota_exceeded", message: "quota" }, {}, /cuota diaria/],
        [500, { statusCode: 500, name: "application_error", message: "Internal" }, {}, /Error temporal de Resend/]
    ];
    for (const [status, json, headers, hint] of cases) {
        const api = await fakeResend(() => ({ status, json, headers }));
        let failure;
        const logged = await captureConsoleError(() => withEnv(resendEnv(api.url), async () => {
            failure = await email.deliverEmail("persona@example.invalid", "Asunto", "Cuerpo").then(() => null, error => error);
        }));
        await api.close();
        assert.ok(failure instanceof email.EmailTransportError, `HTTP ${status}`);
        assert.equal(failure.diagnostic.provider, "resend");
        assert.equal(failure.diagnostic.responseCode, status);
        assert.equal(failure.diagnostic.name, json.name);
        if (headers["retry-after"]) assert.equal(failure.diagnostic.retryAfterSeconds, 2);
        assert.match(email.describeSmtpDiagnostic(failure.diagnostic), hint);
        const exposed = JSON.stringify({ message: failure.message, diagnostic: failure.diagnostic, logged });
        assert.doesNotMatch(exposed, new RegExp(FAKE_KEY));
        assert.doesNotMatch(exposed, /persona@example\.invalid|is not verified|Missing API Key/);
        assert.match(logged, new RegExp(`HTTP ${status}`));
    }
});

test("Resend: un cuerpo de error no JSON y una respuesta sin id se rechazan", async t => {
    const broken = await fakeResend(() => ({ status: 502, raw: "<html>Bad gateway</html>" }));
    const failure = await captureConsoleError(() => withEnv(resendEnv(broken.url), () => assert.rejects(email.deliverEmail("persona@example.invalid", "A", "B"), error => error.diagnostic.responseCode === 502 && error.diagnostic.name === null)));
    await broken.close();
    assert.match(failure, /HTTP 502/);
    const noId = await fakeResend(() => ({ status: 200, json: {} }));
    t.after(noId.close);
    await withEnv(resendEnv(noId.url), () => assert.rejects(email.deliverEmail("persona@example.invalid", "A", "B"), error => error.diagnostic.code === "EINVALIDRESPONSE"));
});

test("Resend: tiempo de espera y conexión rechazada", async t => {
    const slow = await fakeResend(() => ({ hang: true }));
    t.after(slow.close);
    const started = Date.now();
    await withEnv(resendEnv(slow.url, { EMAIL_TIMEOUT_MS: "200" }), () =>
        assert.rejects(email.deliverEmail("persona@example.invalid", "A", "B"), error => error.diagnostic.code === "ETIMEDOUT" && /no respondió a tiempo/.test(error.message)));
    assert.ok(Date.now() - started < 3000, "el tiempo de espera se respeta");

    const closed = await fakeResend(() => ({ status: 200, json: { id: "x" } }));
    const url = closed.url;
    await closed.close();
    await withEnv(resendEnv(url), () => assert.rejects(email.deliverEmail("persona@example.invalid", "A", "B"), error => error.diagnostic.code === "ECONNECTION"));
    await withEnv(resendEnv(url, { EMAIL_TIMEOUT_MS: "50" }), () => assert.rejects(email.deliverEmail("persona@example.invalid", "A", "B"), /EMAIL_TIMEOUT_MS/));
});

test("Resend: sin credencial o con remitente inválido no se hace ninguna petición", async t => {
    const api = await fakeResend(() => ({ status: 200, json: { id: "x" } }));
    t.after(api.close);
    const invalid = [
        [{ RESEND_API_KEY: undefined }, /falta RESEND_API_KEY/],
        [{ RESEND_API_KEY: "sk_no_es_de_resend_1234567890" }, /falta RESEND_API_KEY o su formato/],
        [{ EMAIL_FROM: undefined }, /sender is not configured/],
        [{ EMAIL_FROM: "piar@example.invalid\r\nBcc: x@example.invalid" }, /sender is not configured/],
        [{ EMAIL_FROM_NAME: "PIAR <falso@example.invalid>" }, /EMAIL_FROM_NAME no es válido/]
    ];
    for (const [overrides, expected] of invalid) {
        await withEnv(resendEnv(api.url, overrides), () => assert.rejects(email.deliverEmail("persona@example.invalid", "A", "B"), expected));
    }
    await withEnv(resendEnv(api.url), () => assert.rejects(email.deliverEmail("bad\r\nBcc:attacker@example.invalid", "A", "B"), /recipient is invalid/));
    assert.equal(api.requests.length, 0);
});

test("Resend: solo la API oficial por HTTPS fuera de las pruebas locales", () => {
    const base = { RESEND_API_KEY: FAKE_KEY, EMAIL_FROM: "piar@example.invalid" };
    assert.equal(email.resendSettings({ ...base }).origin, email.RESEND_API_ORIGIN);
    assert.throws(() => email.resendSettings({ ...base, RESEND_API_BASE_URL: "http://api.example.invalid" }), /oficial por HTTPS/);
    assert.throws(() => email.resendSettings({ ...base, NODE_ENV: "production", RESEND_API_BASE_URL: "https://otro.example.invalid" }), /oficial por HTTPS/);
    assert.throws(() => email.resendSettings({ ...base, NODE_ENV: "production", RESEND_API_BASE_URL: "http://127.0.0.1:9" }), /oficial por HTTPS/);
    assert.equal(email.resendSender({ EMAIL_FROM: "piar@example.invalid" }), "piar@example.invalid");
});

test("Resend: configuración persistente y de producción", () => {
    assert.equal(email.assertPersistentEmailTransport({ EMAIL_TRANSPORT: "resend", RESEND_API_KEY: FAKE_KEY, EMAIL_FROM: "piar@example.invalid" }), "resend");
    assert.throws(() => email.assertPersistentEmailTransport({ EMAIL_TRANSPORT: "resend", EMAIL_FROM: "piar@example.invalid" }), /RESEND_API_KEY/);
    const production = {
        NODE_ENV: "production", APP_BASE_URL: "https://piar.example.invalid", CORS_ORIGIN: "https://piar.example.invalid",
        DB_HOST: "mysql.railway.internal", DB_NAME: "piar_produccion", TRUSTED_PROXIES: "100.64.0.0/10", RATE_LIMIT_STORE: "mysql",
        EMAIL_TRANSPORT: "resend", RESEND_API_KEY: FAKE_KEY, EMAIL_FROM: "piar@example.invalid"
    };
    assert.deepEqual(assertRuntimeConfig(production), []);
    assert.throws(() => assertRuntimeConfig({ ...production, RESEND_API_KEY: "" }), /EMAIL_TRANSPORT=resend/);
    const warnings = productionConfigReport({ ...production, EMAIL_FROM: "onboarding@resend.dev" }).warnings;
    assert.ok(warnings.some(item => /remitente de prueba de Resend/.test(item)));
    assert.doesNotMatch(JSON.stringify(productionConfigReport({ ...production, RESEND_API_KEY: "" })), new RegExp(FAKE_KEY));
});

test("Resend: verificación del dominio remitente sin enviar correo", async t => {
    const domains = { data: [{ id: "d1", name: "example.invalid", status: "verified" }, { id: "d2", name: "pendiente.invalid", status: "pending" }] };
    const api = await fakeResend(request => request.headers.authorization === `Bearer ${FAKE_KEY}` && request.url === "/domains" ? { status: 200, json: domains } : { status: 404, json: {} });
    t.after(api.close);
    assert.deepEqual(await email.verifyResendSender(resendEnv(api.url)), { domain: "example.invalid", status: "verified", sendsOnlyToAccountOwner: false });
    assert.equal((await email.verifyResendSender(resendEnv(api.url, { EMAIL_FROM: "piar@pendiente.invalid" }))).status, "pending");
    assert.equal((await email.verifyResendSender(resendEnv(api.url, { EMAIL_FROM: "piar@otro.invalid" }))).status, "no_registrado");
    assert.ok(api.requests.every(request => request.method === "GET" && request.url === "/domains"));
    const before = api.requests.length;
    assert.deepEqual(await email.verifyResendSender(resendEnv(api.url, { EMAIL_FROM: "onboarding@resend.dev" })), { domain: "resend.dev", status: "prueba", sendsOnlyToAccountOwner: true });
    assert.equal(api.requests.length, before, "el remitente de prueba no consulta la API");

    const restricted = await fakeResend(() => ({ status: 401, json: { name: "restricted_api_key", message: "This API key is restricted to only send emails." } }));
    t.after(restricted.close);
    await assert.rejects(email.verifyResendSender(resendEnv(restricted.url)), error => error.diagnostic.name === "restricted_api_key"
        && /solo envío/.test(email.describeSmtpDiagnostic(error.diagnostic)));
});

test("probar-correo: con Resend, --verificar comprueba el dominio y el envío informa el id", async () => {
    const { main, configurationSummary } = require("../scripts/probar-correo");
    const env = { EMAIL_TRANSPORT: "resend", RESEND_API_KEY: FAKE_KEY, EMAIL_FROM: "piar@example.invalid" };
    const summary = configurationSummary(env);
    assert.equal(summary.transporte, "resend");
    assert.equal(summary.clave, "configurada");
    assert.doesNotMatch(JSON.stringify(summary), new RegExp(FAKE_KEY));
    const logs = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = message => logs.push(String(message));
    console.warn = message => logs.push(String(message));
    try {
        const deps = { verifySmtpTransport: async () => assert.fail("no aplica"), verifyResendSender: async () => ({ domain: "example.invalid", status: "verified", sendsOnlyToAccountOwner: false }), deliverEmail: async () => ({ id: "abc-123" }) };
        assert.equal((await main(["--verificar"], env, deps)).verified, true);
        await assert.rejects(main(["--verificar"], env, { ...deps, verifyResendSender: async () => ({ domain: "example.invalid", status: "pending", sendsOnlyToAccountOwner: false }) }), /no está verificado/);
        assert.deepEqual(await main(["--enviar", "destino@example.invalid"], { ...env, PIAR_CONFIRMAR_ENVIO: "SI" }, deps), { sent: true });
    } finally {
        console.log = originalLog;
        console.warn = originalWarn;
    }
    assert.ok(logs.some(line => /Identificador en Resend: abc-123/.test(line)));
    assert.doesNotMatch(logs.join("\n"), new RegExp(FAKE_KEY));
});

// Doble de base de datos con transacciones (mismo patrón que auth-registration.test.js).
function dbWith(queryFn) {
    const statements = [];
    const runQuery = async (sql, values = []) => { statements.push({ sql, values }); return queryFn(sql, values); };
    const connection = { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {}, query: runQuery, execute: runQuery };
    return { statements, promise: () => ({ query: runQuery, getConnection: async () => connection }) };
}

test("flujos existentes con Resend: registro, recuperación y aviso de decisión usan el mismo transporte", async t => {
    const api = await fakeResend(() => ({ status: 200, json: { id: "flujo" } }));
    t.after(api.close);
    const auth = require("../backend/auth");
    const { notifyRegistrationDecision } = require("../backend/decision-notification");
    await withEnv({ ...resendEnv(api.url), APP_BASE_URL: "https://piar.example.invalid" }, async () => {
        const registrationDb = dbWith(async sql => {
            if (sql.startsWith("SELECT id_usuario")) return [[]];
            if (sql.startsWith("INSERT INTO usuario")) return [{ insertId: 51 }];
            return [{ affectedRows: 1 }];
        });
        const registered = await auth.register(registrationDb, { nombre: "Dana", apellidos: "Docente", documento: "RES-1", correo: "dana@example.invalid", password: "Frase sintetica resend 2026", rol: "Docente" });
        assert.equal(registered.status, 202);

        const resetDb = dbWith(async sql => sql.startsWith("SELECT id_usuario, correo FROM usuario") ? [[{ id_usuario: 51, correo: "dana@example.invalid" }]] : [{ affectedRows: 1 }]);
        assert.equal((await auth.requestPasswordReset(resetDb, "dana@example.invalid")).status, 200);
        assert.ok(!resetDb.statements.some(item => /consumed_at = CURRENT_TIMESTAMP/.test(item.sql)), "el enlace no se invalida si el envío funciona");

        assert.equal(await notifyRegistrationDecision("aprobar", { correo: "dana@example.invalid", nombre: "Dana", rol: "Docente" }, { baseUrl: "https://piar.example.invalid" }), "enviada");
    });
    const [verification, reset, decision] = api.requests.map(request => request.body);
    assert.equal(api.requests.length, 3);
    assert.match(verification.text, /https:\/\/piar\.example\.invalid\/#verify-email=/);
    assert.match(reset.text, /https:\/\/piar\.example\.invalid\/#reset=/);
    assert.match(decision.subject, /aprobada/);
    assert.ok([verification, reset, decision].every(body => body.to[0] === "dana@example.invalid" && body.from === "PIAR Colegio <piar@example.invalid>"));
});

test("flujos existentes con Resend caído: respuestas públicas iguales y enlaces invalidados", async t => {
    const api = await fakeResend(() => ({ status: 500, json: { name: "application_error", message: "down" } }));
    t.after(api.close);
    const auth = require("../backend/auth");
    const { notifyRegistrationDecision } = require("../backend/decision-notification");
    await captureConsoleError(() => withEnv({ ...resendEnv(api.url), APP_BASE_URL: "https://piar.example.invalid" }, async () => {
        const registrationDb = dbWith(async sql => {
            if (sql.startsWith("SELECT id_usuario")) return [[]];
            if (sql.startsWith("INSERT INTO usuario")) return [{ insertId: 52 }];
            return [{ affectedRows: 1 }];
        });
        const registered = await auth.register(registrationDb, { nombre: "Eli", apellidos: "Docente", documento: "RES-2", correo: "eli@example.invalid", password: "Frase sintetica resend 2026", rol: "Docente" });
        assert.equal(registered.status, 202, "el registro público responde igual aunque el correo falle");
        assert.ok(registrationDb.statements.some(item => /UPDATE verificacion_correo SET consumed_at/.test(item.sql)), "el enlace no entregado se invalida");

        const resetDb = dbWith(async sql => sql.startsWith("SELECT id_usuario, correo FROM usuario") ? [[{ id_usuario: 52, correo: "eli@example.invalid" }]] : [{ affectedRows: 1 }]);
        assert.equal((await auth.requestPasswordReset(resetDb, "eli@example.invalid")).status, 200);
        assert.ok(resetDb.statements.some(item => /UPDATE recuperacion_contrasena SET consumed_at/.test(item.sql)));

        assert.equal(await notifyRegistrationDecision("rechazar", { correo: "eli@example.invalid", nombre: "Eli", rol: "Docente" }, { baseUrl: "https://piar.example.invalid" }), "no_enviada");
    }));
});
