"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/js/app.js"), "utf8");

function createContext({ role, users = [] }) {
    const root = { innerHTML: "" };
    const calls = [];
    const sandbox = {
        window: { APP_DATA: {}, confirm: () => true, prompt: () => "Motivo de prueba" },
        structuredClone,
        document: { addEventListener() {}, getElementById: id => id === "viewRoot" ? root : null },
        escapeHTML: value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]),
        apiGetUsers: async () => ({ data: users }),
        apiDecideUserApproval: async (id, decision, reason) => calls.push([id, decision, reason]),
        showToastMessage() {}
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    sandbox.showToastMessage = () => {};
    vm.runInContext(`currentSessionUser = { rol: ${JSON.stringify(role)} }`, sandbox);
    return { sandbox, root, calls };
}

test("only Administrator sees the registration-request navigation entry before Rector validation exists", () => {
    for (const role of ["Administrador"]) {
        const { sandbox } = createContext({ role });
        const html = vm.runInContext("sidebar('dashboard')", sandbox);
        assert.match(html, /renderApp\('registration-requests'\)/);
    }
    const { sandbox: rectorSandbox } = createContext({ role: "Rector" });
    assert.doesNotMatch(vm.runInContext("sidebar('dashboard')", rectorSandbox), /registration-requests/);
    const { sandbox } = createContext({ role: "Docente" });
    assert.doesNotMatch(vm.runInContext("sidebar('dashboard')", sandbox), /registration-requests/);
});

test("approval UI lists pending requests of the four D2 profiles and enables decisions only after email verification", async () => {
    const { sandbox, root } = createContext({ role: "Administrador", users: [
        { id_usuario: 10, nombre: "Ana Docente", correo: "ana@example.invalid", documento: "D-10", rol: "Docente", estado: "pendiente", correo_verificado_at: "2026-10-11T18:00:00.000Z" },
        { id_usuario: 11, nombre: "Luis Docente", correo: "luis@example.invalid", documento: "D-11", rol: "Docente", estado: "pendiente_verificacion" },
        { id_usuario: 12, nombre: "Docente sin marca de verificación", correo: "legacy@example.invalid", documento: "D-13", rol: "Docente", estado: "pendiente", correo_verificado_at: null },
        { id_usuario: 14, nombre: "Otra persona", correo: "other@example.invalid", documento: "D-14", rol: "Rector", estado: "pendiente", correo_verificado_at: "2026-10-11T18:00:00.000Z" }
    ] });
    await vm.runInContext("renderRegistrationRequests()", sandbox);
    assert.match(root.innerHTML, /Ana Docente/);
    assert.match(root.innerHTML, /Correo por verificar/);
    assert.match(root.innerHTML, /Pendiente de verificaci.n/);
    assert.match(root.innerHTML, /decideRegistrationRequest\(10, 'aprobar'\)/);
    assert.doesNotMatch(root.innerHTML, /decideRegistrationRequest\(11,/);
    assert.doesNotMatch(root.innerHTML, /decideRegistrationRequest\(12,/);
    // Decisión D2: una solicitud verificada de Rector también se puede decidir.
    assert.match(root.innerHTML, /decideRegistrationRequest\(14, 'aprobar'\)/);
    assert.match(root.innerHTML, /<td>Rector<\/td>/);
    assert.match(root.innerHTML, /Solicitudes de registro/);
});

test("approval UI never lists Administrador or Estudiante accounts as requests", async () => {
    const { sandbox, root } = createContext({ role: "Administrador", users: [
        { id_usuario: 20, nombre: "Cuenta administradora", correo: "a@example.invalid", documento: "A-20", rol: "Administrador", estado: "pendiente", correo_verificado_at: "2026-10-11T18:00:00.000Z" },
        { id_usuario: 21, nombre: "Cuenta estudiante", correo: "e@example.invalid", documento: "E-21", rol: "Estudiante", estado: "pendiente", correo_verificado_at: "2026-10-11T18:00:00.000Z" },
        { id_usuario: 22, nombre: "Solicitud psicología", correo: "p@example.invalid", documento: "P-22", rol: "Psicóloga", estado: "pendiente", correo_verificado_at: "2026-10-11T18:00:00.000Z" }
    ] });
    await vm.runInContext("renderRegistrationRequests()", sandbox);
    assert.doesNotMatch(root.innerHTML, /decideRegistrationRequest\((20|21),/);
    assert.match(root.innerHTML, /decideRegistrationRequest\(22, 'aprobar'\)/);
    assert.match(root.innerHTML, /Psicólogo\(a\)/);
});

test("a non-approver cannot load or decide account requests from the frontend action", async () => {
    const { sandbox, root, calls } = createContext({ role: "Docente" });
    await vm.runInContext("renderRegistrationRequests()", sandbox);
    await vm.runInContext("decideRegistrationRequest(10, 'aprobar')", sandbox);
    assert.match(root.innerHTML, /No tienes autorización/);
    assert.deepEqual(calls, []);
});

test("rejection UI requires a reason and sends it to the protected approval endpoint", async () => {
    const { sandbox, calls } = createContext({ role: "Administrador" });
    await vm.runInContext("decideRegistrationRequest(10, 'rechazar')", sandbox);
    assert.deepEqual(calls, [[10, "rechazar", "Motivo de prueba"]]);
});
