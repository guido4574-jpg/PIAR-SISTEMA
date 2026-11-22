"use strict";

const { isDeepStrictEqual } = require("node:util");

const PIAR_SNAPSHOT_SQL = Object.freeze({
    piar: "SELECT id_piar, id_estudiante, id_usuario_creador, titulo, periodo, anio, estado, objetivo_general, metas, caracterizacion, barreras, estrategias, informes_salud, proyectos, actividades_receso, otra_informacion, acta_acuerdos, informe_anual, entrega_pedagogica, fecha_creacion, fecha_revision, fecha_cierre, created_at, updated_at FROM piar WHERE id_piar = ?",
    estudiante: "SELECT id_estudiante, nombre, documento, edad, curso, condicion_especial, nombres, apellidos, fecha_nacimiento, jornada, estado, acudiente, telefono, contexto, valoracion, fortalezas, barreras, apoyos_requeridos, actividades_casa, created_at, updated_at FROM estudiante WHERE id_estudiante = ?",
    docentes: "SELECT pd.id_piar, pd.id_docente, pd.es_responsable_principal, pd.created_at AS asignacion_created_at, d.nombre, d.area, d.correo, d.cargo, d.estado FROM piar_docente pd INNER JOIN docente d ON d.id_docente = pd.id_docente WHERE pd.id_piar = ? ORDER BY pd.id_docente",
    ajustes: "SELECT id_ajuste, id_piar, id_barrera, id_usuario_responsable, area, tipo, estrategia, recursos, responsable, resultado_esperado, indicador_logro, fecha_revision_prevista, avance, estado, created_at, updated_at FROM piar_ajuste WHERE id_piar = ? ORDER BY id_ajuste",
    barreras: "SELECT id_barrera, id_piar, contexto, descripcion, actividad, condicion_entorno, fecha_identificacion, id_usuario_registro, created_at FROM piar_barrera WHERE id_piar = ? ORDER BY id_barrera",
    evidencias: "SELECT e.id_evidencia, a.id_piar, e.id_ajuste, e.descripcion, e.referencia, e.fecha, e.id_usuario_autor, e.created_at FROM piar_ajuste_evidencia e INNER JOIN piar_ajuste a ON a.id_ajuste = e.id_ajuste WHERE a.id_piar = ? ORDER BY e.id_evidencia",
    diagnosticos: "SELECT id_diagnostico, tipo_diagnostico, fecha, descripcion, id_estudiante, id_psicologa, id_piar, id_usuario_creador, created_at, updated_at FROM diagnostico WHERE id_piar = ? ORDER BY id_diagnostico",
    seguimientos: "SELECT id_seguimiento, fecha, descripcion, responsable, id_estudiante, id_coordinador, id_piar, id_ajuste, id_usuario_responsable, estado, acuerdos, evolucion, created_at, updated_at FROM seguimiento WHERE id_piar = ? ORDER BY id_seguimiento",
    observaciones: "SELECT id_observacion, fecha, descripcion, docente_responsable, id_estudiante, id_docente, id_piar, id_usuario_autor, tipo, avance, estado, acuerdos, created_at, updated_at FROM observacion WHERE id_piar = ? ORDER BY id_observacion",
    dua: "SELECT id_dua, id_piar, principio, area, estrategia, recursos, id_usuario_registro, created_at, updated_at FROM piar_dua WHERE id_piar = ? ORDER BY id_dua"
});

async function queryRows(connection, sql, params) {
    const [rows] = await connection.query(sql, params);
    return rows;
}

async function readPiarSnapshot(connection, piarId, options = {}) {
    const teacherId = options.teacherId;
    const scope = teacherId === undefined ? "" : " AND EXISTS (SELECT 1 FROM piar_docente pd_scope WHERE pd_scope.id_piar = p.id_piar AND pd_scope.id_docente = ?)";
    const rootSql = PIAR_SNAPSHOT_SQL.piar.replace("FROM piar WHERE id_piar = ?", "FROM piar p WHERE p.id_piar = ?" + scope + " FOR UPDATE");
    const root = await queryRows(connection, rootSql, teacherId === undefined ? [piarId] : [piarId, teacherId]);
    if (!root.length) return null;
    const piar = root[0];
    const lock = " FOR UPDATE";
    const [student, docentes, ajustes, barreras, evidencias, diagnosticos, seguimientos, observaciones, dua] = await Promise.all([
        queryRows(connection, PIAR_SNAPSHOT_SQL.estudiante + lock, [piar.id_estudiante]),
        queryRows(connection, PIAR_SNAPSHOT_SQL.docentes + lock, [piarId]),
        queryRows(connection, PIAR_SNAPSHOT_SQL.ajustes + lock, [piarId]),
        queryRows(connection, PIAR_SNAPSHOT_SQL.barreras + lock, [piarId]),
        queryRows(connection, PIAR_SNAPSHOT_SQL.evidencias + lock, [piarId]),
        queryRows(connection, PIAR_SNAPSHOT_SQL.diagnosticos + lock, [piarId]),
        queryRows(connection, PIAR_SNAPSHOT_SQL.seguimientos + lock, [piarId]),
        queryRows(connection, PIAR_SNAPSHOT_SQL.observaciones + lock, [piarId]),
        queryRows(connection, PIAR_SNAPSHOT_SQL.dua + lock, [piarId])
    ]);
    return {
        piar,
        estudiante: student[0] || null,
        docentes,
        ajustes: ajustes.map(adjustment => ({
            ...adjustment,
            evidencias: evidencias.filter(evidence => Number(evidence.id_ajuste) === Number(adjustment.id_ajuste))
        })),
        barreras,
        diagnosticos,
        seguimientos,
        observaciones,
        dua
    };
}

function normalizeJustification(value) {
    if (typeof value !== "string") return null;
    const justification = value.trim();
    if (!justification || justification.length > 1000) return null;
    return justification;
}

async function appendPiarVersion(connection, { piarId, userId, justification, operation = "actualizacion", before, after }) {
    const safeOperation = /^[a-z_]{1,35}$/.test(operation) ? operation : "actualizacion";
    const description = justification || `Operación: ${safeOperation}`;
    const [historyResult] = await connection.query(
        "INSERT INTO historial (id_piar, id_usuario_creador, tipo_registro, id_referencia, descripcion) VALUES (?, ?, 'version', ?, ?)",
        [piarId, userId, piarId, description]
    );
    const [detailResult] = await connection.query(
        "INSERT INTO historial_detalle (id_historial, tipo_registro, id_referencia, id_usuario, descripcion, valor_anterior, valor_nuevo) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [historyResult.insertId, `piar_version:${safeOperation}`, piarId, userId, description, JSON.stringify(before), JSON.stringify(after)]
    );
    if (Number(historyResult.affectedRows) !== 1 || Number(detailResult.affectedRows) !== 1) {
        throw new Error("No se pudo conservar la versión íntegra del PIAR.");
    }
    return Number(historyResult.insertId);
}

async function runVersionedPiarMutations(db, { piarIds, resolvePiarIds, userId, justification, requireJustification = true, operation = "actualizacion", teacherId, rejectClosed = false, mutate }) {
    const reason = normalizeJustification(justification);
    if (requireJustification && !reason) return { status: 400, message: "La justificación es obligatoria y no puede superar 1000 caracteres." };
    if (justification !== undefined && justification !== null && !reason) return { status: 400, message: "La justificación no puede superar 1000 caracteres." };
    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();
        const resolution = resolvePiarIds ? await resolvePiarIds(connection) : { piarIds };
        if (resolution?.status && resolution.status !== 200) {
            await connection.rollback();
            return resolution;
        }
        const ids = [...new Set((resolution?.piarIds || []).filter(id => id !== null && id !== undefined && id !== "").map(Number))].sort((a, b) => a - b);
        if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
            await connection.rollback();
            return { status: 400, message: "El identificador del PIAR no es válido." };
        }
        const before = new Map();
        for (const id of ids) {
            const snapshot = await readPiarSnapshot(connection, id, { teacherId });
            if (!snapshot) {
                await connection.rollback();
                return { status: 404, message: "PIAR no encontrado." };
            }
            // Closed PIARs are read-only for child records; checked on the locked row.
            if (rejectClosed && snapshot.piar.estado === "cerrado") {
                await connection.rollback();
                return { status: 409, message: "El PIAR está cerrado; únicamente Coordinación puede reabrirlo." };
            }
            before.set(id, snapshot);
        }
        const outcome = await mutate(connection, before, resolution?.context);
        if (outcome?.status && outcome.status !== 200) {
            await connection.rollback();
            return outcome;
        }
        const versionIds = {};
        for (const id of ids) {
            const after = await readPiarSnapshot(connection, id, { teacherId });
            if (!after) throw new Error("El PIAR dejó de estar disponible durante la operación.");
            const explicitlyChanged = outcome?.changedByPiar?.[id];
            const changed = explicitlyChanged ?? outcome?.changed ?? !isDeepStrictEqual(before.get(id), after);
            if (changed) {
                versionIds[id] = await appendPiarVersion(connection, {
                    piarId: id, userId, justification: reason, operation,
                    before: before.get(id), after
                });
            }
        }
        await connection.commit();
        const changed = outcome?.changed ?? Object.keys(versionIds).length > 0;
        return { status: 200, ...outcome, versionIds, versionId: ids.length === 1 ? versionIds[ids[0]] : undefined, unchanged: !changed };
    } catch (error) {
        try { await connection.rollback(); } catch { /* preserve the original error */ }
        throw error;
    } finally {
        connection.release();
    }
}

function runVersionedPiarMutation(db, options) {
    return runVersionedPiarMutations(db, {
        ...options,
        piarIds: [options.piarId],
        mutate: (connection, before, context) => options.mutate(connection, before.get(Number(options.piarId)), context)
    });
}

module.exports = {
    PIAR_SNAPSHOT_SQL,
    appendPiarVersion,
    normalizeJustification,
    readPiarSnapshot,
    runVersionedPiarMutations,
    runVersionedPiarMutation
};
