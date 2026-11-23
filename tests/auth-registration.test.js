"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const bcrypt = require("bcryptjs");
const { register, login, PUBLIC_REGISTRATION_ROLES } = require("../backend/auth");

function dbWith(queryFn) {
    const statements = [];
    const runQuery = async (sql, values = []) => {
        statements.push({ sql, values });
        return queryFn(sql, values);
    };
    const connection = {
        beginTransaction: async () => statements.push({ transaction: "begin" }),
        commit: async () => statements.push({ transaction: "commit" }),
        rollback: async () => statements.push({ transaction: "rollback" }),
        release: () => statements.push({ transaction: "release" }),
        query: runQuery,
        execute: runQuery
    };
    return {
        statements,
        promise: () => ({ query: runQuery, getConnection: async () => connection })
    };
}

const payload = {
    nombre: "Ana", apellidos: "Prueba", documento: "SYNTHETIC-REG-1",
    correo: " Ana.Prueba@Example.invalid ", password: "  contraseña segura  ", rol: "Docente"
};

test("public Docente registration hashes the exact password and waits for institutional approval without a verification link", async () => {
    let delivered = false;
    const db = dbWith(async sql => {
        if (sql.startsWith("SELECT id_usuario")) return [[]];
        if (sql.startsWith("INSERT INTO usuario")) return [{ insertId: 41 }];
        throw new Error("Unexpected SQL in registration test: " + sql);
    });
    const result = await register(db, payload, false, async () => { delivered = true; });
    assert.equal(result.status, 202);
    assert.equal(result.body.pendingApproval, true);
    assert.match(result.body.message, /pendiente de aprobación institucional/);
    assert.match(result.body.message, /Administrador o Rector/);
    const insert = db.statements.find(statement => statement.sql?.startsWith("INSERT INTO usuario"));
    assert.equal(insert.values[2], "ana.prueba@example.invalid");
    assert.equal(insert.values[3], "Docente");
    assert.equal(insert.values[4], "");
    assert.ok(await bcrypt.compare(payload.password, insert.values[5]));
    assert.equal(insert.values[6], "pendiente");
    // El correo no se marca como verificado y no se crea ni envía ningún enlace.
    assert.doesNotMatch(insert.sql, /correo_verificado_at/);
    assert.equal(db.statements.some(statement => /verificacion_correo/.test(statement.sql || "")), false);
    assert.equal(delivered, false);
    assert.ok(!JSON.stringify(result).includes(payload.password));
    assert.ok(db.statements.some(statement => statement.transaction === "commit"));
});

test("registration gives a generic response for duplicate email or document without inserting", async () => {
    const db = dbWith(async sql => sql.startsWith("SELECT id_usuario") ? [[{ id_usuario: 9 }]] : [{ insertId: 1 }]);
    const result = await register(db, payload);
    assert.equal(result.status, 202);
    assert.equal(result.body.pendingApproval, true);
    assert.equal(db.statements.filter(statement => statement.sql?.startsWith("INSERT")).length, 0);
});

test("student role cannot be registered as an authenticated account", async () => {
    const db = dbWith(async () => { throw new Error("Student registration must stop before database access"); });
    const result = await register(db, { ...payload, rol: "Estudiante" });
    assert.equal(result.status, 400);
    assert.equal(db.statements.length, 0);
});

test("decisión D2: la lista pública admite exactamente Docente, Psicóloga, Coordinador y Rector", () => {
    assert.deepEqual(PUBLIC_REGISTRATION_ROLES, ["Docente", "Psicóloga", "Coordinador", "Rector"]);
    assert.ok(Object.isFrozen(PUBLIC_REGISTRATION_ROLES));
    assert.equal(PUBLIC_REGISTRATION_ROLES.includes("Administrador"), false);
    assert.equal(PUBLIC_REGISTRATION_ROLES.includes("Estudiante"), false);
});

test("public registration rejects Administrador, Estudiante and unknown roles before database access", async () => {
    for (const rol of ["Administrador", "Estudiante", "Unknown", "administrador", "Psicologo", "Rector2"]) {
        const db = dbWith(async () => { throw new Error("Disallowed role must stop before database access"); });
        const result = await register(db, { ...payload, rol });
        assert.equal(result.status, 400, rol);
        assert.match(result.body.message, /solo permite solicitar cuentas de Docente, Psicólogo\(a\), Coordinador o Rector/, rol);
        assert.equal(db.statements.length, 0, rol);
    }
});

test("decisión D2: Psicóloga, Coordinador y Rector quedan pendientes de aprobación, sin perfil, activación ni verificación", async () => {
    for (const rol of ["Psicóloga", "Coordinador", "Rector"]) {
        const db = dbWith(async sql => {
            if (sql.startsWith("SELECT id_usuario")) return [[]];
            if (sql.startsWith("INSERT INTO usuario")) return [{ insertId: 42 }];
            throw new Error("Unexpected SQL: " + sql);
        });
        const result = await register(db, { ...payload, rol }, false, async () => { throw new Error("no debe enviarse correo"); });
        assert.equal(result.status, 202, rol);
        const insert = db.statements.find(statement => statement.sql?.startsWith("INSERT INTO usuario"));
        assert.equal(insert.values[3], rol);
        assert.equal(insert.values[6], "pendiente");
        assert.doesNotMatch(insert.sql, /password_change_required/, "el registro público no marca contraseña temporal");
        assert.equal(db.statements.some(statement => /docente|admin_account_audit|verificacion_correo/i.test(statement.sql || "")), false, rol);
    }
});

test("decisión D3: la creación institucional audita, exige cambio de contraseña, queda pendiente de aprobación y responde 409 ante duplicados", async () => {
    const db = dbWith(async sql => {
        if (sql.startsWith("SELECT id_usuario")) return [[]];
        if (sql.startsWith("INSERT INTO usuario")) return [{ insertId: 77 }];
        if (sql.startsWith("INSERT INTO admin_account_audit")) return [{ insertId: 1 }];
        throw new Error("Unexpected SQL: " + sql);
    });
    const created = await register(db, { ...payload, rol: "Rector" }, false, async () => { throw new Error("no debe enviarse correo"); }, { actorId: 5 });
    assert.equal(created.status, 201);
    assert.equal(created.body.pendingApproval, true);
    assert.match(created.body.message, /pendiente de aprobación en «Solicitudes»/);
    const insert = db.statements.find(statement => statement.sql?.startsWith("INSERT INTO usuario"));
    assert.match(insert.sql, /password_change_required\) VALUES \(\?, \?, \?, \?, \?, \?, \?, 1\)/);
    assert.equal(insert.values[6], "pendiente");
    assert.equal(db.statements.some(statement => /verificacion_correo/.test(statement.sql || "")), false);
    const audit = db.statements.find(statement => statement.sql?.startsWith("INSERT INTO admin_account_audit"));
    assert.deepEqual(audit.values.slice(0, 5), [77, "account_created", "pending_approval", "5", "admin_session"]);

    const duplicate = dbWith(async sql => sql.startsWith("SELECT id_usuario") ? [[{ id_usuario: 3 }]] : [[]]);
    assert.equal((await register(duplicate, payload, false, async () => {}, { actorId: 5 })).status, 409);
    assert.equal((await register(duplicate, payload, false, async () => {})).status, 202, "el registro público no revela duplicados");
    await assert.rejects(register(duplicate, payload, false, async () => {}, { actorId: "x" }));
    assert.equal((await register(duplicate, { ...payload, rol: "Administrador" }, false, async () => {}, { actorId: 5 })).status, 400);
});

test("legacy privileged registration flag cannot activate or elevate a Docente request", async () => {
    const db = dbWith(async sql => {
        if (sql.startsWith("SELECT id_usuario")) return [[]];
        if (sql.startsWith("INSERT INTO usuario")) return [{ insertId: 42 }];
        throw new Error("Unexpected SQL in privileged registration regression");
    });
    const result = await register(db, payload, true, async () => {});
    assert.equal(result.status, 202);
    assert.equal(result.body.pendingApproval, true);
    const insert = db.statements.find(statement => statement.sql?.startsWith("INSERT INTO usuario"));
    assert.equal(insert.values[3], "Docente");
    assert.equal(insert.values[6], "pendiente");
    assert.notEqual(insert.values[6], "activo");
});

test("administrative account route only admits the D3 profiles plus Estudiante (D7) and invokes the protected registration flow", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const server = fs.readFileSync(path.join(__dirname, "../backend/server.js"), "utf8");
    assert.match(server, /sessionUser\.rol !== "Administrador"[\s\S]*?Solo un administrador puede crear usuarios/);
    assert.match(server, /!auth\.INSTITUTIONAL_ACCOUNT_ROLES\.includes\(payload\?\.rol\)\)[\s\S]*?sendJson\(response, 403[\s\S]*?auth\.register\(db, payload, false, undefined, \{ actorId: sessionUser\.id \}\)/);
});

test("registration maps a concurrent unique-key collision to the generic response", async () => {
    const db = dbWith(async sql => {
        if (sql.startsWith("SELECT id_usuario")) return [[]];
        const error = new Error("duplicate");
        error.code = "ER_DUP_ENTRY";
        throw error;
    });
    const result = await register(db, payload);
    assert.equal(result.status, 202);
    assert.equal(result.body.pendingApproval, true);
});

test("institutional registration rolls back the account when its audit record cannot be stored", async () => {
    const db = dbWith(async sql => {
        if (sql.startsWith("SELECT id_usuario")) return [[]];
        if (sql.startsWith("INSERT INTO usuario")) return [{ insertId: 73 }];
        if (sql.startsWith("INSERT INTO admin_account_audit")) throw new Error("synthetic audit-store failure");
        throw new Error(`Unexpected SQL: ${sql}`);
    });
    await assert.rejects(register(db, payload, false, async () => {}, { actorId: 5 }), /synthetic audit-store failure/);
    assert.ok(db.statements.some(statement => statement.transaction === "rollback"));
    assert.equal(db.statements.some(statement => statement.transaction === "commit"), false);
});

test("login compares passwords without silently trimming whitespace", async () => {
    const exactPassword = "  exact password  ";
    const hash = await bcrypt.hash(exactPassword, 4);
    let compared;
    const db = dbWith(async (sql, values) => {
        if (sql.startsWith("SELECT id_usuario, nombre, documento, correo, rol, estado, password_hash")) return [[{
            id_usuario: 9, nombre: "Ana", correo: "ana@example.invalid", documento: "SYNTHETIC-LOGIN",
            rol: "Docente", estado: "activo", password_hash: hash, password_change_required: 0
        }]];
        if (sql.startsWith("INSERT INTO sesion_usuario")) return [{ insertId: 1 }];
        if (sql.startsWith("UPDATE usuario SET ultimo_acceso_at")) return [{ affectedRows: 1 }];
        throw new Error(`Unexpected SQL in login test: ${sql}`);
    });
    const originalCompare = bcrypt.compare;
    bcrypt.compare = async (candidate, storedHash) => {
        compared = candidate;
        return originalCompare(candidate, storedHash);
    };
    try {
        const result = await login(db, { correo: " ANA@example.invalid ", password: exactPassword });
        assert.equal(result.status, 200);
        assert.equal(compared, exactPassword);
    } finally {
        bcrypt.compare = originalCompare;
    }
});

test("login performs a bcrypt comparison for unknown email addresses", async () => {
    const db = dbWith(async sql => sql.startsWith("SELECT id_usuario, nombre, documento, correo, rol, estado, password_hash") ? [[]] : []);
    const originalCompare = bcrypt.compare;
    let comparedHash;
    bcrypt.compare = async (_candidate, hash) => { comparedHash = hash; return false; };
    try {
        const result = await login(db, { correo: "missing@example.invalid", password: "synthetic-password" });
        assert.equal(result.status, 401);
        assert.deepEqual(result.body, { ok: false, message: "Correo o contraseña incorrectos" });
        assert.match(comparedHash, /^\$2[aby]\$12\$/);
    } finally {
        bcrypt.compare = originalCompare;
    }
});

test("pending and rejected accounts cannot create sessions", async () => {
    const hash = await bcrypt.hash("password-value", 4);
    for (const state of ["pendiente", "rechazado"]) {
        const db = dbWith(async sql => {
            if (sql.startsWith("SELECT id_usuario, nombre, documento, correo, rol, estado, password_hash, password_change_required FROM usuario")) return [[{
                id_usuario: 10, nombre: "Pending", correo: "pending@example.invalid", documento: "SYNTHETIC-PENDING",
                rol: "Docente", estado: state, password_hash: hash
            }]];
            throw new Error("No session should be created for an inactive account");
        });
        const result = await login(db, { correo: "pending@example.invalid", password: "password-value" });
        assert.equal(result.status, 401);
        assert.equal(result.session, undefined);
        assert.equal(db.statements.length, 1);
    }
});

test("manual approval: pending, unverified-pending and rejected accounts cannot log in; an approved account can even without a verified email", async () => {
    const password = "Frase sintética de acceso 2026";
    const hash = await bcrypt.hash(password, 4);
    const attempt = async (estado, correoVerificado) => {
        const db = dbWith(async sql => {
            if (sql.startsWith("SELECT id_usuario, nombre, documento, correo, rol, estado, password_hash")) return [[{
                id_usuario: 60, nombre: "Solicitante", correo: "solicitante@example.invalid", documento: "SYNTHETIC-APPROVAL",
                rol: "Docente", estado, correo_verificado_at: correoVerificado, password_hash: hash, password_change_required: 0
            }]];
            if (sql.startsWith("INSERT INTO sesion_usuario")) return [{ insertId: 1 }];
            if (sql.startsWith("UPDATE usuario SET ultimo_acceso_at")) return [{ affectedRows: 1 }];
            throw new Error(`Unexpected SQL in approval login test: ${sql}`);
        });
        return { result: await login(db, { correo: "solicitante@example.invalid", password }), db };
    };
    for (const estado of ["pendiente", "pendiente_verificacion", "rechazado", "inactivo"]) {
        const { result, db } = await attempt(estado, null);
        assert.equal(result.status, 401, estado);
        assert.equal(db.statements.some(statement => statement.sql?.startsWith("INSERT INTO sesion_usuario")), false, estado);
    }
    const approved = await attempt("activo", null);
    assert.equal(approved.result.status, 200, "la aprobación institucional permite ingresar sin correo verificado");
});
