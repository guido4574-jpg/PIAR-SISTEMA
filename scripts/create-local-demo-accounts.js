"use strict";

const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");

const TARGET = Object.freeze({ host: "127.0.0.1", port: 3307, database: "piar_test", user: "piar_test" });
const CONFIRMATION = "CREAR CUENTA DOCENTE DEMO EN piar_test";

function validateDemoInputs(env) {
    if (env.PIAR_ALLOW_LOCAL_DEMO_SEED !== "1") throw new Error("Define PIAR_ALLOW_LOCAL_DEMO_SEED=1 solo para esta ejecución local.");
    const required = ["DEMO_TEACHER_NAME", "DEMO_TEACHER_LAST_NAME", "DEMO_TEACHER_DOCUMENT", "DEMO_TEACHER_EMAIL"];
    if (required.some(key => !String(env[key] || "").trim())) throw new Error("Faltan nombres, documentos o correos de demostración sintéticos.");
    if (!/^[^\s@]+@[^\s@]+\.invalid$/i.test(env.DEMO_TEACHER_EMAIL)) throw new Error("Los correos de demostración deben terminar en .invalid.");
    if (!/^DEMO-[A-Z0-9-]{3,25}$/i.test(env.DEMO_TEACHER_DOCUMENT)) throw new Error("Los documentos sintéticos deben usar el prefijo DEMO-.");
    return {
        teacher: { name: `${env.DEMO_TEACHER_NAME.trim()} ${env.DEMO_TEACHER_LAST_NAME.trim()}`, firstName: env.DEMO_TEACHER_NAME.trim(), lastName: env.DEMO_TEACHER_LAST_NAME.trim(), document: env.DEMO_TEACHER_DOCUMENT.trim(), email: env.DEMO_TEACHER_EMAIL.trim().toLowerCase(), role: "Docente" }
    };
}

function readHidden(prompt) {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") throw new Error("Ejecuta este inicializador desde una terminal interactiva.");
    return new Promise((resolve, reject) => {
        const stdin = process.stdin;
        let value = "";
        process.stdout.write(prompt);
        stdin.setRawMode(true);
        stdin.resume();
        const cleanup = () => { stdin.removeListener("data", onData); stdin.setRawMode(false); stdin.pause(); process.stdout.write("\n"); };
        const onData = chunk => {
            for (const char of chunk.toString("utf8")) {
                if (char === "\u0003") { cleanup(); reject(new Error("Ejecución cancelada.")); return; }
                if (char === "\r" || char === "\n") { cleanup(); resolve(value); return; }
                if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
                else if (char >= " ") value += char;
            }
        };
        stdin.on("data", onData);
    });
}

async function assertTargetAndSchema(connection) {
    const [[server]] = await connection.query("SELECT DATABASE() AS database_name, @@port AS server_port, @@read_only AS read_only, CURRENT_USER() AS current_user");
    if (server.database_name !== TARGET.database || Number(server.server_port) !== 3306 || Number(server.read_only) !== 0 || !String(server.current_user).toLowerCase().startsWith("piar_test@")) {
        throw new Error("El servidor conectado no corresponde a la instancia local aislada piar_test.");
    }
    const [grantRows] = await connection.query("SHOW GRANTS");
    assertDemoSeedPrivileges(grantRows);
    const [rows] = await connection.execute("SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('usuario','docente')", [TARGET.database]);
    const schema = new Map();
    for (const row of rows) {
        if (!schema.has(row.TABLE_NAME)) schema.set(row.TABLE_NAME, new Set());
        schema.get(row.TABLE_NAME).add(row.COLUMN_NAME);
    }
    const required = {
        usuario: ["nombre", "documento", "correo", "rol", "contrasena", "password_hash", "estado", "correo_verificado_at"],
        docente: ["nombre", "correo", "nombres", "apellidos", "documento", "estado", "id_usuario"]
    };
    for (const [table, columns] of Object.entries(required)) {
        if (columns.some(column => !schema.get(table)?.has(column))) throw new Error(`El esquema de piar_test no contiene las columnas requeridas de ${table}.`);
    }
    const roleColumn = rows.find(row => row.TABLE_NAME === "usuario" && row.COLUMN_NAME === "rol");
    if (!roleColumn?.COLUMN_TYPE.includes("Docente")) {
        throw new Error("El esquema local no habilita el rol Docente requerido por esta demostración.");
    }
}

function assertDemoSeedPrivileges(grantRows) {
    const required = new Set(["SELECT", "INSERT"]);
    const allowedDml = new Set(["SELECT", "INSERT", "UPDATE", "DELETE"]);
    const scopedPrivileges = new Set();

    for (const row of grantRows) {
        const grant = String(Object.values(row)[0] || "").trim();
        if (!/^GRANT\s/i.test(grant)) {
            throw new Error("No se pudo verificar de forma segura una concesión MySQL.");
        }
        if (/\bWITH\s+GRANT\s+OPTION\b/i.test(grant)) {
            throw new Error("La cuenta de demostración no puede tener GRANT OPTION.");
        }
        const match = grant.match(/^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+/i);
        if (!match) {
            if (/^GRANT\s+[`']/i.test(grant)) {
                throw new Error("La cuenta de demostración tiene roles MySQL asignados; revísalos antes de continuar.");
            }
            throw new Error("No se pudo verificar de forma segura una concesión MySQL.");
        }

        const privileges = match[1].toUpperCase().split(",").map(value => value.trim());
        const scope = match[2].replace(/[\s`]/g, "").replace(/\\([_%])/g, "$1").toLowerCase();
        const usageOnly = privileges.length === 1 && privileges[0] === "USAGE";
        if (usageOnly && scope === "*.*") continue;
        if (scope !== "piar_test.*") {
            throw new Error("Los permisos efectivos deben estar limitados exclusivamente a piar_test.*.");
        }
        if (privileges.some(privilege => !allowedDml.has(privilege))) {
            throw new Error("La cuenta de demostración tiene privilegios peligrosos o distintos de DML en piar_test.*.");
        }
        for (const privilege of privileges) scopedPrivileges.add(privilege);
    }

    const missing = [...required].filter(privilege => !scopedPrivileges.has(privilege));
    if (missing.length) {
        throw new Error(`La cuenta de demostración requiere permisos ${missing.join(" y ")} limitados a piar_test.*.`);
    }
}

async function createAccounts(connection, accounts, passwords) {
    await connection.beginTransaction();
    try {
        const account = accounts.teacher;
        if (!account || account.role !== "Docente") throw new Error("El inicializador local solo admite una cuenta Docente demo.");
        {
            const [duplicates] = await connection.execute("SELECT id_usuario FROM usuario WHERE LOWER(correo) = ? OR documento = ? LIMIT 1", [account.email, account.document]);
            if (duplicates.length) throw new Error("Ya existe una cuenta con uno de los identificadores sintéticos solicitados; no se modificaron cuentas.");
        }
        const teacherHash = await bcrypt.hash(passwords.teacher, 12);
        const [teacherResult] = await connection.execute(
            "INSERT INTO usuario (nombre, documento, correo, rol, contrasena, password_hash, estado, correo_verificado_at) VALUES (?, ?, ?, 'Docente', '', ?, 'activo', CURRENT_TIMESTAMP)",
            [accounts.teacher.name, accounts.teacher.document, accounts.teacher.email, teacherHash]
        );
        await connection.execute(
            "INSERT INTO docente (nombre, correo, nombres, apellidos, documento, estado, id_usuario) VALUES (?, ?, ?, ?, ?, 'activo', ?)",
            [accounts.teacher.name, accounts.teacher.email, accounts.teacher.firstName, accounts.teacher.lastName, accounts.teacher.document, teacherResult.insertId]
        );
        await connection.commit();
        return { teacherId: teacherResult.insertId };
    } catch (error) {
        await connection.rollback();
        throw error;
    }
}

async function main() {
    let connection;
    try {
        const accounts = validateDemoInputs(process.env);
        process.stdout.write("Destino fijado por el script: 127.0.0.1:3307 / piar_test, usuario piar_test.\n");
        const confirmation = await new Promise(resolve => {
            const readline = require("node:readline").createInterface({ input: process.stdin, output: process.stdout });
            readline.question(`Escribe exactamente: ${CONFIRMATION}\n> `, answer => { readline.close(); resolve(answer); });
        });
        if (confirmation !== CONFIRMATION) throw new Error("La confirmación no coincide; no se realizaron escrituras.");
        const databasePassword = await readHidden("Contraseña de piar_test (entrada oculta): ");
        const teacherPassword = await readHidden("Contraseña nueva para la cuenta Docente demo (entrada oculta): ");
        if (!databasePassword || teacherPassword.length < 14) {
            throw new Error("La contraseña de base no puede estar vacía y la contraseña demo debe tener al menos 14 caracteres.");
        }
        connection = await mysql.createConnection({ ...TARGET, password: databasePassword, multipleStatements: false, connectTimeout: 5000 });
        await assertTargetAndSchema(connection);
        await createAccounts(connection, accounts, { teacher: teacherPassword });
        process.stdout.write("Cuenta local de demostración creada: 1 Docente con perfil vinculado. El Administrador principal se aprovisiona por separado. No se imprimieron identificadores ni contraseñas.\n");
    } catch (error) {
        process.stderr.write(`${error.code ? `Error MySQL (${error.code})` : error.message}\n`);
        process.exitCode = 1;
    } finally {
        if (connection) await connection.end();
    }
}

if (require.main === module) main();

module.exports = { TARGET, CONFIRMATION, validateDemoInputs, assertTargetAndSchema, assertDemoSeedPrivileges, createAccounts };
