"use strict";

// Validación de la configuración de ejecución. En producción el servidor no
// arranca si una variable deja el sistema inseguro o dependiente de localhost.
// Los mensajes nombran variables, nunca sus valores.
const { assertPersistentEmailTransport } = require("./email");

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

function isProduction(env = process.env) {
    return String(env.NODE_ENV || "").trim() === "production";
}

// Railway (y cualquier contenedor) necesita escuchar en todas las interfaces;
// en local se mantiene loopback para no exponer el servidor en la red.
function resolveListenHost(env = process.env) {
    const configured = String(env.HOST || "").trim();
    if (configured) return configured;
    return isProduction(env) ? "0.0.0.0" : "127.0.0.1";
}

function resolveListenPort(env = process.env) {
    const port = Number(env.PORT || 8080);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT debe ser un puerto TCP válido entre 1 y 65535.");
    return port;
}

function parseUrl(value) {
    try { return new URL(String(value || "").trim()); } catch { return null; }
}

function productionConfigReport(env = process.env) {
    const errors = [];
    const warnings = [];
    const base = parseUrl(env.APP_BASE_URL);
    if (!base) errors.push("APP_BASE_URL es obligatoria (URL pública con https).");
    else {
        if (base.protocol !== "https:") errors.push("APP_BASE_URL debe usar https.");
        if (LOOPBACK_HOSTS.has(base.hostname)) errors.push("APP_BASE_URL no puede apuntar a localhost.");
        if (base.pathname !== "/" || base.search || base.hash) errors.push("APP_BASE_URL debe ser solo el origen, sin ruta.");
    }

    const origins = String(env.CORS_ORIGIN || "").split(",").map(value => value.trim()).filter(Boolean);
    if (!origins.length) errors.push("CORS_ORIGIN es obligatoria en producción.");
    for (const origin of origins) {
        const parsed = parseUrl(origin);
        if (!parsed || parsed.protocol !== "https:" || LOOPBACK_HOSTS.has(parsed.hostname)) {
            errors.push("CORS_ORIGIN solo admite orígenes https públicos.");
            break;
        }
    }
    if (base && origins.length && !origins.includes(base.origin)) errors.push("CORS_ORIGIN debe incluir el origen de APP_BASE_URL.");

    const dbHost = String(env.DB_HOST || "").trim().toLowerCase();
    if (LOOPBACK_HOSTS.has(dbHost)) errors.push("DB_HOST no puede ser localhost en producción.");
    const dbName = String(env.DB_NAME || "").trim().toLowerCase();
    if (/^piar_(test|dev)(_|$)/.test(dbName)) errors.push("DB_NAME no puede ser un esquema de pruebas o desarrollo en producción.");

    try { assertPersistentEmailTransport(env); } catch {
        errors.push("El correo debe usar EMAIL_TRANSPORT=resend (RESEND_API_KEY, EMAIL_FROM), smtp (EMAIL_SMTP_*, EMAIL_FROM) o api con HTTPS; memory no está permitido.");
    }
    if (String(env.EMAIL_TRANSPORT || "").trim().toLowerCase() === "resend" && /@resend\.dev$/i.test(String(env.EMAIL_FROM || "").trim())) {
        warnings.push("EMAIL_FROM usa el remitente de prueba de Resend: solo entrega al correo del dueño de la cuenta. Verifica un dominio propio.");
    }
    if (String(env.EMAIL_DEV_OUTBOX_SECRET || "").trim()) warnings.push("EMAIL_DEV_OUTBOX_SECRET no se usa en producción; retírala.");
    if (!String(env.TRUSTED_PROXIES || "").trim()) {
        warnings.push("TRUSTED_PROXIES está vacía: detrás del proxy de Railway todos los clientes comparten la misma IP en los límites de intentos.");
    }
    const store = String(env.RATE_LIMIT_STORE || "memory").trim().toLowerCase();
    if (store === "memory") warnings.push("RATE_LIMIT_STORE=memory: los contadores se reinician con cada despliegue (válido para una sola instancia).");
    return { errors, warnings };
}

// Lanza un error con todos los problemas encontrados; devuelve las advertencias.
function assertRuntimeConfig(env = process.env) {
    resolveListenPort(env);
    if (!isProduction(env)) return [];
    const { errors, warnings } = productionConfigReport(env);
    if (errors.length) {
        const error = new Error(`Configuración de producción no válida:\n- ${errors.join("\n- ")}`);
        error.code = "PIAR_PRODUCTION_CONFIG";
        throw error;
    }
    return warnings;
}

module.exports = { isProduction, resolveListenHost, resolveListenPort, productionConfigReport, assertRuntimeConfig };
