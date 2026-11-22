"use strict";

// Delegación de eventos compatible con una CSP sin 'unsafe-inline'.
// Las plantillas declaran la acción con data-onclick, data-onsubmit,
// data-oninput o data-onchange, por ejemplo data-onclick="viewPIAR(12)".
// No se evalúa código: solo se admite una llamada a una función global de la
// lista permitida, con argumentos literales (números, cadenas entre comillas
// simples, true, false, null), `event` o `this` (el elemento con la acción).
const PIAR_EVENT_ACTIONS = Object.freeze([
    "assignPiarTeacher", "changeUserState", "closeModal", "comparePiarVersionSelection",
    "completeInitialPasswordChange", "confirmEmailVerification", "confirmPasswordReset", "decideRegistrationRequest",
    "deleteDiagnostic", "filterPIAR", "filterStudents", "filterTeachers", "filterUserAdministration", "generateReport",
    "initializeApp", "leaveEmailVerification", "leavePasswordReset", "linkExternalIdentity", "login", "logout",
    "openAdjustmentFollowUpModal", "openAdjustmentModal", "openBarrierModal", "openDiagnosticModal", "openDuaModal",
    "openEvidenceModal", "openExternalIdentities", "openObservationModal", "openPiarEditModal", "openPIARModal",
    "openPiarStatusModal", "openPiarTeachersModal", "openStudentModal", "openTeacherModal", "openUserCreateModal",
    "openUserEditModal", "prefillStudentAccount", "printPiarDetail", "printReport", "registerUser", "removePiarTeacher",
    "renderApp", "renderLogin", "renderRegistrationRequests", "renderUserAdministration", "requestPasswordReset",
    "resendEmailVerification", "saveAdjustmentFollowUp", "saveCurrentReport", "saveDiagnostic", "saveDua",
    "saveObservation", "savePIAR", "savePiarAdjustment", "savePiarBarrier", "savePiarEdit", "savePiarEvidence",
    "savePiarStatus", "saveSettings", "saveStudent", "saveTeacher", "saveUserCreate", "saveUserEdit",
    "startExternalAuth", "togglePasswordVisibility", "toggleProfileMenu", "toggleSidebar", "toggleStudentAccountFields",
    "unlinkExternalIdentity", "viewOwnPIAR", "viewPIAR", "viewSavedReport", "viewStudent", "viewTeacher"
]);
const PIAR_EVENT_TYPES = Object.freeze(["click", "submit", "input", "change"]);

function parseActionArgument(token, event, element) {
    if (token === "event") return event;
    if (token === "this") return element;
    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "null") return null;
    if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
    const quoted = token.match(/^'([^'\\]*)'$/);
    if (quoted) return quoted[1];
    throw new Error("Argumento de acción no admitido.");
}

// Devuelve { name, args } o null si la expresión no cumple la gramática.
function parseActionExpression(expression) {
    const match = String(expression || "").trim().match(/^([A-Za-z_$][\w$]*)\((.*)\);?$/s);
    if (!match) return null;
    const rawArgs = match[2].trim();
    const args = [];
    let current = "";
    let quoted = false;
    for (const character of rawArgs) {
        if (character === "'") quoted = !quoted;
        // Fuera de comillas no se admiten llamadas anidadas ni varias sentencias.
        if (!quoted && "();".includes(character)) return null;
        if (character === "," && !quoted) { args.push(current.trim()); current = ""; continue; }
        current += character;
    }
    if (quoted) return null;
    if (rawArgs) args.push(current.trim());
    return { name: match[1], args };
}

function runElementAction(element, type, event) {
    const parsed = parseActionExpression(element.getAttribute(`data-on${type}`));
    if (!parsed || !PIAR_EVENT_ACTIONS.includes(parsed.name)) {
        console.error(`Acción no permitida en data-on${type}.`);
        return;
    }
    const handler = window[parsed.name];
    if (typeof handler !== "function") {
        console.error(`La acción ${parsed.name} no está disponible.`);
        return;
    }
    const args = parsed.args.map(token => parseActionArgument(token, event, element));
    const result = handler.apply(element, args);
    if (result && typeof result.catch === "function") result.catch(error => console.error(error?.message || error));
}

// Recorre desde el elemento de origen hacia arriba, como hacían los atributos en
// línea: cada antecesor con acción se ejecuta salvo que se detenga la propagación.
function dispatchDelegatedEvent(event) {
    const attribute = `data-on${event.type}`;
    let element = event.target instanceof Element ? event.target : event.target?.parentElement;
    while (element && element !== document.documentElement) {
        if (element.hasAttribute(attribute)) {
            runElementAction(element, event.type, event);
            if (event.cancelBubble) break;
        }
        element = element.parentElement;
    }
}

if (typeof document !== "undefined") {
    for (const type of PIAR_EVENT_TYPES) document.addEventListener(type, dispatchDelegatedEvent);
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { PIAR_EVENT_ACTIONS, PIAR_EVENT_TYPES, parseActionExpression, parseActionArgument };
}
