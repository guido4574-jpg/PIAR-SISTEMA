"use strict";

// Estudiante role (approved institutional decision): read-only access to the
// student's OWN PIAR only. No diagnoses, professional observations, follow-ups,
// versions, history, reports or profile data are reachable from this role.
//
// Every Estudiante request that passes authorization.js is answered here and
// never reaches the institutional handlers in server.js. The student scope is
// always derived from the session (usuario -> estudiante.id_usuario) and never
// from an identifier supplied by the client. Response fields are an explicit
// allow-list so new columns or nested records are not exposed by default.

const STUDENT_ROLE = "Estudiante";

// PIAR columns a student may read. Deliberately excluded:
//   informes_salud     -> health/clinical reports (diagnostic information).
//   id_usuario_creador -> internal authorship identifier.
const STUDENT_PIAR_COLUMNS = Object.freeze([
    "id_piar", "id_estudiante", "titulo", "periodo", "anio", "estado",
    "objetivo_general", "metas", "caracterizacion", "barreras", "estrategias",
    "proyectos", "actividades_receso", "otra_informacion", "acta_acuerdos",
    "informe_anual", "entrega_pedagogica", "fecha_creacion", "fecha_revision", "fecha_cierre"
]);

// Keys that must never appear in a student response (checked by tests).
const STUDENT_FORBIDDEN_KEYS = Object.freeze([
    "diagnosticos", "observaciones", "seguimientos", "historial", "versiones", "reportes",
    "informes_salud", "informesSalud", "id_usuario_creador"
]);

const PIAR_SELECT = STUDENT_PIAR_COLUMNS.map(column => `p.${column}`).join(", ");

const NOT_FOUND = Object.freeze({ status: 404, body: { ok: false, message: "PIAR no encontrado" } });
const FORBIDDEN = Object.freeze({ status: 403, body: { ok: false, message: "No tiene permisos para esta operación." } });
const PROFILE_UNAVAILABLE = Object.freeze({ status: 403, body: { ok: false, message: "El perfil de estudiante no está disponible para esta operación." } });

function positiveId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Fails closed: a missing, inactive or ambiguous link yields no scope. A schema
// without migration 015 (no estudiante.id_usuario column) also yields no scope.
async function resolveStudentProfile(query, userId) {
    const id = positiveId(userId);
    if (id === null) return null;
    let rows;
    try {
        rows = await query("SELECT id_estudiante, estado FROM estudiante WHERE id_usuario = ? ORDER BY id_estudiante", [id]);
    } catch (error) {
        if (error && error.code === "ER_BAD_FIELD_ERROR") return null;
        throw error;
    }
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].estado !== "activo") return null;
    const studentId = positiveId(rows[0].id_estudiante);
    return studentId === null ? null : { id_estudiante: studentId };
}

function pick(row, keys) {
    return Object.fromEntries(keys.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));
}

function studentPiarSummary(row) {
    const piar = pick(row, STUDENT_PIAR_COLUMNS);
    return {
        ...piar,
        id: piar.id_piar,
        studentId: piar.id_estudiante,
        fechaCreacion: piar.fecha_creacion,
        fechaRevision: piar.fecha_revision,
        objetivoGeneral: piar.objetivo_general,
        // "barreras" in the detail holds the structured rows; the free text is exposed apart.
        barreras_texto: piar.barreras
    };
}

async function listOwnPiars(query, profile) {
    const rows = await query(`SELECT ${PIAR_SELECT} FROM piar p WHERE p.id_estudiante = ? ORDER BY p.id_piar DESC`, [profile.id_estudiante]);
    return rows.map(row => {
        const { barreras: _legacyText, ...summary } = studentPiarSummary(row);
        return summary;
    });
}

async function getOwnPiar(query, profile, piarId) {
    const rows = await query(
        `SELECT ${PIAR_SELECT}, e.nombre AS estudiante_nombre FROM piar p INNER JOIN estudiante e ON e.id_estudiante = p.id_estudiante WHERE p.id_piar = ? AND p.id_estudiante = ? LIMIT 1`,
        [piarId, profile.id_estudiante]
    );
    if (rows.length !== 1) return null;
    const [docentes, ajustes, barreras, evidencias, dua] = await Promise.all([
        query("SELECT d.id_docente, d.nombre, d.area, pd.es_responsable_principal FROM piar_docente pd INNER JOIN docente d ON d.id_docente = pd.id_docente WHERE pd.id_piar = ? ORDER BY d.id_docente", [piarId]),
        query("SELECT a.id_ajuste, a.id_barrera, a.area, a.tipo, a.estrategia, a.recursos, a.responsable, u.nombre AS responsable_usuario_nombre, a.resultado_esperado, a.indicador_logro, a.fecha_revision_prevista, a.avance, a.estado FROM piar_ajuste a LEFT JOIN usuario u ON u.id_usuario = a.id_usuario_responsable WHERE a.id_piar = ? ORDER BY a.id_ajuste", [piarId]),
        query("SELECT b.id_barrera, b.contexto, b.descripcion, b.actividad, b.condicion_entorno, b.fecha_identificacion FROM piar_barrera b WHERE b.id_piar = ? ORDER BY b.fecha_identificacion, b.id_barrera", [piarId]),
        query("SELECT e.id_evidencia, e.id_ajuste, e.descripcion, e.fecha FROM piar_ajuste_evidencia e INNER JOIN piar_ajuste a ON a.id_ajuste = e.id_ajuste WHERE a.id_piar = ? ORDER BY e.fecha, e.id_evidencia", [piarId]),
        query("SELECT d.id_dua, d.principio, d.area, d.estrategia, d.recursos FROM piar_dua d WHERE d.id_piar = ? ORDER BY d.principio, d.id_dua", [piarId])
    ]);
    const row = rows[0];
    const principal = docentes.find(docente => Number(docente.es_responsable_principal) === 1) || docentes[0];
    return {
        ...studentPiarSummary(row),
        estudiante: { id_estudiante: Number(row.id_estudiante), nombre: row.estudiante_nombre },
        docentes: docentes.map(docente => pick(docente, ["id_docente", "nombre", "area", "es_responsable_principal"])),
        teacherId: principal?.id_docente || null,
        dua: dua.map(item => pick(item, ["id_dua", "principio", "area", "estrategia", "recursos"])),
        barreras: barreras.map(item => pick(item, ["id_barrera", "contexto", "descripcion", "actividad", "condicion_entorno", "fecha_identificacion"])),
        ajustes: ajustes.map(ajuste => ({
            ...pick(ajuste, ["id_ajuste", "id_barrera", "area", "tipo", "estrategia", "recursos", "responsable", "responsable_usuario_nombre", "resultado_esperado", "indicador_logro", "fecha_revision_prevista", "avance", "estado"]),
            evidencias: evidencias
                .filter(evidence => Number(evidence.id_ajuste) === Number(ajuste.id_ajuste))
                .map(evidence => pick(evidence, ["id_evidencia", "descripcion", "fecha"]))
        }))
    };
}

// Answers every request of an authenticated Estudiante session. Anything that
// is not a read of the student's own PIAR is denied.
async function handleStudentPortalRequest({ query, userId, method, pathname }) {
    if (method !== "GET") return FORBIDDEN;
    const isList = pathname === "/api/piar";
    const detailId = pathname.match(/^\/api\/piar\/(\d+)$/)?.[1];
    if (!isList && detailId === undefined) return FORBIDDEN;

    const profile = await resolveStudentProfile(query, userId);
    if (!profile) return PROFILE_UNAVAILABLE;

    if (isList) return { status: 200, body: { ok: true, data: await listOwnPiars(query, profile) } };

    const piarId = positiveId(detailId);
    if (piarId === null) return NOT_FOUND;
    // Another student's PIAR and a non-existent PIAR are indistinguishable.
    const piar = await getOwnPiar(query, profile, piarId);
    return piar ? { status: 200, body: { ok: true, data: piar } } : NOT_FOUND;
}

module.exports = {
    STUDENT_ROLE,
    STUDENT_PIAR_COLUMNS,
    STUDENT_FORBIDDEN_KEYS,
    resolveStudentProfile,
    listOwnPiars,
    getOwnPiar,
    handleStudentPortalRequest
};
