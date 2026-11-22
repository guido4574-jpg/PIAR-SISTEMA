"use strict";

// Starts the REAL backend/server.js with backend/db.js replaced by an in-memory
// fake. Used by tests/student-portal.test.js to exercise Estudiante
// authorization through HTTP (session -> authorization -> handler -> response)
// without a MySQL server. Only synthetic data; nothing is persisted.
//
// Every SQL statement is reported on stdout as "FAKEDB {json}" so the parent
// test can assert which tables were touched. Professional tables return rows
// with sentinel strings: if any of them leaked into a response the test fails.

const crypto = require("node:crypto");
const path = require("node:path");

const hash = token => crypto.createHash("sha256").update(token).digest("hex");

const USERS = [
    { id_usuario: 501, nombre: "Ana Sintética", documento: "U-501", correo: "ana@example.invalid", rol: "Estudiante", estado: "activo", password_change_required: 0, token: "token-estudiante-a" },
    { id_usuario: 502, nombre: "Beto Sintético", documento: "U-502", correo: "beto@example.invalid", rol: "Estudiante", estado: "activo", password_change_required: 0, token: "token-estudiante-b" },
    { id_usuario: 503, nombre: "Estudiante inactivo", documento: "U-503", correo: "inactivo@example.invalid", rol: "Estudiante", estado: "activo", password_change_required: 0, token: "token-estudiante-perfil-inactivo" },
    { id_usuario: 504, nombre: "Estudiante sin vínculo", documento: "U-504", correo: "sinvinculo@example.invalid", rol: "Estudiante", estado: "activo", password_change_required: 0, token: "token-estudiante-sin-vinculo" }
];

const STUDENTS = [
    { id_estudiante: 11, id_usuario: 501, nombre: "Ana Sintética", documento: "EST-A", estado: "activo", valoracion: "SECRETO-VALORACION-A", contexto: "SECRETO-CONTEXTO-A" },
    { id_estudiante: 12, id_usuario: 502, nombre: "Beto Sintético", documento: "EST-B", estado: "activo", valoracion: "SECRETO-VALORACION-B", contexto: "SECRETO-CONTEXTO-B" },
    { id_estudiante: 13, id_usuario: 503, nombre: "Perfil inactivo", documento: "EST-C", estado: "inactivo" }
];

function piarRow(id, studentId, label) {
    return {
        id_piar: id, id_estudiante: studentId, id_usuario_creador: 900, titulo: `PIAR ${label} 2026`, periodo: "2026-1", anio: 2026, estado: "activo",
        objetivo_general: `Objetivo ${label}`, metas: `Metas ${label}`, caracterizacion: `Caracterización ${label}`, barreras: `Barreras texto ${label}`,
        estrategias: `Estrategias ${label}`, informes_salud: `SECRETO-INFORME-SALUD-${label}`, proyectos: null, actividades_receso: null,
        otra_informacion: null, acta_acuerdos: `Acuerdos ${label}`, informe_anual: null, entrega_pedagogica: null,
        fecha_creacion: "2026-02-01 08:00:00", fecha_revision: "2026-06-01", fecha_cierre: null, created_at: "2026-02-01 08:00:00", updated_at: "2026-02-01 08:00:00"
    };
}

const PIARS = [piarRow(101, 11, "A"), piarRow(103, 11, "A2"), piarRow(102, 12, "B")];
const PIAR_DOCENTE = [
    { id_piar: 101, id_docente: 7, nombre: "Docente Uno", area: "Matemáticas", correo: "SECRETO-CORREO-DOCENTE@example.invalid", es_responsable_principal: 1 },
    { id_piar: 102, id_docente: 8, nombre: "Docente Dos", area: "Lengua", correo: "SECRETO-CORREO-DOCENTE-B@example.invalid", es_responsable_principal: 1 }
];
const AJUSTES = [
    { id_ajuste: 201, id_piar: 101, id_barrera: 301, id_usuario_responsable: 900, responsable_usuario_nombre: "Coordinación", area: "Matemáticas", tipo: "Metodológico", estrategia: "Material concreto A", recursos: "Ábaco", responsable: "Docente Uno", resultado_esperado: "Resuelve sumas", indicador_logro: null, fecha_revision_prevista: "2026-05-01", avance: 40, estado: "activo", created_at: "2026-02-02" },
    { id_ajuste: 202, id_piar: 102, id_barrera: null, id_usuario_responsable: 900, responsable_usuario_nombre: "Coordinación", area: "Lengua", tipo: "Evaluación", estrategia: "SECRETO-AJUSTE-B", recursos: null, responsable: "Docente Dos", resultado_esperado: "Lee", indicador_logro: null, fecha_revision_prevista: "2026-05-01", avance: 10, estado: "activo", created_at: "2026-02-02" }
];
const BARRERAS = [
    { id_barrera: 301, id_piar: 101, contexto: "Aula", descripcion: "Barrera A", actividad: "Lectura", condicion_entorno: "Ruido", fecha_identificacion: "2026-02-01", id_usuario_registro: 900, autor_nombre: "SECRETO-AUTOR-BARRERA", created_at: "2026-02-01" },
    { id_barrera: 302, id_piar: 102, contexto: "Aula", descripcion: "SECRETO-BARRERA-B", actividad: null, condicion_entorno: null, fecha_identificacion: "2026-02-01", id_usuario_registro: 900, autor_nombre: "x", created_at: "2026-02-01" }
];
const EVIDENCIAS = [
    { id_evidencia: 401, id_ajuste: 201, id_piar: 101, descripcion: "Evidencia A", referencia: "SECRETO-REFERENCIA-EVIDENCIA", fecha: "2026-03-01", id_usuario_autor: 900, autor_nombre: "SECRETO-AUTOR-EVIDENCIA" },
    { id_evidencia: 402, id_ajuste: 202, id_piar: 102, descripcion: "SECRETO-EVIDENCIA-B", referencia: null, fecha: "2026-03-01", id_usuario_autor: 900, autor_nombre: "x" }
];
const DUA = [
    { id_dua: 501, id_piar: 101, principio: "representacion", area: "Matemáticas", estrategia: "Apoyo visual A", recursos: null, id_usuario_registro: 900, autor_nombre: "SECRETO-AUTOR-DUA" },
    { id_dua: 502, id_piar: 102, principio: "implicacion", area: "Lengua", estrategia: "SECRETO-DUA-B", recursos: null, id_usuario_registro: 900, autor_nombre: "x" }
];
// Professional records: must never be read for an Estudiante session.
const PROFESSIONAL_ROWS = [
    { id_diagnostico: 1, id_observacion: 1, id_seguimiento: 1, id_historial: 1, id_reporte: 1, id_piar: 101, id_estudiante: 11,
        descripcion: "SECRETO-PROFESIONAL", tipo_diagnostico: "SECRETO-DIAGNOSTICO", evolucion: "SECRETO-SEGUIMIENTO", acuerdos: "SECRETO-OBSERVACION" }
];

const PROFESSIONAL_TABLES = /\b(diagnostico|observacion|seguimiento|historial|historial_detalle|reporte|psicologa)\b/i;

function log(kind, sql, params) {
    process.stdout.write(`FAKEDB ${JSON.stringify({ kind, sql: String(sql).replace(/\s+/g, " ").trim(), params })}\n`);
}

function route(sql, params = []) {
    const text = String(sql).replace(/\s+/g, " ");
    if (/^INSERT INTO (piar_auditoria|evento_seguridad)\b/i.test(text)) {
        log("audit", text, params);
        return { affectedRows: 1, insertId: 1 };
    }
    if (/FROM sesion_usuario s INNER JOIN usuario u/i.test(text) && /s\.token_hash = \?/.test(text)) {
        log("session", text, []);
        return USERS.filter(user => hash(user.token) === params[0]).map(({ token: _token, ...user }) => user);
    }
    if (/^UPDATE sesion_usuario\b/i.test(text)) {
        log("session", text, []);
        return { affectedRows: 0 };
    }
    if (PROFESSIONAL_TABLES.test(text)) {
        log("professional", text, params);
        return PROFESSIONAL_ROWS;
    }
    if (/FROM estudiante WHERE id_usuario = \?/i.test(text)) {
        log("student-profile", text, params);
        return STUDENTS.filter(student => student.id_usuario === Number(params[0]));
    }
    if (/FROM piar p WHERE p\.id_estudiante = \? ORDER BY/i.test(text)) {
        log("piar-list", text, params);
        // Superset rows on purpose: the response allow-list must drop extra columns.
        return PIARS.filter(piar => piar.id_estudiante === Number(params[0]));
    }
    if (/FROM piar p INNER JOIN estudiante e .* WHERE p\.id_piar = \? AND p\.id_estudiante = \?/i.test(text)) {
        log("piar-detail", text, params);
        return PIARS.filter(piar => piar.id_piar === Number(params[0]) && piar.id_estudiante === Number(params[1]))
            .map(piar => {
                const student = STUDENTS.find(item => item.id_estudiante === piar.id_estudiante);
                // Student profile columns are mixed in on purpose to prove they are not exposed.
                return { ...student, ...piar, estudiante_nombre: student.nombre };
            });
    }
    const nested = [
        [/FROM piar_docente pd/i, PIAR_DOCENTE],
        [/FROM piar_ajuste_evidencia e/i, EVIDENCIAS],
        [/FROM piar_ajuste a/i, AJUSTES],
        [/FROM piar_barrera b/i, BARRERAS],
        [/FROM piar_dua d/i, DUA]
    ].find(([pattern]) => pattern.test(text));
    if (nested) {
        log("piar-nested", text, params);
        return nested[1].filter(row => row.id_piar === Number(params[0]));
    }
    log("unhandled", text, params);
    return [];
}

const fakeDb = {
    query(sql, params, callback) {
        const cb = typeof params === "function" ? params : callback;
        const values = typeof params === "function" ? [] : params;
        let rows;
        try { rows = route(sql, values); } catch (error) { if (cb) setImmediate(() => cb(error)); return; }
        if (cb) setImmediate(() => cb(null, rows, []));
    },
    promise() {
        return {
            query: async (sql, params) => [route(sql, params), []],
            getConnection: async () => ({
                query: async (sql, params) => [route(sql, params), []],
                beginTransaction: async () => log("transaction", "BEGIN", []),
                commit: async () => log("transaction", "COMMIT", []),
                rollback: async () => log("transaction", "ROLLBACK", []),
                release() {}
            })
        };
    }
};

const dbPath = path.resolve(__dirname, "../../backend/db.js");
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };
require("../../backend/server.js");

module.exports = { USERS };
