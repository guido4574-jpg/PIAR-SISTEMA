const test = require("node:test");
const assert = require("node:assert/strict");
const { authorizationStatus } = require("../backend/authorization");
const { resolveTeacherProfile, hasAssignedPiar, assignedPiarForResource, canTeacherAccessResource } = require("../backend/student-access");

const roles = {
    institutional: ["Administrador", "Rector", "Coordinador"],
    profileManagers: ["Administrador", "Rector", "Coordinador"],
    noteCreators: ["Coordinador", "Docente"]
};

function status(role, method, path) {
    return authorizationStatus(role ? { rol: role } : null, method, path);
}

test("anonymous users receive 401 and Student is denied institutional routes", () => {
    for (const path of ["/api/estudiantes", "/api/piar", "/api/diagnosticos", "/api/observaciones"]) {
        assert.equal(status(null, "GET", path), 401, path);
    }
    for (const path of ["/api/estudiantes", "/api/diagnosticos", "/api/observaciones", "/api/seguimientos"]) {
        assert.equal(status("Estudiante", "GET", path), 403, path);
    }
    // Own-PIAR reads only; ownership and the allow-listed projection are
    // enforced by backend/student-portal.js (see tests/student-portal.test.js).
    assert.equal(status("Estudiante", "GET", "/api/piar"), 200);
    assert.equal(status("Estudiante", "GET", "/api/piar/44"), 200);
    assert.equal(status("Estudiante", "PUT", "/api/piar/44"), 403);
});

test("Psicóloga reads institutional case data, registers diagnoses and observations, and never edits PIAR content", () => {
    const allowed = [
        ["GET", "/api/estudiantes"], ["GET", "/api/estudiantes/17"], ["GET", "/api/piar"], ["GET", "/api/piar/44"],
        ["GET", "/api/piar/44/barreras"], ["GET", "/api/piar/44/dua"], ["GET", "/api/piar/44/versiones"],
        ["GET", "/api/diagnosticos"], ["POST", "/api/diagnosticos"], ["PUT", "/api/diagnosticos/9"],
        ["GET", "/api/seguimientos"], ["GET", "/api/observaciones"], ["POST", "/api/observaciones"],
        ["GET", "/api/historial"], ["GET", "/api/reportes"], ["GET", "/api/dashboard/resumen"]
    ];
    const denied = [
        ["DELETE", "/api/diagnosticos/9"], ["POST", "/api/seguimientos"], ["PUT", "/api/observaciones/3"],
        ["POST", "/api/piar"], ["PUT", "/api/piar/44"], ["DELETE", "/api/piar/44"], ["POST", "/api/piar/44/reapertura"],
        ["POST", "/api/piar/44/barreras"], ["POST", "/api/piar/44/ajustes"], ["PUT", "/api/piar/44/ajustes/8"],
        ["POST", "/api/piar/44/ajustes/8/evidencias"], ["POST", "/api/piar/44/dua"], ["PUT", "/api/piar/44/dua/2"],
        ["POST", "/api/piar/44/docentes"], ["POST", "/api/estudiantes"], ["PUT", "/api/estudiantes/17"],
        ["GET", "/api/usuarios"]
    ];
    for (const [method, path] of allowed) assert.equal(status("Psicóloga", method, path), 200, method + " " + path);
    for (const [method, path] of denied) assert.equal(status("Psicóloga", method, path), 403, method + " " + path);
});

test("Psychology deny-by-default does not change existing Rector and Coordinator policy", () => {
    for (const role of ["Rector", "Coordinador"]) {
        assert.equal(status(role, "GET", "/api/piar/44"), 200, role);
        assert.equal(status(role, "GET", "/api/diagnosticos"), 200, role);
    }
});

test("PIAR versions follow existing read scope and reopening is Coordinator-only", () => {
    for (const role of [...roles.institutional, "Psicóloga", "Docente"]) {
        assert.equal(status(role, "GET", "/api/piar/44/versiones"), 200, role);
        assert.equal(status(role, "GET", "/api/piar/44/versiones/9"), 200, role);
    }
    for (const role of ["Estudiante"]) {
        assert.equal(status(role, "GET", "/api/piar/44/versiones"), 403, role);
        assert.equal(status(role, "GET", "/api/piar/44/versiones/9"), 403, role);
    }
    assert.equal(status("Coordinador", "POST", "/api/piar/44/reapertura"), 200);
    for (const role of ["Administrador", "Rector", "Docente", "Psicóloga", "Estudiante"]) {
        assert.equal(status(role, "POST", "/api/piar/44/reapertura"), 403, role);
    }
});

test("Coordinador and Psicóloga create diagnoses; only management roles delete them", () => {
    for (const role of ["Coordinador", "Psicóloga"]) assert.equal(status(role, "POST", "/api/diagnosticos"), 200, role);
    for (const role of ["Administrador", "Rector", "Docente", "Estudiante"]) assert.equal(status(role, "POST", "/api/diagnosticos"), 403, role);
    for (const role of [...roles.institutional, "Psicóloga"]) assert.equal(status(role, "PUT", "/api/diagnosticos/17"), 200, role);
    for (const role of roles.institutional) assert.equal(status(role, "DELETE", "/api/diagnosticos/17"), 200, role);
    for (const role of ["Psicóloga", "Docente", "Estudiante"]) assert.equal(status(role, "DELETE", "/api/diagnosticos/17"), 403, role);
    for (const role of ["Docente", "Estudiante"]) assert.equal(status(role, "PUT", "/api/diagnosticos/17"), 403, role);
});

test("only Admin, Rector and Coordinator manage student and teacher profiles", () => {
    for (const resource of ["estudiantes", "docentes"]) {
        for (const role of roles.profileManagers) {
            for (const method of ["POST", "PUT", "DELETE"]) {
                const path = method === "POST" ? `/api/${resource}` : `/api/${resource}/17`;
                assert.equal(status(role, method, path), 200, `${role} ${method} ${path}`);
            }
        }
        for (const role of ["Psicóloga", "Docente", "Estudiante"]) {
            for (const method of ["POST", "PUT", "DELETE"]) {
                const path = method === "POST" ? `/api/${resource}` : `/api/${resource}/17`;
                assert.equal(status(role, method, path), 403, `${role} ${method} ${path}`);
            }
        }
    }
});

test("Rector cannot review registrations until identity and role provisioning are validated", () => {
    assert.equal(status("Administrador", "GET", "/api/usuarios"), 200);
    assert.equal(status("Administrador", "POST", "/api/usuarios/17/aprobacion"), 200);
    assert.equal(status("Rector", "GET", "/api/usuarios"), 403);
    assert.equal(status("Rector", "POST", "/api/usuarios/17/aprobacion"), 403);
});

test("PIAR teacher access is limited to pedagogical work and assigned adjustments", () => {
    for (const role of roles.institutional) assert.equal(status(role, "PUT", "/api/piar/17"), 200);
    for (const role of roles.profileManagers) {
        assert.equal(status(role, "DELETE", "/api/piar/17"), 200);
        assert.equal(status(role, "POST", "/api/piar/17/docentes"), 200);
        assert.equal(status(role, "DELETE", "/api/piar/17/docentes/4"), 200);
    }
    for (const role of ["Psicóloga", "Docente", "Estudiante"]) {
        assert.equal(status(role, "DELETE", "/api/piar/17"), 403);
        assert.equal(status(role, "POST", "/api/piar/17/docentes"), 403);
    }
    for (const role of roles.noteCreators) {
        assert.equal(status(role, "POST", "/api/observaciones"), 200);
        assert.equal(status(role, "POST", "/api/seguimientos"), 200);
    }
    for (const role of [...roles.institutional, "Docente"]) {
        for (const resource of ["observaciones", "seguimientos"]) {
            assert.equal(status(role, "PUT", `/api/${resource}/17`), 403);
            assert.equal(status(role, "DELETE", `/api/${resource}/17`), 403);
        }
    }
    assert.equal(status("Docente", "POST", "/api/piar"), 200);
    assert.equal(status("Docente", "PUT", "/api/piar/17"), 200);
    assert.equal(status("Docente", "POST", "/api/piar/17/ajustes"), 200);
    assert.equal(status("Docente", "PUT", "/api/piar/17/ajustes/5"), 200);
    assert.equal(status("Docente", "DELETE", "/api/piar/17/ajustes/5"), 403);
    assert.equal(status("Docente", "GET", "/api/dashboard/resumen"), 200);
    assert.equal(status("Docente", "GET", "/api/historial"), 200);
    assert.equal(status("Docente", "GET", "/api/reportes"), 200);
});

test("structured barriers and evidence are readable by assigned roles and append-only for PIAR editors", () => {
    for (const role of [...roles.institutional, "Docente"]) {
        assert.equal(status(role, "GET", "/api/piar/17/barreras"), 200, role);
        assert.equal(status(role, "GET", "/api/piar/17/ajustes/8/evidencias"), 200, role);
    }
    for (const role of [...roles.institutional, "Docente"]) {
        assert.equal(status(role, "POST", "/api/piar/17/barreras"), 200, role);
        assert.equal(status(role, "POST", "/api/piar/17/ajustes/8/evidencias"), 200, role);
        assert.equal(status(role, "PUT", "/api/piar/17/barreras/3"), 403, role);
        assert.equal(status(role, "DELETE", "/api/piar/17/ajustes/8/evidencias/2"), 403, role);
    }
    for (const role of ["Estudiante", "NoExiste"]) {
        assert.equal(status(role, "GET", "/api/piar/17/barreras"), 403, role);
        assert.equal(status(role, "POST", "/api/piar/17/ajustes/8/evidencias"), 403, role);
    }
});

test("teacher profile resolution fails closed for missing, inactive or duplicate links", async () => {
    assert.equal(await resolveTeacherProfile(async () => [], 12), null);
    assert.equal(await resolveTeacherProfile(async () => [{ id_docente: 3, estado: "inactivo" }], 12), null);
    assert.equal(await resolveTeacherProfile(async () => [
        { id_docente: 3, estado: "activo" }, { id_docente: 4, estado: "activo" }
    ], 12), null);
    assert.deepEqual(await resolveTeacherProfile(async () => [{ id_docente: 3, estado: "activo" }], 12), { id_docente: 3, estado: "activo" });
});

test("teacher access helpers bind records through PIAR assignment relationships", async () => {
    const calls = [];
    const query = async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes("FROM diagnostico")) return [{ id_piar: 44 }];
        if (sql.includes("FROM piar_docente")) return [{ ok: 1 }];
        return [];
    };
    assert.equal(await assignedPiarForResource(query, "diagnosticos", 9), 44);
    assert.equal(await hasAssignedPiar(query, 3, 44), true);
    assert.equal(await assignedPiarForResource(query, "not-a-resource", 9), null);
    assert.match(calls[0].sql, /FROM diagnostico WHERE id_diagnostico = \?/);
    assert.deepEqual(calls[1].params, [3, 44]);
    assert.equal(await canTeacherAccessResource(query, "diagnosticos", 9, 3), true);
    const unassignedQuery = async (sql) => sql.includes("FROM diagnostico") ? [{ id_piar: 99, id_estudiante: 8 }] : [];
    assert.equal(await canTeacherAccessResource(unassignedQuery, "diagnosticos", 9, 3), false);
    const historicalQuery = async sql => sql.includes("FROM observacion") ? [{ id_piar: null, id_estudiante: 8 }] : [{ ok: 1 }];
    assert.equal(await canTeacherAccessResource(historicalQuery, "observaciones", 7, 3), true);
});

test("a teacher can read a diagnosis only through their own assigned PIAR", async () => {
    const diagnosis = new Map([[9, { id_piar: 44, id_estudiante: 8 }]]);
    const assignments = new Set(["3:44"]);
    const query = async (sql, params) => {
        if (sql.includes("FROM diagnostico")) return diagnosis.has(params[0]) ? [diagnosis.get(params[0])] : [];
        if (sql.includes("FROM piar_docente")) return assignments.has(String(params[0]) + ":" + String(params[1])) ? [{ ok: 1 }] : [];
        return [];
    };

    assert.equal(await canTeacherAccessResource(query, "diagnosticos", 9, 3), true);
    assert.equal(await canTeacherAccessResource(query, "diagnosticos", 9, 4), false);
});

