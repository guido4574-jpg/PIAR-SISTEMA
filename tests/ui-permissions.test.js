const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "../public/js/app.js"), "utf8");
const escapeHTML = require("../public/js/security").escapeHTML;

function renderPiarForRole(role) {
    const viewRoot = { innerHTML: "" };
    const sandbox = {
        window: { APP_DATA: { students: [], teachers: [], piars: [] } },
        document: {
            addEventListener() {},
            getElementById(id) {
                assert.equal(id, "viewRoot");
                return viewRoot;
            }
        },
        escapeHTML,
        structuredClone
    };

    vm.createContext(sandbox);
    vm.runInContext(appSource, sandbox, { filename: "public/js/app.js" });
    vm.runInContext(studentPortalSource, sandbox, { filename: "public/js/student-portal.js" });
    vm.runInContext(`currentSessionUser = ${JSON.stringify(role ? { rol: role } : null)}`, sandbox);
    vm.runInContext("renderPIAR()", sandbox);
    return viewRoot.innerHTML;
}

const studentPortalSource = fs.readFileSync(path.join(__dirname, "../public/js/student-portal.js"), "utf8");
const piarManagementSource = fs.readFileSync(path.join(__dirname, "../public/js/piar-management.js"), "utf8");

function studentPiarUi() {
    const viewRoot = { innerHTML: "" };
    const modal = { body: "" };
    const dialog = { addEventListener() {}, querySelector() { return { focus() {} }; } };
    const sandbox = {
        window: { APP_DATA: { students: [], teachers: [], piars: [], institution: {} } },
        document: {
            addEventListener() {},
            getElementById(id) { return id === "viewRoot" ? viewRoot : null; },
            querySelector(selector) { return selector === "#appModal [role=dialog]" ? dialog : null; },
            activeElement: null,
            body: { insertAdjacentHTML(_position, html) { modal.body = html; } }
        },
        escapeHTML,
        structuredClone
    };
    vm.createContext(sandbox);
    vm.runInContext(appSource, sandbox, { filename: "public/js/app.js" });
    vm.runInContext(piarManagementSource, sandbox, { filename: "public/js/piar-management.js" });
    vm.runInContext(studentPortalSource, sandbox, { filename: "public/js/student-portal.js" });
    vm.runInContext(`currentSessionUser = { rol: "Estudiante", nombre: "Ana" };
        state.piars = [mapPiarDetail({ id_piar: 101, id_estudiante: 11, titulo: "PIAR Ana", periodo: "2026-1", estado: "activo",
            objetivo_general: "Objetivo A", estudiante: { id_estudiante: 11, nombre: "Ana" },
            docentes: [{ id_docente: 7, nombre: "Docente Uno", es_responsable_principal: 1 }],
            ajustes: [{ id_ajuste: 1, area: "Matemáticas", tipo: "Metodológico", estrategia: "Material concreto", avance: 50, evidencias: [] }],
            barreras: [], dua: [{ id_dua: 1, principio: "representacion", area: "Matemáticas", estrategia: "Apoyo visual" }] })];`, sandbox);
    return {
        list() { vm.runInContext("renderPIAR()", sandbox); return viewRoot.innerHTML; },
        detail() { vm.runInContext("viewPIAR(101)", sandbox); return modal.body; },
        sidebar() { return vm.runInContext("sidebar('piar')", sandbox); },
        currentViewAfter(view) { vm.runInContext(`try { renderApp(${JSON.stringify(view)}); } catch {}`, sandbox); return vm.runInContext("currentView", sandbox); }
    };
}

test("Estudiante UI shows only its own PIAR, read-only, without professional sections", () => {
    const ui = studentPiarUi();
    const list = ui.list();
    assert.match(list, /PIAR Ana/);
    assert.match(list, /Ver mi PIAR/);
    assert.match(list, /solo lectura/);
    assert.doesNotMatch(list, /Nuevo PIAR|Observacion|Editar/);

    const detail = ui.detail();
    assert.match(detail, /Objetivo A/);
    assert.match(detail, /Material concreto/);
    assert.match(detail, /Apoyo visual/);
    assert.match(detail, /Docente Uno/);
    assert.doesNotMatch(detail, /Diagnóstico|Observaciones|Seguimientos|Versiones del PIAR|Informes aportados/);
    assert.doesNotMatch(detail, /Editar|Registrar|Cerrar PIAR|Reabrir|Docentes asignados|Eliminar/);

    const sidebar = ui.sidebar();
    assert.match(sidebar, /Mi PIAR/);
    assert.doesNotMatch(sidebar, /Estudiantes|Docentes|Reportes|Dashboard|Configuraci[oó]n|Usuarios|Solicitudes/);
    assert.equal(ui.currentViewAfter("dashboard"), "piar");
    assert.equal(ui.currentViewAfter("reports"), "piar");
});

test("PIAR creation action matches backend-authorized roles", () => {
    for (const role of ["Administrador", "Rector", "Coordinador", "Docente"]) {
        assert.match(renderPiarForRole(role), /Nuevo PIAR \/ PR/, role);
    }

    assert.match(renderPiarForRole("Docente"), /Nuevo PIAR \/ PR/, "Docente");

    // Psicóloga consults PIAR content but does not create or edit it.
    for (const role of ["Psicóloga", "Estudiante", null]) {
        assert.doesNotMatch(renderPiarForRole(role), /Nuevo PIAR \/ PR/, String(role));
    }
});

test("teacher PIAR form uses the assigned student list and linked teacher profile", () => {
    const modal = { title: "", body: "" };
    const closeButton = { focus() {} };
    const dialog = {
        addEventListener() {},
        querySelector(selector) { return selector === ".close-modal" ? closeButton : null; }
    };
    const sandbox = {
        window: { APP_DATA: {
            students: [{ id: 10, nombres: "Estudiante", apellidos: "asignado" }],
            teachers: [{ id: 7, nombres: "Docente", apellidos: "asignado" }],
            piars: [], institution: { year: 2026 }
        } },
        document: {
            addEventListener() {}, getElementById() { return null; },
            querySelector(selector) { return selector === "#appModal [role=dialog]" ? dialog : null; },
            activeElement: null,
            body: { insertAdjacentHTML(_position, html) { modal.body = html; } }
        },
        escapeHTML,
        structuredClone
    };
    vm.createContext(sandbox);
    vm.runInContext(appSource, sandbox, { filename: "public/js/app.js" });
    vm.runInContext("currentSessionUser = { rol: 'Docente' }; openPIARModal()", sandbox);
    assert.match(modal.body, /<option value="10">Estudiante asignado<\/option>/);
    assert.match(modal.body, /name="teacherId" value="7"/);
    assert.doesNotMatch(modal.body, /<select name="teacherId"/);
});

test("authentication UI keeps unverified external providers disabled and discloses registration states", () => {
    const app = { innerHTML: "" };
    const sandbox = {
        window: { APP_DATA: {}, location: { hash: "" } },
        URLSearchParams,
        document: {
            addEventListener() {},
            getElementById(id) { return id === "app" ? app : null; }
        },
        escapeHTML: value => String(value),
        structuredClone,
        passwordResetForm: () => "reset form",
        registerForm: () => "register form",
        loginForm: () => "login form"
    };
    vm.createContext(sandbox);
    vm.runInContext(appSource, sandbox);
    // Entrega académica: por defecto no se muestra ningún proveedor externo.
    vm.runInContext("renderLogin('login')", sandbox);
    assert.doesNotMatch(app.innerHTML, /auth-provider|startExternalAuth|O continúa con/);
    assert.match(app.innerHTML, /Acceso con correo/);
    // Con features.externalAuth = true, el código conservado vuelve a dibujarlos deshabilitados.
    sandbox.window.PIAR_API_CONFIG = { features: { externalAuth: true } };
    vm.runInContext("renderLogin('login')", sandbox);
    for (const provider of ["Google", "Microsoft", "Apple"]) {
        assert.match(app.innerHTML, new RegExp(`auth-provider-name">${provider}<`));
    }
    assert.doesNotMatch(app.innerHTML, /configuraci.n pendiente/);
    assert.equal((app.innerHTML.match(/class="auth-provider-button/g) || []).length, 3);
    assert.equal((app.innerHTML.match(/data-onclick="startExternalAuth\('/g) || []).length, 3);
    assert.equal((app.innerHTML.match(/auth-provider-badge">Comprobando/g) || []).length, 3);
    assert.equal((app.innerHTML.match(/disabled aria-disabled="true"/g) || []).length, 3);
    assert.doesNotMatch(app.innerHTML, /auth-provider-badge">Acceder/);
    assert.match(app.innerHTML, /bi-google/);
    assert.match(app.innerHTML, /bi-microsoft/);
    assert.match(app.innerHTML, /bi-apple/);
    assert.match(app.innerHTML, /Acceso con correo/);
    assert.match(app.innerHTML, /Comprobando disponibilidad de acceso externo/);
    assert.doesNotMatch(app.innerHTML, /auth-left|auth-highlights/);
    vm.runInContext("renderLogin('register')", sandbox);
    assert.match(app.innerHTML, /Verifica tu correo y luego espera la aprobación institucional/);
    assert.doesNotMatch(app.innerHTML, /auth-provider-button|auth-divider-email/);
});

test("external-provider controls reflect the live OIDC readiness response accessibly", async () => {
    const status = { textContent: "" };
    const buttons = Object.fromEntries(["google", "microsoft", "apple"].map(provider => [`provider-${provider}`, {
        disabled: true,
        attributes: {},
        badge: { textContent: "Comprobando" },
        setAttribute(name, value) { this.attributes[name] = value; },
        querySelector() { return this.badge; }
    }]));
    const sandbox = {
        window: { APP_DATA: {}, location: { hash: "" } },
        URLSearchParams,
        structuredClone,
        document: {
            addEventListener() {},
            getElementById(id) { return id === "external-auth-status" ? status : null; },
            querySelector(selector) { return buttons[selector.slice(1)]; }
        },
        fetch: async () => ({ ok: true, json: async () => ({ providers: { google: false, microsoft: true, apple: false } }) })
    };
    vm.createContext(sandbox);
    vm.runInContext(appSource, sandbox);
    await vm.runInContext("refreshExternalAuthAvailability()", sandbox);
    assert.equal(buttons["provider-google"].disabled, true);
    assert.equal(buttons["provider-google"].badge.textContent, "No disponible");
    assert.equal(buttons["provider-google"].attributes["aria-label"], "Google: no disponible");
    assert.equal(buttons["provider-microsoft"].disabled, false);
    assert.equal(buttons["provider-microsoft"].badge.textContent, "Acceder");
    assert.equal(buttons["provider-microsoft"].attributes["aria-disabled"], "false");
    assert.equal(buttons["provider-apple"].disabled, true);
    assert.match(status.textContent, /cuenta institucional aprobada y vinculada/);
});

test("initial temporary-password change is mandatory before dashboard access", () => {
    const app = { innerHTML: "" };
    const sandbox = {
        window: { APP_DATA: {}, location: { hash: "" } },
        URLSearchParams,
        structuredClone,
        document: { addEventListener() {}, getElementById(id) { return id === "app" ? app : null; } },
        escapeHTML: value => String(value)
    };
    vm.createContext(sandbox);
    vm.runInContext(appSource, sandbox);
    vm.runInContext("renderInitialPasswordChange()", sandbox);
    assert.match(app.innerHTML, /Crea tu contraseña personal/);
    assert.match(app.innerHTML, /initialNewPassword/);
    assert.match(app.innerHTML, /completeInitialPasswordChange/);
    const serverSource = require("node:fs").readFileSync(require("node:path").join(__dirname, "../backend/server.js"), "utf8");
    assert.match(serverSource, /if \(sessionUser\.mustChangePassword\)/);
    assert.match(serverSource, /\/api\/auth\/initial-password-change/);
});

test("login and registration preserve password whitespace", () => {
    assert.doesNotMatch(appSource, /getElementById\("loginPassword"\)\.value\.trim\(\)/);
    assert.doesNotMatch(appSource, /getElementById\("registerPassword"\)\.value\.trim\(\)/);
    assert.doesNotMatch(appSource, /getElementById\("registerConfirm"\)\.value\.trim\(\)/);
});

test("auth forms retain required fields, accessible labels, password toggles and loading states", () => {
    const values = {
        loginEmail: { type: "email", value: "teacher@example.invalid" },
        loginPassword: { type: "password", value: "  secure pass  " },
        registerPassword: { type: "password", value: "  secure pass  " },
        registerConfirm: { type: "password", value: "  secure pass  " }
    };
    const sandbox = {
        window: { APP_DATA: {} },
        document: { addEventListener() {}, getElementById(id) { return values[id] || null; } },
        structuredClone
    };
    vm.createContext(sandbox);
    vm.runInContext(appSource, sandbox);
    const registration = vm.runInContext("registerForm()", sandbox);
    const login = vm.runInContext("loginForm()", sandbox);
    for (const id of ["registerName", "registerLastName", "registerDocument", "registerEmail", "registerPassword", "registerConfirm"]) {
        assert.match(registration, new RegExp(`id="${id}"`));
        assert.match(registration, new RegExp(`for="${id}"`));
    }
    assert.match(registration, /label for="registerRole">Perfil institucional solicitado/);
    assert.match(registration, /select id="registerRole" name="rol"[^>]*required/);
    assert.match(registration, /value="Docente" selected>Docente<\/option><option value="Psicóloga" >Psicólogo\(a\)/);
    assert.doesNotMatch(registration, /value="Administrador"|value="Estudiante"/);
    assert.match(registration, /Elegir un perfil no concede acceso ni permisos/);
    assert.match(appSource, /apiRegister\(\{[^}]*rol: role\s*\}\)/);
    assert.match(login, /autocomplete="username"/);
    assert.match(login, /autocomplete="current-password"/);
    assert.equal((registration.match(/class="auth-password-toggle"/g) || []).length, 2);

    const toggle = { textContent: "Mostrar", attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
    sandbox.toggle = toggle;
    vm.runInContext("togglePasswordVisibility('registerPassword', toggle)", sandbox);
    assert.equal(values.registerPassword.type, "text");
    assert.equal(values.registerPassword.value, "  secure pass  ");
    assert.equal(toggle.textContent, "Ocultar");

    const button = { textContent: "Solicitar cuenta", disabled: false, dataset: {}, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; } };
    const form = { attributes: {}, querySelector() { return button; }, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; } };
    sandbox.form = form;
    vm.runInContext("setAuthSubmitting(form, true, 'Enviando…')", sandbox);
    assert.equal(button.disabled, true);
    assert.equal(button.textContent, "Enviando…");
    vm.runInContext("setAuthSubmitting(form, false)", sandbox);
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, "Solicitar cuenta");
});
