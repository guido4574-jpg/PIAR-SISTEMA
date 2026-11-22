const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "../public/js/app.js"), "utf8");
const dashboardCss = fs.readFileSync(path.join(__dirname, "../public/css/dashboard.css"), "utf8");

test("PIAR detail exposes structured barrier, adjustment outcome, evidence and follow-up forms to PIAR editors", () => {
    assert.ok(app.includes('canEditPiarTrace(piar.id) ? `<button class="table-btn" type="button" data-onclick="openBarrierModal'));
    assert.ok(app.includes('canEditPiarTrace(piar.id) ? `<button class="table-btn" type="button" data-onclick="openAdjustmentModal'));
    assert.match(app, /data-onclick="openEvidenceModal/);
    assert.match(app, /data-onclick="openAdjustmentFollowUpModal/);
    for (const field of ["contexto", "descripcion", "actividad", "condicion_entorno", "fecha_identificacion", "resultado_esperado", "indicador_logro", "fecha_revision_prevista", "referencia", "evolucion", "acuerdos"]) {
        assert.match(app, new RegExp(`name="${field}"`), field);
    }
});

test("pedagogical UI writes through the PIAR-scoped API endpoints and renders user text escaped", () => {
    assert.match(app, /apiCreate\(`piar\/\$\{Number\(piarId\)\}\/barreras`/);
    assert.match(app, /apiCreate\(`piar\/\$\{Number\(piarId\)\}\/ajustes`/);
    assert.match(app, /apiCreate\(`piar\/\$\{Number\(piarId\)\}\/ajustes\/\$\{Number\(adjustmentId\)\}\/evidencias`/);
    assert.match(app, /apiCreate\("followUps", \{ \.\.\.data, id_piar: Number\(piarId\), id_ajuste: Number\(adjustmentId\)/);
    assert.match(app, /escapeHTML\(barrier\.descripcion\)/);
    assert.match(app, /escapeHTML\(evidence\.descripcion\)/);
});

test("every visible traceability control has a programmatic label and required controls are marked", () => {
    const traceForms = app.slice(app.indexOf("function openBarrierModal"), app.indexOf("function diagnosticCards"));
    const controls = [...traceForms.matchAll(/<(input|textarea|select)\b([^>]*)>/g)];
    const visibleControls = controls.filter(([, tag, attributes]) => !(tag === "input" && /type="hidden"/.test(attributes)));
    assert.ok(visibleControls.length >= 20, "Expected the four traceability forms to remain present.");
    for (const [, , attributes] of visibleControls) {
        const id = attributes.match(/\bid="([^"]+)"/)?.[1];
        assert.ok(id, `Visible form control has no id: ${attributes}`);
        assert.match(traceForms, new RegExp(`<label\\s+for="${id}"`), `Control ${id} must have an associated label.`);
    }
    for (const name of ["contexto", "descripcion", "fecha_identificacion", "area", "tipo", "estrategia", "resultado_esperado", "fecha_revision_prevista", "fecha"]) {
        assert.match(traceForms, new RegExp(`name="${name}"[^>]*\\brequired`), `${name} must be required.`);
    }
    assert.match(traceForms, /id="adjustmentResponsibleName"[^>]*readonly/);
    assert.match(traceForms, /id="adjustmentResponsibleHelp"/);
});

test("traceability modals expose dialog semantics, keyboard focus handling and return focus", () => {
    assert.match(app, /role="dialog" aria-modal="true" aria-labelledby="appModalTitle"/);
    assert.match(app, /aria-label="Cerrar ventana"/);
    assert.match(app, /function handleAppModalKeydown\(event\)/);
    assert.match(app, /event\.key === "Escape"/);
    assert.match(app, /event\.shiftKey[\s\S]*last\.focus\(\)/);
    assert.match(app, /modalReturnFocus\.focus\(\)/);
    assert.match(dashboardCss, /#appModal :focus-visible/);
});

test("traceability submission reports errors accessibly and blocks duplicate submits while pending", () => {
    assert.match(app, /function beginTraceFormSubmission\(event\)/);
    assert.match(app, /form\.dataset\.tracePending === "true"/);
    assert.match(app, /form\.setAttribute\("aria-busy", "true"\)/);
    assert.match(app, /button\.disabled = true/);
    assert.match(app, /function validateTraceForm\(form, requiredFields\)/);
    assert.match(app, /control\.setAttribute\("aria-invalid", "true"\)/);
    assert.match(app, /data-form-feedback[^>]*role="alert"/);
    assert.match(app, /toast\.setAttribute\("role", isError \? "alert" : "status"\)/);
    assert.match(app, /finally \{ endTraceFormSubmission\(form\); \}/);
});

test("traceability actions are hidden and blocked client-side for unassigned PIARs", () => {
    assert.match(app, /function canEditPiarTrace\(piarId\)[\s\S]*state\.piars\.some\(item => Number\(item\.id\) === Number\(piarId\)\)/);
    for (const handler of ["openBarrierModal", "openAdjustmentModal", "openEvidenceModal", "openAdjustmentFollowUpModal", "savePiarBarrier", "savePiarAdjustment", "savePiarEvidence", "saveAdjustmentFollowUp"]) {
        const start = app.indexOf(`function ${handler}`);
        const asyncStart = app.indexOf(`async function ${handler}`);
        const actualStart = start === -1 ? asyncStart : asyncStart === -1 ? start : Math.min(start, asyncStart);
        assert.notEqual(actualStart, -1, `Missing ${handler}`);
        assert.ok(app.slice(actualStart, actualStart + 700).includes("canEditPiarTrace(piarId)"), `${handler} must check current PIAR scope.`);
    }
});
