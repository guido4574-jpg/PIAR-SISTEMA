"use strict";

// Validación de perfiles docentes (POST y PUT /api/docentes).
// Longitudes según el esquema: docente.documento es VARCHAR(30) desde la migración 012.

const TEACHER_STATES = Object.freeze(["activo", "inactivo"]);
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const TEXT_MAX_BYTES = 65535;
const TEACHER_FIELDS = Object.freeze([
    { key: "nombre", max: 150, label: "El nombre" },
    { key: "nombres", max: 100, label: "Los nombres" },
    { key: "apellidos", max: 100, label: "Los apellidos" },
    { key: "area", max: 100, label: "El área" },
    { key: "correo", max: 150, label: "El correo", email: true },
    { key: "documento", max: 30, label: "El documento" },
    { key: "cargo", max: 100, label: "El cargo" },
    { key: "telefono", max: 30, label: "El teléfono" },
    { key: "perfil", long: true, label: "El perfil" },
    { key: "estado", label: "El estado", states: TEACHER_STATES }
]);

/**
 * Devuelve { error } o { values } con los campos presentes ya normalizados.
 * Un campo vacío se normaliza a null. En creación (partial=false) se exige el nombre
 * (o nombres/apellidos) y el estado por defecto es "activo".
 */
function validateTeacherPayload(payload, { partial = false } = {}) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { error: "El cuerpo de la solicitud no es válido." };
    const values = {};
    for (const field of TEACHER_FIELDS) {
        if (!Object.hasOwn(payload, field.key)) continue;
        const raw = payload[field.key];
        if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) { values[field.key] = null; continue; }
        if (typeof raw !== "string" && typeof raw !== "number") return { error: `${field.label} debe ser texto.` };
        const value = String(raw).trim();
        if (field.long ? Buffer.byteLength(value, "utf8") > TEXT_MAX_BYTES : [...value].length > field.max) {
            return { error: `${field.label} supera la longitud permitida${field.max ? ` (${field.max} caracteres)` : ""}.` };
        }
        if (field.email && !EMAIL.test(value)) return { error: "El correo del docente no es válido." };
        if (field.states && !field.states.includes(value)) return { error: "El estado del docente debe ser activo o inactivo." };
        values[field.key] = value;
    }
    if (!values.nombre && (values.nombres || values.apellidos)) {
        const fullName = [values.nombres, values.apellidos].filter(Boolean).join(" ");
        if ([...fullName].length > 150) return { error: "El nombre supera la longitud permitida (150 caracteres)." };
        if (!partial || Object.hasOwn(payload, "nombre")) values.nombre = fullName;
    }
    if (!partial) {
        if (!values.nombre) return { error: "El nombre del docente es obligatorio" };
        values.estado = values.estado || "activo";
    } else if (Object.hasOwn(payload, "nombre") && !values.nombre) {
        return { error: "El nombre del docente no se puede vaciar." };
    }
    return { values };
}

module.exports = { validateTeacherPayload, TEACHER_STATES };
