"use strict";

const { recordAdminAccountEvent } = require("./admin-account-audit");

// Decisión D2: perfiles que se pueden aprobar. Solo Docente crea o activa su perfil
// `docente`; Psicóloga, Coordinador y Rector se activan sin perfil adicional.
const APPROVABLE_ROLES = Object.freeze(["Docente", "Psicóloga", "Coordinador", "Rector"]);
const ROLE_PLACEHOLDERS = APPROVABLE_ROLES.map(() => "?").join(", ");

async function decidePendingTeacher(db, userId, decision, approverId, reason = "") {
    if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0 || !["aprobar", "rechazar"].includes(decision)) {
        return { status: 400, message: "Decisión de aprobación no válida." };
    }
    if (!Number.isSafeInteger(Number(approverId)) || Number(approverId) <= 0) {
        return { status: 400, message: "No se pudo identificar a quien decide la solicitud." };
    }
    const normalizedReason = String(reason || "").trim();
    if (decision === "rechazar" && (!normalizedReason || normalizedReason.length > 500)) {
        return { status: 400, message: "Indica un motivo de rechazo de hasta 500 caracteres." };
    }
    if (Number(userId) === Number(approverId)) {
        return { status: 403, message: "No puedes decidir sobre tu propia solicitud." };
    }
    const nextState = decision === "aprobar" ? "activo" : "rechazado";
    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();
        const [users] = await connection.query(
            `SELECT id_usuario, nombre, documento, correo, rol FROM usuario WHERE id_usuario = ? AND estado = 'pendiente' AND rol IN (${ROLE_PLACEHOLDERS}) AND correo_verificado_at IS NOT NULL FOR UPDATE`,
            [Number(userId), ...APPROVABLE_ROLES]
        );
        if (!users.length) {
            await connection.rollback();
            return { status: 404, message: "Solicitud pendiente no encontrada." };
        }

        if (decision === "aprobar" && users[0].rol === "Docente") {
            const [profiles] = await connection.query(
                "SELECT id_docente FROM docente WHERE id_usuario = ? FOR UPDATE",
                [Number(userId)]
            );
            // Ambiguous legacy links fail closed; never guess which profile to use.
            if (profiles.length > 1) {
                await connection.rollback();
                return { status: 409, message: "La cuenta tiene perfiles docentes duplicados; requiere revisión institucional." };
            }
            if (profiles.length === 1) {
                await connection.query("UPDATE docente SET estado = 'activo' WHERE id_docente = ?", [profiles[0].id_docente]);
            } else {
                await connection.query(
                    "INSERT INTO docente (nombre, correo, documento, estado, id_usuario) VALUES (?, ?, ?, 'activo', ?)",
                    [users[0].nombre, users[0].correo, users[0].documento, Number(userId)]
                );
            }
        }

        const [result] = await connection.query(
            "UPDATE usuario SET estado = ?, aprobado_por_usuario_id = ?, rechazado_por_usuario_id = ?, decision_reason = ?, decision_at = CURRENT_TIMESTAMP WHERE id_usuario = ? AND estado = 'pendiente' AND rol = ? AND correo_verificado_at IS NOT NULL",
            [nextState, decision === "aprobar" ? Number(approverId) : null, decision === "rechazar" ? Number(approverId) : null, decision === "rechazar" ? normalizedReason : null, Number(userId), users[0].rol]
        );
        if (!Number(result.affectedRows)) {
            await connection.rollback();
            return { status: 404, message: "Solicitud pendiente no encontrada." };
        }
        // El motivo del rechazo queda en usuario.decision_reason.
        await recordAdminAccountEvent(connection, {
            targetUserId: Number(userId), operation: decision === "aprobar" ? "registration_approved" : "registration_rejected",
            outcome: "success", operatorIdentityClaim: String(Number(approverId)), operatorIdentitySource: "admin_session",
            authorizationReference: null, reason: null
        });
        await connection.commit();
        return { status: 200, state: nextState };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

module.exports = { decidePendingTeacher, decidePendingRegistration: decidePendingTeacher, APPROVABLE_ROLES };
