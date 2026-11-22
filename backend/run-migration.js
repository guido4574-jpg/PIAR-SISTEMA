"use strict";

// Ejecutor de migraciones versionadas.
//   node backend/run-migration.js                  -> aplica las pendientes (solo piar_dev*/piar_test* en loopback)
//   node backend/run-migration.js --status         -> lista aplicada/pendiente/modificada (solo lectura)
//   node backend/run-migration.js <archivo.sql>    -> aplica un archivo (solo local)
//   node backend/run-migration.js --remote [--status]
//       -> base remota (Railway). Exige PIAR_MIGRATION_CONFIRM_DATABASE igual a
//          DB_NAME, rechaza loopback y esquemas de prueba, y puede usar una
//          cuenta migradora propia (MIGRATION_DB_USER / MIGRATION_DB_PASSWORD).
require("./config");

const path = require("node:path");
const fs = require("node:fs/promises");
const mysql = require("mysql2/promise");
const { buildDatabaseConfig, assertLocalMigrationTarget } = require("./database-config");
const { applyMigration, applyPendingMigrations, checksum, ensureMigrationTable, migrationStatus } = require("./migrations");

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const MIGRATION_LOCK = "piar_schema_migrations";

// Credenciales de la cuenta migradora: si existen, sustituyen a las de la
// aplicación solo para este proceso. La aplicación nunca usa esta cuenta.
function migrationEnvironment(env = process.env) {
    const user = String(env.MIGRATION_DB_USER || "").trim();
    if (!user) return env;
    if (!String(env.MIGRATION_DB_PASSWORD || "")) throw new Error("MIGRATION_DB_USER requiere MIGRATION_DB_PASSWORD.");
    return { ...env, DB_USER: user, DB_PASSWORD: env.MIGRATION_DB_PASSWORD };
}

function assertRemoteMigrationTarget(config, env = process.env) {
    const host = String(config.host || "").trim().toLowerCase();
    const database = String(config.database || "").trim();
    if (LOOPBACK_HOSTS.has(host)) {
        throw new Error("El modo --remote no admite bases en loopback; para bases locales use el modo local.");
    }
    if (/^piar(_(dev|test)(_[a-z0-9]+)*)?$/i.test(database)) {
        throw new Error("El modo --remote no admite los esquemas piar, piar_dev* ni piar_test*.");
    }
    if (String(env.PIAR_MIGRATION_CONFIRM_DATABASE || "") !== database) {
        throw new Error("Confirme la base de destino con PIAR_MIGRATION_CONFIRM_DATABASE igual a DB_NAME.");
    }
    return true;
}

function connectionSettings(argv, env = process.env) {
    const remote = argv.includes("--remote");
    const effectiveEnv = migrationEnvironment(env);
    // La cuenta root solo se admite en modo remoto y como cuenta migradora explícita.
    const allowRoot = remote && Boolean(String(env.MIGRATION_DB_USER || "").trim());
    const config = { ...buildDatabaseConfig(effectiveEnv, { allowRoot }), multipleStatements: false };
    if (remote) assertRemoteMigrationTarget(config, env);
    else assertLocalMigrationTarget(config);
    return { remote, config };
}

async function withMigrationLock(connection, action) {
    const [[{ acquired }]] = await connection.query("SELECT GET_LOCK(?, 10) AS acquired", [MIGRATION_LOCK]);
    if (Number(acquired) !== 1) throw new Error("Otra ejecución de migraciones tiene el bloqueo; no se aplicó ningún cambio.");
    try {
        return await action();
    } finally {
        await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK]);
    }
}

async function main(argv = process.argv.slice(2), env = process.env) {
    const { remote, config } = connectionSettings(argv, env);
    const args = argv.filter(arg => arg !== "--remote");
    const target = `${config.host}:${config.port}/${config.database}`;
    const connection = await mysql.createConnection(config);
    try {
        if (args[0] === "--status") {
            console.log(`Estado de migraciones en ${target}:`);
            for (const item of await migrationStatus(connection, undefined, { readOnly: true })) console.log(`${item.state.padEnd(12)} ${item.name}`);
            return;
        }
        if (args[0]) {
            if (remote) throw new Error("En modo --remote solo se aplican las migraciones versionadas completas, no archivos sueltos.");
            const filePath = path.resolve(process.cwd(), args[0]);
            const name = path.basename(filePath);
            const version = name.match(/^(\d{3})_/)?.[1];
            if (!version) throw new Error("El archivo debe llamarse NNN_nombre.sql.");
            const sql = await fs.readFile(filePath, "utf8");
            await ensureMigrationTable(connection);
            await applyMigration(connection, { version, name, sql, checksum: checksum(sql) });
            console.log(`Migración aplicada: ${name} en ${config.database}`);
            return;
        }
        const applied = await withMigrationLock(connection, () => applyPendingMigrations(connection));
        console.log(applied.length ? `Migraciones aplicadas en ${target}: ${applied.length}` : `Sin migraciones pendientes en ${target}.`);
    } finally {
        await connection.end();
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error("No se pudo aplicar la migración:", error.message);
        process.exitCode = 1;
    });
}

module.exports = { main, connectionSettings, migrationEnvironment, assertRemoteMigrationTarget };
