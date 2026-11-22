"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { TARGET, targetForProfile, mysqlConnectionConfig, integrationEnvironment, assertIntegrationGrants, assertFixtureRetentionDisabled } = require("../scripts/local-piar-test-config");
const { buildEnvironment, readTestCredentials } = require("../scripts/start-local-backend");

test("native backend launcher pins the local test MySQL and never accepts root or other schemas", () => {
    const credentials = { DB_USER: "piar_test", DB_PASSWORD: "synthetic" };
    const env = buildEnvironment({ DB_HOST: "10.0.0.5", DB_PORT: "3306", DB_NAME: "piar" }, credentials);
    assert.equal(env.DB_HOST, "127.0.0.1");
    assert.equal(env.DB_PORT, "3307");
    assert.equal(env.DB_NAME, "piar_test");
    assert.equal(env.HOST, "127.0.0.1");
    assert.equal(env.PORT, "8090");
    assert.equal(buildEnvironment({ PIAR_LOCAL_DB_NAME: "piar_test_e2e", PORT: "8092" }, credentials).DB_NAME, "piar_test_e2e");
    for (const name of ["piar", "piar_dev", "piar_test;DROP", "otra"]) {
        assert.throws(() => buildEnvironment({ PIAR_LOCAL_DB_NAME: name }, credentials), /piar_test/);
    }
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "piar-launcher-"));
    try {
        fs.writeFileSync(path.join(dir, ".env.test"), "DB_USER=root\nDB_PASSWORD=x\n");
        assert.throws(() => readTestCredentials(path.join(dir, ".env.test")), /root/);
        fs.writeFileSync(path.join(dir, ".env.test"), "DB_USER=piar_test\nDB_PASSWORD=\n");
        assert.throws(() => readTestCredentials(path.join(dir, ".env.test")), /DB_PASSWORD/);
        fs.writeFileSync(path.join(dir, ".env.test"), "DB_USER=piar_test\nDB_PASSWORD=abc\nMYSQL_ROOT_PASSWORD=zzz\nDB_PORT=1\n");
        assert.deepEqual(readTestCredentials(path.join(dir, ".env.test")), { DB_USER: "piar_test", DB_PASSWORD: "abc" });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("local test database connection is pinned to piar_test on loopback", () => {
    assert.deepEqual(mysqlConnectionConfig("synthetic-test-password"), {
        host: "127.0.0.1",
        port: 3307,
        user: "piar_test",
        password: "synthetic-test-password",
        database: "piar_test",
        connectTimeout: 5000
    });
    assert.deepEqual(TARGET, { host: "127.0.0.1", port: 3307, user: "piar_test", database: "piar_test", apiPort: "8081" });
});

test("local profile defaults to the single 3307 container and never to 3306", () => {
    assert.equal(targetForProfile("local", {}).port, 3307);
    assert.equal(targetForProfile("local", { PIAR_TEST_DB_PORT: "" }).port, 3307);
    assert.equal(targetForProfile("local", { PIAR_TEST_DB_PORT: "3306" }).port, 3306, "CI may still select 3306 explicitly");
    assert.equal(targetForProfile("local", {}).database, "piar_test");
    assert.throws(() => targetForProfile("local", { PIAR_TEST_DB_PORT: "70000" }), /valid TCP port/);
});

test("legacy fresh target (retired 3308 container) keeps the same isolated schema", () => {
    assert.deepEqual(targetForProfile("fresh"), { host: "127.0.0.1", port: 3308, user: "piar_test", database: "piar_test", apiPort: "8081" });
    assert.deepEqual(mysqlConnectionConfig("synthetic-test-password", "fresh"), {
        host: "127.0.0.1", port: 3308, user: "piar_test", password: "synthetic-test-password", database: "piar_test", connectTimeout: 5000
    });
    assert.throws(() => targetForProfile("production"), /existing or fresh/);
});

test("integration backend environment overrides inherited database targets", () => {
    const env = integrationEnvironment({ DB_HOST: "remote.invalid", DB_PORT: "3306", DB_NAME: "production", DB_USER: "root", PORT: "3000" }, "synthetic-test-password");
    assert.equal(env.DB_HOST, "127.0.0.1");
    assert.equal(env.DB_PORT, "3307");
    assert.equal(env.DB_NAME, "piar_test");
    assert.equal(env.DB_USER, "piar_test");
    assert.equal(env.HOST, "127.0.0.1");
    assert.equal(env.PORT, "8081");
    assert.equal(env.DB_PASSWORD, "synthetic-test-password");
    assert.equal(env.NODE_ENV, "test");
    assert.equal(env.APP_BASE_URL, "http://127.0.0.1:8081");
    assert.equal(env.EMAIL_TRANSPORT, "api");
});

test("fresh integration environment explicitly targets loopback 3308 and piar_test", () => {
    const env = integrationEnvironment({ DB_HOST: "remote.invalid", DB_PORT: "3306", DB_NAME: "production", DB_USER: "root" }, "synthetic-test-password", "fresh");
    assert.equal(env.DB_HOST, "127.0.0.1");
    assert.equal(env.DB_PORT, "3308");
    assert.equal(env.DB_NAME, "piar_test");
    assert.equal(env.DB_USER, "piar_test");
    assert.equal(env.PIAR_TEST_PROFILE, "fresh");
});

test("empty passwords are rejected before a MySQL connection can be built", () => {
    assert.throws(() => mysqlConnectionConfig(""), /non-empty local test database password/);
    assert.throws(() => integrationEnvironment({}, ""), /non-empty local test database password/);
});

test("fixture retention is rejected before database access", () => {
    assert.throws(() => assertFixtureRetentionDisabled({ PIAR_TEST_KEEP_FIXTURES: "1" }), /ya no está permitido/);
    for (const value of [undefined, "", "0", "true", "yes"]) {
        assert.equal(assertFixtureRetentionDisabled({ PIAR_TEST_KEEP_FIXTURES: value }), true);
    }
});

test("integration grants allow only DML on piar_test and harmless global USAGE", () => {
    assert.equal(assertIntegrationGrants([
        { grant: "GRANT USAGE ON *.* TO `piar_test`@`%`" },
        { grant: "GRANT SELECT, INSERT, UPDATE, DELETE ON `piar\\_test`.* TO `piar_test`@`%`" }
    ]), true);
    assert.throws(() => assertIntegrationGrants([
        { grant: "GRANT USAGE ON *.* TO `piar_test`@`%`" },
        { grant: "GRANT ALL PRIVILEGES ON `piar\\_test`.* TO `piar_test`@`%`" }
    ]), /beyond SELECT\/INSERT\/UPDATE\/DELETE/);
    assert.throws(() => assertIntegrationGrants([
        { grant: "GRANT SELECT, INSERT, UPDATE, DELETE ON *.* TO `piar_test`@`%`" }
    ]), /outside piar_test/);
    assert.throws(() => assertIntegrationGrants([
        { grant: "GRANT SELECT, INSERT, UPDATE, DELETE ON `piar\\_test`.* TO `piar_test`@`%` WITH GRANT OPTION" }
    ]), /GRANT OPTION/);
});
