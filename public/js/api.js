const API_CONFIG = window.PIAR_API_CONFIG || {};
const API_BASE_URL = (API_CONFIG.baseUrl || window.location.origin).replace(/\/$/, "");

function apiUrl(name) {
    const [baseName, ...suffix] = name.split("/");
    const endpoint = API_CONFIG.endpoints?.[baseName] || `/${baseName}`;
    const normalized = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    return `${API_BASE_URL}${normalized}${suffix.length ? `/${suffix.join("/")}` : ""}`;
}

// Límite de espera: si el servidor no responde, la petición falla y los formularios recuperan
// su estado (los botones «Ingresando…», «Guardando…» se restablecen en sus bloques finally).
const API_TIMEOUT_MS = 30000;

async function apiRequest(name, method, body) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), API_TIMEOUT_MS) : null;
    let response;
    try {
        response = await fetch(apiUrl(name), {
            method,
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            ...(controller ? { signal: controller.signal } : {})
        });
    } catch (cause) {
        const error = new Error(controller?.signal.aborted ? "El servidor no respondió a tiempo. Inténtalo de nuevo." : "No hay conexión con el servidor.");
        error.status = 0;
        throw error;
    } finally {
        if (timer) clearTimeout(timer);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload.message || "No se pudo completar la solicitud");
        error.status = response.status;
        // Motivo controlado por el servidor (por ejemplo, "vencido" o "usado" en la verificación del correo).
        if (typeof payload.reason === "string" && /^[a-z_]{1,32}$/.test(payload.reason)) error.reason = payload.reason;
        if (response.status === 401 && !["authLogin", "authRegister", "authMe", "authLogout", "authPasswordResetRequest", "authPasswordResetConfirm", "authEmailVerificationConfirm", "authEmailVerificationRequest", "authEmailChangeConfirm"].includes(name)) {
            window.handleSessionExpired?.();
        }
        throw error;
    }
    return payload;
}

function apiRegister(data) { return apiRequest("authRegister", "POST", data); }
function apiLogin(data) { return apiRequest("authLogin", "POST", data); }
function apiChangeInitialPassword(password) { return apiRequest("authInitialPasswordChange", "POST", { password }); }
function apiLogout() { return apiRequest("authLogout", "POST"); }
function apiCurrentUser() { return apiRequest("authMe", "GET"); }
function apiGetAppConfig() { return apiRequest("appConfig", "GET"); }
function apiRequestPasswordReset(correo) { return apiRequest("authPasswordResetRequest", "POST", { correo }); }
function apiConfirmPasswordReset(token, password) { return apiRequest("authPasswordResetConfirm", "POST", { token, password }); }
function apiConfirmEmailVerification(token) { return apiRequest("authEmailVerificationConfirm", "POST", { token }); }
function apiRequestEmailVerification(correo) { return apiRequest("authEmailVerificationRequest", "POST", { correo }); }
function apiConfirmEmailChange(token) { return apiRequest("authEmailChangeConfirm", "POST", { token }); }
function apiList(name) { return apiRequest(name, "GET"); }
function apiCreate(name, data) { return apiRequest(name, "POST", data); }
function apiUpdate(name, id, data) { return apiRequest(`${name}/${id}`, "PUT", data); }
function apiDelete(name, id) { return apiRequest(`${name}/${id}`, "DELETE"); }
// Decisión D5: identidades externas de la cuenta autenticada.
function apiGetIdentities() { return apiList("authIdentities"); }
function apiUnlinkIdentity(id, password) { return apiRequest(`authIdentities/${Number(id)}`, "DELETE", { password }); }
function apiGetUsers() { return apiList("users"); }
function apiDecideUserApproval(id, decision, reason) { return apiRequest(`users/${id}/aprobacion`, "POST", { decision, reason }); }
function apiGetStudents() { return apiList("students"); }
function apiGetTeachers() { return apiList("teachers"); }
function apiGetPiars() { return apiList("piar"); }
function apiGetPiar(id) { return apiRequest(`piar/${id}`, "GET"); }
function apiGetPiarVersions(id) { return apiRequest(`piar/${Number(id)}/versiones`, "GET"); }
function apiGetPiarVersion(id, versionId) { return apiRequest(`piar/${Number(id)}/versiones/${Number(versionId)}`, "GET"); }
function apiGetDiagnostics() { return apiList("diagnostics"); }
function apiGetDiagnostic(id) { return apiRequest(`diagnostics/${id}`, "GET"); }
function apiCreateDiagnostic(data) { return apiCreate("diagnostics", data); }
function apiUpdateDiagnostic(id, data) { return apiUpdate("diagnostics", id, data); }
function apiDeleteDiagnostic(id) { return apiDelete("diagnostics", id); }
function apiGetFollowUps() { return apiList("followUps"); }
function apiGetObservations() { return apiList("observations"); }
function apiGetReports() { return apiList("reports"); }
function apiGetHistory() { return apiList("history"); }
function apiGetDashboard() { return apiList("dashboard"); }

async function apiHealth() {
    try {
        const response = await fetch(apiUrl("health"), { method: "GET" });
        return response.ok;
    } catch {
        return false;
    }
}

function getApiLabel() { return "API institucional"; }
