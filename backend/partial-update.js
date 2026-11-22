"use strict";

// Actualizaciones parciales: solo se modifican los campos presentes en la
// solicitud. Un campo opcional enviado vacío se guarda como NULL (así se puede
// borrar su contenido); un campo obligatorio enviado vacío es un error.
// Los nombres de columna salen de listas fijas del servidor, nunca del cliente.

function normalizeOptional(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return value.trim() === "" ? null : value.trim();
    return value;
}

/**
 * @returns {{ error: string } | { columns: string[], values: unknown[] }}
 */
function buildPartialUpdate(payload, { required = [], optional = [], labels = {} } = {}) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { error: "El cuerpo de la solicitud no es válido." };
    const columns = [];
    const values = [];
    for (const column of [...required, ...optional]) {
        if (!Object.hasOwn(payload, column)) continue;
        const value = normalizeOptional(payload[column]);
        if (value === null && required.includes(column)) return { error: `${labels[column] || `El campo ${column}`} no se puede dejar vacío.` };
        columns.push(column);
        values.push(value);
    }
    return { columns, values };
}

function assignmentSql(columns) {
    for (const column of columns) {
        if (!/^[a-z_][a-z0-9_]*$/.test(column)) throw new Error("Columna no válida en la actualización parcial.");
    }
    return columns.map(column => `${column} = ?`).join(", ");
}

module.exports = { buildPartialUpdate, assignmentSql, normalizeOptional };
