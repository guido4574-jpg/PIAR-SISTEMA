"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { StringDecoder } = require("node:string_decoder");
const { execFileSync } = require("node:child_process");
const mysql = require("mysql2/promise");
const { assertFreshTestContainer } = require("./fresh-test-container");

const TARGET = Object.freeze({ host: "127.0.0.1", port: 3308, database: "piar_test", serverPort: 3306, dmlUser: "piar_test" });
const MIGRATION_PATH = path.resolve(__dirname, "../database/migrations/011_admin_initial_password_change.sql");
const MIGRATION_SHA256 = "502ff1002f3327f7ad167be88347b334ed318b4e169e381fe842e20a6b38a9fa";

function verifyFreshContainer() {
    const docker = process.platform === "win32"
        ? path.join(process.env.LOCALAPPDATA || "", "Programs", "DockerDesktop", "resources", "bin", "docker.exe")
        : "docker";
    const format = "{{.Name}}\n{{.Config.Image}}\n{{.State.Running}}\n{{.State.Health.Status}}\n{{json .HostConfig.Tmpfs}}\n{{json .Mounts}}\n{{json .NetworkSettings.Ports}}";
    let fields;
    try {
        fields = execFileSync(docker, ["inspect", "piar-mysql-test-fresh", "--format", format], {
            encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]
        }).trim().split(/\r?\n/);
    } catch {
        throw new Error("No se pudo verificar piar-mysql-test-fresh; no se intentó conectar ni ejecutar SQL.");
    }
    if (fields.length !== 7) throw new Error("La inspección del contenedor está incompleta; no se intentó SQL.");
    try {
        assertFreshTestContainer({
            Name: fields[0], Config: { Image: fields[1] },
            State: { Running: fields[2] === "true", Health: { Status: fields[3] } },
            HostConfig: { Tmpfs: JSON.parse(fields[4]) }, Mounts: JSON.parse(fields[5]),
            NetworkSettings: { Ports: JSON.parse(fields[6]) }
        });
    } catch {
        throw new Error("Docker no confirma el contenedor fresh healthy publicado únicamente en 127.0.0.1:3308; no se intentó SQL.");
    }
    return true;
}

function readHidden(prompt) {
    return new Promise((resolve, reject) => {
        const input = process.stdin;
        if (!input.isTTY || typeof input.setRawMode !== "function") {
            reject(new Error("Ejecuta el migrador directamente en una terminal interactiva; la contraseña debe permanecer oculta."));
            return;
        }
        const decoder = new StringDecoder("utf8");
        let value = "";
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

function assertMigrationIdentity(row) {
    if (row?.database_name !== TARGET.database || Number(row.server_port) !== TARGET.serverPort
        || Number(row.read_only) !== 0 || !String(row.account_name || "").includes("@")
        || String(row.account_name).toLowerCase().startsWith(`${TARGET.dmlUser}@`)) {
        throw new Error("Conexión rechazada: debe ser una identidad distinta de piar_test en la instancia fresh de piar_test.");
    }
    return true;
}

function assertMigrationGrants(grantRows) {
    const rows = Array.isArray(grantRows) ? grantRows : [];
    if (!rows.length) throw new Error("SHOW GRANTS no devolvió privilegios para validar.");
    let hasAlter = false;
    for (const row of rows) {
        const value = typeof row === "string" ? row : Object.values(row || {})[0];
        const normalized = String(value || "").replace(/\\_/g, "_").replace(/`/g, "").replace(/\s+/g, " ").trim().toUpperCase();
        if (/\bWITH GRANT OPTION\b/.test(normalized)) throw new Error("La identidad de migración no debe tener GRANT OPTION.");
        const match = normalized.match(/^GRANT (.+?) ON (.+?) TO /);
        if (!match) throw new Error("La identidad de migración tiene grants no reconocidos; no se ejecutó SQL.");
        const privileges = new Set(match[1].split(",").map(item => item.trim()));
        const scope = match[2].replace(/\s+/g, "");
        if (scope === "*.*" && privileges.size === 1 && privileges.has("USAGE")) continue;
        if (scope !== "PIAR_TEST.*") {
            throw new Error("La identidad de migración requiere privilegios limitados a piar_test.*.");
        }
        if ([...privileges].some(privilege => privilege !== "ALTER")) {
            throw new Error("La identidad requiere únicamente ALTER sobre piar_test.* y ningún privilegio global adicional.");
        }
        hasAlter ||= privileges.has("ALTER");
    }
    if (!hasAlter) throw new Error("La identidad SQL no tiene ALTER sobre piar_test.*; no se ejecutó SQL.");
    return true;
}

function splitMigration(sql) {
    const statements = [];
    let current = "";
    let quote = null;
    let escaped = false;
    let lineComment = false;
    const source = String(sql);
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        const next = source[index + 1];
        if (lineComment) {
            if (character === "\n") { lineComment = false; current += character; }
            continue;
        }
        if (!quote && character === "-" && next === "-") { lineComment = true; index += 1; continue; }
        current += character;
        if (quote) {
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === quote) quote = null;
            continue;
        }
        if (["'", "\"", "`"].includes(character)) { quote = character; continue; }
        if (character === ";") {
            const statement = current.slice(0, -1).trim();
            if (statement) statements.push(statement);
            current = "";
        }
    }
    const tail = current.trim();
    if (tail) statements.push(tail);
    const digest = crypto.createHash("sha256").update(String(sql)).digest("hex");
    if (digest !== MIGRATION_SHA256 || statements.length !== 5 || !/ALTER TABLE usuario ADD COLUMN password_change_required TINYINT\(1\) NOT NULL DEFAULT 0 AFTER correo_verificado_at/i.test(sql)) {
        throw new Error("El archivo 011 no coincide con la migración de cambio inicial de contraseña esperada.");
    }
    return statements;
}

async function columnExists(connection) {
    const [rows] = await connection.execute(
        "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'usuario' AND COLUMN_NAME = 'password_change_required'",
        [TARGET.database]
    );
    if (!rows.length) return false;
    const column = rows[0];
    if (String(column.COLUMN_TYPE).toLowerCase() !== "tinyint(1)" || column.IS_NULLABLE !== "NO" || Number(column.COLUMN_DEFAULT) !== 0) {
        throw new Error("password_change_required existe con definición inesperada; no se modificó.");
    }
    return true;
}

async function main() {
    let connection;
    try {
        if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Ejecuta este comando en una terminal interactiva.");
        verifyFreshContainer();
        process.stdout.write("Destino fijado: 127.0.0.1:3308 / piar_test. Usuario DML piar_test rechazado para ALTER.\n");
        const user = (await new Promise(resolve => {
            const readline = require("node:readline").createInterface({ input: process.stdin, output: process.stdout });
            readline.question("Usuario SQL autorizado para ALTER en piar_test: ", answer => { readline.close(); resolve(answer.trim()); });
        }));
        if (!user || user.toLowerCase() === TARGET.dmlUser) throw new Error("Indica una identidad de migración distinta del usuario DML piar_test.");
        const password = await readHidden("Contraseña SQL de migración (entrada oculta): ");
        if (!password) throw new Error("Contraseña vacía; no se abrió una conexión.");
        connection = await mysql.createConnection({ host: TARGET.host, port: TARGET.port, database: TARGET.database, user, password, connectTimeout: 5000, multipleStatements: false });

        const [[identity]] = await connection.query("SELECT DATABASE() AS database_name, @@port AS server_port, @@read_only AS read_only, CURRENT_USER() AS account_name");
        assertMigrationIdentity(identity);
        if (!String(identity.account_name).toLowerCase().startsWith(`${user.toLowerCase()}@`)) throw new Error("MySQL resolvió una identidad distinta de la indicada; no se ejecutó SQL.");
        if (await columnExists(connection)) {
            process.stdout.write("password_change_required ya existe con definición compatible en piar_test; no se ejecutó ninguna escritura.\n");
            return;
        }

        const [grants] = await connection.query("SHOW GRANTS");
        assertMigrationGrants(grants);
        const migration = fs.readFileSync(MIGRATION_PATH, "utf8");
        for (const statement of splitMigration(migration)) await connection.query(statement);
        if (!await columnExists(connection)) throw new Error("La migración terminó sin la columna esperada.");
        process.stdout.write("Migración 011 aplicada y verificada exclusivamente en piar_test.\n");
    } catch (error) {
        process.stderr.write(`${error.code ? `Error MySQL (${error.code})` : error.message}\n`);
        process.exitCode = 1;
    } finally {
        if (connection) await connection.end();
    }
}

if (require.main === module) main();

module.exports = { TARGET, assertMigrationIdentity, assertMigrationGrants, splitMigration, columnExists, verifyFreshContainer, main };
