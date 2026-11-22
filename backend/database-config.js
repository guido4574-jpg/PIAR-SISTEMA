"use strict";

const REQUIRED_DATABASE_SETTINGS = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"];
const LOCAL_DATABASE_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

// allowRoot solo lo usa el ejecutor de migraciones remotas con una cuenta
// migradora explícita; la aplicación siempre exige un usuario dedicado.
function buildDatabaseConfig(env = process.env, { allowRoot = false } = {}) {
    const missing = REQUIRED_DATABASE_SETTINGS.filter(name => !String(env[name] || "").trim());
    if (missing.length) throw new Error(`Configuración MySQL incompleta: ${missing.join(", ")}.`);
    if (!allowRoot && String(env.DB_USER).trim().toLowerCase() === "root") {
        throw new Error("La aplicación requiere un usuario MySQL dedicado; no use root.");
    }
    const port = Number(env.DB_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("DB_PORT debe ser un puerto TCP válido entre 1 y 65535.");
    }
    const connectionLimit = Number(env.DB_CONNECTION_LIMIT || 10);
    if (!Number.isInteger(connectionLimit) || connectionLimit < 1 || connectionLimit > 100) {
        throw new Error("DB_CONNECTION_LIMIT debe ser un entero entre 1 y 100.");
    }
    const ssl = buildSslOptions(env);
    return {
        host: String(env.DB_HOST).trim(),
        port,
        database: String(env.DB_NAME).trim(),
        user: String(env.DB_USER).trim(),
        password: env.DB_PASSWORD,
        connectionLimit,
        ...(ssl ? { ssl } : {})
    };
}

// DB_SSL: off (por omisión), required (cifra la conexión sin verificar la
// identidad del servidor) o verify (cifra y verifica con DB_SSL_CA, en PEM).
// Dentro de la red privada de Railway no es necesario; sí lo es al conectar
// por el proxy TCP público desde otro equipo.
function buildSslOptions(env = process.env) {
    const mode = String(env.DB_SSL || "off").trim().toLowerCase();
    if (["", "off", "false", "0"].includes(mode)) return null;
    if (mode === "required") return { minVersion: "TLSv1.2", rejectUnauthorized: false };
    if (mode === "verify") {
        // Railway guarda variables en una línea: se admiten saltos escritos como \n.
        const ca = String(env.DB_SSL_CA || "").replace(/\\n/g, "\n").trim();
        if (!ca.includes("-----BEGIN CERTIFICATE-----")) throw new Error("DB_SSL=verify requiere DB_SSL_CA con el certificado de la autoridad en formato PEM.");
        return { minVersion: "TLSv1.2", rejectUnauthorized: true, ca };
    }
    throw new Error("DB_SSL admite off, required o verify.");
}

function assertLocalMigrationTarget(config) {
    const host = String(config?.host || "").trim().toLowerCase();
    const database = String(config?.database || "").trim().toLowerCase();
    if (!LOCAL_DATABASE_HOSTS.has(host) || !/^piar_(?:dev|test)(?:_[a-z0-9]+)*$/.test(database)) {
        throw new Error("Las migraciones solo se permiten en esquemas piar_dev* o piar_test* con MySQL en loopback.");
    }
    return true;
}

module.exports = { buildDatabaseConfig, buildSslOptions, assertLocalMigrationTarget, REQUIRED_DATABASE_SETTINGS };
