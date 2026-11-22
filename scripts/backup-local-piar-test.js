"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const mysql = require("mysql2/promise");
const { promptPassword } = require("./apply-local-password-recovery-migration");
const { assertFreshTestContainer } = require("./fresh-test-container");
const { assertIntegrationGrants } = require("./local-piar-test-config");

const TARGET = Object.freeze({ host: "127.0.0.1", port: 3308, database: "piar_test", user: "piar_test", serverPort: 3306 });

function inspectTarget() {
    const docker = process.platform === "win32"
        ? path.join(process.env.LOCALAPPDATA || "", "Programs", "DockerDesktop", "resources", "bin", "docker.exe")
        : "docker";
    let metadata;
    try {
        metadata = JSON.parse(execFileSync(docker, ["inspect", "piar-mysql-test-fresh"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    } catch {
        throw new Error("No se pudo demostrar el contenedor fresh; no se intentó conexión ni respaldo.");
    }
    assertFreshTestContainer(metadata);
}

function quoteIdentifier(value) {
    return `\`${String(value).replace(/`/g, "``")}\``;
}

function sqlValue(value) {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error("Valor numérico no finito; exportación cancelada.");
        return String(value);
    }
    if (typeof value === "bigint") return String(value);
    if (Buffer.isBuffer(value)) return `X'${value.toString("hex")}'`;
    const text = value instanceof Date ? value.toISOString().slice(0, 19).replace("T", " ")
        : typeof value === "object" ? JSON.stringify(value) : String(value);
    return `CONVERT(X'${Buffer.from(text, "utf8").toString("hex")}' USING utf8mb4)`;
}

async function createDump(connection) {
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.query("SET TRANSACTION READ ONLY");
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
    const [listed] = await connection.query(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
    );
    if (!listed.length) throw new Error("piar_test no contiene tablas base; respaldo cancelado.");
    const chunks = [
        "-- Logical read-only backup of piar_test; generated locally.",
        "SET NAMES utf8mb4;",
        "CREATE DATABASE IF NOT EXISTS `piar_test`;",
        "USE `piar_test`;",
        "SET FOREIGN_KEY_CHECKS=0;"
    ];
    let rowCount = 0;
    for (const { TABLE_NAME: name } of listed) {
        const [created] = await connection.query(`SHOW CREATE TABLE ${quoteIdentifier(name)}`);
        const createSql = created[0]?.["Create Table"];
        if (!createSql || !/^CREATE TABLE/i.test(createSql)) throw new Error("No se pudo leer el esquema de una tabla; respaldo cancelado.");
        chunks.push(`${createSql};`);
    }
    for (const { TABLE_NAME: name } of listed) {
        const [rows, fields] = await connection.query(`SELECT * FROM ${quoteIdentifier(name)}`);
        const columns = fields.map(field => quoteIdentifier(field.name)).join(", ");
        for (const row of rows) {
            const values = fields.map(field => sqlValue(row[field.name])).join(", ");
            chunks.push(`INSERT INTO ${quoteIdentifier(name)} (${columns}) VALUES (${values});`);
            rowCount += 1;
        }
    }
    chunks.push("SET FOREIGN_KEY_CHECKS=1;");
    await connection.commit();
    return { sql: `${chunks.join("\n\n")}\n`, tableCount: listed.length, rowCount, tableNames: listed.map(item => item.TABLE_NAME) };
}

async function main() {
    let connection;
    try {
        if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Ejecuta el respaldo en una terminal interactiva; la credencial se solicita oculta.");
        inspectTarget();
        process.stdout.write("Contenedor validado: piar-mysql-test-fresh healthy, solo 127.0.0.1:3308. Destino fijado: piar_test.\n");
        const password = await promptPassword("Credencial DML de piar_test (entrada oculta): ");
        if (!password) throw new Error("Credencial vacía; no se intentó conexión.");
        connection = await mysql.createConnection({
            host: TARGET.host, port: TARGET.port, database: TARGET.database, user: TARGET.user, password,
            connectTimeout: 5000, multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true
        });
        const [[identity]] = await connection.query(
            "SELECT DATABASE() AS db_name, CURRENT_USER() AS account_name, @@port AS server_port, @@read_only AS read_only"
        );
        if (identity.db_name !== TARGET.database || Number(identity.server_port) !== TARGET.serverPort
            || Number(identity.read_only) !== 0 || !String(identity.account_name).toLowerCase().startsWith("piar_test@")) {
            throw new Error("La identidad o destino SQL no coincide con piar_test fresh; no se exportó.");
        }
        const [grants] = await connection.query("SHOW GRANTS");
        assertIntegrationGrants(grants);
        const [check] = await connection.query("SELECT COUNT(*) AS table_count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'");
        if (Number(check[0]?.table_count) < 1) throw new Error("La comprobación de lectura no encontró tablas en piar_test.");
        process.stdout.write(`Lectura validada: ${identity.account_name}, base ${identity.db_name}, puerto MySQL interno ${identity.server_port}, ${check[0].table_count} tablas.\n`);
        const dump = await createDump(connection);
        const directory = path.join(os.tmpdir(), "PIAR-SISTEMA-secure-backups");
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        const file = path.join(directory, `piar_test-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`);
        const handle = await fs.promises.open(file, "wx", 0o600);
        try { await handle.writeFile(dump.sql, "utf8"); await handle.sync(); } finally { await handle.close(); }
        const stat = await fs.promises.stat(file);
        const verification = await fs.promises.readFile(file, "utf8");
        if (stat.size < 1 || !verification.includes("CREATE DATABASE IF NOT EXISTS `piar_test`;")
            || !verification.includes("USE `piar_test`;") || !verification.includes("SET FOREIGN_KEY_CHECKS=1;")) {
            throw new Error("El archivo de respaldo no pasó la verificación local.");
        }
        process.stdout.write(`Respaldo verificado: ${file}\nTamaño: ${stat.size} bytes; tablas: ${dump.tableCount}; filas exportadas: ${dump.rowCount}. No se imprimieron datos.\n`);
    } catch (error) {
        const code = error?.code;
        process.stderr.write(code ? `Conexión/respaldo falló (${code}); no se muestran detalles ni secretos.\n` : `${error.message}\n`);
        process.exitCode = 1;
    } finally {
        if (connection) await connection.end();
    }
}

if (require.main === module) main();
module.exports = { TARGET, inspectTarget, quoteIdentifier, sqlValue, createDump, main };
