"use strict";

const BARRIER_CONTEXTS = Object.freeze(["aula", "espacios_escolares", "hogar", "entorno_social", "institucional", "otro"]);

function positiveId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function nonEmptyText(value, maxLength = 20000) {
    return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function optionalText(value, maxLength = 20000) {
    return value === undefined || value === null || value === "" || (typeof value === "string" && value.length <= maxLength);
}

function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validateBarrierPayload(payload) {
    if (!payload || !BARRIER_CONTEXTS.includes(payload.contexto)
        || !nonEmptyText(payload.descripcion)
        || !optionalText(payload.actividad)
        || !optionalText(payload.condicion_entorno)
        || !validDate(payload.fecha_identificacion)) return null;
    return {
        contexto: payload.contexto,
        descripcion: payload.descripcion.trim(),
        actividad: payload.actividad?.trim() || null,
        condicion_entorno: payload.condicion_entorno?.trim() || null,
        fecha_identificacion: payload.fecha_identificacion
    };
}

function validateAdjustmentTracePayload(payload) {
    if (!payload || !optionalText(payload.resultado_esperado)
        || !optionalText(payload.indicador_logro)
        || !optionalText(payload.responsable)
        || (payload.fecha_revision_prevista !== undefined && payload.fecha_revision_prevista !== null
            && payload.fecha_revision_prevista !== "" && !validDate(payload.fecha_revision_prevista))) return null;
    const barrierId = payload.id_barrera === undefined || payload.id_barrera === null || payload.id_barrera === ""
        ? null : positiveId(payload.id_barrera);
    const responsibleUserId = payload.id_usuario_responsable === undefined || payload.id_usuario_responsable === null || payload.id_usuario_responsable === ""
        ? null : positiveId(payload.id_usuario_responsable);
    if ((payload.id_barrera !== undefined && payload.id_barrera !== null && payload.id_barrera !== "" && !barrierId)
        || (payload.id_usuario_responsable !== undefined && payload.id_usuario_responsable !== null && payload.id_usuario_responsable !== "" && !responsibleUserId)) return null;
    return {
        id_barrera: barrierId,
        id_usuario_responsable: responsibleUserId,
        resultado_esperado: payload.resultado_esperado?.trim() || null,
        indicador_logro: payload.indicador_logro?.trim() || null,
        fecha_revision_prevista: payload.fecha_revision_prevista || null
    };
}

function validateEvidencePayload(payload) {
    if (!payload || !nonEmptyText(payload.descripcion)
        || !optionalText(payload.referencia, 500)
        || !validDate(payload.fecha)) return null;
    return { descripcion: payload.descripcion.trim(), referencia: payload.referencia?.trim() || null, fecha: payload.fecha };
}

// The three principles of Diseño Universal para el Aprendizaje (CAST).
const DUA_PRINCIPLES = Object.freeze(["representacion", "accion_expresion", "implicacion"]);

function validateDuaPayload(payload) {
    if (!payload || !DUA_PRINCIPLES.includes(payload.principio)
        || !nonEmptyText(payload.estrategia)
        || !optionalText(payload.recursos)
        || !optionalText(payload.area, 100)) return null;
    return {
        principio: payload.principio,
        area: payload.area?.trim() || null,
        estrategia: payload.estrategia.trim(),
        recursos: payload.recursos?.trim() || null
    };
}

function isBlank(value) {
    return value === undefined || value === null || value === "";
}

// Observations and follow-ups must describe something and point to a student or a
// PIAR; otherwise an authorized role could store an empty, orphan record.
// Returns an error message, or null when the payload is acceptable.
function validateRecordPayload(resource, payload) {
    const body = payload && typeof payload === "object" ? payload : {};
    const description = resource === "observaciones" ? (isBlank(body.descripcion) ? body.nota : body.descripcion) : body.descripcion;
    if (!nonEmptyText(description)) return "La descripción es obligatoria.";
    if (!isBlank(body.id_piar) && !positiveId(body.id_piar)) return "El PIAR debe ser un identificador válido.";
    if (!isBlank(body.id_estudiante) && !positiveId(body.id_estudiante)) return "El estudiante debe ser un identificador válido.";
    if (isBlank(body.id_piar) && isBlank(body.id_estudiante)) return "El registro debe indicar el estudiante o el PIAR.";
    if (!isBlank(body.fecha) && !validDate(body.fecha)) return "La fecha debe tener el formato AAAA-MM-DD.";
    return null;
}

module.exports = { BARRIER_CONTEXTS, DUA_PRINCIPLES, positiveId, validDate, validateBarrierPayload, validateAdjustmentTracePayload, validateEvidencePayload, validateDuaPayload, validateRecordPayload };
