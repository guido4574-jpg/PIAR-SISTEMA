"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { StringDecoder } = require("node:string_decoder");
const mysql = require("mysql2/promise");

const MIGRATION_PATH = path.resolve(__dirname, "../database/migrations/local/002_create_recuperacion_contrasena.sql");
const EXPECTED_SQL = `
CREATE TABLE IF NOT EXISTS recuperacion_contrasena (
    id_recuperacion BIGINT NOT NULL AUTO_INCREMENT,
    id_usuario INT NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    consumed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_recuperacion),
    UNIQUE KEY uq_recuperacion_token_hash (token_hash),
    KEY idx_recuperacion_usuario (id_usuario),
    KEY idx_recuperacion_expira (expires_at),
    CONSTRAINT fk_recuperacion_usuario
        FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

class SafeError extends Error {}

function normalizeSql(sql) {
    return sql
        .replace(/^\s*--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/;$/, "")
        .toLowerCase();
}

function normalizeColumnType(value) {
    return String(value).toLowerCase().replace(/\b(tinyint|smallint|mediumint|int|integer|bigint)\(\d+\)/, "$1");
}

function normalizeDefault(value) {
    if (value === null || value === undefined) return null;
    return String(value).toLowerCase().replace(/\(\)/g, "");
}

function readAndValidateMigration() {
    const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
    if (normalizeSql(sql) !== normalizeSql(EXPECTED_SQL)) {
        throw new SafeError("Migration file differs from the reviewed one-table CREATE script; no SQL was executed.");
    }
    return sql;
}

function promptPassword(prompt = "Password for local piar_test (input hidden): ") {
    return new Promise((resolve, reject) => {
        const input = process.stdin;
        if (!input.isTTY || typeof input.setRawMode !== "function") {
            reject(new SafeError("Run this script directly in an interactive VS Code terminal; password input must be hidden."));
            return;
        }

        const decoder = new StringDecoder("utf8");
        let password = "";
        const finish = (error) => {
            input.removeListener("data", onData);
            input.setRawMode(false);
            input.pause();
            process.stdout.write("\n");
            if (error) reject(error);
            else resolve(password);
        };
        const onData = chunk => {
            for (const character of decoder.write(chunk)) {
                if (character === "\u0003") {
                    finish(new SafeError("Cancelled; no SQL was executed."));
                    return;
                }
                if (character === "\r" || character === "\n") {
                    finish();
                    return;
                }
                if (character === "\u007f" || character === "\b") {
                    password = Array.from(password).slice(0, -1).join("");
                    continue;
                }
                if (character >= " ") password += character;
            }
        };

        process.stdout.write(prompt);
        input.setRawMode(true);
        input.resume();
        input.on("data", onData);
    });
}

async function verifyRecoveryTable(connection) {
    const [tables] = await connection.query(
        "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recuperacion_contrasena'"
    );
    if (tables.length !== 1 || tables[0].ENGINE !== "InnoDB") {
        throw new SafeError("recuperacion_contrasena is missing or is not InnoDB.");
    }

    const [columns] = await connection.query(
        "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recuperacion_contrasena' ORDER BY ORDINAL_POSITION"
    );
    const expectedColumns = [
        { name: "id_recuperacion", type: "bigint", nullable: "NO", default: null, extra: ["auto_increment"] },
        { name: "id_usuario", type: "int", nullable: "NO", default: null, extra: [] },
        { name: "token_hash", type: "char(64)", nullable: "NO", default: null, extra: [] },
        { name: "expires_at", type: "datetime", nullable: "NO", default: null, extra: [] },
        { name: "consumed_at", type: "datetime", nullable: "YES", default: null, extra: [] },
        { name: "created_at", type: "datetime", nullable: "NO", default: "current_timestamp", extra: [] }
    ];
    const mismatches = [];
    if (columns.length !== expectedColumns.length) mismatches.push(`column count expected ${expectedColumns.length}, found ${columns.length}`);
    for (let index = 0; index < Math.min(columns.length, expectedColumns.length); index++) {
        const actual = columns[index];
        const expected = expectedColumns[index];
        const actualType = normalizeColumnType(actual.COLUMN_TYPE);
        const actualDefault = normalizeDefault(actual.COLUMN_DEFAULT);
        const actualExtra = String(actual.EXTRA || "").toLowerCase().split(/\s+/).filter(Boolean)
            .filter(value => !(expected.default === "current_timestamp" && value === "default_generated"))
            .sort();
        const expectedExtra = expected.extra.slice().sort();
        if (actual.COLUMN_NAME !== expected.name) mismatches.push(`column ${index + 1}: expected ${expected.name}, found ${actual.COLUMN_NAME}`);
        if (actualType !== expected.type) mismatches.push(`${expected.name}: type expected ${expected.type}, found ${actualType}`);
        if (actual.IS_NULLABLE !== expected.nullable) mismatches.push(`${expected.name}: nullable expected ${expected.nullable}, found ${actual.IS_NULLABLE}`);
        if (actualDefault !== expected.default) mismatches.push(`${expected.name}: default expected ${expected.default}, found ${actualDefault}`);
        if (JSON.stringify(actualExtra) !== JSON.stringify(expectedExtra)) mismatches.push(`${expected.name}: extra expected ${expectedExtra.join(" ") || "(none)"}, found ${actualExtra.join(" ") || "(none)"}`);
    }
    if (mismatches.length) {
        throw new SafeError(`recuperacion_contrasena column mismatch: ${mismatches.join("; ")}.`);
    }

    const [indexes] = await connection.query(
        "SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recuperacion_contrasena' ORDER BY INDEX_NAME, SEQ_IN_INDEX"
    );
    const indexMap = new Map();
    for (const index of indexes) {
        if (!indexMap.has(index.INDEX_NAME)) indexMap.set(index.INDEX_NAME, { unique: Number(index.NON_UNIQUE) === 0, columns: [] });
        indexMap.get(index.INDEX_NAME).columns[Number(index.SEQ_IN_INDEX) - 1] = index.COLUMN_NAME;
    }
    const indexDefinitions = [...indexMap.entries()].map(([name, definition]) => ({ name, ...definition }));
    const hasIndex = (column, unique = null, singleColumn = false) => indexDefinitions.some(index =>
        (unique === null || index.unique === unique) && index.columns[0] === column && (!singleColumn || index.columns.length === 1)
    );
    const primary = indexMap.get("PRIMARY");
    if (!primary?.unique || primary.columns.length !== 1 || primary.columns[0] !== "id_recuperacion"
        || !hasIndex("token_hash", true, true)
        || !hasIndex("id_usuario")
        || !hasIndex("expires_at")) {
        throw new SafeError("recuperacion_contrasena is missing a required index.");
    }

    const [foreignKeys] = await connection.query(
        "SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recuperacion_contrasena' AND REFERENCED_TABLE_NAME IS NOT NULL"
    );
    if (!foreignKeys.some(key => key.COLUMN_NAME === "id_usuario" && key.REFERENCED_TABLE_NAME === "usuario" && key.REFERENCED_COLUMN_NAME === "id_usuario")) {
        throw new SafeError("recuperacion_contrasena foreign key does not match usuario.id_usuario.");
    }
}

async function main() {
    const migration = readAndValidateMigration();
    const inspectOnly = process.argv.includes("--inspect");
    const password = await promptPassword();
    if (!password) throw new SafeError("An empty password is not accepted; no SQL was executed.");

    const connection = await mysql.createConnection({
        host: "127.0.0.1",
        port: 3307,
        database: "piar_test",
        user: "piar_test",
        password,
        connectTimeout: 5000
    });

    try {
        const [identityRows] = await connection.query(
            "SELECT DATABASE() AS db, @@port AS mysql_port, CURRENT_USER() AS account, @@read_only AS read_only"
        );
        const identity = identityRows[0];
        if (identity.db !== "piar_test" || Number(identity.mysql_port) !== 3306 || String(identity.account).split("@")[0] !== "piar_test") {
            throw new SafeError("Connection identity is not the expected local piar_test account; no SQL was executed.");
        }
        if (inspectOnly) {
            const [tables] = await connection.query(
                "SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('usuario', 'recuperacion_contrasena') ORDER BY TABLE_NAME"
            );
            const [columns] = await connection.query(
                "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('usuario', 'recuperacion_contrasena') ORDER BY TABLE_NAME, ORDINAL_POSITION"
            );
            const [indexes] = await connection.query(
                "SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recuperacion_contrasena' ORDER BY INDEX_NAME, SEQ_IN_INDEX"
            );
            const [foreignKeys] = await connection.query(
                "SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recuperacion_contrasena' AND REFERENCED_TABLE_NAME IS NOT NULL"
            );
            process.stdout.write(`${JSON.stringify({
                identity: { database: identity.db, mysqlPort: Number(identity.mysql_port), account: identity.account, readOnly: Number(identity.read_only) },
                tables,
                columns,
                indexes,
                foreignKeys
            }, null, 2)}\n`);
            return;
        }
        if (Number(identity.read_only) !== 0) throw new SafeError("The target database is read-only; no SQL was executed.");

        const [userTables] = await connection.query(
            "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuario'"
        );
        const [userIdColumns] = await connection.query(
            "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuario' AND COLUMN_NAME = 'id_usuario'"
        );
        const [passwordColumns] = await connection.query(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuario' AND COLUMN_NAME = 'password_hash'"
        );
        if (userTables.length !== 1 || userTables[0].ENGINE !== "InnoDB" || userIdColumns.length !== 1 || userIdColumns[0].COLUMN_TYPE.toLowerCase() !== "int" || passwordColumns.length !== 1) {
            throw new SafeError("The local usuario table is incompatible with this migration; no SQL was executed.");
        }

        const [existing] = await connection.query(
            "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recuperacion_contrasena'"
        );
        if (existing.length) {
            await verifyRecoveryTable(connection);
            process.stdout.write("The compatible table already exists; no migration was executed.\n");
            return;
        }

        await connection.query(migration);
        await verifyRecoveryTable(connection);
        process.stdout.write("Created and verified recuperacion_contrasena in local piar_test.\n");
    } finally {
        await connection.end();
    }
}

if (require.main === module) {
    main().catch(error => {
        if (error instanceof SafeError) console.error(error.message);
        else console.error(`Stopped without printing credentials or SQL values (error ${error.code || "UNKNOWN"}).`);
        process.exitCode = 1;
    });
}

module.exports = { normalizeColumnType, normalizeDefault, readAndValidateMigration, verifyRecoveryTable, promptPassword };
