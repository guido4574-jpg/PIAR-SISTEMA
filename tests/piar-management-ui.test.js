"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadModules(role, userId = 1) {
    const context = vm.createContext({
        currentSessionUser: { id: userId, rol: role },
        state: { piars: [], teachers: [], areas: [] },
        emptyState: message => `<div class="empty-state">${message}</div>`,
        formatVersionDate: value => String(value)
    });
    for (const file of ["security.js", "piar-management.js", "user-admin.js"]) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/js", file), "utf8"), context, { filename: file });
    }
    return context;
}

const openPiar = { id: 7, estado: "activo", dua: [] };
const closedPiar = { id: 7, estado: "cerrado", dua: [] };

test("PIAR actions follow the backend permissions for every role", () => {
    const expectations = {
        Administrador: { edit: true, teachers: true, close: true, reopen: false },
        Rector: { edit: true, teachers: true, close: true, reopen: false },
        Coordinador: { edit: true, teachers: true, close: true, reopen: true },
        "Psicóloga": { edit: false, teachers: false, close: false, reopen: false },
        Docente: { edit: true, teachers: false, close: false, reopen: false },
        Estudiante: { edit: false, teachers: false, close: false, reopen: false }
    };
    for (const [role, expected] of Object.entries(expectations)) {
        const ui = loadModules(role);
        const open = ui.piarActionBar(openPiar);
        const closed = ui.piarActionBar(closedPiar);
        assert.equal(open.includes("openPiarEditModal"), expected.edit, `${role} edit`);
        assert.equal(open.includes("openPiarTeachersModal"), expected.teachers, `${role} teachers`);
        assert.equal(open.includes("'cerrar'"), expected.close, `${role} close`);
        assert.equal(closed.includes("'reabrir'"), expected.reopen, `${role} reopen`);
        assert.equal(closed.includes("openPiarEditModal"), false, `${role} cannot edit a closed PIAR`);
        assert.match(open, /printPiarDetail\(\)/);
    }
});

test("DUA section groups the three principles and escapes user text", () => {
    const ui = loadModules("Docente");
    const html = ui.duaSection({ id: 3, estado: "activo", dua: [
        { id_dua: 1, principio: "representacion", area: "<b>Matemáticas</b>", estrategia: "<img src=x onerror=alert(1)>", autor_nombre: "Ana" }
    ] });
    for (const label of Object.values(vm.runInContext("DUA_PRINCIPLE_LABELS", ui))) assert.ok(html.includes(label), label);
    assert.ok(!html.includes("<img src=x"));
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
    assert.match(html, /openDuaModal\(3, 1\)/);
    assert.doesNotMatch(loadModules("Docente").duaSection({ id: 3, estado: "cerrado", dua: [] }), /openDuaModal/);
});

test("user administration hides self-deactivation and escapes account data", () => {
    const ui = loadModules("Administrador", 5);
    const html = ui.userAdminTable([
        { id_usuario: 5, nombre: "Yo", correo: "yo@example.invalid", documento: "1", rol: "Administrador", estado: "activo" },
        { id_usuario: 6, nombre: "<script>x</script>", correo: "d@example.invalid", documento: "2", rol: "Docente", estado: "activo" },
        { id_usuario: 7, nombre: "Inactivo", correo: "i@example.invalid", documento: "3", rol: "Docente", estado: "inactivo" }
    ]);
    assert.doesNotMatch(html, /changeUserState\(5, 'desactivar'\)/);
    assert.match(html, /changeUserState\(6, 'desactivar'\)/);
    assert.match(html, /changeUserState\(7, 'reactivar'\)/);
    assert.ok(!html.includes("<script>x</script>"));
});

test("index loads the new modules before app.js uses them", () => {
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    const order = ["js/security.js", "js/piar-management.js", "js/user-admin.js", "js/app.js"].map(src => html.indexOf(`src="${src}"`));
    assert.ok(order.every(index => index > 0));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
});
