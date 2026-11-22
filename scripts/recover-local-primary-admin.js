"use strict";

// Does not load .env: the bootstrap module loads backend/config under its test
// guard, so local DB_* values in .env (e.g. DB_PORT=3306) cannot redirect or
// block this CLI. The destination is fixed by TARGET (127.0.0.1:3307/piar_test).
const mysql = require("mysql2/promise");
const { assertDemoSeedPrivileges } = require("./create-local-demo-accounts");
const { mysqlConnectionConfig } = require("./local-piar-test-config");
const { validateTargetEnvironment, assertTargetAndSchema, assertBootstrapTarget, TARGET, readLine, readHidden } = require("./bootstrap-local-primary-admin");
const { recoverExistingAdminPassword } = require("../backend/admin-account-operations");

const CONFIRMATION = "RECUPERAR ADMINISTRADOR LOCAL EN piar_test";

async function listAdministrators(connection) {
    const [rows] = await connection.execute(
        "SELECT id_usuario, correo, rol, estado, correo_verificado_at FROM usuario WHERE rol = 'Administrador' ORDER BY id_usuario"
    );
    return rows;
}

async function assertRecoverySchema(connection) {
    await assertTargetAndSchema(connection);
    const [grants] = await connection.query("SHOW GRANTS");
    assertDemoSeedPrivileges(grants);
    const [rows] = await connection.execute(
        "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('sesion_usuario','recuperacion_contrasena')",
        [TARGET.database]
    );
    const columns = new Map();
    for (const row of rows) {
        if (!columns.has(row.TABLE_NAME)) columns.set(row.TABLE_NAME, new Set());
        columns.get(row.TABLE_NAME).add(row.COLUMN_NAME);
    }
    for (const [table, expected] of Object.entries({
        sesion_usuario: ["id_usuario", "revoked_at"],
        recuperacion_contrasena: ["id_usuario", "consumed_at"]
    })) {
        if (expected.some(column => !columns.get(table)?.has(column))) throw new Error(`Falta el esquema ${table}; no se modificó ninguna cuenta.`);
    }
}

async function main() {
    let connection;
    try {
        validateTargetEnvironment();
        if (await readLine(`Destino fijado: ${TARGET.host}:${TARGET.port} / ${TARGET.database}. Escribe ${CONFIRMATION}:\n> `) !== CONFIRMATION) {
            throw new Error("La confirmación del destino no coincide; no se hizo ninguna consulta.");
        }
        const databasePassword = await readHidden("Contraseña local de piar_test (entrada oculta): ");
        if (!databasePassword) throw new Error("La contraseña de piar_test no puede estar vacía.");
        connection = await mysql.createConnection(mysqlConnectionConfig(databasePassword, "existing"));
        await assertRecoverySchema(connection);
        await assertBootstrapTarget(connection);

        const administrators = await listAdministrators(connection);
        if (!administrators.length) throw new Error("No hay Administradores existentes; usa el bootstrap inicial después de contar con autorización.");
        process.stdout.write("Administradores existentes (selección manual obligatoria):\n");
        for (const row of administrators) {
            process.stdout.write(`ID ${Number(row.id_usuario)} | ${String(row.correo)} | ${row.estado} | correo verificado: ${row.correo_verificado_at ? "sí" : "no"}\n`);
        }
        const userIdText = await readLine("ID exacto de la cuenta autorizada para recuperar: ");
        const userId = Number(userIdText);
        if (!Number.isSafeInteger(userId) || !administrators.some(row => Number(row.id_usuario) === userId)) {
            throw new Error("El ID no coincide con una cuenta Administrador listada; no se modificó ninguna cuenta.");
        }
        if (await readLine(`Confirma exclusivamente la cuenta ID ${userId} (escribe ${userId}): `) !== String(userId)) {
            throw new Error("La confirmación de cuenta no coincide; no se modificó ninguna cuenta.");
        }
        const operatorIdentityClaim = await readLine("Identidad declarada del operador local (no autenticada por este CLI): ");
        const authorizationReference = await readLine("Referencia de autorización comprobada fuera de PIAR: ");
        const reason = await readLine("Motivo de recuperación: ");
        if (await readLine("Confirma que tienes autorización para esta recuperación (escribe SI): ") !== "SI") {
            throw new Error("No se confirmó la autorización; no se modificó ninguna cuenta.");
        }
        if (await readLine(`Para autorizar la escritura escribe exactamente: ${CONFIRMATION}\n> `) !== CONFIRMATION) {
            throw new Error("La confirmación de escritura no coincide; no se modificó ninguna cuenta.");
        }
        const password = await readHidden("Nueva contraseña (entrada oculta, mínimo 14 caracteres): ");
        const repeated = await readHidden("Repite la contraseña (entrada oculta): ");
        if (password.length < 14 || password !== repeated) throw new Error("Las contraseñas deben coincidir y tener al menos 14 caracteres.");
        await recoverExistingAdminPassword(connection, { userId, password, operatorIdentityClaim, authorizationReference, reason });
        process.stdout.write(`Recuperación aplicada a la cuenta Administrador ID ${userId}. Se revocaron sesiones y enlaces de recuperación pendientes.\n`);
    } catch (error) {
        process.stderr.write(`${error.code ? `Error MySQL (${error.code})` : error.message}\n`);
        process.exitCode = 1;
    } finally {
        if (connection) await connection.end();
    }
}

if (require.main === module) main();

module.exports = { CONFIRMATION, listAdministrators, assertRecoverySchema, main };
