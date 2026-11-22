"use strict";

const readline = require("node:readline");
const net = require("node:net");
const mysqlCore = require("mysql2");
const mysql = require("mysql2/promise");
const {
    TARGET, assertMigrationIdentity, assertMigrationGrants, splitMigration,
    columnExists, verifyFreshContainer
} = require("./apply-local-admin-password-change-migration");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATOR = Object.freeze({ user: "piar_migrator" });
const MIGRATION_PATH = path.resolve(__dirname, "../database/migrations/011_admin_initial_password_change.sql");

function readLine(prompt) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Ejecuta este provisionador directamente en una terminal interactiva.");
    return new Promise(resolve => {
        const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
        terminal.question(prompt, answer => { terminal.close(); resolve(answer.trim()); });
    });
}

function readHidden(prompt) {
    return new Promise((resolve, reject) => {
        const input = process.stdin;
        if (!input.isTTY || typeof input.setRawMode !== "function") {
            reject(new Error("La contraseña debe ingresarse en una terminal interactiva con eco oculto."));
            return;
        }
        let value = "";
        const decoder = new (require("node:string_decoder").StringDecoder)("utf8");
        const finish = (error) => {
            input.removeListener("data", onData);
            input.setRawMode(false);
            input.pause();
            process.stdout.write("\n");
            if (error) reject(error);
            else resolve(value);
        };
        const onData = chunk => {
            for (const character of decoder.write(chunk)) {
                if (character === "\u0003") return finish(new Error("Cancelado; no se ejecutó SQL."));
                if (character === "\r" || character === "\n") return finish();
                if (character === "\u007f" || character === "\b") value = Array.from(value).slice(0, -1).join("");
                else if (character >= " ") value += character;
            }
        };
        process.stdout.write(prompt);
        input.setRawMode(true);
        input.resume();
        input.on("data", onData);
    });
}

function assertRootIdentity(row) {
    if (row?.database_name !== TARGET.database || Number(row.server_port) !== TARGET.serverPort
        || Number(row.read_only) !== 0 || !String(row.account_name || "").toLowerCase().startsWith("root@")) {
        throw new Error("Conexión root rechazada: la identidad o el destino no corresponden a piar_test fresh.");
    }
    return true;
}

function assertMigratorIdentity(row, host) {
    assertMigrationIdentity(row);
    if (String(row.account_name).toLowerCase() !== `${MIGRATOR.user}@${String(host).toLowerCase()}`) {
        throw new Error("MySQL resolvió una identidad distinta de piar_migrator; se detuvo antes de migrar.");
    }
    return true;
}

function clientHostFromSessionIdentity(sessionIdentity) {
    const match = String(sessionIdentity || "").match(/^root@(.+)$/i);
    const host = match?.[1] || "";
    const validHostname = host.length <= 253 && /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/.test(host);
    if (!host || host.includes("%") || host.includes("_") || (!net.isIP(host) && !validHostname)) {
        throw new Error("No se pudo limitar piar_migrator al host cliente exacto de esta conexión.");
    }
    return host;
}

function validateMigratorPassword(password) {
    if (typeof password !== "string" || Buffer.byteLength(password, "utf8") < 24 || Buffer.byteLength(password, "utf8") > 72) {
        throw new Error("La contraseña de piar_migrator debe tener entre 24 y 72 bytes.");
    }
    return true;
}

async function verifyTargetIdentity(connection, checker) {
    const [[identity]] = await connection.query("SELECT DATABASE() AS database_name, @@port AS server_port, @@read_only AS read_only, CURRENT_USER() AS account_name");
    checker(identity);
    return identity;
}

async function provisionMigrator(rootConnection, password, host) {
    validateMigratorPassword(password);
    const clientHost = clientHostFromSessionIdentity(`root@${host}`);
    const [accounts] = await rootConnection.execute(
        "SELECT User, Host FROM mysql.user WHERE User = ? AND Host = ?", [MIGRATOR.user, clientHost]
    );
    const account = `'${MIGRATOR.user}'@${mysqlCore.escape(clientHost)}`;
    const escapedPassword = mysqlCore.escape(password);
    if (accounts.length) {
        await rootConnection.query(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM ${account}`);
        await rootConnection.query(`ALTER USER ${account} IDENTIFIED BY ${escapedPassword}`);
    } else {
        await rootConnection.query(`CREATE USER ${account} IDENTIFIED BY ${escapedPassword}`);
    }
    await rootConnection.query(`GRANT ALTER ON \`${TARGET.database}\`.* TO ${account}`);
}

async function run() {
    let rootConnection;
    let migrationConnection;
    try {
        if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Ejecuta este provisionador en una terminal interactiva.");
        verifyFreshContainer();
        process.stdout.write("Docker validado: piar-mysql-test-fresh, healthy, publicación exclusiva 127.0.0.1:3308.\n");
        process.stdout.write("Destino SQL fijado: 127.0.0.1:3308 / piar_test.\n");
        const rootPassword = await readHidden("Contraseña de root MySQL (entrada oculta): ");
        if (!rootPassword) throw new Error("Contraseña vacía; no se abrió conexión SQL.");
        rootConnection = await mysql.createConnection({
            host: TARGET.host, port: TARGET.port, database: TARGET.database,
            user: "root", password: rootPassword, connectTimeout: 5000, multipleStatements: false
        });
        await verifyTargetIdentity(rootConnection, assertRootIdentity);
        const [[session]] = await rootConnection.query("SELECT USER() AS session_identity");
        const migratorHost = clientHostFromSessionIdentity(session.session_identity);
        const [userTable] = await rootConnection.execute(
            "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'usuario'", [TARGET.database]
        );
        if (!userTable.length) throw new Error("No existe usuario en piar_test; no se provisionó la identidad.");
        if (await columnExists(rootConnection)) {
            process.stdout.write("password_change_required ya existe con definición compatible; no se provisionó una identidad ni se ejecutó migración.\n");
            return;
        }

        const migratorPassword = await readHidden("Contraseña nueva de piar_migrator (24–72 bytes, entrada oculta): ");
        validateMigratorPassword(migratorPassword);
        await provisionMigrator(rootConnection, migratorPassword, migratorHost);
        await rootConnection.end();
        rootConnection = null;

        verifyFreshContainer();
        migrationConnection = await mysql.createConnection({
            host: TARGET.host, port: TARGET.port, database: TARGET.database,
            user: MIGRATOR.user, password: migratorPassword, connectTimeout: 5000, multipleStatements: false
        });
        const identity = await verifyTargetIdentity(migrationConnection, row => assertMigratorIdentity(row, migratorHost));
        const [grants] = await migrationConnection.query("SHOW GRANTS");
        assertMigrationGrants(grants);
        process.stdout.write(`Identidad verificada: ${identity.account_name}; base ${identity.database_name}; puerto MySQL interno ${identity.server_port}.\n`);
        process.stdout.write("SHOW GRANTS validado (sin GRANT OPTION ni privilegios globales):\n");
        for (const row of grants) process.stdout.write(`${Object.values(row)[0]}\n`);

        if (await columnExists(migrationConnection)) {
            process.stdout.write("password_change_required ya existe con definición compatible; no se ejecutó migración.\n");
            return;
        }
        verifyFreshContainer();
        assertMigratorIdentity(identity, migratorHost);
        assertMigrationGrants(grants);
        const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf8");
        for (const statement of splitMigration(migrationSql)) await migrationConnection.query(statement);
        if (!await columnExists(migrationConnection)) throw new Error("La migración terminó sin la columna esperada.");
        process.stdout.write("Migración 011 aplicada y verificada exclusivamente en piar_test.\n");
    } catch (error) {
        process.stderr.write(`${error.code ? `Error MySQL (${error.code})` : error.message}\n`);
        process.exitCode = 1;
    } finally {
        if (rootConnection) await rootConnection.end();
        if (migrationConnection) await migrationConnection.end();
    }
}

if (require.main === module) run();

module.exports = { MIGRATOR, assertRootIdentity, assertMigratorIdentity, clientHostFromSessionIdentity, validateMigratorPassword, verifyTargetIdentity, provisionMigrator, run };
