"use strict";

// Decisiones D4 (Microsoft personal y organizacional por tenants autorizados),
// D5 (gestión de identidades externas) y ajustes de Sign in with Apple. Sin red ni
// MySQL: la biblioteca se sustituye por funciones simuladas y las pruebas HTTP usan
// el server.js real con la base en memoria de tests/helpers/fase1-fake-server.js.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const oidcClient = require("openid-client");
const {
    microsoftTenantPolicy,
    appleClientSecret,
    MICROSOFT_CONSUMERS_TENANT,
    providerSettings,
    buildAuthorizationRequest,
    completeAuthorization
} = require("../backend/oidc");
const { EVENT_TYPES } = require("../backend/security-events");

const TENANT_A = "11111111-2222-4333-8444-555555555555";
const TENANT_B = "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee";
const OTHER_TENANT = "99999999-8888-4777-a666-555555555555";
const base = {
    NODE_ENV: "production", APP_BASE_URL: "https://app.example.invalid",
    MICROSOFT_CLIENT_ID: "ms-client", MICROSOFT_CLIENT_SECRET: "ms-secret",
    MICROSOFT_REDIRECT_URI: "https://app.example.invalid/api/auth/oidc/microsoft/callback"
};

test("D4: la política de tenants admite organizacionales y personales, y falla cerrado ante valores no válidos", () => {
    assert.equal(microsoftTenantPolicy({}), null, "sin tenants no hay proveedor");
    assert.deepEqual({ ...microsoftTenantPolicy({ MICROSOFT_TENANT_IDS: TENANT_A }) }, { tenants: [TENANT_A], authority: TENANT_A, allowPersonal: false });
    assert.deepEqual({ ...microsoftTenantPolicy({ MICROSOFT_ALLOW_PERSONAL_ACCOUNTS: "true" }) }, { tenants: [MICROSOFT_CONSUMERS_TENANT], authority: MICROSOFT_CONSUMERS_TENANT, allowPersonal: true });
    assert.equal(microsoftTenantPolicy({ MICROSOFT_TENANT_IDS: `${TENANT_A}, ${TENANT_B}` }).authority, "organizations");
    assert.equal(microsoftTenantPolicy({ MICROSOFT_TENANT_IDS: TENANT_A, MICROSOFT_ALLOW_PERSONAL_ACCOUNTS: "true" }).authority, "common");
    assert.deepEqual([...microsoftTenantPolicy({ MICROSOFT_TENANT_IDS: `${TENANT_A},consumers` }).tenants], [TENANT_A, MICROSOFT_CONSUMERS_TENANT]);
    // Compatibilidad con la variable anterior.
    assert.equal(microsoftTenantPolicy({ MICROSOFT_TENANT_ID: "consumers" }).authority, MICROSOFT_CONSUMERS_TENANT);
    for (const invalid of [{ MICROSOFT_TENANT_IDS: "common" }, { MICROSOFT_TENANT_IDS: "organizations" }, { MICROSOFT_TENANT_IDS: `${TENANT_A},no-es-guid` },
        { MICROSOFT_TENANT_ID: "common" }, { MICROSOFT_TENANT_IDS: TENANT_A, MICROSOFT_ALLOW_PERSONAL_ACCOUNTS: "si" }]) {
        assert.equal(microsoftTenantPolicy(invalid), null, JSON.stringify(invalid));
    }
    assert.equal(providerSettings("microsoft", { ...base, MICROSOFT_TENANT_IDS: `${TENANT_A},${TENANT_B}` }).issuer, "https://login.microsoftonline.com/organizations/v2.0");
    assert.equal(providerSettings("microsoft", { ...base, MICROSOFT_TENANT_IDS: "x" }), null);
});

function microsoftArgs(env, claims) {
    return {
        provider: "microsoft",
        callbackUrl: "https://app.example.invalid/api/auth/oidc/microsoft/callback?code=c&state=s",
        state: "s".repeat(32), nonce: "n".repeat(32), codeVerifier: "v".repeat(43), env,
        discover: async () => ({ configuration: {}, issuer: providerSettings("microsoft", env).issuer, redirectUri: new URL(env.MICROSOFT_REDIRECT_URI) }),
        authorizationCodeGrant: async () => ({ claims: () => claims })
    };
}

test("D4: solo se aceptan tokens de tenants autorizados y con el emisor de ese tenant", async () => {
    const env = { ...base, MICROSOFT_TENANT_IDS: TENANT_A, MICROSOFT_ALLOW_PERSONAL_ACCOUNTS: "true" };
    const exp = Math.floor(Date.now() / 1000) + 300;
    const organizational = { iss: `https://login.microsoftonline.com/${TENANT_A}/v2.0`, tid: TENANT_A, sub: "org-user", aud: "ms-client", exp, email: "docente@example.invalid" };
    const result = await completeAuthorization(microsoftArgs(env, organizational));
    assert.equal(result.issuer, organizational.iss);
    assert.equal(result.emailVerified, false, "Microsoft no declara email_verified");
    assert.equal(result.verifiedIdentity, true, "token firmado de un tenant autorizado");

    const personal = { ...organizational, iss: `https://login.microsoftonline.com/${MICROSOFT_CONSUMERS_TENANT}/v2.0`, tid: MICROSOFT_CONSUMERS_TENANT, sub: "personal-user" };
    assert.equal((await completeAuthorization(microsoftArgs(env, personal))).subject, "personal-user");

    const foreign = { ...organizational, iss: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0`, tid: OTHER_TENANT };
    await assert.rejects(completeAuthorization(microsoftArgs(env, foreign)), /tenant is not authorized/);
    await assert.rejects(completeAuthorization(microsoftArgs(env, { ...organizational, tid: undefined })), /tenant is not authorized/);
    // Emisor de otro tenant con tid autorizado: rechazado.
    await assert.rejects(completeAuthorization(microsoftArgs(env, { ...organizational, iss: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0` })), /issuer is invalid/);
    // Sin cuentas personales, el tenant de consumidores se rechaza.
    const orgOnly = { ...base, MICROSOFT_TENANT_IDS: TENANT_A };
    await assert.rejects(completeAuthorization(microsoftArgs(orgOnly, personal)), /tenant is not authorized/);
});

test("D5: Google sin email_verified no cuenta como identidad verificada", async () => {
    const env = { NODE_ENV: "production", APP_BASE_URL: "https://app.example.invalid", GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s", GOOGLE_REDIRECT_URI: "https://app.example.invalid/api/auth/oidc/google/callback" };
    const claims = { iss: "https://accounts.google.com", sub: "g-user", aud: "g", exp: Math.floor(Date.now() / 1000) + 300, email: "x@example.invalid", email_verified: false };
    const result = await completeAuthorization({
        provider: "google", callbackUrl: "https://app.example.invalid/api/auth/oidc/google/callback?code=c", state: "s".repeat(32), nonce: "n".repeat(32), codeVerifier: "v".repeat(43), env,
        discover: async () => ({ configuration: {}, issuer: "https://accounts.google.com", redirectUri: new URL(env.GOOGLE_REDIRECT_URI) }),
        authorizationCodeGrant: async () => ({ claims: () => claims })
    });
    assert.equal(result.verifiedIdentity, false);
    claims.email_verified = "true";
    assert.equal((await completeAuthorization({
        provider: "google", callbackUrl: "https://app.example.invalid/api/auth/oidc/google/callback?code=c", state: "s".repeat(32), nonce: "n".repeat(32), codeVerifier: "v".repeat(43), env,
        discover: async () => ({ configuration: {}, issuer: "https://accounts.google.com", redirectUri: new URL(env.GOOGLE_REDIRECT_URI) }),
        authorizationCodeGrant: async () => ({ claims: () => claims })
    })).verifiedIdentity, true);
});

test("Apple: client_secret es un JWT ES256 válido de vida corta, y la autorización usa form_post y el ámbito name", async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const env = { APPLE_CLIENT_ID: "com.example.piar", APPLE_TEAM_ID: "TEAM123456", APPLE_KEY_ID: "KEY1234567", APPLE_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).replace(/\n/g, "\\n") };
    const jwt = appleClientSecret(env, 1_800_000_000);
    const [header, payload, signature] = jwt.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), { alg: "ES256", kid: "KEY1234567", typ: "JWT" });
    assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url")), { iss: "TEAM123456", iat: 1_800_000_000, exp: 1_800_000_300, aud: "https://appleid.apple.com", sub: "com.example.piar" });
    assert.ok(crypto.verify("sha256", Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")));

    const configuration = new oidcClient.Configuration({ issuer: "https://appleid.apple.com", authorization_endpoint: "https://appleid.apple.com/auth/authorize" }, "com.example.piar");
    const url = await buildAuthorizationRequest({
        provider: "apple", state: "s".repeat(43), nonce: "n".repeat(43), codeVerifier: "v".repeat(43),
        discover: async () => ({ configuration, redirectUri: new URL("https://app.example.invalid/api/auth/oidc/apple/callback") })
    });
    assert.equal(url.searchParams.get("scope"), "openid email name");
    assert.equal(url.searchParams.get("response_mode"), "form_post");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("nonce"), "n".repeat(43));
    const googleConfiguration = new oidcClient.Configuration({ issuer: "https://accounts.google.com", authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth" }, "g");
    const googleUrl = await buildAuthorizationRequest({ provider: "google", state: "s".repeat(43), nonce: "n".repeat(43), codeVerifier: "v".repeat(43), discover: async () => ({ configuration: googleConfiguration, redirectUri: new URL("https://app.example.invalid/api/auth/oidc/google/callback") }) });
    assert.equal(googleUrl.searchParams.get("scope"), "openid email profile");
    assert.equal(googleUrl.searchParams.has("response_mode"), false);
});

test("D5: tipos de evento de seguridad para desvincular y reautenticación", () => {
    assert.ok(EVENT_TYPES.includes("oidc_desvinculada"));
    assert.ok(EVENT_TYPES.includes("reautenticacion_fallida"));
    for (const type of EVENT_TYPES) assert.ok(type.length <= 40, `${type} cabe en evento_seguridad.tipo VARCHAR(40)`);
});

test("D5: el servidor exige reautenticación, verifica la identidad y nunca vincula por correo", () => {
    const server = fs.readFileSync(path.join(__dirname, "../backend/server.js"), "utf8");
    const link = server.slice(server.indexOf("async function linkOidc"), server.indexOf("async function createOidcAuthorization"));
    assert.match(link, /auth\.verifyAccountPassword\(db, user\.id, payload\?\.password\)/);
    assert.match(link, /reautenticacion_fallida/);
    const complete = server.slice(server.indexOf("async function completeOidc"), server.indexOf("// Límite del formulario que Apple"));
    assert.match(complete, /if \(!identity\.verifiedIdentity\)[\s\S]*?correo_no_verificado[\s\S]*?INSERT INTO external_identity/);
    // El acceso solo busca por (issuer, subject); el correo nunca se usa para vincular.
    assert.doesNotMatch(complete, /WHERE[^"]*correo = \?/);
    assert.match(complete, /FROM external_identity e INNER JOIN usuario u ON u\.id_usuario = e\.id_usuario WHERE e\.issuer = \? AND e\.subject = \?/);
});

// ---------------------------------------------------------------------------
// HTTP contra el server.js real (base simulada, sin MySQL)
// ---------------------------------------------------------------------------
const net = require("node:net");
const { spawn } = require("node:child_process");
const ROOT = path.resolve(__dirname, "..");

async function startServer() {
    const port = await new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => { const { port: free } = probe.address(); probe.close(() => resolve(free)); });
    });
    const child = spawn(process.execPath, [path.join(__dirname, "helpers/fase1-fake-server.js")], {
        cwd: ROOT,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(port),
            MAINTENANCE_INTERVAL_MINUTES: "0", RATE_LIMIT_STORE: "memory", CORS_ORIGIN: `http://127.0.0.1:${port}`, APP_BASE_URL: `http://127.0.0.1:${port}` },
        stdio: ["ignore", "pipe", "pipe"], windowsHide: true
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
        if (child.exitCode !== null || Date.now() > deadline) { child.kill(); throw new Error(`El servidor de prueba no inició:\n${output}`); }
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    const origin = `http://127.0.0.1:${port}`;
    return {
        sql,
        async request(method, pathname, { token, body, headers = {}, raw } = {}) {
            const allHeaders = { ...headers };
            if (token) allHeaders.Cookie = `piar_session=${token}`;
            if (body !== undefined) allHeaders["Content-Type"] = "application/json";
            const response = await fetch(origin + pathname, { method, headers: allHeaders, redirect: "manual", body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
            const text = await response.text();
            let json = {};
            try { json = JSON.parse(text); } catch { /* sin JSON */ }
            await new Promise(resolve => setTimeout(resolve, 60));
            return { status: response.status, headers: response.headers, body: json };
        },
        origin,
        stop() { child.kill(); }
    };
}

test("HTTP Apple: el POST de form_post solo se convierte en un GET con parámetros saneados", async t => {
    const server = await startServer();
    t.after(() => server.stop());
    const state = "S".repeat(43);
    const form = new URLSearchParams({ code: "c0de.abc-_1", state, user: JSON.stringify({ name: { firstName: "<script>" } }), extra: "x" }).toString();
    const relayed = await server.request("POST", "/api/auth/oidc/apple/callback", { raw: form, headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://appleid.apple.com" } });
    assert.equal(relayed.status, 303);
    const location = new URL(relayed.headers.get("location"), server.origin);
    assert.equal(location.pathname, "/api/auth/oidc/apple/callback");
    assert.deepEqual([...location.searchParams.keys()].sort(), ["code", "state"]);
    assert.equal(location.searchParams.get("state"), state);
    assert.equal(relayed.headers.get("set-cookie"), null, "el reenvío no crea sesión");

    const malformed = await server.request("POST", "/api/auth/oidc/apple/callback", { raw: "code=%3Cscript%3E&state=corto", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://appleid.apple.com" } });
    assert.equal([...new URL(malformed.headers.get("location"), server.origin).searchParams.keys()].length, 0, "nada que no cumpla el formato se reenvía");
    // Las demás rutas siguen rechazando POST de otro origen.
    const foreign = await server.request("POST", "/api/auth/oidc/google/link", { body: {}, headers: { Origin: "https://appleid.apple.com" } });
    assert.equal(foreign.status, 403);
    assert.equal(server.sql.filter(item => /^(INSERT|UPDATE|DELETE)/i.test(item.sql) && !["audit", "session"].includes(item.kind)).length, 0);
});

test("HTTP identidades (D5): consulta propia, desvincular exige contraseña y vincular sin proveedor responde 503", async t => {
    const server = await startServer();
    t.after(() => server.stop());
    assert.equal((await server.request("GET", "/api/auth/identities")).status, 401);
    const list = await server.request("GET", "/api/auth/identities", { token: "token-admin-sintetico" });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.data, []);
    assert.ok(server.sql.some(item => /FROM external_identity WHERE id_usuario = \?/.test(item.sql) && item.params[0] === 900), "solo consulta la cuenta de la sesión");

    const noPassword = await server.request("DELETE", "/api/auth/identities/5", { token: "token-admin-sintetico", body: {}, headers: { Origin: server.origin } });
    assert.equal(noPassword.status, 403);
    assert.ok(server.sql.some(item => item.kind === "audit" && item.params[0] === "reautenticacion_fallida"));
    assert.equal(server.sql.some(item => /^DELETE FROM external_identity/.test(item.sql)), false);

    const link = await server.request("POST", "/api/auth/oidc/google/link", { token: "token-admin-sintetico", body: { password: "x" }, headers: { Origin: server.origin } });
    assert.equal(link.status, 503, "sin credenciales del proveedor no se simula una vinculación");
    const unauthenticated = await server.request("POST", "/api/auth/oidc/google/link", { body: {}, headers: { Origin: server.origin } });
    assert.equal(unauthenticated.status, 401);
});
