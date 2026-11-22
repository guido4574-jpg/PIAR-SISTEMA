"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createClientIpResolver, parseTrustedProxies } = require("../backend/client-ip");
const { createMemoryRateLimitStore, createMysqlRateLimitStore, createLimiter, createRateLimitStore } = require("../backend/rate-limit-store");
const { createSecurityEventRecorder, hashEmail, networkPrefix } = require("../backend/security-events");
const { passwordPolicyError, PASSWORD_MIN_LENGTH } = require("../backend/password-policy");
const { purgeExpiredRecords, retentionDaysFrom } = require("../backend/maintenance");

const request = (remoteAddress, forwarded) => ({ socket: { remoteAddress }, headers: forwarded ? { "x-forwarded-for": forwarded } : {} });

test("X-Forwarded-For is ignored unless the peer is a configured proxy", () => {
    const resolve = createClientIpResolver("");
    assert.equal(resolve(request("203.0.113.7", "198.51.100.1")), "203.0.113.7");
    assert.equal(resolve(request("::ffff:203.0.113.7")), "203.0.113.7");
});

test("trusted proxies yield the closest untrusted hop, not the spoofable leftmost value", () => {
    const resolve = createClientIpResolver("10.0.0.0/8,loopback");
    assert.equal(resolve(request("10.1.2.3", "1.1.1.1, 198.51.100.9, 10.0.0.5")), "198.51.100.9");
    assert.equal(resolve(request("127.0.0.1", "198.51.100.10")), "198.51.100.10");
    assert.equal(resolve(request("10.1.2.3", "not-an-ip")), "10.1.2.3");
    assert.equal(resolve(request("203.0.113.8", "198.51.100.11")), "203.0.113.8");
});

test("invalid TRUSTED_PROXIES entries fail at startup", () => {
    assert.throws(() => parseTrustedProxies("10.0.0.0/99"), /prefijo/);
    assert.throws(() => parseTrustedProxies("proxy.example"), /no válida/);
});

test("memory limiter consumes, peeks without counting, and resets", async () => {
    const store = createMemoryRateLimitStore();
    const limiter = createLimiter(store, { name: "demo", limit: 2, windowMs: 60_000 });
    assert.equal((await limiter.consume("k")).allowed, true);
    assert.equal((await limiter.peek("k")).allowed, true);
    assert.equal((await limiter.consume("k")).allowed, true);
    assert.equal((await limiter.peek("k")).allowed, false);
    const denied = await limiter.consume("k");
    assert.equal(denied.allowed, false);
    assert.ok(denied.retryAfterSeconds > 0);
    await limiter.reset("k");
    assert.equal((await limiter.peek("k")).allowed, true);
});

test("memory limiter window expires", async () => {
    let now = 0;
    const limiter = createLimiter(createMemoryRateLimitStore({ now: () => now }), { name: "w", limit: 1, windowMs: 1000 });
    await limiter.consume("k");
    assert.equal((await limiter.consume("k")).allowed, false);
    now = 1000;
    assert.equal((await limiter.consume("k")).allowed, true);
});

test("mysql limiter stores only hashed keys and computes the window in SQL", async () => {
    const statements = [];
    const db = { promise: () => ({ query: async (sql, values) => {
        statements.push({ sql, values });
        return sql.startsWith("SELECT") ? [[{ conteo: 3, restante_us: 4_000_000 }]] : [{ affectedRows: 1 }];
    } }) };
    const limiter = createLimiter(createMysqlRateLimitStore(db), { name: "login-ip", limit: 2, windowMs: 60_000 });
    const result = await limiter.consume("198.51.100.4");
    assert.deepEqual(result, { allowed: false, retryAfterSeconds: 4 });
    assert.match(statements[0].sql, /ON DUPLICATE KEY UPDATE/);
    assert.match(statements[0].values[0], /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(statements).includes("198.51.100.4"));
    assert.equal(statements[0].values[1], 60_000_000);
});

test("rate limit store selection is explicit", () => {
    assert.equal(createRateLimitStore({}).kind, "memory");
    assert.throws(() => createRateLimitStore({ RATE_LIMIT_STORE: "mysql" }), /requiere/);
    assert.throws(() => createRateLimitStore({ RATE_LIMIT_STORE: "redis" }), /memory/);
});

test("security events never store clear-text emails or full addresses", async () => {
    const statements = [];
    const db = { promise: () => ({ query: async (sql, values) => { statements.push({ sql, values }); return [{}]; } }) };
    await createSecurityEventRecorder(db)({ type: "login_fallido", outcome: "fallo", email: " Ana@Example.invalid ", ip: "198.51.100.77" });
    const values = statements[0].values;
    assert.equal(values[3], hashEmail("ana@example.invalid"));
    assert.equal(values[4], "198.51.100.0/24");
    assert.ok(!JSON.stringify(values).toLowerCase().includes("ana@example.invalid"));
    assert.equal(networkPrefix("2001:db8:abcd:12::1"), "2001:db8:abcd::/48");
    await assert.rejects(() => createSecurityEventRecorder(db)({ type: "otro", outcome: "fallo" }), /no válido/);
});

test("security event write failures do not break the caller", async () => {
    const logged = [];
    const db = { promise: () => ({ query: async () => { const error = new Error("down"); error.code = "ECONNREFUSED"; throw error; } }) };
    await createSecurityEventRecorder(db, { logger: { error: message => logged.push(message) } })({ type: "logout", outcome: "exito" });
    assert.match(logged[0], /ECONNREFUSED/);
});

test("one password policy applies to every flow", () => {
    assert.equal(PASSWORD_MIN_LENGTH, 14);
    assert.ok(passwordPolicyError("corta123"));
    assert.equal(passwordPolicyError("frase segura de prueba"), null);
    assert.ok(passwordPolicyError("ñ".repeat(37)), "more than 72 bytes must be rejected");
    const app = fs.readFileSync(path.join(__dirname, "../public/js/app.js"), "utf8");
    assert.doesNotMatch(app, /minlength="8"/);
});

test("maintenance purges in batches and tolerates tables from pending migrations", async () => {
    const calls = [];
    const db = { promise: () => ({ query: async sql => {
        calls.push(sql);
        if (sql.includes("limite_solicitudes")) { const error = new Error("missing"); error.code = "ER_NO_SUCH_TABLE"; throw error; }
        return [{ affectedRows: sql.includes("sesion_usuario") && calls.filter(item => item.includes("sesion_usuario")).length === 1 ? 1000 : 3 }];
    } }) };
    const summary = await purgeExpiredRecords(db, { env: {} });
    assert.equal(summary.sesion_usuario, 1003);
    assert.equal(summary.limite_solicitudes, "tabla ausente");
    assert.ok(calls.every(sql => /LIMIT \?$/.test(sql)));
    assert.throws(() => retentionDaysFrom({ SECURITY_EVENT_RETENTION_DAYS: "5" }), /entre 30/);
});

test("server applies CSP, no-store API responses and scoped teacher profile reads", () => {
    const server = fs.readFileSync(path.join(__dirname, "../backend/server.js"), "utf8");
    assert.match(server, /"Content-Security-Policy": CONTENT_SECURITY_POLICY/);
    assert.match(server, /"frame-ancestors 'none'"/);
    assert.match(server, /"Cache-Control": "no-store"/);
    // Docente profile reads are scoped by the central pre-gate before any route handler.
    assert.ok(server.includes("} else if (/^\\/api\\/docentes\\/\\d+$/.test(path)) {"));
    assert.match(server, /assigned = teacherId === Number\(teacherProfile\.id_docente\)/);
    assert.doesNotMatch(server, /request\.socket\?\.remoteAddress \|\| "unknown"/);
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    for (const tag of html.match(/<(?:script|link)[^>]+https:\/\/[^>]+>/g)) {
        assert.match(tag, /integrity="sha384-[A-Za-z0-9+/=]+"/, tag);
        assert.match(tag, /@\d+\.\d+\.\d+\//, tag);
    }
});
