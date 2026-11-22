"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

// Versioned migrations: database/migrations/NNN_name.sql, applied in numeric
// order and recorded in schema_migrations with a checksum so an edited file
// that was already applied is detected instead of silently ignored.
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "database", "migrations");
const MIGRATION_FILE = /^(\d{3})_[a-z0-9_]+\.sql$/;

function splitSqlStatements(sql) {
    const statements = [];
    let current = "";
    let quote = null;
    let escaped = false;
    let lineComment = false;

    for (let index = 0; index < sql.length; index += 1) {
        const char = sql[index];
        const next = sql[index + 1];

        if (lineComment) {
            if (char === "\n") {
                lineComment = false;
                current += char;
            }
            continue;
        }

        if (!quote && char === "-" && next === "-") {
            lineComment = true;
            index += 1;
            continue;
        }

        current += char;

        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === quote) {
                quote = null;
            }
            continue;
        }

        if (char === "'" || char === '"' || char === "`") {
            quote = char;
            continue;
        }

        if (char === ";") {
            const statement = current.slice(0, -1).trim();
            if (statement) statements.push(statement);
            current = "";
        }
    }

    const tail = current.trim();
    if (tail) statements.push(tail);
    return statements;
}

function checksum(sql) {
    return crypto.createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

async function listMigrations(dir = MIGRATIONS_DIR) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const migrations = [];
    const seen = new Map();
    for (const entry of entries) {
        const match = entry.isFile() && entry.name.match(MIGRATION_FILE);
        if (!match) continue;
        if (seen.has(match[1])) throw new Error(`Versión de migración duplicada ${match[1]}: ${seen.get(match[1])} y ${entry.name}`);
        seen.set(match[1], entry.name);
        const sql = await fs.readFile(path.join(dir, entry.name), "utf8");
        migrations.push({ version: match[1], name: entry.name, sql, checksum: checksum(sql) });
    }
    return migrations.sort((left, right) => left.version.localeCompare(right.version));
}

async function ensureMigrationTable(connection) {
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version CHAR(3) NOT NULL,
        nombre VARCHAR(120) NOT NULL,
        checksum CHAR(64) NOT NULL,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

async function migrationTableExists(connection) {
    const [rows] = await connection.query("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations' LIMIT 1");
    return rows.length > 0;
}

// readOnly=true never creates schema_migrations, so status can be checked
// with a DML-only application account.
async function migrationStatus(connection, dir = MIGRATIONS_DIR, { readOnly = false } = {}) {
    if (!readOnly) await ensureMigrationTable(connection);
    else if (!(await migrationTableExists(connection))) {
        return (await listMigrations(dir)).map(migration => ({ ...migration, state: "sin registro", appliedAt: null }));
    }
    const [rows] = await connection.query("SELECT version, nombre, checksum, applied_at FROM schema_migrations ORDER BY version");
    const applied = new Map(rows.map(row => [row.version, row]));
    return (await listMigrations(dir)).map(migration => {
        const record = applied.get(migration.version);
        const state = !record ? "pendiente" : record.checksum === migration.checksum ? "aplicada" : "modificada";
        return { ...migration, state, appliedAt: record?.applied_at || null };
    });
}

async function applyMigration(connection, migration) {
    const statements = splitSqlStatements(migration.sql);
    if (!statements.length) throw new Error(`${migration.name} no contiene sentencias SQL ejecutables.`);
    // MySQL DDL commits implicitly, so each migration must stay re-runnable
    // (IF NOT EXISTS / information_schema guards); the record is written last.
    for (const statement of statements) await connection.query(statement);
    await connection.query(
        "INSERT INTO schema_migrations (version, nombre, checksum) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), checksum = VALUES(checksum), applied_at = CURRENT_TIMESTAMP",
        [migration.version, migration.name, migration.checksum]
    );
}

async function applyPendingMigrations(connection, { dir = MIGRATIONS_DIR, logger = console } = {}) {
    const status = await migrationStatus(connection, dir);
    const modified = status.filter(item => item.state === "modificada");
    if (modified.length) {
        throw new Error(`Migraciones ya aplicadas cuyo archivo cambió: ${modified.map(item => item.name).join(", ")}. Crea una migración nueva en lugar de editar una aplicada.`);
    }
    const pending = status.filter(item => item.state === "pendiente");
    for (const migration of pending) {
        await applyMigration(connection, migration);
        logger.log(`Aplicada ${migration.name}`);
    }
    return pending.map(item => item.name);
}

module.exports = { MIGRATIONS_DIR, splitSqlStatements, checksum, listMigrations, migrationStatus, migrationTableExists, applyMigration, applyPendingMigrations, ensureMigrationTable };
