"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createPrimaryAdmin, validAdminInput } = require("../backend/primary-admin-bootstrap");

test("legacy helper refuses all calls without touching a database", async () => {
    const calls = [];
    const connection = { query: async () => calls.push("query"), execute: async () => calls.push("execute") };
    assert.equal(validAdminInput({ name: "x", email: "a@example.invalid", document: "x", password: "a very long test password" }), false);
    await assert.rejects(createPrimaryAdmin(connection, {}), /deshabilitado.*bootstrap-local-primary-admin/);
    assert.deepEqual(calls, []);
});

test("bootstrap command is standalone, opt-in, and not exposed through the API", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const source = fs.readFileSync(path.join(__dirname, "../scripts/bootstrap-primary-admin.js"), "utf8");
    assert.match(source, /bootstrap-local-primary-admin/);
    assert.doesNotMatch(source, /mysql\.createConnection|INSERT INTO usuario|PIAR_ENABLE_INITIAL_ADMIN_BOOTSTRAP/);
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../backend/server.js"), "utf8"), /bootstrap-primary-admin/);
});
