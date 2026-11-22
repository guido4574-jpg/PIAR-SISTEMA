"use strict";

const SOURCES = new Set(["local_cli_self_asserted", "email_verification_token", "admin_session"]);
// Resultado esperado de cada operación.
const EXPECTED_OUTCOME = Object.freeze({
    initial_admin_created: "pending_verification", password_recovered: "success", email_verified: "success",
    account_deactivated: "success", account_reactivated: "success",
    // Decisión D1: cambio de correo solicitado por el Administrador y confirmado con el enlace.
    email_change_requested: "pending_verification", email_changed: "success", account_updated: "success",
    // Decisiones D2 y D3: creación institucional, aprobación y rechazo de solicitudes.
    account_created: "pending_verification", registration_approved: "success", registration_rejected: "success"
});
const OPERATIONS = new Set(Object.keys(EXPECTED_OUTCOME));
// Operations performed from an authenticated Administrador session.
const SESSION_OPERATIONS = new Set(["account_deactivated", "account_reactivated", "email_change_requested", "account_updated",
    "account_created", "registration_approved", "registration_rejected"]);
// Operations proven only by a single-use email token.
const TOKEN_OPERATIONS = new Set(["email_verified", "email_changed"]);
const OUTCOMES = new Set(["pending_verification", "success"]);
// Decisión D7: única referencia admitida en una sesión administrativa; deja constancia
// de que el Administrador confirmó la autorización del acudiente al crear una cuenta Estudiante.
const GUARDIAN_CONSENT_REFERENCE = "autorizacion_acudiente_confirmada";

function validateAdminEvent(event) {
    if (!event || !OPERATIONS.has(event.operation) || !OUTCOMES.has(event.outcome)
        || !SOURCES.has(event.operatorIdentitySource)
        || !Number.isSafeInteger(Number(event.targetUserId)) || Number(event.targetUserId) <= 0) {
        throw new Error("Administrative audit event is invalid.");
    }
    if (event.outcome !== EXPECTED_OUTCOME[event.operation]
        || (SESSION_OPERATIONS.has(event.operation) && event.operatorIdentitySource !== "admin_session")
        || (event.operation === "email_changed" && event.operatorIdentitySource !== "email_verification_token")) {
        throw new Error("Administrative audit operation and outcome do not match.");
    }
    if (event.operatorIdentitySource === "local_cli_self_asserted") {
        if (typeof event.operatorIdentityClaim !== "string" || !event.operatorIdentityClaim.trim()
            || event.operatorIdentityClaim.length > 150 || /[\r\n\x00-\x1f]/.test(event.operatorIdentityClaim)
            || typeof event.authorizationReference !== "string" || !event.authorizationReference.trim()
            || event.authorizationReference.length > 128 || /[\r\n\x00-\x1f]/.test(event.authorizationReference)
            || typeof event.reason !== "string" || !event.reason.trim() || event.reason.length > 500
            || /[\r\n\x00-\x1f]/.test(event.reason)) {
            throw new Error("Operator declaration, authorization reference and reason are required for local administrative events.");
        }
    } else if (event.operatorIdentitySource === "admin_session") {
        // The claim is the authenticated administrator id, not a free-text declaration.
        if (!SESSION_OPERATIONS.has(event.operation) || !/^[1-9]\d{0,9}$/.test(String(event.operatorIdentityClaim || ""))
            || (event.authorizationReference != null && !(event.operation === "account_created" && event.authorizationReference === GUARDIAN_CONSENT_REFERENCE))
            || event.reason != null) {
            throw new Error("Administrative session events require the authenticated administrator id.");
        }
    } else if (!TOKEN_OPERATIONS.has(event.operation) || event.operatorIdentityClaim != null
        || event.authorizationReference != null || event.reason != null) {
        throw new Error("Email verification audit events must not claim an administrative operator.");
    }
}

async function recordAdminAccountEvent(connection, event) {
    validateAdminEvent(event);
    await connection.execute(
        "INSERT INTO admin_account_audit (target_user_id, operation, outcome, operator_identity_claim, operator_identity_source, authorization_reference, reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [event.targetUserId, event.operation, event.outcome, event.operatorIdentityClaim || null,
            event.operatorIdentitySource, event.authorizationReference || null, event.reason || null]
    );
}

module.exports = { validateAdminEvent, recordAdminAccountEvent, GUARDIAN_CONSENT_REFERENCE };
