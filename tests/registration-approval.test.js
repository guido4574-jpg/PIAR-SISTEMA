"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { decidePendingTeacher } = require("../backend/registration-approval");

function fakeDb({ affectedRows = 1, profiles = [], user = { id_usuario: 25, nombre: "Docente Demostración", documento: "DEMO-25", correo: "docente@example.invalid", rol: "Docente" } } = {}) {
    const calls = [];
    const connection = {
        beginTransaction: async () => calls.push({ transaction: "begin" }),
        commit: async () => calls.push({ transaction: "commit" }),
        rollback: async () => calls.push({ transaction: "rollback" }),
        release: () => calls.push({ transaction: "release" }),
        execute: async (sql, values) => { calls.push({ sql, values }); return [{ affectedRows: 1 }]; },
        query: async (sql, values) => {
            calls.push({ sql, values });
            if (sql.includes("FROM usuario WHERE")) return [user ? [user] : []];
            if (sql.includes("FROM docente WHERE")) return [profiles];
            if (sql.startsWith("UPDATE usuario")) return [{ affectedRows }];
            return [{ affectedRows: 1, insertId: 50 }];
        }
    };
    return {
        calls,
        promise: () => ({ getConnection: async () => connection })
    };
}

test("only pending verified requests of the four D2 profiles can be approved or rejected", async () => {
    const db = fakeDb();
    assert.deepEqual(await decidePendingTeacher(db, 25, "aprobar", 3), { status: 200, state: "activo" });
    const lookup = db.calls.find(call => call.sql?.includes("FROM usuario WHERE"));
    assert.match(lookup.sql, /estado = 'pendiente' AND rol IN \(\?, \?, \?, \?\) AND correo_verificado_at IS NOT NULL FOR UPDATE/);
    assert.deepEqual(lookup.values, [25, "Docente", "Psicóloga", "Coordinador", "Rector"]);
    const decision = db.calls.find(call => call.sql?.startsWith("UPDATE usuario"));
    assert.deepEqual(decision.values, ["activo", 3, null, null, 25, "Docente"]);
    assert.match(decision.sql, /AND rol = \? AND correo_verificado_at IS NOT NULL/);
    const audit = db.calls.find(call => call.sql?.startsWith("INSERT INTO admin_account_audit"));
    assert.deepEqual(audit.values.slice(0, 5), [25, "registration_approved", "success", "3", "admin_session"]);
    assert.ok(db.calls.some(call => call.sql?.startsWith("INSERT INTO docente") && call.values[3] === 25));
    assert.ok(db.calls.some(call => call.transaction === "commit"));

    const rejected = fakeDb();
    assert.deepEqual(await decidePendingTeacher(rejected, 25, "rechazar", 4, "No cumple requisitos"), { status: 200, state: "rechazado" });
    assert.deepEqual(rejected.calls.find(call => call.sql?.startsWith("UPDATE usuario")).values, ["rechazado", null, 4, "No cumple requisitos", 25, "Docente"]);
    assert.equal(rejected.calls.find(call => call.sql?.startsWith("INSERT INTO admin_account_audit")).values[1], "registration_rejected");
    assert.equal(rejected.calls.some(call => call.sql?.startsWith("INSERT INTO docente")), false);
});

test("approval cannot activate a non-pending or privileged account", async () => {
    const db = fakeDb({ user: null });
    assert.deepEqual(await decidePendingTeacher(db, 26, "aprobar", 3), { status: 404, message: "Solicitud pendiente no encontrada." });
    assert.ok(db.calls.some(call => call.transaction === "rollback"));
});

test("approval fails closed when duplicate teacher profiles are already linked", async () => {
    const db = fakeDb({ profiles: [{ id_docente: 3 }, { id_docente: 4 }] });
    assert.equal((await decidePendingTeacher(db, 25, "aprobar", 3)).status, 409);
    assert.equal(db.calls.some(call => call.sql?.startsWith("UPDATE usuario")), false);
    assert.ok(db.calls.some(call => call.transaction === "rollback"));
});

test("invalid approval decisions are rejected without database writes", async () => {
    const db = fakeDb();
    assert.equal((await decidePendingTeacher(db, 0, "aprobar", 3)).status, 400);
    assert.equal((await decidePendingTeacher(db, 26, "promote-admin", 3)).status, 400);
    assert.equal((await decidePendingTeacher(db, 26, "aprobar")).status, 400);
    assert.equal(db.calls.length, 0);
});

test("self approval and rejection without a bounded reason are rejected before database access", async () => {
    const db = fakeDb();
    assert.equal((await decidePendingTeacher(db, 25, "aprobar", 25)).status, 403);
    assert.equal((await decidePendingTeacher(db, 25, "rechazar", 4)).status, 400);
    assert.equal((await decidePendingTeacher(db, 25, "rechazar", 4, "x".repeat(501))).status, 400);
    assert.equal(db.calls.length, 0);
});

test("failure while linking a teacher profile rolls back without changing approval state", async () => {
    const db = fakeDb();
    const connection = await db.promise().getConnection();
    const originalQuery = connection.query;
    connection.query = async (sql, values) => {
        if (sql.startsWith("INSERT INTO docente")) throw new Error("synthetic profile failure");
        return originalQuery(sql, values);
    };
    await assert.rejects(decidePendingTeacher(db, 25, "aprobar", 3), /synthetic profile failure/);
    assert.ok(db.calls.some(call => call.transaction === "rollback"));
    assert.equal(db.calls.some(call => call.transaction === "commit"), false);
    assert.equal(db.calls.some(call => call.sql?.startsWith("UPDATE usuario")), false);
});

test("decisión D2: Psicóloga, Coordinador y Rector se activan sin crear perfil adicional", async () => {
    for (const rol of ["Psicóloga", "Coordinador", "Rector"]) {
        const db = fakeDb({ user: { id_usuario: 30, nombre: "Solicitud", documento: "D-30", correo: "s@example.invalid", rol } });
        assert.deepEqual(await decidePendingTeacher(db, 30, "aprobar", 3), { status: 200, state: "activo" }, rol);
        assert.equal(db.calls.some(call => /\b(INSERT INTO|UPDATE|FROM) (docente|psicologa|coordinador)\b/.test(call.sql || "")), false, rol);
        assert.equal(db.calls.find(call => call.sql?.startsWith("UPDATE usuario")).values.at(-1), rol);
        assert.ok(db.calls.some(call => call.transaction === "commit"));
    }
});

test("a self decision or a missing request never writes the audit table", async () => {
    const self = fakeDb();
    assert.equal((await decidePendingTeacher(self, 3, "aprobar", 3)).status, 403);
    assert.equal(self.calls.length, 0);
    const missing = fakeDb({ user: null });
    assert.equal((await decidePendingTeacher(missing, 25, "rechazar", 3, "Motivo")).status, 404);
    assert.equal(missing.calls.some(call => String(call.sql || "").includes("admin_account_audit")), false);
});
