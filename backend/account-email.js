"use strict";

// Cambio de correo con verificación obligatoria (decisión D1, migración 016).
// El correo actual sigue vigente hasta que se confirma el nuevo con un enlace
// de un solo uso; al confirmarlo se revocan las sesiones y se invalidan los
// enlaces enviados a la dirección anterior.

const crypto = require("node:crypto");
const { recordAdminAccountEvent } = require("./admin-account-audit");

const EMAIL_CHANGE_HOURS = 24;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const TOKEN = /^[A-Za-z0-9_-]{40,60}$/;
const INVALID_LINK = { status: 400, body: { ok: false, message: "El enlace de cambio de correo no es válido o venció." } };
const MIGRATION_REQUIRED = { status: 503, body: { ok: false, message: "El cambio de correo requiere la migración 016, que aún no está aplicada. El correo actual no cambió." } };

function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function missingTable(error) {
    return error && error.code === "ER_NO_SUCH_TABLE";
}

/**
 * Registra la solicitud y envía el enlace al correo nuevo.
 * deliver(correoNuevo, enlaceRelativo) recibe la ruta del fragmento; quien llama arma la URL.
 */
async function requestEmailChange(db, { userId, newEmail, actorId }, deliver) {
    const correo = normalizeEmail(newEmail);
    if (!correo || correo.length > 150 || !EMAIL.test(correo)) {
        return { status: 400, body: { ok: false, message: "El correo no es válido." } };
    }
    if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0 || !Number.isSafeInteger(Number(actorId)) || Number(actorId) <= 0) {
        return { status: 400, body: { ok: false, message: "Usuario no válido." } };
    }
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();
        const [users] = await connection.query("SELECT id_usuario, correo, estado, correo_verificado_at FROM usuario WHERE id_usuario = ? FOR UPDATE", [Number(userId)]);
        if (!users.length) {
            await connection.rollback();
            return { status: 404, body: { ok: false, message: "Usuario no encontrado." } };
        }
        if (normalizeEmail(users[0].correo) === correo) {
            await connection.rollback();
            return { status: 200, body: { ok: true, unchanged: true, message: "El correo no cambió." } };
        }
        if (users[0].estado === "pendiente_verificacion" || !users[0].correo_verificado_at) {
            await connection.rollback();
            return { status: 409, body: { ok: false, message: "La cuenta aún no verificó su correo inicial; el cambio no está disponible." } };
        }
        const [taken] = await connection.query("SELECT id_usuario FROM usuario WHERE correo = ? AND id_usuario <> ? LIMIT 1", [correo, Number(userId)]);
        if (taken.length) {
            await connection.rollback();
            return { status: 409, body: { ok: false, message: "El correo ya pertenece a otra cuenta." } };
        }
        // Una solicitud nueva invalida las anteriores de la misma cuenta.
        await connection.query("UPDATE cambio_correo SET consumed_at = CURRENT_TIMESTAMP WHERE id_usuario = ? AND consumed_at IS NULL", [Number(userId)]);
        await connection.query(
            "INSERT INTO cambio_correo (id_usuario, correo_nuevo, token_hash, solicitado_por, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? HOUR))",
            [Number(userId), correo, tokenHash, Number(actorId), EMAIL_CHANGE_HOURS]
        );
        await recordAdminAccountEvent(connection, {
            targetUserId: Number(userId), operation: "email_change_requested", outcome: "pending_verification",
            operatorIdentityClaim: String(Number(actorId)), operatorIdentitySource: "admin_session", authorizationReference: null, reason: null
        });
        await connection.commit();
    } catch (error) {
        try { await connection.rollback(); } catch { /* conserva el error original */ }
        if (missingTable(error)) return MIGRATION_REQUIRED;
        throw error;
    } finally {
        connection.release();
    }

    try {
        await deliver(correo, `/#verify-email-change=${encodeURIComponent(token)}`);
    } catch {
        await db.promise().query("UPDATE cambio_correo SET consumed_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND consumed_at IS NULL", [tokenHash]);
        console.error("No se pudo entregar el enlace de cambio de correo.");
        return { status: 503, body: { ok: false, message: "No se pudo enviar el enlace al correo nuevo. El correo actual sigue vigente." } };
    }
    return { status: 202, body: { ok: true, pendingVerification: true, message: "Se envió un enlace de verificación al correo nuevo. El correo actual sigue vigente hasta que se confirme." } };
}

async function confirmEmailChange(db, token) {
    const normalizedToken = String(token || "");
    if (!TOKEN.test(normalizedToken)) return INVALID_LINK;
    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.query(
            "SELECT c.id_cambio, c.id_usuario, c.correo_nuevo FROM cambio_correo c INNER JOIN usuario u ON u.id_usuario = c.id_usuario WHERE c.token_hash = ? AND c.consumed_at IS NULL AND c.expires_at > CURRENT_TIMESTAMP LIMIT 1 FOR UPDATE",
            [hashToken(normalizedToken)]
        );
        if (!rows.length) {
            await connection.rollback();
            return INVALID_LINK;
        }
        const change = rows[0];
        const [claimed] = await connection.query(
            "UPDATE cambio_correo SET consumed_at = CURRENT_TIMESTAMP WHERE id_cambio = ? AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP",
            [change.id_cambio]
        );
        if (Number(claimed.affectedRows) !== 1) {
            await connection.rollback();
            return INVALID_LINK;
        }
        try {
            await connection.query("UPDATE usuario SET correo = ?, correo_verificado_at = CURRENT_TIMESTAMP WHERE id_usuario = ?", [change.correo_nuevo, change.id_usuario]);
        } catch (error) {
            if (error.code !== "ER_DUP_ENTRY") throw error;
            await connection.rollback();
            return { status: 409, body: { ok: false, message: "El correo nuevo ya pertenece a otra cuenta. El correo actual sigue vigente." } };
        }
        // Las sesiones y los enlaces enviados al correo anterior dejan de ser válidos.
        await connection.query("UPDATE sesion_usuario SET revoked_at = CURRENT_TIMESTAMP WHERE id_usuario = ? AND revoked_at IS NULL", [change.id_usuario]);
        await connection.query("UPDATE recuperacion_contrasena SET consumed_at = CURRENT_TIMESTAMP WHERE id_usuario = ? AND consumed_at IS NULL", [change.id_usuario]);
        await connection.query("UPDATE verificacion_correo SET consumed_at = CURRENT_TIMESTAMP WHERE id_usuario = ? AND consumed_at IS NULL", [change.id_usuario]);
        await recordAdminAccountEvent(connection, {
            targetUserId: Number(change.id_usuario), operation: "email_changed", outcome: "success",
            operatorIdentityClaim: null, operatorIdentitySource: "email_verification_token", authorizationReference: null, reason: null
        });
        await connection.commit();
        return { status: 200, userId: Number(change.id_usuario), body: { ok: true, message: "Correo actualizado. Inicia sesión con el correo nuevo." } };
    } catch (error) {
        try { await connection.rollback(); } catch { /* conserva el error original */ }
        if (missingTable(error)) return INVALID_LINK;
        throw error;
    } finally {
        connection.release();
    }
}

/** Cambio de nombre por el Administrador, con registro en auditoría. */
async function updateAccountName(db, { userId, nombre, actorId }) {
    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();
        const [users] = await connection.query("SELECT id_usuario, nombre FROM usuario WHERE id_usuario = ? FOR UPDATE", [Number(userId)]);
        if (!users.length) {
            await connection.rollback();
            return { status: 404, body: { ok: false, message: "Usuario no encontrado." } };
        }
        if (users[0].nombre === nombre) {
            await connection.rollback();
            return { status: 200, unchanged: true, body: { ok: true, unchanged: true, message: "El nombre no cambió." } };
        }
        await connection.query("UPDATE usuario SET nombre = ? WHERE id_usuario = ?", [nombre, Number(userId)]);
        await recordAdminAccountEvent(connection, {
            targetUserId: Number(userId), operation: "account_updated", outcome: "success",
            operatorIdentityClaim: String(Number(actorId)), operatorIdentitySource: "admin_session", authorizationReference: null, reason: null
        });
        await connection.commit();
        return { status: 200, body: { ok: true, message: "Nombre actualizado." } };
    } catch (error) {
        try { await connection.rollback(); } catch { /* conserva el error original */ }
        throw error;
    } finally {
        connection.release();
    }
}

module.exports = { requestEmailChange, confirmEmailChange, updateAccountName, EMAIL_CHANGE_HOURS };
