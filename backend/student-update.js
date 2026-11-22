"use strict";

// Actualización parcial de estudiantes (PUT /api/estudiantes/:id).
// Solo se escriben los campos presentes en la petición: un campo omitido
// conserva su valor. Un campo opcional enviado vacío ("" o null) se vacía de
// forma explícita; los obligatorios no se pueden vaciar.

const STUDENT_STATES = Object.freeze(["activo", "revision", "cerrado", "inactivo"]);
const TEXT_MAX_BYTES = 65535;

// keys: nombres aceptados en la petición (formato actual y heredado).
const STUDENT_FIELDS = Object.freeze([
    { keys: ["nombre"], column: "nombre", type: "text", max: 200, required: true, label: "El nombre" },
    { keys: ["documento"], column: "documento", type: "text", max: 30, required: true, label: "El documento" },
    { keys: ["edad"], column: "edad", type: "age", label: "La edad" },
    { keys: ["curso", "grado"], column: "curso", type: "text", max: 50, label: "El grado" },
    { keys: ["condicion_especial", "discapacidad"], column: "condicion_especial", type: "text", max: 150, label: "La condición" },
    { keys: ["nombres"], column: "nombres", type: "text", max: 100, label: "Los nombres" },
    { keys: ["apellidos"], column: "apellidos", type: "text", max: 100, label: "Los apellidos" },
    { keys: ["fecha_nacimiento", "fechaNacimiento"], column: "fecha_nacimiento", type: "date", label: "La fecha de nacimiento" },
    { keys: ["jornada"], column: "jornada", type: "text", max: 30, label: "La jornada" },
    { keys: ["estado"], column: "estado", type: "state", required: true, label: "El estado" },
    { keys: ["acudiente"], column: "acudiente", type: "text", max: 150, label: "El acudiente" },
    { keys: ["telefono"], column: "telefono", type: "text", max: 30, label: "El teléfono" },
    { keys: ["contexto"], column: "contexto", type: "longtext", label: "El contexto" },
    { keys: ["valoracion"], column: "valoracion", type: "longtext", label: "La valoración" },
    { keys: ["fortalezas"], column: "fortalezas", type: "list", label: "Las fortalezas" },
    { keys: ["barreras"], column: "barreras", type: "list", label: "Las barreras" },
    { keys: ["apoyos_requeridos", "apoyosRequeridos"], column: "apoyos_requeridos", type: "list", label: "Los apoyos requeridos" },
    { keys: ["actividades_casa", "actividadesCasa"], column: "actividades_casa", type: "longtext", label: "Las actividades en casa" }
]);

function isEmpty(value) {
    return value === null || (typeof value === "string" && value.trim() === "");
}

function normalizeField(field, raw) {
    if (isEmpty(raw)) {
        if (field.required) return { error: `${field.label} es obligatorio y no se puede vaciar.` };
        return { value: field.type === "list" ? JSON.stringify([]) : null };
    }
    switch (field.type) {
        case "text":
        case "longtext": {
            if (typeof raw !== "string" && typeof raw !== "number") return { error: `${field.label} debe ser texto.` };
            const value = String(raw).trim();
            if (field.type === "text" && [...value].length > field.max) return { error: `${field.label} supera ${field.max} caracteres.` };
            if (field.type === "longtext" && Buffer.byteLength(value, "utf8") > TEXT_MAX_BYTES) return { error: `${field.label} supera la longitud permitida.` };
            return { value };
        }
        case "age": {
            const value = Number(raw);
            if (!Number.isInteger(value) || value < 0 || value > 120) return { error: `${field.label} debe ser un número entero entre 0 y 120.` };
            return { value };
        }
        case "date": {
            const value = String(raw).trim().slice(0, 10);
            if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
                return { error: `${field.label} debe tener el formato AAAA-MM-DD.` };
            }
            return { value };
        }
        case "state": {
            const value = String(raw).trim();
            if (!STUDENT_STATES.includes(value)) return { error: `${field.label} no es válido.` };
            return { value };
        }
        case "list": {
            const items = Array.isArray(raw) ? raw : (typeof raw === "string" ? raw.split(",") : null);
            if (!items || items.some(item => typeof item !== "string" && typeof item !== "number")) return { error: `${field.label} debe ser una lista de textos.` };
            const value = JSON.stringify(items.map(item => String(item).trim()).filter(Boolean));
            if (Buffer.byteLength(value, "utf8") > TEXT_MAX_BYTES) return { error: `${field.label} supera la longitud permitida.` };
            return { value };
        }
        default:
            return { error: "Campo no admitido." };
    }
}

/**
 * Construye la actualización a partir de los campos presentes.
 * @param {object} payload cuerpo de la petición
 * @param {{nombres?: string|null, apellidos?: string|null}} current fila actual (para recomponer el nombre)
 * @returns {{error: string} | {columns: string[], values: any[]}}
 */
function buildStudentUpdate(payload, current = {}) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { error: "El cuerpo de la solicitud no es válido." };
    const updates = new Map();
    for (const field of STUDENT_FIELDS) {
        const key = field.keys.find(name => Object.hasOwn(payload, name));
        if (key === undefined) continue;
        const result = normalizeField(field, payload[key]);
        if (result.error) return { error: result.error };
        updates.set(field.column, result.value);
    }
    // El nombre completo se recompone cuando solo llegan nombres o apellidos.
    if (!updates.has("nombre") && (updates.has("nombres") || updates.has("apellidos"))) {
        const nombres = updates.has("nombres") ? updates.get("nombres") : current.nombres;
        const apellidos = updates.has("apellidos") ? updates.get("apellidos") : current.apellidos;
        const fullName = [nombres, apellidos].filter(Boolean).join(" ").trim();
        if (fullName) {
            if ([...fullName].length > 200) return { error: "El nombre supera 200 caracteres." };
            updates.set("nombre", fullName);
        }
    }
    if (!updates.size) return { error: "No hay campos válidos para actualizar." };
    return { columns: [...updates.keys()], values: [...updates.values()] };
}

module.exports = { buildStudentUpdate, STUDENT_FIELDS, STUDENT_STATES };
