const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { classifyMutation } = require("../backend/mutation-result");
const { escapeHTML } = require("../public/js/security");

test("mutation outcomes distinguish changes, unchanged existing rows and missing rows", () => {
    assert.equal(classifyMutation({ affectedRows: 1, changedRows: 1 }, true), "changed");
    assert.equal(classifyMutation({ affectedRows: 1, changedRows: 0 }, true), "unchanged");
    assert.equal(classifyMutation({ affectedRows: 0, changedRows: 0 }, false), "not_found");
});

test("synthetic student, observation and diagnosis payloads become inert HTML text", () => {
    assert.equal(escapeHTML(`<img src=x onerror='alert(1)'>&\"`), "&lt;img src=x onerror=&#39;alert(1)&#39;&gt;&amp;&quot;");
    assert.equal(escapeHTML("Ana <img src=x onerror=alert(1)>"), "Ana &lt;img src=x onerror=alert(1)&gt;");
    assert.equal(escapeHTML("Nota <svg onload=alert(2)>"), "Nota &lt;svg onload=alert(2)&gt;");
    assert.equal(escapeHTML('\"><script>alert(3)</script>'), "&quot;&gt;&lt;script&gt;alert(3)&lt;/script&gt;");
    assert.equal(escapeHTML(null), "");
});

test("student and health data endpoints use explicit projections and audit metadata only", () => {
    const server = fs.readFileSync(path.join(__dirname, "../backend/server.js"), "utf8");
    const auth = fs.readFileSync(path.join(__dirname, "../backend/auth.js"), "utf8");
    const audit = fs.readFileSync(path.join(__dirname, "../database/migrations/007_piar_audit_events.sql"), "utf8");
    assert.doesNotMatch(`${server}\n${auth}`, /\bSELECT\s+(?:[A-Za-z_][\w]*\.)?\*/i);
    const auditColumns = audit.match(/CREATE TABLE IF NOT EXISTS piar_auditoria \(([\s\S]*?)\) ENGINE/i)?.[1] || "";
    assert.doesNotMatch(auditColumns, /request_body|valor_anterior|valor_nuevo|password|token|diagn[oó]stico|descripcion\s+TEXT/i);
    assert.match(server, /INSERT INTO piar_auditoria \(actor_user_id, action, resource_type, resource_id, result, http_status\)/);
});
