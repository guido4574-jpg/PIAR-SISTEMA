const http = require("http");
const fs = require("fs/promises");
const path = require("path");
require("./config");
// Antes de abrir la base: en producción, una configuración insegura detiene el arranque.
const runtimeConfig = require("./production-config");
const runtimeWarnings = runtimeConfig.assertRuntimeConfig(process.env);
const db = require("./db");
const auth = require("./auth");
const { authorizationStatus, canAccessRoleResource } = require("./authorization");
const { resolveTeacherProfile, hasAssignedPiar, canTeacherAccessResource } = require("./student-access");
const { canBePiarResponsible } = require("./pedagogical-access");
const { STUDENT_ROLE, handleStudentPortalRequest } = require("./student-portal");
const { validDate, validateBarrierPayload, validateAdjustmentTracePayload, validateEvidencePayload, validateDuaPayload, validateRecordPayload } = require("./pedagogical-validation");
const { classifyMutation } = require("./mutation-result");
const { runVersionedPiarMutation, runVersionedPiarMutations, normalizeJustification } = require("./piar-versioning");
const { decidePendingTeacher } = require("./registration-approval");
const { notifyRegistrationDecision } = require("./decision-notification");
const { buildStudentUpdate } = require("./student-update");
const { validateTeacherPayload } = require("./teacher-validation");
const { buildPartialUpdate, assignmentSql } = require("./partial-update");
const accountEmail = require("./account-email");
const { createLimiter, createRateLimitStore, combine } = require("./rate-limit-store");
const { createLoginThrottle } = require("./login-throttle");
const { createClientIpResolver } = require("./client-ip");
const { createSecurityEventRecorder, hashEmail } = require("./security-events");
const { scheduleMaintenance } = require("./maintenance");
const { reportPersistenceAvailable, validateReportRequest, createReport, listReports, getReport } = require("./reports");
const { isAllowedMutationOrigin, isPathInside, parseAllowedOrigins, resolvePublicFilePath } = require("./security-controls");
const oidcFlow = require("./oidc");
const { takeDevelopmentOutbox } = require("./email");
const { INSTITUTION } = require("./institution-config");
const { recordAdminAccountEvent } = require("./admin-account-audit");
const crypto = require("crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const requestAuditStorage = new AsyncLocalStorage();
const RESOURCE_EVENT_NAMES = Object.freeze({ diagnosticos: "diagnostico", seguimientos: "seguimiento", observaciones: "observacion" });
const DUA_SELECT = "SELECT d.id_dua, d.id_piar, d.principio, d.area, d.estrategia, d.recursos, d.id_usuario_registro, u.nombre AS autor_nombre, d.created_at, d.updated_at FROM piar_dua d INNER JOIN usuario u ON u.id_usuario = d.id_usuario_registro";

const STUDENT_COLUMNS = "id_estudiante, nombre, documento, edad, curso, condicion_especial, nombres, apellidos, fecha_nacimiento, jornada, estado, acudiente, telefono, contexto, valoracion, fortalezas, barreras, apoyos_requeridos, actividades_casa, created_at, updated_at";
// Proyección mínima de docentes para los roles que solo consultan.
const TEACHER_SUMMARY_COLUMNS = "id_docente, nombre, area, correo, cargo, estado";
// Proyección completa (columnas reales de `docente`) solo para los roles que la
// matriz aprobada autoriza a editar perfiles docentes; el formulario de edición
// la necesita para mostrar los valores guardados.
const TEACHER_PROFILE_COLUMNS = "id_docente, nombre, nombres, apellidos, documento, area, correo, cargo, telefono, perfil, estado";

const PORT = runtimeConfig.resolveListenPort(process.env);
const ROOT = path.resolve(__dirname, "..");
const MAX_JSON_BODY_BYTES = 1024 * 1024;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
// RATE_LIMIT_STORE=mysql shares counters between instances (migration 012).
const rateLimitStore = createRateLimitStore(process.env, db);
const limiter = (name, limit) => createLimiter(rateLimitStore, { name, limit, windowMs: FIFTEEN_MINUTES });
const loginThrottle = createLoginThrottle({ store: rateLimitStore });
const passwordResetLimits = [limiter("reset-ip", 10), limiter("reset-email", 5)];
const emailVerificationLimits = [limiter("verification-ip", 10), limiter("verification-email", 3)];
const registrationLimits = [limiter("registration-ip", 10), limiter("registration-email", 5)];
const oidcStartLimit = limiter("oidc-start-ip", 10);
const emailChangeConfirmLimit = limiter("email-change-confirm-ip", 10);
// TRUSTED_PROXIES lists the reverse proxies allowed to set X-Forwarded-For.
const clientIp = createClientIpResolver(process.env.TRUSTED_PROXIES);
const recordSecurityEvent = createSecurityEventRecorder(db);
const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGIN, "http://localhost:8080,http://127.0.0.1:8080");

const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    // Fuentes locales (Poppins): con nosniff, el tipo correcto evita servirlas como binario genérico.
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ico": "image/x-icon"
};

// Diagnóstico temporal para configurar TRUSTED_PROXIES (PIAR_DIAGNOSTICO_PROXY=1): registra en
// las 5 primeras peticiones la dirección del par TCP (el proxy, no el usuario) y cuántos saltos
// trae X-Forwarded-For, nunca sus valores. Se desactiva retirando la variable.
let proxyDiagnosticsLeft = String(process.env.PIAR_DIAGNOSTICO_PROXY || "") === "1" ? 5 : 0;

function logProxyDiagnostic(request) {
    if (proxyDiagnosticsLeft <= 0) return;
    proxyDiagnosticsLeft -= 1;
    const forwarded = String(request.headers["x-forwarded-for"] || "").split(",").map(item => item.trim()).filter(Boolean);
    console.log(`Diagnóstico de proxy: par TCP ${request.socket?.remoteAddress || "desconocido"}; saltos en X-Forwarded-For: ${forwarded.length}`);
}

const server = http.createServer((request, response) => {
    logProxyDiagnostic(request);
    requestAuditStorage.run(createRequestAuditContext(request), async () => {
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
        console.error("Error procesando solicitud:", error.code || error.name || "ERROR");
        sendJson(response, error.statusCode || 500, {
            error: error.statusCode ? error.message : "Error interno del servidor"
        });
      }
    });
});

const HOST = runtimeConfig.resolveListenHost(process.env);
for (const warning of runtimeWarnings) console.warn(`Advertencia de configuración: ${warning}`);
server.listen(PORT, HOST, () => {
    console.log(`PIAR API y app disponibles en http://${HOST}:${PORT}`);
});
// Railway envía SIGTERM al redesplegar: se cierran conexiones y el pool de MySQL.
process.once("SIGTERM", () => {
    server.close(() => db.end(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10000).unref();
});
scheduleMaintenance(db);

async function handleApi(request, response, url) {
    if (request.method === "OPTIONS") {
        sendJson(response, 200, { ok: true });
        return;
    }

    // Apple devuelve la autorización con POST (response_mode=form_post) desde su propio
    // origen. Esta ruta no cambia estado: solo convierte la respuesta en un GET al mismo
    // callback, donde se validan cookie de estado, transacción, nonce y tokens.
    if (request.method === "POST" && url.pathname === "/api/auth/oidc/apple/callback") {
        await relayAppleFormPost(request, response);
        return;
    }

    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)
        && !isAllowedMutationOrigin(request, allowedOrigins)) {
        sendJson(response, 403, { ok: false, message: "Origen de solicitud no autorizado." });
        return;
    }

    if (request.method === "GET" && url.pathname === "/api/config") {
        sendJson(response, 200, { ok: true, institution: INSTITUTION });
        return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
        db.query("SELECT 1", (error) => {
            if (error) {
                sendJson(response, 503, { status: "degraded" });
                return;
            }

            sendJson(response, 200, { status: "ok" });
        });
        return;
    }

    if (request.method === "GET" && url.pathname === "/api/dev/email-outbox") {
        const remote = request.socket?.remoteAddress || "";
        if (process.env.NODE_ENV === "production" || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote)) {
            sendJson(response, 404, { ok: false, message: "Ruta no encontrada." });
            return;
        }
        const match = String(request.headers.authorization || "").match(/^Bearer (.+)$/);
        try {
            const messages = takeDevelopmentOutbox(match?.[1]);
            sendJson(response, 200, { ok: true, messages });
        } catch {
            sendJson(response, 403, { ok: false, message: "Acceso local no autorizado." });
        }
        return;
    }

    if (["/api/data", "/api/reset"].includes(url.pathname)) {
        sendJson(response, 410, { ok: false, message: "Endpoint retirado; la persistencia institucional usa recursos específicos." });
        return;
    }

    const oidcStartMatch = url.pathname.match(/^\/api\/auth\/oidc\/(google|microsoft|apple)\/start$/);
    if (request.method === "GET" && oidcStartMatch) {
        await startOidc(request, response, oidcStartMatch[1]);
        return;
    }
    const oidcLinkMatch = url.pathname.match(/^\/api\/auth\/oidc\/(google|microsoft|apple)\/link$/);
    if (request.method === "POST" && oidcLinkMatch) {
        await linkOidc(request, response, oidcLinkMatch[1]);
        return;
    }
    const oidcCallbackMatch = url.pathname.match(/^\/api\/auth\/oidc\/(google|microsoft|apple)\/callback$/);
    if (request.method === "GET" && oidcCallbackMatch) {
        await completeOidc(request, response, url, oidcCallbackMatch[1]);
        return;
    }
    if (url.pathname === "/api/auth/identities" || /^\/api\/auth\/identities\/\d+$/.test(url.pathname)) {
        await handleExternalIdentities(request, response, url);
        return;
    }
    if (request.method === "GET" && url.pathname === "/api/auth/oidc/providers") {
        sendJson(response, 200, { providers: Object.fromEntries(["google", "microsoft", "apple"].map(provider => [provider, oidcFlow.configuredProvider(provider)])) });
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/register") {
        const payload = await readJsonBody(request);
        const ip = clientIp(request);
        const limit = await combine(registrationLimits, "consume", [ip, hashEmail(payload.correo)]);
        if (!limit.allowed) {
            await recordSecurityEvent({ type: "registro_bloqueado", outcome: "bloqueado", email: payload.correo, ip });
            sendJson(response, 429, { ok: false, message: "Demasiadas solicitudes. Intenta de nuevo más tarde." }, { "Retry-After": String(limit.retryAfterSeconds) });
            return;
        }
        const result = await auth.register(db, payload, false);
        await recordSecurityEvent({ type: "registro_solicitado", outcome: result.status < 300 ? "exito" : "fallo", email: payload.correo, ip });
        sendJson(response, result.status, result.body);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/login") {
        const payload = await readJsonBody(request);
        const ip = clientIp(request);
        const emailKey = hashEmail(payload.correo);
        const limit = await loginThrottle.check(ip, emailKey);
        if (!limit.allowed) {
            await recordSecurityEvent({ type: "login_bloqueado", outcome: "bloqueado", email: payload.correo, ip });
            sendJson(response, 429, { ok: false, message: "Demasiados intentos fallidos. Intenta de nuevo más tarde." }, { "Retry-After": String(limit.retryAfterSeconds) });
            return;
        }
        const result = await auth.login(db, payload);
        if (result.session) {
            await loginThrottle.recordSuccess(ip, emailKey);
            await recordSecurityEvent({ type: "login_exitoso", outcome: "exito", userId: result.body.user?.id, email: payload.correo, ip });
            sendJson(response, result.status, result.body, { "Set-Cookie": auth.sessionCookie(result.session.token, result.session.maxAgeSeconds) });
            return;
        }
        if (result.status === 401) {
            await loginThrottle.recordFailure(ip, emailKey);
            await recordSecurityEvent({ type: "login_fallido", outcome: "fallo", email: payload.correo, ip });
        }
        sendJson(response, result.status, result.body);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/email-verification/confirm") {
        const payload = await readJsonBody(request);
        const result = await auth.verifyEmail(db, payload.token);
        await recordSecurityEvent({ type: "correo_verificado", outcome: result.status === 200 ? "exito" : "fallo", ip: clientIp(request) });
        sendJson(response, result.status, result.body);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/email-change/confirm") {
        const payload = await readJsonBody(request);
        const ip = clientIp(request);
        const limit = await emailChangeConfirmLimit.consume(ip);
        if (!limit.allowed) {
            await recordSecurityEvent({ type: "solicitud_limitada", outcome: "bloqueado", ip, detail: "cambio_correo" });
            sendJson(response, 429, { ok: false, message: "Demasiadas solicitudes. Intenta de nuevo más tarde." }, { "Retry-After": String(limit.retryAfterSeconds) });
            return;
        }
        const result = await accountEmail.confirmEmailChange(db, payload?.token);
        await recordSecurityEvent({ type: "correo_cambiado", outcome: result.status === 200 ? "exito" : "fallo", userId: result.userId ?? null, ip });
        sendJson(response, result.status, result.body, result.status === 200 ? { "Set-Cookie": auth.sessionCookie("", 0) } : {});
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/email-verification/request") {
        const payload = await readJsonBody(request);
        const ip = clientIp(request);
        const limit = await combine(emailVerificationLimits, "consume", [ip, hashEmail(payload.correo)]);
        if (!limit.allowed) {
            await recordSecurityEvent({ type: "solicitud_limitada", outcome: "bloqueado", email: payload.correo, ip, detail: "verificacion" });
            sendJson(response, 429, { ok: false, message: "Si existe una solicitud pendiente, enviaremos instrucciones." }, { "Retry-After": String(limit.retryAfterSeconds) });
            return;
        }
        const result = await auth.requestEmailVerification(db, payload.correo);
        await recordSecurityEvent({ type: "verificacion_reenviada", outcome: "exito", email: payload.correo, ip });
        sendJson(response, result.status, result.body);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/password-reset/request") {
        const payload = await readJsonBody(request);
        const ip = clientIp(request);
        const limit = await combine(passwordResetLimits, "consume", [ip, hashEmail(payload.correo)]);
        if (!limit.allowed) {
            await recordSecurityEvent({ type: "solicitud_limitada", outcome: "bloqueado", email: payload.correo, ip, detail: "recuperacion" });
            sendJson(response, 429, { ok: false, message: "Si el correo corresponde a una cuenta, recibirá instrucciones." }, { "Retry-After": String(limit.retryAfterSeconds) });
            return;
        }
        const result = await auth.requestPasswordReset(db, payload.correo);
        await recordSecurityEvent({ type: "reset_solicitado", outcome: "exito", email: payload.correo, ip });
        sendJson(response, result.status, result.body);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/password-reset/confirm") {
        const payload = await readJsonBody(request);
        const result = await auth.resetPassword(db, payload.token, payload.password);
        await recordSecurityEvent({ type: result.status === 200 ? "reset_completado" : "reset_fallido", outcome: result.status === 200 ? "exito" : "fallo", ip: clientIp(request) });
        sendJson(response, result.status, result.body);
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        const user = await auth.currentUser(db, request);
        await auth.logout(db, request);
        if (user) await recordSecurityEvent({ type: "logout", outcome: "exito", userId: user.id, ip: clientIp(request) });
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
    const auditContext = requestAuditStorage.getStore();
    if (auditContext && sessionUser) auditContext.actorId = sessionUser.id;

    if (!sessionUser) {
        sendJson(response, 401, { ok: false, message: "Autenticación requerida" });
        return;
    }

    const path = url.pathname;
    const method = request.method;
    if (method === "POST" && path === "/api/auth/initial-password-change") {
        const payload = await readJsonBody(request);
        const result = await auth.changeInitialPassword(db, request, payload.password);
        await recordSecurityEvent({ type: "cambio_contrasena_inicial", outcome: result.status === 200 ? "exito" : "fallo", userId: sessionUser.id, ip: clientIp(request) });
        sendJson(response, result.status, result.body);
        return;
    }
    if (sessionUser.mustChangePassword) {
        sendJson(response, 403, {
            ok: false,
            code: "PASSWORD_CHANGE_REQUIRED",
            message: "Cambia la contraseña temporal para continuar."
        });
        return;
    }

    const role = sessionUser.rol;
    const teacher = role === "Docente";
    const accessStatus = authorizationStatus(sessionUser, method, path);
    if (accessStatus !== 200) {
        sendJson(response, accessStatus, { ok: false, message: accessStatus === 401 ? "Autenticación requerida" : "No tiene permisos para esta operación." });
        return;
    }

    // Estudiante never reaches the institutional handlers below: its own-PIAR,
    // read-only scope and response allow-list live in student-portal.js.
    if (role === STUDENT_ROLE) {
        const result = await handleStudentPortalRequest({ query: queryDb, userId: sessionUser.id, method, pathname: path });
        sendJson(response, result.status, result.body);
        return;
    }

    let teacherProfile = null;
    if (teacher) {
        teacherProfile = await resolveTeacherProfile(queryDb, sessionUser.id);
        if (!teacherProfile) {
            sendJson(response, 403, { ok: false, message: "El perfil docente no está disponible para esta operación." });
            return;
        }
    }

    const approvalMatch = path.match(/^\/api\/usuarios\/(\d+)\/aprobacion$/);
    if (approvalMatch && method === "POST") {
        const payload = await readJsonBody(request);
        const [applicant] = await queryDb("SELECT nombre, correo, rol FROM usuario WHERE id_usuario = ?", [Number(approvalMatch[1])]);
        const result = await decidePendingTeacher(db, Number(approvalMatch[1]), payload.decision, sessionUser.id, payload.reason);
        if (result.status !== 200) {
            sendJson(response, result.status, { ok: false, message: result.message });
            return;
        }
        // La decisión ya está confirmada; el aviso por correo es posterior y no la revierte.
        let notificacion = "no_enviada";
        try { notificacion = await notifyRegistrationDecision(payload.decision, applicant, { baseUrl: auth.applicationBaseUrl() }); } catch { /* sin URL base no se envía */ }
        sendJson(response, 200, { ok: true, estado: result.state, notificacion });
        return;
    }

    if (teacher) {
        const piarId = path.match(/^\/api\/piar\/(\d+)/)?.[1];
        const studentId = path.match(/^\/api\/estudiantes\/(\d+)/)?.[1];
        let assigned = true;
        if (piarId) {
            assigned = await hasAssignedPiar(queryDb, teacherProfile.id_docente, Number(piarId));
        } else if (studentId) {
            const rows = await queryDb("SELECT 1 FROM piar p INNER JOIN piar_docente pd ON pd.id_piar = p.id_piar WHERE p.id_estudiante = ? AND pd.id_docente = ? LIMIT 1", [Number(studentId), teacherProfile.id_docente]);
            assigned = rows.length > 0;
        } else if (/^\/api\/docentes\/\d+$/.test(path)) {
            const teacherId = Number(path.match(/\d+$/)[0]);
            assigned = teacherId === Number(teacherProfile.id_docente);
        } else {
            const resourceMatch = path.match(/^\/api\/(diagnosticos|seguimientos|observaciones|historial|reportes)\/(\d+)$/);
            if (resourceMatch) {
                assigned = await canTeacherAccessResource(queryDb, resourceMatch[1], Number(resourceMatch[2]), teacherProfile.id_docente);
            }
        }
        if (!assigned) {
            sendJson(response, 404, { ok: false, message: "Registro no encontrado." });
            return;
        }
    }

    if (request.method === "GET" && url.pathname === "/api/usuarios") {
        if (!sessionUser || sessionUser.rol !== "Administrador") {
            sendJson(response, 403, { ok: false, message: "No autorizado" });
            return;
        }
        const users = await queryDb("SELECT id_usuario, nombre, documento, correo, rol, estado, correo_verificado_at, aprobado_por_usuario_id, rechazado_por_usuario_id, decision_at, ultimo_acceso_at, created_at, updated_at FROM usuario ORDER BY id_usuario");
        sendJson(response, 200, { ok: true, data: users });
        return;
    }

    const userMatch = url.pathname.match(/^\/api\/usuarios\/(\d+)$/);
    if (userMatch && request.method === "GET") {
        if (!sessionUser || sessionUser.rol !== "Administrador") {
            sendJson(response, 403, { ok: false, message: "No autorizado" });
            return;
        }
        const users = await queryDb("SELECT id_usuario, nombre, documento, correo, rol, estado, correo_verificado_at, aprobado_por_usuario_id, rechazado_por_usuario_id, decision_at, ultimo_acceso_at, created_at, updated_at FROM usuario WHERE id_usuario = ?", [Number(userMatch[1])]);
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
        const payload = await readJsonBody(request);
        // Decisión D3: los mismos cuatro perfiles del registro. Decisión D7: también
        // cuentas Estudiante, siempre vinculadas a un registro de estudiante.
        // Nunca se crea otra cuenta Administrador.
        if (!auth.INSTITUTIONAL_ACCOUNT_ROLES.includes(payload?.rol)) {
            sendJson(response, 403, { ok: false, message: "Solo se pueden crear cuentas de Docente, Psicólogo(a), Coordinador, Rector o Estudiante." });
            return;
        }
        // Sigue la verificación del correo y la aprobación posterior; la creación
        // queda en admin_account_audit y la contraseña asignada es temporal.
        const result = await auth.register(db, payload, false, undefined, { actorId: sessionUser.id });
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
            const outcome = await changeUserActivation(userId, sessionUser, "desactivar");
            sendJson(response, outcome.status, outcome.body);
            return;
        }

        const payload = await readJsonBody(request);
        if (payload.rol !== undefined || payload.estado !== undefined) {
            sendJson(response, 403, { ok: false, message: "Los cambios de rol y estado requieren los flujos de vinculación y aprobación." });
            return;
        }
        const nombre = payload.nombre === undefined ? null : String(payload.nombre).trim();
        const correo = payload.correo === undefined ? null : String(payload.correo).trim().toLowerCase();
        if ((nombre !== null && (!nombre || Buffer.byteLength(nombre, "utf8") > 150))
            || (correo !== null && (correo.length > 150 || !/^\S+@\S+\.\S+$/.test(correo)))) {
            sendJson(response, 400, { ok: false, message: "El nombre o el correo no son válidos." });
            return;
        }
        if (nombre === null && correo === null) {
            sendJson(response, 400, { ok: false, message: "No hay cambios para guardar." });
            return;
        }
        // Decisión D1: el correo nuevo solo se aplica al verificarlo; el actual sigue vigente.
        let emailResult = null;
        if (correo !== null) {
            emailResult = await accountEmail.requestEmailChange(db, { userId, newEmail: correo, actorId: sessionUser.id },
                (address, fragment) => auth.deliverEmail(address, "Confirma el nuevo correo de tu cuenta PIAR",
                    `Se solicitó asociar este correo a una cuenta de PIAR. Confírmalo en este enlace, que vence en ${accountEmail.EMAIL_CHANGE_HOURS} horas: ${auth.applicationBaseUrl()}${fragment}`));
            if (emailResult.status >= 300) {
                sendJson(response, emailResult.status, emailResult.body);
                return;
            }
        }
        let nameResult = null;
        if (nombre !== null) {
            nameResult = await accountEmail.updateAccountName(db, { userId, nombre, actorId: sessionUser.id });
            if (nameResult.status >= 300) {
                sendJson(response, nameResult.status, nameResult.body);
                return;
            }
        }
        const pending = emailResult?.status === 202;
        const unchanged = (!emailResult || emailResult.body.unchanged) && (!nameResult || nameResult.body.unchanged);
        const message = pending
            ? `${nameResult && !nameResult.body.unchanged ? "Nombre actualizado. " : ""}${emailResult.body.message}`
            : unchanged ? "La cuenta no tenía cambios." : "Cuenta actualizada.";
        sendJson(response, pending ? 202 : 200, { ok: true, unchanged, pendingVerification: pending, message });
        return;
    }

    const reactivationMatch = url.pathname.match(/^\/api\/usuarios\/(\d+)\/reactivacion$/);
    if (reactivationMatch && request.method === "POST") {
        const outcome = await changeUserActivation(Number(reactivationMatch[1]), sessionUser, "reactivar");
        sendJson(response, outcome.status, outcome.body);
        return;
    }

    // La proyección completa depende de la misma regla que autoriza editar (PUT).
    const teacherColumns = canAccessRoleResource(role, "PUT", "/api/docentes/0") ? TEACHER_PROFILE_COLUMNS : TEACHER_SUMMARY_COLUMNS;
    if (sessionUser && request.method === "GET" && url.pathname === "/api/docentes") {
        const teachers = role === "Docente"
            ? await queryDb(`SELECT ${TEACHER_SUMMARY_COLUMNS} FROM docente WHERE id_docente = ? ORDER BY id_docente`, [teacherProfile.id_docente])
            : await queryDb(`SELECT ${teacherColumns} FROM docente ORDER BY id_docente`);
        sendJson(response, 200, { ok: true, data: teachers });
        return;
    }

    const teacherMatch = url.pathname.match(/^\/api\/docentes\/(\d+)$/);
    if (teacherMatch && sessionUser && request.method === "GET") {
        const teachers = await queryDb(`SELECT ${teacherColumns} FROM docente WHERE id_docente = ?`, [Number(teacherMatch[1])]);
        if (!teachers.length) {
            sendJson(response, 404, { ok: false, message: "Docente no encontrado" });
            return;
        }
        sendJson(response, 200, { ok: true, data: teachers[0] });
        return;
    }

    if (sessionUser && request.method === "POST" && url.pathname === "/api/docentes") {
        const payload = await readJsonBody(request);
        if (payload && Object.hasOwn(payload, "id_usuario")) {
            sendJson(response, 403, { ok: false, message: "La vinculación de cuentas y perfiles requiere un flujo de aprovisionamiento autorizado." });
            return;
        }
        const checked = validateTeacherPayload(payload);
        if (checked.error) {
            sendJson(response, 400, { ok: false, message: checked.error });
            return;
        }
        const teacher = checked.values;
        const result = await queryDb("INSERT INTO docente (nombre, area, correo, nombres, apellidos, documento, cargo, telefono, perfil, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [teacher.nombre, teacher.area ?? null, teacher.correo ?? null, teacher.nombres ?? null, teacher.apellidos ?? null, teacher.documento ?? null, teacher.cargo ?? null, teacher.telefono ?? null, teacher.perfil ?? null, teacher.estado]);
        sendJson(response, 201, { ok: true, data: { id_docente: result.insertId, ...teacher } });
        return;
    }

    if (teacherMatch && sessionUser && ["PUT", "DELETE"].includes(request.method)) {
        const teacherId = Number(teacherMatch[1]);
        if (request.method === "DELETE") {
            const result = await queryDb("UPDATE docente SET estado = 'inactivo' WHERE id_docente = ? AND estado <> 'inactivo'", [teacherId]);
            await sendMutationOutcome(response, result, "SELECT 1 FROM docente WHERE id_docente = ?", [teacherId], "Docente", "desactivado");
            return;
        }
        const payload = await readJsonBody(request);
        if (Object.hasOwn(payload, "id_usuario")) {
            sendJson(response, 403, { ok: false, message: "La vinculación de cuentas y perfiles requiere un flujo de aprovisionamiento autorizado." });
            return;
        }
        const checked = validateTeacherPayload(payload, { partial: true });
        if (checked.error) {
            sendJson(response, 400, { ok: false, message: checked.error });
            return;
        }
        const teacher = checked.values;
        // Los campos presentes se guardan tal cual (vacío = NULL); nombre y estado no admiten NULL.
        const teacherColumnsToUpdate = Object.keys(teacher).filter(column => !(["nombre", "estado"].includes(column) && teacher[column] === null));
        if (!teacherColumnsToUpdate.length) {
            sendJson(response, 400, { ok: false, message: "No hay campos para actualizar" });
            return;
        }
        const result = await queryDb(`UPDATE docente SET ${assignmentSql(teacherColumnsToUpdate)} WHERE id_docente = ?`, [...teacherColumnsToUpdate.map(column => teacher[column]), teacherId]);
        await sendMutationOutcome(response, result, "SELECT 1 FROM docente WHERE id_docente = ?", [teacherId], "Docente", "actualizado");
        return;
    }

    if (sessionUser && request.method === "GET" && url.pathname === "/api/piar") {
        const piars = teacher
            ? await queryDb("SELECT DISTINCT p.id_piar, p.id_estudiante, p.titulo, p.periodo, p.anio, p.estado, p.objetivo_general, p.metas, p.caracterizacion, p.barreras, p.estrategias, p.informes_salud, p.proyectos, p.actividades_receso, p.otra_informacion, p.acta_acuerdos, p.informe_anual, p.entrega_pedagogica, p.fecha_creacion, p.fecha_revision, p.fecha_cierre, p.created_at, p.updated_at FROM piar p INNER JOIN piar_docente pd ON pd.id_piar = p.id_piar WHERE pd.id_docente = ? ORDER BY p.id_piar DESC", [teacherProfile.id_docente])
            : await queryDb("SELECT id_piar, id_estudiante, titulo, periodo, anio, estado, objetivo_general, metas, caracterizacion, barreras, estrategias, informes_salud, proyectos, actividades_receso, otra_informacion, acta_acuerdos, informe_anual, entrega_pedagogica, fecha_creacion, fecha_revision, fecha_cierre, created_at, updated_at FROM piar ORDER BY id_piar DESC");
        sendJson(response, 200, { ok: true, data: piars });
        return;
    }

    const reopenMatch = url.pathname.match(/^\/api\/piar\/(\d+)\/reapertura$/);
    if (reopenMatch && request.method === "POST") {
        const payload = await readJsonBody(request);
        const justification = normalizeJustification(payload.justificacion);
        if (!justification) {
            sendJson(response, 400, { ok: false, message: "La justificación es obligatoria y no puede superar 1000 caracteres." });
            return;
        }
        const result = await runVersionedPiarMutation(db, {
            piarId: Number(reopenMatch[1]), userId: sessionUser.id, justification, operation: "reapertura",
            mutate: async (connection, before) => {
                if (before.piar.estado !== "cerrado") return { status: 409, message: "Solo se puede reabrir un PIAR cerrado." };
                const [updated] = await connection.query("UPDATE piar SET estado = 'revision', fecha_cierre = NULL WHERE id_piar = ? AND estado = 'cerrado'", [Number(reopenMatch[1])]);
                if (Number(updated.affectedRows) !== 1) return { status: 409, message: "No se pudo reabrir el PIAR." };
                return { changed: true, estado: "revision" };
            }
        });
        sendJson(response, result.status, result.status === 200 ? { ok: true, data: { version_id: result.versionId, unchanged: result.unchanged, estado: result.estado } } : { ok: false, message: result.message });
        return;
    }

    const versionMatch = url.pathname.match(/^\/api\/piar\/(\d+)\/versiones(?:\/(\d+))?$/);
    if (versionMatch && request.method === "GET") {
        const piarId = Number(versionMatch[1]);
        const versionId = versionMatch[2] ? Number(versionMatch[2]) : null;
        const teacherScope = teacher ? " AND EXISTS (SELECT 1 FROM piar_docente pd WHERE pd.id_piar = h.id_piar AND pd.id_docente = ?)" : "";
        const params = teacher ? [piarId, teacherProfile.id_docente] : [piarId];
        if (versionId === null) {
            const rows = await queryDb(`SELECT h.id_historial AS version_id, h.id_piar, h.id_usuario_creador AS id_usuario, u.nombre AS usuario, h.descripcion AS justificacion, h.created_at AS fecha, hd.id_detalle, hd.tipo_registro AS tipo_operacion FROM historial h INNER JOIN historial_detalle hd ON hd.id_historial = h.id_historial LEFT JOIN usuario u ON u.id_usuario = h.id_usuario_creador WHERE h.id_piar = ? AND h.tipo_registro = 'version' AND hd.tipo_registro LIKE 'piar_version%'${teacherScope} ORDER BY h.id_historial DESC`, params);
            sendJson(response, 200, { ok: true, data: rows });
            return;
        }
        const rows = await queryDb(`SELECT h.id_historial AS version_id, h.id_piar, h.id_usuario_creador AS id_usuario, u.nombre AS usuario, h.descripcion AS justificacion, h.created_at AS fecha, hd.tipo_registro AS tipo_operacion, hd.valor_anterior, hd.valor_nuevo FROM historial h INNER JOIN historial_detalle hd ON hd.id_historial = h.id_historial LEFT JOIN usuario u ON u.id_usuario = h.id_usuario_creador WHERE h.id_piar = ? AND h.id_historial = ? AND h.tipo_registro = 'version' AND hd.tipo_registro LIKE 'piar_version%'${teacher ? " AND EXISTS (SELECT 1 FROM piar_docente pd WHERE pd.id_piar = h.id_piar AND pd.id_docente = ?)" : ""} LIMIT 1`, teacher ? [piarId, versionId, teacherProfile.id_docente] : [piarId, versionId]);
        if (!rows.length) {
            sendJson(response, 404, { ok: false, message: "Versión no encontrada." });
            return;
        }
        const row = rows[0];
        for (const key of ["valor_anterior", "valor_nuevo"]) {
            if (typeof row[key] === "string") row[key] = JSON.parse(row[key]);
        }
        sendJson(response, 200, { ok: true, data: row });
        return;
    }

    const piarMatch = url.pathname.match(/^\/api\/piar\/(\d+)$/);
    if (piarMatch && sessionUser && request.method === "GET") {
        const piarId = Number(piarMatch[1]);
        const piars = await queryDb(`SELECT p.id_piar, p.id_estudiante, p.id_usuario_creador, p.titulo, p.periodo, p.anio, p.estado, p.objetivo_general, p.metas, p.caracterizacion, p.barreras, p.estrategias, p.informes_salud, p.proyectos, p.actividades_receso, p.otra_informacion, p.acta_acuerdos, p.informe_anual, p.entrega_pedagogica, p.fecha_creacion, p.fecha_revision, p.fecha_cierre, p.created_at, p.updated_at, e.nombre AS estudiante_nombre, e.documento AS estudiante_documento
            FROM piar p INNER JOIN estudiante e ON e.id_estudiante = p.id_estudiante
            WHERE p.id_piar = ? ${teacher ? "AND EXISTS (SELECT 1 FROM piar_docente pd WHERE pd.id_piar = p.id_piar AND pd.id_docente = ?)" : ""}`,
        teacher ? [piarId, teacherProfile.id_docente] : [piarId]);
        if (!piars.length) {
            sendJson(response, 404, { ok: false, message: "PIAR no encontrado" });
            return;
        }
        const [docentes, ajustes, barreras, evidencias, diagnosticos, seguimientos, observaciones, dua] = await Promise.all([
            queryDb("SELECT d.id_docente, d.nombre, d.area, pd.es_responsable_principal FROM piar_docente pd INNER JOIN docente d ON d.id_docente = pd.id_docente WHERE pd.id_piar = ? ORDER BY d.id_docente", [piarId]),
            queryDb("SELECT a.id_ajuste, a.id_piar, a.id_barrera, a.id_usuario_responsable, u.nombre AS responsable_usuario_nombre, a.area, a.tipo, a.estrategia, a.recursos, a.responsable, a.resultado_esperado, a.indicador_logro, a.fecha_revision_prevista, a.avance, a.estado, a.created_at, a.updated_at FROM piar_ajuste a LEFT JOIN usuario u ON u.id_usuario = a.id_usuario_responsable WHERE a.id_piar = ? ORDER BY a.id_ajuste", [piarId]),
            queryDb("SELECT b.id_barrera, b.contexto, b.descripcion, b.actividad, b.condicion_entorno, b.fecha_identificacion, b.id_usuario_registro, u.nombre AS autor_nombre, b.created_at FROM piar_barrera b INNER JOIN usuario u ON u.id_usuario = b.id_usuario_registro WHERE b.id_piar = ? ORDER BY b.fecha_identificacion, b.id_barrera", [piarId]),
            queryDb("SELECT e.id_evidencia, a.id_piar, e.id_ajuste, e.descripcion, e.referencia, e.fecha, e.id_usuario_autor, u.nombre AS autor_nombre, e.created_at FROM piar_ajuste_evidencia e INNER JOIN piar_ajuste a ON a.id_ajuste = e.id_ajuste INNER JOIN usuario u ON u.id_usuario = e.id_usuario_autor WHERE a.id_piar = ? ORDER BY e.fecha, e.id_evidencia", [piarId]),
            queryDb("SELECT id_diagnostico, tipo_diagnostico, fecha, descripcion, id_estudiante, id_psicologa, id_piar, created_at, updated_at FROM diagnostico WHERE id_piar = ? ORDER BY id_diagnostico", [piarId]),
            queryDb("SELECT s.id_seguimiento, s.fecha, s.descripcion, s.responsable, s.id_estudiante, s.id_coordinador, s.id_piar, s.id_ajuste, s.id_usuario_responsable, u.nombre AS responsable_usuario_nombre, s.estado, s.acuerdos, s.evolucion, s.created_at, s.updated_at FROM seguimiento s LEFT JOIN usuario u ON u.id_usuario = s.id_usuario_responsable WHERE s.id_piar = ? ORDER BY s.fecha, s.id_seguimiento", [piarId]),
            queryDb("SELECT id_observacion, fecha, descripcion, docente_responsable, id_estudiante, id_docente, id_piar, id_usuario_autor, tipo, avance, estado, acuerdos, created_at, updated_at FROM observacion WHERE id_piar = ? ORDER BY id_observacion", [piarId]),
            queryDb(DUA_SELECT + " WHERE d.id_piar = ? ORDER BY d.principio, d.id_dua", [piarId])
        ]);
        const ajustesConEvidencias = ajustes.map(ajuste => ({ ...ajuste, evidencias: evidencias.filter(evidencia => Number(evidencia.id_ajuste) === Number(ajuste.id_ajuste)) }));
        sendJson(response, 200, { ok: true, data: { ...piarRowToApi(piars[0]), estudiante: { id_estudiante: piars[0].id_estudiante, nombre: piars[0].estudiante_nombre, documento: piars[0].estudiante_documento }, docentes, teacherId: (docentes.find(docente => Number(docente.es_responsable_principal) === 1) || docentes[0])?.id_docente || null, dua, barreras, ajustes: ajustesConEvidencias, diagnosticos, seguimientos, observaciones } });
        return;
    }

    if (sessionUser && request.method === "POST" && url.pathname === "/api/piar") {
        const payload = await readJsonBody(request);
        if (payload.estado === "cerrado" && !["Administrador", "Rector", "Coordinador"].includes(role)) {
            sendJson(response, 403, { ok: false, message: "Solo Administrador, Rector o Coordinador pueden cerrar PIAR." });
            return;
        }
        if (!payload.id_estudiante || !payload.titulo || !payload.periodo || !payload.anio) {
            sendJson(response, 400, { ok: false, message: "Estudiante, título, periodo y año son obligatorios" });
            return;
        }
        const connection = await db.promise().getConnection();
        try {
            await connection.beginTransaction();
            const requestedTeacherId = payload.id_docente || payload.teacherId || null;
            if (teacher && requestedTeacherId !== null && Number(requestedTeacherId) !== Number(teacherProfile.id_docente)) {
                await connection.rollback();
                sendJson(response, 403, { ok: false, message: "No tiene permisos para asignar docentes." });
                return;
            }
            const teacherId = teacher ? teacherProfile.id_docente : requestedTeacherId;
            if (!teacher && teacherId !== null && !["Administrador", "Rector", "Coordinador"].includes(role)) {
                await connection.rollback();
                sendJson(response, 403, { ok: false, message: "No tiene permisos para asignar docentes." });
                return;
            }
            if (teacher) {
                const [existingAssignment] = await connection.query("SELECT 1 FROM piar p INNER JOIN piar_docente pd ON pd.id_piar = p.id_piar WHERE p.id_estudiante = ? AND pd.id_docente = ? LIMIT 1", [payload.id_estudiante, teacherProfile.id_docente]);
                if (!existingAssignment.length) {
                    await connection.rollback();
                    sendJson(response, 404, { ok: false, message: "Registro no encontrado." });
                    return;
                }
            }
            const [students] = await connection.query("SELECT id_estudiante FROM estudiante WHERE id_estudiante = ?", [payload.id_estudiante]);
            if (!students.length) {
                await connection.rollback();
                sendJson(response, 400, { ok: false, message: "El estudiante no existe" });
                return;
            }
            if (teacherId !== null) {
                const [teachers] = await connection.query("SELECT id_docente FROM docente WHERE id_docente = ? AND estado = 'activo'", [teacherId]);
                if (!teachers.length) {
                    await connection.rollback();
                    sendJson(response, 400, { ok: false, message: "El docente no existe o está inactivo" });
                    return;
                }
            }
            const [result] = await connection.query("INSERT INTO piar (id_estudiante, id_usuario_creador, titulo, periodo, anio, estado, objetivo_general, metas, caracterizacion, barreras, estrategias, informes_salud, proyectos, actividades_receso, otra_informacion, acta_acuerdos, informe_anual, entrega_pedagogica, fecha_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [payload.id_estudiante, sessionUser.id, payload.titulo, payload.periodo, payload.anio, payload.estado || "draft", payload.objetivo_general || null, payload.metas || null, payload.caracterizacion || null, payload.barreras || null, payload.estrategias || null, payload.informes_salud || null, payload.proyectos || null, payload.actividades_receso || null, payload.otra_informacion || null, payload.acta_acuerdos || null, payload.informe_anual || null, payload.entrega_pedagogica || null, payload.fecha_revision || null]);
            const piarId = result.insertId;
            if (teacherId !== null) {
                const [assignmentResult] = await connection.query("INSERT INTO piar_docente (id_piar, id_docente, es_responsable_principal) VALUES (?, ?, ?)", [piarId, teacherId, payload.es_responsable_principal !== false]);
                if (assignmentResult.affectedRows !== 1) throw new Error("No se pudo crear la asignación inicial del docente");
            }
            const adjustment = payload.ajuste || payload.ajuste_inicial;
            if (adjustment) {
                const avance = Number(adjustment.avance ?? 0);
                if (avance < 0 || avance > 100 || !adjustment.area || !adjustment.tipo || !adjustment.estrategia
                    || (!adjustment.resultado_esperado && !adjustment.indicador_logro) || !validDate(adjustment.fecha_revision_prevista)) {
                    await connection.rollback();
                    sendJson(response, 400, { ok: false, message: "El ajuste inicial requiere área, estrategia, resultado o indicador y fecha prevista de revisión." });
                    return;
                }
                await connection.query("INSERT INTO piar_ajuste (id_piar, id_usuario_responsable, area, tipo, estrategia, recursos, responsable, resultado_esperado, indicador_logro, fecha_revision_prevista, avance, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [piarId, sessionUser.id, adjustment.area, adjustment.tipo, adjustment.estrategia, adjustment.recursos || null, adjustment.responsable || sessionUser.nombre, adjustment.resultado_esperado || null, adjustment.indicador_logro || null, adjustment.fecha_revision_prevista || null, avance, adjustment.estado || "activo"]);
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
        const payload = await readJsonBody(request);
        const justification = normalizeJustification(payload.justificacion);
        if (!justification) {
            sendJson(response, 400, { ok: false, message: "La justificación es obligatoria y no puede superar 1000 caracteres." });
            return;
        }
        if (request.method === "DELETE") {
            const result = await runVersionedPiarMutation(db, {
                piarId, userId: sessionUser.id, justification, operation: "cierre",
                mutate: async (connection, before) => {
                    if (before.piar.estado === "cerrado") return { changed: false, estado: "cerrado" };
                    const [updated] = await connection.query("UPDATE piar SET estado = 'cerrado', fecha_cierre = CURRENT_TIMESTAMP WHERE id_piar = ? AND estado <> 'cerrado'", [piarId]);
                    return Number(updated.affectedRows) === 1 ? { changed: true, estado: "cerrado" } : { status: 409, message: "No se pudo cerrar el PIAR." };
                }
            });
            sendJson(response, result.status, result.status === 200 ? { ok: true, data: { version_id: result.versionId, unchanged: result.unchanged, estado: result.estado } } : { ok: false, message: result.message });
            return;
        }
        if (payload.estado !== undefined && !["Administrador", "Rector", "Coordinador"].includes(role)) {
            sendJson(response, 403, { ok: false, message: "No tiene permisos para cerrar o cambiar el estado del PIAR." });
            return;
        }
        // Solo cambian los campos enviados; un campo opcional vacío se guarda vacío (NULL).
        const piarUpdate = buildPartialUpdate(payload, {
            required: ["titulo", "periodo", "anio", "estado"],
            optional: ["objetivo_general", "metas", "caracterizacion", "barreras", "estrategias", "informes_salud", "proyectos", "actividades_receso", "otra_informacion", "acta_acuerdos", "informe_anual", "entrega_pedagogica", "fecha_revision"],
            labels: { titulo: "El título", periodo: "El periodo", anio: "El año", estado: "El estado" }
        });
        if (piarUpdate.error) { sendJson(response, 400, { ok: false, message: piarUpdate.error }); return; }
        const revisionIndex = piarUpdate.columns.indexOf("fecha_revision");
        if (revisionIndex >= 0 && piarUpdate.values[revisionIndex] !== null && !validDate(piarUpdate.values[revisionIndex])) {
            sendJson(response, 400, { ok: false, message: "La fecha de revisión debe tener el formato AAAA-MM-DD." });
            return;
        }
        const result = await runVersionedPiarMutation(db, {
            piarId, userId: sessionUser.id, justification, teacherId: teacher ? teacherProfile.id_docente : undefined, operation: "actualizacion_piar",
            mutate: async (connection, before) => {
                if (before.piar.estado === "cerrado") return { status: 409, message: "El PIAR está cerrado; únicamente Coordinación puede reabrirlo." };
                if (!piarUpdate.columns.length) return { changed: false };
                const closing = piarUpdate.columns.includes("estado") && piarUpdate.values[piarUpdate.columns.indexOf("estado")] === "cerrado";
                const [updated] = await connection.query(
                    `UPDATE piar SET ${assignmentSql(piarUpdate.columns)}${closing ? ", fecha_cierre = COALESCE(fecha_cierre, CURRENT_TIMESTAMP)" : ""} WHERE id_piar = ?`,
                    [...piarUpdate.values, piarId]
                );
                return Number(updated.affectedRows) > 0 ? {} : { changed: false };
            }
        });
        sendJson(response, result.status, result.status === 200 ? { ok: true, data: { version_id: result.versionId, unchanged: result.unchanged } } : { ok: false, message: result.message });
        return;
    }

    const nestedPiarMatch = url.pathname.match(/^\/api\/piar\/(\d+)\/(docentes|ajustes)$/);
    if (nestedPiarMatch && sessionUser) {
        const piarId = Number(nestedPiarMatch[1]);
        const resource = nestedPiarMatch[2];
        if (resource === "docentes" && request.method === "GET") {
            const rows = await queryDb("SELECT d.id_docente, d.nombre, d.area, d.correo, d.cargo, d.estado, pd.es_responsable_principal FROM piar_docente pd INNER JOIN docente d ON d.id_docente = pd.id_docente WHERE pd.id_piar = ?", [piarId]);
            sendJson(response, 200, { ok: true, data: rows });
            return;
        }
        if (resource === "docentes" && request.method === "POST") {
            const payload = await readJsonBody(request);
            const teacherId = Number(payload.id_docente);
            if (!Number.isSafeInteger(teacherId) || teacherId <= 0) {
                sendJson(response, 400, { ok: false, message: "El identificador del docente no es válido." }); return;
            }
            const result = await runVersionedPiarMutation(db, {
                piarId, userId: sessionUser.id, justification: payload.justificacion, requireJustification: false, operation: "docente_asignado",
                mutate: async connection => {
                    const [teachers] = await connection.query("SELECT id_docente FROM docente WHERE id_docente = ? AND estado = 'activo'", [teacherId]);
                    if (!teachers.length) return { status: 404, message: "El perfil docente no existe o está inactivo." };
                    const [duplicates] = await connection.query("SELECT 1 FROM piar_docente WHERE id_piar = ? AND id_docente = ?", [piarId, teacherId]);
                    if (duplicates.length) return { status: 409, message: "El docente ya está asignado a este PIAR." };
                    const [insertResult] = await connection.query("INSERT INTO piar_docente (id_piar, id_docente, es_responsable_principal) VALUES (?, ?, ?)", [piarId, teacherId, Boolean(payload.es_responsable_principal)]);
                    if (Number(insertResult.affectedRows) !== 1) return { status: 409, message: "No se pudo crear la asignación de docente." };
                    return { changed: true, id_docente: teacherId };
                }
            });
            sendJson(response, result.status === 200 ? 201 : result.status, result.status === 200 ? { ok: true, data: { version_id: result.versionId } } : { ok: false, message: result.message });
            return;
        }
        if (resource === "docentes" && request.method === "DELETE") {
            const payload = await readJsonBody(request);
            const teacherId = Number(payload.id_docente);
            if (!Number.isSafeInteger(teacherId) || teacherId <= 0) { sendJson(response, 400, { ok: false, message: "El identificador del docente no es válido." }); return; }
            const result = await runVersionedPiarMutation(db, {
                piarId, userId: sessionUser.id, justification: payload.justificacion, requireJustification: false, operation: "docente_retirado",
                mutate: async connection => {
                    const [deleted] = await connection.query("DELETE FROM piar_docente WHERE id_piar = ? AND id_docente = ?", [piarId, teacherId]);
                    return Number(deleted.affectedRows) === 1 ? { changed: true } : { status: 404, message: "La asignación no existe." };
                }
            });
            sendJson(response, result.status, result.status === 200 ? { ok: true, message: "Docente retirado del PIAR.", data: { version_id: result.versionId } } : { ok: false, message: result.message });
            return;
        }
        if (resource === "ajustes" && request.method === "GET") {
            const rows = await queryDb("SELECT a.id_ajuste, a.id_piar, a.id_barrera, a.id_usuario_responsable, u.nombre AS responsable_usuario_nombre, a.area, a.tipo, a.estrategia, a.recursos, a.responsable, a.resultado_esperado, a.indicador_logro, a.fecha_revision_prevista, a.avance, a.estado, a.created_at, a.updated_at FROM piar_ajuste a LEFT JOIN usuario u ON u.id_usuario = a.id_usuario_responsable WHERE a.id_piar = ? ORDER BY a.id_ajuste", [piarId]);
            sendJson(response, 200, { ok: true, data: rows });
            return;
        }
        if (resource === "ajustes" && request.method === "POST") {
            const payload = await readJsonBody(request);
            const trace = validateAdjustmentTracePayload(payload);
            if (!trace || !payload.area || !payload.tipo || typeof payload.estrategia !== "string" || !payload.estrategia.trim()) {
                sendJson(response, 400, { ok: false, message: "Los datos del ajuste no son válidos." });
                return;
            }
            if ((!trace.resultado_esperado && !trace.indicador_logro) || !trace.fecha_revision_prevista) {
                sendJson(response, 400, { ok: false, message: "El ajuste requiere un resultado esperado o indicador y una fecha prevista de revisión." });
                return;
            }
            const responsibleUserId = trace.id_usuario_responsable || Number(sessionUser.id);
            const avance = Number(payload.avance || 0);
            if (avance < 0 || avance > 100) {
                sendJson(response, 400, { ok: false, message: "El avance debe estar entre 0 y 100" });
                return;
            }
            const result = await runVersionedPiarMutation(db, {
                piarId, userId: sessionUser.id, justification: payload.justificacion, requireJustification: false, operation: "ajuste_creado", rejectClosed: true,
                mutate: async connection => {
                    if (trace.id_barrera !== null) {
                        const [barriers] = await connection.query("SELECT id_barrera FROM piar_barrera WHERE id_piar = ? AND id_barrera = ?", [piarId, trace.id_barrera]);
                        if (!barriers.length) return { status: 400, message: "La barrera debe pertenecer al mismo PIAR." };
                    }
                    const queryRows = async (sql, params) => (await connection.query(sql, params))[0];
                    if (!await canBePiarResponsible(queryRows, responsibleUserId, piarId)) return { status: 400, message: "El responsable debe ser un usuario activo y autorizado para este PIAR." };
                    const [inserted] = await connection.query("INSERT INTO piar_ajuste (id_piar, id_barrera, id_usuario_responsable, area, tipo, estrategia, recursos, responsable, resultado_esperado, indicador_logro, fecha_revision_prevista, avance, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [piarId, trace.id_barrera, responsibleUserId, payload.area.trim(), payload.tipo.trim(), payload.estrategia.trim(), payload.recursos || null, payload.responsable || sessionUser.nombre, trace.resultado_esperado, trace.indicador_logro, trace.fecha_revision_prevista, avance, payload.estado || "activo"]);
                    return { changed: Number(inserted.affectedRows) === 1, id_ajuste: inserted.insertId };
                }
            });
            sendJson(response, result.status === 200 ? 201 : result.status, result.status === 200 ? { ok: true, data: { id_ajuste: result.id_ajuste, version_id: result.versionId } } : { ok: false, message: result.message });
            return;
        }
    }

    const duaMatch = path.match(/^\/api\/piar\/(\d+)\/dua(?:\/(\d+))?$/);
    if (duaMatch && sessionUser) {
        const planId = Number(duaMatch[1]);
        const duaId = duaMatch[2] ? Number(duaMatch[2]) : null;
        if (method === "GET" && !duaId) {
            const rows = await queryDb(DUA_SELECT + " WHERE d.id_piar = ? ORDER BY d.principio, d.id_dua", [planId]);
            sendJson(response, 200, { ok: true, data: rows });
            return;
        }
        if ((method === "POST" && !duaId) || (method === "PUT" && duaId)) {
            const body = await readJsonBody(request);
            const payload = validateDuaPayload(body);
            if (!payload) { sendJson(response, 400, { ok: false, message: "Los datos de la estrategia DUA no son válidos." }); return; }
            const result = await runVersionedPiarMutation(db, {
                piarId: planId, userId: sessionUser.id, justification: body.justificacion, requireJustification: false,
                teacherId: teacher ? teacherProfile.id_docente : undefined, operation: duaId ? "dua_actualizado" : "dua_creado",
                mutate: async (connection, before) => {
                    if (before.piar.estado === "cerrado") return { status: 409, message: "El PIAR está cerrado; únicamente Coordinación puede reabrirlo." };
                    if (duaId) {
                        const [updated] = await connection.query("UPDATE piar_dua SET principio = ?, area = ?, estrategia = ?, recursos = ? WHERE id_dua = ? AND id_piar = ?",
                            [payload.principio, payload.area, payload.estrategia, payload.recursos, duaId, planId]);
                        return Number(updated.affectedRows) === 1 ? { changed: true, id_dua: duaId } : { status: 404, message: "La estrategia DUA no existe en este PIAR." };
                    }
                    const [inserted] = await connection.query("INSERT INTO piar_dua (id_piar, principio, area, estrategia, recursos, id_usuario_registro) VALUES (?, ?, ?, ?, ?, ?)",
                        [planId, payload.principio, payload.area, payload.estrategia, payload.recursos, sessionUser.id]);
                    return { changed: Number(inserted.affectedRows) === 1, id_dua: inserted.insertId };
                }
            });
            const ok = result.status === 200;
            sendJson(response, ok ? (duaId ? 200 : 201) : result.status, ok ? { ok: true, data: { id_dua: result.id_dua, version_id: result.versionId } } : { ok: false, message: result.message });
            return;
        }
    }

    const barrierCollectionMatch = path.match(/^\/api\/piar\/(\d+)\/barreras$/);
    if (barrierCollectionMatch && sessionUser) {
        const planId = Number(barrierCollectionMatch[1]);
        if (method === "GET") {
            const rows = await queryDb("SELECT id_barrera, id_piar, contexto, descripcion, actividad, condicion_entorno, fecha_identificacion, id_usuario_registro, created_at FROM piar_barrera WHERE id_piar = ? ORDER BY fecha_identificacion, id_barrera", [planId]);
            sendJson(response, 200, { ok: true, data: rows });
            return;
        }
        if (method === "POST") {
            const payload = validateBarrierPayload(await readJsonBody(request));
            if (!payload) { sendJson(response, 400, { ok: false, message: "Los datos de la barrera no son válidos." }); return; }
            const result = await runVersionedPiarMutation(db, {
                piarId: planId, userId: sessionUser.id, justification: payload.justificacion, requireJustification: false, operation: "barrera_creada", rejectClosed: true,
                mutate: async connection => {
                    const [inserted] = await connection.query("INSERT INTO piar_barrera (id_piar, contexto, descripcion, actividad, condicion_entorno, fecha_identificacion, id_usuario_registro) VALUES (?, ?, ?, ?, ?, ?, ?)", [planId, payload.contexto, payload.descripcion, payload.actividad, payload.condicion_entorno, payload.fecha_identificacion, sessionUser.id]);
                    return { changed: Number(inserted.affectedRows) === 1, id_barrera: inserted.insertId };
                }
            });
            sendJson(response, result.status === 200 ? 201 : result.status, result.status === 200 ? { ok: true, data: { id_barrera: result.id_barrera, version_id: result.versionId } } : { ok: false, message: result.message });
            return;
        }
    }

    const evidenceCollectionMatch = path.match(/^\/api\/piar\/(\d+)\/ajustes\/(\d+)\/evidencias$/);
    if (evidenceCollectionMatch && sessionUser) {
        const planId = Number(evidenceCollectionMatch[1]);
        const adjustmentId = Number(evidenceCollectionMatch[2]);
        if (method === "GET") {
            const rows = await queryDb("SELECT e.id_evidencia, e.id_ajuste, e.descripcion, e.referencia, e.fecha, e.id_usuario_autor, u.nombre AS autor_nombre, e.created_at FROM piar_ajuste_evidencia e INNER JOIN piar_ajuste a ON a.id_ajuste = e.id_ajuste INNER JOIN usuario u ON u.id_usuario = e.id_usuario_autor WHERE a.id_piar = ? AND a.id_ajuste = ? ORDER BY e.fecha, e.id_evidencia", [planId, adjustmentId]);
            sendJson(response, 200, { ok: true, data: rows });
            return;
        }
        if (method === "POST") {
            const payload = validateEvidencePayload(await readJsonBody(request));
            if (!payload) { sendJson(response, 400, { ok: false, message: "Los datos de la evidencia no son válidos." }); return; }
            const result = await runVersionedPiarMutation(db, {
                piarId: planId, userId: sessionUser.id, justification: payload.justificacion, requireJustification: false, operation: "evidencia_creada", rejectClosed: true,
                mutate: async connection => {
                    const [adjustments] = await connection.query("SELECT id_ajuste FROM piar_ajuste WHERE id_piar = ? AND id_ajuste = ? FOR UPDATE", [planId, adjustmentId]);
                    if (!adjustments.length) return { status: 404, message: "Ajuste no encontrado." };
                    const [inserted] = await connection.query("INSERT INTO piar_ajuste_evidencia (id_ajuste, descripcion, referencia, fecha, id_usuario_autor) VALUES (?, ?, ?, ?, ?)", [adjustmentId, payload.descripcion, payload.referencia, payload.fecha, sessionUser.id]);
                    return { changed: Number(inserted.affectedRows) === 1, id_evidencia: inserted.insertId };
                }
            });
            sendJson(response, result.status === 200 ? 201 : result.status, result.status === 200 ? { ok: true, data: { id_evidencia: result.id_evidencia, version_id: result.versionId } } : { ok: false, message: result.message });
            return;
        }
    }

    const adjustmentMatch = url.pathname.match(/^\/api\/piar\/(\d+)\/ajustes\/(\d+)$/);
    if (adjustmentMatch && sessionUser && ["PUT", "DELETE"].includes(request.method)) {
        const piarId = Number(adjustmentMatch[1]);
        const adjustmentId = Number(adjustmentMatch[2]);
        if (request.method === "DELETE") {
            const result = await runVersionedPiarMutation(db, {
                piarId, userId: sessionUser.id, requireJustification: false, operation: "ajuste_eliminado", rejectClosed: true,
                mutate: async connection => {
                    const [adjustmentRows] = await connection.query("SELECT id_ajuste FROM piar_ajuste WHERE id_ajuste = ? AND id_piar = ? FOR UPDATE", [adjustmentId, piarId]);
                    if (!adjustmentRows.length) return { status: 404, message: "Ajuste no encontrado." };
                    const [linkedTrace] = await connection.query("SELECT (SELECT COUNT(*) FROM piar_ajuste_evidencia WHERE id_ajuste = ?) AS evidencias, (SELECT COUNT(*) FROM seguimiento WHERE id_ajuste = ?) AS seguimientos", [adjustmentId, adjustmentId]);
                    if (Number(linkedTrace[0]?.evidencias || 0) > 0 || Number(linkedTrace[0]?.seguimientos || 0) > 0) return { status: 409, message: "No se puede eliminar un ajuste con evidencias o seguimientos vinculados." };
                    const [deleted] = await connection.query("DELETE FROM piar_ajuste WHERE id_ajuste = ? AND id_piar = ?", [adjustmentId, piarId]);
                    return Number(deleted.affectedRows) === 1 ? { changed: true } : { status: 404, message: "Ajuste no encontrado." };
                }
            });
            sendJson(response, result.status, result.status === 200 ? { ok: true, message: "Ajuste eliminado.", data: { version_id: result.versionId } } : { ok: false, message: result.message });
            return;
        }
        const payload = await readJsonBody(request);
        const trace = validateAdjustmentTracePayload(payload);
        if (!trace) { sendJson(response, 400, { ok: false, message: "Los datos de trazabilidad del ajuste no son válidos." }); return; }
        const avance = payload.avance === undefined ? null : Number(payload.avance);
        if (avance !== null && (avance < 0 || avance > 100)) {
            sendJson(response, 400, { ok: false, message: "El avance debe estar entre 0 y 100" });
            return;
        }
        const result = await runVersionedPiarMutation(db, {
            piarId, userId: sessionUser.id, justification: payload.justificacion, requireJustification: false, operation: "ajuste_actualizado", rejectClosed: true,
            mutate: async connection => {
                const [adjustmentRows] = await connection.query("SELECT id_ajuste FROM piar_ajuste WHERE id_ajuste = ? AND id_piar = ? FOR UPDATE", [adjustmentId, piarId]);
                if (!adjustmentRows.length) return { status: 404, message: "Ajuste no encontrado." };
                const [linkedTrace] = await connection.query("SELECT (SELECT COUNT(*) FROM piar_ajuste_evidencia WHERE id_ajuste = ?) AS evidencias, (SELECT COUNT(*) FROM seguimiento WHERE id_ajuste = ?) AS seguimientos", [adjustmentId, adjustmentId]);
                if (Number(linkedTrace[0]?.evidencias || 0) > 0 || Number(linkedTrace[0]?.seguimientos || 0) > 0) return { status: 409, message: "Este ajuste ya tiene evidencias o seguimientos. Registra la evolución con un nuevo ajuste para conservar la trazabilidad." };
                if (trace.id_barrera !== null) {
                    const [barriers] = await connection.query("SELECT id_barrera FROM piar_barrera WHERE id_piar = ? AND id_barrera = ?", [piarId, trace.id_barrera]);
                    if (!barriers.length) return { status: 400, message: "La barrera debe pertenecer al mismo PIAR." };
                }
                if (trace.id_usuario_responsable !== null) {
                    const queryRows = async (sql, params) => (await connection.query(sql, params))[0];
                    if (!await canBePiarResponsible(queryRows, trace.id_usuario_responsable, piarId)) return { status: 400, message: "El responsable debe ser un usuario activo y autorizado para este PIAR." };
                }
                const [updated] = await connection.query("UPDATE piar_ajuste SET area = COALESCE(?, area), tipo = COALESCE(?, tipo), estrategia = COALESCE(?, estrategia), recursos = COALESCE(?, recursos), responsable = COALESCE(?, responsable), id_barrera = COALESCE(?, id_barrera), id_usuario_responsable = COALESCE(?, id_usuario_responsable), resultado_esperado = COALESCE(?, resultado_esperado), indicador_logro = COALESCE(?, indicador_logro), fecha_revision_prevista = COALESCE(?, fecha_revision_prevista), avance = COALESCE(?, avance), estado = COALESCE(?, estado) WHERE id_ajuste = ? AND id_piar = ?", [payload.area || null, payload.tipo || null, payload.estrategia || null, payload.recursos || null, payload.responsable || null, trace.id_barrera, trace.id_usuario_responsable, trace.resultado_esperado, trace.indicador_logro, trace.fecha_revision_prevista, avance, payload.estado || null, adjustmentId, piarId]);
                return Number(updated.affectedRows) > 0 ? {} : { changed: false };
            }
        });
        sendJson(response, result.status, result.status === 200 ? { ok: true, data: { version_id: result.versionId, unchanged: result.unchanged } } : { ok: false, message: result.message });
        return;
    }

    const resourceRoutes = {
        diagnosticos: {
            table: "diagnostico",
            select: "SELECT id_diagnostico, tipo_diagnostico, fecha, descripcion, id_estudiante, id_psicologa, id_piar, id_usuario_creador, created_at, updated_at FROM diagnostico ORDER BY id_diagnostico DESC",
            insert: "INSERT INTO diagnostico (tipo_diagnostico, fecha, descripcion, id_estudiante, id_psicologa, id_piar, id_usuario_creador) VALUES (?, ?, ?, ?, ?, ?, ?)",
            values: payload => [payload.tipo_diagnostico, payload.fecha || null, payload.descripcion || null, payload.id_estudiante || null, payload.id_psicologa || null, payload.id_piar || null, sessionUser?.id || null]
        },
        seguimientos: {
            table: "seguimiento",
            select: "SELECT id_seguimiento, fecha, descripcion, responsable, id_estudiante, id_coordinador, id_piar, id_ajuste, id_usuario_responsable, estado, acuerdos, evolucion, created_at, updated_at FROM seguimiento ORDER BY id_seguimiento DESC",
            insert: "INSERT INTO seguimiento (fecha, descripcion, responsable, id_estudiante, id_coordinador, id_piar, id_ajuste, id_usuario_responsable, estado, acuerdos, evolucion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            values: payload => [payload.fecha || null, payload.descripcion || null, payload.responsable || sessionUser?.nombre || null, payload.id_estudiante || null, payload.id_coordinador || null, payload.id_piar || null, payload.id_ajuste || null, sessionUser?.id || null, payload.estado || null, payload.acuerdos || null, payload.evolucion || null]
        },
        observaciones: {
            table: "observacion",
            select: "SELECT id_observacion, fecha, descripcion, docente_responsable, id_estudiante, id_docente, id_piar, id_usuario_autor, tipo, avance, estado, acuerdos, created_at, updated_at FROM observacion ORDER BY id_observacion DESC",
            insert: "INSERT INTO observacion (fecha, descripcion, docente_responsable, id_estudiante, id_docente, id_piar, id_usuario_autor, tipo, avance, estado, acuerdos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            values: payload => [payload.fecha || null, payload.descripcion || payload.nota || null, payload.docente_responsable || sessionUser?.nombre || null, payload.id_estudiante || null, payload.id_docente || null, payload.id_piar || null, sessionUser?.id || null, payload.tipo || null, payload.avance ?? null, payload.estado || null, payload.acuerdos || null]
        }
    };

    for (const [resource, definition] of Object.entries(resourceRoutes)) {
        if (sessionUser && request.method === "GET" && url.pathname === `/api/${resource}`) {
            const teacherSelect = {
                diagnosticos: "SELECT DISTINCT x.id_diagnostico, x.tipo_diagnostico, x.fecha, x.descripcion, x.id_estudiante, x.id_psicologa, x.id_piar, x.created_at, x.updated_at FROM diagnostico x INNER JOIN piar_docente pd ON pd.id_piar = x.id_piar WHERE pd.id_docente = ? ORDER BY x.id_diagnostico DESC",
                seguimientos: "SELECT DISTINCT x.id_seguimiento, x.fecha, x.descripcion, x.responsable, x.id_estudiante, x.id_coordinador, x.id_piar, x.id_ajuste, x.id_usuario_responsable, x.estado, x.acuerdos, x.evolucion, x.created_at, x.updated_at FROM seguimiento x INNER JOIN piar_docente pd ON pd.id_piar = x.id_piar WHERE pd.id_docente = ? ORDER BY x.id_seguimiento DESC",
                observaciones: "SELECT DISTINCT x.id_observacion, x.fecha, x.descripcion, x.docente_responsable, x.id_estudiante, x.id_docente, x.id_piar, x.id_usuario_autor, x.tipo, x.avance, x.estado, x.acuerdos, x.created_at, x.updated_at FROM observacion x INNER JOIN piar_docente pd ON pd.id_piar = x.id_piar WHERE pd.id_docente = ? ORDER BY x.id_observacion DESC"
            };
            sendJson(response, 200, { ok: true, data: teacher
                ? await queryDb(teacherSelect[resource], [teacherProfile.id_docente])
                : await queryDb(definition.select) });
            return;
        }

        if (sessionUser && request.method === "POST" && url.pathname === `/api/${resource}`) {
            const payload = await readJsonBody(request);
            if (resource === "seguimientos" && payload.id_ajuste !== undefined && payload.id_ajuste !== null && payload.id_ajuste !== "") {
                const planId = Number(payload.id_piar);
                const adjustmentId = Number(payload.id_ajuste);
                if (!Number.isSafeInteger(planId) || planId <= 0 || !Number.isSafeInteger(adjustmentId) || adjustmentId <= 0
                    || !validDate(payload.fecha) || typeof payload.descripcion !== "string" || !payload.descripcion.trim()) {
                    sendJson(response, 400, { ok: false, message: "El PIAR y el ajuste deben ser identificadores válidos." });
                    return;
                }
                const adjustments = await queryDb("SELECT a.id_ajuste, p.id_estudiante FROM piar_ajuste a INNER JOIN piar p ON p.id_piar = a.id_piar WHERE a.id_piar = ? AND a.id_ajuste = ?", [planId, adjustmentId]);
                if (!adjustments.length || (payload.id_estudiante && Number(payload.id_estudiante) !== Number(adjustments[0].id_estudiante))) {
                    sendJson(response, 400, { ok: false, message: "El ajuste debe pertenecer al mismo PIAR y estudiante del seguimiento." });
                    return;
                }
                payload.id_estudiante = adjustments[0].id_estudiante;
            }
            if (teacher) {
                const assigned = payload.id_piar ? await queryDb("SELECT p.id_estudiante FROM piar p INNER JOIN piar_docente pd ON pd.id_piar = p.id_piar WHERE p.id_piar = ? AND pd.id_docente = ? LIMIT 1", [Number(payload.id_piar), teacherProfile.id_docente]) : [];
                if (!assigned.length || (payload.id_estudiante && Number(payload.id_estudiante) !== Number(assigned[0].id_estudiante))) {
                    sendJson(response, 403, { ok: false, message: "El registro no está dentro de su alcance asignado." });
                    return;
                }
                payload.id_estudiante = assigned[0].id_estudiante;
                if (resource === "observaciones") {
                    payload.id_docente = teacherProfile.id_docente;
                    const profiles = await queryDb("SELECT nombre FROM docente WHERE id_docente = ?", [teacherProfile.id_docente]);
                    payload.docente_responsable = profiles[0].nombre;
                } else {
                    payload.responsable = sessionUser.nombre;
                    payload.id_coordinador = null;
                }
            }
            if (resource === "observaciones" || resource === "seguimientos") {
                const message = validateRecordPayload(resource, payload);
                if (message) {
                    sendJson(response, 400, { ok: false, message });
                    return;
                }
                if (!payload.id_piar && !(await queryDb("SELECT 1 FROM estudiante WHERE id_estudiante = ? LIMIT 1", [Number(payload.id_estudiante)])).length) {
                    sendJson(response, 400, { ok: false, message: "El estudiante indicado no existe." });
                    return;
                }
            }
            if (resource === "diagnosticos") {
                const validation = await validateDiagnosticPayload(payload);
                if (validation) {
                    sendJson(response, validation.status, { ok: false, message: validation.message });
                    return;
                }
            }
            const planId = payload.id_piar === undefined || payload.id_piar === null || payload.id_piar === "" ? null : Number(payload.id_piar);
            if (planId !== null) {
                const result = await runVersionedPiarMutation(db, {
                    piarId: planId, userId: sessionUser.id, justification: payload.justificacion, requireJustification: false,
                    teacherId: teacher ? teacherProfile.id_docente : undefined, operation: `${RESOURCE_EVENT_NAMES[resource]}_creado`, rejectClosed: true,
                    mutate: async (connection, before) => {
                        if (payload.id_estudiante && Number(payload.id_estudiante) !== Number(before.piar.id_estudiante)) return { status: 400, message: "El estudiante debe corresponder al PIAR indicado." };
                        if (resource === "diagnosticos" && Number(payload.id_estudiante) !== Number(before.piar.id_estudiante)) return { status: 400, message: "El diagnóstico debe corresponder al estudiante del PIAR indicado." };
                        if (resource === "seguimientos" && payload.id_ajuste) {
                            const [adjustments] = await connection.query("SELECT id_ajuste FROM piar_ajuste WHERE id_piar = ? AND id_ajuste = ? FOR UPDATE", [planId, Number(payload.id_ajuste)]);
                            if (!adjustments.length) return { status: 400, message: "El ajuste debe pertenecer al mismo PIAR y estudiante del seguimiento." };
                        }
                        const [inserted] = await connection.query(definition.insert, definition.values(payload));
                        return { changed: Number(inserted.affectedRows) === 1, id: inserted.insertId };
                    }
                });
                sendJson(response, result.status === 200 ? 201 : result.status, result.status === 200 ? { ok: true, data: { id: result.id, version_id: result.versionId } } : { ok: false, message: result.message });
                return;
            }
            const result = await queryDb(definition.insert, definition.values(payload));
            sendJson(response, 201, { ok: true, data: { id: result.insertId } });
            return;
        }

        const resourceMatch = url.pathname.match(new RegExp(`^/api/${resource}/(\\d+)$`));
        if (sessionUser && resourceMatch && request.method === "GET") {
            const idColumn = resource === "diagnosticos" ? "id_diagnostico" : resource === "seguimientos" ? "id_seguimiento" : "id_observacion";
            const rows = teacher
                ? await queryDb(`SELECT x.${idColumn}, x.fecha, x.descripcion, x.id_estudiante, x.id_piar FROM ${definition.table} x INNER JOIN piar_docente pd ON pd.id_piar = x.id_piar WHERE x.${idColumn} = ? AND pd.id_docente = ?`, [Number(resourceMatch[1]), teacherProfile.id_docente])
                : await queryDb(`SELECT ${idColumn}, fecha, descripcion, id_estudiante, id_piar FROM ${definition.table} WHERE ${idColumn} = ?`, [Number(resourceMatch[1])]);
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
            const result = await runVersionedPiarMutations(db, {
                userId: sessionUser.id, requireJustification: false, operation: `${RESOURCE_EVENT_NAMES[resource]}_eliminado`, rejectClosed: true,
                teacherId: teacher ? teacherProfile.id_docente : undefined,
                resolvePiarIds: async connection => {
                    const [rows] = await connection.query(`SELECT id_piar FROM ${definition.table} WHERE ${idColumn} = ? FOR UPDATE`, [id]);
                    return rows.length ? { piarIds: [rows[0].id_piar] } : { status: 404, message: "Registro no encontrado." };
                },
                mutate: async connection => {
                    const [deleted] = await connection.query(`DELETE FROM ${definition.table} WHERE ${idColumn} = ?`, [id]);
                    return Number(deleted.affectedRows) === 1 ? { changed: true } : { status: 404, message: "Registro no encontrado." };
                }
            });
            sendJson(response, result.status, result.status === 200 ? { ok: true, message: "Registro eliminado", data: { version_id: result.versionId } } : { ok: false, message: result.message });
            return;
        }

        const payload = await readJsonBody(request);
        // The authorization check is bound to the existing row. A teacher must
        // not be able to move that row to a different PIAR/student in the same
        // request after passing that check.
        if (teacher && ["id_estudiante", "id_piar"].some(field => Object.hasOwn(payload, field))) {
            sendJson(response, 403, { ok: false, message: "No tiene permisos para cambiar la relación del registro." });
            return;
        }
        const updateMaps = {
            diagnosticos: ["tipo_diagnostico", "fecha", "descripcion", "id_estudiante", "id_psicologa", "id_piar"],
            seguimientos: ["fecha", "descripcion", "responsable", "id_estudiante", "id_coordinador", "id_piar", "estado", "acuerdos", "evolucion"],
            observaciones: ["fecha", "descripcion", "docente_responsable", "id_estudiante", "id_docente", "id_piar", "tipo", "avance", "estado", "acuerdos"]
        };
        if (resource === "diagnosticos") {
            payload.id_diagnostico = id;
            const validation = await validateDiagnosticPayload(payload, true);
            if (validation) {
                sendJson(response, validation.status, { ok: false, message: validation.message });
                return;
            }
        }
        const fields = updateMaps[resource].filter(field => payload[field] !== undefined);
        if (!fields.length) {
            sendJson(response, 400, { ok: false, message: "No hay campos para actualizar" });
            return;
        }
        const values = fields.map(field => payload[field]);
        const assignments = fields.map(field => `${field} = ?`).join(", ");
        const result = await runVersionedPiarMutations(db, {
            userId: sessionUser.id, justification: payload.justificacion, requireJustification: false,
            operation: `${RESOURCE_EVENT_NAMES[resource]}_actualizado`, rejectClosed: true, teacherId: teacher ? teacherProfile.id_docente : undefined,
            resolvePiarIds: async connection => {
                const [currentRows] = await connection.query(`SELECT id_estudiante, id_piar FROM ${definition.table} WHERE ${idColumn} = ? FOR UPDATE`, [id]);
                if (!currentRows.length) return { status: 404, message: "Registro no encontrado." };
                const nextPiarId = Object.hasOwn(payload, "id_piar") ? payload.id_piar : currentRows[0].id_piar;
                const nextStudentId = Object.hasOwn(payload, "id_estudiante") ? payload.id_estudiante : currentRows[0].id_estudiante;
                if (nextPiarId !== null && nextPiarId !== undefined && nextPiarId !== "") {
                    const [piarRows] = await connection.query("SELECT id_estudiante FROM piar WHERE id_piar = ? FOR UPDATE", [Number(nextPiarId)]);
                    if (!piarRows.length || (nextStudentId !== null && nextStudentId !== undefined && Number(nextStudentId) !== Number(piarRows[0].id_estudiante))) {
                        return { status: 400, message: "La relación entre el registro, el PIAR y el estudiante no es válida." };
                    }
                }
                return { piarIds: [currentRows[0].id_piar, nextPiarId] };
            },
            mutate: async connection => {
                const [updated] = await connection.query(`UPDATE ${definition.table} SET ${assignments} WHERE ${idColumn} = ?`, [...values, id]);
                return Number(updated.affectedRows) > 0 ? {} : { changed: false };
            }
        });
        sendJson(response, result.status, result.status === 200 ? { ok: true, unchanged: result.unchanged, data: { version_ids: result.versionIds }, message: result.unchanged ? "El registro ya tenía esos valores." : "Registro actualizado" } : { ok: false, message: result.message });
        return;
    }

    if (sessionUser && request.method === "GET" && url.pathname === "/api/historial") {
        const rows = teacher
            ? await queryDb("SELECT DISTINCT h.id_historial, h.id_piar, h.id_usuario_creador, h.tipo_registro, h.id_referencia, h.created_at FROM historial h INNER JOIN piar_docente pd ON pd.id_piar = h.id_piar WHERE pd.id_docente = ? ORDER BY h.id_historial DESC", [teacherProfile.id_docente])
            : await queryDb("SELECT id_historial, id_piar, id_usuario_creador, tipo_registro, id_referencia, created_at FROM historial ORDER BY id_historial DESC");
        sendJson(response, 200, { ok: true, data: rows });
        return;
    }

    const historyMatch = url.pathname.match(/^\/api\/historial\/(\d+)$/);
    if (sessionUser && historyMatch && request.method === "GET") {
        const rows = await queryDb(`SELECT h.id_historial, h.id_piar, h.id_usuario_creador, h.tipo_registro, h.id_referencia, h.created_at, hd.id_detalle, hd.tipo_registro AS detalle_tipo, hd.id_referencia AS detalle_referencia, hd.id_usuario, hd.fecha_evento
            FROM historial h LEFT JOIN historial_detalle hd ON hd.id_historial = h.id_historial
            WHERE h.id_historial = ? ${teacher ? "AND EXISTS (SELECT 1 FROM piar_docente pd WHERE pd.id_piar = h.id_piar AND pd.id_docente = ?)" : ""} ORDER BY hd.fecha_evento`,
        teacher ? [Number(historyMatch[1]), teacherProfile.id_docente] : [Number(historyMatch[1])]);
        if (!rows.length) {
            sendJson(response, 404, { ok: false, message: "Historial no encontrado" });
            return;
        }
        sendJson(response, 200, { ok: true, data: rows });
        return;
    }

    if (sessionUser && url.pathname === "/api/reportes" && request.method === "POST") {
        if (!(await reportPersistenceAvailable(db))) {
            sendJson(response, 503, { ok: false, message: "La persistencia de informes requiere aplicar la migración 014." });
            return;
        }
        const reportRequest = validateReportRequest(await readJsonBody(request));
        if (!reportRequest) {
            sendJson(response, 400, { ok: false, message: "Tipo de informe, PIAR o periodo no válidos." });
            return;
        }
        const result = await createReport(db, { ...reportRequest, userId: sessionUser.id, teacherId: teacher ? teacherProfile.id_docente : undefined });
        sendJson(response, result.status, result.body);
        return;
    }

    if (sessionUser && request.method === "GET" && url.pathname === "/api/reportes") {
        const studentFilter = Number(url.searchParams.get("estudiante")) || null;
        const piarFilter = Number(url.searchParams.get("piar")) || null;
        const rows = await listReports(db, { teacherId: teacher ? teacherProfile.id_docente : undefined, studentId: studentFilter, piarId: piarFilter });
        sendJson(response, 200, { ok: true, data: rows });
        return;
    }

    const reportMatch = url.pathname.match(/^\/api\/reportes\/(\d+)$/);
    if (sessionUser && reportMatch && request.method === "GET") {
        const report = await getReport(db, { reportId: Number(reportMatch[1]), teacherId: teacher ? teacherProfile.id_docente : undefined });
        if (!report) {
            sendJson(response, 404, { ok: false, message: "Reporte no encontrado" });
            return;
        }
        sendJson(response, 200, { ok: true, data: report });
        return;
    }

    if (sessionUser && request.method === "GET" && url.pathname === "/api/dashboard/resumen") {
        const rows = teacher
            ? await queryDb(`SELECT
            (SELECT COUNT(DISTINCT p.id_estudiante) FROM piar p INNER JOIN piar_docente pd ON pd.id_piar = p.id_piar WHERE pd.id_docente = ?) AS estudiantes,
            (SELECT 1) AS docentes,
            (SELECT COUNT(DISTINCT p.id_piar) FROM piar p INNER JOIN piar_docente pd ON pd.id_piar = p.id_piar WHERE pd.id_docente = ? AND p.estado = 'activo') AS piar_activos,
            (SELECT COUNT(DISTINCT o.id_observacion) FROM observacion o INNER JOIN piar_docente pd ON pd.id_piar = o.id_piar WHERE pd.id_docente = ?) AS observaciones`, [teacherProfile.id_docente, teacherProfile.id_docente, teacherProfile.id_docente])
            : await queryDb(`SELECT
            (SELECT COUNT(*) FROM estudiante) AS estudiantes,
            (SELECT COUNT(*) FROM docente WHERE estado = 'activo') AS docentes,
            (SELECT COUNT(*) FROM piar WHERE estado = 'activo') AS piar_activos,
            (SELECT COUNT(*) FROM observacion) AS observaciones`);
        sendJson(response, 200, { ok: true, data: rows[0] });
        return;
    }

    if (request.method === "GET" && url.pathname === "/api/estudiantes") {
        const students = teacher
            ? await queryDb("SELECT DISTINCT e.id_estudiante, e.nombre, e.documento, e.edad, e.curso, e.condicion_especial, e.nombres, e.apellidos, e.fecha_nacimiento, e.jornada, e.estado, e.acudiente, e.telefono, e.contexto, e.valoracion, e.fortalezas, e.barreras, e.apoyos_requeridos, e.actividades_casa, e.created_at, e.updated_at FROM estudiante e INNER JOIN piar p ON p.id_estudiante = e.id_estudiante INNER JOIN piar_docente pd ON pd.id_piar = p.id_piar WHERE pd.id_docente = ? ORDER BY e.id_estudiante", [teacherProfile.id_docente])
            : await queryDb("SELECT id_estudiante, nombre, documento, edad, curso, condicion_especial, nombres, apellidos, fecha_nacimiento, jornada, estado, acudiente, telefono, contexto, valoracion, fortalezas, barreras, apoyos_requeridos, actividades_casa, created_at, updated_at FROM estudiante ORDER BY id_estudiante");
        // Solo el Administrador, que crea las cuentas Estudiante (D7), ve si ya existe una vinculada.
        const linkedStudents = role === "Administrador" ? await linkedStudentIds() : null;
        sendJson(response, 200, students.map(row => linkedStudents
            ? { ...mapStudentRowToFrontend(row), cuenta_vinculada: linkedStudents.has(Number(row.id_estudiante)) }
            : mapStudentRowToFrontend(row)));
        return;
    }

    const studentMatch = url.pathname.match(/^\/api\/estudiantes\/(\d+)$/);
    if (request.method === "GET" && studentMatch) {
        const students = await queryDb(`SELECT id_estudiante, nombre, documento, edad, curso, condicion_especial, nombres, apellidos, fecha_nacimiento, jornada, estado, acudiente, telefono, contexto, valoracion, fortalezas, barreras, apoyos_requeridos, actividades_casa, created_at, updated_at FROM estudiante WHERE id_estudiante = ? ${teacher ? "AND EXISTS (SELECT 1 FROM piar p INNER JOIN piar_docente pd ON pd.id_piar = p.id_piar WHERE p.id_estudiante = estudiante.id_estudiante AND pd.id_docente = ?)" : ""}`,
            teacher ? [Number(studentMatch[1]), teacherProfile.id_docente] : [Number(studentMatch[1])]);
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
    if (!String(payload.nombre || "").trim() || !String(payload.documento || "").trim()) {
        sendJson(response, 400, { ok: false, message: "El nombre y el documento del estudiante son obligatorios." });
        return;
    }

    db.query(
        "INSERT INTO estudiante (nombre, documento, edad, curso, condicion_especial, nombres, apellidos, fecha_nacimiento, jornada, estado, acudiente, telefono, contexto, valoracion, fortalezas, barreras, apoyos_requeridos, actividades_casa) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [payload.nombre, payload.documento, payload.edad, payload.curso, payload.condicion_especial, payload.nombres, payload.apellidos, payload.fecha_nacimiento, payload.jornada, payload.estado, payload.acudiente, payload.telefono, payload.contexto, payload.valoracion, JSON.stringify(payload.fortalezas), JSON.stringify(payload.barreras), JSON.stringify(payload.apoyos_requeridos), payload.actividades_casa],
        (err, result) => {
            if (err) {
                if (err.code === "ER_DUP_ENTRY") {
                    sendJson(response, 409, { ok: false, message: "Ya existe un estudiante con ese documento." });
                    return;
                }
                console.error("Error creando estudiante:", err.code || err.name || "ERROR");
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

async function startOidc(request, response, provider) {
    if (!(await oidcStartLimit.consume(clientIp(request))).allowed) return redirectAuthResult(response, "oidc-error");
    if (!oidcFlow.configuredProvider(provider)) return redirectAuthResult(response, "provider-unavailable");
    const authorization = await createOidcAuthorization(provider, null);
    response.writeHead(302, {
        Location: authorization.url.href,
        "Set-Cookie": authorization.cookie,
        ...securityHeaders()
    });
    response.end();
}

async function linkOidc(request, response, provider) {
    if (!(await oidcStartLimit.consume(clientIp(request))).allowed) {
        sendJson(response, 429, { ok: false, message: "Demasiados intentos. Espera antes de volver a vincular." });
        return;
    }
    const origin = request.headers.origin;
    let appOrigin;
    try { appOrigin = configuredAppOrigin(); } catch { appOrigin = ""; }
    if (!origin || origin !== appOrigin || request.headers["sec-fetch-site"] === "cross-site") {
        sendJson(response, 403, { ok: false, message: "Solicitud de vinculación no válida." });
        return;
    }
    const user = await auth.currentUser(db, request);
    if (!user || user.mustChangePassword) {
        sendJson(response, 401, { ok: false, message: "Inicia sesión para vincular una identidad." });
        return;
    }
    if (!oidcFlow.configuredProvider(provider)) {
        sendJson(response, 503, { ok: false, message: "Este proveedor no está configurado." });
        return;
    }
    // Decisión D5: la vinculación exige reautenticación con la contraseña local.
    const payload = await readJsonBody(request);
    if (!(await auth.verifyAccountPassword(db, user.id, payload?.password))) {
        await recordSecurityEvent({ type: "reautenticacion_fallida", outcome: "fallo", userId: user.id, ip: clientIp(request), detail: provider + ":vincular" });
        sendJson(response, 403, { ok: false, message: "La contraseña no es correcta." });
        return;
    }
    const authorization = await createOidcAuthorization(provider, user.id);
    sendJson(response, 200, { ok: true, url: authorization.url.href }, { "Set-Cookie": authorization.cookie });
}

async function createOidcAuthorization(provider, linkUserId) {
    const material = oidcFlow.createTransactionMaterial();
    const authorizationUrl = await oidcFlow.buildAuthorizationRequest({ provider, ...material });
    await queryDb(
        "INSERT INTO oidc_login_transaction (state_hash, provider, nonce, code_verifier, link_user_id, expires_at) VALUES (?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE))",
        [hashValue(material.state), provider, material.nonce, material.codeVerifier, linkUserId]
    );
    const cookieName = oidcCookieName(material.state);
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return { url: authorizationUrl, cookie: `${cookieName}=${material.state}; Max-Age=600; Path=/api/auth/oidc; HttpOnly; SameSite=Lax${secure}` };
}

async function completeOidc(request, response, requestUrl, provider) {
    const ip = clientIp(request);
    // Todo acceso externo queda en evento_seguridad; el detalle no incluye tokens ni identificadores del proveedor.
    const audit = (type, outcome, detail, userId = null, email = null) => recordSecurityEvent({ type, outcome, userId, email, ip, detail: `${provider}:${detail}` });
    const state = requestUrl.searchParams.get("state") || "";
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(state)) {
        await audit("oidc_fallido", "fallo", "estado_invalido");
        return redirectAuthResult(response, "oidc-error");
    }
    const cookieName = oidcCookieName(state);
    const cookieState = requestCookie(request, cookieName);
    const clearCookie = `${cookieName}=; Max-Age=0; Path=/api/auth/oidc; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
    if (!cookieState || !constantTimeEqual(cookieState, state)) {
        await audit("oidc_fallido", "fallo", "estado_no_coincide");
        return redirectAuthResult(response, "oidc-error", clearCookie);
    }

    const connection = await db.promise().getConnection();
    let transaction;
    try {
        await connection.beginTransaction();
        const [rows] = await connection.query(
            "SELECT provider, nonce, code_verifier, link_user_id FROM oidc_login_transaction WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP LIMIT 1 FOR UPDATE",
            [hashValue(state)]
        );
        if (!rows.length || rows[0].provider !== provider) {
            await connection.rollback();
            await audit("oidc_fallido", "fallo", "transaccion_invalida");
            return redirectAuthResult(response, "oidc-error", clearCookie);
        }
        const [claimed] = await connection.query("UPDATE oidc_login_transaction SET consumed_at = CURRENT_TIMESTAMP WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP", [hashValue(state)]);
        if (Number(claimed.affectedRows) !== 1) {
            await connection.rollback();
            await audit("oidc_fallido", "fallo", "transaccion_invalida");
            return redirectAuthResult(response, "oidc-error", clearCookie);
        }
        transaction = rows[0];
        await connection.commit();
    } catch {
        try { await connection.rollback(); } catch { /* keep provider response generic */ }
        await audit("oidc_fallido", "fallo", "transaccion_error");
        return redirectAuthResult(response, "oidc-error", clearCookie);
    } finally {
        connection.release();
    }

    try {
        const callbackUrl = new URL(oidcFlow.providerSettings(provider).redirectUri.href);
        for (const key of ["code", "state", "iss", "error"]) {
            for (const value of requestUrl.searchParams.getAll(key)) callbackUrl.searchParams.append(key, value);
        }
        const identity = await oidcFlow.completeAuthorization({
            provider, callbackUrl: callbackUrl.href, state, nonce: transaction.nonce, codeVerifier: transaction.code_verifier
        });

        if (transaction.link_user_id) {
            const current = await auth.currentUser(db, request);
            if (!current || Number(current.id) !== Number(transaction.link_user_id)) {
                await audit("oidc_fallido", "fallo", "vinculacion_sin_sesion", Number(transaction.link_user_id));
                return redirectAuthResult(response, "oidc-link-error", clearCookie);
            }
            // D5: solo se vincula una identidad verificada por el proveedor; nunca por coincidencia de correo.
            if (!identity.verifiedIdentity) {
                await audit("oidc_fallido", "fallo", "correo_no_verificado", current.id);
                return redirectAuthResult(response, "oidc-link-error", clearCookie);
            }
            try {
                await queryDb("INSERT INTO external_identity (id_usuario, issuer, subject, email, email_verified) VALUES (?, ?, ?, ?, ?)", [current.id, identity.issuer, identity.subject, identity.email || null, identity.emailVerified]);
            } catch (error) {
                await audit("oidc_fallido", "fallo", error.code === "ER_DUP_ENTRY" ? "identidad_ya_vinculada" : "vinculacion_error", current.id);
                return redirectAuthResult(response, "oidc-link-error", clearCookie);
            }
            await audit("oidc_vinculada", "exito", "vinculada", current.id, identity.email || null);
            return redirectAuthResult(response, "oidc-linked", clearCookie);
        }

        const linked = await queryDb(
            "SELECT u.id_usuario, u.nombre, u.documento, u.correo, u.rol, u.estado FROM external_identity e INNER JOIN usuario u ON u.id_usuario = e.id_usuario WHERE e.issuer = ? AND e.subject = ? LIMIT 1",
            [identity.issuer, identity.subject]
        );
        if (!linked.length || linked[0].estado !== "activo") {
            await audit("oidc_fallido", "fallo", linked.length ? "cuenta_no_activa" : "sin_vinculo", linked[0]?.id_usuario ?? null, identity.email || null);
            return redirectAuthResult(response, "oidc-link-required", clearCookie);
        }
        const session = await auth.createSession(db, linked[0].id_usuario);
        await queryDb("UPDATE usuario SET ultimo_acceso_at = CURRENT_TIMESTAMP WHERE id_usuario = ?", [linked[0].id_usuario]);
        await audit("oidc_login", "exito", "login", linked[0].id_usuario, identity.email || null);
        redirectAuthResult(response, "oidc-success", clearCookie, auth.sessionCookie(session.token, session.maxAgeSeconds));
    } catch {
        await audit("oidc_fallido", "fallo", "validacion_proveedor");
        return redirectAuthResult(response, "oidc-error", clearCookie);
    }
}

// Límite del formulario que Apple envía por POST (form_post).

function readFormBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";
        let size = 0;
        request.on("data", chunk => {
            size += chunk.length;
            if (size > 16 * 1024) { request.destroy(); reject(Object.assign(new Error("Cuerpo demasiado grande"), { statusCode: 413 })); return; }
            body += chunk;
        });
        request.on("end", () => resolve(new URLSearchParams(body)));
        request.on("error", reject);
    });
}

async function relayAppleFormPost(request, response) {
    let form;
    try { form = await readFormBody(request); } catch { return redirectAuthResult(response, "oidc-error"); }
    const target = new URLSearchParams();
    // Solo se reenvían los parámetros del protocolo con formato acotado; el resto
    // (por ejemplo «user», que Apple envía la primera vez) se descarta.
    const code = form.get("code") || "";
    const state = form.get("state") || "";
    const error = form.get("error") || "";
    if (code && /^[A-Za-z0-9._-]{1,512}$/.test(code)) target.set("code", code);
    if (/^[A-Za-z0-9_-]{40,60}$/.test(state)) target.set("state", state);
    if (error && /^[a-z_]{1,64}$/.test(error)) target.set("error", error);
    response.writeHead(303, { Location: "/api/auth/oidc/apple/callback?" + target.toString(), ...securityHeaders() });
    response.end();
}

function providerFromIssuer(issuer) {
    const value = String(issuer || "");
    if (value === "https://accounts.google.com") return "google";
    if (value === "https://appleid.apple.com") return "apple";
    if (value.startsWith("https://login.microsoftonline.com/")) return "microsoft";
    return "otro";
}

// Decisión D5: cada cuenta autenticada consulta y desvincula solo sus identidades.
// No expone el «subject» del proveedor ni datos de otras cuentas, y nunca concede roles.
async function handleExternalIdentities(request, response, url) {
    const user = await auth.currentUser(db, request);
    if (!user || user.mustChangePassword) {
        sendJson(response, 401, { ok: false, message: "Autenticación requerida." });
        return;
    }
    if (user.rol === "Estudiante") {
        sendJson(response, 403, { ok: false, message: "No autorizado" });
        return;
    }
    if (request.method === "GET" && url.pathname === "/api/auth/identities") {
        const rows = await queryDb("SELECT id_external_identity, issuer, email, email_verified, created_at FROM external_identity WHERE id_usuario = ? ORDER BY id_external_identity", [user.id]);
        sendJson(response, 200, { ok: true, data: rows.map(row => ({ id: row.id_external_identity, proveedor: providerFromIssuer(row.issuer), correo: row.email || "", correoVerificado: Boolean(row.email_verified), vinculadaEn: row.created_at })) });
        return;
    }
    const match = url.pathname.match(/^\/api\/auth\/identities\/(\d+)$/);
    if (request.method === "DELETE" && match) {
        if (!(await oidcStartLimit.consume(clientIp(request))).allowed) {
            sendJson(response, 429, { ok: false, message: "Demasiados intentos. Espera antes de volver a intentarlo." });
            return;
        }
        const payload = await readJsonBody(request);
        if (!(await auth.verifyAccountPassword(db, user.id, payload?.password))) {
            await recordSecurityEvent({ type: "reautenticacion_fallida", outcome: "fallo", userId: user.id, ip: clientIp(request), detail: "desvincular" });
            sendJson(response, 403, { ok: false, message: "La contraseña no es correcta." });
            return;
        }
        const identityId = Number(match[1]);
        const connection = await db.promise().getConnection();
        try {
            await connection.beginTransaction();
            const [owned] = await connection.query("SELECT id_external_identity, issuer FROM external_identity WHERE id_external_identity = ? AND id_usuario = ? FOR UPDATE", [identityId, user.id]);
            if (!owned.length) {
                await connection.rollback();
                sendJson(response, 404, { ok: false, message: "Identidad no encontrada." });
                return;
            }
            // Nunca se elimina el único método de acceso de la cuenta.
            const [[methods]] = await connection.query("SELECT (SELECT COUNT(*) FROM external_identity WHERE id_usuario = ?) AS identidades, (SELECT COUNT(*) FROM usuario WHERE id_usuario = ? AND password_hash IS NOT NULL AND password_hash <> '') AS local", [user.id, user.id]);
            if (!Number(methods.local) && Number(methods.identidades) <= 1) {
                await connection.rollback();
                sendJson(response, 409, { ok: false, message: "No puedes desvincular el único método de acceso de la cuenta." });
                return;
            }
            await connection.query("DELETE FROM external_identity WHERE id_external_identity = ? AND id_usuario = ?", [identityId, user.id]);
            await connection.commit();
            await recordSecurityEvent({ type: "oidc_desvinculada", outcome: "exito", userId: user.id, ip: clientIp(request), detail: providerFromIssuer(owned[0].issuer) + ":desvinculada" });
            sendJson(response, 200, { ok: true, message: "Identidad desvinculada." });
        } catch (error) {
            try { await connection.rollback(); } catch { /* conserva el error original */ }
            throw error;
        } finally {
            connection.release();
        }
        return;
    }
    sendJson(response, 405, { ok: false, message: "Método no permitido" });
}

function configuredAppOrigin() {
    const base = new URL(String(process.env.APP_BASE_URL || ""));
    if (base.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(base.hostname))) throw new Error("APP_BASE_URL must use HTTPS.");
    return base.origin;
}

function oidcCookieName(state) {
    return `piar_oidc_${state}`;
}

function requestCookie(request, name) {
    for (const item of String(request.headers.cookie || "").split(";")) {
        const index = item.indexOf("=");
        if (index > 0 && item.slice(0, index).trim() === name) {
            try { return decodeURIComponent(item.slice(index + 1).trim()); } catch { return ""; }
        }
    }
    return "";
}

function hashValue(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function constantTimeEqual(left, right) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function redirectAuthResult(response, status, clearCookie, sessionCookie) {
    let location;
    try {
        const base = configuredAppOrigin();
        const result = new URL("/", base);
        result.searchParams.set("auth", status);
        location = result.href;
    } catch {
        location = "/";
    }
    const cookies = [clearCookie, sessionCookie].filter(Boolean);
    response.writeHead(303, { Location: location, ...(cookies.length ? { "Set-Cookie": cookies } : {}), ...securityHeaders() });
    response.end();
}


   if (request.method === "PUT" && url.pathname.startsWith("/api/estudiantes/")) {

    if (!sessionUser) {
        sendJson(response, 401, { ok: false, message: "Autenticación requerida" });
        return;
    }

    const id = Number(url.pathname.split("/").pop());
    const rawPayload = await readJsonBody(request);
    // Actualización parcial: solo se escriben los campos presentes (backend/student-update.js).
    const current = await queryDb("SELECT id_estudiante, nombres, apellidos FROM estudiante WHERE id_estudiante = ?", [id]);
    if (!current.length) { sendJson(response, 404, { ok: false, message: "Estudiante no encontrado." }); return; }
    const plan = buildStudentUpdate(rawPayload, current[0]);
    if (plan.error) { sendJson(response, 400, { ok: false, message: plan.error }); return; }

    let result;
    try {
        result = await queryDb(
            `UPDATE estudiante SET ${plan.columns.map(column => `${column} = ?`).join(", ")} WHERE id_estudiante = ?`,
            [...plan.values, id]
        );
    } catch (error) {
        if (error.code !== "ER_DUP_ENTRY") throw error;
        sendJson(response, 409, { ok: false, message: "Ya existe un estudiante con ese documento." });
        return;
    }
    const outcome = await mutationOutcome(result, "SELECT 1 FROM estudiante WHERE id_estudiante = ?", [id]);
    if (outcome === "not_found") { sendJson(response, 404, { ok: false, message: "Estudiante no encontrado." }); return; }
    const saved = await queryDb(`SELECT ${STUDENT_COLUMNS} FROM estudiante WHERE id_estudiante = ?`, [id]);
    sendJson(response, 200, { ...mapStudentRowToFrontend(saved[0]), unchanged: outcome === "unchanged" });

    return;
} 

if (request.method === "DELETE" && url.pathname.startsWith("/api/estudiantes/")) {

    if (!sessionUser) {
        sendJson(response, 401, { ok: false, message: "Autenticación requerida" });
        return;
    }

    const id = url.pathname.split("/").pop();

    const result = await queryDb("UPDATE estudiante SET estado = 'inactivo' WHERE id_estudiante = ? AND estado <> 'inactivo'", [id]);
    await sendMutationOutcome(response, result, "SELECT 1 FROM estudiante WHERE id_estudiante = ?", [id], "Estudiante", "desactivado");

    return;
}
    sendJson(response, 404, { error: "Ruta API no encontrada" });
}

async function serveStatic(response, pathname) {
    const publicRoot = path.join(ROOT, "public");
    const filePath = resolvePublicFilePath(publicRoot, pathname === "/" ? "/index.html" : pathname);

    if (!filePath) {
        response.writeHead(403);
        response.end("Acceso denegado");
        return;
    }

    try {
        const [resolvedRoot, resolvedFile] = await Promise.all([fs.realpath(publicRoot), fs.realpath(filePath)]);
        if (!isPathInside(resolvedRoot, resolvedFile)) {
            response.writeHead(403);
            response.end("Acceso denegado");
            return;
        }
        const file = await fs.readFile(resolvedFile);
        response.writeHead(200, {
            "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
            ...securityHeaders()
        });
        response.end(file);
    } catch {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Archivo no encontrado");
    }
}

// Sin la migración 015 (sin estudiante.id_usuario) se informa que no hay vínculos.
async function linkedStudentIds() {
    try {
        const rows = await queryDb("SELECT id_estudiante FROM estudiante WHERE id_usuario IS NOT NULL");
        return new Set(rows.map(row => Number(row.id_estudiante)));
    } catch (error) {
        if (error.code === "ER_BAD_FIELD_ERROR") return new Set();
        throw error;
    }
}

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
        // AAAA-MM-DD: el campo <input type="date"> no acepta la fecha ISO completa y la enviaría vacía.
        fechaNacimiento: dateOnly(row.fecha_nacimiento),
        edad: row.edad ?? "",
        grado: grade,
        curso: grade,
        jornada: row.jornada || "",
        discapacidad: disability,
        condicion_especial: disability,
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
        condicion_especial: payload.condicion_especial || payload.discapacidad || null,
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

// mysql2 devuelve DATE como Date a medianoche local; se conserva el día del calendario.
function dateOnly(value) {
    if (!value) return "";
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return "";
        const pad = number => String(number).padStart(2, "0");
        return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    }
    return String(value).slice(0, 10);
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
    const auditContext = requestAuditStorage.getStore();
    if (auditContext && !auditContext.writeAttached) {
        auditContext.writeAttached = true;
        response.once("finish", () => {
            const result = status >= 200 && status < 300 ? "success" : [401, 403, 404].includes(status) ? "denied" : "error";
            db.promise().query(
                "INSERT INTO piar_auditoria (actor_user_id, action, resource_type, resource_id, result, http_status) VALUES (?, ?, ?, ?, ?, ?)",
                [auditContext.actorId || null, auditContext.action, auditContext.resource, auditContext.resourceId, result, status]
            ).catch(() => console.error("No se pudo registrar el evento de auditoría PIAR."));
        });
    }
    const requestOrigin = response.req?.headers?.origin;
    const corsOrigin = requestOrigin && allowedOrigins.has(requestOrigin)
        ? requestOrigin
        : allowedOrigins.has("*") ? "*" : null;

    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...securityHeaders(),
        ...(corsOrigin ? { "Access-Control-Allow-Origin": corsOrigin } : {}),
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Vary": "Origin",
        ...extraHeaders
    });
    response.end(JSON.stringify(data));
}

function createRequestAuditContext(request) {
    const requestPath = String(request.url || "/").split("?")[0];
    const match = requestPath.match(/^\/api\/(estudiantes|piar|diagnosticos|seguimientos|observaciones|historial|reportes|dashboard)(?:\/|$)/);
    if (!match) return null;
    const ids = [...requestPath.matchAll(/\/(\d+)(?=\/|$)/g)].map(item => Number(item[1]));
    return {
        actorId: null,
        action: String(request.method || "GET").toUpperCase().slice(0, 12),
        resource: match[1],
        resourceId: ids.length ? ids[ids.length - 1] : null,
        writeAttached: false
    };
}

// 'unsafe-inline' remains for scripts only because the UI still uses inline
// onclick handlers; removing them is tracked in docs/ESTADO_ACTUAL_PROYECTO.md.
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

function securityHeaders() {
    return {
        "Content-Security-Policy": CONTENT_SECURITY_POLICY,
        "Cross-Origin-Opener-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        ...(process.env.NODE_ENV === "production" ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {})
    };
}

function queryDb(sql, values = []) {
    return db.promise().query(sql, values).then(([rows]) => rows);
}

async function mutationOutcome(result, existenceSql, values) {
    if (Number(result.changedRows ?? result.affectedRows ?? 0) > 0) return classifyMutation(result, true);
    const existing = await queryDb(existenceSql, values);
    return classifyMutation(result, existing.length > 0);
}

async function sendMutationOutcome(response, result, existenceSql, values, label, verb) {
    const outcome = await mutationOutcome(result, existenceSql, values);
    if (outcome === "not_found") {
        sendJson(response, 404, { ok: false, message: `${label} no encontrado.` });
        return outcome;
    }
    sendJson(response, 200, { ok: true, unchanged: outcome === "unchanged", message: outcome === "unchanged" ? `${label} ya estaba ${verb}.` : `${label} ${verb} correctamente.` });
    return outcome;
}

async function validateDiagnosticPayload(payload, partial = false) {
    const requiredFields = ["tipo_diagnostico", "fecha", "descripcion", "id_estudiante", "id_piar"];
    if (!partial && requiredFields.some(field => payload[field] === undefined || payload[field] === null || payload[field] === "")) {
        return { status: 400, message: "Tipo, fecha, descripción, estudiante y PIAR son obligatorios" };
    }

    if (payload.fecha !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.fecha))) {
        return { status: 400, message: "La fecha del diagnóstico no es válida" };
    }

    if (payload.id_estudiante !== undefined || payload.id_piar !== undefined) {
        let studentId = payload.id_estudiante === undefined ? null : Number(payload.id_estudiante);
        let piarId = payload.id_piar === undefined ? null : Number(payload.id_piar);
        if (partial && (studentId === null || piarId === null)) {
            const diagnosticId = Number(payload.id_diagnostico);
            if (!Number.isSafeInteger(diagnosticId) || diagnosticId <= 0) return { status: 400, message: "No se pudo validar la relación del diagnóstico existente" };
            const current = await queryDb("SELECT id_estudiante, id_piar FROM diagnostico WHERE id_diagnostico = ?", [diagnosticId]);
            if (!current.length) return { status: 404, message: "Diagnóstico no encontrado" };
            studentId ??= Number(current[0].id_estudiante);
            piarId ??= Number(current[0].id_piar);
        }
        if (partial && studentId === null && piarId === null) return null;
        if (!Number.isInteger(studentId) || !Number.isInteger(piarId) || studentId <= 0 || piarId <= 0) {
            return { status: 400, message: "Estudiante y PIAR deben ser identificadores válidos" };
        }

        const relation = await queryDb("SELECT p.id_piar FROM piar p INNER JOIN estudiante e ON e.id_estudiante = p.id_estudiante WHERE p.id_piar = ? AND p.id_estudiante = ?", [piarId, studentId]);
        if (!relation.length) {
            return { status: 400, message: "El PIAR no existe o no pertenece al estudiante" };
        }
    }

    if (payload.id_psicologa !== undefined && payload.id_psicologa !== null && payload.id_psicologa !== "") {
        const psychologist = await queryDb("SELECT id_psicologa FROM psicologa WHERE id_psicologa = ?", [Number(payload.id_psicologa)]);
        if (!psychologist.length) {
            return { status: 400, message: "La psicóloga indicada no existe" };
        }
    }

    return null;
}

// Deactivation/reactivation by an Administrador. The administrator cannot
// deactivate itself or the last active Administrador, so the institution can
// never be left without account administration. Each change is audited.
async function changeUserActivation(userId, actor, action) {
    if (!Number.isSafeInteger(userId) || userId <= 0) return { status: 400, body: { ok: false, message: "Usuario no válido." } };
    if (action === "desactivar" && userId === Number(actor.id)) {
        return { status: 409, body: { ok: false, message: "No puedes desactivar tu propia cuenta." } };
    }
    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();
        const [targets] = await connection.query("SELECT id_usuario, rol, estado, correo_verificado_at FROM usuario WHERE id_usuario = ? FOR UPDATE", [userId]);
        const target = targets[0];
        if (!target) { await connection.rollback(); return { status: 404, body: { ok: false, message: "Usuario no encontrado." } }; }
        if (action === "desactivar") {
            if (target.estado !== "activo") { await connection.rollback(); return { status: 409, body: { ok: false, message: "Solo se pueden desactivar cuentas activas." } }; }
            if (target.rol === "Administrador") {
                const [admins] = await connection.query("SELECT COUNT(*) AS total FROM usuario WHERE rol = 'Administrador' AND estado = 'activo' FOR UPDATE");
                if (Number(admins[0].total) <= 1) { await connection.rollback(); return { status: 409, body: { ok: false, message: "No se puede desactivar al último Administrador activo." } }; }
            }
            await connection.query("UPDATE usuario SET estado = 'inactivo' WHERE id_usuario = ? AND estado = 'activo'", [userId]);
            await connection.query("UPDATE sesion_usuario SET revoked_at = CURRENT_TIMESTAMP WHERE id_usuario = ? AND revoked_at IS NULL", [userId]);
        } else {
            if (target.estado !== "inactivo" || !target.correo_verificado_at) {
                await connection.rollback();
                return { status: 409, body: { ok: false, message: "Solo se pueden reactivar cuentas inactivas con correo verificado." } };
            }
            await connection.query("UPDATE usuario SET estado = 'activo' WHERE id_usuario = ? AND estado = 'inactivo'", [userId]);
        }
        await recordAdminAccountEvent(connection, {
            targetUserId: userId, operation: action === "desactivar" ? "account_deactivated" : "account_reactivated", outcome: "success",
            operatorIdentityClaim: String(actor.id), operatorIdentitySource: "admin_session", authorizationReference: null, reason: null
        });
        await connection.commit();
        return { status: 200, body: { ok: true, message: action === "desactivar" ? "Usuario desactivado." : "Usuario reactivado." } };
    } catch (error) {
        try { await connection.rollback(); } catch { /* preserve original error */ }
        throw error;
    } finally {
        connection.release();
    }
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
        // The free-text column is exposed separately because the detail
        // response uses "barreras" for the structured piar_barrera rows.
        barreras_texto: row.barreras
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

