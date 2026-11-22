"use strict";

// Read-only diagnosis of the MySQL configuration in .env (npm run db:check).
// Executes only SELECT/SHOW statements and never prints passwords. It refuses
// the institutional schema "piar", like the backend itself.
require("../backend/config");

const mysql = require("mysql2/promise");
const { buildDatabaseConfig } = require("../backend/database-config");
const { migrationStatus } = require("../backend/migrations");

// Objects that identify each migration even when schema_migrations is absent.
const MARKERS = [
    ["000-001", "table", "usuario"], ["000-001", "table", "piar_docente"],
    ["002", "column", "usuario.rechazado_por_usuario_id"],
    ["003", "table", "external_identity"],
    ["006", "column", "piar.entrega_pedagogica"],
    ["008", "table", "piar_barrera"],
    ["009", "table", "admin_account_audit"],
    ["010", "column", "usuario.decision_reason"],
    ["011", "column", "usuario.password_change_required"],
    ["012", "table", "evento_seguridad"],
    ["013", "table", "piar_dua"]
];

async function main() {
    let config;
    try {
        config = buildDatabaseConfig(process.env);
    } catch (error) {
        console.log(`Configuración incompleta o inválida: ${error.message}`);
        process.exitCode = 1;
        return;
    }
    if (config.database.toLowerCase() === "piar") {
        console.log("DB_NAME apunta al esquema institucional 'piar'; el diagnóstico no se conecta a él.");
        process.exitCode = 1;
        return;
    }
    console.log(`Destino: ${config.host}:${config.port} / esquema ${config.database} / usuario ${config.user}`);

    let connection;
    try {
        connection = await mysql.createConnection({ host: config.host, port: config.port, user: config.user, password: config.password, connectTimeout: 5000 });
    } catch (error) {
        const hints = { ER_ACCESS_DENIED_ERROR: "usuario o contraseña rechazados por MySQL", ECONNREFUSED: "MySQL no acepta conexiones en ese host/puerto", ETIMEDOUT: "MySQL no respondió a tiempo" };
        console.log(`Conexión fallida: ${error.code || error.name}${hints[error.code] ? ` (${hints[error.code]})` : ""}`);
        process.exitCode = 1;
        return;
    }
    try {
        const [[server]] = await connection.query("SELECT VERSION() AS version, @@time_zone AS tz, @@system_time_zone AS system_tz, CURRENT_USER() AS cuenta");
        console.log(`Conectado: MySQL ${server.version}, zona ${server.tz}/${server.system_tz}, cuenta ${server.cuenta}`);

        const [grants] = await connection.query("SHOW GRANTS FOR CURRENT_USER()");
        for (const row of grants) console.log(`Permiso: ${String(Object.values(row)[0]).replace(/ IDENTIFIED BY .*/i, "")}`);

        const [schemas] = await connection.query("SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [config.database]);
        if (!schemas.length) {
            console.log(`El esquema ${config.database} no existe o esta cuenta no tiene permisos para verlo.`);
            process.exitCode = 1;
            return;
        }
        await connection.changeUser({ database: config.database });

        const [tables] = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()");
        const [columns] = await connection.query("SELECT CONCAT(TABLE_NAME, '.', COLUMN_NAME) AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()");
        const tableSet = new Set(tables.map(row => row.name));
        const columnSet = new Set(columns.map(row => row.name));
        console.log(`Tablas en ${config.database}: ${tableSet.size}`);
        for (const [migration, kind, object] of MARKERS) {
            const present = kind === "table" ? tableSet.has(object) : columnSet.has(object);
            console.log(`  ${present ? "OK      " : "FALTA   "} migración ${migration}: ${kind === "table" ? "tabla" : "columna"} ${object}`);
        }

        const status = await migrationStatus(connection, undefined, { readOnly: true });
        const pending = status.filter(item => item.state !== "aplicada");
        console.log(`Registro schema_migrations: ${status.some(item => item.state === "sin registro") ? "no existe (base migrada a mano o vacía)" : `${status.length - pending.length}/${status.length} aplicadas`}`);

        if (tableSet.has("usuario")) {
            const [roles] = await connection.query("SELECT rol, estado, COUNT(*) AS total FROM usuario GROUP BY rol, estado ORDER BY rol, estado");
            console.log(roles.length ? "Cuentas (solo conteos):" : "Cuentas: la tabla usuario está vacía.");
            for (const row of roles) console.log(`  ${row.rol} / ${row.estado}: ${row.total}`);
        }
    } finally {
        await connection.end();
    }
}

main().catch(error => {
    console.log(`Diagnóstico interrumpido: ${error.code || error.name}`);
    process.exitCode = 1;
});
