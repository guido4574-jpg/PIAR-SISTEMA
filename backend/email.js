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
    if (mode === "resend") {
        // Lanza un error genérico (sin valores) si falta la clave, el remitente o la URL es insegura.
        resendSettings(env);
        resendSender(env);
        return mode;
    }
    throw new Error("Configura un transporte SMTP, Resend o API persistente.");
}

async function deliverEmail(to, subject, text) {
    validateMessage(to, subject, text);
    const mode = String(process.env.EMAIL_TRANSPORT || "api").toLowerCase();
    if (mode === "memory") return sendMemory(to, subject, text);
    if (mode === "smtp") return sendSmtp(to, subject, text);
    if (mode === "resend") return sendResend(to, subject, text);
    if (mode === "api") return sendApi(to, subject, text);
    throw new Error("Email transport is not configured.");
}

// Resend (API HTTPS, https://resend.com/docs/api-reference/emails/send-email). Evita SMTP,
// que Railway bloquea en los planes Trial y Hobby. La clave y el remitente llegan por
// variables de entorno; nunca se registran ni se incluyen en los errores.
const RESEND_API_ORIGIN = "https://api.resend.com";
// Resend rechaza con 403 las peticiones sin User-Agent.
// Valor genérico: identifica la aplicación sin datos del proyecto ni de la institución.
const RESEND_USER_AGENT = "piar-mailer/1.0";
const RESEND_KEY = /^re_[A-Za-z0-9_-]{16,200}$/;
const RESEND_ERROR_NAME = /^[a-z][a-z0-9_]{1,63}$/;
const SENDER_NAME_FORBIDDEN = /[\r\n<>"\\]/;

function emailTimeoutMs(env = process.env) {
    const value = Number(env.EMAIL_TIMEOUT_MS || 10000);
    if (!Number.isInteger(value) || value < 100 || value > 30000) throw new Error("EMAIL_TIMEOUT_MS debe ser un entero entre 100 y 30000.");
    return value;
}

function resendSettings(env = process.env) {
    const apiKey = String(env.RESEND_API_KEY || "").trim();
    if (!RESEND_KEY.test(apiKey)) throw new Error("Resend no está configurado: falta RESEND_API_KEY o su formato no es válido.");
    // RESEND_API_BASE_URL solo existe para pruebas locales; en producción se usa siempre la API oficial.
    let base;
    try { base = new URL(String(env.RESEND_API_BASE_URL || RESEND_API_ORIGIN).trim()); } catch { throw new Error("Resend no está configurado: URL de la API no válida."); }
    const localTest = env.NODE_ENV === "test" && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(base.hostname);
    if (base.username || base.password || (base.protocol !== "https:" && !localTest) || (env.NODE_ENV === "production" && base.origin !== RESEND_API_ORIGIN)) {
        throw new Error("Resend no está configurado: la API debe ser la oficial por HTTPS.");
    }
    return { apiKey, origin: base.origin, timeoutMs: emailTimeoutMs(env) };
}

// "Nombre <correo>" si EMAIL_FROM_NAME existe; el correo debe pertenecer a un dominio verificado en Resend.
function resendSender(env = process.env) {
    const from = String(env.EMAIL_FROM || "").trim();
    if (!EMAIL_RE.test(from) || /[\r\n]/.test(from)) throw new Error("Email sender is not configured.");
    const name = String(env.EMAIL_FROM_NAME || "").trim();
    if (!name) return from;
    if (name.length > 80 || SENDER_NAME_FORBIDDEN.test(name)) throw new Error("EMAIL_FROM_NAME no es válido.");
    return `${name} <${from}>`;
}

function senderDomain(env = process.env) {
    return String(env.EMAIL_FROM || "").trim().toLowerCase().split("@")[1] || "";
}

// Solo el nombre del error (formato de constante en minúsculas) y el código HTTP; nunca el mensaje,
// que puede repetir direcciones o dominios.
async function resendErrorDiagnostic(response, stage) {
    let name = null;
    try {
        const body = await response.json();
        if (typeof body?.name === "string" && RESEND_ERROR_NAME.test(body.name)) name = body.name;
    } catch { /* cuerpo no JSON */ }
    const retryAfter = Number(response.headers.get("retry-after"));
    return Object.freeze({ provider: "resend", stage, code: null, responseCode: response.status, name, retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : null });
}

async function resendRequest(settings, path, init, stage) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
    try {
        return await fetch(`${settings.origin}${path}`, {
            ...init,
            headers: { Authorization: `Bearer ${settings.apiKey}`, "User-Agent": RESEND_USER_AGENT, Accept: "application/json", ...(init.headers || {}) },
            signal: controller.signal,
            redirect: "error"
        });
    } catch {
        const timedOut = controller.signal.aborted;
        throw new EmailTransportError(timedOut ? "Resend no respondió a tiempo." : "No se pudo conectar con Resend.",
            Object.freeze({ provider: "resend", stage, code: timedOut ? "ETIMEDOUT" : "ECONNECTION", responseCode: null, name: null, retryAfterSeconds: null }));
    } finally {
        clearTimeout(timer);
    }
}

async function sendResend(to, subject, text, env = process.env) {
    const settings = resendSettings(env);
    const from = resendSender(env);
    const response = await resendRequest(settings, "/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text })
    }, "envío");
    if (!response.ok) {
        const diagnostic = await resendErrorDiagnostic(response, "envío");
        // Registro operativo sin datos personales ni secretos: solo código y nombre del error.
        console.error(`Resend rechazó el envío: HTTP ${diagnostic.responseCode}${diagnostic.name ? ` (${diagnostic.name})` : ""}.`);
        throw new EmailTransportError("Resend rechazó el envío del correo.", diagnostic);
    }
    let body = null;
    try { body = await response.json(); } catch { /* se valida abajo */ }
    if (typeof body?.id !== "string" || !body.id) {
        throw new EmailTransportError("Resend respondió sin identificador de mensaje.", Object.freeze({ provider: "resend", stage: "envío", code: "EINVALIDRESPONSE", responseCode: response.status, name: null, retryAfterSeconds: null }));
    }
    return { id: body.id };
}

// Comprobación sin envío: el dominio de EMAIL_FROM debe figurar como "verified" en Resend.
// Requiere una clave con acceso completo; una clave de solo envío responde 401 restricted_api_key.
async function verifyResendSender(env = process.env) {
    const settings = resendSettings(env);
    resendSender(env);
    const domain = senderDomain(env);
    if (domain === "resend.dev") return { domain, status: "prueba", sendsOnlyToAccountOwner: true };
    const response = await resendRequest(settings, "/domains", { method: "GET" }, "verificación del dominio");
    if (!response.ok) throw new EmailTransportError("No se pudo consultar los dominios en Resend.", await resendErrorDiagnostic(response, "verificación del dominio"));
    let body = null;
    try { body = await response.json(); } catch { /* se valida abajo */ }
    const domains = Array.isArray(body?.data) ? body.data : [];
    const match = domains.find(item => String(item?.name || "").toLowerCase() === domain);
    return { domain, status: match ? String(match.status || "desconocido") : "no_registrado", sendsOnlyToAccountOwner: false };
}

function resendDiagnosticHint(diagnostic) {
    const { code, responseCode, name } = diagnostic || {};
    if (code === "ETIMEDOUT") return "Resend no respondió dentro de EMAIL_TIMEOUT_MS; revisa la red o vuelve a intentarlo.";
    if (code === "ECONNECTION") return "No hubo conexión HTTPS con api.resend.com; revisa la salida a internet.";
    if (name === "restricted_api_key") return "La clave es de solo envío (recomendado en producción). Para comprobar el dominio usa una clave de acceso completo solo en esta prueba, o revisa el estado en el panel de Resend.";
    if (responseCode === 401 || name === "missing_api_key" || (responseCode === 400 && name === "validation_error")) return "Resend rechazó la clave: revisa RESEND_API_KEY o crea una nueva.";
    if (responseCode === 403 && name === "validation_error") return "El dominio de EMAIL_FROM no está verificado, o se usa onboarding@resend.dev con un destinatario distinto del dueño de la cuenta.";
    if (responseCode === 403) return "Resend denegó la operación (clave suspendida, inactiva o sin permisos, o falta User-Agent).";
    if (name === "daily_quota_exceeded") return "Se agotó la cuota diaria del plan (100 correos en el gratuito); se reinicia a medianoche UTC.";
    if (name === "monthly_quota_exceeded") return "Se agotó la cuota mensual del plan (3.000 correos en el gratuito).";
    if (responseCode === 429) return "Se superó el límite de velocidad de Resend; vuelve a intentarlo en unos segundos.";
    if (responseCode === 422) return "Resend rechazó los datos del mensaje (campo obligatorio o parámetro no válido).";
    if (responseCode >= 500) return "Error temporal de Resend; vuelve a intentarlo más tarde.";
    if (code === "EINVALIDRESPONSE") return "La respuesta de Resend no tuvo el formato esperado.";
    return "Error de Resend no clasificado.";
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
    if (diagnostic.provider === "resend") {
        const parts = [`etapa: ${diagnostic.stage}`, `código: ${diagnostic.code || "-"}`, `HTTP: ${diagnostic.responseCode || "-"}`, `error de Resend: ${diagnostic.name || "-"}`];
        if (diagnostic.retryAfterSeconds !== null && diagnostic.retryAfterSeconds !== undefined) parts.push(`reintentar en: ${diagnostic.retryAfterSeconds} s`);
        return `${parts.join(" | ")}. ${resendDiagnosticHint(diagnostic)}`;
    }
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
    EmailTransportError, smtpDiagnostic, describeSmtpDiagnostic,
    sendResend, verifyResendSender, resendSettings, resendSender, RESEND_API_ORIGIN, RESEND_USER_AGENT
};
