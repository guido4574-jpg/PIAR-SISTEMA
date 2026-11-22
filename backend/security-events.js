"use strict";

const crypto = require("node:crypto");
const net = require("node:net");

// Authentication and security events (table evento_seguridad, migration 012).
// No passwords, tokens or clear-text emails are stored: emails are hashed and
// client addresses are truncated to their network prefix.
const EVENT_TYPES = Object.freeze([
    "login_exitoso", "login_fallido", "login_bloqueado", "logout",
    "registro_solicitado", "registro_bloqueado", "correo_verificado", "verificacion_reenviada",
    "reset_solicitado", "reset_completado", "reset_fallido", "cambio_contrasena_inicial",
    "oidc_login", "oidc_fallido", "oidc_vinculada", "solicitud_limitada", "correo_cambiado",
    // Decisión D5: desvinculación y reautenticación para gestionar identidades externas.
    "oidc_desvinculada", "reautenticacion_fallida"
]);
const OUTCOMES = Object.freeze(["exito", "fallo", "bloqueado"]);

function hashEmail(email) {
    const normalized = String(email || "").trim().toLowerCase();
    return normalized ? crypto.createHash("sha256").update(normalized).digest("hex") : null;
}

function networkPrefix(address) {
    const value = String(address || "");
    const family = net.isIP(value);
    if (family === 4) return `${value.split(".").slice(0, 3).join(".")}.0/24`;
    if (family === 6) {
        const expanded = value.includes("::") ? expandIpv6(value) : value.split(":");
        return `${expanded.slice(0, 3).join(":")}::/48`;
    }
    return null;
}

function expandIpv6(value) {
    const [head, tail] = value.split("::");
    const left = head ? head.split(":") : [];
    const right = tail ? tail.split(":") : [];
    return [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
}

function createSecurityEventRecorder(db, { logger = console } = {}) {
    return async function recordSecurityEvent({ type, outcome, userId = null, email = null, ip = null, detail = null }) {
        if (!EVENT_TYPES.includes(type) || !OUTCOMES.includes(outcome)) {
            throw new TypeError(`Evento de seguridad no válido: ${type}/${outcome}`);
        }
        try {
            await db.promise().query(
                "INSERT INTO evento_seguridad (tipo, resultado, id_usuario, correo_hash, red_origen, detalle) VALUES (?, ?, ?, ?, ?, ?)",
                [type, outcome, Number.isSafeInteger(Number(userId)) && userId !== null ? Number(userId) : null,
                    email ? hashEmail(email) : null, networkPrefix(ip), detail ? String(detail).slice(0, 120) : null]
            );
        } catch (error) {
            // Auditing must never break authentication; report without sensitive context.
            logger.error(`No se pudo registrar el evento de seguridad (${error.code || error.name || "ERROR"}).`);
        }
    };
}

module.exports = { createSecurityEventRecorder, hashEmail, networkPrefix, EVENT_TYPES };
