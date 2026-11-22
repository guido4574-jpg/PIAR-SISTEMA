"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const bcrypt = require("bcryptjs");
const { createInitialAdmin, recoverExistingAdminPassword, assertLocalAdminDatabase } = require("../backend/admin-account-operations");
const { validateAdminEvent } = require("../backend/admin-account-audit");

function mockConnection({ admins = [], existing = [], target = [{ id_usuario: 42, rol: "Administrador", estado: "activo" }], auditFails = false, serverPort = 3306 } = {}) {
    const calls = [];
    const connection = {
        calls,
        async query(sql, values = []) {
            calls.push({ kind: "query", sql, values });
            if (sql.includes("DATABASE()")) return [[{ database_name: "piar_test", server_port: serverPort, read_only: 0, account_name: "piar_test@localhost" }]];
            return [[]];
        },
        async execute(sql, values = []) {
            calls.push({ kind: "execute", sql, values });
            if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
            if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
            if (sql.includes("WHERE rol = 'Administrador'")) return [admins];
            if (sql.includes("WHERE correo = ? OR documento = ?")) return [existing];
            if (sql.includes("WHERE id_usuario = ? LIMIT 1 FOR UPDATE")) return [target];
            if (sql.startsWith("INSERT INTO usuario")) return [{ insertId: 77 }];
            if (sql.startsWith("UPDATE usuario SET password_hash")) return [{ affectedRows: 1 }];
            if (sql.startsWith("INSERT INTO admin_account_audit") && auditFails) throw new Error("audit write failed");
            return [{ affectedRows: 1 }];
        },
        async beginTransaction() { calls.push({ kind: "begin" }); },
        async commit() { calls.push({ kind: "commit" }); },
        async rollback() { calls.push({ kind: "rollback" }); }
    };
    return connection;
}

test("administrator mutation guard rejects a server whose internal @@port is not 3306 before locks or writes", async () => {
    const db = mockConnection({ serverPort: 3307 });
    await assert.rejects(assertLocalAdminDatabase(db), /no corresponde a la instancia local piar_test autorizada/);
    assert.equal(db.calls.some(call => call.sql?.includes("GET_LOCK")), false);
    assert.equal(db.calls.some(call => call.sql?.startsWith("INSERT INTO usuario") || call.sql?.startsWith("UPDATE usuario")), false);
});

const operator = {
    operatorIdentityClaim: "Operador local declarado",
    authorizationReference: "AUT-LOCAL-2026-01",
    reason: "Recuperación autorizada para pruebas locales"
};

test("initial administrator is explicit, pending verification, audited, and never elevates an existing account", async () => {
    const db = mockConnection();
    const result = await createInitialAdmin(db, {
        ...operator, name: "Admin local", document: "LOCAL-ADMIN-001", email: "principal@example.invalid",
        password: "a-secure-local-password"
    });
    const insert = db.calls.find(call => call.sql?.startsWith("INSERT INTO usuario"));
    assert.match(insert.sql, /'Administrador'.*'pendiente_verificacion', NULL/);
    assert.match(insert.sql, /password_change_required\) VALUES .*1/);
    assert.equal(await bcrypt.compare("a-secure-local-password", insert.values[3]), true);
    assert.ok(!insert.values.includes("a-secure-local-password"));
    const verification = db.calls.find(call => call.sql?.startsWith("INSERT INTO verificacion_correo"));
    assert.equal(verification.values[0], 77);
    assert.notEqual(verification.values[1], result.verificationToken);
    assert.equal(verification.values[1].length, 64);
    const audit = db.calls.find(call => call.sql?.startsWith("INSERT INTO admin_account_audit"));
    assert.equal(audit.values[0], 77);
    assert.equal(audit.values[1], "initial_admin_created");
    assert.equal(audit.values[2], "pending_verification");
    assert.ok(audit.values.includes(operator.authorizationReference));
    assert.ok(!audit.values.includes(result.verificationToken));
    assert.ok(db.calls.some(call => call.kind === "commit"));
});

test("initial administrator creation rejects duplicates and rolls back", async () => {
    const db = mockConnection({ admins: [{ id_usuario: 9 }] });
    await assert.rejects(createInitialAdmin(db, {
        ...operator, name: "Admin", document: "LOCAL-ADMIN-002", email: "other@example.invalid", password: "a-secure-local-password"
    }), /Ya existe una cuenta Administrador/);
    assert.ok(db.calls.some(call => call.kind === "rollback"));
    assert.equal(db.calls.some(call => call.sql?.startsWith("INSERT INTO usuario")), false);
});

test("recovery requires an explicit active Administrator ID, only changes its hash, and revokes its sessions and tokens", async () => {
    const db = mockConnection();
    await recoverExistingAdminPassword(db, { ...operator, userId: 42, password: "a-new-local-password" });
    const userUpdate = db.calls.find(call => call.sql?.startsWith("UPDATE usuario SET password_hash"));
    assert.match(userUpdate.sql, /rol = 'Administrador' AND estado = 'activo'/);
    assert.equal(userUpdate.values[1], 42);
    assert.equal(await bcrypt.compare("a-new-local-password", userUpdate.values[0]), true);
    assert.ok(!userUpdate.values.includes("a-new-local-password"));
    assert.ok(db.calls.some(call => call.sql?.startsWith("UPDATE sesion_usuario SET revoked_at") && call.values[0] === 42));
    assert.ok(db.calls.some(call => call.sql?.startsWith("UPDATE recuperacion_contrasena SET consumed_at") && call.values[0] === 42));
    const audit = db.calls.find(call => call.sql?.startsWith("INSERT INTO admin_account_audit"));
    assert.equal(audit.values[0], 42);
    assert.equal(audit.values[1], "password_recovered");
    assert.ok(!audit.values.includes(userUpdate.values[0]));
    assert.ok(db.calls.some(call => call.kind === "commit"));
});

test("recovery refuses non-admin or inactive targets without changing role or password", async () => {
    for (const target of [[], [{ id_usuario: 42, rol: "Docente", estado: "activo" }], [{ id_usuario: 42, rol: "Administrador", estado: "inactivo" }]]) {
        const db = mockConnection({ target });
        await assert.rejects(recoverExistingAdminPassword(db, { ...operator, userId: 42, password: "a-new-local-password" }), /no es un Administrador activo/);
        assert.ok(db.calls.some(call => call.kind === "rollback"));
        assert.equal(db.calls.some(call => call.sql?.startsWith("UPDATE usuario")), false);
        assert.equal(db.calls.some(call => call.sql?.startsWith("INSERT INTO admin_account_audit")), false);
    }
});

test("recovery rolls back password mutation if audit persistence fails", async () => {
    const db = mockConnection({ auditFails: true });
    await assert.rejects(recoverExistingAdminPassword(db, { ...operator, userId: 42, password: "a-new-local-password" }), /audit write failed/);
    assert.ok(db.calls.some(call => call.sql?.startsWith("UPDATE usuario SET password_hash")));
    assert.ok(db.calls.some(call => call.kind === "rollback"));
    assert.equal(db.calls.some(call => call.kind === "commit"), false);
});

test("administrative audit distinguishes a claimed local operator from email-token verification", () => {
    assert.throws(() => validateAdminEvent({
        targetUserId: 1, operation: "password_recovered", outcome: "success",
        operatorIdentityClaim: "", operatorIdentitySource: "local_cli_self_asserted",
        authorizationReference: "AUTH-1", reason: "Reason"
    }), /Identity|declaration|referencia/i);
    assert.doesNotThrow(() => validateAdminEvent({
        targetUserId: 1, operation: "email_verified", outcome: "success",
        operatorIdentityClaim: null, operatorIdentitySource: "email_verification_token",
        authorizationReference: null, reason: null
    }));
    assert.throws(() => validateAdminEvent({
        targetUserId: 1, operation: "email_verified", outcome: "success",
        operatorIdentityClaim: "operador", operatorIdentitySource: "email_verification_token",
        authorizationReference: "AUTH-1", reason: "wrong attribution"
    }), /must not claim/i);
});

// --- Validación específica de los datos de autorización del operador ---
const { validateOperator, operatorFieldProblem, OPERATOR_FIELDS } = require("../backend/admin-account-operations");

test("validateOperator indica en español qué campo falla y por qué, sin repetir el valor", () => {
    const secreto = "VALOR-SINTETICO-NO-DEBE-APARECER";
    const casos = [
        [{ ...operator, operatorIdentityClaim: "" }, /«Identidad declarada del operador» está vacío/],
        [{ ...operator, operatorIdentityClaim: "   " }, /«Identidad declarada del operador» está vacío/],
        [{ ...operator, authorizationReference: undefined }, /«Referencia de autorización» está vacío/],
        [{ ...operator, reason: "" }, /«Motivo» está vacío/],
        [{ ...operator, operatorIdentityClaim: secreto + "x".repeat(151) }, /«Identidad declarada del operador» supera el máximo de 150 caracteres \(tiene 183\)/],
        [{ ...operator, authorizationReference: secreto + "R".repeat(97) }, /«Referencia de autorización» supera el máximo de 128 caracteres \(tiene 129\)/],
        [{ ...operator, reason: secreto + "m".repeat(469) }, /«Motivo» supera el máximo de 500 caracteres \(tiene 501\)/],
        [{ ...operator, operatorIdentityClaim: `${secreto}\tlocal` }, /«Identidad declarada del operador» contiene tabulaciones/],
        [{ ...operator, authorizationReference: `${secreto}\r\nREF` }, /«Referencia de autorización» contiene tabulaciones, saltos de línea/],
        [{ ...operator, reason: `${secreto}\x16` }, /«Motivo» contiene .*caracteres de control/]
    ];
    for (const [input, pattern] of casos) {
        assert.throws(() => validateOperator(input), error => {
            assert.match(error.message, pattern);
            assert.match(error.message, /^Datos de autorización no válidos\./);
            assert.match(error.message, /No se modificó ninguna cuenta\.$/);
            assert.ok(!error.message.includes(secreto), "el mensaje no debe incluir el valor recibido");
            assert.doesNotMatch(error.message, /motivo son obligatorios/, "el mensaje genérico anterior no debe volver");
            return true;
        });
    }
});

test("validateOperator informa todos los campos inválidos a la vez y acepta los límites exactos", () => {
    assert.throws(() => validateOperator({ operatorIdentityClaim: "", authorizationReference: "A\tB", reason: "m".repeat(501) }), error => {
        assert.match(error.message, /«Identidad declarada del operador» está vacío/);
        assert.match(error.message, /«Referencia de autorización» contiene tabulaciones/);
        assert.match(error.message, /«Motivo» supera el máximo de 500/);
        return true;
    });
    assert.doesNotThrow(() => validateOperator({ operatorIdentityClaim: "i".repeat(150), authorizationReference: "r".repeat(128), reason: "m".repeat(500) }));
    assert.equal(operatorFieldProblem("reason", "Motivo válido"), null);
    assert.throws(() => operatorFieldProblem("campoInexistente", "x"), /Campo de atribución desconocido/);
    assert.deepEqual(Object.fromEntries(Object.entries(OPERATOR_FIELDS).map(([key, rule]) => [key, rule.maxLength])),
        { operatorIdentityClaim: 150, authorizationReference: 128, reason: 500 });
    assert.ok(Object.isFrozen(OPERATOR_FIELDS));
});

test("los datos de autorización inválidos se rechazan antes de cualquier consulta, bloqueo o escritura", async () => {
    for (const cambio of [{ operatorIdentityClaim: "" }, { authorizationReference: "REF\t1" }, { reason: "m".repeat(501) }]) {
        const db = mockConnection();
        await assert.rejects(createInitialAdmin(db, {
            ...operator, ...cambio, name: "Admin local", document: "LOCAL-ADMIN-003", email: "principal@example.invalid", password: "a-secure-local-password"
        }), /Datos de autorización no válidos/);
        assert.equal(db.calls.length, 0, "no debe haber consultas antes de validar");
        const recovery = mockConnection();
        await assert.rejects(recoverExistingAdminPassword(recovery, { ...operator, ...cambio, userId: 42, password: "a-new-local-password" }), /Datos de autorización no válidos/);
        assert.equal(recovery.calls.length, 0, "la recuperación tampoco consulta antes de validar");
    }
});
