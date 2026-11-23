"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { verifyEmail, requestEmailVerification, register, invalidateInitialAdminVerification } = require("../backend/auth");

function transactionalDb({ tokenRow, claimRows = 1, updateRows = 1, tokenState = null }) {
    const calls = [];
    const actions = [];
    const connection = {
        query: async (sql, values = []) => {
            calls.push({ sql, values });
            if (sql.startsWith("SELECT v.id_verificacion")) return [tokenRow ? [tokenRow] : []];
            if (sql.startsWith("SELECT consumed_at IS NOT NULL")) return [tokenState ? [tokenState] : []];
            if (sql.startsWith("UPDATE verificacion_correo SET consumed_at")) return [{ affectedRows: claimRows }];
            if (sql.startsWith("UPDATE usuario SET correo_verificado_at")) return [{ affectedRows: updateRows }];
            if (sql.startsWith("INSERT INTO admin_account_audit")) return [{ insertId: 1 }];
            throw new Error("Unexpected transactional SQL");
        },
        execute: async (sql, values = []) => {
            calls.push({ sql, values });
            if (sql.startsWith("INSERT INTO admin_account_audit")) return [{ affectedRows: 1 }];
            throw new Error("Unexpected transactional execute SQL");
        },
        beginTransaction: async () => actions.push("begin"),
        commit: async () => actions.push("commit"),
        rollback: async () => actions.push("rollback"),
        release: () => actions.push("release")
    };
    return { calls, actions, promise: () => ({ getConnection: async () => connection }) };
}

test("email verification consumes the hashed token and moves the account to approval pending", async () => {
    const token = crypto.randomBytes(32).toString("base64url");
    const db = transactionalDb({ tokenRow: { id_verificacion: 8, id_usuario: 41, rol: "Docente" } });
    const result = await verifyEmail(db, token);
    assert.equal(result.status, 200);
    assert.match(result.body.message, /aprobación institucional/);
    assert.equal(db.calls[0].values[0], crypto.createHash("sha256").update(token).digest("hex"));
    assert.match(db.calls[1].sql, /consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP/);
    assert.match(db.calls[2].sql, /estado = 'pendiente_verificacion'/);
    assert.deepEqual(db.actions, ["begin", "commit", "release"]);
    assert.ok(!JSON.stringify(result).includes(token));
});

test("initial Administrator becomes active and is audited only after its one-time verification token is claimed", async () => {
    const token = crypto.randomBytes(32).toString("base64url");
    const db = transactionalDb({ tokenRow: { id_verificacion: 18, id_usuario: 77, rol: "Administrador" } });
    const result = await verifyEmail(db, token);
    assert.equal(result.status, 200);
    assert.match(result.body.message, /iniciar sesión/);
    assert.match(db.calls.find(call => call.sql.startsWith("UPDATE usuario SET correo_verificado_at")).sql, /CASE WHEN rol IN \('Administrador', 'Estudiante'\) THEN 'activo' ELSE 'pendiente' END/);
    const audit = db.calls.find(call => call.sql.startsWith("INSERT INTO admin_account_audit"));
    assert.ok(audit);
    assert.equal(audit.values[0], 77);
    assert.equal(audit.values[3], null);
    assert.deepEqual(db.actions, ["begin", "commit", "release"]);
});

test("failed initial-administrator mail delivery can consume only that account's unsent verification token", async () => {
    const token = crypto.randomBytes(32).toString("base64url");
    const calls = [];
    await invalidateInitialAdminVerification({ execute: async (sql, values) => calls.push({ sql, values }) }, 77, token);
    assert.match(calls[0].sql, /WHERE id_usuario = \? AND token_hash = \? AND consumed_at IS NULL/);
    assert.equal(calls[0].values[0], 77);
    assert.equal(calls[0].values[1], crypto.createHash("sha256").update(token).digest("hex"));
    assert.notEqual(calls[0].values[1], token);
});

test("invalid, expired, reused and unclaimable verification tokens cannot activate an account", async () => {
    const malformed = transactionalDb({ tokenRow: { id_verificacion: 1, id_usuario: 1 } });
    assert.equal((await verifyEmail(malformed, "bad")).status, 400);
    assert.equal(malformed.actions.length, 0);

    const expiredOrConsumed = transactionalDb({ tokenRow: null });
    assert.equal((await verifyEmail(expiredOrConsumed, crypto.randomBytes(32).toString("base64url"))).status, 400);
    assert.ok(expiredOrConsumed.actions.includes("rollback"));
    assert.equal(expiredOrConsumed.calls.some(call => call.sql.startsWith("UPDATE usuario")), false);

    const reused = transactionalDb({ tokenRow: { id_verificacion: 2, id_usuario: 3, rol: "Docente" }, claimRows: 0 });
    assert.equal((await verifyEmail(reused, crypto.randomBytes(32).toString("base64url"))).status, 400);
    assert.equal(reused.calls.some(call => call.sql.startsWith("UPDATE usuario")), false);
});

test("resend verification gives the same response for unknown and pending emails", async () => {
    const oldBase = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://piar.example.invalid";
    const calls = [];
    let delivered = false;
    const db = { promise: () => ({ query: async (sql, values) => {
        calls.push({ sql, values });
        if (sql.startsWith("SELECT id_usuario")) return [values[0] === "pending@example.invalid" ? [{ id_usuario: 7, correo: "pending@example.invalid" }] : []];
        return [{ insertId: 12 }];
    } }) };
    const unknown = await requestEmailVerification(db, "unknown@example.invalid", async () => { delivered = true; });
    const pending = await requestEmailVerification(db, "pending@example.invalid", async () => { delivered = true; });
    assert.deepEqual(unknown, pending);
    assert.equal(unknown.status, 200);
    assert.match(unknown.body.message, /Si existe/);
    assert.equal(delivered, true);
    assert.ok(!JSON.stringify([unknown, pending]).includes("pending@example.invalid"));
    if (oldBase === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = oldBase;
});

test("failed delivery of a resent verification link keeps the public response and consumes the unsent token", async () => {
    const calls = [];
    const db = { promise: () => ({ query: async (sql, values) => {
        calls.push({ sql, values });
        if (sql.startsWith("SELECT id_usuario, correo FROM usuario")) return [[{ id_usuario: 51, correo: "fail@example.invalid" }]];
        return [{ affectedRows: 1, insertId: 2 }];
    } }) };
    const result = await requestEmailVerification(db, "fail@example.invalid", async () => { throw new Error("simulated email provider failure"); });
    assert.equal(result.status, 200);
    assert.match(result.body.message, /Si existe una solicitud pendiente/);
    assert.ok(calls.some(call => call.sql.startsWith("UPDATE verificacion_correo SET consumed_at")));
    assert.ok(!JSON.stringify(result).includes("token"));
});

test("public registration no longer depends on email delivery: no token is created and the provider is never called", async () => {
    const calls = [];
    const runQuery = async (sql, values) => {
        calls.push({ sql, values });
        if (sql.startsWith("SELECT id_usuario")) return [[]];
        if (sql.startsWith("INSERT INTO usuario")) return [{ insertId: 51 }];
        throw new Error("Unexpected SQL: " + sql);
    };
    const connection = { query: runQuery, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {} };
    const db = { promise: () => ({ query: runQuery, getConnection: async () => connection }) };
    let called = false;
    const result = await register(db, {
        nombre: "Synthetic", apellidos: "Manual", documento: "SYNTHETIC-MANUAL",
        correo: "manual@example.invalid", password: "long enough password", rol: "Docente"
    }, false, async () => { called = true; throw new Error("simulated email provider failure"); });
    assert.equal(result.status, 202);
    assert.equal(result.body.pendingApproval, true);
    assert.equal(called, false);
    assert.equal(calls.some(call => /verificacion_correo/.test(call.sql)), false);
});

test("a failed verification tells the link holder whether the link was used, expired or is invalid, without activating anything", async () => {
    const token = crypto.randomBytes(32).toString("base64url");
    const used = transactionalDb({ tokenRow: null, tokenState: { usado: 1, vencido: 0 } });
    const usedResult = await verifyEmail(used, token);
    assert.equal(usedResult.status, 400);
    assert.equal(usedResult.body.reason, "usado");
    assert.match(usedResult.body.message, /ya se utilizó/);
    const stateQuery = used.calls.find(call => call.sql.startsWith("SELECT consumed_at IS NOT NULL"));
    assert.equal(stateQuery.values[0], crypto.createHash("sha256").update(token).digest("hex"));
    assert.equal(used.calls.some(call => call.sql.startsWith("UPDATE")), false);
    assert.ok(used.actions.includes("rollback"));

    const expired = transactionalDb({ tokenRow: null, tokenState: { usado: 0, vencido: 1 } });
    const expiredResult = await verifyEmail(expired, token);
    assert.equal(expiredResult.body.reason, "vencido");
    assert.match(expiredResult.body.message, /venció .*24 horas.*Reenviar verificación/);

    const unknown = transactionalDb({ tokenRow: null, tokenState: null });
    const unknownResult = await verifyEmail(unknown, token);
    assert.equal(unknownResult.body.reason, "invalido");
    assert.match(unknownResult.body.message, /no es válido/);

    const malformed = await verifyEmail(transactionalDb({ tokenRow: null }), "corto");
    assert.equal(malformed.body.reason, "invalido");

    const raced = transactionalDb({ tokenRow: { id_verificacion: 5, id_usuario: 9, rol: "Docente" }, claimRows: 0 });
    assert.equal((await verifyEmail(raced, token)).body.reason, "usado");
    for (const result of [usedResult, expiredResult, unknownResult]) assert.ok(!JSON.stringify(result).includes(token));
});

test("the verification email explains the single-use link, its expiry, the approval step and how to ask for a new one", () => {
    const { verificationEmailText } = require("../backend/auth");
    const link = "https://piar.example.invalid/#verify-email=TOKEN_DE_PRUEBA";
    const text = verificationEmailText(link);
    assert.ok(text.includes(link));
    assert.match(text, /una sola vez/);
    assert.match(text, /24 horas/);
    assert.match(text, /aprobación de la institución/);
    assert.match(text, /Reenviar verificación de correo/);
    assert.match(text, /Si no solicitaste esta cuenta/);
});
