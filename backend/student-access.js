"use strict";

const RESOURCE_TABLES = Object.freeze({
    diagnosticos: { table: "diagnostico", id: "id_diagnostico" },
    seguimientos: { table: "seguimiento", id: "id_seguimiento" },
    observaciones: { table: "observacion", id: "id_observacion" },
    historial: { table: "historial", id: "id_historial" },
    reportes: { table: "reporte", id: "id_reporte" }
});

async function resolveTeacherProfile(query, userId) {
    const profiles = await query(
        "SELECT id_docente, estado FROM docente WHERE id_usuario = ? ORDER BY id_docente",
        [userId]
    );
    // Legacy duplicates and inactive/missing links fail closed. Do not guess which profile is authoritative.
    if (profiles.length !== 1 || profiles[0].estado !== "activo") return null;
    return profiles[0];
}

async function hasAssignedPiar(query, teacherId, piarId) {
    if (!Number.isSafeInteger(Number(teacherId)) || !Number.isSafeInteger(Number(piarId))) return false;
    const rows = await query(
        "SELECT 1 FROM piar_docente pd INNER JOIN piar p ON p.id_piar = pd.id_piar WHERE pd.id_docente = ? AND pd.id_piar = ? LIMIT 1",
        [Number(teacherId), Number(piarId)]
    );
    return rows.length === 1;
}

async function assignedPiarForResource(query, resource, recordId) {
    const definition = RESOURCE_TABLES[resource];
    if (!definition || !Number.isSafeInteger(Number(recordId))) return null;
    const rows = await query(
        `SELECT id_piar FROM ${definition.table} WHERE ${definition.id} = ? LIMIT 1`,
        [Number(recordId)]
    );
    return rows.length === 1 && rows[0].id_piar !== null ? Number(rows[0].id_piar) : null;
}

async function canTeacherAccessResource(query, resource, recordId, teacherId) {
    const definition = RESOURCE_TABLES[resource];
    if (!definition || !Number.isSafeInteger(Number(recordId)) || !Number.isSafeInteger(Number(teacherId))) return false;
    const rows = await query(
        `SELECT id_piar, ${["diagnosticos", "seguimientos", "observaciones"].includes(resource) ? "id_estudiante" : "NULL AS id_estudiante"} FROM ${definition.table} WHERE ${definition.id} = ? LIMIT 1`,
        [Number(recordId)]
    );
    if (rows.length !== 1) return false;
    if (rows[0].id_piar !== null) return hasAssignedPiar(query, teacherId, Number(rows[0].id_piar));
    if (rows[0].id_estudiante !== null) {
        const assigned = await query(
            "SELECT 1 FROM piar p INNER JOIN piar_docente pd ON pd.id_piar = p.id_piar WHERE p.id_estudiante = ? AND pd.id_docente = ? LIMIT 1",
            [Number(rows[0].id_estudiante), Number(teacherId)]
        );
        return assigned.length === 1;
    }
    return false;
}

module.exports = { resolveTeacherProfile, hasAssignedPiar, assignedPiarForResource, canTeacherAccessResource };
