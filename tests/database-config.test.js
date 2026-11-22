"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildDatabaseConfig, assertLocalMigrationTarget } = require("../backend/database-config");

const valid = { DB_HOST: "127.0.0.1", DB_PORT: "3307", DB_NAME: "piar_test", DB_USER: "piar_test", DB_PASSWORD: "synthetic" };

test("database configuration requires explicit host, port, schema, user and password", () => {
    for (const key of Object.keys(valid)) {
        const env = { ...valid };
        delete env[key];
        assert.throws(() => buildDatabaseConfig(env), new RegExp(key));
    }
    assert.throws(() => buildDatabaseConfig({ ...valid, DB_NAME: "" }), /DB_NAME/);
});

test("database configuration refuses root, invalid ports and invalid pool sizes", () => {
    assert.throws(() => buildDatabaseConfig({ ...valid, DB_USER: "root" }), /dedicado/);
    assert.throws(() => buildDatabaseConfig({ ...valid, DB_PORT: "3306x" }), /DB_PORT/);
    assert.throws(() => buildDatabaseConfig({ ...valid, DB_CONNECTION_LIMIT: "0" }), /DB_CONNECTION_LIMIT/);
});

test("database configuration uses only explicitly provided target values", () => {
    assert.deepEqual(buildDatabaseConfig(valid), {
        host: "127.0.0.1", port: 3307, database: "piar_test", user: "piar_test", password: "synthetic", connectionLimit: 10
    });
});

test("migration target accepts only loopback piar development and test schemas", () => {
    assert.equal(assertLocalMigrationTarget({ host: "127.0.0.1", database: "piar_test" }), true);
    assert.equal(assertLocalMigrationTarget({ host: "localhost", database: "piar_dev_local" }), true);
    assert.throws(() => assertLocalMigrationTarget({ host: "db.example.com", database: "piar_test" }), /loopback/);
    assert.throws(() => assertLocalMigrationTarget({ host: "127.0.0.1", database: "piar" }), /piar_dev.*piar_test/);
    assert.throws(() => assertLocalMigrationTarget({ host: "127.0.0.1", database: "piar_prod" }), /piar_dev.*piar_test/);
});
