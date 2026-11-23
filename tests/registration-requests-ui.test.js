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
    const listed = [];
    const sandbox = {
        window: { APP_DATA: {}, confirm: () => true, prompt: () => "Motivo de prueba" },
        structuredClone,
        document: { addEventListener() {}, getElementById: id => id === "viewRoot" ? root : null },
        escapeHTML: value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]),
        apiGetUsers: async () => { throw new Error("la vista de solicitudes no debe usar el listado completo de usuarios"); },
        apiGetRegistrationRequests: async () => { listed.push(true); return { data: users }; },
        apiDecideUserApproval: async (id, decision, reason) => calls.push([id, decision, reason]),
        showToastMessage() {}
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    sandbox.showToastMessage = () => {};
    vm.runInContext(`currentSessionUser = { rol: ${JSON.stringify(role)} }`, sandbox);
    return { sandbox, root, calls, listed };
}

test("Administrador and Rector see the registration-request entry; only Administrador sees account administration", () => {
    const { sandbox: admin } = createContext({ role: "Administrador" });
    const adminHtml = vm.runInContext("sidebar('dashboard')", admin);
    assert.match(adminHtml, /renderApp\('registration-requests'\)/);
    assert.match(adminHtml, /renderApp\('users'\)/);
    const { sandbox: rector } = createContext({ role: "Rector" });
    const rectorHtml = vm.runInContext("sidebar('dashboard')", rector);
    assert.match(rectorHtml, /renderApp\('registration-requests'\)/);
    assert.doesNotMatch(rectorHtml, /renderApp\('users'\)/);
    for (const role of ["Coordinador", "Psicóloga", "Docente"]) {
        const { sandbox } = createContext({ role });
        assert.doesNotMatch(vm.runInContext("sidebar('dashboard')", sandbox), /registration-requests/, role);
    }
});

test("approval UI lets the reviewer decide every pending request and shows email verification only as information", async () => {
    const { sandbox, root, listed } = createContext({ role: "Administrador", users: [
        { id_usuario: 10, nombre: "Ana Docente", correo: "ana@example.invalid", documento: "D-10", rol: "Docente", estado: "pendiente", correo_verificado_at: "2026-10-11T18:00:00.000Z" },
        { id_usuario: 11, nombre: "Luis Docente", correo: "luis@example.invalid", documento: "D-11", rol: "Docente", estado: "pendiente_verificacion", correo_verificado_at: null },
        { id_usuario: 12, nombre: "Registro sin verificación", correo: "nuevo@example.invalid", documento: "D-13", rol: "Coordinador", estado: "pendiente", correo_verificado_at: null },
        { id_usuario: 14, nombre: "Otra persona", correo: "other@example.invalid", documento: "D-14", rol: "Rector", estado: "pendiente", correo_verificado_at: null }
    ] });
    await vm.runInContext("renderRegistrationRequests()", sandbox);
    assert.equal(listed.length, 1, "usa el endpoint de solicitudes");
    for (const id of [10, 11, 12, 14]) assert.match(root.innerHTML, new RegExp(`decideRegistrationRequest\\(${id}, 'aprobar'\\)`), String(id));
    assert.match(root.innerHTML, />Verificado</);
    assert.match(root.innerHTML, />Sin verificar</);
    assert.match(root.innerHTML, /el sistema no verifica el correo/);
    assert.match(root.innerHTML, /<td>Rector<\/td>/);
    assert.match(root.innerHTML, /4 pendientes/);
    assert.doesNotMatch(root.innerHTML, /Rector las decide el Administrador/);
});

test("Rector review screen explains that Rector-profile requests belong to the Administrador", async () => {
    const { sandbox, root } = createContext({ role: "Rector", users: [
        { id_usuario: 30, nombre: "Solicitud docente", correo: "d@example.invalid", documento: "D-30", rol: "Docente", estado: "pendiente", correo_verificado_at: null }
    ] });
    await vm.runInContext("renderRegistrationRequests()", sandbox);
    assert.match(root.innerHTML, /decideRegistrationRequest\(30, 'aprobar'\)/);
    assert.match(root.innerHTML, /Las solicitudes de perfil Rector las decide el Administrador/);
});

test("approval UI never lists Administrador, Estudiante or already decided accounts as requests", async () => {
    const { sandbox, root } = createContext({ role: "Administrador", users: [
        { id_usuario: 20, nombre: "Cuenta administradora", correo: "a@example.invalid", documento: "A-20", rol: "Administrador", estado: "pendiente", correo_verificado_at: null },
        { id_usuario: 21, nombre: "Cuenta estudiante", correo: "e@example.invalid", documento: "E-21", rol: "Estudiante", estado: "pendiente", correo_verificado_at: null },
        { id_usuario: 23, nombre: "Ya activa", correo: "x@example.invalid", documento: "X-23", rol: "Docente", estado: "activo", correo_verificado_at: null },
        { id_usuario: 22, nombre: "Solicitud psicología", correo: "p@example.invalid", documento: "P-22", rol: "Psicóloga", estado: "pendiente", correo_verificado_at: null }
    ] });
    await vm.runInContext("renderRegistrationRequests()", sandbox);
    assert.doesNotMatch(root.innerHTML, /decideRegistrationRequest\((20|21|23),/);
    assert.match(root.innerHTML, /decideRegistrationRequest\(22, 'aprobar'\)/);
    assert.match(root.innerHTML, /Psicólogo\(a\)/);
});

test("a non-approver cannot load or decide account requests from the frontend action", async () => {
    for (const role of ["Docente", "Coordinador", "Psicóloga"]) {
        const { sandbox, root, calls, listed } = createContext({ role });
        await vm.runInContext("renderRegistrationRequests()", sandbox);
        await vm.runInContext("decideRegistrationRequest(10, 'aprobar')", sandbox);
        assert.match(root.innerHTML, /No tienes autorización/, role);
        assert.deepEqual(calls, [], role);
        assert.equal(listed.length, 0, role);
    }
});

test("rejection UI requires a reason and sends it to the protected approval endpoint", async () => {
    for (const role of ["Administrador", "Rector"]) {
        const { sandbox, calls } = createContext({ role });
        await vm.runInContext("decideRegistrationRequest(10, 'rechazar')", sandbox);
        assert.deepEqual(calls, [[10, "rechazar", "Motivo de prueba"]], role);
    }
});
