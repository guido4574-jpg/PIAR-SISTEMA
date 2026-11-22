"use strict";

// Pruebas de regresión de los cuatro hallazgos de la revisión visual y funcional
// de la fase 1: datos del formulario docente, dashboard (fechas, tildes y permiso
// de «Nueva observación»), etiquetas del formulario de estudiantes y pantalla de
// verificación de correo. Sin navegador ni base de datos: app.js corre en un
// contexto aislado con un DOM mínimo y datos sintéticos.

process.env.TZ = "America/Bogota";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "../public/js/app.js"), "utf8");
const { escapeHTML } = require("../public/js/security");

function createUi({ role = "Administrador", hash = "" } = {}) {
    const elements = { viewRoot: { innerHTML: "" }, app: { innerHTML: "" } };
    const modal = { title: "", body: "", opened: 0 };
    const toasts = [];
    const dialog = { addEventListener() {}, querySelector() { return { focus() {} }; } };
    const sandbox = {
        window: { APP_DATA: { students: [], teachers: [], piars: [], institution: {}, grados: ["Sexto"], discapacidades: ["Visual"] }, location: { hash, pathname: "/", search: "" } },
        history: { replaceState(_state, _title, url) { sandbox.window.location.hash = String(url).includes("#") ? String(url).slice(String(url).indexOf("#")) : ""; } },
        URLSearchParams,
        Intl,
        structuredClone,
        escapeHTML,
        setTimeout() {},
        setInterval() {},
        clearInterval() {},
        document: {
            addEventListener() {},
            getElementById(id) { return elements[id] || null; },
            querySelector(selector) { return selector === "#appModal [role=dialog]" ? dialog : null; },
            createElement() { return { setAttribute() {}, replaceChildren() {}, classList: { add() {} }, remove() {} }; },
            createTextNode(text) { return text; },
            activeElement: null,
            body: {
                insertAdjacentHTML(_position, html) { modal.body = html; modal.opened += 1; },
                appendChild(toast) { toasts.push(toast); }
            }
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(appSource, sandbox, { filename: "public/js/app.js" });
    vm.runInContext(`currentSessionUser = ${JSON.stringify({ rol: role, nombre: "Sintético" })};
        showToastMessage = (message, type) => { __toasts.push({ message, type }); };
        loadCharts = () => {};`, Object.assign(sandbox, { __toasts: toasts }));
    return { sandbox, elements, modal, toasts, run: code => vm.runInContext(code, sandbox) };
}

function seedDashboard(ui) {
    ui.run(`state.students = [{ id: 11, nombres: "Ana", apellidos: "Prueba", discapacidad: "Visual" }];
        state.teachers = [];
        state.piars = [mapPiarDetail({ id_piar: 101, id_estudiante: 11, periodo: "2026-1", estado: "revision",
            fecha_revision: "2026-12-01T05:00:00.000Z",
            observaciones: [{ id_observacion: 1, fecha: "2026-03-10T05:00:00.000Z", tipo: "Seguimiento", avance: 40, descripcion: "Nota sintética" }] })];`);
}

// ---------------------------------------------------------------------------
// 1. Docentes: el formulario muestra los datos guardados que entrega la API
// ---------------------------------------------------------------------------

test("formulario docente: muestra documento, teléfono, perfil, nombres y apellidos guardados", async () => {
    const ui = createUi({ role: "Administrador" });
    const teacherRow = { id_docente: 31, nombre: "Laura Docente Sintética", nombres: "Laura", apellidos: "Docente Sintética", documento: "DOC-31", area: "Lenguaje", correo: "laura@example.invalid", cargo: "Docente de aula", telefono: "3001112233", perfil: "Perfil sintético", estado: "activo" };
    Object.assign(ui.sandbox, {
        apiGetStudents: async () => ({ data: [] }),
        apiGetTeachers: async () => ({ data: [teacherRow] }),
        apiGetPiars: async () => ({ data: [] }),
        apiGetHistory: async () => ({ data: [] })
    });
    await ui.run("hydrateBusinessState()");
    ui.run("openTeacherModal(31)");
    const body = ui.modal.body;
    for (const [name, value] of [["nombres", "Laura"], ["apellidos", "Docente Sintética"], ["documento", "DOC-31"], ["telefono", "3001112233"], ["cargo", "Docente de aula"], ["area", "Lenguaje"], ["correo", "laura@example.invalid"]]) {
        assert.match(body, new RegExp(`name="${name}"[^>]*value="${value}"`), name);
    }
    assert.match(body, /<textarea name="perfil"[^>]*>Perfil sintético<\/textarea>/);
    assert.match(body, /<option value="activo" selected>/);
});

test("formulario docente: con un registro antiguo sin nombres/apellidos conserva la separación aproximada", async () => {
    const ui = createUi({ role: "Coordinador" });
    Object.assign(ui.sandbox, {
        apiGetStudents: async () => ({ data: [] }),
        apiGetTeachers: async () => ({ data: [{ id_docente: 5, nombre: "Pedro Pérez", nombres: null, apellidos: null, estado: "activo" }] }),
        apiGetPiars: async () => ({ data: [] }),
        apiGetHistory: async () => ({ data: [] })
    });
    await ui.run("hydrateBusinessState()");
    ui.run("openTeacherModal(5)");
    assert.match(ui.modal.body, /name="nombres"[^>]*value="Pedro"/);
    assert.match(ui.modal.body, /name="apellidos"[^>]*value="Pérez"/);
});

// ---------------------------------------------------------------------------
// 2. Dashboard: fechas legibles, tildes y permiso de «Nueva observación»
// ---------------------------------------------------------------------------

test("dashboard: formatea las fechas sin mostrar instantes ISO", () => {
    const ui = createUi({ role: "Coordinador" });
    seedDashboard(ui);
    ui.run("renderDashboard()");
    const html = ui.elements.viewRoot.innerHTML;
    assert.doesNotMatch(html, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    assert.match(html, /<td>10 de mar de 2026<\/td>/);
    assert.match(html, /<td>1 de dic de 2026<\/td>/);
    assert.equal(ui.run("formatDisplayDate('2026-05-03')"), "3 de may de 2026");
    assert.equal(ui.run("formatDisplayDate(null)"), "Sin fecha");
    assert.equal(ui.run("formatDisplayDate('no es fecha')"), "no es fecha");
});

test("dashboard: textos visibles con tildes", () => {
    const ui = createUi({ role: "Coordinador" });
    seedDashboard(ui);
    ui.run("renderDashboard()");
    const html = ui.elements.viewRoot.innerHTML;
    assert.match(html, /Nueva observación/);
    assert.match(html, /Distribución por necesidad/);
    assert.match(html, /Alertas de revisión/);
    assert.match(html, /Fecha de revisión/);
    assert.match(html, /En revisión/);
    assert.doesNotMatch(html, /observacion\b|Distribucion|revision\b(?!")|Configuracion/);
    const sidebar = ui.run("sidebar('dashboard')");
    assert.match(sidebar, /Configuración/);
    assert.match(sidebar, /Cerrar sesión/);
    const navbar = ui.run("navbar('dashboard')");
    assert.match(navbar, /Cerrar sesión<\/button>/);
    assert.match(navbar, /Institución<\/button>/);
    assert.doesNotMatch(navbar, /Cerrar sesion|Institucion</);
    ui.run("state.piars = []; renderDashboard()");
    assert.match(ui.elements.viewRoot.innerHTML, /Aún no hay observaciones registradas\./);
    assert.match(ui.elements.viewRoot.innerHTML, /No hay PIAR con revisión pendiente\./);
});

test("dashboard: «Nueva observación» solo para los roles que la API autoriza (OBSERVATION_CREATORS)", () => {
    const { canAccessRoleResource } = require("../backend/authorization");
    for (const role of ["Administrador", "Rector", "Coordinador", "Psicóloga", "Docente"]) {
        const ui = createUi({ role });
        seedDashboard(ui);
        ui.run("renderDashboard()");
        const html = ui.elements.viewRoot.innerHTML;
        const allowed = canAccessRoleResource(role, "POST", "/api/observaciones");
        assert.equal(ui.run("canCreateObservations()"), allowed, role);
        assert.equal(/>Nueva observación<\/button>/.test(html), allowed, `${role}: botón`);
        assert.equal(/data-onclick="openObservationModal\(\)"/.test(html), allowed, `${role}: tarjeta de observaciones`);
        ui.run("openObservationModal()");
        assert.equal(ui.modal.opened, allowed ? 1 : 0, `${role}: modal`);
        if (!allowed) assert.match(ui.toasts.at(-1).message, /No tiene permiso para registrar observaciones/);
        else assert.match(ui.modal.body, /Nueva observación de seguimiento/);
    }
});

// ---------------------------------------------------------------------------
// 3. Estudiantes: etiqueta visible y asociada para cada campo
// ---------------------------------------------------------------------------

test("formulario de estudiante: cada campo tiene una etiqueta visible asociada por id", () => {
    const ui = createUi({ role: "Rector" });
    ui.run(`state.students = [{ id: 11, nombres: "Ana", apellidos: "Prueba", documento: "EST-11", fechaNacimiento: "2014-05-03", grado: "Sexto", jornada: "Mañana", discapacidad: "Visual", estado: "activo", acudiente: "Acudiente", telefono: "300", condicion_especial: "Visual", contexto: "Contexto", valoracion: "Valoración", fortalezas: ["Lectura"], barreras: ["Ruido"], apoyosRequeridos: ["Apoyo"], actividadesCasa: "Lectura" }];`);
    ui.run("openStudentModal(11)");
    const body = ui.modal.body;
    const controls = [...body.matchAll(/<(input|select|textarea)\b([^>]*)>/g)];
    assert.equal(controls.length, 17, "17 campos del formulario");
    for (const [, tag, attributes] of controls) {
        const id = attributes.match(/\bid="([^"]+)"/)?.[1];
        const name = attributes.match(/\bname="([^"]+)"/)?.[1];
        assert.ok(id, `${tag} ${name} sin id`);
        const label = body.match(new RegExp(`<label for="${id}">([^<]+)</label>`));
        assert.ok(label && label[1].trim(), `${name} sin etiqueta visible`);
        assert.doesNotMatch(label[0], /visually-hidden/);
    }
    // Se conservan nombres de campo y valores actuales (la edición no cambia).
    assert.match(body, /id="studentFechaNacimiento" name="fechaNacimiento" type="date" class="input-modern" value="2014-05-03"/);
    assert.match(body, /<label for="studentTelefono">Teléfono<\/label>/);
    assert.match(body, /<label for="studentValoracion">Valoración pedagógica<\/label>/);
    assert.match(body, /<div class="form-field"><label for="studentFortalezas">Fortalezas<\/label><textarea id="studentFortalezas" name="fortalezas"[^>]*>Lectura<\/textarea><\/div>/);
});

test("estilos: las etiquetas de los campos agrupados usan el mismo estilo visible del modal", () => {
    const css = fs.readFileSync(path.join(__dirname, "../public/css/dashboard.css"), "utf8");
    assert.match(css, /#appModal \.modal-form > \.form-field > label,\s*#appModal \.form-grid label \{\s*display: block;/);
});

// ---------------------------------------------------------------------------
// 4. Verificación de correo: sin pestañas de ingreso/registro (flujo D1)
// ---------------------------------------------------------------------------

test("verificación de correo: no muestra las pestañas Ingresar/Registrarse", () => {
    for (const hash of ["#verify-email=token-sintetico", "#verify-email-change=token-sintetico"]) {
        const ui = createUi({ hash });
        ui.run("startLoginScene = () => {}; renderLogin('login')");
        const html = ui.elements.app.innerHTML;
        assert.match(html, /<h1 class="auth-title" id="authTitle">Verificar correo<\/h1>/, hash);
        assert.doesNotMatch(html, /auth-tabs|>Ingresar<|>Registrarse</, hash);
        assert.match(html, /confirmEmailVerification\(event\)/, hash);
        assert.match(html, /Volver al acceso/, hash);
    }
    const ui = createUi();
    ui.run("startLoginScene = () => {}; refreshExternalAuthAvailability = () => {}; renderLogin('login')");
    assert.match(ui.elements.app.innerHTML, /class="auth-tabs"/);
    ui.run("renderLogin('register')");
    assert.match(ui.elements.app.innerHTML, /class="auth-tabs"/);
});

test("verificación de cambio de correo: «Volver al acceso» retoma la sesión sin confirmar el cambio", () => {
    const ui = createUi({ hash: "#verify-email-change=token-sintetico" });
    ui.run("var __calls = []; initializeApp = () => __calls.push('initializeApp'); renderLogin = mode => __calls.push(`renderLogin:${mode}`); apiConfirmEmailChange = () => __calls.push('confirm');");
    ui.run("leaveEmailVerification()");
    assert.deepEqual([...ui.run("__calls")], ["initializeApp"]);
    assert.equal(ui.sandbox.window.location.hash, "", "el token sale de la dirección");

    const initial = createUi({ hash: "#verify-email=token-sintetico" });
    initial.run("var __calls = []; initializeApp = () => __calls.push('initializeApp'); renderLogin = mode => __calls.push(`renderLogin:${mode}`);");
    initial.run("leaveEmailVerification()");
    assert.deepEqual([...initial.run("__calls")], ["renderLogin:login"]);
});

// ---------------------------------------------------------------------------
// Accesos rápidos y formulario docente (cierre técnico)
// ---------------------------------------------------------------------------

test("PIAR / PR: el acceso rápido «Observación» solo aparece para quien puede registrarla y en PIAR abiertos", () => {
    const { canAccessRoleResource } = require("../backend/authorization");
    for (const role of ["Administrador", "Rector", "Coordinador", "Psicóloga", "Docente"]) {
        const ui = createUi({ role });
        ui.run(`state.students = [{ id: 11, nombres: "Ana", apellidos: "Prueba" }];
            state.piars = [mapPiarDetail({ id_piar: 101, id_estudiante: 11, periodo: "2026-1", estado: "activo" }), mapPiarDetail({ id_piar: 102, id_estudiante: 11, periodo: "2025-2", estado: "cerrado" })];
            renderPIAR();`);
        const html = ui.elements.viewRoot.innerHTML;
        const allowed = canAccessRoleResource(role, "POST", "/api/observaciones");
        assert.equal(/openObservationModal\(101\)/.test(html), allowed, role);
        assert.equal(/openObservationModal\(102\)/.test(html), false, `${role}: PIAR cerrado`);
    }
});

test("formulario docente: etiquetas visibles y el nombre completo se envía sincronizado", async () => {
    const ui = createUi({ role: "Coordinador" });
    ui.run(`state.teachers = [{ id: 31, id_docente: 31, nombres: "Laura", apellidos: "Docente", area: "Lenguaje", estado: "activo" }];`);
    ui.run("openTeacherModal(31)");
    const body = ui.modal.body;
    const controls = [...body.matchAll(/<(input|select|textarea)\b([^>]*)>/g)];
    assert.equal(controls.length, 9);
    for (const [, , attributes] of controls) {
        const id = attributes.match(/\bid="([^"]+)"/)?.[1];
        assert.ok(id && new RegExp(`<label for="${id}">[^<]+</label>`).test(body), attributes);
    }
    let sent = null;
    ui.sandbox.apiUpdate = async (_resource, _id, payload) => { sent = payload; return { data: {} }; };
    ui.sandbox.formData = () => ({ nombres: " Laura María ", apellidos: "Docente Ruiz", area: "Lenguaje", estado: "activo" });
    ui.sandbox.closeModal = () => {};
    ui.sandbox.renderApp = () => {};
    await ui.run("saveTeacher({ preventDefault() {}, target: {} }, 31)");
    assert.equal(sent.nombre, "Laura María Docente Ruiz");
});

// ---------------------------------------------------------------------------
// Revisión con la sesión del Administrador (presentación)
// ---------------------------------------------------------------------------

test("estado «draft» que asigna el backend se muestra como «Borrador»", () => {
    const ui = createUi();
    assert.equal(ui.run("labelStatus('draft')"), "Borrador");
    assert.equal(ui.run("labelStatus('activo')"), "Activo");
});

test("formulario «Nuevo PIAR / PR»: cada campo visible tiene etiqueta y se conservan los nombres", () => {
    const ui = createUi({ role: "Coordinador" });
    ui.run(`state.students = [{ id: 11, nombres: "Ana", apellidos: "Prueba" }]; state.teachers = [{ id: 7, nombres: "Laura", apellidos: "Docente" }]; openPIARModal();`);
    const body = ui.modal.body;
    const controls = [...body.matchAll(/<(input|select|textarea)\b([^>]*)>/g)].filter(([, , attributes]) => !/type="hidden"/.test(attributes));
    assert.equal(controls.length, 26);
    for (const [, , attributes] of controls) {
        const id = attributes.match(/\bid="([^"]+)"/)?.[1];
        assert.ok(id && new RegExp(`<label for="${id}">[^<]+</label>`).test(body), attributes);
    }
    for (const name of ["studentId", "teacherId", "fechaCreacion", "fechaRevision", "estado", "periodo", "objetivoGeneral", "area", "tipo", "estrategia", "resultadoEsperado", "fechaRevisionAjuste"]) {
        assert.match(body, new RegExp(`name="${name}"`), name);
    }
    assert.doesNotMatch(body, /participacion"|placeholder="Area"|Estrategia pedagogica"/);
});

test("detalle de PIAR: fechas legibles y textos con tilde", () => {
    const ui = createUi({ role: "Administrador" });
    ui.run(`state.students = [{ id: 11, nombres: "Ana", apellidos: "Prueba", fortalezas: [], barreras: [], apoyosRequeridos: [] }];
        state.piars = [mapPiarDetail({ id_piar: 101, id_estudiante: 11, periodo: "2026-1", estado: "draft", fecha_revision: "2026-12-01T05:00:00.000Z",
            observaciones: [{ id_observacion: 1, fecha: "2026-03-10T05:00:00.000Z", tipo: "Seguimiento", avance: 10, descripcion: "Nota" }],
            seguimientos: [{ id_seguimiento: 1, fecha: "2026-03-11T05:00:00.000Z", descripcion: "Seguimiento" }] })];
        renderPIAR();`);
    const list = ui.elements.viewRoot.innerHTML;
    assert.match(list, /Revisión:<\/strong> 1 de dic de 2026/);
    assert.match(list, /Implementación/);
    assert.doesNotMatch(list, /\d{4}-\d{2}-\d{2}T\d{2}:/);
});

test("entrega académica: el menú de cuenta no ofrece identidades externas mientras el acceso externo esté oculto", () => {
    const ui = createUi({ role: "Administrador" });
    const hidden = ui.run("navbar('dashboard')");
    assert.doesNotMatch(hidden, /openExternalIdentities|Identidades externas/);
    assert.match(hidden, /Cerrar sesión/);
    ui.sandbox.window.PIAR_API_CONFIG = { features: { externalAuth: true } };
    assert.match(ui.run("navbar('dashboard')"), /openExternalIdentities\(\)/);
    // El código de vinculación se conserva para una fase futura.
    assert.equal(ui.run("typeof openExternalIdentities"), "function");
    assert.equal(ui.run("typeof startExternalAuth"), "function");
    const config = fs.readFileSync(path.join(__dirname, "../public/js/config.js"), "utf8");
    assert.match(config, /externalAuth: false/);
});
