"use strict";

const nodemailer = require("nodemailer");

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const developmentOutbox = [];

function validateMessage(to, subject, text) {
    if (typeof to !== "string" || to.length > 254 || !EMAIL_RE.test(to)) throw new Error("Email recipient is invalid.");
    if (typeof subject !== "string" || !subject.trim() || subject.length > 200 || /[\r\n]/.test(subject)) throw new Error("Email subject is invalid.");
    if (typeof text !== "string" || !text.trim() || text.length > 20000) throw new Error("Email message is invalid.");
}

function senderAddress() {
    const from = String(process.env.EMAIL_FROM || "").trim();
    if (!EMAIL_RE.test(from) || /[\r\n]/.test(from)) throw new Error("Email sender is not configured.");
    return from;
}

function assertPersistentEmailTransport(env = process.env) {
    const mode = String(env.EMAIL_TRANSPORT || "api").toLowerCase();
    if (mode === "memory") throw new Error("El transporte memory solo es válido dentro del servidor local; no se puede usar para el bootstrap CLI.");
    if (mode === "smtp") {
        const host = String(env.EMAIL_SMTP_HOST || "").trim();
        const port = Number(env.EMAIL_SMTP_PORT || 587);
        const user = String(env.EMAIL_SMTP_USER || "");
        const password = String(env.EMAIL_SMTP_PASSWORD || "");
        const secure = String(env.EMAIL_SMTP_SECURE || "false").toLowerCase() === "true";
        if (!EMAIL_RE.test(String(env.EMAIL_FROM || "")) || !host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !password) {
            throw new Error("SMTP no está configurado para entregar la verificación del Administrador.");
        }
        if ((port === 465) !== secure) throw new Error("La configuración TLS de SMTP no coincide con el puerto.");
        return mode;
    }
    if (mode === "api") {
        let endpoint;
        try { endpoint = new URL(String(env.PASSWORD_RESET_DELIVERY_URL || "")); } catch { throw new Error("El transporte API de correo no está configurado."); }
        if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || !String(env.PASSWORD_RESET_DELIVERY_SECRET || "")) {
            throw new Error("El transporte API de correo requiere HTTPS y credencial configurada.");
        }
        return mode;
    }
    throw new Error("Configura un transporte SMTP o API persistente para verificar el Administrador.");
}

async function deliverEmail(to, subject, text) {
    validateMessage(to, subject, text);
    const mode = String(process.env.EMAIL_TRANSPORT || "api").toLowerCase();
    if (mode === "memory") return sendMemory(to, subject, text);
    if (mode === "smtp") return sendSmtp(to, subject, text);
    if (mode === "api") return sendApi(to, subject, text);
    throw new Error("Email transport is not configured.");
}

function sendMemory(to, subject, text) {
    const secret = String(process.env.EMAIL_DEV_OUTBOX_SECRET || "");
    if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test" || secret.length < 32 || /^replace[_-]/i.test(secret)) {
        throw new Error("Development email outbox is not enabled.");
    }
    const now = Date.now();
    purgeDevelopmentOutbox(now);
    developmentOutbox.push({ to, subject, text, createdAt: now });
    while (developmentOutbox.length > 20) developmentOutbox.shift();
}

function takeDevelopmentOutbox(providedSecret) {
    const expected = String(process.env.EMAIL_DEV_OUTBOX_SECRET || "");
    const supplied = String(providedSecret || "");
    const a = Buffer.from(expected);
    const b = Buffer.from(supplied);
    if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test" || expected.length < 32 || /^replace[_-]/i.test(expected) || a.length !== b.length || !require("node:crypto").timingSafeEqual(a, b)) {
        throw new Error("Development outbox is not available.");
    }
    purgeDevelopmentOutbox(Date.now());
    const messages = developmentOutbox.splice(0, developmentOutbox.length);
    return messages.map(message => ({ ...message, createdAt: new Date(message.createdAt).toISOString() }));
}

function purgeDevelopmentOutbox(now) {
    while (developmentOutbox.length && now - developmentOutbox[0].createdAt > 15 * 60 * 1000) developmentOutbox.shift();
}

async function sendApi(to, subject, text) {
    const endpoint = String(process.env.PASSWORD_RESET_DELIVERY_URL || "").trim();
    const secret = String(process.env.PASSWORD_RESET_DELIVERY_SECRET || "");
    let parsed;
    try { parsed = new URL(endpoint); } catch { throw new Error("Email delivery is not configured."); }
    const localTest = process.env.NODE_ENV === "test" && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
    if ((parsed.protocol !== "https:" && !localTest) || !secret || parsed.username || parsed.password) {
        throw new Error("Email delivery is not configured.");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch(parsed, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
            body: JSON.stringify({ to, subject, text }),
            signal: controller.signal,
            redirect: "error"
        });
        if (!response.ok) throw new Error("Email delivery failed.");
    } catch {
        throw new Error("Email delivery failed.");
    } finally {
        clearTimeout(timer);
    }
}

// Etapas SMTP que Nodemailer informa en error.command. Solo se reportan estas;
// cualquier otro valor se descarta para no reflejar texto arbitrario.
const SMTP_STAGES = Object.freeze({
    CONN: "conexión con el servidor",
    EHLO: "saludo SMTP",
    HELO: "saludo SMTP",
    LHLO: "saludo SMTP",
    STARTTLS: "cifrado STARTTLS",
    "AUTH PLAIN": "autenticación",
    "AUTH LOGIN": "autenticación",
    "AUTH CRAM-MD5": "autenticación",
    "AUTH XOAUTH2": "autenticación",
    "MAIL FROM": "remitente",
    "RCPT TO": "destinatario",
    DATA: "envío del mensaje",
    RSET: "reinicio de sesión",
    API: "preparación local del envío"
});
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

class EmailTransportError extends Error {
    constructor(message, diagnostic) {
        super(message);
        this.name = "EmailTransportError";
        // Sin "code" ni "cause": el error original contiene la respuesta completa
        // del servidor y no debe viajar con este objeto.
        this.diagnostic = diagnostic;
    }
}

// Extrae solo datos técnicos de forma fija: códigos con formato de constante,
// etapa de una lista cerrada, código SMTP numérico, código extendido (RFC 3463)
// y la clave de ayuda de Gmail (?p=Palabra). Nunca copia mensajes ni respuestas.
function smtpDiagnostic(error) {
    const source = error && typeof error === "object" ? error : {};
    const code = typeof source.code === "string" && SAFE_ERROR_CODE.test(source.code) ? source.code : null;
    const originalCode = typeof source.originalCode === "string" && SAFE_ERROR_CODE.test(source.originalCode) ? source.originalCode : null;
    const command = Object.hasOwn(SMTP_STAGES, source.command) ? source.command : null;
    const responseCode = Number.isInteger(source.responseCode) && source.responseCode >= 200 && source.responseCode <= 599 ? source.responseCode : null;
    const response = typeof source.response === "string" ? source.response : "";
    const enhancedMatch = response.match(/(?:^|[\s-])([245]\.\d{1,3}\.\d{1,3})(?=\s|$)/);
    const helpMatch = response.match(/[?&]p=([A-Za-z]{1,40})(?![A-Za-z])/);
    return Object.freeze({
        code,
        originalCode,
        command,
        stage: command ? SMTP_STAGES[command] : "desconocida",
        responseCode,
        enhancedCode: enhancedMatch ? enhancedMatch[1] : null,
        helpKey: helpMatch ? helpMatch[1] : null
    });
}

function smtpDiagnosticHint(diagnostic) {
    const { code, originalCode, responseCode, enhancedCode, helpKey } = diagnostic || {};
    if (enhancedCode === "5.7.9" || helpKey === "InvalidSecondFactor") return "Gmail exige una contraseña de aplicación; no uses la contraseña normal de la cuenta.";
    if (enhancedCode === "5.7.14" || helpKey === "WebLoginRequired") return "Gmail bloqueó el inicio de sesión; confírmalo desde el navegador en la configuración de seguridad de la cuenta.";
    if (code === "EAUTH" && (responseCode === 535 || enhancedCode === "5.7.8" || helpKey === "BadCredentials")) return "Gmail rechazó la cuenta o la contraseña de aplicación; revísalas o genera una nueva contraseña de aplicación.";
    if (code === "EAUTH" || code === "ENOAUTH") return "El servidor rechazó la autenticación SMTP.";
    if (code === "EDNS" || originalCode === "ENOTFOUND" || originalCode === "EAI_AGAIN") return "No se pudo resolver el nombre del servidor SMTP.";
    if (code === "ETIMEDOUT") return "El servidor SMTP no respondió a tiempo; revisa la red o el firewall.";
    if (code === "ETLS" || /CERT|SELF_SIGNED|TLS|SSL/.test(String(originalCode || ""))) return "Falló la conexión cifrada TLS; revisa el puerto, el modo seguro o un antivirus que inspeccione el tráfico.";
    if (code === "ECONNECTION" || code === "ESOCKET") return "Se interrumpió la conexión con el servidor SMTP.";
    if (code === "EENVELOPE") return "El servidor rechazó el remitente o el destinatario.";
    return "Error SMTP no clasificado.";
}

// Texto en español para mostrar en consola; solo usa los campos depurados.
function describeSmtpDiagnostic(diagnostic) {
    if (!diagnostic) return "Sin diagnóstico SMTP disponible.";
    const parts = [
        `etapa: ${diagnostic.stage}${diagnostic.command ? ` (${diagnostic.command})` : ""}`,
        `código: ${diagnostic.code || "-"}${diagnostic.originalCode ? ` / ${diagnostic.originalCode}` : ""}`,
        `código SMTP: ${diagnostic.responseCode || "-"}`,
        `código extendido: ${diagnostic.enhancedCode || "-"}`
    ];
    if (diagnostic.helpKey) parts.push(`ayuda de Gmail: ${diagnostic.helpKey}`);
    return `${parts.join(" | ")}. ${smtpDiagnosticHint(diagnostic)}`;
}

async function sendSmtp(to, subject, text) {
    const transport = createSmtpTransport();
    try {
        await transport.sendMail({ from: senderAddress(), to, subject, text });
    } catch (error) {
        throw new EmailTransportError("No se pudo entregar el correo por SMTP.", smtpDiagnostic(error));
    } finally {
        transport.close();
    }
}

function createSmtpTransport(env = process.env) {
    const host = String(env.EMAIL_SMTP_HOST || "").trim();
    const port = Number(env.EMAIL_SMTP_PORT || 587);
    const user = String(env.EMAIL_SMTP_USER || "");
    const password = String(env.EMAIL_SMTP_PASSWORD || "");
    const secure = String(env.EMAIL_SMTP_SECURE || "false").toLowerCase() === "true";
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !password) throw new Error("SMTP transport is not configured.");
    if ((port === 465) !== secure) throw new Error("SMTP TLS mode does not match the configured port.");
    return nodemailer.createTransport({
        host, port, secure, requireTLS: !secure, auth: { user, pass: password },
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
        tls: { rejectUnauthorized: true }
    });
}

async function verifySmtpTransport() {
    const transport = createSmtpTransport();
    try {
        await transport.verify();
    } catch (error) {
        throw new EmailTransportError("No se pudo verificar la conexión SMTP. Revisa servidor, puerto, usuario y contraseña de aplicación.", smtpDiagnostic(error));
    } finally {
        transport.close();
    }
}

module.exports = {
    deliverEmail, validateMessage, sendSmtp, verifySmtpTransport, takeDevelopmentOutbox, assertPersistentEmailTransport,
    EmailTransportError, smtpDiagnostic, describeSmtpDiagnostic
};
