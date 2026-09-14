const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const vm = require("vm");
require("./config");
const db = require("./db");
const auth = require("./auth");

const PORT = Number(process.env.PORT || 8080);
const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "data", "db.json");
const MAX_JSON_BODY_BYTES = 1024 * 1024;
const allowedOrigins = new Set(
    (process.env.CORS_ORIGIN || "http://localhost:8080,http://127.0.0.1:8080")
        .split(",")
        .map(origin => origin.trim())
        .filter(Boolean)
);

const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml"
};

const server = http.createServer(async (request, response) => {
    try {
        const url = new URL(request.url, `http://${request.headers.host}`);

        // Route API requests to the existing API handler
        if (url.pathname.startsWith("/api/")) {
            await handleApi(request, response, url);
            return;
        }

        // Non-API: serve static files from the public/ directory
        await serveStatic(response, url.pathname);
        return;
    } catch (error) {
        console.error("Error procesando solicitud:", error.message);
        sendJson(response, error.statusCode || 500, {
            error: error.statusCode ? error.message : "Error interno del servidor"
        });
    }
});

server.listen(PORT, () => {
    console.log(`PIAR API y app disponibles en http://localhost:${PORT}`);
});

async function handleApi(request, response, url) {
    if (request.method === "OPTIONS") {
        sendJson(response, 200, { ok: true });
        return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
        db.query("SELECT 1", (error) => {
            if (error) {
                sendJson(response, 503, { status: "degraded", database: "disconnected" });
                return;
            }

            sendJson(response, 200, { status: "ok", database: "connected" });
        });
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/register") {
        const result = await auth.register(db, await readJsonBody(request), false);
        const headers = result.session
            ? { "Set-Cookie": auth.sessionCookie(result.session.token, result.session.maxAgeSeconds) }
            : {};
        sendJson(response, result.status, result.body, headers);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/login") {
        const result = await auth.login(db, await readJsonBody(request));
        const headers = result.session
            ? { "Set-Cookie": auth.sessionCookie(result.session.token, result.session.maxAgeSeconds) }
            : {};
        sendJson(response, result.status, result.body, headers);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        await auth.logout(db, request);
        sendJson(response, 200, { ok: true, message: "Sesión cerrada" }, {
            "Set-Cookie": auth.sessionCookie("", 0)
        });
        return;
    }

    if (request.method === "GET" && url.pathname === "/api/auth/me") {
        const user = await auth.currentUser(db, request);
        if (!user) {
            sendJson(response, 401, { ok: false, message: "Sesión no válida" });
            return;
        }

        sendJson(response, 200, { ok: true, user });
        return;
    }

    const sessionUser = await auth.currentUser(db, request);

    if (request.method === "GET" && url.pathname === "/api/usuarios") {
        if (!sessionUser || !["Administrador", "Rector"].includes(sessionUser.rol)) {
            sendJson(response, 403, { ok: false, message: "No autorizado" });
            return;
        }
        const users = await queryDb("SELECT id_usuario, nombre, documento, correo, rol, estado, ultimo_acceso_at, created_at, updated_at FROM usuario ORDER BY id_usuario");
        sendJson(response, 200, { ok: true, data: users });
        return;
    }

    const userMatch = url.pathname.match(/^\/api\/usuarios\/(\d+)$/);
    if (userMatch && request.method === "GET") {
        if (!sessionUser || !["Administrador", "Rector"].includes(sessionUser.rol)) {
            sendJson(response, 403, { ok: false, message: "No autorizado" });
            return;
        }
        const users = await queryDb("SELECT id_usuario, nombre, documento, correo, rol, estado, ultimo_acceso_at, created_at, updated_at FROM usuario WHERE id_usuario = ?", [Number(userMatch[1])]);
        if (!users.length) {
            sendJson(response, 404, { ok: false, message: "Usuario no encontrado" });
            return;
        }
        sendJson(response, 200, { ok: true, data: users[0] });
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/usuarios") {
        if (!sessionUser || sessionUser.rol !== "Administrador") {
            sendJson(response, 403, { ok: false, message: "Solo un administrador puede crear usuarios" });
            return;
        }
        const result = await auth.register(db, await readJsonBody(request), true);
        sendJson(response, result.status, result.body);
        return;
    }

    if (userMatch && ["PUT", "DELETE"].includes(request.method)) {
        if (!sessionUser || sessionUser.rol !== "Administrador") {
            sendJson(response, 403, { ok: false, message: "Solo un administrador puede modificar usuarios" });
            return;
        }
        const userId = Number(userMatch[1]);
        if (request.method === "DELETE") {
            await queryDb("UPDATE usuario SET estado = 'inactivo' WHERE id_usuario = ?", [userId]);
            sendJson(response, 200, { ok: true, message: "Usuario desactivado" });
            return;
        }

        const payload = await readJsonBody(request);
        const allowedRoles = auth.ROLES;
        if (payload.rol && !allowedRoles.includes(payload.rol)) {
            sendJson(response, 400, { ok: false, message: "El rol no es válido" });
            return;
        }
        await queryDb("UPDATE usuario SET nombre = COALESCE(?, nombre), correo = COALESCE(?, correo), rol = COALESCE(?, rol), estado = COALESCE(?, estado) WHERE id_usuario = ?", [payload.nombre || null, payload.correo || null, payload.rol || null, payload.estado || null, userId]);
        sendJson(response, 200, { ok: true, message: "Usuario actualizado" });
        return;
    }

    if (sessionUser && request.method === "GET" && url.pathname === "/api/docentes") {
        const teachers = await queryDb("SELECT * FROM docente ORDER BY id_docente");
        sendJson(response, 200, { ok: true, data: teachers });
        return;
    }

    const teacherMatch = url.pathname.match(/^\/api\/docentes\/(\d+)$/);
    if (teacherMatch && sessionUser && request.method === "GET") {
        const teachers = await queryDb("SELECT * FROM docente WHERE id_docente = ?", [Number(teacherMatch[1])]);
        if (!teachers.length) {
            sendJson(response, 404, { ok: false, message: "Docente no encontrado" });
            return;
        }
        sendJson(response, 200, { ok: true, data: teachers[0] });
        return;
    }

    if (sessionUser && request.method === "POST" && url.pathname === "/api/docentes") {
        const payload = await readJsonBody(request);
        const nombre = String(payload.nombre || [payload.nombres, payload.apellidos].filter(Boolean).join(" ")).trim();
        if (!nombre) {
            sendJson(response, 400, { ok: false, message: "El nombre del docente es obligatorio" });
            return;
        }
        const result = await queryDb("INSERT INTO docente (nombre, area, correo, nombres, apellidos, documento, cargo, telefono, perfil, estado, id_usuario) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [nombre, payload.area || null, payload.correo || null, payload.nombres || null, payload.apellidos || null, payload.documento || null, payload.cargo || null, payload.telefono || null, payload.perfil || null, payload.estado || "activo", payload.id_usuario || null]);
        sendJson(response, 201, { ok: true, data: { id_docente: result.insertId, ...payload, nombre } });
        return;
    }

    if (teacherMatch && sessionUser && ["PUT", "DELETE"].includes(request.method)) {
        const teacherId = Number(teacherMatch[1]);
        if (request.method === "DELETE") {
            await queryDb("UPDATE docente SET estado = 'inactivo' WHERE id_docente = ?", [teacherId]);
            sendJson(response, 200, { ok: true, message: "Docente desactivado" });
            return;
        }
        const payload = await readJsonBody(request);
        await queryDb("UPDATE docente SET nombre = COALESCE(?, nombre), area = COALESCE(?, area), correo = COALESCE(?, correo), nombres = COALESCE(?, nombres), apellidos = COALESCE(?, apellidos), documento = COALESCE(?, documento), cargo = COALESCE(?, cargo), telefono = COALESCE(?, telefono), perfil = COALESCE(?, perfil), estado = COALESCE(?, estado), id_usuario = COALESCE(?, id_usuario) WHERE id_docente = ?", [payload.nombre || null, payload.area || null, payload.correo || null, payload.nombres || null, payload.apellidos || null, payload.documento || null, payload.cargo || null, payload.telefono || null, payload.perfil || null, payload.estado || null, payload.id_usuario || null, teacherId]);
        sendJson(response, 200, { ok: true, message: "Docente actualizado" });
        return;
    }

    if (sessionUser && request.method === "GET" && url.pathname === "/api/piar") {
        const piars = await queryDb("SELECT * FROM piar ORDER BY id_piar DESC");
        sendJson(response, 200, { ok: true, data: piars });
        return;
    }

    const piarMatch = url.pathname.match(/^\/api\/piar\/(\d+)$/);
    if (piarMatch && sessionUser && request.method === "GET") {
        const piarId = Number(piarMatch[1]);
        const piars = await queryDb("SELECT p.*, e.nombre AS estudiante_nombre, e.documento AS estudiante_documento FROM piar p INNER JOIN estudiante e ON e.id_estudiante = p.id_estudiante WHERE p.id_piar = ?", [piarId]);
        if (!piars.length) {
            sendJson(response, 404, { ok: false, message: "PIAR no encontrado" });
            return;
        }
        const [docentes, ajustes, diagnosticos, seguimientos, observaciones] = await Promise.all([
            queryDb("SELECT d.*, pd.es_responsable_principal FROM piar_docente pd INNER JOIN docente d ON d.id_docente = pd.id_docente WHERE pd.id_piar = ? ORDER BY d.id_docente", [piarId]),
            queryDb("SELECT * FROM piar_ajuste WHERE id_piar = ? ORDER BY id_ajuste", [piarId]),
            queryDb("SELECT * FROM diagnostico WHERE id_piar = ? ORDER BY id_diagnostico", [piarId]),
            queryDb("SELECT * FROM seguimiento WHERE id_piar = ? ORDER BY id_seguimiento", [piarId]),
            queryDb("SELECT * FROM observacion WHERE id_piar = ? ORDER BY id_observacion", [piarId])
        ]);
        sendJson(response, 200, { ok: true, data: { ...piarRowToApi(piars[0]), estudiante: { id_estudiante: piars[0].id_estudiante, nombre: piars[0].estudiante_nombre, documento: piars[0].estudiante_documento }, docentes, ajustes, diagnosticos, seguimientos, observaciones } });
        return;
    }

    if (sessionUser && request.method === "POST" && url.pathname === "/api/piar") {
        const payload = await readJsonBody(request);
        if (!payload.id_estudiante || !payload.titulo || !payload.periodo || !payload.anio) {
            sendJson(response, 400, { ok: false, message: "Estudiante, título, periodo y año son obligatorios" });
            return;
        }
        const connection = await db.promise().getConnection();
        try {
            await connection.beginTransaction();
            const [students] = await connection.query("SELECT id_estudiante FROM estudiante WHERE id_estudiante = ?", [payload.id_estudiante]);
            if (!students.length) {
                await connection.rollback();
                sendJson(response, 400, { ok: false, message: "El estudiante no existe" });
                return;
            }
            const teacherId = payload.id_docente || payload.teacherId || null;
            if (teacherId !== null) {
                const [teachers] = await connection.query("SELECT id_docente FROM docente WHERE id_docente = ? AND estado = 'activo'", [teacherId]);
                if (!teachers.length) {
                    await connection.rollback();
                    sendJson(response, 400, { ok: false, message: "El docente no existe o está inactivo" });
                    return;
                }
            }
            const [result] = await connection.query("INSERT INTO piar (id_estudiante, id_usuario_creador, titulo, periodo, anio, estado, objetivo_general, metas, caracterizacion, barreras, estrategias, informes_salud, proyectos, fecha_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [payload.id_estudiante, sessionUser.id, payload.titulo, payload.periodo, payload.anio, payload.estado || "draft", payload.objetivo_general || null, payload.metas || null, payload.caracterizacion || null, payload.barreras || null, payload.estrategias || null, payload.informes_salud || null, payload.proyectos || null, payload.fecha_revision || null]);
            const piarId = result.insertId;
            if (teacherId !== null) {
                await connection.query("INSERT INTO piar_docente (id_piar, id_docente, es_responsable_principal) VALUES (?, ?, ?)", [piarId, teacherId, payload.es_responsable_principal !== false]);
            }
            const adjustment = payload.ajuste || payload.ajuste_inicial;
            if (adjustment) {
                const avance = Number(adjustment.avance ?? 0);
                if (avance < 0 || avance > 100 || !adjustment.area || !adjustment.tipo || !adjustment.estrategia) {
                    await connection.rollback();
                    sendJson(response, 400, { ok: false, message: "El ajuste inicial no es válido" });
                    return;
                }
                await connection.query("INSERT INTO piar_ajuste (id_piar, area, tipo, estrategia, recursos, responsable, avance, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [piarId, adjustment.area, adjustment.tipo, adjustment.estrategia, adjustment.recursos || null, adjustment.responsable || null, avance, adjustment.estado || "activo"]);
            }
            await connection.commit();
            sendJson(response, 201, { ok: true, data: { id_piar: piarId } });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
        return;
    }

    if (piarMatch && sessionUser && ["PUT", "DELETE"].includes(request.method)) {
        const piarId = Number(piarMatch[1]);
        if (request.method === "DELETE") {
            await queryDb("UPDATE piar SET estado = 'cerrado', fecha_cierre = CURRENT_TIMESTAMP WHERE id_piar = ?", [piarId]);
            sendJson(response, 200, { ok: true, message: "PIAR cerrado" });
            return;
        }
        const payload = await readJsonBody(request);
        await queryDb("UPDATE piar SET titulo = COALESCE(?, titulo), periodo = COALESCE(?, periodo), anio = COALESCE(?, anio), estado = COALESCE(?, estado), objetivo_general = COALESCE(?, objetivo_general), metas = COALESCE(?, metas), caracterizacion = COALESCE(?, caracterizacion), barreras = COALESCE(?, barreras), estrategias = COALESCE(?, estrategias), informes_salud = COALESCE(?, informes_salud), proyectos = COALESCE(?, proyectos), fecha_revision = COALESCE(?, fecha_revision) WHERE id_piar = ?", [payload.titulo || null, payload.periodo || null, payload.anio || null, payload.estado || null, payload.objetivo_general || null, payload.metas || null, payload.caracterizacion || null, payload.barreras || null, payload.estrategias || null, payload.informes_salud || null, payload.proyectos || null, payload.fecha_revision || null, piarId]);
        sendJson(response, 200, { ok: true, message: "PIAR actualizado" });
        return;
    }

    const nestedPiarMatch = url.pathname.match(/^\/api\/piar\/(\d+)\/(docentes|ajustes)$/);
    if (nestedPiarMatch && sessionUser) {
        const piarId = Number(nestedPiarMatch[1]);
        const resource = nestedPiarMatch[2];
        if (resource === "docentes" && request.method === "GET") {
            const rows = await queryDb("SELECT d.*, pd.es_responsable_principal FROM piar_docente pd INNER JOIN docente d ON d.id_docente = pd.id_docente WHERE pd.id_piar = ?", [piarId]);
            sendJson(response, 200, { ok: true, data: rows });
            return;
        }
        if (resource === "docentes" && request.method === "POST") {
            const payload = await readJsonBody(request);
            await queryDb("INSERT INTO piar_docente (id_piar, id_docente, es_responsable_principal) VALUES (?, ?, ?)", [piarId, payload.id_docente, Boolean(payload.es_responsable_principal)]);
            sendJson(response, 201, { ok: true });
            return;
        }
        if (resource === "docentes" && request.method === "DELETE") {
            const payload = await readJsonBody(request);
            await queryDb("DELETE FROM piar_docente WHERE id_piar = ? AND id_docente = ?", [piarId, payload.id_docente]);
            sendJson(response, 200, { ok: true });
            return;
        }
        if (resource === "ajustes" && request.method === "GET") {
            const rows = await queryDb("SELECT * FROM piar_ajuste WHERE id_piar = ? ORDER BY id_ajuste", [piarId]);
            sendJson(response, 200, { ok: true, data: rows });
            return;
        }
        if (resource === "ajustes" && request.method === "POST") {
            const payload = await readJsonBody(request);
            const avance = Number(payload.avance || 0);
            if (avance < 0 || avance > 100) {
                sendJson(response, 400, { ok: false, message: "El avance debe estar entre 0 y 100" });
                return;
            }
            const result = await queryDb("INSERT INTO piar_ajuste (id_piar, area, tipo, estrategia, recursos, responsable, avance, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [piarId, payload.area, payload.tipo, payload.estrategia, payload.recursos || null, payload.responsable || null, avance, payload.estado || "activo"]);
            sendJson(response, 201, { ok: true, data: { id_ajuste: result.insertId } });
            return;
        }
    }

    const adjustmentMatch = url.pathname.match(/^\/api\/piar\/(\d+)\/ajustes\/(\d+)$/);
    if (adjustmentMatch && sessionUser && ["PUT", "DELETE"].includes(request.method)) {
        const piarId = Number(adjustmentMatch[1]);
        const adjustmentId = Number(adjustmentMatch[2]);
        if (request.method === "DELETE") {
            await queryDb("DELETE FROM piar_ajuste WHERE id_ajuste = ? AND id_piar = ?", [adjustmentId, piarId]);
            sendJson(response, 200, { ok: true });
            return;
        }
        const payload = await readJsonBody(request);
        const avance = payload.avance === undefined ? null : Number(payload.avance);
        if (avance !== null && (avance < 0 || avance > 100)) {
            sendJson(response, 400, { ok: false, message: "El avance debe estar entre 0 y 100" });
            return;
        }
        await queryDb("UPDATE piar_ajuste SET area = COALESCE(?, area), tipo = COALESCE(?, tipo), estrategia = COALESCE(?, estrategia), recursos = COALESCE(?, recursos), responsable = COALESCE(?, responsable), avance = COALESCE(?, avance), estado = COALESCE(?, estado) WHERE id_ajuste = ? AND id_piar = ?", [payload.area || null, payload.tipo || null, payload.estrategia || null, payload.recursos || null, payload.responsable || null, avance, payload.estado || null, adjustmentId, piarId]);
        sendJson(response, 200, { ok: true });
        return;
    }

    const resourceRoutes = {
        diagnosticos: {
            table: "diagnostico",
            select: "SELECT * FROM diagnostico ORDER BY id_diagnostico DESC",
            insert: "INSERT INTO diagnostico (tipo_diagnostico, fecha, descripcion, id_estudiante, id_psicologa, id_piar, id_usuario_creador) VALUES (?, ?, ?, ?, ?, ?, ?)",
            values: payload => [payload.tipo_diagnostico, payload.fecha || null, payload.descripcion || null, payload.id_estudiante || null, payload.id_psicologa || null, payload.id_piar || null, sessionUser?.id || null]
        },
        seguimientos: {
            table: "seguimiento",
            select: "SELECT * FROM seguimiento ORDER BY id_seguimiento DESC",
            insert: "INSERT INTO seguimiento (fecha, descripcion, responsable, id_estudiante, id_coordinador, id_piar, id_usuario_responsable, estado, acuerdos, evolucion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            values: payload => [payload.fecha || null, payload.descripcion || null, payload.responsable || sessionUser?.nombre || null, payload.id_estudiante || null, payload.id_coordinador || null, payload.id_piar || null, sessionUser?.id || null, payload.estado || null, payload.acuerdos || null, payload.evolucion || null]
        },
        observaciones: {
            table: "observacion",
            select: "SELECT * FROM observacion ORDER BY id_observacion DESC",
            insert: "INSERT INTO observacion (fecha, descripcion, docente_responsable, id_estudiante, id_docente, id_piar, id_usuario_autor, tipo, avance, estado, acuerdos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            values: payload => [payload.fecha || null, payload.descripcion || payload.nota || null, payload.docente_responsable || sessionUser?.nombre || null, payload.id_estudiante || null, payload.id_docente || null, payload.id_piar || null, sessionUser?.id || null, payload.tipo || null, payload.avance ?? null, payload.estado || null, payload.acuerdos || null]
        }
    };

    for (const [resource, definition] of Object.entries(resourceRoutes)) {
        if (sessionUser && request.method === "GET" && url.pathname === `/api/${resource}`) {
            sendJson(response, 200, { ok: true, data: await queryDb(definition.select) });
            return;
        }

        if (sessionUser && request.method === "POST" && url.pathname === `/api/${resource}`) {
            const payload = await readJsonBody(request);
            const result = await queryDb(definition.insert, definition.values(payload));
            sendJson(response, 201, { ok: true, data: { id: result.insertId } });
            return;
        }

        const resourceMatch = url.pathname.match(new RegExp(`^/api/${resource}/(\\d+)$`));
        if (sessionUser && resourceMatch && request.method === "GET") {
            const idColumn = resource === "diagnosticos" ? "id_diagnostico" : resource === "seguimientos" ? "id_seguimiento" : "id_observacion";
            const rows = await queryDb(`SELECT * FROM ${definition.table} WHERE ${idColumn} = ?`, [Number(resourceMatch[1])]);
            if (!rows.length) {
                sendJson(response, 404, { ok: false, message: "Registro no encontrado" });
                return;
            }
            sendJson(response, 200, { ok: true, data: rows[0] });
            return;
        }
    }

    for (const [resource, definition] of Object.entries(resourceRoutes)) {
        const resourceMatch = url.pathname.match(new RegExp(`^/api/${resource}/(\\d+)$`));
        if (!sessionUser || !resourceMatch || !["PUT", "DELETE"].includes(request.method)) {
            continue;
        }

        const idColumn = resource === "diagnosticos" ? "id_diagnostico" : resource === "seguimientos" ? "id_seguimiento" : "id_observacion";
        const id = Number(resourceMatch[1]);
        if (request.method === "DELETE") {
            await queryDb(`DELETE FROM ${definition.table} WHERE ${idColumn} = ?`, [id]);
            sendJson(response, 200, { ok: true, message: "Registro eliminado" });
            return;
        }

        const payload = await readJsonBody(request);
        const updateMaps = {
            diagnosticos: ["tipo_diagnostico", "fecha", "descripcion", "id_estudiante", "id_psicologa", "id_piar"],
            seguimientos: ["fecha", "descripcion", "responsable", "id_estudiante", "id_coordinador", "id_piar", "estado", "acuerdos", "evolucion"],
            observaciones: ["fecha", "descripcion", "docente_responsable", "id_estudiante", "id_docente", "id_piar", "tipo", "avance", "estado", "acuerdos"]
        };
        const fields = updateMaps[resource].filter(field => payload[field] !== undefined);
        if (!fields.length) {
            sendJson(response, 400, { ok: false, message: "No hay campos para actualizar" });
            return;
        }
        const values = fields.map(field => payload[field]);
        const assignments = fields.map(field => `${field} = ?`).join(", ");
        await queryDb(`UPDATE ${definition.table} SET ${assignments} WHERE ${idColumn} = ?`, [...values, id]);
        sendJson(response, 200, { ok: true, message: "Registro actualizado" });
        return;
    }

    if (sessionUser && request.method === "GET" && url.pathname === "/api/historial") {
        const rows = await queryDb("SELECT * FROM historial ORDER BY id_historial DESC");
        sendJson(response, 200, { ok: true, data: rows });
        return;
    }

    const historyMatch = url.pathname.match(/^\/api\/historial\/(\d+)$/);
    if (sessionUser && historyMatch && request.method === "GET") {
        const rows = await queryDb("SELECT h.*, hd.id_detalle, hd.tipo_registro, hd.id_referencia, hd.id_usuario, hd.descripcion, hd.fecha_evento, hd.valor_anterior, hd.valor_nuevo FROM historial h LEFT JOIN historial_detalle hd ON hd.id_historial = h.id_historial WHERE h.id_historial = ? ORDER BY hd.fecha_evento", [Number(historyMatch[1])]);
        if (!rows.length) {
            sendJson(response, 404, { ok: false, message: "Historial no encontrado" });
            return;
        }
        sendJson(response, 200, { ok: true, data: rows });
        return;
    }

    if (sessionUser && request.method === "GET" && url.pathname === "/api/reportes") {
        const rows = await queryDb("SELECT * FROM reporte ORDER BY id_reporte DESC");
        sendJson(response, 200, { ok: true, data: rows });
        return;
    }

    const reportMatch = url.pathname.match(/^\/api\/reportes\/(\d+)$/);
    if (sessionUser && reportMatch && request.method === "GET") {
        const rows = await queryDb("SELECT * FROM reporte WHERE id_reporte = ?", [Number(reportMatch[1])]);
        if (!rows.length) {
            sendJson(response, 404, { ok: false, message: "Reporte no encontrado" });
            return;
        }
        sendJson(response, 200, { ok: true, data: rows[0] });
        return;
    }

    if (sessionUser && request.method === "GET" && url.pathname === "/api/dashboard/resumen") {
        const rows = await queryDb(`SELECT
            (SELECT COUNT(*) FROM estudiante) AS estudiantes,
            (SELECT COUNT(*) FROM docente WHERE estado = 'activo') AS docentes,
            (SELECT COUNT(*) FROM piar WHERE estado = 'activo') AS piar_activos,
            (SELECT COUNT(*) FROM observacion) AS observaciones`);
        sendJson(response, 200, { ok: true, data: rows[0] });
        return;
    }

    if (request.method === "GET" &&
    url.pathname === "/api/data") {

    sendJson(response, 200, await readDbFromMysql());
    return;
    }

    if (request.method === "GET" && url.pathname === "/api/estudiantes") {
        getStudentsFromMysql((err, students) => {
            if (err) {
                console.error("Error consultando estudiantes:", err.message);
                sendJson(response, 500, { error: "No se pudieron consultar los estudiantes" });
                return;
            }

            sendJson(response, 200, students);
        });
        return;
    }

    const studentMatch = url.pathname.match(/^\/api\/estudiantes\/(\d+)$/);
    if (request.method === "GET" && studentMatch) {
        const students = await queryDb("SELECT * FROM estudiante WHERE id_estudiante = ?", [Number(studentMatch[1])]);
        if (!students.length) {
            sendJson(response, 404, { ok: false, message: "Estudiante no encontrado" });
            return;
        }
        sendJson(response, 200, { ok: true, data: mapStudentRowToFrontend(students[0]) });
        return;
    }

if (request.method === "POST" && url.pathname === "/api/estudiantes") {
    if (!sessionUser) {
        sendJson(response, 401, { ok: false, message: "Autenticación requerida" });
        return;
    }
    const payload = normalizeStudentPayload(await readJsonBody(request));

    db.query(
        "INSERT INTO estudiante (nombre, documento, edad, curso, condicion_especial, nombres, apellidos, fecha_nacimiento, jornada, estado, acudiente, telefono, contexto, valoracion, fortalezas, barreras, apoyos_requeridos, actividades_casa) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [payload.nombre, payload.documento, payload.edad, payload.curso, payload.condicion_especial, payload.nombres, payload.apellidos, payload.fecha_nacimiento, payload.jornada, payload.estado, payload.acudiente, payload.telefono, payload.contexto, payload.valoracion, JSON.stringify(payload.fortalezas), JSON.stringify(payload.barreras), JSON.stringify(payload.apoyos_requeridos), payload.actividades_casa],
        (err, result) => {
            if (err) {
                console.error("Error creando estudiante:", err.message);
                sendJson(response, 500, { error: "No se pudo crear el estudiante" });
                return;
            }

            sendJson(response, 201, mapStudentRowToFrontend({
                id_estudiante: result.insertId,
                nombre: payload.nombre,
                documento: payload.documento,
                edad: payload.edad,
                curso: payload.curso,
                condicion_especial: payload.condicion_especial,
                ...payload
            }));
        }
    );

    return;
}


    if (request.method === "PUT" && url.pathname === "/api/data") {
        const payload = await readJsonBody(request);
        await writeDb(payload);
        sendJson(response, 200, payload);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/reset") {
        const seed = await readSeedData();
        await writeDb(seed);
        sendJson(response, 200, seed);
        return;
    }

   if (request.method === "PUT" && url.pathname.startsWith("/api/estudiantes/")) {

    if (!sessionUser) {
        sendJson(response, 401, { ok: false, message: "Autenticación requerida" });
        return;
    }

    const id = url.pathname.split("/").pop();
    const payload = normalizeStudentPayload(await readJsonBody(request));

    db.query(
        "UPDATE estudiante SET nombre = ?, documento = ?, edad = ?, curso = ?, condicion_especial = ?, nombres = ?, apellidos = ?, fecha_nacimiento = ?, jornada = ?, estado = ?, acudiente = ?, telefono = ?, contexto = ?, valoracion = ?, fortalezas = ?, barreras = ?, apoyos_requeridos = ?, actividades_casa = ? WHERE id_estudiante = ?",
        [payload.nombre, payload.documento, payload.edad, payload.curso, payload.condicion_especial, payload.nombres, payload.apellidos, payload.fecha_nacimiento, payload.jornada, payload.estado, payload.acudiente, payload.telefono, payload.contexto, payload.valoracion, JSON.stringify(payload.fortalezas), JSON.stringify(payload.barreras), JSON.stringify(payload.apoyos_requeridos), payload.actividades_casa, id],
        (err, result) => {

            if (err) {
                console.error("Error actualizando estudiante:", err.message);
                sendJson(response, 500, { error: "No se pudo actualizar el estudiante" });
                return;
            }

            sendJson(response, 200, mapStudentRowToFrontend({
                id_estudiante: Number(id),
                nombre: payload.nombre,
                documento: payload.documento,
                edad: payload.edad,
                curso: payload.curso,
                condicion_especial: payload.condicion_especial,
                ...payload
            }));

        }
    );

    return;
} 

if (request.method === "DELETE" && url.pathname.startsWith("/api/estudiantes/")) {

    if (!sessionUser) {
        sendJson(response, 401, { ok: false, message: "Autenticación requerida" });
        return;
    }

    const id = url.pathname.split("/").pop();

    db.query(
        "UPDATE estudiante SET estado = 'inactivo' WHERE id_estudiante = ?",
        [id],
        (err, result) => {

            if (err) {
                console.error("Error eliminando estudiante:", err.message);
                sendJson(response, 500, { error: "No se pudo eliminar el estudiante" });
                return;
            }

            sendJson(response, 200, {
                mensaje: "Estudiante desactivado correctamente",
                id: id
            });

        }
    );

    return;
}
    sendJson(response, 404, { error: "Ruta API no encontrada" });
}

async function serveStatic(response, pathname) {
    // Map requests to files under the public/ directory
    const relPath = pathname === "/" ? path.join("public", "index.html") : path.join("public", pathname.replace(/^\/+/, ""));
    const filePath = path.normalize(path.join(ROOT, relPath));

    if (!filePath.startsWith(ROOT)) {
        response.writeHead(403);
        response.end("Acceso denegado");
        return;
    }

    try {
        const file = await fs.readFile(filePath);
        response.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
        response.end(file);
    } catch {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Archivo no encontrado");
    }
}

async function readDb() {
    return JSON.parse(await fs.readFile(DB_PATH, "utf8"));
}

async function writeDb(data) {
    await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function readSeedData() {
    // When frontend is placed under public/, seed data lives in public/js/data.js
    const source = await fs.readFile(path.join(ROOT, "public", "js", "data.js"), "utf8");
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox.window.APP_DATA;
}

            /*****************************************************************
 * OBTENER DATOS DEL SISTEMA DESDE MYSQL
 *****************************************************************/
async function readDbFromMysql() {
    return new Promise((resolve, reject) => {

        getStudentsFromMysql(
            (err, estudiantes) => {

                if (err) {
                    reject(err);
                    return;
                }

                // Attempt to load teacher name from frontend seed data (public/js/data.js)
                readSeedData().then(seed => {
                    const teacherName = seed?.institution?.teacher || "";

                    resolve({

                    /*********************************************************
                     * DATOS DE LA INSTITUCIÃ“N
                     *********************************************************/
                    institution: {
                        name: "Institucion Educativa Reynaldo Matiz",
                        teacher: teacherName
                    },

                    /*********************************************************
                     * CONFIGURACIÃ“N DE ACCESO
                     *********************************************************/
                    auth: {
                        provider: "local"
                    },

                    /*********************************************************
                     * ESTUDIANTES
                     *********************************************************/
                    students: estudiantes,

                    /*********************************************************
                     * DOCENTES
                     *********************************************************/
                    teachers: [],

                    /*********************************************************
                     * PIAR
                     *********************************************************/
                    piars: [],

                    /*********************************************************
                     * TIPOS DE REPORTES
                     *********************************************************/
                    reportTypes: [
                        "Seguimiento individual",
                        "PIAR institucional"
                    ],

                    /*********************************************************
                     * DISCAPACIDADES
                     *********************************************************/
                    discapacidades: [
                        "Visual",
                        "Auditiva",
                        "Fisica",
                        "Cognitiva"
                    ],

                    /*********************************************************
                     * GRADOS
                     *********************************************************/
                    grados: [
                        "6A",
                        "6B",
                        "7A",
                        "7B"
                    ],

                    /*********************************************************
                     * ÃREAS
                     *********************************************************/
                    areas: [
                        "Matematicas",
                        "Lenguaje"
                    ]
                });
        }).catch(() => {
            // Fallback: resolve without teacher if seed cannot be read
            resolve({
                institution: {
                    name: "Institucion Educativa Reynaldo Matiz",
                },
                auth: {
                    provider: "local"
                },
                students: estudiantes,
                teachers: [],
                piars: [],
                reportTypes: [
                    "Seguimiento individual",
                    "PIAR institucional"
                ],
                discapacidades: [
                    "Visual",
                    "Auditiva",
                    "Fisica",
                    "Cognitiva"
                ],
                grados: [
                    "6A",
                    "6B",
                    "7A",
                    "7B"
                ],
                areas: [
                    "Matematicas",
                    "Lenguaje"
                ]
            });
        });

            }
        );

    });
}
            
/**
 * Obtiene estudiantes desde MySQL y los adapta al contrato funcional del frontend.
 */
function getStudentsFromMysql(callback) {
    db.query(
        "SELECT * FROM estudiante ORDER BY id_estudiante",
        (err, rows) => {
            if (err) {
                callback(err);
                return;
            }

            callback(null, rows.map(mapStudentRowToFrontend));
        }
    );
}

/**
 * Convierte una fila de la tabla estudiante al modelo que consume la SPA oficial.
 */
function mapStudentRowToFrontend(row) {
    const nameParts = splitStudentName(row.nombre);
    const grade = row.curso || "";
    const disability = row.condicion_especial || "Por caracterizar";

    return {
        id: row.id_estudiante,
        id_estudiante: row.id_estudiante,
        nombres: row.nombres || nameParts.nombres,
        apellidos: row.apellidos || nameParts.apellidos,
        nombre: row.nombre,
        documento: row.documento,
        fechaNacimiento: row.fecha_nacimiento || "",
        edad: row.edad ?? "",
        grado: grade,
        curso: grade,
        jornada: row.jornada || "",
        discapacidad: disability,
        condicion_especial: disability,
        diagnostico: disability,
        estado: row.estado || "activo",
        acudiente: row.acudiente || "",
        telefono: row.telefono || "",
        contexto: row.contexto || "",
        valoracion: row.valoracion || "",
        fortalezas: parseJsonList(row.fortalezas),
        barreras: parseJsonList(row.barreras),
        apoyosRequeridos: parseJsonList(row.apoyos_requeridos),
        actividadesCasa: row.actividades_casa || ""
    };
}

/**
 * Normaliza datos recibidos desde frontend nuevo o clientes antiguos antes de persistir.
 */
function normalizeStudentPayload(payload) {
    const fullName = [payload.nombres, payload.apellidos].filter(Boolean).join(" ").trim();

    return {
        nombre: payload.nombre || fullName,
        documento: payload.documento,
        edad: payload.edad || null,
        curso: payload.curso || payload.grado || null,
        condicion_especial: payload.condicion_especial || payload.discapacidad || payload.diagnostico || null,
        nombres: payload.nombres || null,
        apellidos: payload.apellidos || null,
        fecha_nacimiento: payload.fecha_nacimiento || payload.fechaNacimiento || null,
        jornada: payload.jornada || null,
        estado: payload.estado || "activo",
        acudiente: payload.acudiente || null,
        telefono: payload.telefono || null,
        contexto: payload.contexto || null,
        valoracion: payload.valoracion || null,
        fortalezas: Array.isArray(payload.fortalezas) ? payload.fortalezas : splitCommaList(payload.fortalezas),
        barreras: Array.isArray(payload.barreras) ? payload.barreras : splitCommaList(payload.barreras),
        apoyos_requeridos: Array.isArray(payload.apoyos_requeridos) ? payload.apoyos_requeridos : (Array.isArray(payload.apoyosRequeridos) ? payload.apoyosRequeridos : splitCommaList(payload.apoyosRequeridos)),
        actividades_casa: payload.actividades_casa || payload.actividadesCasa || null
    };
}

function splitCommaList(value) {
    return String(value || "").split(",").map(item => item.trim()).filter(Boolean);
}

function parseJsonList(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (!value) {
        return [];
    }
    try {
        return JSON.parse(value);
    } catch {
        return [];
    }
}

/**
 * Divide el nombre almacenado actualmente en nombres y apellidos sin modificar MySQL.
 */
function splitStudentName(nombre = "") {
    const parts = nombre.trim().split(/\s+/).filter(Boolean);

    if (parts.length <= 1) {
        return {
            nombres: nombre || "Sin nombre",
            apellidos: ""
        };
    }

    const middle = Math.ceil(parts.length / 2);

    return {
        nombres: parts.slice(0, middle).join(" "),
        apellidos: parts.slice(middle).join(" ")
    };
}
function sendJson(response, status, data, extraHeaders = {}) {
    const requestOrigin = response.req?.headers?.origin;
    const corsOrigin = requestOrigin && allowedOrigins.has(requestOrigin)
        ? requestOrigin
        : allowedOrigins.has("*") ? "*" : null;

    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        ...(corsOrigin ? { "Access-Control-Allow-Origin": corsOrigin } : {}),
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Vary": "Origin",
        ...extraHeaders
    });
    response.end(JSON.stringify(data));
}

function queryDb(sql, values = []) {
    return db.promise().query(sql, values).then(([rows]) => rows);
}

function piarRowToApi(row) {
    return {
        ...row,
        id: row.id_piar,
        studentId: row.id_estudiante,
        fechaCreacion: row.fecha_creacion,
        fechaRevision: row.fecha_revision,
        objetivoGeneral: row.objetivo_general,
        informesSalud: row.informes_salud,
        teacherId: null
    };
}

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";
        let bodyBytes = 0;
        let rejected = false;

        request.on("data", chunk => {
            bodyBytes += chunk.length;
            if (bodyBytes > MAX_JSON_BODY_BYTES) {
                rejected = true;
                const error = new Error("El cuerpo de la solicitud es demasiado grande");
                error.statusCode = 413;
                reject(error);
                request.destroy();
                return;
            }

            body += chunk;
        });
        request.on("end", () => {
            if (rejected) {
                return;
            }

            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (error) {
                const invalidJsonError = new Error("El cuerpo debe contener JSON válido");
                invalidJsonError.statusCode = 400;
                reject(invalidJsonError);
            }
        });
        request.on("error", reject);
    });
}

