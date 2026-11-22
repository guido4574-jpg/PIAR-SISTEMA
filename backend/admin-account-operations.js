"use strict";

const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const { recordAdminAccountEvent } = require("./admin-account-audit");

const ADMIN_OPERATION_LOCK = "piar-primary-admin-piar_test";
// The client reaches the container piar-mysql-test through host port 3307;
// @@port reports the MySQL listener inside the container, which is 3306.
const TARGET = Object.freeze({ database: "piar_test", serverPort: 3306, accountPrefix: "piar_test@" });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function assertPassword(password) {
    if (typeof password !== "string" || password.length < 14 || Buffer.byteLength(password, "utf8") > 72) {
        throw new Error("La contraseña debe tener entre 14 y 72 bytes.");
    }
}

// Campos de atribución del operador y sus límites, alineados con admin_account_audit.
const OPERATOR_FIELDS = Object.freeze({
    operatorIdentityClaim: Object.freeze({ label: "Identidad declarada del operador", maxLength: 150 }),
    authorizationReference: Object.freeze({ label: "Referencia de autorización", maxLength: 128 }),
    reason: Object.freeze({ label: "Motivo", maxLength: 500 })
});
// Incluye tabulaciones, saltos de línea y el resto de caracteres de control ASCII.
const CONTROL_CHARACTERS = /[\x00-\x1f]/;

// Devuelve null si el texto es válido o un mensaje en español que indica el problema.
// El mensaje nunca incluye el valor recibido, solo su longitud.
function textFieldProblem(label, value, maxLength) {
    if (typeof value !== "string" || !value.trim()) return `El campo «${label}» está vacío y es obligatorio.`;
    if (value.length > maxLength) return `El campo «${label}» supera el máximo de ${maxLength} caracteres (tiene ${value.length}).`;
    if (CONTROL_CHARACTERS.test(value)) return `El campo «${label}» contiene tabulaciones, saltos de línea u otros caracteres de control.`;
    return null;
}

function operatorFieldProblem(field, value) {
    const rule = OPERATOR_FIELDS[field];
    if (!rule) throw new Error("Campo de atribución desconocido.");
    return textFieldProblem(rule.label, value, rule.maxLength);
}

function validateOperator(input) {
    const problems = Object.keys(OPERATOR_FIELDS)
        .map(field => operatorFieldProblem(field, input?.[field]))
        .filter(Boolean);
    if (problems.length) {
        throw new Error(`Datos de autorización no válidos. ${problems.join(" ")} No se modificó ninguna cuenta.`);
    }
}

async function assertLocalAdminDatabase(connection) {
    const [[row]] = await connection.query("SELECT DATABASE() AS database_name, @@port AS server_port, @@read_only AS read_only, CURRENT_USER() AS account_name");
    if (row?.database_name !== TARGET.database || Number(row.server_port) !== TARGET.serverPort || Number(row.read_only) !== 0
        || !String(row.account_name || "").toLowerCase().startsWith(TARGET.accountPrefix)) {
        throw new Error("Operación cancelada: la conexión no corresponde a la instancia local piar_test autorizada.");
    }
}

async function withAdminOperationLock(connection, operation) {
    await assertLocalAdminDatabase(connection);
    const [[lock]] = await connection.execute("SELECT GET_LOCK(?, 15) AS acquired", [ADMIN_OPERATION_LOCK]);
    if (Number(lock?.acquired) !== 1) throw new Error("No se pudo reservar la operación administrativa local.");
    try {
        return await operation();
    } finally {
        await connection.execute("SELECT RELEASE_LOCK(?)", [ADMIN_OPERATION_LOCK]);
    }
}

async function createInitialAdmin(connection, input) {
    validateOperator(input);
    assertPassword(input.password);
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const document = typeof input.document === "string" ? input.document.trim() : "";
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (!name || name.length > 150 || !document || document.length > 30 || !EMAIL.test(email) || email.length > 150) {
        throw new Error("Nombre, documento o correo no cumplen el esquema local.");
    }

    return withAdminOperationLock(connection, async () => {
        let transactionStarted = false;
        try {
            await connection.beginTransaction();
            transactionStarted = true;
            const [admins] = await connection.execute("SELECT id_usuario FROM usuario WHERE rol = 'Administrador' LIMIT 1 FOR UPDATE");
            if (admins.length) throw new Error("Ya existe una cuenta Administrador; no se creó otra.");
            const [existing] = await connection.execute("SELECT id_usuario FROM usuario WHERE correo = ? OR documento = ? LIMIT 1 FOR UPDATE", [email, document]);
            if (existing.length) throw new Error("El correo o documento ya pertenece a una cuenta; no se cambió su rol.");

            const passwordHash = await bcrypt.hash(input.password, 12);
            const [created] = await connection.execute(
                "INSERT INTO usuario (nombre, documento, correo, rol, contrasena, password_hash, estado, correo_verificado_at, password_change_required) VALUES (?, ?, ?, 'Administrador', '', ?, 'pendiente_verificacion', NULL, 1)",
                [name, document, email, passwordHash]
            );
            const token = crypto.randomBytes(32).toString("base64url");
            const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
            await connection.execute(
                "INSERT INTO verificacion_correo (id_usuario, token_hash, expires_at) VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 24 HOUR))",
                [created.insertId, tokenHash]
            );
            await recordAdminAccountEvent(connection, {
                targetUserId: Number(created.insertId), operation: "initial_admin_created", outcome: "pending_verification",
                operatorIdentityClaim: input.operatorIdentityClaim.trim(), operatorIdentitySource: "local_cli_self_asserted",
                authorizationReference: input.authorizationReference.trim(), reason: input.reason.trim()
            });
            await connection.commit();
            transactionStarted = false;
            return { userId: Number(created.insertId), verificationToken: token };
        } catch (error) {
            if (transactionStarted) await connection.rollback();
            throw error;
        }
    });
}

async function recoverExistingAdminPassword(connection, input) {
    validateOperator(input);
    assertPassword(input.password);
    const userId = Number(input.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0 || String(input.userId).trim() !== String(userId)) {
        throw new Error("Debes identificar explícitamente un ID de cuenta Administrador válido.");
    }

    return withAdminOperationLock(connection, async () => {
        let transactionStarted = false;
        try {
            await connection.beginTransaction();
            transactionStarted = true;
            const [users] = await connection.execute(
                "SELECT id_usuario, rol, estado FROM usuario WHERE id_usuario = ? LIMIT 1 FOR UPDATE", [userId]
            );
            if (!users.length || users[0].rol !== "Administrador" || users[0].estado !== "activo") {
                throw new Error("La cuenta seleccionada no es un Administrador activo; no se modificó ninguna cuenta.");
            }
            const passwordHash = await bcrypt.hash(input.password, 12);
            const [updated] = await connection.execute(
                "UPDATE usuario SET password_hash = ?, contrasena = '' WHERE id_usuario = ? AND rol = 'Administrador' AND estado = 'activo'",
                [passwordHash, userId]
            );
            if (Number(updated.affectedRows) !== 1) throw new Error("La cuenta cambió durante la operación; no se guardó la recuperación.");
            await connection.execute(
                "UPDATE sesion_usuario SET revoked_at = CURRENT_TIMESTAMP WHERE id_usuario = ? AND revoked_at IS NULL", [userId]
            );
            await connection.execute(
                "UPDATE recuperacion_contrasena SET consumed_at = CURRENT_TIMESTAMP WHERE id_usuario = ? AND consumed_at IS NULL", [userId]
            );
            await recordAdminAccountEvent(connection, {
                targetUserId: userId, operation: "password_recovered", outcome: "success",
                operatorIdentityClaim: input.operatorIdentityClaim.trim(), operatorIdentitySource: "local_cli_self_asserted",
                authorizationReference: input.authorizationReference.trim(), reason: input.reason.trim()
            });
            await connection.commit();
            transactionStarted = false;
            return { userId };
        } catch (error) {
            if (transactionStarted) await connection.rollback();
            throw error;
        }
    });
}

module.exports = {
    ADMIN_OPERATION_LOCK, OPERATOR_FIELDS, textFieldProblem, operatorFieldProblem, assertPassword, validateOperator, assertLocalAdminDatabase,
    createInitialAdmin, recoverExistingAdminPassword
};
