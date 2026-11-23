"use strict";

// Transporte Gmail API (HTTPS + OAuth 2.0) contra un servidor local que imita el endpoint de tokens
// de Google y users.messages.send. Sin red externa ni correos reales.
const assert = require("node:assert/strict");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const email = require("../backend/email");
const { assertRuntimeConfig } = require("../backend/production-config");
const probar = require("../scripts/probar-correo");
const autorizar = require("../scripts/gmail-autorizar");

// Valores ficticios armados en tiempo de ejecución (el detector de secretos no debe ver literales).
const CLIENT_ID = ["123456789012", "abcdefghijklmnop.apps.googleusercontent.com"].join("-");
const CLIENT_SECRET = ["GOCSPX", "secretoFicticio123"].join("-");
const REFRESH = ["1", "//refrescoFicticio-ABCDEFGHIJKLMNOP"].join("");
const ACCESS = ["ya29", "accesoFicticio"].join(".");

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

// handlers.token / handlers.send devuelven { status, json, headers, hang }.
async function fakeGoogle(handlers) {
    const requests = [];
    const server = http.createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString("utf8");
        const kind = request.url === "/token" ? "token" : request.url === "/gmail/v1/users/me/messages/send" ? "send" : "otro";
        requests.push({ kind, method: request.method, headers: request.headers, body });
        const result = handlers[kind] ? await handlers[kind](requests.filter(r => r.kind === kind).length) : { status: 404, json: {} };
        if (result.hang) return;
        response.writeHead(result.status, { "Content-Type": "application/json", ...(result.headers || {}) });
        response.end(JSON.stringify(result.json || {}));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    return { url, requests, close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }) };
}

function gmailEnv(url, extra = {}) {
    return {
        NODE_ENV: "test", EMAIL_TRANSPORT: "gmail", GMAIL_CLIENT_ID: CLIENT_ID, GMAIL_CLIENT_SECRET: CLIENT_SECRET, GMAIL_REFRESH_TOKEN: REFRESH,
        GMAIL_API_BASE_URL: url, GOOGLE_OAUTH_TOKEN_URL: `${url}/token`, EMAIL_FROM: "piar@example.invalid", EMAIL_FROM_NAME: "Sistema PIAR Institución",
        EMAIL_TIMEOUT_MS: "2000", ...extra
    };
}

const okToken = () => ({ status: 200, json: { access_token: ACCESS, expires_in: 3599, scope: "https://www.googleapis.com/auth/gmail.send openid https://www.googleapis.com/auth/userinfo.email", token_type: "Bearer" } });

function decodeRaw(request) {
    return Buffer.from(JSON.parse(request.body).raw, "base64url").toString("utf8");
}

async function captureConsoleError(action) {
    const lines = [];
    const original = console.error;
    console.error = (...args) => lines.push(args.join(" "));
    try { await action(); } finally { console.error = original; }
    return lines.join("\n");
}

test.beforeEach(() => email.resetGmailAccessTokenCache());

test("Gmail: renueva el acceso con el refresh token y envía un MIME UTF-8 por users.messages.send", async t => {
    const api = await fakeGoogle({ token: okToken, send: () => ({ status: 200, json: { id: "18c0ffee", threadId: "18c0ffee" } }) });
    t.after(api.close);
    await withEnv(gmailEnv(api.url), async () => {
        const text = "Confirma tu correo: https://piar.example.invalid/#verify-email=abc. Atención: ñandú.";
        const result = await email.deliverEmail("persona@example.invalid", "Verifica tu correo de PIAR — acción", text);
        assert.deepEqual(result, { id: "18c0ffee" });
        // Segundo envío: reutiliza el access token en memoria.
        await email.deliverEmail("otra@example.invalid", "Segundo", "Texto");
    });
    const tokenRequests = api.requests.filter(r => r.kind === "token");
    const sends = api.requests.filter(r => r.kind === "send");
    assert.equal(tokenRequests.length, 1);
    const form = new URLSearchParams(tokenRequests[0].body);
    assert.equal(form.get("grant_type"), "refresh_token");
    assert.equal(form.get("client_id"), CLIENT_ID);
    assert.equal(form.get("client_secret"), CLIENT_SECRET);
    assert.equal(form.get("refresh_token"), REFRESH);
    assert.equal(sends.length, 2);
    assert.equal(sends[0].method, "POST");
    assert.equal(sends[0].headers.authorization, `Bearer ${ACCESS}`);
    const mime = decodeRaw(sends[0]);
    assert.match(mime, /^From: "Sistema PIAR Institución"|^From: =\?UTF-8\?B\?/m);
    assert.match(mime, /^To: <persona@example\.invalid>$/m);
    assert.match(mime, /^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/m);
    assert.match(mime, /^Content-Type: text\/plain; charset="UTF-8"$/m);
    assert.match(mime, /^Content-Transfer-Encoding: base64$/m);
    const subjectB64 = mime.match(/^Subject: =\?UTF-8\?B\?([^?]+)\?=$/m)[1];
    assert.equal(Buffer.from(subjectB64, "base64").toString("utf8"), "Verifica tu correo de PIAR — acción");
    const bodyB64 = mime.split("\r\n\r\n")[1].replace(/\r\n/g, "");
    assert.match(Buffer.from(bodyB64, "base64").toString("utf8"), /verify-email=abc\. Atención: ñandú\./);
});

test("Gmail: el remitente con nombre ASCII va entre comillas y el encabezado no admite inyección", async () => {
    assert.equal(email.gmailSender({ EMAIL_FROM: "piar@example.invalid", EMAIL_FROM_NAME: "PIAR Colegio" }), "\"PIAR Colegio\" <piar@example.invalid>");
    assert.equal(email.gmailSender({ EMAIL_FROM: "piar@example.invalid" }), "piar@example.invalid");
    assert.throws(() => email.gmailSender({ EMAIL_FROM: "piar@example.invalid", EMAIL_FROM_NAME: "Nombre\r\nBcc: x@example.invalid" }), /EMAIL_FROM_NAME/);
    await assert.rejects(() => email.deliverEmail("a@example.invalid", "Asunto\r\nBcc: x@example.invalid", "Texto"), /subject/);
});

test("Gmail: un access token rechazado (401) se renueva una sola vez y se reintenta", async t => {
    const api = await fakeGoogle({ token: okToken, send: n => (n === 1 ? { status: 401, json: { error: { status: "UNAUTHENTICATED" } } } : { status: 200, json: { id: "segundo" } }) });
    t.after(api.close);
    const result = await withEnv(gmailEnv(api.url), () => email.deliverEmail("persona@example.invalid", "Asunto", "Texto"));
    assert.deepEqual(result, { id: "segundo" });
    assert.equal(api.requests.filter(r => r.kind === "token").length, 2);
    assert.equal(api.requests.filter(r => r.kind === "send").length, 2);
});

test("Gmail: refresh token revocado (invalid_grant) falla con diagnóstico sin secretos", async t => {
    const api = await fakeGoogle({ token: () => ({ status: 400, json: { error: "invalid_grant", error_description: "Token has been expired or revoked." } }) });
    t.after(api.close);
    let caught;
    const logs = await captureConsoleError(async () => {
        caught = await withEnv(gmailEnv(api.url), () => email.deliverEmail("persona@example.invalid", "Asunto", "Texto")).catch(error => error);
    });
    assert.ok(caught instanceof email.EmailTransportError);
    assert.equal(caught.diagnostic.provider, "gmail");
    assert.equal(caught.diagnostic.stage, "autorización");
    assert.equal(caught.diagnostic.responseCode, 400);
    assert.equal(caught.diagnostic.name, "invalid_grant");
    assert.equal(api.requests.filter(r => r.kind === "send").length, 0);
    const exposed = `${logs}\n${caught.message}\n${JSON.stringify(caught.diagnostic)}\n${email.describeSmtpDiagnostic(caught.diagnostic)}`;
    for (const secret of [CLIENT_SECRET, REFRESH, "persona@example.invalid", "expired or revoked"]) assert.ok(!exposed.includes(secret), `se expuso: ${secret}`);
    assert.match(email.describeSmtpDiagnostic(caught.diagnostic), /gmail-autorizar\.js/);
});

test("Gmail: el proveedor rechaza el envío (403) y el sistema no lo da por enviado", async t => {
    const api = await fakeGoogle({ token: okToken, send: () => ({ status: 403, json: { error: { code: 403, status: "PERMISSION_DENIED", message: "Gmail API has not been used in project" } } }) });
    t.after(api.close);
    let caught;
    const logs = await captureConsoleError(async () => {
        caught = await withEnv(gmailEnv(api.url), () => email.deliverEmail("persona@example.invalid", "Asunto", "Texto")).catch(error => error);
    });
    assert.ok(caught instanceof email.EmailTransportError);
    assert.equal(caught.diagnostic.name, "PERMISSION_DENIED");
    assert.match(logs, /Gmail rechazó el envío: HTTP 403 \(PERMISSION_DENIED\)/);
    assert.ok(!logs.includes(ACCESS) && !logs.includes("persona@example.invalid") && !logs.includes("has not been used"));
    assert.match(email.gmailDiagnosticHint(caught.diagnostic), /habilitada/);
});

test("Gmail: respuestas incompletas, permiso insuficiente y tiempo de espera", async t => {
    const sinScope = await fakeGoogle({ token: () => ({ status: 200, json: { access_token: ACCESS, expires_in: 3599, scope: "openid email" } }) });
    t.after(sinScope.close);
    const e1 = await withEnv(gmailEnv(sinScope.url), () => email.deliverEmail("p@example.invalid", "A", "T")).catch(error => error);
    assert.equal(e1.diagnostic.name, "insufficient_scope");

    email.resetGmailAccessTokenCache();
    const sinId = await fakeGoogle({ token: okToken, send: () => ({ status: 200, json: {} }) });
    t.after(sinId.close);
    const e2 = await withEnv(gmailEnv(sinId.url), () => email.deliverEmail("p@example.invalid", "A", "T")).catch(error => error);
    assert.equal(e2.diagnostic.code, "EINVALIDRESPONSE");

    email.resetGmailAccessTokenCache();
    const lento = await fakeGoogle({ token: () => ({ hang: true }) });
    t.after(lento.close);
    const e3 = await withEnv(gmailEnv(lento.url, { EMAIL_TIMEOUT_MS: "200" }), () => email.deliverEmail("p@example.invalid", "A", "T")).catch(error => error);
    assert.equal(e3.diagnostic.code, "ETIMEDOUT");
});

test("Gmail: configuración incompleta o insegura se rechaza sin mostrar valores", () => {
    const base = { NODE_ENV: "test", GMAIL_CLIENT_ID: CLIENT_ID, GMAIL_CLIENT_SECRET: CLIENT_SECRET, GMAIL_REFRESH_TOKEN: REFRESH, EMAIL_FROM: "piar@example.invalid" };
    assert.equal(email.assertPersistentEmailTransport({ ...base, EMAIL_TRANSPORT: "gmail" }), "gmail");
    for (const missing of ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"]) {
        assert.throws(() => email.gmailSettings({ ...base, [missing]: "" }), error => /Gmail API no está configurada/.test(error.message) && !error.message.includes(CLIENT_SECRET) && !error.message.includes(REFRESH));
    }
    assert.throws(() => email.gmailSettings({ ...base, GMAIL_CLIENT_ID: "cualquier-cosa" }), /GMAIL_CLIENT_ID/);
    assert.equal(email.gmailSettings(base).apiOrigin, email.GMAIL_API_ORIGIN);
    assert.equal(email.gmailSettings(base).tokenUrl, email.GOOGLE_TOKEN_URL);
    assert.throws(() => email.gmailSettings({ ...base, GMAIL_API_BASE_URL: "http://api.example.invalid" }), /oficial por HTTPS/);
    assert.throws(() => email.gmailSettings({ ...base, NODE_ENV: "production", GMAIL_API_BASE_URL: "https://otro.example.invalid" }), /oficial por HTTPS/);
    assert.throws(() => email.gmailSettings({ ...base, NODE_ENV: "production", GOOGLE_OAUTH_TOKEN_URL: "http://127.0.0.1:9/token" }), /oficial por HTTPS/);
    assert.throws(() => email.assertPersistentEmailTransport({ ...base, EMAIL_TRANSPORT: "gmail", EMAIL_FROM: "" }), /sender/);
});

test("Gmail: la configuración de producción lo acepta y exige sus tres credenciales", () => {
    const production = {
        NODE_ENV: "production", APP_BASE_URL: "https://piar.example.invalid", CORS_ORIGIN: "https://piar.example.invalid",
        DB_HOST: "mysql.railway.internal", DB_NAME: "piar_produccion", TRUSTED_PROXIES: "100.64.0.0/10", RATE_LIMIT_STORE: "mysql",
        EMAIL_TRANSPORT: "gmail", GMAIL_CLIENT_ID: CLIENT_ID, GMAIL_CLIENT_SECRET: CLIENT_SECRET, GMAIL_REFRESH_TOKEN: REFRESH, EMAIL_FROM: "piar@example.invalid"
    };
    assert.deepEqual(assertRuntimeConfig(production), []);
    assert.throws(() => assertRuntimeConfig({ ...production, GMAIL_REFRESH_TOKEN: "" }), error => /EMAIL_TRANSPORT=gmail/.test(error.message) && !error.message.includes(CLIENT_SECRET));
});

test("probar-correo: --verificar con Gmail renueva el acceso sin enviar y no muestra credenciales", async t => {
    const api = await fakeGoogle({ token: okToken });
    t.after(api.close);
    const env = gmailEnv(api.url);
    const summary = probar.configurationSummary(env);
    assert.equal(summary.transporte, "gmail");
    assert.equal(summary.credenciales, "configuradas");
    assert.ok(!JSON.stringify(summary).includes(CLIENT_SECRET) && !JSON.stringify(summary).includes(REFRESH));
    const logs = [];
    const original = console.log;
    console.log = (...args) => logs.push(args.join(" "));
    let result;
    try { result = await probar.main(["--verificar"], env); } finally { console.log = original; }
    assert.equal(result.verified, true);
    assert.ok(result.scopes.includes(email.GMAIL_SEND_SCOPE));
    assert.equal(api.requests.filter(r => r.kind === "send").length, 0);
    assert.ok(!logs.join("\n").includes(ACCESS));
});

test("gmail-autorizar: URL con offline, consentimiento, PKCE S256, state y solo gmail.send como permiso de Gmail", () => {
    const config = { clientId: CLIENT_ID, expected: "cuenta@example.invalid", redirectUri: "http://localhost:8765/oauth2/callback" };
    const pkce = autorizar.createPkce();
    const url = new URL(autorizar.buildAuthorizationUrl(config, "estado-aleatorio", pkce.challenge));
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("state"), "estado-aleatorio");
    assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
    const scopes = url.searchParams.get("scope").split(" ");
    assert.deepEqual(scopes.filter(scope => scope.includes("gmail") || scope.includes("mail.google")), [email.GMAIL_SEND_SCOPE]);
    assert.deepEqual(scopes.sort(), ["email", "https://www.googleapis.com/auth/gmail.send", "openid"]);
    assert.notEqual(pkce.verifier, pkce.challenge);
    assert.equal(autorizar.sameSecret("abc", "abc"), true);
    assert.equal(autorizar.sameSecret("abc", "abd"), false);
    assert.equal(autorizar.sameSecret("abc", null), false);
});

test("gmail-autorizar: solo acepta la cuenta esperada, con refresh token y sin permisos de Gmail extra", () => {
    const config = { clientId: CLIENT_ID, expected: "cuenta@example.invalid" };
    const idToken = claims => ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "firma"].join(".");
    const goodClaims = { iss: "https://accounts.google.com", aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600, email: "Cuenta@Example.invalid", email_verified: true };
    const good = { refresh_token: REFRESH, scope: `openid ${email.GMAIL_SEND_SCOPE} https://www.googleapis.com/auth/userinfo.email`, id_token: idToken(goodClaims) };
    assert.equal(autorizar.validateTokenResponse(good, config).refreshToken, REFRESH);
    assert.throws(() => autorizar.validateTokenResponse({ ...good, refresh_token: undefined }, config), /refresh token/);
    assert.throws(() => autorizar.validateTokenResponse({ ...good, scope: "openid email" }, config), /gmail\.send/);
    assert.throws(() => autorizar.validateTokenResponse({ ...good, scope: `${good.scope} https://www.googleapis.com/auth/gmail.readonly` }, config), /adicionales/);
    assert.throws(() => autorizar.validateTokenResponse({ ...good, id_token: idToken({ ...goodClaims, email: "otra@example.invalid" }) }, config), /cuenta institucional esperada/);
    assert.throws(() => autorizar.validateTokenResponse({ ...good, id_token: idToken({ ...goodClaims, email_verified: false }) }, config), /cuenta institucional esperada/);
    assert.throws(() => autorizar.validateTokenResponse({ ...good, id_token: idToken({ ...goodClaims, aud: "otro-cliente" }) }, config), /identidad/);
    assert.throws(() => autorizar.validateTokenResponse({ ...good, id_token: "no-es-jwt" }, config), /identidad/);
});

test("gmail-autorizar: el archivo de salida debe estar fuera del repositorio y no existir", () => {
    const repo = path.resolve(__dirname, "..");
    assert.throws(() => autorizar.assertOutsideRepository(path.join(repo, "token.txt"), repo), /dentro del repositorio/);
    assert.throws(() => autorizar.assertOutsideRepository(repo, repo), /dentro del repositorio/);
    assert.throws(() => autorizar.assertOutsideRepository("", repo), /obligatoria/);
    assert.throws(() => autorizar.assertOutsideRepository(path.join(repo, "package.json"), repo), /dentro del repositorio/);
    const outside = path.join(os.tmpdir(), `piar-gmail-${process.pid}-${Date.now()}.txt`);
    assert.equal(autorizar.assertOutsideRepository(outside, repo), path.resolve(outside));
    assert.throws(() => autorizar.readConfig({ GMAIL_CLIENT_ID: CLIENT_ID, GMAIL_CLIENT_SECRET: CLIENT_SECRET, GMAIL_CUENTA_ESPERADA: "no-es-correo", GMAIL_REFRESH_TOKEN_ARCHIVO: outside }), /GMAIL_CUENTA_ESPERADA/);
});
