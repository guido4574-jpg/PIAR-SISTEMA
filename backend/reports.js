"use strict";

const crypto = require("node:crypto");
const { readPiarSnapshot } = require("./piar-versioning");

// Persisted reports (migration 014). The snapshot is always built on the
// server from MySQL inside a transaction, never accepted from the client, so a
// historic report shows exactly the data that existed when it was generated.
const REPORT_TYPES = Object.freeze(["Seguimiento individual", "Avance de objetivos", "Comité institucional"]);
const DUPLICATE_WINDOW_MINUTES = 10;
const BASE_COLUMNS = "r.id_reporte, r.id_piar, r.id_usuario, r.tipo, r.formato, r.estado, r.created_at";
const EXTENDED_COLUMNS = `${BASE_COLUMNS}, r.id_estudiante, r.periodo, u.nombre AS autor_nombre, e.nombre AS estudiante_nombre`;

let availability = { checkedAt: 0, value: false };

// Cached detection of migration 014 so the API keeps working before it is applied.
async function reportPersistenceAvailable(db, now = Date.now()) {
    if (availability.value || now - availability.checkedAt < 60 * 1000) return availability.value;
    const [rows] = await db.promise().query(
        "SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reporte' AND COLUMN_NAME IN ('id_estudiante', 'periodo', 'contenido', 'contenido_hash')"
    );
    availability = { checkedAt: now, value: Number(rows[0].total) === 4 };
    return availability.value;
}

function validateReportRequest(payload) {
    const piarId = Number(payload?.id_piar);
    const periodo = payload?.periodo === undefined || payload?.periodo === null ? null : String(payload.periodo).trim();
    if (!REPORT_TYPES.includes(payload?.tipo) || !Number.isSafeInteger(piarId) || piarId <= 0
        || (periodo !== null && periodo.length > 50)) return null;
    return { tipo: payload.tipo, piarId, periodo: periodo || null };
}

function reportSnapshot(snapshot, { tipo, periodo }) {
    return {
        version: 1,
        tipo,
        periodo,
        piar: snapshot.piar,
        estudiante: snapshot.estudiante,
        docentes: snapshot.docentes,
        barreras: snapshot.barreras,
        ajustes: snapshot.ajustes,
        dua: snapshot.dua,
        diagnosticos: snapshot.diagnosticos,
        seguimientos: snapshot.seguimientos,
        observaciones: snapshot.observaciones
    };
}

async function createReport(db, { userId, teacherId, tipo, piarId, periodo }) {
    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();
        // teacherId (Docente) restricts the snapshot to assigned PIARs: unassigned -> 404.
        const snapshot = await readPiarSnapshot(connection, piarId, { teacherId });
        if (!snapshot) {
            await connection.rollback();
            return { status: 404, body: { ok: false, message: "PIAR no encontrado." } };
        }
        const content = reportSnapshot(snapshot, { tipo, periodo });
        const serialized = JSON.stringify(content);
        const hash = crypto.createHash("sha256").update(serialized).digest("hex");
        const [duplicates] = await connection.query(
            "SELECT id_reporte FROM reporte WHERE id_usuario = ? AND id_piar = ? AND contenido_hash = ? AND created_at > CURRENT_TIMESTAMP - INTERVAL ? MINUTE ORDER BY id_reporte DESC LIMIT 1 FOR UPDATE",
            [userId, piarId, hash, DUPLICATE_WINDOW_MINUTES]
        );
        if (duplicates.length) {
            await connection.commit();
            return { status: 200, body: { ok: true, data: { id_reporte: duplicates[0].id_reporte, duplicado: true } } };
        }
        const [inserted] = await connection.query(
            "INSERT INTO reporte (id_piar, id_estudiante, id_usuario, tipo, periodo, formato, filtros, contenido, contenido_hash, estado) VALUES (?, ?, ?, ?, ?, 'json', ?, ?, ?, 'generado')",
            [piarId, snapshot.piar.id_estudiante, userId, tipo, periodo, JSON.stringify({ tipo, periodo }), serialized, hash]
        );
        await connection.commit();
        return { status: 201, body: { ok: true, data: { id_reporte: inserted.insertId, duplicado: false } } };
    } catch (error) {
        try { await connection.rollback(); } catch { /* preserve original error */ }
        throw error;
    } finally {
        connection.release();
    }
}

function teacherScope(teacherId) {
    return teacherId ? " AND EXISTS (SELECT 1 FROM piar_docente pd WHERE pd.id_piar = r.id_piar AND pd.id_docente = ?)" : "";
}

async function listReports(db, { teacherId, studentId, piarId }) {
    const extended = await reportPersistenceAvailable(db);
    const filters = [];
    const values = [];
    if (extended && studentId) { filters.push("r.id_estudiante = ?"); values.push(studentId); }
    if (piarId) { filters.push("r.id_piar = ?"); values.push(piarId); }
    const where = `WHERE 1 = 1${filters.map(filter => ` AND ${filter}`).join("")}${teacherScope(teacherId)}`;
    if (teacherId) values.push(teacherId);
    const sql = extended
        ? `SELECT ${EXTENDED_COLUMNS} FROM reporte r LEFT JOIN usuario u ON u.id_usuario = r.id_usuario LEFT JOIN estudiante e ON e.id_estudiante = r.id_estudiante ${where} ORDER BY r.id_reporte DESC LIMIT 200`
        : `SELECT ${BASE_COLUMNS} FROM reporte r ${where} ORDER BY r.id_reporte DESC LIMIT 200`;
    const [rows] = await db.promise().query(sql, values);
    return rows;
}

async function getReport(db, { reportId, teacherId }) {
    const extended = await reportPersistenceAvailable(db);
    const values = teacherId ? [reportId, teacherId] : [reportId];
    const sql = extended
        ? `SELECT ${EXTENDED_COLUMNS}, r.contenido FROM reporte r LEFT JOIN usuario u ON u.id_usuario = r.id_usuario LEFT JOIN estudiante e ON e.id_estudiante = r.id_estudiante WHERE r.id_reporte = ?${teacherScope(teacherId)}`
        : `SELECT ${BASE_COLUMNS} FROM reporte r WHERE r.id_reporte = ?${teacherScope(teacherId)}`;
    const [rows] = await db.promise().query(sql, values);
    if (!rows.length) return null;
    const row = rows[0];
    if (typeof row.contenido === "string") row.contenido = JSON.parse(row.contenido);
    return row;
}

function resetReportAvailabilityCache() {
    availability = { checkedAt: 0, value: false };
}

module.exports = { REPORT_TYPES, reportPersistenceAvailable, validateReportRequest, createReport, listReports, getReport, resetReportAvailabilityCache };
