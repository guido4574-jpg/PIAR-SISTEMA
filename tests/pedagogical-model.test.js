const test = require("node:test");
const assert = require("node:assert/strict");
const { canBePiarResponsible } = require("../backend/pedagogical-access");
const { BARRIER_CONTEXTS, validDate, validateBarrierPayload, validateAdjustmentTracePayload, validateEvidencePayload, validateRecordPayload } = require("../backend/pedagogical-validation");
const { normalizeJustification, runVersionedPiarMutation } = require("../backend/piar-versioning");

test("observations and follow-ups reject empty or orphan payloads and keep valid ones", () => {
    for (const resource of ["observaciones", "seguimientos"]) {
        assert.equal(validateRecordPayload(resource, {}), "La descripción es obligatoria.");
        assert.equal(validateRecordPayload(resource, null), "La descripción es obligatoria.");
        assert.equal(validateRecordPayload(resource, { descripcion: "   ", id_piar: 1 }), "La descripción es obligatoria.");
        assert.equal(validateRecordPayload(resource, { descripcion: "x" }), "El registro debe indicar el estudiante o el PIAR.");
        assert.equal(validateRecordPayload(resource, { descripcion: "x", id_piar: "abc" }), "El PIAR debe ser un identificador válido.");
        assert.equal(validateRecordPayload(resource, { descripcion: "x", id_piar: -3 }), "El PIAR debe ser un identificador válido.");
        assert.equal(validateRecordPayload(resource, { descripcion: "x", id_estudiante: 0 }), "El estudiante debe ser un identificador válido.");
        assert.equal(validateRecordPayload(resource, { descripcion: "x", id_piar: 1, fecha: "2026-02-30" }), "La fecha debe tener el formato AAAA-MM-DD.");
        // Payloads used by the UI, e2e and integration flows remain valid (fecha is optional).
        assert.equal(validateRecordPayload(resource, { descripcion: "x", id_piar: 4, id_estudiante: 9, fecha: "2026-02-03" }), null);
        assert.equal(validateRecordPayload(resource, { descripcion: "x", id_piar: 4, id_estudiante: 9 }), null);
        assert.equal(validateRecordPayload(resource, { descripcion: "x", id_estudiante: 9, fecha: "" }), null);
    }
    // The UI historically sends the observation text as "nota" in some flows.
    assert.equal(validateRecordPayload("observaciones", { nota: "texto", id_piar: 2 }), null);
    assert.equal(validateRecordPayload("seguimientos", { nota: "texto", id_piar: 2 }), "La descripción es obligatoria.");
});

test("versioned PIAR mutations preserve complete before/after snapshots and actor justification", async () => {
    let changed = false;
    const statements = [];
    const db = { promise: () => ({ getConnection: async () => ({
        beginTransaction: async () => statements.push("begin"),
        commit: async () => statements.push("commit"),
        rollback: async () => statements.push("rollback"),
        release: () => statements.push("release"),
        query: async (sql, params) => {
            if (sql.includes("FROM piar p")) return [[{ id_piar: 5, estado: changed ? "revision" : "activo", objetivo_general: changed ? "nuevo" : "anterior", id_estudiante: 8 }]];
            if (sql.includes("FROM estudiante")) return [[{ id_estudiante: 8, contexto: "contexto sensible" }]];
            if (sql.includes("FROM piar_ajuste_evidencia")) return [[{ id_evidencia: 12, id_ajuste: 11, descripcion: "evidencia conservada" }]];
            if (sql.includes("FROM piar_ajuste")) return [[{ id_ajuste: 11, id_piar: 5, estrategia: "estrategia conservada" }]];
            if (sql.startsWith("UPDATE piar")) { changed = true; return [{ affectedRows: 1 }]; }
            if (sql.startsWith("INSERT INTO historial (")) { statements.push({ sql, params }); return [{ insertId: 77, affectedRows: 1 }]; }
            if (sql.startsWith("INSERT INTO historial_detalle")) { statements.push({ sql, params }); return [{ affectedRows: 1 }]; }
            return [[]];
        }
    }) }) };

    const result = await runVersionedPiarMutation(db, {
        piarId: 5, userId: 23, justification: "  Corrección autorizada  ",
        mutate: async connection => {
            await connection.query("UPDATE piar SET objetivo_general = ?", ["nuevo"]);
            return {};
        }
    });
    assert.equal(result.versionId, 77);
    assert.equal(result.unchanged, false);
    const insertHistory = statements.find(entry => typeof entry === "object" && entry.sql.startsWith("INSERT INTO historial ("));
    assert.deepEqual(insertHistory.params, [5, 23, 5, "Corrección autorizada"]);
    const insertDetail = statements.find(entry => typeof entry === "object" && entry.sql.startsWith("INSERT INTO historial_detalle"));
    assert.equal(insertDetail.params[1], "piar_version:actualizacion");
    assert.equal(insertDetail.params[4], "Corrección autorizada");
    const before = JSON.parse(insertDetail.params[5]);
    const after = JSON.parse(insertDetail.params[6]);
    assert.equal(before.piar.objetivo_general, "anterior");
    assert.equal(after.piar.objetivo_general, "nuevo");
    assert.equal(before.estudiante.contexto, "contexto sensible");
    assert.equal(after.ajustes[0].estrategia, "estrategia conservada");
    assert.equal(after.ajustes[0].evidencias[0].descripcion, "evidencia conservada");
    assert.ok(statements.includes("commit"));
    assert.ok(!statements.includes("rollback"));
});

test("a related record moved between PIARs creates a version for both plans in one transaction", async () => {
    let moved = false;
    const details = [];
    let committed = false;
    const db = { promise: () => ({ getConnection: async () => ({
        beginTransaction: async () => {}, commit: async () => { committed = true; }, rollback: async () => {}, release: () => {},
        query: async (sql, params) => {
            if (sql.includes("FROM diagnostico WHERE id_diagnostico")) return [[{ id_piar: moved ? 2 : 1, id_estudiante: moved ? 20 : 10 }]];
            if (sql.includes("FROM piar p")) {
                const id = Number(params[0]);
                return [[{ id_piar: id, id_estudiante: id === 1 ? 10 : 20, estado: "activo" }]];
            }
            if (sql.includes("FROM estudiante")) return [[{ id_estudiante: Number(params[0]) }]];
            if (sql.includes("FROM diagnostico WHERE id_piar")) {
                return moved ? (Number(params[0]) === 2 ? [[{ id_diagnostico: 7, id_piar: 2, descripcion: "caso" }]] : [[]]) : (Number(params[0]) === 1 ? [[{ id_diagnostico: 7, id_piar: 1, descripcion: "caso" }]] : [[]]);
            }
            if (sql.startsWith("UPDATE diagnostico")) { moved = true; return [{ affectedRows: 1 }]; }
            if (sql.startsWith("INSERT INTO historial (")) return [{ insertId: details.length + 1, affectedRows: 1 }];
            if (sql.startsWith("INSERT INTO historial_detalle")) { details.push(params); return [{ affectedRows: 1 }]; }
            return [[]];
        }
    }) }) };
    const result = await runVersionedPiarMutation(db, {
        userId: 4, piarId: 1, justification: "Cambio de relación", operation: "diagnostico_movido",
        resolvePiarIds: async connection => {
            const [current] = await connection.query("SELECT id_piar, id_estudiante FROM diagnostico WHERE id_diagnostico = ? FOR UPDATE", [7]);
            return { piarIds: [current[0].id_piar, 2] };
        },
        mutate: async connection => { await connection.query("UPDATE diagnostico SET id_piar=?", [2]); return {}; }
    });
    assert.equal(result.status, 200);
    assert.ok(result.versionIds[1]);
    assert.ok(result.versionIds[2]);
    assert.equal(details.length, 2);
    assert.ok(details.every(params => params[1] === "piar_version:diagnostico_movido"));
    const oldPlanVersion = JSON.parse(details.find(params => Number(params[2]) === 1)[6]);
    const newPlanVersion = JSON.parse(details.find(params => Number(params[2]) === 2)[6]);
    assert.equal(oldPlanVersion.diagnosticos.length, 0);
    assert.equal(newPlanVersion.diagnosticos[0].id_diagnostico, 7);
    assert.equal(committed, true);
});

test("an unlinked pedagogical record is not assigned to an inferred PIAR", async () => {
    let historyWrites = 0;
    const db = { promise: () => ({ getConnection: async () => ({
        beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
        query: async sql => {
            if (sql.startsWith("INSERT INTO historial")) historyWrites += 1;
            return [{ affectedRows: 1, insertId: 3 }];
        }
    }) }) };
    const result = await runVersionedPiarMutation(db, {
        userId: 4, piarId: null, requireJustification: false, operation: "observacion_sin_piar",
        resolvePiarIds: async () => ({ piarIds: [] }),
        mutate: async () => ({ changed: true })
    });
    assert.equal(result.status, 200);
    assert.equal(result.versionId, undefined);
    assert.equal(result.unchanged, false);
    assert.equal(historyWrites, 0);
});

test("PIAR versioning rejects empty justification and rolls back if history persistence fails", async () => {
    assert.equal(normalizeJustification("  "), null);
    let rolledBack = false;
    let committed = false;
    let changed = false;
    const db = { promise: () => ({ getConnection: async () => ({
        beginTransaction: async () => {}, commit: async () => { committed = true; },
        rollback: async () => { rolledBack = true; }, release: () => {},
        query: async sql => {
            if (sql.includes("FROM piar p")) return [[{ id_piar: 1, estado: changed ? "revision" : "activo", id_estudiante: 1 }]];
            if (sql.startsWith("UPDATE piar")) { changed = true; return [{ affectedRows: 1 }]; }
            if (sql.startsWith("INSERT INTO historial (")) return [{ insertId: 2, affectedRows: 1 }];
            if (sql.startsWith("INSERT INTO historial_detalle")) throw new Error("persistence failed");
            return [[]];
        }
    }) }) };
    await assert.rejects(runVersionedPiarMutation(db, {
        piarId: 1, userId: 2, justification: "corrección",
        mutate: async connection => { await connection.query("UPDATE piar SET estado=?"); return {}; }
    }), /persistence failed/);
    assert.equal(rolledBack, true);
    assert.equal(committed, false);
});

test("barrier contexts and identified dates are explicit and validated", () => {
    assert.deepEqual(BARRIER_CONTEXTS, ["aula", "espacios_escolares", "hogar", "entorno_social", "institucional", "otro"]);
    assert.equal(validDate("2026-02-28"), true);
    assert.equal(validDate("2026-02-30"), false);
    assert.equal(validateBarrierPayload({ contexto: "aula", descripcion: "  Instrucciones solo orales  ", actividad: "Lectura", fecha_identificacion: "2026-10-24" }).descripcion, "Instrucciones solo orales");
    assert.equal(validateBarrierPayload({ contexto: "salud", descripcion: "No catalogado", fecha_identificacion: "2026-10-24" }), null);
});

test("adjustment trace accepts optional barrier, responsible user, outcome, indicator and planned review", () => {
    assert.deepEqual(validateAdjustmentTracePayload({ id_barrera: "12", id_usuario_responsable: "9", resultado_esperado: "Participa en la lectura", indicador_logro: "Responde 4 de 5 preguntas", fecha_revision_prevista: "2026-11-20" }), {
        id_barrera: 12, id_usuario_responsable: 9, resultado_esperado: "Participa en la lectura", indicador_logro: "Responde 4 de 5 preguntas", fecha_revision_prevista: "2026-11-20"
    });
    assert.equal(validateAdjustmentTracePayload({ id_barrera: "abc" }), null);
    assert.equal(validateAdjustmentTracePayload({ fecha_revision_prevista: "2026-11-31" }), null);
    assert.deepEqual(validateAdjustmentTracePayload({}), {
        id_barrera: null, id_usuario_responsable: null, resultado_esperado: null, indicador_logro: null, fecha_revision_prevista: null
    });
});

test("evidence requires a description, valid date and bounded plain reference", () => {
    assert.deepEqual(validateEvidencePayload({ descripcion: "  Guía visual usada en clase ", referencia: "Registro de aula semana 3", fecha: "2026-10-24" }), {
        descripcion: "Guía visual usada en clase", referencia: "Registro de aula semana 3", fecha: "2026-10-24"
    });
    assert.equal(validateEvidencePayload({ descripcion: "", fecha: "2026-10-24" }), null);
    assert.equal(validateEvidencePayload({ descripcion: "Prueba", referencia: "x".repeat(501), fecha: "2026-10-24" }), null);
});

test("PIAR responsible must be active institutional staff or one active assigned teacher profile", async () => {
    const institutionalQuery = async sql => sql.includes("FROM usuario") ? [{ rol: "Coordinador", estado: "activo" }] : [];
    assert.equal(await canBePiarResponsible(institutionalQuery, 6, 2), true);
    const inactiveQuery = async () => [{ rol: "Coordinador", estado: "inactivo" }];
    assert.equal(await canBePiarResponsible(inactiveQuery, 6, 2), false);

    const assignedTeacherQuery = async (sql, params) => {
        if (sql.includes("FROM usuario")) return [{ rol: "Docente", estado: "activo" }];
        if (sql.includes("FROM docente")) return [{ id_docente: 15, estado: "activo" }];
        if (sql.includes("FROM piar_docente")) return params[0] === 15 && params[1] === 2 ? [{ ok: 1 }] : [];
        return [];
    };
    assert.equal(await canBePiarResponsible(assignedTeacherQuery, 6, 2), true);
    assert.equal(await canBePiarResponsible(assignedTeacherQuery, 6, 99), false);
    const duplicateProfileQuery = async sql => sql.includes("FROM usuario")
        ? [{ rol: "Docente", estado: "activo" }]
        : [{ id_docente: 15, estado: "activo" }, { id_docente: 16, estado: "activo" }];
    assert.equal(await canBePiarResponsible(duplicateProfileQuery, 6, 2), false);
});
