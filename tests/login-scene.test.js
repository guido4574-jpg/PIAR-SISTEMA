"use strict";

// Pruebas de la fase 3: escena animada del acceso, textos del inicio de sesión,
// accesibilidad de los formularios y corrección del registro (selector registerRole).
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const sceneSource = fs.readFileSync(path.join(ROOT, "public/js/login-scene.js"), "utf8");
const appSource = fs.readFileSync(path.join(ROOT, "public/js/app.js"), "utf8");
const authCss = fs.readFileSync(path.join(ROOT, "public/css/auth.css"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");

// Carga login-scene.js en un contexto nuevo (su estado interno empieza limpio).
function loadScene() {
    const context = { globalThis: null, setTimeout, clearTimeout };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(sceneSource, context);
    return context.PiarLoginScene;
}

// DOM mínimo: registra los elementos con id que aparecen en cada innerHTML.
function createAuthDom() {
    const elements = new Map();
    const feedback = { textContent: "" };
    const app = {
        html: "",
        set innerHTML(value) {
            this.html = value;
            elements.clear();
            for (const [, id] of value.matchAll(/\bid="([^"]+)"/g)) {
                const attributes = {};
                elements.set(id, {
                    id, value: id === "registerRole" ? "Docente" : "", attributes,
                    setAttribute(name, val) { attributes[name] = String(val); },
                    removeAttribute(name) { delete attributes[name]; },
                    getAttribute(name) { return attributes[name] ?? null; },
                    remove() { elements.delete(id); }
                });
            }
            feedback.textContent = (value.match(/class="auth-link auth-feedback"[^>]*>([^<]*)</) || [])[1] || "";
        },
        get innerHTML() { return this.html; }
    };
    const document = {
        addEventListener() {},
        getElementById: id => id === "app" ? app : elements.get(id) || null,
        querySelector: selector => selector === ".auth-feedback" ? feedback : null
    };
    return { app, elements, feedback, document };
}

function createAppSandbox({ scene = null, api = {} } = {}) {
    const dom = createAuthDom();
    const calls = { register: [], toasts: [] };
    const sandbox = {
        window: { APP_DATA: {}, location: { hash: "", search: "", pathname: "/" }, PiarLoginScene: scene },
        URLSearchParams, structuredClone, document: dom.document,
        escapeHTML: value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]),
        fetch: async () => ({ ok: false, json: async () => ({}) }),
        apiRegister: api.apiRegister || (async payload => { calls.register.push(payload); return { message: "Solicitud recibida (sintética)." }; }),
        showToastMessage: (message, type) => calls.toasts.push({ message, type })
    };
    vm.createContext(sandbox);
    vm.runInContext(appSource, sandbox);
    // Las funciones de la API se declaran en api.js; aquí se sustituyen por dobles.
    sandbox.apiRegister = api.apiRegister || sandbox.apiRegister;
    sandbox.showToastMessage = (message, type) => calls.toasts.push({ message, type });
    return { sandbox, dom, calls };
}

const fakeForm = () => {
    const button = { textContent: "Solicitar cuenta", innerHTML: "Solicitar cuenta", disabled: false, dataset: {}, setAttribute() {}, removeAttribute() {} };
    return { button, form: { querySelector: () => button, setAttribute() {}, removeAttribute() {} } };
};

// ---------- Escena ----------

test("la escena es decorativa: arte oculto a lectores de pantalla y un único control, el cordón", () => {
    const scene = loadScene();
    const html = scene.markup("login");
    assert.match(html, /class="auth-scene-room" aria-hidden="true"/);
    assert.match(html, /class="auth-scene-art" aria-hidden="true"/);
    assert.match(html, /class="auth-scene-badge" aria-hidden="true"/);
    const focusables = html.match(/<(a|button|input|select|textarea)\b|tabindex=/g) || [];
    assert.deepEqual(focusables, ["<button"], "Solo el cordón puede recibir el foco");
    assert.match(html, /<button class="auth-lamp-cord" type="button" aria-label="Cambiar el tono de la luz de la lámpara"/);
    assert.doesNotMatch(html, /https?:\/\//, "Sin recursos externos (CSP)");
    assert.doesNotMatch(html, /\son[a-z]+=/i, "Sin manejadores en línea");
    assert.doesNotMatch(html, /\sstyle=/, "Sin estilos en línea");
    assert.doesNotMatch(html, /var\(--/, "Las variables CSS no funcionan en atributos SVG");
});

test("la escena contiene la lámpara, el libro que se abre y los elementos de las referencias", () => {
    const html = loadScene().markup("login");
    for (const part of ["auth-scene-lamp", "auth-lamp-beam", "auth-lamp-bulb", "auth-lamp-body", "auth-book-cover", "auth-book-page-left", "auth-book-page-right", "auth-scene-glow", "auth-scene-people", "auth-trail-line", "auth-scene-dust", "auth-room-desk"]) {
        assert.ok(html.includes(part), `Falta ${part}`);
    }
    assert.equal((html.match(/class="auth-book-leaf"/g) || []).length, 3, "Tres hojas que pasan");
    assert.equal((html.match(/class="auth-scene-tile"/g) || []).length, 4, "Cuatro tarjetas de cristal");
    assert.match(html, /Educación inclusiva para todos y todas/);
    assert.match(html, /Tira del cordón/);
});

test("el tono de la luz depende de la pestaña y el cordón lo alterna sin ocultar nada", () => {
    const scene = loadScene();
    assert.match(scene.markup("login"), /data-tono="lila"/);
    assert.match(scene.markup("register"), /data-tono="turquesa"/);
    const container = { dataset: {} };
    const root = { dataset: { tono: "lila" }, closest: () => container };
    assert.equal(scene.cycleTone(root), "turquesa");
    assert.equal(scene.cycleTone(root), "calida");
    assert.equal(scene.cycleTone(root), "lila");
    assert.equal(container.dataset.tono, "lila");
    // Tras elegir un tono con el cordón, se conserva al cambiar de pestaña.
    scene.cycleTone(root);
    assert.match(scene.markup("login"), /data-tono="turquesa"/);
    assert.deepEqual([...scene.TONES], ["lila", "turquesa", "calida"]);
});

test("la introducción se reproduce una sola vez y start() nunca falla sin escena", () => {
    const scene = loadScene();
    assert.doesNotMatch(scene.markup("login"), /auth-scene-played/);
    assert.match(scene.markup("register"), /class="auth-scene auth-scene-played"/);
    assert.doesNotThrow(() => scene.start(null));
    assert.doesNotThrow(() => scene.start({}));
    assert.equal(scene.REST_AFTER_MS, 25000);
});

// ---------- Inicio de sesión ----------

test("el acceso muestra los textos de las referencias en español y enlaces como botones", () => {
    const { sandbox, dom } = createAppSandbox();
    vm.runInContext("renderLogin('login')", sandbox);
    const html = dom.app.innerHTML;
    assert.match(html, /<h1 class="auth-title" id="authTitle">Bienvenido al Sistema PIAR<\/h1>/);
    assert.match(html, /Un espacio para construir una educación inclusiva\./);
    assert.match(html, /<small>SISTEMA<\/small><strong>PIAR<\/strong>/);
    assert.match(html, /Plan Individual de Ajustes Razonables/);
    for (const text of ["Crear una cuenta", "¿Olvidaste tu contraseña?", "Reenviar verificación de correo", "Iniciar sesión"]) {
        assert.ok(html.includes(text), `Falta «${text}»`);
    }
    // Entrega académica: sin acceso externo visible.
    assert.doesNotMatch(html, /O continúa con|auth-provider-button/);
    assert.match(html, /<h2 class="visually-hidden">Acceso con correo<\/h2>/);
    assert.doesNotMatch(html, /<a href="#"/, "Las acciones deben ser botones, no enlaces vacíos");
    assert.match(html, /class="bi bi-envelope" aria-hidden="true"/);
    assert.match(html, /class="bi bi-lock" aria-hidden="true"/);
    // El correo y la contraseña siguen teniendo etiqueta visible.
    assert.match(html, /<label for="loginEmail">Correo electrónico<\/label>/);
    assert.match(html, /<label for="loginPassword">Contraseña<\/label>/);
});

test("Google, Microsoft y Apple quedan ocultos por defecto y, si se reactivan, se dibujan deshabilitados", () => {
    const hidden = createAppSandbox();
    vm.runInContext("renderLogin('login')", hidden.sandbox);
    assert.doesNotMatch(hidden.dom.app.innerHTML, /auth-provider|bi-google|bi-microsoft|bi-apple|O continúa con/);

    const { sandbox, dom } = createAppSandbox();
    sandbox.window.PIAR_API_CONFIG = { features: { externalAuth: true } };
    vm.runInContext("renderLogin('login')", sandbox);
    const html = dom.app.innerHTML;
    for (const provider of ["Google", "Microsoft", "Apple"]) {
        assert.match(html, new RegExp(`Continuar con <span class="auth-provider-name">${provider}</span>`));
    }
    assert.equal((html.match(/disabled aria-disabled="true"/g) || []).length, 3);
    assert.doesNotMatch(html, /auth-provider-badge">Acceder/);
});

test("el formulario funciona sin la escena y aunque la escena falle", () => {
    const withoutScene = createAppSandbox({ scene: null });
    vm.runInContext("renderLogin('login')", withoutScene.sandbox);
    assert.match(withoutScene.dom.app.innerHTML, /id="loginEmail"/);
    assert.doesNotMatch(withoutScene.dom.app.innerHTML, /auth-scene/);

    const broken = createAppSandbox({ scene: { markup() { throw new Error("fallo sintético"); }, start() { throw new Error("fallo sintético"); } } });
    assert.doesNotThrow(() => vm.runInContext("renderLogin('login')", broken.sandbox));
    assert.match(broken.dom.app.innerHTML, /id="loginEmail"/);

    const withScene = createAppSandbox({ scene: loadScene() });
    vm.runInContext("renderLogin('login')", withScene.sandbox);
    const html = withScene.dom.app.innerHTML;
    assert.ok(html.indexOf('id="loginEmail"') < html.indexOf("auth-scene"), "La tarjeta va antes de la escena en el orden del documento");
});

test("recuperación y reenvío de verificación tienen etiquetas visibles", () => {
    const { sandbox } = createAppSandbox();
    const resend = vm.runInContext("resendVerificationForm()", sandbox);
    assert.match(resend, /<label for="verificationEmail">Correo electrónico<\/label>/);
    const reset = vm.runInContext("passwordResetForm()", sandbox);
    assert.match(reset, /<label for="resetEmail">Correo electrónico<\/label>/);
    sandbox.window.location.hash = "#reset=token-sintetico";
    const confirm = vm.runInContext("passwordResetForm()", sandbox);
    assert.match(confirm, /<label for="resetPassword">Nueva contraseña<\/label>/);
    assert.match(confirm, /<label for="resetConfirm">Confirmar contraseña<\/label>/);
    assert.match(confirm, /id="resetPassword"[^>]*minlength="14"[^>]*maxlength="72"/);
});

// ---------- Registro ----------

test("regresión: el registro conserva el selector registerRole al dibujarse", () => {
    const { sandbox, dom } = createAppSandbox();
    vm.runInContext("renderLogin('register')", sandbox);
    assert.ok(dom.elements.has("registerRole"), "renderLogin no debe eliminar registerRole");
    assert.match(dom.app.innerHTML, /<select id="registerRole" name="rol"[^>]*required><option value="Docente" selected>Docente<\/option><option value="Psicóloga" >Psicólogo\(a\)<\/option><option value="Coordinador" >Coordinador<\/option><option value="Rector" >Rector<\/option><\/select>/);
    assert.doesNotMatch(dom.app.innerHTML, /value="Administrador"|value="Estudiante"/);
    assert.doesNotMatch(appSource, /getElementById\("registerRole"\)\?\.remove\(\)/);
});

test("regresión: registerUser envía la solicitud completa al endpoint de registro", async () => {
    const { sandbox, dom, calls } = createAppSandbox();
    vm.runInContext("renderLogin('register')", sandbox);
    const values = { registerName: " Nombre ", registerLastName: "Apellido", registerDocument: "DEMO-1", registerEmail: "registro@example.invalid ", registerPassword: "  frase larga de prueba  ", registerConfirm: "  frase larga de prueba  " };
    for (const [id, value] of Object.entries(values)) dom.elements.get(id).value = value;
    const { form } = fakeForm();
    sandbox.form = form;
    await vm.runInContext("registerUser({ preventDefault() {}, currentTarget: form })", sandbox);
    // Copia normalizada: el objeto se creó en otro contexto vm (otro prototipo).
    assert.deepEqual(JSON.parse(JSON.stringify(calls.register)), [{ nombre: "Nombre", apellidos: "Apellido", documento: "DEMO-1", correo: "registro@example.invalid", password: "  frase larga de prueba  ", rol: "Docente" }]);
    assert.match(dom.app.innerHTML, /Solicitud recibida \(sintética\)\./);
});

test("regresión: aunque el selector registerRole falte, el registro no se rompe y usa Docente", async () => {
    const { sandbox, dom, calls } = createAppSandbox();
    vm.runInContext("renderLogin('register')", sandbox);
    for (const id of ["registerName", "registerLastName", "registerDocument", "registerEmail"]) dom.elements.get(id).value = "dato";
    dom.elements.get("registerPassword").value = "frase larga de prueba";
    dom.elements.get("registerConfirm").value = "frase larga de prueba";
    dom.elements.delete("registerRole"); // fallo original: el selector ya no estaba al enviar
    const { form } = fakeForm();
    sandbox.form = form;
    await vm.runInContext("registerUser({ preventDefault() {}, currentTarget: form })", sandbox);
    assert.equal(calls.register.length, 1);
    assert.equal(calls.register[0].rol, "Docente");
});

test("regresión: contraseñas distintas no envían nada y explican el error", async () => {
    const { sandbox, dom, calls } = createAppSandbox();
    vm.runInContext("renderLogin('register')", sandbox);
    for (const id of ["registerName", "registerLastName", "registerDocument", "registerEmail"]) dom.elements.get(id).value = "dato";
    dom.elements.get("registerPassword").value = "frase larga de prueba 1";
    dom.elements.get("registerConfirm").value = "frase larga de prueba 2";
    const { form } = fakeForm();
    sandbox.form = form;
    await vm.runInContext("registerUser({ preventDefault() {}, currentTarget: form })", sandbox);
    assert.equal(calls.register.length, 0);
    assert.equal(dom.feedback.textContent, "Las contraseñas no coinciden. Escríbelas de nuevo.");
    assert.equal(dom.elements.get("registerConfirm").getAttribute("aria-invalid"), "true");
    assert.deepEqual(calls.toasts.at(-1), { message: "Las contraseñas no coinciden.", type: "warning" });
});

test("regresión: un error del servidor se muestra y el formulario se puede reenviar", async () => {
    const { sandbox, dom } = createAppSandbox({ api: { apiRegister: async () => { throw Object.assign(new Error("El correo electrónico no es válido"), { status: 400 }); } } });
    vm.runInContext("renderLogin('register')", sandbox);
    for (const id of ["registerName", "registerLastName", "registerDocument", "registerEmail"]) dom.elements.get(id).value = "dato";
    dom.elements.get("registerPassword").value = "frase larga de prueba";
    dom.elements.get("registerConfirm").value = "frase larga de prueba";
    const { form, button } = fakeForm();
    sandbox.form = form;
    await vm.runInContext("registerUser({ preventDefault() {}, currentTarget: form })", sandbox);
    assert.equal(dom.feedback.textContent, "El correo electrónico no es válido");
    assert.equal(button.disabled, false, "El botón vuelve a habilitarse");
    assert.equal(button.innerHTML, "Solicitar cuenta");
});

// ---------- CSS de la escena ----------

test("sin animaciones se ve la escena final: estados finales como base y animaciones hacia atrás", () => {
    assert.match(authCss, /\.auth-book-cover \{[^}]*transform: rotateY\(-180deg\) translateZ\(7px\);[^}]*animation: abreTapa [^;]*backwards;/);
    assert.match(authCss, /\.auth-book-leaf \{[^}]*transform: rotateY\(-180deg\)[^}]*backwards;/);
    assert.match(authCss, /@keyframes abreTapa \{\s*from \{\s*transform: rotateY\(0deg\)/);
    assert.match(authCss, /@media \(prefers-reduced-motion: reduce\) \{\s*\.auth-container \*,\s*\.auth-card \{\s*animation: none !important;\s*transition: none !important;/);
    // La tarjeta nunca parte de opacidad 0: el formulario está disponible desde el inicio.
    const cardFrom = authCss.match(/@keyframes apareceTarjeta \{\s*from \{\s*opacity: ([\d.]+);/);
    assert.ok(cardFrom && Number(cardFrom[1]) >= 0.3, "La tarjeta debe ser visible desde el primer instante");
    assert.match(authCss, /\.auth-scene-rest [^{]*\{[^}]*animation-play-state: paused;/);
});

test("index.html carga la escena antes de app.js", () => {
    const scene = indexHtml.indexOf('src="js/login-scene.js"');
    const app = indexHtml.indexOf('src="js/app.js"');
    assert.ok(scene > 0 && app > scene);
});
