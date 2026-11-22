"use strict";

const { resolveTeacherProfile, hasAssignedPiar } = require("./student-access");

const INSTITUTIONAL_RESPONSIBLE_ROLES = Object.freeze(["Administrador", "Rector", "Coordinador", "Psicóloga"]);

async function canBePiarResponsible(query, userId, piarId) {
    const id = Number(userId);
    const planId = Number(piarId);
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(planId) || planId <= 0) return false;
    const users = await query("SELECT id_usuario, rol, estado FROM usuario WHERE id_usuario = ? LIMIT 1", [id]);
    if (users.length !== 1 || users[0].estado !== "activo") return false;
    if (INSTITUTIONAL_RESPONSIBLE_ROLES.includes(users[0].rol)) return true;
    if (users[0].rol !== "Docente") return false;
    const profile = await resolveTeacherProfile(query, id);
    return profile ? hasAssignedPiar(query, profile.id_docente, planId) : false;
}

module.exports = { INSTITUTIONAL_RESPONSIBLE_ROLES, canBePiarResponsible };
