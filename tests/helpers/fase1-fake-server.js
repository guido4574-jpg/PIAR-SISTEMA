"use strict";

// Arranca el backend/server.js REAL con backend/db.js sustituido por una base en
// memoria. Lo usan las pruebas de regresión de la fase 1 para recorrer la ruta
// HTTP completa (sesión -> autorización -> manejador -> respuesta) sin MySQL.
// Solo datos sintéticos; nada se persiste.
//
// Cada sentencia SQL se informa por stdout como "FAKEDB {json}" para que la
// prueba compruebe qué se escribió. La tabla cambio_correo no existe a propósito
// (simula una base sin la migración 016).

const crypto = require("node:crypto");
const path = require("node:path");

const hash = token => crypto.createHash("sha256").update(token).digest("hex");

const USERS = [
    { id_usuario: 900, nombre: "Administración Sintética", documento: "ADM-900", correo: "admin@example.invalid", rol: "Administrador", estado: "activo", password_change_required: 0, correo_verificado_at: "2026-01-01 00:00:00", token: "token-admin-sintetico" },
    { id_usuario: 902, nombre: "Docente Sintético", documento: "DOC-902", correo: "docente@example.invalid", rol: "Docente", estado: "activo", password_change_required: 0, correo_verificado_at: "2026-01-01 00:00:00", token: "token-docente-sin-perfil" },
    { id_usuario: 903, nombre: "Psicología Sintética", documento: "PSI-903", correo: "psicologia@example.invalid", rol: "Psicóloga", estado: "activo", password_change_required: 0, correo_verificado_at: "2026-01-01 00:00:00", token: "token-psicologa-sintetica" }
];

// Fila con todas las columnas reales de `docente` (000_base_schema.sql).
const TEACHERS = [{
    id_docente: 31, nombre: "Laura Docente Sintética", nombres: "Laura", apellidos: "Docente Sintética", documento: "DOC-31",
    area: "Lenguaje", correo: "laura@example.invalid", cargo: "Docente de aula", telefono: "3001112233",
    perfil: "Perfil sintético", estado: "activo", id_usuario: null, created_at: "2026-02-01 08:00:00", updated_at: "2026-02-01 08:00:00"
}];

const STUDENTS = [{
    id_estudiante: 21, nombre: "Ana Prueba", documento: "EST-21", edad: 12, curso: "Sexto", condicion_especial: "Discapacidad visual",
    nombres: "Ana", apellidos: "Prueba", fecha_nacimiento: new Date(2014, 4, 3), jornada: "Mañana", estado: "activo",
    acudiente: "Acudiente sintético", telefono: "3000000000", contexto: "Contexto previo", valoracion: "Valoración previa",
    fortalezas: JSON.stringify(["Lectura"]), barreras: JSON.stringify(["Ruido"]), apoyos_requeridos: JSON.stringify(["Apoyo visual"]),
    actividades_casa: "Lectura en casa", created_at: "2026-02-01 08:00:00", updated_at: "2026-02-01 08:00:00"
}];

function log(kind, sql, params) {
    process.stdout.write(`FAKEDB ${JSON.stringify({ kind, sql: String(sql).replace(/\s+/g, " ").trim(), params })}\n`);
}

function missingTable() {
    const error = new Error("Table 'cambio_correo' doesn't exist");
    error.code = "ER_NO_SUCH_TABLE";
    return error;
}

function route(sql, params = []) {
    const text = String(sql).replace(/\s+/g, " ").trim();
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
    if (/\bcambio_correo\b/i.test(text)) {
        log("email-change", text, params);
        throw missingTable();
    }
    if (/^SELECT id_estudiante, nombres, apellidos FROM estudiante WHERE id_estudiante = \?$/i.test(text)) {
        log("student-current", text, params);
        return STUDENTS.filter(row => row.id_estudiante === Number(params[0])).map(({ id_estudiante, nombres, apellidos }) => ({ id_estudiante, nombres, apellidos }));
    }
    const update = text.match(/^UPDATE estudiante SET (.+) WHERE id_estudiante = \?$/i);
    if (update) {
        log("student-update", text, params);
        const columns = update[1].split(", ").map(item => item.replace(/ = \?$/, ""));
        const row = STUDENTS.find(item => item.id_estudiante === Number(params[params.length - 1]));
        if (!row) return { affectedRows: 0, changedRows: 0 };
        let changed = 0;
        columns.forEach((column, index) => {
            if (row[column] !== params[index]) changed += 1;
            row[column] = params[index];
        });
        return { affectedRows: 1, changedRows: changed };
    }
    if (/^SELECT 1 FROM estudiante WHERE id_estudiante = \?$/i.test(text)) {
        return STUDENTS.filter(row => row.id_estudiante === Number(params[0])).map(() => ({ 1: 1 }));
    }
    if (/^SELECT id_estudiante, nombre, documento, .* FROM estudiante WHERE id_estudiante = \?$/i.test(text)) {
        log("student-read", text, params);
        return STUDENTS.filter(row => row.id_estudiante === Number(params[0])).map(row => ({ ...row }));
    }
    if (/^INSERT INTO usuario\b/i.test(text)) {
        log("user-insert", text, params.map((value, index) => index === 5 ? "[hash]" : value));
        return { affectedRows: 1, insertId: 950 };
    }
    if (/^INSERT INTO admin_account_audit\b/i.test(text)) {
        log("admin-audit", text, params);
        return { affectedRows: 1, insertId: 1 };
    }
    const teacherRead = text.match(/^SELECT ([a-z_, ]+) FROM docente( WHERE id_docente = \?)?( ORDER BY id_docente)?$/i);
    if (teacherRead) {
        log("teacher-read", text, params);
        const columns = teacherRead[1].split(", ");
        const rows = teacherRead[2] ? TEACHERS.filter(row => row.id_docente === Number(params[0])) : TEACHERS;
        return rows.map(row => Object.fromEntries(columns.map(column => [column, row[column]])));
    }
    if (/^INSERT INTO docente\b/i.test(text)) {
        log("teacher-insert", text, params);
        return { affectedRows: 1, insertId: 77 };
    }
    if (/FROM usuario WHERE id_usuario = \? FOR UPDATE/i.test(text)) {
        log("user-lock", text, params);
        return USERS.filter(user => user.id_usuario === Number(params[0])).map(({ token: _token, ...user }) => user);
    }
    if (/^SELECT id_usuario FROM usuario WHERE correo = \?/i.test(text)) {
        log("user-email-taken", text, params);
        return USERS.filter(user => user.correo === params[0] && user.id_usuario !== Number(params[1])).map(user => ({ id_usuario: user.id_usuario }));
    }
    if (/^UPDATE usuario\b/i.test(text)) {
        log("user-update", text, params);
        return { affectedRows: 1, changedRows: 1 };
    }
    if (/FROM oidc_login_transaction/i.test(text)) {
        log("oidc-transaction", text, params);
        return [];
    }
    log("unhandled", text, params);
    return [];
}

function connection() {
    const run = async (sql, params) => [route(sql, params), []];
    return {
        query: run,
        execute: run,
        beginTransaction: async () => log("transaction", "BEGIN", []),
        commit: async () => log("transaction", "COMMIT", []),
        rollback: async () => log("transaction", "ROLLBACK", []),
        release() {}
    };
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
            getConnection: async () => connection()
        };
    }
};

const dbPath = path.resolve(__dirname, "../../backend/db.js");
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };
require("../../backend/server.js");
