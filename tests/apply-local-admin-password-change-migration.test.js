"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { TARGET, assertMigrationIdentity, assertMigrationGrants, splitMigration, columnExists } = require("../scripts/apply-local-admin-password-change-migration");

test("admin password migration is pinned to the fresh test target", () => {
    assert.deepEqual(TARGET, { host: "127.0.0.1", port: 3308, database: "piar_test", serverPort: 3306, dmlUser: "piar_test" });
    assert.equal(assertMigrationIdentity({ database_name: "piar_test", server_port: 3306, read_only: 0, account_name: "piar_schema@localhost" }), true);
    assert.throws(() => assertMigrationIdentity({ database_name: "piar", server_port: 3306, read_only: 0, account_name: "piar_schema@localhost" }));
    assert.throws(() => assertMigrationIdentity({ database_name: "piar_test", server_port: 3307, read_only: 0, account_name: "piar_schema@localhost" }));
    assert.throws(() => assertMigrationIdentity({ database_name: "piar_test", server_port: 3306, read_only: 0, account_name: "piar_test@localhost" }));
});

test("only a separate ALTER identity scoped to piar_test can apply migration 011", () => {
    assert.equal(assertMigrationGrants([
        "GRANT USAGE ON *.* TO 'piar_schema'@'localhost'",
        "GRANT ALTER ON `piar_test`.* TO 'piar_schema'@'localhost'"
    ]), true);
    assert.throws(() => assertMigrationGrants(["GRANT SELECT, INSERT, UPDATE, DELETE ON `piar_test`.* TO 'piar_test'@'%'" ]), /únicamente ALTER/);
    assert.throws(() => assertMigrationGrants(["GRANT ALTER ON *.* TO 'piar_schema'@'%'" ]), /privilegios limitados/);
    assert.throws(() => assertMigrationGrants(["GRANT ALL PRIVILEGES ON `piar_test`.* TO 'piar_schema'@'%'" ]), /ningún privilegio global/);
    assert.throws(() => assertMigrationGrants(["GRANT ALTER ON `piar_test`.* TO 'piar_schema'@'%' WITH GRANT OPTION" ]), /GRANT OPTION/);
});

test("migration parser accepts the checked 011 SQL and rejects unrelated or expanded SQL", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../database/migrations/011_admin_initial_password_change.sql"), "utf8");
    const statements = splitMigration(sql);
    assert.equal(statements.length, 5);
    assert.match(statements[1], /ALTER TABLE usuario ADD COLUMN password_change_required/i);
    assert.throws(() => splitMigration(`${sql}\nDROP TABLE usuario;`));
});

test("column inspection accepts only the expected non-null tinyint default", async () => {
    assert.equal(await columnExists({ execute: async () => [[{ COLUMN_TYPE: "tinyint(1)", IS_NULLABLE: "NO", COLUMN_DEFAULT: "0" }]] }), true);
    assert.equal(await columnExists({ execute: async () => [[]] }), false);
    await assert.rejects(columnExists({ execute: async () => [[{ COLUMN_TYPE: "varchar(1)", IS_NULLABLE: "NO", COLUMN_DEFAULT: "0" }]] }));
});
