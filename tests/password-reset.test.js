const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { requestPasswordReset, resetPassword } = require("../backend/auth");

function transactionalDb(query) {
    const actions = [];
    const connection = {
        query: async (sql, values) => await query(sql, values),
        beginTransaction: async () => actions.push("begin"),
        commit: async () => actions.push("commit"),
        rollback: async () => actions.push("rollback"),
        release: () => actions.push("release")
    };
    return { actions, promise: () => ({ getConnection: async () => connection }) };
}

test("password reset request stores only a token hash and delivers the raw token privately", async () => {
    const statements = [];
    let delivered;
    const db = { promise: () => ({ query: async (sql, values) => {
        statements.push({ sql, values });
        if (sql.startsWith("SELECT id_usuario")) return [[{ id_usuario: 8, correo: "person@example.org" }]];
        return [{ insertId: 4 }];
    } }) };
    const oldBase = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://piar.example.org";
    try {
        const result = await requestPasswordReset(db, "PERSON@example.org", async (email, link) => { delivered = { email, link }; });
        assert.equal(result.status, 200);
        assert.equal(statements[1].values[0], 8);
        assert.match(statements[1].values[1], /^[a-f0-9]{64}$/);
        assert.match(statements[1].sql, /DATE_ADD\(CURRENT_TIMESTAMP, INTERVAL \? MINUTE\)/);
        assert.equal(statements[1].values[2], 30, "Token expiry should be 30 minutes from issuance.");
        assert.ok(delivered.link.includes("#reset="));
        assert.ok(!JSON.stringify(result).includes(new URL(delivered.link).searchParams.get("reset")));
    } finally {
        if (oldBase === undefined) delete process.env.APP_BASE_URL;
        else process.env.APP_BASE_URL = oldBase;
    }
});

test("known and unknown email addresses receive the same reset response", async () => {
    const previousBase = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://piar.example.org";
    const responses = [];
    try {
        for (const exists of [true, false]) {
            const db = { promise: () => ({ query: async sql => {
                if (sql.startsWith("SELECT id_usuario")) return [exists ? [{ id_usuario: 2, correo: "person@example.org" }] : []];
                return [{ insertId: 1 }];
            } }) };
            const result = await requestPasswordReset(db, "person@example.org", async () => {});
            responses.push(result);
        }
        assert.deepEqual(responses[0], responses[1]);
    } finally {
        if (previousBase === undefined) delete process.env.APP_BASE_URL;
        else process.env.APP_BASE_URL = previousBase;
    }
});

test("delivery failure consumes the token and preserves the generic public response", async () => {
    const previousBase = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://piar.example.org";
    const statements = [];
    try {
        const db = { promise: () => ({ query: async (sql, values) => {
            statements.push({ sql, values });
            if (sql.startsWith("SELECT id_usuario")) return [[{ id_usuario: 3, correo: "person@example.org" }]];
            return [{ affectedRows: 1 }];
        } }) };
        const result = await requestPasswordReset(db, "person@example.org", async () => { throw new Error("delivery unavailable"); });
        assert.equal(result.status, 200);
        assert.equal(result.body.ok, true);
        assert.equal(statements.length, 3);
        assert.match(statements[2].sql, /SET consumed_at/);
        assert.equal(statements[1].values[1], statements[2].values[0]);
    } finally {
        if (previousBase === undefined) delete process.env.APP_BASE_URL;
        else process.env.APP_BASE_URL = previousBase;
    }
});

test("password reset rejects expired or unknown tokens without database writes", async () => {
    let writes = 0;
    const db = transactionalDb(async sql => {
        assert.match(sql, /consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP/);
        if (sql.startsWith("SELECT id_recuperacion")) return [[]];
        writes++;
        return [{}];
    });
    const result = await resetPassword(db, "a".repeat(43), "NewPassword-123");
    assert.equal(result.status, 400);
    assert.equal(writes, 0);
});

test("password reset validates token and minimum password length", async () => {
    const db = { promise: () => ({ query: async () => { assert.fail("invalid inputs must not query database"); } }) };
    assert.equal((await resetPassword(db, "bad", "short")).status, 400);
});

test("valid reset replaces the hash, consumes the token and revokes sessions", async () => {
    const calls = [];
    const token = "b".repeat(43);
    const db = transactionalDb(async (sql, values) => {
        calls.push({ sql, values });
        if (sql.startsWith("SELECT id_recuperacion")) return [[{ id_recuperacion: 12, id_usuario: 19 }]];
        if (sql.startsWith("UPDATE recuperacion_contrasena SET consumed_at")) return [{ affectedRows: 1 }];
        return [{}];
    });
    const result = await resetPassword(db, token, "NewPassword-123");
    assert.equal(result.status, 200);
    assert.equal(calls.length, 4);
    assert.match(calls[1].sql, /UPDATE recuperacion_contrasena SET consumed_at/);
    assert.match(calls[2].sql, /UPDATE usuario SET password_hash/);
    assert.equal(await bcrypt.compare("NewPassword-123", calls[2].values[0]), true);
    assert.match(calls[3].sql, /UPDATE sesion_usuario SET revoked_at/);
    assert.deepEqual(db.actions, ["begin", "commit", "release"]);
});

test("concurrent or already claimed token cannot update the password", async () => {
    let writes = 0;
    const db = transactionalDb(async sql => {
        if (sql.startsWith("SELECT id_recuperacion")) return [[{ id_recuperacion: 12, id_usuario: 19 }]];
        if (sql.startsWith("UPDATE recuperacion_contrasena SET consumed_at")) return [{ affectedRows: 0 }];
        writes++;
        return [{}];
    });
    const result = await resetPassword(db, "c".repeat(43), "NewPassword-123");
    assert.equal(result.status, 400);
    assert.equal(writes, 0);
    assert.deepEqual(db.actions, ["begin", "rollback", "release"]);
});

test("reset locks the token row and rolls back if a later write fails", async () => {
    const actions = [];
    const connection = {
        query: async sql => {
            if (sql.startsWith("SELECT id_recuperacion")) {
                assert.match(sql, /LIMIT 1 FOR UPDATE/);
                return [[{ id_recuperacion: 5, id_usuario: 6 }]];
            }
            if (sql.startsWith("UPDATE recuperacion_contrasena SET consumed_at")) return [{ affectedRows: 1 }];
            if (sql.startsWith("UPDATE usuario SET password_hash")) throw new Error("simulated password write failure");
            assert.fail("Sessions must not be revoked after a password write failure");
        },
        beginTransaction: async () => actions.push("begin"),
        commit: async () => actions.push("commit"),
        rollback: async () => actions.push("rollback"),
        release: () => actions.push("release")
    };
    const db = { promise: () => ({ getConnection: async () => connection }) };
    await assert.rejects(resetPassword(db, "d".repeat(43), "NewPassword-123"), /simulated password write failure/);
    assert.deepEqual(actions, ["begin", "rollback", "release"]);
});
