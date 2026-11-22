"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { login, changeInitialPassword, SESSION_COOKIE } = require("../backend/auth");
const { generateTemporaryPassword } = require("../scripts/bootstrap-local-primary-admin");

function dbWith(handler) {
    return { promise: () => ({ query: async (sql, values) => [await handler(sql, values)] }) };
}

test("bootstrap temporary password is random, strong, and fits bcrypt's byte limit", () => {
    const first = generateTemporaryPassword();
    const second = generateTemporaryPassword();
    assert.match(first, /^[A-Za-z0-9_-]{32}$/);
    assert.notEqual(first, second);
    assert.ok(Buffer.byteLength(first, "utf8") <= 72);
});

test("initial administrator login receives a restricted-session requirement", async () => {
    const password = generateTemporaryPassword();
    const hash = await bcrypt.hash(password, 4);
    const db = dbWith(async sql => {
        if (sql.startsWith("SELECT id_usuario, nombre")) return [{ id_usuario: 3, nombre: "Admin", correo: "admin-sintetica@example.invalid", rol: "Administrador", estado: "activo", password_hash: hash, password_change_required: 1 }];
        return { affectedRows: 1 };
    });
    const result = await login(db, { correo: "admin-sintetica@example.invalid", password });
    assert.equal(result.status, 200);
    assert.equal(result.body.mustChangePassword, true);
    assert.equal(result.body.user.mustChangePassword, true);
    assert.ok(result.session.token);
});

test("mandatory password change replaces the temporary hash and consumes the requirement", async () => {
    const token = "test-session-token";
    const calls = [];
    const db = dbWith(async (sql, values) => {
        calls.push({ sql, values });
        if (sql.includes("SELECT u.id_usuario, u.password_change_required")) return [{ id_usuario: 3, password_change_required: 1 }];
        if (sql.startsWith("UPDATE usuario SET password_hash")) return { affectedRows: 1 };
        return { affectedRows: 1 };
    });
    const nextPassword = "a-new-personal-password-2026";
    const result = await changeInitialPassword(db, { headers: { cookie: `${SESSION_COOKIE}=${token}` } }, nextPassword);
    assert.equal(result.status, 200);
    const update = calls.find(call => call.sql.startsWith("UPDATE usuario SET password_hash"));
    assert.ok(update.sql.includes("password_change_required = 0"));
    assert.equal(await bcrypt.compare(nextPassword, update.values[0]), true);
    assert.ok(calls.some(call => call.sql.startsWith("UPDATE sesion_usuario SET revoked_at")));
});

test("invalid or reused temporary-password change is rejected without exposing details", async () => {
    const writes = [];
    const noSession = dbWith(async sql => { if (/^(UPDATE|INSERT|DELETE)/i.test(sql.trim())) writes.push(sql); return []; });
    assert.equal((await changeInitialPassword(noSession, { headers: { cookie: "" } }, "new-password-at-least-14")).status, 401);
    assert.equal((await changeInitialPassword(noSession, { headers: { cookie: `${SESSION_COOKIE}=token` } }, "short")).status, 401);
    const alreadyUsed = dbWith(async sql => sql.includes("SELECT u.id_usuario, u.password_change_required")
        ? [{ id_usuario: 3, password_change_required: 0 }] : { affectedRows: 0 });
    assert.equal((await changeInitialPassword(alreadyUsed, { headers: { cookie: `${SESSION_COOKIE}=token` } }, "a-new-personal-password-2026")).status, 409);
    assert.equal(writes.length, 0);
});
