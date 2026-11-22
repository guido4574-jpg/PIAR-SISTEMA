"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    MIGRATOR, assertRootIdentity, assertMigratorIdentity,
    clientHostFromSessionIdentity, validateMigratorPassword, provisionMigrator
} = require("../scripts/provision-local-admin-migrator");

test("root provisioning identity is accepted only on piar_test fresh", () => {
    assert.equal(assertRootIdentity({ database_name: "piar_test", server_port: 3306, read_only: 0, account_name: "root@%" }), true);
    assert.throws(() => assertRootIdentity({ database_name: "piar", server_port: 3306, read_only: 0, account_name: "root@%" }));
    assert.throws(() => assertRootIdentity({ database_name: "piar_test", server_port: 3306, read_only: 0, account_name: "piar_test@%" }));
});

test("migration account is bound to the exact root client host and target identity", () => {
    assert.equal(MIGRATOR.user, "piar_migrator");
    assert.equal(clientHostFromSessionIdentity("root@172.20.0.1"), "172.20.0.1");
    assert.equal(clientHostFromSessionIdentity("root@db-client.example.internal"), "db-client.example.internal");
    for (const invalid of ["other@172.20.0.1", "root@%", "root@bad_name", "root@172.20.0.1%"])
        assert.throws(() => clientHostFromSessionIdentity(invalid));
    assert.equal(assertMigratorIdentity({ database_name: "piar_test", server_port: 3306, read_only: 0, account_name: "piar_migrator@172.20.0.1" }, "172.20.0.1"), true);
    assert.throws(() => assertMigratorIdentity({ database_name: "piar_test", server_port: 3306, read_only: 0, account_name: "piar_migrator@%" }, "172.20.0.1"));
});

test("migration password is bounded and account receives only database-scoped ALTER", async () => {
    assert.equal(validateMigratorPassword("m".repeat(24)), true);
    assert.throws(() => validateMigratorPassword("short"));
    assert.throws(() => validateMigratorPassword("m".repeat(73)));
    const calls = [];
    const connection = {
        execute: async (sql, args) => { calls.push({ sql, args }); return [[{ User: MIGRATOR.user, Host: "172.20.0.1" }]]; },
        query: async sql => { calls.push({ sql }); return [[]]; }
    };
    await provisionMigrator(connection, "m".repeat(24), "172.20.0.1");
    assert.ok(calls.some(call => /REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'piar_migrator'@'172\.20\.0\.1'/i.test(call.sql || "")));
    assert.ok(calls.some(call => /ALTER USER 'piar_migrator'@'172\.20\.0\.1' IDENTIFIED BY/i.test(call.sql || "")));
    assert.ok(calls.some(call => /GRANT ALTER ON `piar_test`\.\* TO 'piar_migrator'@'172\.20\.0\.1'/i.test(call.sql || "")));
    assert.equal(calls.some(call => /GRANT .* ON \*\.\*/i.test(call.sql || "")), false);
});
