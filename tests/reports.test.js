"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { validateReportRequest, createReport, listReports, reportPersistenceAvailable, resetReportAvailabilityCache } = require("../backend/reports");
const { authorizationStatus } = require("../backend/authorization");

function fakeDb({ snapshotFound = true, duplicate = false, columns = 4 } = {}) {
    const statements = [];
    const connection = {
        beginTransaction: async () => statements.push({ sql: "BEGIN" }),
        commit: async () => statements.push({ sql: "COMMIT" }),
        rollback: async () => statements.push({ sql: "ROLLBACK" }),
        release: () => {},
        query: async (sql, values) => {
            statements.push({ sql, values });
            if (sql.includes("FROM piar p WHERE p.id_piar")) return [snapshotFound ? [{ id_piar: 7, id_estudiante: 3, estado: "activo" }] : []];
            if (sql.includes("FROM estudiante WHERE")) return [[{ id_estudiante: 3, nombre: "Sintético" }]];
            if (sql.startsWith("SELECT id_reporte FROM reporte")) return [duplicate ? [{ id_reporte: 41 }] : []];
            if (sql.startsWith("INSERT INTO reporte")) return [{ insertId: 42 }];
            return [[]];
        }
    };
    return {
        statements,
        promise: () => ({
            getConnection: async () => connection,
            query: async (sql, values) => {
                statements.push({ sql, values });
                if (sql.includes("information_schema.COLUMNS")) return [[{ total: columns }]];
                return [[]];
            }
        })
    };
}

test("report requests accept only known types, a PIAR id and a short period", () => {
    assert.deepEqual(validateReportRequest({ tipo: "Seguimiento individual", id_piar: "7", periodo: " 2026-1 " }), { tipo: "Seguimiento individual", piarId: 7, periodo: "2026-1" });
    assert.equal(validateReportRequest({ tipo: "<script>", id_piar: 7 }), null);
    assert.equal(validateReportRequest({ tipo: "Seguimiento individual", id_piar: 0 }), null);
    assert.equal(validateReportRequest({ tipo: "Seguimiento individual", id_piar: 7, periodo: "x".repeat(51) }), null);
});

test("a report stores a server-built snapshot with author, student, PIAR and content hash", async () => {
    const db = fakeDb();
    const result = await createReport(db, { userId: 5, tipo: "Avance de objetivos", piarId: 7, periodo: "2026" });
    assert.equal(result.status, 201);
    const insert = db.statements.find(item => item.sql.startsWith("INSERT INTO reporte"));
    assert.deepEqual(insert.values.slice(0, 5), [7, 3, 5, "Avance de objetivos", "2026"]);
    const content = JSON.parse(insert.values[6]);
    assert.equal(content.piar.id_piar, 7);
    assert.match(insert.values[7], /^[a-f0-9]{64}$/);
    assert.ok(db.statements.some(item => item.sql === "COMMIT"));
});

test("an identical report by the same author within the window is not duplicated", async () => {
    const db = fakeDb({ duplicate: true });
    const result = await createReport(db, { userId: 5, tipo: "Avance de objetivos", piarId: 7, periodo: null });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data, { id_reporte: 41, duplicado: true });
    assert.ok(!db.statements.some(item => item.sql.startsWith("INSERT INTO reporte")));
});

test("a teacher cannot persist a report of a PIAR outside its assignment", async () => {
    const db = fakeDb({ snapshotFound: false });
    const result = await createReport(db, { userId: 9, teacherId: 4, tipo: "Seguimiento individual", piarId: 7, periodo: null });
    assert.equal(result.status, 404);
    const snapshotQuery = db.statements.find(item => item.sql.includes("FROM piar p WHERE p.id_piar"));
    assert.match(snapshotQuery.sql, /pd_scope\.id_docente = \?/);
    assert.deepEqual(snapshotQuery.values, [7, 4]);
});

test("report listing degrades to the original columns before migration 014", async () => {
    resetReportAvailabilityCache();
    const db = fakeDb({ columns: 0 });
    assert.equal(await reportPersistenceAvailable(db), false);
    await listReports(db, { teacherId: 4 });
    const list = db.statements.find(item => item.sql.includes("FROM reporte r"));
    assert.doesNotMatch(list.sql, /contenido|id_estudiante|periodo/);
    assert.match(list.sql, /pd\.id_docente = \?/);
    resetReportAvailabilityCache();
});

test("report persistence permissions and server wiring", () => {
    for (const role of ["Administrador", "Rector", "Coordinador", "Psicóloga", "Docente"]) assert.equal(authorizationStatus({ rol: role }, "POST", "/api/reportes"), 200, role);
    assert.equal(authorizationStatus({ rol: "Estudiante" }, "POST", "/api/reportes"), 403);
    assert.equal(authorizationStatus({ rol: "Coordinador" }, "PUT", "/api/reportes/3"), 403);
    const server = fs.readFileSync(path.join(__dirname, "../backend/server.js"), "utf8");
    assert.match(server, /requiere aplicar la migración 014/);
    const migration = fs.readFileSync(path.join(__dirname, "../database/migrations/014_report_persistence.sql"), "utf8");
    assert.doesNotMatch(migration, /\b(DROP|DELETE|UPDATE reporte SET|TRUNCATE)\b/i);
});
