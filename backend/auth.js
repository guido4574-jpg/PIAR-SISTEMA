const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { deliverEmail: deliverConfiguredEmail } = require("./email");
const { recordAdminAccountEvent } = require("./admin-account-audit");
const { passwordPolicyError } = require("./password-policy");

const SESSION_COOKIE = "piar_session";
const SESSION_HOURS = 8;
const RESET_TOKEN_MINUTES = 30;
const EMAIL_VERIFICATION_HOURS = 24;
const DUMMY_PASSWORD_HASH = "$2b$12$5uZIhcxBiA/lm3D1ieXfOOZS/rYKPhnsi7xjQSCmWFe456cZE8isy";
const ROLES = ["Administrador", "Rector", "Coordinador", "Psicóloga", "Docente"];
// Decisión D2: se pueden solicitar cuentas de Docente, Psicólogo(a) (valor interno
// 'Psicóloga'), Coordinador y Rector. Todas quedan pendientes de verificación del
// correo y de aprobación del Administrador. Administrador y Estudiante nunca son
// solicitables; elegir un perfil no concede acceso ni permisos.
const PUBLIC_REGISTRATION_ROLES = Object.freeze(["Docente", "Psicóloga", "Coordinador", "Rector"]);
const REGISTRATION_ROLE_ERROR = "El registro solo permite solicitar cuentas de Docente, Psicólogo(a), Coordinador o Rector.";
// Decisión D7 (alta institucional de estudiantes): solo un Administrador crea la
// cuenta Estudiante, vinculada a un registro de estudiante activo y sin cuenta,
// y confirmando la autorización del acudiente (Ley 1581). Nunca hay registro público.
const STUDENT_ROLE = "Estudiante";
const INSTITUTIONAL_ACCOUNT_ROLES = Object.freeze([...PUBLIC_REGISTRATION_ROLES, STUDENT_ROLE]);

function query(db, sql, values = []) {
    return db.promise().query(sql, values).then(([rows]) => rows);
}

function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function publicUser(user) {
    if (!user) {
        return null;
    }

    return {
        id: user.id_usuario,
        nombre: user.nombre,
        nombres: user.nombres || "",
        apellidos: user.apellidos || "",
        documento: user.documento,
        correo: user.correo,
        rol: user.rol,
        estado: user.estado || "activo",
        mustChangePassword: Boolean(user.password_change_required)
    };
}

function parseCookies(request) {
    return String(request.headers.cookie || "").split(";").reduce((cookies, item) => {
        const separator = item.indexOf("=");
        if (separator < 1) {
            return cookies;
        }

        const key = item.slice(0, separator).trim();
        try {
            cookies[key] = decodeURIComponent(item.slice(separator + 1).trim());
        } catch {
            // Ignore malformed cookie values and treat the session as absent.
        }
        return cookies;
    }, {});
}

function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function sessionCookie(token, maxAgeSeconds) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

async function register(db, payload, _legacyAllowPrivilegedRole = false, deliver = deliverVerificationLink, options = {}) {
    // Registro con aprobación manual: las solicitudes del personal (registro público, D2, y cuentas
    // creadas por el Administrador, D3) quedan en estado «pendiente» sin enlace de verificación y
    // solo se activan cuando un Administrador o Rector autorizado las aprueba en «Solicitudes».
    // El correo NO se marca como verificado (correo_verificado_at sigue en NULL).
    // La cuenta Estudiante (D7) conserva la verificación del correo. La contraseña que fija el
    // Administrador es temporal: se exige cambiarla en el primer acceso y la creación se audita.
    const actorId = options.actorId === undefined ? null : Number(options.actorId);
    const institutional = actorId !== null;
    if (institutional && (!Number.isSafeInteger(actorId) || actorId <= 0)) throw new Error("Institutional account creator is invalid.");
    const nombre = String(payload.nombre || "").trim();
    const apellidos = String(payload.apellidos || "").trim();
    const correo = normalizeEmail(payload.correo);
    const documento = String(payload.documento || "").trim();
    const password = String(payload.password || "");
    const requestedRole = String(payload.rol || "Docente").trim();
    const allowedRoles = institutional ? INSTITUTIONAL_ACCOUNT_ROLES : PUBLIC_REGISTRATION_ROLES;
    if (!allowedRoles.includes(requestedRole)) {
        return { status: 400, body: { ok: false, message: REGISTRATION_ROLE_ERROR } };
    }
    const studentAccount = requestedRole === STUDENT_ROLE;
    const studentId = studentAccount ? Number(payload.id_estudiante) : null;
    if (studentAccount && (!Number.isSafeInteger(studentId) || studentId <= 0)) {
        return { status: 400, body: { ok: false, message: "Seleccione el estudiante al que se vinculará la cuenta." } };
    }
    if (studentAccount && payload.autorizacion_acudiente !== true && payload.autorizacion_acudiente !== "true" && payload.autorizacion_acudiente !== "on") {
        return { status: 400, body: { ok: false, message: "Confirme que la institución cuenta con la autorización del acudiente para crear la cuenta del estudiante." } };
    }
    // Registration never grants a privileged role, even when a legacy caller
    // passes the former allowPrivilegedRole flag.
    const rol = requestedRole;

    if (!nombre || !apellidos || !correo || !documento || !password) {
        return { status: 400, body: { ok: false, message: "Nombre, apellidos, documento, correo y contraseña son obligatorios" } };
    }

    if (Buffer.byteLength(`${nombre} ${apellidos}`.trim(), "utf8") > 150 || Buffer.byteLength(documento, "utf8") > 30) {
        return { status: 400, body: { ok: false, message: "El nombre o documento supera la longitud permitida" } };
    }
    if (correo.length > 150 || !/^\S+@\S+\.\S+$/.test(correo)) {
        return { status: 400, body: { ok: false, message: "El correo electrónico no es válido" } };
    }

    const passwordError = passwordPolicyError(password);
    if (passwordError) {
        return { status: 400, body: { ok: false, message: passwordError } };
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const fullName = `${nombre} ${apellidos}`.trim();
    const manualApproval = !studentAccount;
    const estado = manualApproval ? "pendiente" : "pendiente_verificacion";
    const token = manualApproval ? null : crypto.randomBytes(32).toString("base64url");
    const tokenHash = token ? hashToken(token) : null;
    const connection = await db.promise().getConnection();
    let result;
    try {
        await connection.beginTransaction();
        const [duplicate] = await connection.query("SELECT id_usuario FROM usuario WHERE documento = ? OR correo = ? LIMIT 1 FOR UPDATE", [documento, correo]);
        if (duplicate.length) {
            await connection.rollback();
            // El Administrador ya ve todas las cuentas; el registro público no revela si existen.
            return institutional ? institutionalDuplicate() : registrationAccepted();
        }
        if (studentAccount) {
            const [students] = await connection.query("SELECT id_estudiante, estado, id_usuario FROM estudiante WHERE id_estudiante = ? FOR UPDATE", [studentId]);
            const problem = !students.length ? [404, "El estudiante no existe."]
                : students[0].estado !== "activo" ? [409, "El estudiante no está activo."]
                    : students[0].id_usuario !== null && students[0].id_usuario !== undefined ? [409, "El estudiante ya tiene una cuenta vinculada."] : null;
            if (problem) {
                await connection.rollback();
                return { status: problem[0], body: { ok: false, message: problem[1] } };
            }
        }
        const [inserted] = institutional
            ? await connection.query("INSERT INTO usuario (nombre, documento, correo, rol, contrasena, password_hash, estado, password_change_required) VALUES (?, ?, ?, ?, ?, ?, ?, 1)", [fullName, documento, correo, rol, "", passwordHash, estado])
            : await connection.query("INSERT INTO usuario (nombre, documento, correo, rol, contrasena, password_hash, estado) VALUES (?, ?, ?, ?, ?, ?, ?)", [fullName, documento, correo, rol, "", passwordHash, estado]);
        result = inserted;
        if (studentAccount) {
            const [linked] = await connection.query("UPDATE estudiante SET id_usuario = ? WHERE id_estudiante = ? AND id_usuario IS NULL", [result.insertId, studentId]);
            if (Number(linked.affectedRows) !== 1) throw new Error("Student account link was not applied.");
        }
        if (!manualApproval) {
            await connection.query("INSERT INTO verificacion_correo (id_usuario, token_hash, expires_at) VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? HOUR))", [result.insertId, tokenHash, EMAIL_VERIFICATION_HOURS]);
        }
        if (institutional) {
            await recordAdminAccountEvent(connection, {
                targetUserId: Number(result.insertId), operation: "account_created", outcome: manualApproval ? "pending_approval" : "pending_verification",
                operatorIdentityClaim: String(actorId), operatorIdentitySource: "admin_session",
                authorizationReference: studentAccount ? "autorizacion_acudiente_confirmada" : null,
                // El vínculo queda en estudiante.id_usuario; la sesión administrativa no admite texto libre.
                reason: null
            });
        }
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        // The pre-check improves the common response; unique constraints remain authoritative under concurrent requests.
        if (error.code === "ER_DUP_ENTRY") {
            return institutional ? institutionalDuplicate() : registrationAccepted();
        }
        throw error;
    } finally {
        connection.release();
    }
    if (manualApproval) return institutional ? institutionalAccountCreated() : registrationAccepted();
    try {
        await deliver(correo, `${applicationBaseUrl()}/#verify-email=${encodeURIComponent(token)}`);
    } catch {
        await query(db, "UPDATE verificacion_correo SET consumed_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND consumed_at IS NULL", [tokenHash]);
        console.error("Verification email delivery failed.");
        if (institutional) return { status: 201, body: { ok: true, pendingVerification: true, deliveryFailed: true, message: "Cuenta creada, pero no se pudo enviar el enlace de verificación. La persona puede pedir uno nuevo con «Reenviar verificación de correo»." } };
        return registrationAccepted();
    }
    if (studentAccount) return studentAccountCreated();
    return institutional ? institutionalAccountCreated() : registrationAccepted();
}

function studentAccountCreated() {
    return { status: 201, body: { ok: true, pendingVerification: true, message: "Cuenta de Estudiante creada y vinculada. Se envió el enlace de verificación; al confirmarlo podrá ingresar con la contraseña temporal, que debe cambiar en el primer acceso." } };
}

function institutionalDuplicate() {
    return { status: 409, body: { ok: false, message: "Ya existe una cuenta con ese documento o correo." } };
}

function institutionalAccountCreated() {
    return { status: 201, body: { ok: true, pendingApproval: true, message: "Cuenta creada y pendiente de aprobación en «Solicitudes». No se envía enlace de verificación. La contraseña asignada es temporal y debe cambiarse en el primer acceso." } };
}

function registrationAccepted() {
    return { status: 202, body: { ok: true, pendingApproval: true, message: "Solicitud recibida. La cuenta queda pendiente de aprobación institucional: podrás iniciar sesión cuando un Administrador o Rector la apruebe. No necesitas verificar tu correo." } };
}

async function createSession(db, userId) {
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    // Expiry is computed by MySQL so it is compared against the same clock it was written with.
    await query(db, "INSERT INTO sesion_usuario (id_usuario, token_hash, expires_at) VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? HOUR))", [userId, tokenHash, SESSION_HOURS]);
    return { token, maxAgeSeconds: SESSION_HOURS * 60 * 60 };
}

async function login(db, payload) {
    const correo = normalizeEmail(payload.correo);
    const password = String(payload.password || "");
    if (!correo || !password) {
        return { status: 400, body: { ok: false, message: "Correo y contraseña son obligatorios" } };
    }

    const users = await query(db, "SELECT id_usuario, nombre, documento, correo, rol, estado, password_hash, password_change_required FROM usuario WHERE correo = ? LIMIT 1", [correo]);
    const user = users[0];
    const validPassword = await bcrypt.compare(password, user?.password_hash || DUMMY_PASSWORD_HASH);
    if (!user || !validPassword || user.estado !== "activo") {
        return { status: 401, body: { ok: false, message: "Correo o contraseña incorrectos" } };
    }

    const session = await createSession(db, user.id_usuario);
    await query(db, "UPDATE usuario SET ultimo_acceso_at = CURRENT_TIMESTAMP WHERE id_usuario = ?", [user.id_usuario]);
    return { status: 200, body: { ok: true, user: publicUser(user), mustChangePassword: Boolean(user.password_change_required) }, session };
}

async function currentUser(db, request) {
    const token = parseCookies(request)[SESSION_COOKIE];
    if (!token) {
        return null;
    }

    const rows = await query(db, `SELECT u.id_usuario, u.nombre, u.documento, u.correo, u.rol, u.estado, u.password_change_required
        FROM sesion_usuario s
        INNER JOIN usuario u ON u.id_usuario = s.id_usuario
        WHERE s.token_hash = ?
          AND s.revoked_at IS NULL
          AND s.expires_at > CURRENT_TIMESTAMP
          AND u.estado = 'activo'
        LIMIT 1`, [hashToken(token)]);
    return publicUser(rows[0]);
}

async function changeInitialPassword(db, request, password) {
    const newPassword = String(password || "");
    const token = parseCookies(request)[SESSION_COOKIE];
    if (!token) return { status: 401, body: { ok: false, message: "Autenticación requerida." } };
    const tokenHash = hashToken(token);
    const rows = await query(db, `SELECT u.id_usuario, u.password_change_required
        FROM sesion_usuario s INNER JOIN usuario u ON u.id_usuario = s.id_usuario
        WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP AND u.estado = 'activo'
        LIMIT 1`, [tokenHash]);
    if (!rows.length) return { status: 401, body: { ok: false, message: "La sesión no es válida." } };
    if (!Number(rows[0].password_change_required)) return { status: 409, body: { ok: false, message: "Esta cuenta no requiere un cambio inicial de contraseña." } };
    const passwordError = passwordPolicyError(newPassword);
    if (passwordError) return { status: 400, body: { ok: false, message: passwordError } };

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const updated = await query(db, "UPDATE usuario SET password_hash = ?, contrasena = '', password_change_required = 0 WHERE id_usuario = ? AND estado = 'activo' AND password_change_required = 1", [passwordHash, rows[0].id_usuario]);
    if (Number(updated.affectedRows) !== 1) return { status: 409, body: { ok: false, message: "La contraseña temporal ya fue utilizada. Inicia sesión nuevamente." } };
    await query(db, "UPDATE sesion_usuario SET revoked_at = CURRENT_TIMESTAMP WHERE id_usuario = ? AND token_hash <> ? AND revoked_at IS NULL", [rows[0].id_usuario, tokenHash]);
    return { status: 200, body: { ok: true, message: "Contraseña actualizada. Ya puedes acceder al sistema." } };
}

// Decisión D5: vincular o desvincular una identidad externa exige la contraseña
// local de la cuenta autenticada. Compara siempre contra un hash (también ficticio)
// para no revelar diferencias de tiempo.
async function verifyAccountPassword(db, userId, password) {
    const candidate = String(password || "");
    if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) return false;
    const rows = await query(db, "SELECT password_hash FROM usuario WHERE id_usuario = ? AND estado = 'activo' LIMIT 1", [Number(userId)]);
    const hash = rows[0]?.password_hash || DUMMY_PASSWORD_HASH;
    const valid = await bcrypt.compare(candidate, hash);
    return Boolean(candidate) && Boolean(rows[0]?.password_hash) && valid;
}

async function logout(db, request) {
    const token = parseCookies(request)[SESSION_COOKIE];
    if (token) {
        await query(db, "UPDATE sesion_usuario SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND revoked_at IS NULL", [hashToken(token)]);
    }
}

function verificationEmailText(link) {
    return [
        "Hola:",
        "",
        "Recibimos una solicitud de cuenta en el Sistema PIAR con esta dirección de correo.",
        `Para confirmarla, abre este enlace (sirve una sola vez y vence en ${EMAIL_VERIFICATION_HOURS} horas):`,
        "",
        link,
        "",
        "Después de verificar el correo, la cuenta puede requerir la aprobación de la institución antes de ingresar.",
        "Si el enlace venció, pide uno nuevo en la pantalla de acceso con «Reenviar verificación de correo».",
        "Si no solicitaste esta cuenta, ignora este mensaje: no se activará.",
        "",
        "Sistema PIAR · Mensaje automático, no respondas a este correo."
    ].join("\n");
}

async function deliverVerificationLink(email, link) {
    applicationBaseUrl();
    await deliverEmail(email, "Verifica tu correo de PIAR", verificationEmailText(link));
}

function applicationBaseUrl() {
    let parsed;
    try { parsed = new URL(String(process.env.APP_BASE_URL || "")); } catch { throw new Error("APP_BASE_URL is not configured."); }
    const loopback = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
    if (parsed.username || parsed.password || (parsed.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && loopback))) {
        throw new Error("APP_BASE_URL must use HTTPS outside local development.");
    }
    return parsed.origin;
}

async function deliverEmail(email, subject, text) {
    return deliverConfiguredEmail(email, subject, text);
}

async function deliverInitialAdminVerification(email, token) {
    const link = `${applicationBaseUrl()}/#verify-email=${encodeURIComponent(token)}`;
    await deliverConfiguredEmail(email, "Verifica tu correo para PIAR-SISTEMA", `Usa este enlace de un solo uso para verificar tu correo: ${link}`);
}

async function invalidateInitialAdminVerification(connection, userId, token) {
    if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) throw new Error("Administrator verification target is invalid.");
    await connection.execute("UPDATE verificacion_correo SET consumed_at = CURRENT_TIMESTAMP WHERE id_usuario = ? AND token_hash = ? AND consumed_at IS NULL", [Number(userId), hashToken(String(token || ""))]);
}

async function requestEmailVerification(db, correo, deliver = deliverVerificationLink) {
    const normalized = normalizeEmail(correo);
    const generic = { status: 200, body: { ok: true, message: "Si existe una solicitud pendiente de verificación, enviaremos un nuevo enlace. Revisa también la carpeta de spam o correo no deseado." } };
    if (!/^\S+@\S+\.\S+$/.test(normalized)) return generic;
    const users = await query(db, "SELECT id_usuario, correo FROM usuario WHERE correo = ? AND estado = 'pendiente_verificacion' LIMIT 1", [normalized]);
    if (!users.length) return generic;
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    await query(db, "INSERT INTO verificacion_correo (id_usuario, token_hash, expires_at) VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? HOUR))", [users[0].id_usuario, tokenHash, EMAIL_VERIFICATION_HOURS]);
    try { await deliver(users[0].correo, `${applicationBaseUrl()}/#verify-email=${encodeURIComponent(token)}`); }
    catch { await query(db, "UPDATE verificacion_correo SET consumed_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND consumed_at IS NULL", [tokenHash]); }
    return generic;
}

const VERIFICATION_INVALID = "El enlace de verificación no es válido. Revisa que lo copiaste completo o pide uno nuevo con «Reenviar verificación de correo».";

function verificationFailureReason(state) {
    if (!state) return "invalido";
    if (Number(state.usado)) return "usado";
    if (Number(state.vencido)) return "vencido";
    return "invalido";
}

function verificationFailureMessage(state) {
    const reason = verificationFailureReason(state);
    if (reason === "usado") return "Este enlace ya se utilizó. Si ya verificaste tu correo, espera la aprobación o inicia sesión; si no, pide uno nuevo con «Reenviar verificación de correo».";
    if (reason === "vencido") return `El enlace venció (dura ${EMAIL_VERIFICATION_HOURS} horas). Pide uno nuevo con «Reenviar verificación de correo».`;
    return VERIFICATION_INVALID;
}

async function verifyEmail(db, token) {
    const normalizedToken = String(token || "");
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(normalizedToken)) {
        return { status: 400, body: { ok: false, reason: "invalido", message: VERIFICATION_INVALID } };
    }
    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.query(
            "SELECT v.id_verificacion, v.id_usuario, u.rol FROM verificacion_correo v INNER JOIN usuario u ON u.id_usuario = v.id_usuario WHERE v.token_hash = ? AND v.consumed_at IS NULL AND v.expires_at > CURRENT_TIMESTAMP LIMIT 1 FOR UPDATE",
            [hashToken(normalizedToken)]
        );
        if (!rows.length) {
            // Solo quien tiene el enlace puede distinguir estos casos; no revela nada de otras cuentas.
            const [states] = await connection.query(
                "SELECT consumed_at IS NOT NULL AS usado, expires_at <= CURRENT_TIMESTAMP AS vencido FROM verificacion_correo WHERE token_hash = ? LIMIT 1",
                [hashToken(normalizedToken)]
            );
            await connection.rollback();
            return { status: 400, body: { ok: false, reason: verificationFailureReason(states[0]), message: verificationFailureMessage(states[0]) } };
        }
        const [claimed] = await connection.query(
            "UPDATE verificacion_correo SET consumed_at = CURRENT_TIMESTAMP WHERE id_verificacion = ? AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP",
            [rows[0].id_verificacion]
        );
        if (Number(claimed.affectedRows) !== 1) {
            // Otra petición simultánea consumió el mismo enlace.
            await connection.rollback();
            return { status: 400, body: { ok: false, reason: "usado", message: verificationFailureMessage({ usado: 1 }) } };
        }
        const [updated] = await connection.query(
            "UPDATE usuario SET correo_verificado_at = CURRENT_TIMESTAMP, estado = CASE WHEN rol IN ('Administrador', 'Estudiante') THEN 'activo' ELSE 'pendiente' END WHERE id_usuario = ? AND estado = 'pendiente_verificacion'",
            [rows[0].id_usuario]
        );
        if (Number(updated.affectedRows) !== 1) {
            await connection.rollback();
            return { status: 400, body: { ok: false, message: "La solicitud de cuenta ya no está pendiente de verificación." } };
        }
        // Administrador y Estudiante no pasan por «Solicitudes»: su verificación se audita aquí.
        if (rows[0].rol === "Administrador" || rows[0].rol === STUDENT_ROLE) {
            await recordAdminAccountEvent(connection, {
                targetUserId: Number(rows[0].id_usuario), operation: "email_verified", outcome: "success",
                operatorIdentityClaim: null, operatorIdentitySource: "email_verification_token",
                authorizationReference: null, reason: null
            });
        }
        await connection.commit();
        const message = rows[0].rol === "Administrador" || rows[0].rol === STUDENT_ROLE
            ? "Correo verificado. Ya puedes iniciar sesión."
            : "Correo verificado. La cuenta queda pendiente de aprobación institucional.";
        return { status: 200, body: { ok: true, message } };
    } catch (error) {
        try { await connection.rollback(); } catch { /* preserve original error */ }
        throw error;
    } finally {
        connection.release();
    }
}

async function requestPasswordReset(db, correo, deliver = deliverResetLink) {
    const normalized = normalizeEmail(correo);
    const baseUrl = applicationBaseUrl();
    if (!/^\S+@\S+\.\S+$/.test(normalized)) {
        return { status: 200, body: { ok: true, message: "Si el correo corresponde a una cuenta, recibirá instrucciones." } };
    }
    const users = await query(db, "SELECT id_usuario, correo FROM usuario WHERE correo = ? AND estado = 'activo' LIMIT 1", [normalized]);
    // Keep the response indistinguishable for unknown and known accounts.
    if (!users.length) return { status: 200, body: { ok: true, message: "Si el correo corresponde a una cuenta, recibirá instrucciones." } };
    const token = crypto.randomBytes(32).toString("base64url");
    await query(db, "INSERT INTO recuperacion_contrasena (id_usuario, token_hash, expires_at) VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MINUTE))", [users[0].id_usuario, hashToken(token), RESET_TOKEN_MINUTES]);
    const link = `${baseUrl}/#reset=${encodeURIComponent(token)}`;
    try {
        await deliver(users[0].correo, link);
    } catch {
        await query(db, "UPDATE recuperacion_contrasena SET consumed_at = CURRENT_TIMESTAMP WHERE token_hash = ?", [hashToken(token)]);
        console.error("Password reset email delivery failed.");
    }
    return { status: 200, body: { ok: true, message: "Si el correo corresponde a una cuenta, recibirá instrucciones." } };
}

async function deliverResetLink(email, link) {
    await deliverEmail(email, "Recuperación de contraseña PIAR", `Solicitaste cambiar tu contraseña. El enlace vence en ${RESET_TOKEN_MINUTES} minutos: ${link}`);
}

async function resetPasswordCore(db, token, password) {
    const normalizedToken = String(token || "");
    const newPassword = String(password || "");
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(normalizedToken)) {
        return { status: 400, body: { ok: false, message: "El enlace no es válido o expiró." } };
    }
    const passwordError = passwordPolicyError(newPassword);
    if (passwordError) return { status: 400, body: { ok: false, message: passwordError } };
    const tokenHash = hashToken(normalizedToken);
    const rows = await query(db, "SELECT id_recuperacion, id_usuario FROM recuperacion_contrasena WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP LIMIT 1 FOR UPDATE", [tokenHash]);
    if (!rows.length) return { status: 400, body: { ok: false, message: "El enlace no es válido o expiró." } };
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const claim = await query(db, "UPDATE recuperacion_contrasena SET consumed_at = CURRENT_TIMESTAMP WHERE id_recuperacion = ? AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP", [rows[0].id_recuperacion]);
    if (Number(claim.affectedRows) !== 1) return { status: 400, body: { ok: false, message: "El enlace no es válido o expiró." } };
    await query(db, "UPDATE usuario SET password_hash = ?, contrasena = '' WHERE id_usuario = ?", [passwordHash, rows[0].id_usuario]);
    await query(db, "UPDATE sesion_usuario SET revoked_at = CURRENT_TIMESTAMP WHERE id_usuario = ? AND revoked_at IS NULL", [rows[0].id_usuario]);
    return { status: 200, body: { ok: true, message: "Contraseña actualizada. Inicia sesión nuevamente." } };
}

async function resetPassword(db, token, password) {
    const normalizedToken = String(token || "");
    const newPassword = String(password || "");
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(normalizedToken)) {
        return { status: 400, body: { ok: false, message: "El enlace no es válido o expiró." } };
    }
    const passwordError = passwordPolicyError(newPassword);
    if (passwordError) return { status: 400, body: { ok: false, message: passwordError } };
    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();
        const result = await resetPasswordCore({ promise: () => connection }, normalizedToken, newPassword);
        if (result.status === 200) await connection.commit();
        else await connection.rollback();
        return result;
    } catch (error) {
        try { await connection.rollback(); } catch { /* preserve the original database error */ }
        throw error;
    } finally {
        connection.release();
    }
}

module.exports = {
    SESSION_COOKIE,
    ROLES,
    PUBLIC_REGISTRATION_ROLES,
    INSTITUTIONAL_ACCOUNT_ROLES,
    verifyAccountPassword,
    currentUser,
    changeInitialPassword,
    createSession,
    login,
    logout,
    register,
    requestPasswordReset,
    resetPassword,
    sessionCookie,
    verifyEmail,
    verificationEmailText,
    requestEmailVerification,
    deliverEmail,
    deliverInitialAdminVerification,
    invalidateInitialAdminVerification,
    applicationBaseUrl,
    EMAIL_VERIFICATION_HOURS
};
