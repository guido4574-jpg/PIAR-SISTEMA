"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = 4173;
const PUBLIC_ROOT = path.resolve(__dirname, "..", "public");
const DEMO_COOKIE = "piar_visual_demo";
const DEMO_TEACHER_ID = 990001;
const DEMO_STUDENT_ID = 990001;
const DEMO_PIAR_ID = 990001;
const DEMO_ADMIN_ID = 990010;
const DEMO_STUDENT_USER_ID = 990020;

// Misma política de seguridad de contenido que backend/server.js (una prueba
// compara ambas), para que la demo detecte recursos que el servidor real bloquearía.
const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "font-src 'self' https://cdn.jsdelivr.net",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
].join("; ");

const teacher = Object.freeze({
    id_docente: DEMO_TEACHER_ID,
    id: DEMO_TEACHER_ID,
    nombre: "Docente Demostración",
    nombres: "Docente",
    apellidos: "Demostración Ficticia",
    correo: "docente.demo@example.invalid",
    cargo: "Perfil visual sintético",
    area: "Datos de demostración",
    estado: "activo"
});

const student = Object.freeze({
    id: DEMO_STUDENT_ID,
    id_estudiante: DEMO_STUDENT_ID,
    nombres: "Estudiante",
    apellidos: "Ficticio de Demostración",
    documento: "DEMO-SIN-DOCUMENTO",
    cuenta_vinculada: false,
    grado: "Grado de ejemplo",
    discapacidad: "Dato ficticio",
    condicion_especial: "No corresponde a una persona real",
    estado: "activo",
    contexto: "Registro sintético para revisión visual; no contiene datos reales.",
    valoracion: "Valoración ficticia para demostración.",
    // Misma forma que mapStudentRowToFrontend en backend/server.js (listas siempre presentes).
    fortalezas: ["Fortaleza de ejemplo"],
    barreras: ["Barrera de ejemplo"],
    apoyosRequeridos: ["Apoyo de ejemplo"]
});

const piarSummary = Object.freeze({
    id_piar: DEMO_PIAR_ID,
    id_estudiante: DEMO_STUDENT_ID,
    titulo: "PIAR ficticio de demostración",
    periodo: "2026",
    anio: 2026,
    estado: "activo",
    fecha_creacion: "2026-01-15",
    fecha_revision: "2026-06-15",
    objetivo_general: "Contenido sintético para inspeccionar la interfaz."
});

const piarDetail = Object.freeze({
    ...piarSummary,
    caracterizacion: "Contenido ficticio sin información de una persona real.",
    barreras: [],
    estrategias: "Estrategia de ejemplo; no representa un plan institucional.",
    informes_salud: "",
    proyectos: "",
    actividades_receso: "",
    otra_informacion: "",
    acta_acuerdos: "",
    informe_anual: "",
    entrega_pedagogica: "",
    docentes: [teacher],
    ajustes: [{
        id_ajuste: DEMO_PIAR_ID,
        id_piar: DEMO_PIAR_ID,
        area: "Comunicación (ejemplo)",
        tipo: "Ajuste ficticio",
        estrategia: "Descripción sintética de solo lectura.",
        recursos: "Recurso de ejemplo",
        responsable: "Docente Demostración",
        avance: "50",
        estado: "en_proceso",
        evidencias: []
    }],
    diagnosticos: [],
    seguimientos: [],
    observaciones: []
});

const MIME_TYPES = Object.freeze({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
});

// Cuentas sintéticas: todas usan dominios .invalid y documentos DEMO-; ninguna es real.
const adminUser = Object.freeze({
    id: DEMO_ADMIN_ID,
    nombre: "Administración Demostración Ficticia",
    nombres: "Administración",
    apellidos: "Demostración Ficticia",
    documento: "DEMO-ADMIN",
    correo: "administracion.demo@example.invalid",
    rol: "Administrador",
    estado: "activo"
});

const teacherUser = Object.freeze({
    id: DEMO_TEACHER_ID,
    nombre: "Docente Demostración Ficticia",
    nombres: "Docente",
    apellidos: "Demostración Ficticia",
    documento: "DEMO-SIN-DOCUMENTO",
    correo: "docente.demo@example.invalid",
    rol: "Docente",
    estado: "activo"
});

const studentUser = Object.freeze({
    id: DEMO_STUDENT_USER_ID,
    nombre: "Estudiante Ficticio de Demostración",
    nombres: "Estudiante",
    apellidos: "Ficticio de Demostración",
    documento: "DEMO-ESTUDIANTE",
    correo: "estudiante.demo@example.invalid",
    rol: "Estudiante",
    estado: "activo"
});

// Valor de la cookie de la demo -> cuenta sintética.
const DEMO_VIEWS = Object.freeze({
    admin: adminUser,
    teacher: teacherUser,
    student: studentUser
});

// Listado de cuentas para los módulos Solicitudes y Usuarios (solo Administrador).
const demoAccounts = Object.freeze([
    { id_usuario: DEMO_ADMIN_ID, nombre: adminUser.nombre, correo: adminUser.correo, documento: adminUser.documento, rol: "Administrador", estado: "activo", correo_verificado_at: "2026-01-10T12:00:00.000Z", ultimo_acceso_at: "2026-01-20T12:00:00.000Z" },
    { id_usuario: DEMO_TEACHER_ID, nombre: teacherUser.nombre, correo: teacherUser.correo, documento: teacherUser.documento, rol: "Docente", estado: "activo", correo_verificado_at: "2026-01-11T12:00:00.000Z", ultimo_acceso_at: "2026-01-19T12:00:00.000Z" },
    { id_usuario: 990030, nombre: "Solicitud Verificada Ficticia", correo: "solicitud.verificada@example.invalid", documento: "DEMO-SOLICITUD-1", rol: "Docente", estado: "pendiente", correo_verificado_at: "2026-01-18T12:00:00.000Z", ultimo_acceso_at: null },
    { id_usuario: 990031, nombre: "Solicitud Sin Verificar Ficticia", correo: "solicitud.pendiente@example.invalid", documento: "DEMO-SOLICITUD-2", rol: "Docente", estado: "pendiente_verificacion", correo_verificado_at: null, ultimo_acceso_at: null },
    { id_usuario: DEMO_STUDENT_USER_ID, nombre: studentUser.nombre, correo: studentUser.correo, documento: studentUser.documento, rol: "Estudiante", estado: "activo", correo_verificado_at: "2026-01-12T12:00:00.000Z", ultimo_acceso_at: null }
].map(account => Object.freeze(account)));

const DEMO_BANNER = `<aside role="note" style="position:sticky;top:0;z-index:2147483000;display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:10px 16px;background:#fff4cc;border-bottom:2px solid #b7791f;color:#422006;font:600 14px/1.4 system-ui,sans-serif"><strong>DEMO VISUAL AISLADA</strong><span>Sin conexión a MySQL. Los perfiles y el PIAR son ficticios; todas las escrituras están bloqueadas.</span><a href="/visual/acceso">Vista de acceso</a><a href="/visual/administrador">Vista Administrador sintética</a><a href="/visual/docente">Vista Docente sintética</a><a href="/visual/estudiante">Vista Estudiante sintética</a><span id="visual-demo-status" aria-live="polite"></span></aside>`;

const DEMO_CLIENT_SCRIPT = `
(() => {
    for (const method of ["setItem", "removeItem", "clear"]) {
        try { Storage.prototype[method] = () => {}; } catch { /* storage may be unavailable */ }
    }
    try { Storage.prototype.getItem = () => null; } catch { /* storage may be unavailable */ }
    document.addEventListener("submit", event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const status = document.getElementById("visual-demo-status");
        if (status) status.textContent = "Acción deshabilitada: la demo no envía formularios ni guarda datos.";
    }, true);
    document.addEventListener("click", event => {
        const provider = event.target.closest?.(".auth-provider-button");
        if (!provider) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const status = document.getElementById("visual-demo-status");
        if (status) status.textContent = "Proveedores externos deshabilitados en la demo.";
    }, true);
})();`;

function sendJson(response, status, payload, headers = {}) {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...headers
    });
    response.end(body);
}

// Devuelve la vista sintética activa ("admin", "teacher" o "student") o null.
function demoView(request) {
    for (const item of String(request.headers.cookie || "").split(";")) {
        const separator = item.indexOf("=");
        if (separator <= 0 || item.slice(0, separator).trim() !== DEMO_COOKIE) continue;
        const value = item.slice(separator + 1).trim();
        if (Object.hasOwn(DEMO_VIEWS, value)) return value;
    }
    return null;
}

function fakeUser(view = "teacher") {
    return { ...(DEMO_VIEWS[view] || teacherUser) };
}

function jsonData(data) {
    return { ok: true, data };
}

// Proyección equivalente a backend/student-portal.js: el Estudiante no recibe
// diagnósticos, observaciones, seguimientos, historial ni informes de salud.
function studentPiarSummary() {
    return {
        id_piar: piarSummary.id_piar,
        id_estudiante: piarSummary.id_estudiante,
        titulo: piarSummary.titulo,
        periodo: piarSummary.periodo,
        anio: piarSummary.anio,
        estado: piarSummary.estado,
        objetivo_general: piarSummary.objetivo_general,
        fecha_creacion: piarSummary.fecha_creacion,
        fecha_revision: piarSummary.fecha_revision,
        id: piarSummary.id_piar,
        studentId: piarSummary.id_estudiante,
        fechaCreacion: piarSummary.fecha_creacion,
        fechaRevision: piarSummary.fecha_revision,
        objetivoGeneral: piarSummary.objetivo_general
    };
}

function studentPiarDetail() {
    return {
        ...studentPiarSummary(),
        caracterizacion: piarDetail.caracterizacion,
        estrategias: piarDetail.estrategias,
        estudiante: { id_estudiante: DEMO_STUDENT_ID, nombre: `${student.nombres} ${student.apellidos}` },
        docentes: [{ id_docente: DEMO_TEACHER_ID, nombre: teacher.nombre, area: teacher.area, es_responsable_principal: 1 }],
        teacherId: DEMO_TEACHER_ID,
        dua: [],
        barreras: [],
        ajustes: piarDetail.ajustes.map(ajuste => ({
            id_ajuste: ajuste.id_ajuste,
            area: ajuste.area,
            tipo: ajuste.tipo,
            estrategia: ajuste.estrategia,
            recursos: ajuste.recursos,
            responsable: ajuste.responsable,
            avance: ajuste.avance,
            estado: ajuste.estado,
            evidencias: []
        }))
    };
}

// Vista Estudiante: igual que backend/authorization.js, solo lectura de su propio PIAR.
function studentApiResponse(response, pathname) {
    if (pathname === "/api/piar") return sendJson(response, 200, jsonData([studentPiarSummary()]));
    if (pathname === `/api/piar/${DEMO_PIAR_ID}`) return sendJson(response, 200, jsonData(studentPiarDetail()));
    if (/^\/api\/piar\/\d+$/.test(pathname)) return sendJson(response, 404, { ok: false, message: "PIAR no encontrado" });
    return sendJson(response, 403, { ok: false, message: "No tiene permisos para esta operación." });
}

function apiResponse(request, response, pathname) {
    if (request.method === "POST" && pathname === "/api/auth/logout") {
        return sendJson(response, 200, { ok: true, message: "Vista de demostración cerrada." }, {
            "Set-Cookie": `${DEMO_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`
        });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
        request.resume();
        return sendJson(response, 403, { ok: false, message: "La demo visual es de solo lectura; no se aceptan escrituras." });
    }

    if (pathname === "/api/config") return sendJson(response, 200, { institution: { name: "Colegio Reinaldo Matiz" } });
    if (pathname === "/api/health") return sendJson(response, 200, { status: "visual-demo", database: "not-connected" });
    if (pathname === "/api/auth/oidc/providers") return sendJson(response, 200, { providers: { google: false, microsoft: false, apple: false } });
    const view = demoView(request);
    if (pathname === "/api/auth/me") {
        return view
            ? sendJson(response, 200, { ok: true, user: fakeUser(view) })
            : sendJson(response, 401, { ok: false, message: "Inicia sesión para consultar información institucional." });
    }

    if (!view) return sendJson(response, 401, { ok: false, message: "No hay ninguna vista sintética activada." });
    if (view === "student") return studentApiResponse(response, pathname);
    if (pathname === "/api/usuarios") {
        return view === "admin"
            ? sendJson(response, 200, jsonData(demoAccounts))
            : sendJson(response, 403, { ok: false, message: "No tiene permisos para esta operación." });
    }

    if (pathname === "/api/estudiantes") return sendJson(response, 200, jsonData([student]));
    if (pathname === `/api/estudiantes/${DEMO_STUDENT_ID}`) return sendJson(response, 200, jsonData(student));
    if (pathname === "/api/docentes") return sendJson(response, 200, jsonData([teacher]));
    if (pathname === `/api/docentes/${DEMO_TEACHER_ID}`) return sendJson(response, 200, jsonData(teacher));
    if (pathname === "/api/piar") return sendJson(response, 200, jsonData([piarSummary]));
    if (pathname === `/api/piar/${DEMO_PIAR_ID}`) return sendJson(response, 200, jsonData({
        ...piarDetail,
        estudiante: { id_estudiante: DEMO_STUDENT_ID, nombre: `${student.nombres} ${student.apellidos}`, documento: student.documento }
    }));
    if (pathname === "/api/historial") return sendJson(response, 200, jsonData([{
        id_historial: DEMO_PIAR_ID,
        id_piar: DEMO_PIAR_ID,
        id_usuario: DEMO_TEACHER_ID,
        usuario: "Docente Demostración Ficticia",
        fecha: "2026-01-15T12:00:00.000Z",
        tipo_registro: "version",
        descripcion: "Entrada sintética para revisión visual."
    }]));
    if (pathname === `/api/piar/${DEMO_PIAR_ID}/versiones`) return sendJson(response, 200, jsonData([]));
    if (pathname.startsWith(`/api/piar/${DEMO_PIAR_ID}/versiones/`)) return sendJson(response, 404, { ok: false, message: "Versión de demostración no disponible." });
    if (["/api/diagnosticos", "/api/seguimientos", "/api/observaciones", "/api/reportes"].includes(pathname)) return sendJson(response, 200, jsonData([]));
    return sendJson(response, 404, { ok: false, message: "Ruta no disponible en la demo visual." });
}

function safePublicPath(pathname) {
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { return null; }
    if (decoded.includes("\0")) return null;
    const requested = decoded === "/" ? "/index.html" : decoded;
    const candidate = path.resolve(PUBLIC_ROOT, `.${requested.replace(/[\\/]+/g, path.sep)}`);
    const relative = path.relative(PUBLIC_ROOT, candidate);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    return candidate;
}

async function serveStatic(request, response, pathname) {
    if (request.method !== "GET" && request.method !== "HEAD") {
        request.resume();
        return sendJson(response, 405, { ok: false, message: "Solo se permiten lecturas en la demo visual." });
    }
    const filePath = safePublicPath(pathname);
    if (!filePath) return sendJson(response, 404, { ok: false, message: "Archivo no encontrado." });
    try {
        const realRoot = await fs.realpath(PUBLIC_ROOT);
        const realPath = await fs.realpath(filePath);
        const relative = path.relative(realRoot, realPath);
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            return sendJson(response, 404, { ok: false, message: "Archivo no encontrado." });
        }
        const content = await fs.readFile(realPath);
        const ext = path.extname(realPath).toLowerCase();
        let body = content;
        if (ext === ".html") {
            body = Buffer.from(content.toString("utf8")
                .replace(/<body([^>]*)>/i, `<body$1>${DEMO_BANNER}`)
                // Script externo: la CSP de la demo, igual que la del servidor, no admite scripts en línea.
                .replace(/<\/body>/i, `<script src="/visual/demo-client.js"></script></body>`));
        }
        response.writeHead(200, {
            "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
            "Cache-Control": "no-store",
            "Content-Security-Policy": CONTENT_SECURITY_POLICY,
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "no-referrer",
            "Content-Length": body.length
        });
        response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
        if (error.code === "ENOENT" || error.code === "EISDIR") return sendJson(response, 404, { ok: false, message: "Archivo no encontrado." });
        sendJson(response, 500, { ok: false, message: "No se pudo cargar el recurso visual." });
    }
}

// Rutas que activan cada vista sintética.
const VIEW_ROUTES = Object.freeze({
    "/visual/administrador": "admin",
    "/visual/docente": "teacher",
    "/visual/estudiante": "student"
});

function createVisualDemoServer() {
    return http.createServer(async (request, response) => {
        const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
        const viewRoute = VIEW_ROUTES[url.pathname];
        if (request.method === "GET" && viewRoute) {
            response.writeHead(303, {
                Location: "/",
                "Set-Cookie": `${DEMO_COOKIE}=${viewRoute}; Path=/; HttpOnly; SameSite=Lax`,
                "Cache-Control": "no-store"
            });
            return response.end();
        }
        if (request.method === "GET" && url.pathname === "/visual/demo-client.js") {
            const body = Buffer.from(DEMO_CLIENT_SCRIPT, "utf8");
            response.writeHead(200, {
                "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store",
                "Content-Security-Policy": CONTENT_SECURITY_POLICY, "X-Content-Type-Options": "nosniff", "Content-Length": body.length
            });
            return response.end(body);
        }
        if (request.method === "GET" && url.pathname === "/visual/acceso") {
            response.writeHead(303, {
                Location: "/",
                "Set-Cookie": `${DEMO_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`,
                "Cache-Control": "no-store"
            });
            return response.end();
        }
        if (url.pathname.startsWith("/api/")) return apiResponse(request, response, url.pathname);
        return serveStatic(request, response, url.pathname);
    });
}

if (require.main === module) {
    const server = createVisualDemoServer();
    server.listen(PORT, HOST, () => {
        console.log(`Demo visual de PIAR (solo lectura, sin base de datos) en http://${HOST}:${PORT}`);
    });
}

module.exports = { createVisualDemoServer, safePublicPath, fakeUser, demoView, CONTENT_SECURITY_POLICY, DEMO_TEACHER_ID, DEMO_STUDENT_ID, DEMO_PIAR_ID, DEMO_ADMIN_ID };
