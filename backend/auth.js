const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const SESSION_COOKIE = "piar_session";
const SESSION_HOURS = 8;
const ROLES = ["Administrador", "Rector", "Coordinador", "Psicóloga", "Docente"];

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
        estado: user.estado || "activo"
    };
}

function parseCookies(request) {
    return String(request.headers.cookie || "").split(";").reduce((cookies, item) => {
        const separator = item.indexOf("=");
        if (separator < 1) {
            return cookies;
        }

        const key = item.slice(0, separator).trim();
        cookies[key] = decodeURIComponent(item.slice(separator + 1).trim());
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

async function register(db, payload, allowPrivilegedRole = false) {
    const nombre = String(payload.nombre || "").trim();
    const apellidos = String(payload.apellidos || "").trim();
    const correo = normalizeEmail(payload.correo);
    const documento = String(payload.documento || "").trim();
    const password = String(payload.password || "");
    const requestedRole = String(payload.rol || "Docente").trim();
    const rol = allowPrivilegedRole ? requestedRole : "Docente";

    if (!nombre || !apellidos || !correo || !documento || !password) {
        return { status: 400, body: { ok: false, message: "Nombre, apellidos, documento, correo y contraseña son obligatorios" } };
    }

    if (!/^\S+@\S+\.\S+$/.test(correo)) {
        return { status: 400, body: { ok: false, message: "El correo electrónico no es válido" } };
    }

    if (password.length < 8) {
        return { status: 400, body: { ok: false, message: "La contraseña debe tener al menos 8 caracteres" } };
    }

    if (!ROLES.includes(requestedRole)) {
        return { status: 400, body: { ok: false, message: "El rol no es válido" } };
    }

    const duplicate = await query(db, "SELECT id_usuario FROM usuario WHERE documento = ? OR LOWER(correo) = ? LIMIT 1", [documento, correo]);
    if (duplicate.length) {
        return { status: 409, body: { ok: false, message: "El documento o correo ya está registrado" } };
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const fullName = `${nombre} ${apellidos}`.trim();
    const result = await query(db, "INSERT INTO usuario (nombre, documento, correo, rol, contrasena, password_hash, estado) VALUES (?, ?, ?, ?, ?, ?, 'activo')", [fullName, documento, correo, rol, "", passwordHash]);
    const users = await query(db, "SELECT * FROM usuario WHERE id_usuario = ?", [result.insertId]);
    const session = await createSession(db, result.insertId);
    return { status: 201, body: { ok: true, user: publicUser(users[0]) }, session };
}

async function createSession(db, userId) {
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
    await query(db, "INSERT INTO sesion_usuario (id_usuario, token_hash, expires_at) VALUES (?, ?, ?)", [userId, tokenHash, expiresAt]);
    return { token, maxAgeSeconds: SESSION_HOURS * 60 * 60 };
}

async function login(db, payload) {
    const correo = normalizeEmail(payload.correo);
    const password = String(payload.password || "");
    if (!correo || !password) {
        return { status: 400, body: { ok: false, message: "Correo y contraseña son obligatorios" } };
    }

    const users = await query(db, "SELECT * FROM usuario WHERE LOWER(correo) = ? LIMIT 1", [correo]);
    const user = users[0];
    const validPassword = user?.password_hash ? await bcrypt.compare(password, user.password_hash) : false;
    if (!user || !validPassword || user.estado !== "activo") {
        return { status: 401, body: { ok: false, message: "Correo o contraseña incorrectos" } };
    }

    const session = await createSession(db, user.id_usuario);
    await query(db, "UPDATE usuario SET ultimo_acceso_at = CURRENT_TIMESTAMP WHERE id_usuario = ?", [user.id_usuario]);
    return { status: 200, body: { ok: true, user: publicUser(user) }, session };
}

async function currentUser(db, request) {
    const token = parseCookies(request)[SESSION_COOKIE];
    if (!token) {
        return null;
    }

    const rows = await query(db, `SELECT u.*
        FROM sesion_usuario s
        INNER JOIN usuario u ON u.id_usuario = s.id_usuario
        WHERE s.token_hash = ?
          AND s.revoked_at IS NULL
          AND s.expires_at > CURRENT_TIMESTAMP
          AND u.estado = 'activo'
        LIMIT 1`, [hashToken(token)]);
    return publicUser(rows[0]);
}

async function logout(db, request) {
    const token = parseCookies(request)[SESSION_COOKIE];
    if (token) {
        await query(db, "UPDATE sesion_usuario SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND revoked_at IS NULL", [hashToken(token)]);
    }
}

module.exports = {
    SESSION_COOKIE,
    ROLES,
    currentUser,
    login,
    logout,
    register,
    sessionCookie
};
