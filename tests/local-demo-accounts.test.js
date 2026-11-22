"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { TARGET, CONFIRMATION, validateDemoInputs, assertDemoSeedPrivileges, createAccounts } = require("../scripts/create-local-demo-accounts");
const { hasRetainedSyntheticFixtureUsers, assertNoRetainedSyntheticFixtureUsers } = require("../scripts/integration-fixture-guard");

const validEnv = {
    PIAR_ALLOW_LOCAL_DEMO_SEED: "1",
    DEMO_TEACHER_NAME: "Docente",
    DEMO_TEACHER_LAST_NAME: "Demo",
    DEMO_TEACHER_DOCUMENT: "DEMO-TEACHER-001",
    DEMO_TEACHER_EMAIL: "teacher-demo@example.invalid"
};

test("demo account initializer is pinned to the disposable local test database and requires explicit opt-in", () => {
    assert.deepEqual(TARGET, { host: "127.0.0.1", port: 3307, database: "piar_test", user: "piar_test" });
    assert.equal(Object.isFrozen(TARGET), true);
    assert.match(CONFIRMATION, /piar_test/);
    assert.throws(() => validateDemoInputs({ ...validEnv, PIAR_ALLOW_LOCAL_DEMO_SEED: "" }), /PIAR_ALLOW_LOCAL_DEMO_SEED/);
});

test("demo initializer accepts only a synthetic Docente and non-deliverable email", () => {
    const accounts = validateDemoInputs(validEnv);
    assert.equal(Object.hasOwn(accounts, "administrator"), false);
    assert.equal(accounts.teacher.role, "Docente");
    assert.throws(() => validateDemoInputs({ ...validEnv, DEMO_TEACHER_DOCUMENT: "123456" }), /DEMO-/);
    assert.throws(() => validateDemoInputs({ ...validEnv, DEMO_TEACHER_EMAIL: "teacher@example.com" }), /\.invalid/);
});

test("repeated demo seeding can create only Docente rows, never synthetic Administrators", async () => {
    const insertedRoles = [];
    let insertId = 0;
    const connection = {
        async beginTransaction() {}, async commit() {}, async rollback() {},
        async execute(sql) {
            if (/SELECT id_usuario/.test(sql)) return [[]];
            if (/INSERT INTO usuario/.test(sql)) {
                insertedRoles.push(sql.match(/'([A-Za-z]+)'/g)?.[0] || sql);
                return [{ insertId: ++insertId }];
            }
            if (/INSERT INTO docente/.test(sql)) return [{ insertId: 100 + insertId }];
            throw new Error("Unexpected fake query");
        }
    };
    const makeAccounts = suffix => ({ teacher: {
        name: `Docente Demo ${suffix}`, firstName: "Docente", lastName: `Demo ${suffix}`,
        document: `DEMO-TEACHER-${suffix}`, email: `teacher-${suffix}@example.invalid`, role: "Docente"
    } });
    await createAccounts(connection, makeAccounts("001"), { teacher: "demo-password-001" });
    await createAccounts(connection, makeAccounts("002"), { teacher: "demo-password-002" });
    assert.equal(insertedRoles.length, 2);
    assert.deepEqual(insertedRoles, ["'Docente'", "'Docente'"]);
});

test("integration preflight recognizes retained synthetic fixture accounts of every role", () => {
    assert.equal(hasRetainedSyntheticFixtureUsers([
        { rol: "Administrador", correo: "IT0123456789abcdef0@example.invalid", documento: "IT0123456789abcdef0" }
    ]), true);
    assert.equal(hasRetainedSyntheticFixtureUsers([
        { rol: "Administrador", correo: "it0123456789abcdef0@example.invalid", documento: "IT0123456789abcdef0" }
    ]), true);
    assert.equal(hasRetainedSyntheticFixtureUsers([
        { rol: "Docente", correo: "IT0123456789abcdef5@example.invalid", documento: "IT0123456789abcdef5" }
    ]), true);
    assert.equal(hasRetainedSyntheticFixtureUsers([
        { rol: "Docente", correo: "it0123456789abcdefR@example.invalid", documento: "IT0123456789abcdefR" }
    ]), true);
    assert.equal(hasRetainedSyntheticFixtureUsers([
        { rol: "Administrador", correo: "admin@example.invalid", documento: "IT0123456789abcdef0" },
        { rol: "Administrador", correo: "IT0123456789abcdef0@example.invalid", documento: "OTHER" }
    ]), false);
});

test("integration preflight blocks fixture creation without deleting or changing rows", async () => {
    let queryCount = 0;
    const connection = { async execute() {
        queryCount++;
        return [[{ rol: "Administrador", correo: "IT0123456789abcdef0@example.invalid", documento: "IT0123456789abcdef0" }]];
    } };
    await assert.rejects(assertNoRetainedSyntheticFixtureUsers(connection), /No se crearon fixtures nuevos/);
    assert.equal(queryCount, 1);
});

test("demo seed preflight accepts only DML grants on the exact test schema", () => {
    assert.doesNotThrow(() => assertDemoSeedPrivileges([
        { Grants: "GRANT USAGE ON *.* TO `piar_test`@`%`" },
        { Grants: "GRANT SELECT, INSERT, UPDATE, DELETE ON `piar\\_test`.* TO `piar_test`@`%`" }
    ]));
    assert.throws(() => assertDemoSeedPrivileges([
        { Grants: "GRANT SELECT, INSERT ON *.* TO `piar_test`@`%`" }
    ]), /exclusivamente a piar_test/);
    assert.throws(() => assertDemoSeedPrivileges([
        { Grants: "GRANT SELECT, INSERT, CREATE ON `piar_test`.* TO `piar_test`@`%`" }
    ]), /privilegios peligrosos/);
    assert.throws(() => assertDemoSeedPrivileges([
        { Grants: "GRANT ALL PRIVILEGES ON `piar\\_test`.* TO `piar_test`@`%`" }
    ]), /privilegios peligrosos/);
    assert.throws(() => assertDemoSeedPrivileges([
        { Grants: "GRANT SELECT, INSERT ON `piar_test`.* TO `piar_test`@`%` WITH GRANT OPTION" }
    ]), /GRANT OPTION/);
    assert.throws(() => assertDemoSeedPrivileges([
        { Grants: "GRANT SELECT, INSERT ON `piar_test`.* TO `piar_test`@`%`" },
        { Grants: "GRANT SELECT ON `other_db`.* TO `piar_test`@`%`" }
    ]), /exclusivamente a piar_test/);
    assert.throws(() => assertDemoSeedPrivileges([
        { Grants: "GRANT `seed_role`@`%` TO `piar_test`@`%`" }
    ]), /roles MySQL/);
    assert.throws(() => assertDemoSeedPrivileges([
        { Grants: "GRANT SELECT ON `piar_test`.* TO `piar_test`@`%`" }
    ]), /INSERT/);
});
