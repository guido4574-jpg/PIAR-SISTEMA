"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { findViolations } = require("../scripts/check-sensitive-files");

test("sensitive paths are rejected regardless of content", () => {
    const violations = findViolations(["data/db.json", ".env", ".env.test", "certs/app.key", "piar-test-cookies.txt", ".env.example", "README.md"], () => "");
    assert.deepEqual(violations.map(item => item.file), ["data/db.json", ".env", ".env.test", "certs/app.key", "piar-test-cookies.txt"]);
});

test("embedded credentials are detected without reporting their value", () => {
    const content = { "a.js": 'auth: { validEmail: "persona@gmail.com", validPassword: "secreto1" }', "b.md": 'validEmail: "usuario@ejemplo.edu.co", validPassword: "<retirada>"', "c.js": "const validPassword = await bcrypt.compare(a, b);", ".env.example": "DB_PASSWORD=REPLACE_WITH_SECRET\nEMAIL_SMTP_PASSWORD=", "d.env.example": "x" };
    const violations = findViolations(Object.keys(content), file => content[file]);
    assert.deepEqual(violations, [{ file: "a.js", rule: "credencial de demostración embebida" }, { file: "a.js", rule: "correo personal" }]);
    assert.ok(!JSON.stringify(violations).includes("secreto1"));
    const leaked = findViolations(["x.txt"], () => "DB_PASSWORD=valor-real\n");
    assert.equal(leaked[0].rule, "secreto con valor en plantilla de entorno");
});
