const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const history = require("../public/js/piar-version-history.js");

const app = fs.readFileSync(path.join(__dirname, "../public/js/app.js"), "utf8");
const api = fs.readFileSync(path.join(__dirname, "../public/js/api.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

test("PIAR history UI calls the server endpoints for list and each selected version", () => {
    assert.match(api, /function apiGetPiarVersions\(id\)\s*\{ return apiRequest\(`piar\/\$\{Number\(id\)\}\/versiones`, "GET"\); \}/);
    assert.match(api, /function apiGetPiarVersion\(id, versionId\)\s*\{ return apiRequest\(`piar\/\$\{Number\(id\)\}\/versiones\/\$\{Number\(versionId\)\}`, "GET"\); \}/);
    assert.match(app, /loadPiarVersionHistory\(Number\(piar\.id\)\)/);
    assert.match(app, /PiarVersionHistory\.getComparison\(piarId, first, second, apiGetPiarVersion\)/);
    assert.match(html, /js\/piar-version-history\.js/);
});

test("history listing renders actor, date, operation and optional justification with escaped content", () => {
    assert.match(app, /formatVersionDate\(row\.fecha\)/);
    assert.match(app, /PiarVersionHistory\.formatOperation\(row\.tipo_operacion\)/);
    assert.match(app, /escapeHTML\(row\.usuario/);
    assert.match(app, /escapeHTML\(row\.justificacion\)/);
});

test("version comparison classifies added, modified and removed pedagogical fields", () => {
    const changes = history.compareSnapshots(
        { piar: { estado: "borrador", objetivo_general: "Meta A", informes_salud: "privado" }, barreras: [{ id_barrera: 3, descripcion: "Barrera vieja" }] },
        { piar: { estado: "revision", objetivo_general: "Meta A", informes_salud: "otro privado" }, barreras: [{ id_barrera: 4, descripcion: "Barrera nueva" }] }
    );
    assert.ok(changes.some(change => change.kind === "modified" && change.path === "piar.estado"));
    assert.ok(changes.some(change => change.kind === "removed" && change.path === "barreras[3].descripcion"));
    assert.ok(changes.some(change => change.kind === "added" && change.path === "barreras[4].descripcion"));
    assert.ok(changes.every(change => !/informes_salud|estudiante|diagnosticos|documento|correo/i.test(change.path)));
    assert.match(app, /escapeHTML\(change\.path\)/);
    assert.match(app, /escapeHTML\(change\.before/);
    assert.match(app, /escapeHTML\(change\.after/);
});

test("snapshot projection excludes personal, clinical and secret fields from displayed differences", () => {
    const projection = history.projectSnapshot({
        piar: { estado: "cerrado", informes_salud: "confidencial", password: "hash", objetivo_general: "Objetivo" },
        estudiante: { nombre: "Persona", documento: "123", telefono: "555" },
        diagnosticos: [{ descripcion: "dato clínico" }],
        docentes: [{ nombre: "Docente", correo: "private@example.test", area: "Ciencias" }],
        ajustes: [{ id_ajuste: 1, estrategia: "Apoyo", evidencias: [{ id_evidencia: 2, descripcion: "Evidencia", referencia: "secret://" }] }]
    });
    const rendered = JSON.stringify(projection);
    assert.doesNotMatch(rendered, /confidencial|password|Persona|123|555|dato clínico|private@example|secret:\/\//);
    assert.match(rendered, /Objetivo|Ciencias|Apoyo|Evidencia/);
});

test("version list loading propagates server denial and validates response shape", async () => {
    const denied = Object.assign(new Error("denied"), { status: 403 });
    await assert.rejects(history.loadVersions(7, async id => { assert.equal(id, 7); throw denied; }), error => error.status === 403);
    await assert.rejects(history.loadVersions(7, async () => ({ data: {} })), /formato válido/);
});

test("comparison fetches both versions through server authorization and reports access errors", async () => {
    const calls = [];
    const result = await history.getComparison("12", "8", "9", async (piarId, versionId) => {
        calls.push([piarId, versionId]);
        return { data: { version_id: versionId, valor_nuevo: { piar: { estado: versionId === 8 ? "borrador" : "revision" } } } };
    });
    assert.deepEqual(calls.sort((a, b) => a[1] - b[1]), [[12, 8], [12, 9]]);
    assert.equal(result.changes[0].kind, "modified");
    const denied = Object.assign(new Error("forbidden"), { status: 403 });
    await assert.rejects(history.getComparison(12, 8, 9, async () => { throw denied; }), error => error.status === 403);
    await assert.rejects(history.getComparison(12, 8, 8, async () => ({ data: {} })), /dos versiones diferentes/);
});

test("the detail view communicates 403/404 and exposes no restore or edit controls", () => {
    assert.match(app, /error\.status === 403[\s\S]*denegó el acceso al historial/);
    assert.match(app, /error\.status === 404[\s\S]*No se encontró este PIAR/);
    const section = app.slice(app.indexOf("function renderPiarVersionHistory"), app.indexOf("async function reloadPiarDetail"));
    assert.doesNotMatch(section, /restaurar|editar versión/i);
});
