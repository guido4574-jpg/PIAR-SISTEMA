const INSTITUTION_SETTINGS_KEY = "piar-institution-settings-v1";
const LEGACY_STORAGE_KEYS = ["piar-control-data-v2", "piar-auth-users-v1"];

let state = structuredClone(window.APP_DATA);
let currentView = "dashboard";
let charts = {};
let apiConnected = false;
let currentSessionUser = null;
let sessionCheckTimer = null;
let modalReturnFocus = null;

// Estudiante only reads its own PIAR (see student-portal.js); the API enforces
// the same scope and projection.
function isStudentSession() {
    return currentSessionUser?.rol === "Estudiante";
}

function canManageStudentTeacherProfiles() {
    return ["Administrador", "Rector", "Coordinador"].includes(currentSessionUser?.rol);
}

function canCreateDiagnostics() {
    return ["Coordinador", "Psicóloga"].includes(currentSessionUser?.rol);
}

function canCreatePIAR() {
    // Teachers may start the next PIAR for students already assigned to them;
    // the API derives the student list from assignment and checks it again.
    // Psicóloga consults PIAR content but does not edit it.
    return ["Administrador", "Rector", "Coordinador", "Docente"].includes(currentSessionUser?.rol);
}

// Refleja OBSERVATION_CREATORS de backend/authorization.js (POST /api/observaciones);
// la API sigue siendo la que decide.
function canCreateObservations() {
    return ["Coordinador", "Psicóloga", "Docente"].includes(currentSessionUser?.rol);
}

function canModifyDiagnostics() {
    return ["Administrador", "Rector", "Coordinador", "Psicóloga"].includes(currentSessionUser?.rol);
}

function canDeleteDiagnostics() {
    return ["Administrador", "Rector", "Coordinador"].includes(currentSessionUser?.rol);
}

function isPiarClosed(piarId) {
    return state.piars.find(item => Number(item.id) === Number(piarId))?.estado === "cerrado";
}

function canEditPiarTrace(piarId) {
    // A closed PIAR is read-only; the API rejects the same mutations with 409.
    return canCreatePIAR() && state.piars.some(item => Number(item.id) === Number(piarId)) && !isPiarClosed(piarId);
}

document.addEventListener("DOMContentLoaded", () => {
    initializeApp();
});

async function initializeApp() {
    clearSensitiveState();
    try {
        try {
            const appConfig = await apiGetAppConfig();
            if (appConfig?.institution?.name === "Colegio Reinaldo Matiz") {
                window.PIAR_APP_CONFIG = appConfig;
            }
        } catch {
            // The display fallback is fixed in data.js; never trust localStorage for identity.
        }
        // El enlace de cambio de correo se atiende aunque haya una sesión abierta:
        // al confirmarlo, el servidor revoca todas las sesiones de la cuenta.
        if (new URLSearchParams(window.location.hash.slice(1)).has("verify-email-change")) {
            renderLogin("verify-email");
            return;
        }
        const session = await apiCurrentUser();
        currentSessionUser = session.user;
        if (currentSessionUser.mustChangePassword) {
            renderInitialPasswordChange();
            return;
        }
        state = createInitialState();
        loadInstitutionSettings();
        await hydrateBusinessState();
        startSessionValidation();
        renderApp("dashboard");
        const authResult = new URLSearchParams(window.location.search).get("auth");
        if (authResult === "oidc-linked") showToastMessage("La identidad externa quedó vinculada.", "success");
        if (authResult === "oidc-link-error") showToastMessage("No se pudo vincular esa identidad; puede estar asociada a otra cuenta.", "warning");
    } catch (error) {
        clearSensitiveState();
        if (error.status === 401) {
            const authResult = new URLSearchParams(window.location.search).get("auth");
            const statusMessage = ({
                "oidc-link-required": "El proveedor confirmó la identidad, pero no está vinculado. Regístrate e inicia sesión localmente; después vincúlalo desde el menú de cuenta.",
                "provider-unavailable": "Este proveedor de acceso no está configurado.",
                "oidc-error": "No se pudo validar el acceso externo. Intenta nuevamente.",
                "oidc-link-error": "No se pudo vincular la identidad. Confirma que el correo esté verificado y que no esté vinculada a otra cuenta."
            })[authResult] || "Inicia sesión para consultar información institucional.";
            renderLogin("login", statusMessage);
        } else if (error.status === 403) {
            renderStartupError("La cuenta autenticada no tiene permisos para acceder a esta información.");
        } else {
            renderStartupError("No fue posible verificar la sesión. Comprueba la conexión y vuelve a intentarlo.");
        }
    }
}

function createInitialState() {
    const initialState = structuredClone(window.APP_DATA);
    initialState.institution.name = window.PIAR_APP_CONFIG?.institution?.name || "Colegio Reinaldo Matiz";
    return initialState;
}

function clearSensitiveState() {
    clearInterval(sessionCheckTimer);
    sessionCheckTimer = null;
    for (const key of LEGACY_STORAGE_KEYS) {
        try { localStorage.removeItem(key); } catch { /* storage can be unavailable */ }
    }
    state = createInitialState();
    state.students = [];
    state.teachers = [];
    state.piars = [];
    currentSessionUser = null;
    apiConnected = false;
}

window.handleSessionExpired = () => {
    clearSensitiveState();
    renderLogin("login", "La sesión expiró. Inicia sesión nuevamente.");
};

function startSessionValidation() {
    clearInterval(sessionCheckTimer);
    sessionCheckTimer = setInterval(validateCurrentSession, 5 * 60 * 1000);
}

async function validateCurrentSession() {
    if (!currentSessionUser || !apiConnected) return;
    try {
        const session = await apiCurrentUser();
        if (!session.user || session.user.id !== currentSessionUser.id) window.handleSessionExpired();
    } catch (error) {
        clearSensitiveState();
        renderStartupError(error.status === 401
            ? "La sesión expiró. Inicia sesión nuevamente."
            : "No fue posible verificar la sesión. Vuelve a intentarlo.");
    }
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") validateCurrentSession();
});

function loadInstitutionSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(INSTITUTION_SETTINGS_KEY) || "{}");
        if (saved && typeof saved === "object") state.institution = { ...state.institution, ...saved };
        state.institution.name = window.PIAR_APP_CONFIG?.institution?.name || "Colegio Reinaldo Matiz";
    } catch {
        localStorage.removeItem(INSTITUTION_SETTINGS_KEY);
    }
}

function renderStartupError(message) {
    const root = document.getElementById("app");
    root.innerHTML = `<main class="auth-container"><section class="auth-card" aria-labelledby="startupTitle"><div class="auth-right">${authBrand()}<h1 class="auth-title" id="startupTitle">No fue posible continuar</h1><p class="auth-subtitle startup-message"></p><button class="btn-modern" type="button" data-onclick="initializeApp()">Reintentar</button></div></section></main>`;
    root.querySelector(".startup-message").textContent = message;
}

function renderLogin(mode = "login", statusMessage = "") {
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    if (hashParams.has("reset")) mode = "reset";
    if (hashParams.has("verify-email")) mode = "verify-email";
    // Decisión D1: el enlace de cambio de correo usa la misma pantalla de verificación.
    const isEmailChange = hashParams.has("verify-email-change");
    if (isEmailChange) mode = "verify-email";
    const isResendVerification = mode === "resend-verification";
    const isRegister = mode === "register";
    const isReset = mode === "reset";
    const isVerifyEmail = mode === "verify-email";

    const isLogin = !isReset && !isVerifyEmail && !isResendVerification && !isRegister;
    const title = isReset ? "Recuperar contraseña" : isVerifyEmail ? "Verificar correo" : isResendVerification ? "Reenviar verificación" : isRegister ? "Crear una cuenta" : "Bienvenido al Sistema PIAR";
    const subtitle = isReset ? "Solicita un enlace o define una nueva contraseña." : isVerifyEmail ? (isEmailChange ? "Confirma el nuevo correo de tu cuenta. Al hacerlo se cerrarán tus sesiones abiertas." : "Confirma tu correo para enviar la solicitud a aprobación institucional.") : isResendVerification ? "Si existe una solicitud pendiente, enviaremos un nuevo enlace." : isRegister ? "Solicita acceso institucional al Sistema PIAR." : "Un espacio para construir una educación inclusiva.";
    // Acciones secundarias como botones reales: se activan con Enter o Espacio.
    const links = isLogin
        ? `<button class="auth-link-button" type="button" data-onclick="renderLogin('register')"><i class="bi bi-person-plus" aria-hidden="true"></i>Crear una cuenta</button>
           <span class="auth-links-separator" aria-hidden="true"></span>
           <button class="auth-link-button" type="button" data-onclick="renderLogin('reset')"><i class="bi bi-key" aria-hidden="true"></i>¿Olvidaste tu contraseña?</button>
           <button class="auth-link-button auth-link-secondary" type="button" data-onclick="renderLogin('resend-verification')"><i class="bi bi-envelope-arrow-up" aria-hidden="true"></i>Reenviar verificación de correo</button>`
        : isRegister
            ? `<p class="auth-link">¿Ya tienes cuenta? <button class="auth-link-button" type="button" data-onclick="renderLogin('login')"><i class="bi bi-box-arrow-in-right" aria-hidden="true"></i>Iniciar sesión</button></p>`
            : `<button class="auth-link-button" type="button" data-onclick="${isReset ? "leavePasswordReset(event)" : "leaveEmailVerification(event)"}"><i class="bi bi-arrow-left" aria-hidden="true"></i>Volver al acceso</button>
               ${isReset ? "" : `<button class="auth-link-button" type="button" data-onclick="renderLogin('reset')"><i class="bi bi-key" aria-hidden="true"></i>¿Olvidaste tu contraseña?</button>`}`;

    document.getElementById("app").innerHTML = `
        <main class="auth-container ${isRegister ? "auth-container-register" : ""}">
            <section class="auth-card ${isRegister ? "auth-card-register" : ""}" aria-labelledby="authTitle">
                <div class="auth-right ${isRegister ? "auth-right-register" : ""}">
                    ${authBrand()}
                    <h1 class="auth-title" id="authTitle">${title}</h1>
                    <p class="auth-subtitle">${subtitle}</p>
                    ${isVerifyEmail ? "" : `<div class="auth-tabs" role="group" aria-label="Tipo de acceso">
                        <button class="${!isRegister ? "active" : ""}" aria-pressed="${!isRegister}" data-onclick="renderLogin('login')" type="button">Ingresar</button>
                        <button class="${isRegister ? "active" : ""}" aria-pressed="${isRegister}" data-onclick="renderLogin('register')" type="button">Registrarse</button>
                    </div>`}
                    ${isLogin ? '<h2 class="visually-hidden">Acceso con correo</h2>' : ""}
                    ${isReset ? passwordResetForm() : isVerifyEmail ? emailVerificationForm() : isResendVerification ? resendVerificationForm() : isRegister ? registerForm() : loginForm()}
                    ${isRegister ? '<p class="auth-status-note">Verifica tu correo y luego espera la aprobación institucional. El perfil solicitado no concede acceso hasta que un Administrador lo apruebe.</p>' : ""}
                    <div class="auth-links">${links}</div>
                    ${isLogin && externalAuthEnabled() ? externalAuthOptions() : ""}
                    <p class="auth-link auth-feedback" role="status" aria-live="polite">${escapeHTML(statusMessage || "Conexión segura requerida para acceder al sistema.")}</p>
                </div>
            </section>
            ${loginSceneMarkup(isRegister ? "register" : "login")}
        </main>
    `;
    startLoginScene();
    if (isLogin && externalAuthEnabled()) refreshExternalAuthAvailability();
}

// Entrega académica: Google, Microsoft y Apple se ocultan de la interfaz mientras
// features.externalAuth (public/js/config.js) no sea true. No cambia el backend:
// las rutas OIDC y la vinculación de identidades siguen existiendo para una fase futura.
function externalAuthEnabled() {
    return window.PIAR_API_CONFIG?.features?.externalAuth === true;
}

// Logotipo de las referencias: libro abierto del que surgen tres personas.
// Decorativo: el nombre «Sistema PIAR» se muestra como texto al lado.
function piarLogoMark() {
    return `<svg viewBox="0 0 74 56" focusable="false" aria-hidden="true">
        <defs><linearGradient id="piarLogoGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8B5CF6"/><stop offset="1" stop-color="#4320A8"/></linearGradient></defs>
        <path d="M3 41c11-3 23-2 34 6 11-8 23-9 34-6v4c-11-3-23-2-34 6-11-8-23-9-34-6z" fill="url(#piarLogoGrad)"/>
        <path d="M37 44c-9-6-19-8-31-6V24c12-2 22 0 31 6z" fill="#FFFFFF"/>
        <path d="M37 44c9-6 19-8 31-6V24c-12-2-22 0-31 6z" fill="#EDE7FF"/>
        <path d="M37 30v14" stroke="#4320A8" stroke-width="1.4"/>
        <circle cx="37" cy="7" r="4.4" fill="#FFFFFF"/>
        <path d="M27 6l10 11 10-11M37 17v11" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <circle cx="22" cy="15" r="3.6" fill="#B79CFF"/>
        <path d="M14 30c1-7 4-10 8-10s7 3 8 10" fill="#8B5CF6"/>
        <circle cx="52" cy="15" r="3.6" fill="#B79CFF"/>
        <path d="M44 30c1-7 4-10 8-10s7 3 8 10" fill="#8B5CF6"/>
    </svg>`;
}

function authBrand() {
    return `<div class="auth-brand"><span class="auth-brand-mark" aria-hidden="true">${piarLogoMark()}</span><span class="auth-brand-name"><small>SISTEMA</small><strong>PIAR</strong></span></div>
        <p class="auth-brand-legend">Plan Individual de Ajustes Razonables</p>`;
}

// La escena animada es opcional: si login-scene.js no cargó o falla, el acceso sigue igual.
function loginSceneMarkup(mode = "login") {
    try {
        return window.PiarLoginScene?.markup?.(mode) || "";
    } catch {
        return "";
    }
}

function startLoginScene() {
    try {
        window.PiarLoginScene?.start?.(document.querySelector(".auth-scene"));
    } catch {
        // Decoración opcional: nunca bloquea el formulario.
    }
}

// Mensaje accesible en la zona de estado de las pantallas de acceso.
function showAuthFeedback(message) {
    const feedback = document.querySelector?.(".auth-feedback");
    if (feedback) feedback.textContent = message;
}

function renderInitialPasswordChange(statusMessage = "") {
    document.getElementById("app").innerHTML = `
        <main class="auth-container">
            <section class="auth-card auth-first-password" aria-labelledby="initialPasswordTitle">
                <div class="auth-right">
                    ${authBrand()}
                    <h1 class="auth-title" id="initialPasswordTitle">Crea tu contraseña personal</h1>
                    <p class="auth-subtitle">La contraseña temporal ya cumplió su función. Define una nueva para acceder al sistema.</p>
                    <form class="auth-form auth-form-login" data-onsubmit="completeInitialPasswordChange(event)">
                        <div class="auth-field"><label for="initialNewPassword">Nueva contraseña</label><input class="input-modern" id="initialNewPassword" name="password" type="password" autocomplete="new-password" minlength="14" maxlength="72" required></div>
                        <div class="auth-field"><label for="initialConfirmPassword">Confirma la nueva contraseña</label><input class="input-modern" id="initialConfirmPassword" name="password-confirm" type="password" autocomplete="new-password" minlength="14" maxlength="72" required></div>
                        <button class="btn-modern auth-submit" type="submit">Guardar contraseña y continuar</button>
                    </form>
                    <p class="auth-feedback" role="status" aria-live="polite">${escapeHTML(statusMessage || "Usa al menos 14 caracteres. Este cambio es obligatorio antes de abrir el panel.")}</p>
                    <div class="auth-links"><button class="auth-link-button" type="button" data-onclick="logout()">Cerrar sesión</button></div>
                </div>
            </section>
            ${loginSceneMarkup()}
        </main>`;
    startLoginScene();
}

async function completeInitialPasswordChange(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const password = document.getElementById("initialNewPassword").value;
    const confirmation = document.getElementById("initialConfirmPassword").value;
    if (password !== confirmation) {
        renderInitialPasswordChange("Las contraseñas no coinciden.");
        return;
    }
    if (password.length < 14 || new TextEncoder().encode(password).length > 72) {
        renderInitialPasswordChange("La contraseña debe tener al menos 14 caracteres y no superar 72 bytes.");
        return;
    }
    setAuthSubmitting(form, true, "Guardando…");
    try {
        await apiChangeInitialPassword(password);
        await initializeApp();
    } catch {
        renderInitialPasswordChange("No se pudo cambiar la contraseña. Verifica la sesión e inténtalo de nuevo.");
    }
}

function externalAuthOptions() {
    const providers = [
        { name: "Google", icon: "bi-google", className: "provider-google" },
        { name: "Microsoft", icon: "bi-microsoft", className: "provider-microsoft" },
        { name: "Apple", icon: "bi-apple", className: "provider-apple" }
    ];
    // Siempre deshabilitados al dibujarse; solo se habilitan si /api/auth/oidc/providers
    // confirma una configuración real en el servidor.
    return `<div class="auth-divider auth-divider-email"><span>O continúa con</span></div>
    <section class="auth-provider-options" aria-label="Otras opciones de acceso">
        <div class="auth-provider-list">
            ${providers.map(provider => `<button class="auth-provider-button ${provider.className}" type="button" disabled aria-disabled="true" data-onclick="startExternalAuth('${provider.name.toLowerCase()}')" aria-label="${provider.name}: comprobando disponibilidad" aria-describedby="external-auth-status"><i class="bi ${provider.icon}" aria-hidden="true"></i><span class="auth-provider-label">Continuar con <span class="auth-provider-name">${provider.name}</span></span><span class="auth-provider-badge">Comprobando</span></button>`).join("")}
        </div>
        <p class="auth-provider-status" id="external-auth-status" role="status" aria-live="polite">Comprobando disponibilidad de acceso externo.</p>
    </section>`;
}

async function refreshExternalAuthAvailability() {
    const status = document.getElementById("external-auth-status");
    if (!status) return;
    const providers = ["google", "microsoft", "apple"];
    try {
        const response = await fetch("/api/auth/oidc/providers", { credentials: "same-origin" });
        if (!response.ok) throw new Error("provider status unavailable");
        const result = await response.json();
        for (const provider of providers) {
            const button = document.querySelector(`.provider-${provider}`);
            if (!button) continue;
            const available = result.providers?.[provider] === true;
            button.disabled = !available;
            button.setAttribute("aria-disabled", String(!available));
            button.setAttribute("aria-label", `${providerLabel(provider)}: ${available ? "iniciar sesión" : "no disponible"}`);
            const badge = button.querySelector(".auth-provider-badge");
            if (badge) badge.textContent = available ? "Acceder" : "No disponible";
        }
        const availableCount = providers.filter(provider => result.providers?.[provider] === true).length;
        status.textContent = availableCount
            ? "Usa una cuenta institucional aprobada y vinculada para iniciar sesión."
            : "El acceso con Google, Microsoft y Apple no está configurado. Usa tu correo institucional.";
    } catch {
        for (const provider of providers) {
            const button = document.querySelector(`.provider-${provider}`);
            if (!button) continue;
            button.disabled = true;
            button.setAttribute("aria-disabled", "true");
            button.setAttribute("aria-label", `${providerLabel(provider)}: no disponible`);
            const badge = button.querySelector(".auth-provider-badge");
            if (badge) badge.textContent = "No disponible";
        }
        status.textContent = "No fue posible comprobar el acceso externo. Usa tu correo institucional.";
    }
}

function providerLabel(provider) {
    return ({ google: "Google", microsoft: "Microsoft", apple: "Apple" })[provider] || "Proveedor externo";
}

async function startExternalAuth(provider, link = false, password = "") {
    if (!["google", "microsoft", "apple"].includes(provider)) return;
    if (link) {
        // Decisión D5: vincular exige la contraseña local de la cuenta autenticada.
        if (!password) {
            openExternalIdentities();
            return;
        }
        try {
            const response = await fetch(`/api/auth/oidc/${provider}/link`, {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || typeof result.url !== "string") throw new Error(result.message || "No se pudo iniciar la vinculación.");
            window.location.assign(result.url);
        } catch (error) {
            showToastMessage(error.message || "No se pudo iniciar la vinculación. Comprueba la sesión y la configuración del proveedor.", "warning");
        }
        return;
    }
    window.location.assign(`/api/auth/oidc/${provider}/start`);
}

const EXTERNAL_PROVIDER_LABELS = Object.freeze({ google: "Google", microsoft: "Microsoft", apple: "Apple", otro: "Otro proveedor" });

// Decisión D5: consultar, vincular y desvincular las identidades externas propias.
// Nunca se vincula por coincidencia de correo y la identidad no concede roles.
async function openExternalIdentities() {
    if (!currentSessionUser || isStudentSession()) return;
    let identities = [];
    let providers = {};
    try {
        const [list, availability] = await Promise.all([
            apiGetIdentities(),
            fetch("/api/auth/oidc/providers", { credentials: "same-origin" }).then(response => response.ok ? response.json() : {}).catch(() => ({}))
        ]);
        identities = list.data || [];
        providers = availability.providers || {};
    } catch (error) {
        showToastMessage(error.message || "No se pudieron consultar las identidades externas.", "warning");
        return;
    }
    const rows = identities.length
        ? `<ul class="identity-list">${identities.map(item => `<li><strong>${escapeHTML(EXTERNAL_PROVIDER_LABELS[item.proveedor] || item.proveedor)}</strong> ${escapeHTML(item.correo || "Sin correo informado")} <button class="table-btn" type="button" data-onclick="unlinkExternalIdentity(${Number(item.id)})">Desvincular</button></li>`).join("")}</ul>`
        : '<p class="form-help">No hay identidades externas vinculadas.</p>';
    const linkButtons = ["google", "microsoft", "apple"].map(provider => providers[provider]
        ? `<button class="table-btn" type="button" data-onclick="linkExternalIdentity('${provider}')">Vincular ${EXTERNAL_PROVIDER_LABELS[provider]}</button>`
        : `<button class="table-btn" type="button" disabled aria-disabled="true">${EXTERNAL_PROVIDER_LABELS[provider]}: no configurado</button>`).join(" ");
    openModal("Identidades externas", `
        <div class="modal-form">
            <p class="trace-form-feedback" data-form-feedback id="identity-error" role="alert" hidden></p>
            ${rows}
            <label for="identityPassword">Contraseña actual (obligatoria para vincular o desvincular)</label>
            <input id="identityPassword" class="input-modern" type="password" autocomplete="current-password" maxlength="72">
            <div class="approval-actions">${linkButtons}</div>
            <small>La vinculación solo acepta identidades verificadas por el proveedor. No se vinculan cuentas por coincidencia de correo y la identidad externa no cambia tu perfil ni tus permisos.</small>
        </div>`);
}

function identityPasswordValue() {
    const value = document.getElementById("identityPassword")?.value || "";
    if (!value) showToastMessage("Escribe tu contraseña actual para continuar.", "warning");
    return value;
}

function linkExternalIdentity(provider) {
    const password = identityPasswordValue();
    if (password) startExternalAuth(provider, true, password);
}

async function unlinkExternalIdentity(identityId) {
    const password = identityPasswordValue();
    if (!password || !window.confirm("¿Desvincular esta identidad externa?")) return;
    try {
        const result = await apiUnlinkIdentity(identityId, password);
        closeModal();
        showToastMessage(result.message || "Identidad desvinculada.");
    } catch (error) {
        showToastMessage(error.message || "No se pudo desvincular la identidad.", "warning");
    }
}

function loginForm() {
    return `
        <form data-onsubmit="login(event)" class="auth-form auth-form-login">
            <div class="auth-field auth-field-icon"><label for="loginEmail">Correo electrónico</label><input id="loginEmail" name="correo" type="email" class="input-modern" placeholder="nombre@institucion.edu.co" autocomplete="username" required><i class="bi bi-envelope" aria-hidden="true"></i></div>
            <div class="auth-field auth-field-icon auth-password-field"><label for="loginPassword">Contraseña</label><input id="loginPassword" name="password" type="password" class="input-modern" placeholder="Ingresa tu contraseña" autocomplete="current-password" required><i class="bi bi-lock" aria-hidden="true"></i><button class="auth-password-toggle" type="button" aria-label="Mostrar contraseña" data-onclick="togglePasswordVisibility('loginPassword', this)">Mostrar</button></div>
            <button type="submit" class="btn-modern auth-submit"><i class="bi bi-box-arrow-in-right" aria-hidden="true"></i>Iniciar sesión</button>
        </form>
    `;
}

// Decisión D2: perfiles que se pueden solicitar (el valor interno de Psicólogo(a)
// es 'Psicóloga'). Administrador y Estudiante nunca se ofrecen; el servidor
// aplica la misma lista y el perfil elegido no concede permisos.
const REQUESTABLE_ROLES = Object.freeze([["Docente", "Docente"], ["Psicóloga", "Psicólogo(a)"], ["Coordinador", "Coordinador"], ["Rector", "Rector"]]);

function roleLabel(role) {
    return role === "Psicóloga" ? "Psicólogo(a)" : String(role || "");
}

function requestableRoleOptions(selected) {
    // Valores y etiquetas son constantes del código (sin datos del usuario).
    return REQUESTABLE_ROLES.map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function registerForm() {
    return `
        <form data-onsubmit="registerUser(event)" class="auth-form auth-form-register">
            <div class="auth-field"><label for="registerName">Nombre</label><input id="registerName" name="nombre" type="text" class="input-modern" placeholder="Nombre" autocomplete="given-name" required></div>
            <div class="auth-field"><label for="registerLastName">Apellidos</label><input id="registerLastName" name="apellidos" type="text" class="input-modern" placeholder="Apellidos" autocomplete="family-name" required></div>
            <div class="auth-field"><label for="registerDocument">Documento</label><input id="registerDocument" name="documento" type="text" class="input-modern" placeholder="Número de documento" autocomplete="off" required></div>
            <div class="auth-field"><label for="registerEmail">Correo electrónico</label><input id="registerEmail" name="correo" type="email" class="input-modern" placeholder="nombre@institucion.edu.co" autocomplete="email" required></div>
            <div class="auth-field"><label for="registerRole">Perfil institucional solicitado</label><select id="registerRole" name="rol" class="input-modern" required>${requestableRoleOptions("Docente")}</select><small class="auth-status-note">La solicitud queda pendiente hasta que un Administrador o Rector la apruebe. Elegir un perfil no concede acceso ni permisos.</small></div>
            <div class="auth-field auth-password-field"><label for="registerPassword">Contraseña</label><input id="registerPassword" name="password" type="password" class="input-modern" placeholder="Mínimo 14 caracteres" autocomplete="new-password" minlength="14" maxlength="72" required><button class="auth-password-toggle" type="button" aria-label="Mostrar contraseña" data-onclick="togglePasswordVisibility('registerPassword', this)">Mostrar</button></div>
            <div class="auth-field auth-password-field"><label for="registerConfirm">Confirmar contraseña</label><input id="registerConfirm" name="password-confirm" type="password" class="input-modern" placeholder="Repite la contraseña" autocomplete="new-password" minlength="14" required><button class="auth-password-toggle" type="button" aria-label="Mostrar confirmación de contraseña" data-onclick="togglePasswordVisibility('registerConfirm', this)">Mostrar</button></div>
            <button type="submit" class="btn-modern auth-submit">Solicitar cuenta</button>
        </form>
    `;
}

function togglePasswordVisibility(inputId, button) {
    const input = document.getElementById(inputId);
    if (!input || !button) return;
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    button.textContent = visible ? "Ocultar" : "Mostrar";
    button.setAttribute("aria-label", `${visible ? "Ocultar" : "Mostrar"} contraseña`);
}

function setAuthSubmitting(form, busy, busyLabel) {
    const button = form?.querySelector('button[type="submit"]');
    if (!button) return;
    if (busy) {
        button.dataset.idleLabel = button.textContent;
        // Conserva el marcado original (icono incluido) para restaurarlo después.
        button.dataset.idleHtml = button.innerHTML ?? "";
        button.textContent = busyLabel;
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        form.setAttribute("aria-busy", "true");
        return;
    }
    if (button.dataset.idleHtml) button.innerHTML = button.dataset.idleHtml;
    else button.textContent = button.dataset.idleLabel || button.textContent;
    button.disabled = false;
    button.removeAttribute("aria-busy");
    form.removeAttribute("aria-busy");
}

async function login(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setAuthSubmitting(form, true, "Ingresando…");
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    try {
        const result = await apiLogin({ correo: email, password });
        clearSensitiveState();
        currentSessionUser = result.user;
        if (result.user.mustChangePassword || result.mustChangePassword) {
            renderInitialPasswordChange();
            return;
        }
        state = createInitialState();
        loadInstitutionSettings();
        await hydrateBusinessState();
        startSessionValidation();
        renderApp("dashboard");
    } catch (error) {
        clearSensitiveState();
        renderLogin("login", error.status === 401
            ? "Credenciales inválidas o cuenta pendiente de aprobación."
            : "No fue posible completar el inicio de sesión.");
        showToastMessage(error.message, "warning");
    } finally {
        setAuthSubmitting(form, false);
    }
}

async function registerUser(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = document.getElementById("registerName").value.trim();
    const lastName = document.getElementById("registerLastName").value.trim();
    const documentNumber = document.getElementById("registerDocument").value.trim();
    const email = document.getElementById("registerEmail").value.trim();
    // El servidor valida de nuevo el perfil contra la misma lista (decisión D2).
    const role = document.getElementById("registerRole")?.value || "Docente";
    const password = document.getElementById("registerPassword").value;
    const confirm = document.getElementById("registerConfirm").value;

    if (password !== confirm) {
        document.getElementById("registerConfirm")?.setAttribute?.("aria-invalid", "true");
        showAuthFeedback("Las contraseñas no coinciden. Escríbelas de nuevo.");
        showToastMessage("Las contraseñas no coinciden.", "warning");
        return;
    }
    document.getElementById("registerConfirm")?.removeAttribute?.("aria-invalid");

    setAuthSubmitting(form, true, "Enviando solicitud…");
    try {
        const result = await apiRegister({ nombre: name, apellidos: lastName, documento: documentNumber, correo: email, password, rol: role });
        renderLogin("login", result.message || "Solicitud recibida. La cuenta requiere aprobación institucional.");
    } catch (error) {
        const message = error.message || "No fue posible enviar la solicitud. Inténtalo de nuevo.";
        showAuthFeedback(message);
        showToastMessage(message, "warning");
    } finally {
        setAuthSubmitting(form, false);
    }
}

// A role without access to a resource (403) gets an empty collection instead
// of aborting the whole session; the backend remains the authority.
function emptyWhenForbidden(request) {
    return request.catch(error => {
        if (error.status === 403) return { data: [] };
        throw error;
    });
}

function mapPiarDetail(piar) {
    const principal = (piar.docentes || []).find(docente => Number(docente.es_responsable_principal) === 1) || piar.docentes?.[0];
    return {
        ...piar,
        id: piar.id_piar,
        studentId: piar.id_estudiante,
        teacherId: principal?.id_docente || null,
        fechaCreacion: piar.fecha_creacion,
        fechaRevision: piar.fecha_revision,
        objetivoGeneral: piar.objetivo_general,
        informesSalud: piar.informes_salud,
        diagnosticos: piar.diagnosticos || [],
        observaciones: (piar.observaciones || []).map(obs => ({ ...obs, id: obs.id_observacion ?? obs.id, nota: obs.descripcion ?? obs.nota, autor: obs.docente_responsable ?? obs.autor })),
        seguimientos: piar.seguimientos || [],
        barreras: piar.barreras || [],
        dua: piar.dua || [],
        historial: (state.history || []).filter(row => Number(row.id_piar) === Number(piar.id_piar)),
        ajustes: piar.ajustes || []
    };
}

async function refreshPiarInState(piarId) {
    const result = await apiGetPiar(piarId);
    const mapped = mapPiarDetail(result.data);
    const index = state.piars.findIndex(item => Number(item.id) === Number(piarId));
    if (index >= 0) state.piars[index] = mapped;
    else state.piars.push(mapped);
    return mapped;
}

async function hydrateBusinessState() {
    try {
        if (isStudentSession()) {
            // Only the own-PIAR routes are available to this role.
            const piarsResult = await apiGetPiars();
            const piarDetails = await Promise.all((piarsResult.data || []).map(piar => apiGetPiar(piar.id_piar)));
            state.piars = piarDetails.map(result => mapPiarDetail(result.data));
            apiConnected = true;
            return;
        }
        const [studentsResult, teachersResult, piarsResult, historyResult] = await Promise.all([
            emptyWhenForbidden(apiGetStudents()),
            emptyWhenForbidden(apiGetTeachers()),
            emptyWhenForbidden(apiGetPiars()),
            emptyWhenForbidden(apiGetHistory())
        ]);
        state.students = studentsResult.data || studentsResult;
        state.teachers = (teachersResult.data || teachersResult).map(teacher => {
            const parts = String(teacher.nombre || "").trim().split(/\s+/);
            const middle = Math.ceil(parts.length / 2);
            return {
                ...teacher,
                id: teacher.id_docente,
                nombres: teacher.nombres || parts.slice(0, middle).join(" "),
                apellidos: teacher.apellidos || parts.slice(middle).join(" ")
            };
        });
        state.history = historyResult.data || historyResult;
        const piarRows = piarsResult.data || piarsResult;
        const piarDetails = await Promise.all(piarRows.map(piar => apiGetPiar(piar.id_piar)));
        state.piars = piarDetails.map(result => mapPiarDetail(result.data));
        apiConnected = true;
    } catch (error) {
        apiConnected = false;
        throw error;
    }
}

function renderApp(view) {
    if (isStudentSession()) view = "piar";
    currentView = view;
    document.getElementById("app").innerHTML = `
        <div class="dashboard-layout">
            ${sidebar(view)}
            <main class="dashboard-main">
                <div class="dashboard-wrapper">
                    ${navbar(view)}
                    <section id="viewRoot"></section>
                </div>
            </main>
        </div>
    `;
    renderView(view);
}

function sidebar(active) {
    const items = [
        ["dashboard", "bi-grid-fill", "Dashboard"],
        ["students", "bi-people-fill", "Estudiantes"],
        ["teachers", "bi-person-badge-fill", "Docentes"],
        ["piar", "bi-journal-text", "PIAR / PR"],
        ["reports", "bi-bar-chart-fill", "Reportes"],
        ["settings", "bi-gear-fill", "Configuración"]
    ];
    if (currentSessionUser?.rol === "Administrador") {
        items.splice(1, 0, ["registration-requests", "bi-person-check-fill", "Solicitudes"], ["users", "bi-person-gear", "Usuarios"]);
    } else if (currentSessionUser?.rol === "Rector") {
        // El Rector revisa solicitudes de Docente, Psicólogo(a) y Coordinador; no administra cuentas.
        items.splice(1, 0, ["registration-requests", "bi-person-check-fill", "Solicitudes"]);
    }
    if (isStudentSession()) items.splice(0, items.length, ["piar", "bi-journal-text", "Mi PIAR"]);

    return `
        <aside class="sidebar">
            <div>
                <div class="sidebar-logo"><h2>PIAR</h2></div>
                <ul class="sidebar-menu">
                    ${items.map(([id, icon, label]) => `
                        <li class="${active === id ? "active" : ""}" data-onclick="renderApp('${id}')">
                            <i class="bi ${icon}"></i>
                            <span>${escapeHTML(label)}</span>
                        </li>
                    `).join("")}
                </ul>
            </div>
            <button class="logout-btn" data-onclick="logout()">
                <i class="bi bi-box-arrow-left"></i>
                Cerrar sesión
            </button>
        </aside>
    `;
}

function navbar(view) {
    const titles = {
        dashboard: ["Dashboard", "Resumen general del seguimiento institucional"],
        "registration-requests": ["Solicitudes de registro", "Revisa y decide las solicitudes de acceso institucional"],
        users: ["Usuarios", "Cuentas institucionales, estado y acceso"],
        students: ["Gestión de estudiantes", "Perfiles, diagnósticos, barreras y apoyos"],
        teachers: ["Docentes", "Responsables, áreas y acompañamiento"],
        piar: ["PIAR / PR", "Planes, ajustes razonables y observaciones"],
        reports: ["Reportes", "Generación de informes para seguimiento y comité"],
        settings: ["Configuración", "Datos institucionales y mantenimiento"]
    };
    if (isStudentSession()) titles.piar = ["Mi PIAR", "Consulta de solo lectura de tu Plan Individual de Ajustes Razonables"];
    const [title, subtitle] = titles[view];
    const profileName = currentSessionUser?.nombre || state.institution.teacher;
    const profileLabel = currentSessionUser?.rol || state.institution.name;

    return `
        <div class="dashboard-navbar">
            <div>
                <button class="menu-toggle" data-onclick="toggleSidebar()"><i class="bi bi-list"></i></button>
                <h1 class="dashboard-title">${escapeHTML(title)}</h1>
                <p class="dashboard-subtitle">${escapeHTML(subtitle)}</p>
            </div>
            <div class="user-profile" data-onclick="toggleProfileMenu()">
                <span class="api-status ${apiConnected ? "online" : "offline"}">
                    <i class="bi ${apiConnected ? "bi-cloud-check-fill" : "bi-cloud-slash-fill"}"></i>
                    ${apiConnected ? getApiLabel() : "Local"}
                </span>
                <div class="user-avatar">${escapeHTML(initials(profileName))}</div>
                <div>
                    <strong>${escapeHTML(profileName)}</strong>
                    <p>${escapeHTML(profileLabel)}</p>
                </div>
                <div class="profile-dropdown" id="profileDropdown">
                    ${isStudentSession() ? "" : `<button data-onclick="renderApp('settings')"><i class="bi bi-building"></i> Institución</button>`}
                    ${isStudentSession() || !externalAuthEnabled() ? "" : `<button data-onclick="openExternalIdentities()"><i class="bi bi-link-45deg"></i> Identidades externas</button>`}
                    <button data-onclick="logout()"><i class="bi bi-box-arrow-left"></i> Cerrar sesión</button>
                </div>
            </div>
        </div>
    `;
}

function renderView(view) {
    const views = {
        dashboard: renderDashboard,
        "registration-requests": renderRegistrationRequests,
        users: renderUserAdministration,
        students: renderStudents,
        teachers: renderTeachers,
        piar: renderPIAR,
        reports: renderReports,
        settings: renderSettings
    };

    views[view]();
}

async function renderRegistrationRequests() {
    const root = document.getElementById("viewRoot");
    if (!root) return;
    if (!canDecideRegistrationRequests()) {
        root.innerHTML = '<div class="table-card"><p>No tienes autorización para gestionar solicitudes.</p></div>';
        return;
    }
    root.innerHTML = '<div class="table-card"><p role="status">Cargando solicitudes…</p></div>';
    try {
        // El servidor devuelve solo las solicitudes pendientes que este rol puede decidir.
        const result = await apiGetRegistrationRequests();
        // Defensa adicional: solo perfiles solicitables y en estado pendiente.
        const requests = (result.data || []).filter(user => REQUESTABLE_ROLES.some(([value]) => value === user.rol) && ["pendiente", "pendiente_verificacion"].includes(user.estado));
        const rectorNote = currentSessionUser?.rol === "Rector" ? " Las solicitudes de perfil Rector las decide el Administrador." : "";
        root.innerHTML = `
            <div class="table-card">
                <div class="table-header"><h3>Solicitudes de registro</h3><span>${requests.length} pendientes</span></div>
                <p class="auth-status-note">Confirma la identidad de cada persona por un canal institucional antes de aprobar: en este proceso el sistema no verifica el correo.${rectorNote}</p>
                ${requests.length ? `<div class="responsive-table"><table class="modern-table"><thead><tr><th>Nombre</th><th>Correo</th><th>Documento</th><th>Perfil</th><th>Verificación del correo</th><th>Acción</th></tr></thead><tbody>
                    ${requests.map(user => {
                        // Informativo: aprobar la solicitud no marca el correo como verificado.
                        const verified = Boolean(user.correo_verificado_at);
                        return `<tr><td>${escapeHTML(user.nombre)}</td><td>${escapeHTML(user.correo)}</td><td>${escapeHTML(user.documento)}</td><td>${escapeHTML(roleLabel(user.rol))}</td><td><span class="approval-state ${verified ? "approval-state-ready" : ""}">${verified ? "Verificado" : "Sin verificar"}</span></td><td><div class="approval-actions"><button type="button" data-onclick="decideRegistrationRequest(${Number(user.id_usuario)}, 'aprobar')">Aprobar</button><button type="button" class="approval-reject" data-onclick="decideRegistrationRequest(${Number(user.id_usuario)}, 'rechazar')">Rechazar</button></div></td></tr>`;
                    }).join("")}
                </tbody></table></div>` : '<p class="auth-status-note">No hay solicitudes pendientes en este momento.</p>'}
            </div>`;
    } catch {
        root.innerHTML = '<div class="table-card"><p role="alert">No se pudieron cargar las solicitudes.</p><button class="table-btn" type="button" data-onclick="renderRegistrationRequests()">Reintentar</button></div>';
    }
}

function canDecideRegistrationRequests() {
    return ["Administrador", "Rector"].includes(currentSessionUser?.rol);
}

async function decideRegistrationRequest(userId, decision) {
    if (!canDecideRegistrationRequests() || !["aprobar", "rechazar"].includes(decision)) return;
    const verb = decision === "aprobar" ? "aprobar" : "rechazar";
    if (!window.confirm(`¿Confirmas ${verb} esta solicitud?`)) return;
    let reason = "";
    if (decision === "rechazar") {
        reason = String(window.prompt("Indica el motivo del rechazo (máximo 500 caracteres):") || "").trim();
        if (!reason || reason.length > 500) {
            showToastMessage("El motivo es obligatorio y debe tener hasta 500 caracteres.", "warning");
            return;
        }
    }
    try {
        const outcome = await apiDecideUserApproval(userId, decision, reason);
        const notice = outcome?.notificacion === "enviada" ? " Se envió el aviso por correo." : " No se pudo enviar el aviso por correo; comunique la decisión por otro medio.";
        showToastMessage(`Solicitud ${decision === "aprobar" ? "aprobada" : "rechazada"}.${notice}`);
        await renderRegistrationRequests();
    } catch (error) {
        showToastMessage(error.message || "No fue posible actualizar la solicitud.", "warning");
    }
}

function renderDashboard() {
    const activePiars = state.piars.filter(piar => piar.estado === "activo").length;
    const pendingPiars = state.piars.filter(piar => piar.estado !== "cerrado").length;
    const observations = state.piars.reduce((total, piar) => total + piar.observaciones.length, 0);
    const averageProgress = getAverageProgress();

    document.getElementById("viewRoot").innerHTML = `
        <div class="stats-grid">
            ${statCard("bi-people-fill", state.students.length, "Estudiantes", "purple", "renderApp('students')")}
            ${statCard("bi-person-badge-fill", state.teachers.length, "Docentes", "blue", "renderApp('teachers')")}
            ${statCard("bi-journal-check", activePiars, "PIAR activos", "green", "renderApp('piar')")}
            ${statCard("bi-clipboard-pulse", observations, "Observaciones", "orange", canCreateObservations() ? "openObservationModal()" : "renderApp('piar')")}
        </div>

        <div class="dashboard-content">
            <div class="table-card">
                <div class="table-header">
                    <h3>Seguimientos recientes</h3>
                    ${canCreateObservations() ? '<button class="btn-modern small-btn" data-onclick="openObservationModal()">Nueva observación</button>' : ""}
                </div>
                ${recentObservationsTable()}
            </div>

            <div class="charts-grid">
                <div class="chart-card">
                    <h3>Avance promedio: ${averageProgress}%</h3>
                    <canvas id="progressChart"></canvas>
                </div>
                <div class="chart-card">
                    <h3>Distribución por necesidad</h3>
                    <canvas id="studentsChart"></canvas>
                </div>
            </div>

            <div class="table-card">
                <div class="table-header">
                    <h3>Alertas de revisión</h3>
                    <button class="table-btn" data-onclick="renderApp('reports')">Generar reporte</button>
                </div>
                ${alertsTable()}
            </div>
        </div>
    `;

    loadCharts();
}

function renderStudents() {
    document.getElementById("viewRoot").innerHTML = `
        <div class="students-topbar">
            <input id="studentSearch" type="text" class="search-input" placeholder="Buscar por nombre, documento, grado o diagnóstico..." data-oninput="filterStudents()">
            ${canManageStudentTeacherProfiles() ? `<button class="btn-modern add-btn" data-onclick="openStudentModal()">
                <i class="bi bi-plus-circle"></i>
                Nuevo estudiante
            </button>` : ""}
        </div>
        <div id="studentsGrid" class="students-grid">
            ${studentCards(state.students)}
        </div>
    `;
}

function renderTeachers() {
    document.getElementById("viewRoot").innerHTML = `
        <div class="students-topbar">
            <input id="teacherSearch" type="text" class="search-input" placeholder="Buscar docente, área o cargo..." data-oninput="filterTeachers()">
            ${canManageStudentTeacherProfiles() ? `<button class="btn-modern add-btn" data-onclick="openTeacherModal()">
                <i class="bi bi-person-plus-fill"></i>
                Nuevo docente
            </button>` : ""}
        </div>
        <div id="teachersGrid" class="students-grid">
            ${teacherCards(state.teachers)}
        </div>
    `;
}

function renderPIAR() {
    if (isStudentSession()) return renderStudentPIAR();
    document.getElementById("viewRoot").innerHTML = `
        <div class="students-topbar">
            <input id="piarSearch" type="text" class="search-input" placeholder="Buscar PIAR por estudiante, docente, estado o periodo..." data-oninput="filterPIAR()">
            ${canCreatePIAR() ? `<button class="btn-modern add-btn" data-onclick="openPIARModal()">
                <i class="bi bi-journal-plus"></i>
                Nuevo PIAR / PR
            </button>` : ""}
        </div>
        <div id="piarGrid" class="piar-grid">
            ${piarCards(state.piars)}
        </div>
    `;
}

function renderReports() {
    document.getElementById("viewRoot").innerHTML = `
        <div class="report-builder">
            <div class="table-card">
                <div class="form-grid">
                    <label>
                        Tipo de reporte
                        <select id="reportType" class="input-modern">
                            ${state.reportTypes.map(type => `<option>${escapeHTML(type)}</option>`).join("")}
                        </select>
                    </label>
                    <label>
                        Estudiante
                        <select id="reportStudent" class="input-modern">
                            <option value="all">Todos</option>
                        ${state.students.map(student => `<option value="${Number(student.id)}">${escapeHTML(fullName(student))}</option>`).join("")}
                        </select>
                    </label>
                    <label>
                        Periodo
                        <input id="reportPeriod" class="input-modern" value="${escapeHTML(state.institution.year)}">
                    </label>
                    <label>
                        PIAR a guardar
                        <select id="reportPiar" class="input-modern">
                            <option value="">Selecciona un PIAR</option>
                            ${reportPiarOptions()}
                        </select>
                    </label>
                    <label>
                        Fecha
                        <input id="reportDate" type="date" class="input-modern" value="${today()}">
                    </label>
                </div>
                <div class="action-row">
                    <button class="btn-modern small-btn" data-onclick="generateReport()">Generar reporte</button>
                    <button class="table-btn" data-onclick="printReport()">Imprimir / guardar PDF</button>
                    <button class="table-btn" type="button" data-onclick="saveCurrentReport()">Guardar informe del PIAR</button>
                </div>
            </div>
            <div id="reportOutput" class="report-output">
                ${buildReportHTML("Seguimiento individual", "all", state.institution.year, today())}
            </div>
            <div class="table-card">
                <div class="table-header"><h3>Informes guardados</h3></div>
                <div id="savedReports"></div>
            </div>
        </div>
    `;
    loadSavedReports();
}

function renderSettings() {
    document.getElementById("viewRoot").innerHTML = `
        <div class="table-card">
            <div class="table-header">
                <h3>Datos institucionales</h3>
                <button class="btn-modern small-btn" data-onclick="saveSettings()">Guardar cambios</button>
            </div>
            <div class="form-grid">
                <label>Institución <input class="input-modern" value="${escapeHTML(state.institution.name)}" readonly></label>
                <label>Sede <input id="institutionSede" class="input-modern" value="${escapeHTML(state.institution.sede)}"></label>
                <label>Municipio <input id="institutionMunicipio" class="input-modern" value="${escapeHTML(state.institution.municipio)}"></label>
                <label>Departamento <input id="institutionDepartment" class="input-modern" value="${escapeHTML(state.institution.department)}"></label>
                <label>Responsable <input id="institutionTeacher" class="input-modern" value="${escapeHTML(state.institution.teacher)}"></label>
                <label>Vigencia <input id="institutionYear" class="input-modern" value="${escapeHTML(state.institution.year)}"></label>
            </div>
        </div>

        <div class="table-card maintenance-card">
            <h3>Mantenimiento</h3>
            <p class="dashboard-subtitle">La configuración de presentación se guarda en este navegador. La información institucional se consulta desde el servidor.</p>
        </div>
    `;
}

function statCard(icon, number, label, color, action) {
    return `
        <button class="stat-card stat-action" data-onclick="${action}" type="button">
            <div class="stat-icon ${color}"><i class="bi ${icon}"></i></div>
            <h3>${number}</h3>
            <p>${label}</p>
        </button>
    `;
}

function studentCards(students) {
    if (!students.length) {
        return emptyState("No hay estudiantes con ese criterio.");
    }

    return students.map(student => `
        <div class="student-card">
            <div class="student-avatar">${escapeHTML(initials(fullName(student)))}</div>
            <h3>${escapeHTML(fullName(student))}</h3>
            <p>${escapeHTML(student.grado)} | ${escapeHTML(student.discapacidad)}</p>
            <span class="student-status ${statusClass(student.estado)}">${escapeHTML(labelStatus(student.estado))}</span>
            <div class="student-meta">
                <strong>Diagnostico:</strong>
                <span>${escapeHTML(student.condicion_especial || student.discapacidad)}</span>
            </div>
            <div class="student-actions">
                    <button class="table-btn" data-onclick="viewStudent(${Number(student.id)})">Ver</button>
                    ${canManageStudentTeacherProfiles() ? `<button class="table-btn" data-onclick="openStudentModal(${Number(student.id)})">Editar</button>` : ""}
            </div>
        </div>
    `).join("");
}

function teacherCards(teachers) {
    if (!teachers.length) {
        return emptyState("No hay docentes con ese criterio.");
    }

    return teachers.map(teacher => `
        <div class="student-card">
            <div class="student-avatar">${escapeHTML(initials(fullTeacherName(teacher)))}</div>
            <h3>${escapeHTML(fullTeacherName(teacher))}</h3>
            <p>${escapeHTML(teacher.cargo)} | ${escapeHTML(teacher.area)}</p>
            <div class="student-meta">
                <strong>Correo:</strong>
                <span>${escapeHTML(teacher.correo)}</span>
            </div>
            <div class="student-actions">
                    <button class="table-btn" data-onclick="viewTeacher(${Number(teacher.id)})">Ver</button>
                    ${canManageStudentTeacherProfiles() ? `<button class="table-btn" data-onclick="openTeacherModal(${Number(teacher.id)})">Editar</button>` : ""}
            </div>
        </div>
    `).join("");
}

function piarCards(piars) {
    if (!piars.length) {
        return emptyState("No hay PIAR/PR con ese criterio.");
    }

    return piars.map(piar => {
        const student = getStudent(piar.studentId);
        const teacher = getTeacher(piar.teacherId);
        const progress = getPIARProgress(piar);

        return `
            <div class="piar-card">
                <div class="piar-top">
                    <h3>${escapeHTML(student ? fullName(student) : "Estudiante no asignado")}</h3>
                    <span class="piar-status ${statusClass(piar.estado)}">${escapeHTML(labelStatus(piar.estado))}</span>
                </div>
                <p>${escapeHTML(piar.objetivoGeneral)}</p>
                <div class="detail-list">
                    <span><strong>Docente:</strong> ${escapeHTML(teacher ? fullTeacherName(teacher) : "Sin asignar")}</span>
                    <span><strong>Periodo:</strong> ${escapeHTML(piar.periodo)}</span>
                    <span><strong>Revisión:</strong> ${escapeHTML(formatDisplayDate(piar.fechaRevision))}</span>
                </div>
                <div class="progress-section">
                    <div class="progress-info">
                        <span>Implementación</span>
                        <span>${progress}%</span>
                    </div>
                    <div class="progress-bar"><div class="progress-fill" style="width:${Number(progress) || 0}%"></div></div>
                </div>
                <div class="student-actions">
                    <button class="btn-modern small-btn" data-onclick="viewPIAR(${Number(piar.id)})">Ver PIAR</button>
                    ${canCreateObservations() && piar.estado !== "cerrado" ? `<button class="table-btn" data-onclick="openObservationModal(${Number(piar.id)})">Observación</button>` : ""}
                </div>
            </div>
        `;
    }).join("");
}

function recentObservationsTable() {
    const observations = state.piars.flatMap(piar => piar.observaciones.map(obs => ({
        ...obs,
        piar,
        student: getStudent(piar.studentId)
    }))).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 6);

    if (!observations.length) {
        return emptyState("Aún no hay observaciones registradas.");
    }

    return `
        <table class="modern-table">
            <thead>
                <tr><th>Fecha</th><th>Estudiante</th><th>Tipo</th><th>Avance</th><th>Nota</th></tr>
            </thead>
            <tbody>
                ${observations.map(obs => `
                    <tr>
                        <td>${escapeHTML(formatDisplayDate(obs.fecha))}</td>
                        <td>${escapeHTML(obs.student ? fullName(obs.student) : "Sin estudiante")}</td>
                        <td>${escapeHTML(obs.tipo)}</td>
                        <td>${escapeHTML(obs.avance)}%</td>
                        <td>${escapeHTML(obs.nota)}</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

function alertsTable() {
    const alerts = state.piars.filter(piar => piar.estado === "revision" || isReviewDue(piar.fechaRevision));

    if (!alerts.length) {
        return emptyState("No hay PIAR con revisión pendiente.");
    }

    return `
        <table class="modern-table">
            <thead>
                <tr><th>Estudiante</th><th>Estado</th><th>Fecha de revisión</th><th>Responsable</th></tr>
            </thead>
            <tbody>
                ${alerts.map(piar => {
                    const student = getStudent(piar.studentId);
                    const teacher = getTeacher(piar.teacherId);
                    return `
                        <tr>
                            <td>${escapeHTML(student ? fullName(student) : "Sin estudiante")}</td>
                            <td><span class="badge-active ${statusClass(piar.estado)}">${escapeHTML(labelStatus(piar.estado))}</span></td>
                            <td>${escapeHTML(formatDisplayDate(piar.fechaRevision))}</td>
                            <td>${escapeHTML(teacher ? fullTeacherName(teacher) : "Sin asignar")}</td>
                        </tr>
                    `;
                }).join("")}
            </tbody>
        </table>
    `;
}

function openStudentModal(studentId = null) {
    if (!canManageStudentTeacherProfiles()) return showToastMessage("No tiene permiso para administrar estudiantes.", "warning");
    const student = studentId ? getStudent(studentId) : null;
    const title = student ? "Editar estudiante" : "Nuevo estudiante";

    openModal(title, `
        <form data-onsubmit="saveStudent(event, ${Number(studentId) || "null"})" class="modal-form">
            <div class="form-grid">
                <div><label for="studentNombres">Nombres</label><input id="studentNombres" name="nombres" class="input-modern" placeholder="Nombres" value="${escapeHTML(student?.nombres || "")}" required></div>
                <div><label for="studentApellidos">Apellidos</label><input id="studentApellidos" name="apellidos" class="input-modern" placeholder="Apellidos" value="${escapeHTML(student?.apellidos || "")}" required></div>
                <div><label for="studentDocumento">Documento</label><input id="studentDocumento" name="documento" class="input-modern" placeholder="Documento" value="${escapeHTML(student?.documento || "")}" required></div>
                <div><label for="studentFechaNacimiento">Fecha de nacimiento</label><input id="studentFechaNacimiento" name="fechaNacimiento" type="date" class="input-modern" value="${escapeHTML(student?.fechaNacimiento || "")}"></div>
                <div><label for="studentGrado">Grado</label><select id="studentGrado" name="grado" class="input-modern">${options(state.grados, student?.grado)}</select></div>
                <div><label for="studentJornada">Jornada</label><input id="studentJornada" name="jornada" class="input-modern" placeholder="Jornada" value="${escapeHTML(student?.jornada || "")}"></div>
                <div><label for="studentDiscapacidad">Discapacidad</label><select id="studentDiscapacidad" name="discapacidad" class="input-modern">${options(state.discapacidades, student?.discapacidad)}</select></div>
                <div><label for="studentEstado">Estado</label><select id="studentEstado" name="estado" class="input-modern">${options(["activo", "revision", "cerrado", "inactivo"], student?.estado)}</select></div>
                <div><label for="studentAcudiente">Acudiente</label><input id="studentAcudiente" name="acudiente" class="input-modern" placeholder="Acudiente" value="${escapeHTML(student?.acudiente || "")}"></div>
                <div><label for="studentTelefono">Teléfono</label><input id="studentTelefono" name="telefono" class="input-modern" placeholder="Teléfono" value="${escapeHTML(student?.telefono || "")}"></div>
            </div>
            <div class="form-field"><label for="studentCondicionEspecial">Necesidades o características relevantes</label><textarea id="studentCondicionEspecial" name="condicion_especial" class="input-modern" placeholder="Opcional, no requiere diagnóstico médico">${escapeHTML(student?.condicion_especial || "")}</textarea></div>
            <div class="form-field"><label for="studentContexto">Contexto familiar y social</label><textarea id="studentContexto" name="contexto" class="input-modern" placeholder="Contexto familiar y social">${escapeHTML(student?.contexto || "")}</textarea></div>
            <div class="form-field"><label for="studentValoracion">Valoración pedagógica</label><textarea id="studentValoracion" name="valoracion" class="input-modern" placeholder="Valoración pedagógica">${escapeHTML(student?.valoracion || "")}</textarea></div>
            <div class="form-field"><label for="studentFortalezas">Fortalezas</label><textarea id="studentFortalezas" name="fortalezas" class="input-modern" placeholder="Separadas por coma">${escapeHTML((student?.fortalezas || []).join(", "))}</textarea></div>
            <div class="form-field"><label for="studentBarreras">Barreras</label><textarea id="studentBarreras" name="barreras" class="input-modern" placeholder="Separadas por coma">${escapeHTML((student?.barreras || []).join(", "))}</textarea></div>
            <div class="form-field"><label for="studentApoyos">Apoyos requeridos</label><textarea id="studentApoyos" name="apoyosRequeridos" class="input-modern" placeholder="Separados por coma">${escapeHTML((student?.apoyosRequeridos || []).join(", "))}</textarea></div>
            <div class="form-field"><label for="studentActividadesCasa">Actividades recomendadas en casa</label><textarea id="studentActividadesCasa" name="actividadesCasa" class="input-modern" placeholder="Actividades recomendadas en casa">${escapeHTML(student?.actividadesCasa || "")}</textarea></div>
            <button class="btn-modern" type="submit">Guardar estudiante</button>
        </form>
    `);
}

async function saveStudent(event, studentId) {
    if (!canManageStudentTeacherProfiles()) return showToastMessage("No tiene permiso para administrar estudiantes.", "warning");
    event.preventDefault();
    const data = formData(event.target);
    const payload = {
        ...data,
        id: studentId || nextId(state.students),
        fortalezas: splitList(data.fortalezas),
        barreras: splitList(data.barreras),
        apoyosRequeridos: splitList(data.apoyosRequeridos)
    };

    try {
        const result = studentId
            ? await apiUpdate("students", studentId, payload)
            : await apiCreate("students", payload);
        const savedStudent = result.data || result;
        if (studentId) {
            state.students = state.students.map(student => student.id === studentId ? { ...student, ...payload, ...savedStudent } : student);
        } else {
            state.students.push({ ...payload, ...savedStudent, id: savedStudent.id || savedStudent.id_estudiante });
        }
    } catch (error) {
        showToastMessage(error.message, "warning");
        return;
    }

    closeModal();
    renderApp("students");
    showToastMessage("Estudiante guardado correctamente.");
}

function openTeacherModal(teacherId = null) {
    if (!canManageStudentTeacherProfiles()) return showToastMessage("No tiene permiso para administrar perfiles docentes.", "warning");
    const teacher = teacherId ? getTeacher(teacherId) : null;
    openModal(teacher ? "Editar docente" : "Nuevo docente", `
        <form data-onsubmit="saveTeacher(event, ${Number(teacherId) || "null"})" class="modal-form">
            <div class="form-grid">
                <div><label for="teacherNombres">Nombres</label><input name="nombres" id="teacherNombres" class="input-modern" placeholder="Nombres" value="${escapeHTML(teacher?.nombres || "")}" required></div>
                <div><label for="teacherApellidos">Apellidos</label><input name="apellidos" id="teacherApellidos" class="input-modern" placeholder="Apellidos" value="${escapeHTML(teacher?.apellidos || "")}" required></div>
                <div><label for="teacherDocumento">Documento</label><input name="documento" id="teacherDocumento" class="input-modern" placeholder="Documento" value="${escapeHTML(teacher?.documento || "")}"></div>
                <div><label for="teacherCargo">Cargo</label><input name="cargo" id="teacherCargo" class="input-modern" placeholder="Cargo" value="${escapeHTML(teacher?.cargo || "")}"></div>
                <div><label for="teacherArea">Área</label><input name="area" id="teacherArea" class="input-modern" placeholder="Área" value="${escapeHTML(teacher?.area || "")}" required></div>
                <div><label for="teacherCorreo">Correo</label><input name="correo" id="teacherCorreo" type="email" class="input-modern" placeholder="Correo" value="${escapeHTML(teacher?.correo || "")}"></div>
                <div><label for="teacherTelefono">Teléfono</label><input name="telefono" id="teacherTelefono" class="input-modern" placeholder="Teléfono" value="${escapeHTML(teacher?.telefono || "")}"></div>
                <div><label for="teacherEstado">Estado</label><select name="estado" id="teacherEstado" class="input-modern">${options(["activo", "inactivo"], teacher?.estado || "activo")}</select></div>
            </div>
            <div class="form-field"><label for="teacherPerfil">Perfil, funciones y responsabilidades</label><textarea name="perfil" id="teacherPerfil" class="input-modern" placeholder="Perfil, funciones y responsabilidades">${escapeHTML(teacher?.perfil || "")}</textarea></div>
            <button class="btn-modern" type="submit">Guardar docente</button>
        </form>
    `);
}

async function saveTeacher(event, teacherId) {
    if (!canManageStudentTeacherProfiles()) return showToastMessage("No tiene permiso para administrar perfiles docentes.", "warning");
    event.preventDefault();
    const fields = formData(event.target);
    // El nombre completo (docente.nombre) se mantiene sincronizado con nombres y apellidos.
    const fullName = [fields.nombres, fields.apellidos].map(value => String(value || "").trim()).filter(Boolean).join(" ");
    const payload = { ...fields, ...(fullName ? { nombre: fullName } : {}), id: teacherId || nextId(state.teachers) };

    try {
        const result = teacherId
            ? await apiUpdate("teachers", teacherId, payload)
            : await apiCreate("teachers", payload);
        const savedTeacher = result.data || result;
        if (teacherId) {
            state.teachers = state.teachers.map(teacher => teacher.id === teacherId ? { ...teacher, ...payload, ...savedTeacher } : teacher);
        } else {
            state.teachers.push({ ...payload, ...savedTeacher, id: savedTeacher.id_docente || savedTeacher.id });
        }
    } catch (error) {
        showToastMessage(error.message, "warning");
        return;
    }

    closeModal();
    renderApp("teachers");
    showToastMessage("Docente guardado correctamente.");
}

function openPIARModal() {
    const isTeacher = currentSessionUser?.rol === "Docente";
    const assignedTeacher = isTeacher ? state.teachers[0] : null;
    openModal("Nuevo PIAR / PR", `
        <form data-onsubmit="savePIAR(event)" class="modal-form">
            <div class="form-grid">
                <div><label for="piarStudent">Estudiante</label><select name="studentId" id="piarStudent" class="input-modern" required>
                    <option value="">Selecciona estudiante</option>
                    ${state.students.map(student => `<option value="${Number(student.id)}">${escapeHTML(fullName(student))}</option>`).join("")}
                </select></div>
                ${isTeacher
                    ? `<input type="hidden" name="teacherId" value="${Number(assignedTeacher?.id || 0)}">`
                    : `<div><label for="piarTeacher">Docente responsable</label><select name="teacherId" id="piarTeacher" class="input-modern" required>
                    <option value="">Selecciona docente</option>
                    ${state.teachers.map(teacher => `<option value="${Number(teacher.id)}">${escapeHTML(fullTeacherName(teacher))}</option>`).join("")}
                </select></div>`}
                <div><label for="piarCreatedAt">Fecha de creación</label><input name="fechaCreacion" id="piarCreatedAt" type="date" class="input-modern" value="${today()}" required></div>
                <div><label for="piarReviewAt">Fecha de revisión</label><input name="fechaRevision" id="piarReviewAt" type="date" class="input-modern" required></div>
                <div><label for="piarState">Estado</label><select name="estado" id="piarState" class="input-modern">${options(["activo", "revision", "cerrado"], "activo")}</select></div>
                <div><label for="piarPeriod">Periodo</label><input name="periodo" id="piarPeriod" class="input-modern" placeholder="Periodo" value="${escapeHTML(state.institution.year)}"></div>
            </div>
            <div class="form-field"><label for="piarObjective">Objetivo general</label><textarea name="objetivoGeneral" id="piarObjective" class="input-modern" placeholder="Objetivo general" required></textarea></div>
            <div class="form-field"><label for="piarGoals">Metas de aprendizaje y participación</label><textarea name="metas" id="piarGoals" class="input-modern" placeholder="Metas de aprendizaje y participación"></textarea></div>
            <div class="form-field"><label for="piarCharacterization">Valoración pedagógica</label><textarea name="caracterizacion" id="piarCharacterization" class="input-modern" placeholder="Capacidades, intereses, formas de aprender y participación"></textarea></div>
            <div class="form-field"><label for="piarBarriers">Barreras para el aprendizaje y la participación</label><textarea name="barreras" id="piarBarriers" class="input-modern" placeholder="Barreras observadas"></textarea></div>
            <div class="form-field"><label for="piarHealth">Informes de salud o valoraciones aportadas</label><textarea name="informesSalud" id="piarHealth" class="input-modern" placeholder="Informes de salud o valoraciones aportadas"></textarea></div>
            <div class="form-field"><label for="piarProjects">Proyectos o actividades institucionales</label><textarea name="proyectos" id="piarProjects" class="input-modern" placeholder="Proyectos o actividades institucionales vinculadas"></textarea></div>
            <div class="form-field"><label for="piarRecess">Continuidad durante recesos escolares</label><textarea name="actividadesReceso" id="piarRecess" class="input-modern" placeholder="Actividades y apoyos durante recesos escolares"></textarea></div>
            <div class="form-field"><label for="piarOther">Otra información relevante</label><textarea name="otraInformacion" id="piarOther" class="input-modern" placeholder="Otra información relevante para el aprendizaje y la participación"></textarea></div>
            <div class="form-field"><label for="piarAgreements">Acta de acuerdos y compromisos</label><textarea name="actaAcuerdos" id="piarAgreements" class="input-modern" placeholder="Acuerdos y compromisos de los actores participantes"></textarea></div>
            <div class="form-field"><label for="piarAnnual">Informe anual</label><textarea name="informeAnual" id="piarAnnual" class="input-modern" placeholder="Informe anual de proceso pedagógico o competencias"></textarea></div>
            <div class="form-field"><label for="piarHandover">Entrega pedagógica</label><textarea name="entregaPedagogica" id="piarHandover" class="input-modern" placeholder="Entrega pedagógica para continuidad entre grados y periodos"></textarea></div>
            <h4>Ajuste inicial</h4>
            <div class="form-grid">
                <div><label for="piarAdjArea">Área</label><input name="area" id="piarAdjArea" class="input-modern" placeholder="Área" required></div>
                <div><label for="piarAdjType">Tipo de ajuste</label><input name="tipo" id="piarAdjType" class="input-modern" placeholder="Tipo de ajuste" required></div>
                <div><label for="piarAdjOwner">Responsable complementario</label><input name="responsable" id="piarAdjOwner" class="input-modern" placeholder="Responsable complementario" value="${escapeHTML(currentSessionUser?.nombre || "")}"></div>
                <div><label for="piarAdjProgress">Avance (%)</label><input name="avance" id="piarAdjProgress" type="number" min="0" max="100" class="input-modern" placeholder="Avance %" value="0"></div>
            </div>
            <div class="form-field"><label for="piarAdjStrategy">Estrategia pedagógica</label><textarea name="estrategia" id="piarAdjStrategy" class="input-modern" placeholder="Estrategia pedagógica" required></textarea></div>
            <div class="form-field"><label for="piarAdjResources">Recursos y apoyos</label><textarea name="recursos" id="piarAdjResources" class="input-modern" placeholder="Recursos y apoyos"></textarea></div>
            <div class="form-field"><label for="piarAdjExpected">Resultado esperado del ajuste</label><textarea name="resultadoEsperado" id="piarAdjExpected" class="input-modern" placeholder="Resultado esperado del ajuste" required></textarea></div>
            <div class="form-field"><label for="piarAdjIndicator">Indicador de logro (opcional)</label><textarea name="indicadorLogro" id="piarAdjIndicator" class="input-modern" placeholder="Indicador de logro"></textarea></div>
            <div class="form-field"><label for="piarAdjReview">Revisión prevista</label><input name="fechaRevisionAjuste" id="piarAdjReview" type="date" class="input-modern" value="${today()}" required></div>
            <button class="btn-modern" type="submit">Crear PIAR / PR</button>
        </form>
    `);
}

async function savePIAR(event) {
    event.preventDefault();
    const data = formData(event.target);
    const payload = {
        id_estudiante: Number(data.studentId),
        id_docente: Number(data.teacherId),
        es_responsable_principal: true,
        titulo: `PIAR ${data.periodo}`,
        periodo: data.periodo,
        anio: Number(state.institution.year),
        estado: data.estado,
        objetivo_general: data.objetivoGeneral,
        metas: data.metas,
        informes_salud: data.informesSalud,
        proyectos: data.proyectos,
        actividades_receso: data.actividadesReceso,
        otra_informacion: data.otraInformacion,
        acta_acuerdos: data.actaAcuerdos,
        informe_anual: data.informeAnual,
        entrega_pedagogica: data.entregaPedagogica,
        fecha_revision: data.fechaRevision,
        caracterizacion: data.caracterizacion || null,
        barreras: data.barreras || null,
        estrategias: data.estrategias || null
    };

    payload.ajuste = data.area && data.tipo && data.estrategia ? {
        area: data.area,
        tipo: data.tipo,
        estrategia: data.estrategia,
        recursos: data.recursos || null,
        responsable: data.responsable || null,
        resultado_esperado: data.resultadoEsperado,
        indicador_logro: data.indicadorLogro || null,
        fecha_revision_prevista: data.fechaRevisionAjuste,
        avance: Number(data.avance || 0),
        estado: "activo"
    } : null;

    try {
        const result = await apiCreate("piar", payload);
        const savedPiar = result.data || result;
        const detail = await apiGetPiar(savedPiar.id_piar || savedPiar.id);
        const persistedPiar = detail.data;
        state.piars.push({
            ...persistedPiar,
            id: persistedPiar.id_piar,
            studentId: persistedPiar.id_estudiante,
            teacherId: persistedPiar.docentes?.[0]?.id_docente || null,
            fechaCreacion: persistedPiar.fecha_creacion,
            fechaRevision: persistedPiar.fecha_revision,
            objetivoGeneral: persistedPiar.objetivo_general,
            informesSalud: persistedPiar.informes_salud,
            ajustes: persistedPiar.ajustes || [],
            observaciones: persistedPiar.observaciones || []
        });
    } catch (error) {
        showToastMessage(error.message, "warning");
        return;
    }

    closeModal();
    renderApp("piar");
    showToastMessage("PIAR / PR creado correctamente.");
}

function openObservationModal(piarId = null) {
    if (!canCreateObservations()) return showToastMessage("No tiene permiso para registrar observaciones.", "warning");
    openModal("Nueva observación de seguimiento", `
        <form data-onsubmit="saveObservation(event)" class="modal-form">
            <select name="piarId" class="input-modern" required>
                <option value="">Selecciona PIAR / PR</option>
                ${state.piars.filter(piar => piar.estado !== "cerrado").map(piar => {
                    const student = getStudent(piar.studentId);
                    return `<option value="${Number(piar.id)}" ${piar.id === piarId ? "selected" : ""}>${escapeHTML(student ? fullName(student) : "Sin estudiante")} - ${escapeHTML(piar.periodo)}</option>`;
                }).join("")}
            </select>
            <div class="form-grid">
                <input name="fecha" type="date" class="input-modern" value="${today()}" required>
                <select name="tipo" class="input-modern">${options(["Seguimiento", "Alerta", "Avance", "Reunion familiar", "Comite"], "Seguimiento")}</select>
                <input name="autor" class="input-modern" placeholder="Autor" value="${escapeHTML(state.institution.teacher)}" required>
                <input name="avance" type="number" min="0" max="100" class="input-modern" placeholder="Avance %" required>
            </div>
            <textarea name="nota" class="input-modern" placeholder="Observación, acuerdos o compromisos" required></textarea>
            <button class="btn-modern" type="submit">Guardar observación</button>
        </form>
    `);
}

async function saveObservation(event) {
    event.preventDefault();
    const data = formData(event.target);
    const piar = state.piars.find(item => item.id === Number(data.piarId));
    const student = piar ? getStudent(piar.studentId) : null;
    try {
        await apiCreate("observations", {
            id_piar: Number(data.piarId),
            id_estudiante: student?.id || null,
            fecha: data.fecha,
            tipo: data.tipo,
            docente_responsable: data.autor,
            descripcion: data.nota,
            avance: Number(data.avance)
        });
    } catch (error) {
        showToastMessage(error.message, "warning");
        return;
    }

    if (piar) {
        piar.observaciones.push({
            id: nextId(piar.observaciones),
            fecha: data.fecha,
            tipo: data.tipo,
            autor: data.autor,
            nota: data.nota,
            avance: Number(data.avance)
        });
    }

    closeModal();
    renderApp(currentView);
    showToastMessage("Observación registrada.");
}

function viewStudent(studentId) {
    const student = getStudent(studentId);
    const piar = state.piars.find(item => item.studentId === studentId);

    openModal("Perfil del estudiante", `
        <div class="student-profile">
            <div class="student-avatar large-avatar">${escapeHTML(initials(fullName(student)))}</div>
            <h2>${escapeHTML(fullName(student))}</h2>
            <p>${escapeHTML(student.grado)} | ${escapeHTML(student.discapacidad)} | ${escapeHTML(labelStatus(student.estado))}</p>
            <div class="profile-info">
                ${infoCard("Documento", student.documento)}
                ${infoCard("Acudiente", `${student.acudiente} - ${student.telefono}`)}
                ${infoCard("Necesidades o características relevantes", student.condicion_especial)}
                ${infoCard("Valoración pedagógica", student.valoracion)}
                ${infoCard("Fortalezas", student.fortalezas.join(", "))}
                ${infoCard("Barreras", student.barreras.join(", "))}
                ${infoCard("Apoyos", student.apoyosRequeridos.join(", "))}
                ${infoCard("PIAR vinculado", piar ? `${piar.periodo} - ${labelStatus(piar.estado)}` : "Pendiente por crear")}
            </div>
        </div>
    `);
}

function viewTeacher(teacherId) {
    const teacher = getTeacher(teacherId);
    const assigned = state.piars.filter(piar => piar.teacherId === teacherId).length;

    openModal("Perfil docente", `
        <div class="student-profile">
            <div class="student-avatar large-avatar">${escapeHTML(initials(fullTeacherName(teacher)))}</div>
            <h2>${escapeHTML(fullTeacherName(teacher))}</h2>
            <p>${escapeHTML(teacher.cargo)} | ${escapeHTML(teacher.area)}</p>
            <div class="profile-info">
                ${infoCard("Documento", teacher.documento)}
                ${infoCard("Correo", teacher.correo)}
                ${infoCard("Teléfono", teacher.telefono)}
                ${infoCard("PIAR asignados", assigned)}
                ${infoCard("Perfil", teacher.perfil)}
            </div>
        </div>
    `);
}

function viewPIAR(piarId) {
    if (isStudentSession()) return viewOwnPIAR(piarId);
    const piar = state.piars.find(item => item.id === piarId);
    const student = getStudent(piar.studentId);
    const teacher = getTeacher(piar.teacherId);

    openModal("Documento PIAR / PR", `
        <div class="piar-detail">
            <div class="student-avatar large-avatar">${escapeHTML(initials(fullName(student)))}</div>
            <h2>${escapeHTML(fullName(student))}</h2>
            <p>${escapeHTML(piar.periodo)} | ${escapeHTML(labelStatus(piar.estado))} | Avance ${getPIARProgress(piar)}%</p>
            ${piarActionBar(piar)}
            <div class="profile-info">
                ${infoCard("Docente responsable", teacher ? fullTeacherName(teacher) : "Sin asignar")}
                ${infoCard("Fecha de revisión", formatDisplayDate(piar.fechaRevision))}
                ${infoCard("Objetivo general", piar.objetivoGeneral)}
                ${infoCard("Contexto general", student.contexto)}
                ${infoCard("Valoración pedagógica del estudiante", student.valoracion)}
                ${infoCard("Metas", piar.metas)}
                ${infoCard("Valoración pedagógica", piar.caracterizacion)}
                ${infoCard("Barreras identificadas", piar.barreras_texto)}
                ${infoCard("Estrategias de aula", piar.estrategias)}
                ${infoCard("Informes aportados", piar.informesSalud)}
                ${infoCard("Proyectos", piar.proyectos)}
                ${infoCard("Continuidad durante recesos", piar.actividades_receso)}
                ${infoCard("Otra información relevante", piar.otra_informacion)}
                ${infoCard("Acta de acuerdos y compromisos", piar.acta_acuerdos)}
                ${infoCard("Informe anual", piar.informe_anual)}
                ${infoCard("Entrega pedagógica", piar.entrega_pedagogica)}
            </div>
            ${duaSection(piar)}
            <h3 class="section-title">Ajustes razonables</h3>
            <div class="info-card wide-info">
                <h4>Barreras identificadas en contexto</h4>
                ${(piar.barreras || []).map(barrier => `
                    <p><strong>${escapeHTML(barrier.contexto)} · ${escapeHTML(barrier.fecha_identificacion)}</strong>: ${escapeHTML(barrier.descripcion)}</p>
                    ${barrier.actividad ? `<p><strong>Actividad:</strong> ${escapeHTML(barrier.actividad)}</p>` : ""}
                    ${barrier.condicion_entorno ? `<p><strong>Condición del entorno:</strong> ${escapeHTML(barrier.condicion_entorno)}</p>` : ""}
                    <small>Registrada por ${escapeHTML(barrier.autor_nombre || "usuario institucional")}</small>
                `).join("") || emptyState("Aún no hay barreras estructuradas. Se conserva el texto legado mostrado en el resumen del PIAR.")}
                ${canEditPiarTrace(piar.id) ? `<button class="table-btn" type="button" data-onclick="openBarrierModal(${Number(piar.id)})">Registrar barrera</button>` : ""}
            </div>
            ${piar.ajustes.map(ajuste => `
                <div class="info-card wide-info">
                    <h4>${escapeHTML(ajuste.area)} - ${escapeHTML(ajuste.tipo)}</h4>
                    ${ajuste.id_barrera ? `<p><strong>Barrera asociada:</strong> ${escapeHTML((piar.barreras || []).find(item => Number(item.id_barrera) === Number(ajuste.id_barrera))?.descripcion || "Sin descripción")}</p>` : ""}
                    <p><strong>Estrategia:</strong> ${escapeHTML(ajuste.estrategia)}</p>
                    <p><strong>Recursos:</strong> ${escapeHTML(ajuste.recursos)}</p>
                    <p><strong>Responsable:</strong> ${escapeHTML(ajuste.responsable_usuario_nombre || ajuste.responsable || "Sin responsable identificado")}</p>
                    ${ajuste.resultado_esperado ? `<p><strong>Resultado esperado:</strong> ${escapeHTML(ajuste.resultado_esperado)}</p>` : ""}
                    ${ajuste.indicador_logro ? `<p><strong>Indicador de logro:</strong> ${escapeHTML(ajuste.indicador_logro)}</p>` : ""}
                    ${ajuste.fecha_revision_prevista ? `<p><strong>Revisión prevista:</strong> ${escapeHTML(ajuste.fecha_revision_prevista)}</p>` : ""}
                    <p><strong>Avance:</strong> ${escapeHTML(ajuste.avance)}%</p>
                    ${(ajuste.evidencias || []).map(evidence => `<p><strong>Evidencia · ${escapeHTML(evidence.fecha)}:</strong> ${escapeHTML(evidence.descripcion)}${evidence.referencia ? ` (${escapeHTML(evidence.referencia)})` : ""} <small>por ${escapeHTML(evidence.autor_nombre || "usuario")}</small></p>`).join("")}
                    ${canEditPiarTrace(piar.id) ? `<button class="table-btn" type="button" data-onclick="openEvidenceModal(${Number(piar.id)}, ${Number(ajuste.id_ajuste)})">Registrar evidencia</button><button class="table-btn" type="button" data-onclick="openAdjustmentFollowUpModal(${Number(piar.id)}, ${Number(ajuste.id_ajuste)})">Registrar seguimiento</button>` : ""}
                </div>
            `).join("")}
            ${canEditPiarTrace(piar.id) ? `<button class="table-btn" type="button" data-onclick="openAdjustmentModal(${Number(piar.id)})">Registrar ajuste razonable</button>` : ""}
            <div class="section-heading-row">
                <h3 class="section-title">Diagnósticos</h3>
                ${canCreateDiagnostics() && piar.estado !== "cerrado" ? `<button class="table-btn" type="button" data-onclick="openDiagnosticModal(${Number(piar.id)})">Nuevo diagnóstico</button>` : ""}
            </div>
            ${diagnosticCards(piar.diagnosticos || [], piar.estado !== "cerrado")}
            <h3 class="section-title">Observaciones</h3>
            ${piar.observaciones.map(obs => `
                <div class="info-card wide-info">
                    <h4>${escapeHTML(formatDisplayDate(obs.fecha))} | ${escapeHTML(obs.tipo)} | ${escapeHTML(obs.avance)}%</h4>
                    <p>${escapeHTML(obs.nota)}</p>
                    <small>${escapeHTML(obs.autor)}</small>
                </div>
            `).join("") || emptyState("Este PIAR aún no tiene observaciones.")}
            <h3 class="section-title">Seguimientos</h3>
            ${(piar.seguimientos || []).map(item => `
                <div class="info-card wide-info">
                    <h4>${escapeHTML(formatDisplayDate(item.fecha))} | ${escapeHTML(item.estado || "Seguimiento")}</h4>
                    <p>${escapeHTML(item.descripcion)}</p>
                    ${item.evolucion ? `<p><strong>Avances:</strong> ${escapeHTML(item.evolucion)}</p>` : ""}
                    ${item.acuerdos ? `<p><strong>Acuerdos:</strong> ${escapeHTML(item.acuerdos)}</p>` : ""}
                    ${item.responsable_usuario_nombre ? `<small>Responsable: ${escapeHTML(item.responsable_usuario_nombre)}</small>` : ""}
                </div>
            `).join("") || emptyState("Este PIAR aún no tiene seguimientos.")}
            <h3 class="section-title">Historia escolar y entrega pedagógica</h3>
            ${(piar.historial || []).map(item => `
                <div class="info-card wide-info">
                    <h4>${escapeHTML(item.created_at || "Evento registrado")}</h4>
                    <p>${escapeHTML(item.tipo_registro || "Actualización pedagógica")}</p>
                </div>
            `).join("") || emptyState("La historia escolar se registra en los seguimientos, informes anuales y entregas pedagógicas asociados a este PIAR.")}
            <section class="piar-version-history" id="piarVersionHistory" data-piar-id="${Number(piar.id)}" aria-live="polite">
                <h3 class="section-title">Versiones del PIAR</h3>
                <p id="piarVersionHistoryStatus" class="version-history-status">Cargando historial…</p>
                <div id="piarVersionHistoryContent"></div>
            </section>
        </div>
    `);
    loadPiarVersionHistory(Number(piar.id));
}

function formatVersionDate(value) {
    if (!value) return "Fecha no disponible";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function renderPiarVersionHistory(piarId, versions) {
    const container = document.getElementById("piarVersionHistoryContent");
    const status = document.getElementById("piarVersionHistoryStatus");
    if (!container || !status || Number(document.getElementById("piarVersionHistory")?.dataset.piarId) !== Number(piarId)) return;
    status.textContent = versions.length ? `${versions.length} versión${versions.length === 1 ? "" : "es"} disponible${versions.length === 1 ? "" : "s"}.` : "Este PIAR aún no tiene versiones registradas.";
    if (!versions.length) { container.innerHTML = ""; return; }
    const option = row => `<option value="${Number(row.version_id)}">${escapeHTML(formatVersionDate(row.fecha))} · ${escapeHTML(row.usuario || "Usuario institucional")} · ${escapeHTML(PiarVersionHistory.formatOperation(row.tipo_operacion))}</option>`;
    const sorted = [...versions].sort((a, b) => Number(b.version_id) - Number(a.version_id));
    container.innerHTML = `
        <div class="version-history-list">
            ${sorted.map(row => `
                <article class="info-card wide-info version-history-entry">
                    <h4>${escapeHTML(formatVersionDate(row.fecha))} · ${escapeHTML(PiarVersionHistory.formatOperation(row.tipo_operacion))}</h4>
                    <p><strong>Actor:</strong> ${escapeHTML(row.usuario || "Usuario institucional")}</p>
                    ${row.justificacion ? `<p><strong>Justificación:</strong> ${escapeHTML(row.justificacion)}</p>` : ""}
                </article>
            `).join("")}
        </div>
        <div class="version-compare-controls">
            <label for="piarVersionFirst">Versión anterior</label>
            <select id="piarVersionFirst" class="input-modern">${sorted.map(option).join("")}</select>
            <label for="piarVersionSecond">Versión para comparar</label>
            <select id="piarVersionSecond" class="input-modern">${sorted.map(option).join("")}</select>
            <button class="table-btn" type="button" data-onclick="comparePiarVersionSelection(${Number(piarId)})">Comparar versiones</button>
        </div>
        <div id="piarVersionCompareResult" class="version-compare-result" aria-live="polite"></div>
    `;
    if (sorted.length > 1) {
        document.getElementById("piarVersionFirst").selectedIndex = 1;
        document.getElementById("piarVersionSecond").selectedIndex = 0;
    }
}

async function loadPiarVersionHistory(piarId) {
    const status = document.getElementById("piarVersionHistoryStatus");
    if (!status) return;
    try {
        const versions = await PiarVersionHistory.loadVersions(piarId, apiGetPiarVersions);
        renderPiarVersionHistory(piarId, versions);
    } catch (error) {
        if (Number(document.getElementById("piarVersionHistory")?.dataset.piarId) !== Number(piarId)) return;
        const message = error.status === 403 ? "El servidor denegó el acceso al historial de este PIAR." : error.status === 404 ? "No se encontró este PIAR o su historial." : "No fue posible cargar el historial. Intenta de nuevo.";
        status.textContent = message;
        status.classList.add("version-history-error");
    }
}

function renderVersionChanges(changes) {
    if (!changes.length) return emptyState("No hay diferencias en los campos pedagógicos disponibles para comparación.");
    const labels = { added: "Agregado", modified: "Modificado", removed: "Eliminado" };
    return changes.map(change => `
        <article class="version-change version-change-${change.kind}">
            <strong>${escapeHTML(labels[change.kind])}: ${escapeHTML(change.path)}</strong>
            ${change.kind !== "added" ? `<p><span>Anterior:</span> ${escapeHTML(change.before || "(vacío)")}</p>` : ""}
            ${change.kind !== "removed" ? `<p><span>Actual:</span> ${escapeHTML(change.after || "(vacío)")}</p>` : ""}
        </article>
    `).join("");
}

async function comparePiarVersionSelection(piarId) {
    const result = document.getElementById("piarVersionCompareResult");
    const first = document.getElementById("piarVersionFirst")?.value;
    const second = document.getElementById("piarVersionSecond")?.value;
    if (!result) return;
    result.textContent = "Cargando comparación…";
    try {
        const comparison = await PiarVersionHistory.getComparison(piarId, first, second, apiGetPiarVersion);
        result.innerHTML = `<h4>${escapeHTML(formatVersionDate(comparison.left.fecha))} → ${escapeHTML(formatVersionDate(comparison.right.fecha))}</h4>${renderVersionChanges(comparison.changes)}`;
    } catch (error) {
        result.textContent = error.status === 403 ? "El servidor denegó el acceso a una de las versiones." : error.status === 404 ? "Una de las versiones no está disponible para este PIAR." : error.message || "No fue posible comparar las versiones.";
        result.classList.add("version-history-error");
    }
}

async function reloadPiarDetail(piarId) {
    await refreshPiarInState(piarId);
    viewPIAR(Number(piarId));
}

function beginTraceFormSubmission(event) {
    const form = event.currentTarget || event.target;
    if (!form || form.dataset.tracePending === "true") return null;
    form.dataset.tracePending = "true";
    form.setAttribute("aria-busy", "true");
    const button = form.querySelector("button[type=submit]");
    if (button) {
        button.dataset.originalText = button.textContent;
        button.disabled = true;
        button.textContent = "Guardando…";
    }
    const feedback = form.querySelector("[data-form-feedback]");
    if (feedback) { feedback.hidden = true; feedback.textContent = ""; }
    return form;
}

function validateTraceForm(form, requiredFields) {
    const feedback = form.querySelector("[data-form-feedback]");
    for (const [name, label] of requiredFields) {
        const control = form.elements.namedItem(name);
        if (!control || !String(control.value || "").trim()) {
            if (control) {
                control.setAttribute("aria-invalid", "true");
                control.focus();
            }
            if (feedback) {
                feedback.textContent = `${label} es obligatorio.`;
                feedback.hidden = false;
            }
            return false;
        }
        control.removeAttribute("aria-invalid");
    }
    return true;
}

function showTraceFormError(form, error) {
    const feedback = form?.querySelector("[data-form-feedback]");
    const message = error?.message || "No se pudo guardar la información. Revisa los datos e intenta de nuevo.";
    if (feedback && form.isConnected) {
        feedback.textContent = message;
        feedback.hidden = false;
    } else {
        showToastMessage(message, "warning");
    }
}

function endTraceFormSubmission(form) {
    if (!form) return;
    delete form.dataset.tracePending;
    form.removeAttribute("aria-busy");
    const button = form.querySelector("button[type=submit]");
    if (button) {
        button.disabled = false;
        if (button.dataset.originalText) button.textContent = button.dataset.originalText;
        delete button.dataset.originalText;
    }
}

function openBarrierModal(piarId) {
    if (!canEditPiarTrace(piarId)) return showToastMessage("No tienes permiso para editar este PIAR.", "warning");
    openModal("Registrar barrera del entorno", `
        <form class="modal-form" data-onsubmit="savePiarBarrier(event, ${Number(piarId)})">
            <p class="trace-form-feedback" data-form-feedback id="barrier-form-error" role="alert" hidden></p>
            <label for="barrierContext">Contexto</label><select id="barrierContext" class="input-modern" name="contexto" required>${options(["aula", "espacios_escolares", "hogar", "entorno_social", "institucional", "otro"], "aula")}</select>
            <label for="barrierDescription">Barrera observada</label><textarea id="barrierDescription" class="input-modern" name="descripcion" placeholder="Barrera observada para el aprendizaje o la participación" required maxlength="20000" aria-describedby="barrier-form-help barrier-form-error"></textarea>
            <label for="barrierActivity">Actividad o situación</label><textarea id="barrierActivity" class="input-modern" name="actividad" placeholder="Actividad o situación en la que aparece" maxlength="20000"></textarea>
            <label for="barrierEnvironment">Condición del entorno</label><textarea id="barrierEnvironment" class="input-modern" name="condicion_entorno" placeholder="Condición del entorno relacionada con la barrera" maxlength="20000"></textarea>
            <label for="barrierIdentifiedOn">Fecha de identificación</label><input id="barrierIdentifiedOn" class="input-modern" type="date" name="fecha_identificacion" value="${today()}" required aria-describedby="barrier-form-error">
            <small id="barrier-form-help">Describe la situación y el contexto observados.</small>
            <button class="btn-modern" type="submit">Guardar barrera</button>
        </form>`);
}

async function savePiarBarrier(event, piarId) {
    event.preventDefault();
    const form = beginTraceFormSubmission(event);
    if (!form) return;
    try {
        if (!canEditPiarTrace(piarId)) throw new Error("No tienes permiso para editar este PIAR.");
        if (!validateTraceForm(form, [["descripcion", "La descripción de la barrera"], ["fecha_identificacion", "La fecha de identificación"]])) return;
        await apiCreate(`piar/${Number(piarId)}/barreras`, formData(form));
        closeModal();
        await reloadPiarDetail(piarId);
        showToastMessage("Barrera registrada.");
    } catch (error) { showTraceFormError(form, error); }
    finally { endTraceFormSubmission(form); }
}

function openAdjustmentModal(piarId) {
    if (!canEditPiarTrace(piarId)) return showToastMessage("No tienes permiso para editar este PIAR.", "warning");
    const piar = state.piars.find(item => Number(item.id) === Number(piarId));
    const barrierOptions = (piar?.barreras || []).map(item => `<option value="${Number(item.id_barrera)}">${escapeHTML(item.contexto)}: ${escapeHTML(item.descripcion)}</option>`).join("");
    openModal("Registrar ajuste razonable", `
        <form class="modal-form" data-onsubmit="savePiarAdjustment(event, ${Number(piarId)})">
            <p class="trace-form-feedback" data-form-feedback id="adjustment-form-error" role="alert" hidden></p>
            <label for="adjustmentBarrier">Barrera relacionada</label><select id="adjustmentBarrier" class="input-modern" name="id_barrera"><option value="">Sin vínculo estructurado</option>${barrierOptions}</select>
            <div class="form-grid"><div><label for="adjustmentArea">Área</label><input id="adjustmentArea" class="input-modern" name="area" required maxlength="100" aria-describedby="adjustment-form-error"></div><div><label for="adjustmentType">Tipo de ajuste</label><input id="adjustmentType" class="input-modern" name="tipo" required maxlength="100" aria-describedby="adjustment-form-error"></div></div>
            <label for="adjustmentStrategy">Estrategia pedagógica</label><textarea id="adjustmentStrategy" class="input-modern" name="estrategia" required maxlength="20000" aria-describedby="adjustment-form-error"></textarea>
            <label for="adjustmentResources">Recursos requeridos</label><textarea id="adjustmentResources" class="input-modern" name="recursos" maxlength="20000"></textarea>
            <label for="adjustmentOutcome">Resultado esperado</label><textarea id="adjustmentOutcome" class="input-modern" name="resultado_esperado" required maxlength="20000" aria-describedby="adjustment-form-error"></textarea>
            <label for="adjustmentIndicator">Indicador de logro (opcional)</label><textarea id="adjustmentIndicator" class="input-modern" name="indicador_logro" maxlength="20000"></textarea>
            <label for="adjustmentReviewDate">Fecha prevista de revisión</label><input id="adjustmentReviewDate" class="input-modern" type="date" name="fecha_revision_prevista" value="${today()}" required aria-describedby="adjustment-form-error">
            <label for="adjustmentResponsibleName">Responsable institucional</label><input id="adjustmentResponsibleName" class="input-modern" value="${escapeHTML(currentSessionUser?.nombre || "Usuario actual")}" readonly aria-describedby="adjustmentResponsibleHelp">
            <small id="adjustmentResponsibleHelp">Quien registra el ajuste queda asignado como responsable. El servidor verifica que está activo y autorizado para este PIAR.</small>
            <input type="hidden" name="id_usuario_responsable" value="${Number(currentSessionUser?.id || 0)}">
            <button class="btn-modern" type="submit">Guardar ajuste</button>
        </form>`);
}

async function savePiarAdjustment(event, piarId) {
    event.preventDefault();
    const form = beginTraceFormSubmission(event);
    if (!form) return;
    try {
        if (!canEditPiarTrace(piarId)) throw new Error("No tienes permiso para editar este PIAR.");
        if (!validateTraceForm(form, [["area", "El área"], ["tipo", "El tipo de ajuste"], ["estrategia", "La estrategia"], ["resultado_esperado", "El resultado esperado"], ["fecha_revision_prevista", "La fecha prevista de revisión"]])) return;
        const data = formData(form);
        await apiCreate(`piar/${Number(piarId)}/ajustes`, { ...data, id_barrera: data.id_barrera || null, id_usuario_responsable: Number(data.id_usuario_responsable) || null });
        closeModal();
        await reloadPiarDetail(piarId);
        showToastMessage("Ajuste razonable registrado.");
    } catch (error) { showTraceFormError(form, error); }
    finally { endTraceFormSubmission(form); }
}

function openEvidenceModal(piarId, adjustmentId) {
    if (!canEditPiarTrace(piarId)) return showToastMessage("No tienes permiso para editar este PIAR.", "warning");
    openModal("Registrar evidencia del ajuste", `
        <form class="modal-form" data-onsubmit="savePiarEvidence(event, ${Number(piarId)}, ${Number(adjustmentId)})">
            <p class="trace-form-feedback" data-form-feedback id="evidence-form-error" role="alert" hidden></p>
            <label for="evidenceDescription">Descripción de la evidencia</label><textarea id="evidenceDescription" class="input-modern" name="descripcion" placeholder="Describe la evidencia observada o producida" required maxlength="20000" aria-describedby="evidence-form-error"></textarea>
            <label for="evidenceReference">Referencia externa (opcional)</label><input id="evidenceReference" class="input-modern" name="referencia" placeholder="No se carga ningún archivo" maxlength="500">
            <label for="evidenceDate">Fecha de evidencia</label><input id="evidenceDate" class="input-modern" type="date" name="fecha" value="${today()}" required aria-describedby="evidence-form-error">
            <button class="btn-modern" type="submit">Guardar evidencia</button>
        </form>`);
}

async function savePiarEvidence(event, piarId, adjustmentId) {
    event.preventDefault();
    const form = beginTraceFormSubmission(event);
    if (!form) return;
    try {
        if (!canEditPiarTrace(piarId)) throw new Error("No tienes permiso para editar este PIAR.");
        if (!validateTraceForm(form, [["descripcion", "La descripción de la evidencia"], ["fecha", "La fecha de evidencia"]])) return;
        await apiCreate(`piar/${Number(piarId)}/ajustes/${Number(adjustmentId)}/evidencias`, formData(form));
        closeModal();
        await reloadPiarDetail(piarId);
        showToastMessage("Evidencia registrada.");
    } catch (error) { showTraceFormError(form, error); }
    finally { endTraceFormSubmission(form); }
}

function openAdjustmentFollowUpModal(piarId, adjustmentId) {
    if (!canEditPiarTrace(piarId)) return showToastMessage("No tienes permiso para editar este PIAR.", "warning");
    openModal("Seguimiento del ajuste", `
        <form class="modal-form" data-onsubmit="saveAdjustmentFollowUp(event, ${Number(piarId)}, ${Number(adjustmentId)})">
            <p class="trace-form-feedback" data-form-feedback id="followup-form-error" role="alert" hidden></p>
            <label for="followUpDate">Fecha real de revisión</label><input id="followUpDate" class="input-modern" type="date" name="fecha" value="${today()}" required aria-describedby="followup-form-error">
            <label for="followUpStatus">Estado del ajuste</label><select id="followUpStatus" class="input-modern" name="estado">${options(["implementado", "en_proceso", "requiere_ajuste", "sin_iniciar"], "en_proceso")}</select>
            <label for="followUpDescription">Resultado observado</label><textarea id="followUpDescription" class="input-modern" name="descripcion" placeholder="Resultado observado" required maxlength="20000" aria-describedby="followup-form-error"></textarea>
            <label for="followUpProgress">Avances frente al indicador</label><textarea id="followUpProgress" class="input-modern" name="evolucion" maxlength="20000"></textarea>
            <label for="followUpAgreements">Acuerdos y acciones siguientes</label><textarea id="followUpAgreements" class="input-modern" name="acuerdos" maxlength="20000"></textarea>
            <button class="btn-modern" type="submit">Guardar seguimiento</button>
        </form>`);
}

async function saveAdjustmentFollowUp(event, piarId, adjustmentId) {
    event.preventDefault();
    const form = beginTraceFormSubmission(event);
    if (!form) return;
    const piar = state.piars.find(item => Number(item.id) === Number(piarId));
    try {
        if (!canEditPiarTrace(piarId) || !piar) throw new Error("No tienes permiso para editar este PIAR.");
        if (!validateTraceForm(form, [["fecha", "La fecha real de revisión"], ["descripcion", "El resultado observado"]])) return;
        const data = formData(form);
        await apiCreate("followUps", { ...data, id_piar: Number(piarId), id_ajuste: Number(adjustmentId), id_estudiante: Number(piar.studentId) });
        closeModal();
        await reloadPiarDetail(piarId);
        showToastMessage("Seguimiento registrado.");
    } catch (error) { showTraceFormError(form, error); }
    finally { endTraceFormSubmission(form); }
}


function diagnosticCards(diagnostics, editable = true) {
    if (!diagnostics.length) {
        return emptyState("Este PIAR aún no tiene diagnósticos.");
    }

    return diagnostics.map(diagnostic => `
        <div class="info-card wide-info">
            <h4>${escapeHTML(diagnostic.tipo_diagnostico)} | ${escapeHTML(diagnostic.fecha || "Sin fecha")}</h4>
            <p>${escapeHTML(diagnostic.descripcion)}</p>
            ${editable && canModifyDiagnostics() ? `<button class="table-btn" type="button" data-onclick="openDiagnosticModal(${Number(diagnostic.id_piar)}, ${Number(diagnostic.id_diagnostico)})">Editar</button>${canDeleteDiagnostics() ? `<button class="table-btn" type="button" data-onclick="deleteDiagnostic(${Number(diagnostic.id_piar)}, ${Number(diagnostic.id_diagnostico)})">Eliminar</button>` : ""}` : ""}
        </div>
    `).join("");
}

function openDiagnosticModal(piarId, diagnosticId = null) {
    if (diagnosticId ? !canModifyDiagnostics() : !canCreateDiagnostics()) return showToastMessage("No tiene permiso para esta operación de diagnóstico.", "warning");
    const piar = state.piars.find(item => item.id === Number(piarId));
    const diagnostic = piar?.diagnosticos?.find(item => item.id_diagnostico === Number(diagnosticId));
    openModal(diagnostic ? "Editar diagnóstico" : "Nuevo diagnóstico", `
        <form data-onsubmit="saveDiagnostic(event, ${Number(piarId)}, ${Number(diagnosticId) || "null"})" class="modal-form">
            <input name="tipo_diagnostico" class="input-modern" placeholder="Tipo de diagnóstico" value="${escapeHTML(diagnostic?.tipo_diagnostico || "")}" required>
            <input name="fecha" type="date" class="input-modern" value="${escapeHTML(diagnostic?.fecha || today())}" required>
            <textarea name="descripcion" class="input-modern" placeholder="Descripción del diagnóstico" required>${escapeHTML(diagnostic?.descripcion || "")}</textarea>
            <button class="btn-modern" type="submit">Guardar diagnóstico</button>
        </form>
    `);
}

async function saveDiagnostic(event, piarId, diagnosticId) {
    event.preventDefault();
    if (diagnosticId ? !canModifyDiagnostics() : !canCreateDiagnostics()) return showToastMessage("No tiene permiso para esta operación de diagnóstico.", "warning");
    const data = formData(event.target);
    const piar = state.piars.find(item => item.id === Number(piarId));
    if (!piar) {
        showToastMessage("PIAR no encontrado.", "warning");
        return;
    }

    const payload = {
        tipo_diagnostico: data.tipo_diagnostico,
        fecha: data.fecha,
        descripcion: data.descripcion,
        id_estudiante: piar.id_estudiante || piar.studentId,
        id_piar: Number(piarId)
    };

    try {
        if (diagnosticId) {
            await apiUpdateDiagnostic(diagnosticId, payload);
        } else {
            await apiCreateDiagnostic(payload);
        }
        await refreshPiarInState(piarId);
        closeModal();
        viewPIAR(Number(piarId));
        showToastMessage("Diagnóstico guardado en MySQL.");
    } catch (error) {
        showToastMessage(error.message, "warning");
    }
}

function emailVerificationForm() {
    return `<form data-onsubmit="confirmEmailVerification(event)" class="auth-form"><p>Este enlace es de un solo uso y vence en 24 horas.</p><button type="submit" class="btn-modern">Verificar correo</button></form>`;
}

function resendVerificationForm() {
    return `<form data-onsubmit="resendEmailVerification(event)" class="auth-form"><div class="auth-field auth-field-icon"><label for="verificationEmail">Correo electrónico</label><input id="verificationEmail" type="email" class="input-modern" placeholder="nombre@institucion.edu.co" autocomplete="email" required><i class="bi bi-envelope" aria-hidden="true"></i></div><button type="submit" class="btn-modern auth-submit">Enviar nuevo enlace</button></form>`;
}

async function resendEmailVerification(event) {
    event.preventDefault();
    const correo = document.getElementById("verificationEmail").value.trim();
    try {
        const result = await apiRequestEmailVerification(correo);
        renderLogin("login", result.message || "Si existe una solicitud pendiente, enviaremos instrucciones.");
    } catch (error) {
        showToastMessage(error.message || "No fue posible solicitar otro enlace.", "warning");
    }
}

function leaveEmailVerification(event) {
    event?.preventDefault();
    const wasEmailChange = new URLSearchParams(window.location.hash.slice(1)).has("verify-email-change");
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    // D1: el enlace de cambio de correo puede abrirse con una sesión iniciada. Sin
    // confirmar, el correo no cambia; al volver se retoma la sesión si sigue vigente
    // (initializeApp muestra el acceso si no hay sesión).
    if (wasEmailChange) {
        initializeApp();
        return;
    }
    renderLogin("login");
}

async function confirmEmailVerification(event) {
    event.preventDefault();
    const params = new URLSearchParams(window.location.hash.slice(1));
    const changeToken = params.get("verify-email-change");
    const token = changeToken || params.get("verify-email");
    if (!token) {
        renderLogin("login", "El enlace de verificación no es válido o venció.");
        return;
    }
    try {
        const result = changeToken ? await apiConfirmEmailChange(changeToken) : await apiConfirmEmailVerification(token);
        history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        renderLogin("login", result.message || "Correo verificado. La cuenta requiere aprobación institucional.");
    } catch (error) {
        const message = error.message || "No fue posible verificar el correo.";
        if (error.status === 0) {
            // Sin conexión: se conserva el enlace para reintentar.
            showToastMessage(message, "warning");
            return;
        }
        history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        // Enlace vencido o inválido: se ofrece directamente el reenvío; enlace usado: vuelve al acceso.
        renderLogin(!changeToken && (error.reason === "vencido" || error.reason === "invalido") ? "resend-verification" : "login", message);
    }
}

function passwordResetForm() {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("reset");
    if (!token) return '<form data-onsubmit="requestPasswordReset(event)" class="auth-form"><div class="auth-field auth-field-icon"><label for="resetEmail">Correo electrónico</label><input id="resetEmail" type="email" class="input-modern" placeholder="nombre@institucion.edu.co" autocomplete="email" required><i class="bi bi-envelope" aria-hidden="true"></i></div><button type="submit" class="btn-modern auth-submit">Enviar enlace</button></form>';
    return '<form data-onsubmit="confirmPasswordReset(event)" class="auth-form"><div class="auth-field"><label for="resetPassword">Nueva contraseña</label><input id="resetPassword" type="password" class="input-modern" placeholder="Mínimo 14 caracteres" autocomplete="new-password" minlength="14" maxlength="72" required></div><div class="auth-field"><label for="resetConfirm">Confirmar contraseña</label><input id="resetConfirm" type="password" class="input-modern" placeholder="Repite la contraseña" autocomplete="new-password" minlength="14" maxlength="72" required></div><button type="submit" class="btn-modern auth-submit">Cambiar contraseña</button></form>';
}

function leavePasswordReset(event) {
    event.preventDefault();
    window.history.replaceState({}, "", window.location.pathname + window.location.search);
    renderLogin("login");
}

async function requestPasswordReset(event) {
    event.preventDefault();
    try {
        const result = await apiRequestPasswordReset(document.getElementById("resetEmail").value.trim());
        renderLogin("reset", result.message);
    } catch {
        renderLogin("reset", "No fue posible procesar la solicitud. Inténtalo más tarde.");
    }
}

async function confirmPasswordReset(event) {
    event.preventDefault();
    const password = document.getElementById("resetPassword").value;
    if (password !== document.getElementById("resetConfirm").value) {
        renderLogin("reset", "Las contraseñas no coinciden.");
        return;
    }
    try {
        const result = await apiConfirmPasswordReset(new URLSearchParams(window.location.hash.slice(1)).get("reset"), password);
        window.history.replaceState({}, "", window.location.pathname + window.location.search);
        renderLogin("login", result.message);
    } catch (error) {
        window.history.replaceState({}, "", window.location.pathname + window.location.search);
        renderLogin("login", error.message || "El enlace no es válido o expiró.");
    }
}

async function deleteDiagnostic(piarId, diagnosticId) {
    if (!canDeleteDiagnostics()) return showToastMessage("No tiene permiso para eliminar diagnósticos.", "warning");
    if (!window.confirm("¿Eliminar este diagnóstico? Esta acción no se puede deshacer.")) return;
    try {
        await apiDeleteDiagnostic(diagnosticId);
        await refreshPiarInState(piarId);
        viewPIAR(Number(piarId));
        showToastMessage("Diagnóstico eliminado.");
    } catch (error) {
        showToastMessage(error.message, "warning");
    }
}

function generateReport() {
    const type = document.getElementById("reportType").value;
    const studentId = document.getElementById("reportStudent").value;
    const period = document.getElementById("reportPeriod").value;
    const date = document.getElementById("reportDate").value;
    document.getElementById("reportOutput").innerHTML = buildReportHTML(type, studentId, period, date);
    showToastMessage("Reporte generado.");
}

function buildReportHTML(type, studentId, period, date) {
    const selectedStudents = studentId === "all"
        ? state.students
        : state.students.filter(student => student.id === Number(studentId));

    const selectedPiars = state.piars.filter(piar => selectedStudents.some(student => student.id === piar.studentId));

    return `
        <article class="print-report">
            <header>
                <h2>${escapeHTML(type)}</h2>
                <p>${escapeHTML(state.institution.name)} | ${escapeHTML(state.institution.municipio)}, ${escapeHTML(state.institution.department)}</p>
                <p>Periodo: ${escapeHTML(period)} | Fecha: ${escapeHTML(date)}</p>
            </header>
            <section>
                <h3>Resumen</h3>
                <div class="report-summary">
                    <span>Estudiantes: ${selectedStudents.length}</span>
                    <span>PIAR/PR: ${selectedPiars.length}</span>
                    <span>Avance promedio: ${getAverageProgress(selectedPiars)}%</span>
                    <span>Revisiones pendientes: ${selectedPiars.filter(piar => piar.estado === "revision").length}</span>
                </div>
            </section>
            ${selectedStudents.map(student => {
                const piar = selectedPiars.find(item => item.studentId === student.id);
                const teacher = piar ? getTeacher(piar.teacherId) : null;
                return `
                    <section class="report-student">
                        <h3>${escapeHTML(fullName(student))}</h3>
                        <p><strong>Grado:</strong> ${escapeHTML(student.grado)} <strong>Necesidad:</strong> ${escapeHTML(student.discapacidad)}</p>
                        <p><strong>Necesidades o características:</strong> ${escapeHTML(student.condicion_especial || student.discapacidad)}</p>
                        <p><strong>Valoración pedagógica:</strong> ${escapeHTML(student.valoracion)}</p>
                        <p><strong>Barreras:</strong> ${escapeHTML(student.barreras.join(", "))}</p>
                        <p><strong>Apoyos:</strong> ${escapeHTML(student.apoyosRequeridos.join(", "))}</p>
                        ${piar ? `
                            <p><strong>Responsable:</strong> ${escapeHTML(teacher ? fullTeacherName(teacher) : "Sin asignar")}</p>
                            <p><strong>Objetivo:</strong> ${escapeHTML(piar.objetivoGeneral)}</p>
                            <p><strong>Metas:</strong> ${escapeHTML(piar.metas)}</p>
                            <ul>
                                ${piar.ajustes.map(ajuste => `<li>${escapeHTML(ajuste.area)}: ${escapeHTML(ajuste.estrategia)} (${escapeHTML(ajuste.avance)}%)</li>`).join("")}
                            </ul>
                            <p><strong>Últimas observaciones:</strong></p>
                            <ul>
                                ${piar.observaciones.slice(-3).map(obs => `<li>${escapeHTML(formatDisplayDate(obs.fecha))} - ${escapeHTML(obs.tipo)}: ${escapeHTML(obs.nota)}</li>`).join("") || "<li>Sin observaciones registradas.</li>"}
                            </ul>
                        ` : `<p><strong>PIAR:</strong> Pendiente por crear.</p>`}
                    </section>
                `;
            }).join("")}
            <footer>
                <p>Responsable: ${escapeHTML(state.institution.teacher)}</p>
            </footer>
        </article>
    `;
}

function printReport() {
    window.print();
}

async function saveSettings() {
    state.institution = {
        name: window.PIAR_APP_CONFIG?.institution?.name || "Colegio Reinaldo Matiz",
        sede: document.getElementById("institutionSede").value,
        municipio: document.getElementById("institutionMunicipio").value,
        department: document.getElementById("institutionDepartment").value,
        teacher: document.getElementById("institutionTeacher").value,
        year: document.getElementById("institutionYear").value
    };
    try {
        const { sede, municipio, department, teacher, year } = state.institution;
        const name = window.PIAR_APP_CONFIG?.institution?.name || "Colegio Reinaldo Matiz";
        localStorage.setItem(INSTITUTION_SETTINGS_KEY, JSON.stringify({ name, sede, municipio, department, teacher, year }));
        renderApp("settings");
        showToastMessage("Configuración local del navegador guardada.");
    } catch {
        showToastMessage("No se pudo guardar la configuración en este navegador.", "warning");
    }
}

function loadCharts() {
    Object.values(charts).forEach(chart => chart?.destroy());
    charts = {};

    const progressCtx = document.getElementById("progressChart");
    if (progressCtx && window.Chart) {
        charts.progress = new Chart(progressCtx, {
            type: "bar",
            data: {
                labels: state.piars.map(piar => fullName(getStudent(piar.studentId)).split(" ")[0]),
                datasets: [{
                    label: "Avance",
                    data: state.piars.map(getPIARProgress),
                    backgroundColor: ["#7B4DFF", "#3B82F6", "#10B981", "#F59E0B"]
                }]
            },
            options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } }
        });
    }

    const studentsCtx = document.getElementById("studentsChart");
    if (studentsCtx && window.Chart) {
        const distribution = countBy(state.students, "discapacidad");
        charts.students = new Chart(studentsCtx, {
            type: "doughnut",
            data: {
                labels: Object.keys(distribution),
                datasets: [{
                    data: Object.values(distribution),
                    backgroundColor: ["#7B4DFF", "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#06B6D4"]
                }]
            },
            options: { responsive: true }
        });
    }
}

function filterStudents() {
    const term = document.getElementById("studentSearch").value.toLowerCase();
    const filtered = state.students.filter(student => searchable([
        fullName(student), student.documento, student.grado, student.condicion_especial, student.discapacidad
    ], term));
    document.getElementById("studentsGrid").innerHTML = studentCards(filtered);
}

function filterTeachers() {
    const term = document.getElementById("teacherSearch").value.toLowerCase();
    const filtered = state.teachers.filter(teacher => searchable([
        fullTeacherName(teacher), teacher.area, teacher.cargo, teacher.correo
    ], term));
    document.getElementById("teachersGrid").innerHTML = teacherCards(filtered);
}

function filterPIAR() {
    const term = document.getElementById("piarSearch").value.toLowerCase();
    const filtered = state.piars.filter(piar => {
        const student = getStudent(piar.studentId);
        const teacher = getTeacher(piar.teacherId);
        return searchable([
            student ? fullName(student) : "",
            teacher ? fullTeacherName(teacher) : "",
            piar.estado,
            piar.periodo,
            piar.objetivoGeneral
        ], term);
    });
    document.getElementById("piarGrid").innerHTML = piarCards(filtered);
}

function openModal(title, body) {
    closeModal();
    modalReturnFocus = document.activeElement;
    document.body.insertAdjacentHTML("beforeend", `
        <div class="custom-modal-overlay" id="appModal">
            <div class="custom-modal" role="dialog" aria-modal="true" aria-labelledby="appModalTitle" tabindex="-1">
                <div class="modal-header-custom">
                    <h2 id="appModalTitle">${escapeHTML(title)}</h2>
                    <button class="close-modal" type="button" aria-label="Cerrar ventana" data-onclick="closeModal()"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
                </div>
                <div class="modal-body-custom">${body}</div>
            </div>
        </div>
    `);
    const modal = document.querySelector("#appModal [role=dialog]");
    modal?.addEventListener("keydown", handleAppModalKeydown);
    modal?.querySelector(".close-modal")?.focus();
}

function handleAppModalKeydown(event) {
    const modal = document.querySelector("#appModal [role=dialog]");
    if (!modal) return;
    if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
        return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...modal.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")]
        .filter(element => !element.hidden && element.getAttribute("aria-hidden") !== "true");
    if (!focusable.length) {
        event.preventDefault();
        modal.focus();
        return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
    }
}

function closeModal() {
    const modal = document.getElementById("appModal");
    if (!modal) return;
    modal.remove();
    if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
    modalReturnFocus = null;
}

function showToastMessage(message, type = "success") {
    const toast = document.createElement("div");
    const isError = type === "warning" || type === "error";
    toast.className = `custom-toast ${["success", "warning", "error"].includes(type) ? type : "success"}`;
    toast.setAttribute("role", isError ? "alert" : "status");
    toast.setAttribute("aria-live", isError ? "assertive" : "polite");
    toast.replaceChildren(Object.assign(document.createElement("i"), { className: "bi bi-check-circle-fill", ariaHidden: "true" }), document.createTextNode(message));
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add("show-toast"), 100);
    setTimeout(() => toast.remove(), 5000);
}


function toggleSidebar() {
    document.querySelector(".sidebar").classList.toggle("sidebar-collapsed");
}

function toggleProfileMenu() {
    document.getElementById("profileDropdown")?.classList.toggle("show-profile-menu");
}

async function logout() {
    try {
        await apiLogout();
    } finally {
        clearSensitiveState();
        renderLogin();
    }
}

function getStudent(id) {
    return state.students.find(student => student.id === Number(id));
}

function getTeacher(id) {
    return state.teachers.find(teacher => teacher.id === Number(id));
}

function fullName(student) {
    return `${student.nombres} ${student.apellidos}`;
}

function fullTeacherName(teacher) {
    return `${teacher.nombres} ${teacher.apellidos}`;
}

function initials(name) {
    const safe = (typeof name === "string" && name.trim()) ? name.trim() : "Usuario";
    return safe.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

function nextId(items) {
    return items.length ? Math.max(...items.map(item => item.id)) + 1 : 1;
}

function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
}

function splitList(value) {
    return value.split(",").map(item => item.trim()).filter(Boolean);
}

function options(items, selected) {
    return items.map(item => `<option value="${escapeHTML(item)}" ${item === selected ? "selected" : ""}>${escapeHTML(labelStatus(item))}</option>`).join("");
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

// Fecha legible para la interfaz (p. ej. «10 mar 2026»). Una fecha AAAA-MM-DD se
// interpreta como fecha local, sin desfase de zona horaria. La API serializa las
// columnas DATE como instante ISO de la medianoche local del servidor, que el
// navegador de la institución (misma zona) muestra con el mismo día.
function formatDisplayDate(value) {
    if (value === null || value === undefined || value === "") return "Sin fecha";
    const text = String(value);
    const dateOnlyMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const date = dateOnlyMatch
        ? new Date(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]) - 1, Number(dateOnlyMatch[3]))
        : new Date(value);
    return Number.isNaN(date.getTime()) ? text : new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function getPIARProgress(piar) {
    const values = [
        ...piar.ajustes.map(ajuste => Number(ajuste.avance || 0)),
        ...piar.observaciones.map(obs => Number(obs.avance || 0))
    ];
    if (!values.length) {
        return 0;
    }
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function getAverageProgress(piars = state.piars) {
    if (!piars.length) {
        return 0;
    }
    return Math.round(piars.map(getPIARProgress).reduce((sum, value) => sum + value, 0) / piars.length);
}

function countBy(items, key) {
    return items.reduce((result, item) => {
        result[item[key]] = (result[item[key]] || 0) + 1;
        return result;
    }, {});
}

function searchable(values, term) {
    return values.join(" ").toLowerCase().includes(term);
}

function statusClass(status) {
    return `status-${["activo", "revision", "cerrado", "inactivo"].includes(status) ? status : "unknown"}`;
}

function labelStatus(value) {
    const labels = {
        activo: "Activo",
        revision: "En revisión",
        cerrado: "Cerrado",
        draft: "Borrador"
    };
    return labels[value] || value;
}

function isReviewDue(date) {
    const review = new Date(date);
    const limit = new Date();
    limit.setDate(limit.getDate() + 15);
    return review <= limit;
}

function infoCard(title, value) {
    return `
        <div class="info-card">
            <h4>${escapeHTML(title)}</h4>
            <p>${escapeHTML(value || "Sin registrar")}</p>
        </div>
    `;
}

function emptyState(message) {
    return `<div class="empty-state">${escapeHTML(message)}</div>`;
}
