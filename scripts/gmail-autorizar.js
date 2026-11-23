"use strict";

// Autoriza UNA VEZ la cuenta institucional de Gmail para que el servidor envíe correos con la API de Gmail
// (EMAIL_TRANSPORT=gmail) y guarda el refresh token en un archivo FUERA del repositorio.
// Se ejecuta en el equipo del administrador; no crea ninguna ruta en la aplicación publicada.
//
// Variables (definidas solo en la sesión de la terminal, nunca en archivos versionados):
//   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET   cliente OAuth de tipo «Aplicación web» en Google Cloud
//   GMAIL_CUENTA_ESPERADA                  dirección de la cuenta institucional que debe autorizar
//   GMAIL_REFRESH_TOKEN_ARCHIVO            ruta del archivo de salida, fuera del repositorio (no se sobrescribe)
//   GMAIL_OAUTH_PUERTO                     opcional; 8765 por omisión
// URI de redirección que debe registrarse EXACTA en el cliente OAuth: http://localhost:<puerto>/oauth2/callback
//
// Permisos solicitados: gmail.send (solo enviar) y openid/email, que únicamente sirven para comprobar
// qué cuenta autorizó. No se pide lectura, modificación ni eliminación de correos.
// Nunca se imprimen el código de autorización, el secreto ni los tokens.
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const SCOPES = ["openid", "email", GMAIL_SEND_SCOPE];
const CALLBACK_PATH = "/oauth2/callback";
const REPO_ROOT = path.resolve(__dirname, "..");
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const TIMEOUT_MS = 10 * 60 * 1000;

function readConfig(env = process.env) {
    const clientId = String(env.GMAIL_CLIENT_ID || "").trim();
    const clientSecret = String(env.GMAIL_CLIENT_SECRET || "").trim();
    const expected = String(env.GMAIL_CUENTA_ESPERADA || "").trim().toLowerCase();
    const output = String(env.GMAIL_REFRESH_TOKEN_ARCHIVO || "").trim();
    const port = Number(env.GMAIL_OAUTH_PUERTO || 8765);
    if (!/^[0-9]{6,30}-[a-z0-9]{8,64}\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error("GMAIL_CLIENT_ID falta o no tiene el formato de un cliente OAuth de Google.");
    if (!/^[\x21-\x7e]{10,256}$/.test(clientSecret)) throw new Error("GMAIL_CLIENT_SECRET falta o no es válido.");
    if (!EMAIL.test(expected)) throw new Error("GMAIL_CUENTA_ESPERADA debe ser la dirección de la cuenta institucional.");
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("GMAIL_OAUTH_PUERTO debe estar entre 1024 y 65535.");
    return { clientId, clientSecret, expected, output: assertOutsideRepository(output), port, redirectUri: `http://localhost:${port}${CALLBACK_PATH}` };
}

// El refresh token equivale a una credencial: nunca debe quedar dentro del repositorio.
function assertOutsideRepository(file, repoRoot = REPO_ROOT) {
    if (!file) throw new Error("GMAIL_REFRESH_TOKEN_ARCHIVO es obligatoria (ruta fuera del repositorio).");
    const resolved = path.resolve(file);
    const relative = path.relative(repoRoot, resolved);
    if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) throw new Error("GMAIL_REFRESH_TOKEN_ARCHIVO no puede estar dentro del repositorio.");
    if (fs.existsSync(resolved)) throw new Error("GMAIL_REFRESH_TOKEN_ARCHIVO ya existe; elige otra ruta (no se sobrescriben credenciales).");
    return resolved;
}

function createPkce() {
    const verifier = crypto.randomBytes(48).toString("base64url");
    return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
}

function buildAuthorizationUrl(config, state, challenge) {
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: SCOPES.join(" "),
        access_type: "offline",
        // consent garantiza que Google entregue un refresh token nuevo.
        prompt: "consent",
        include_granted_scopes: "false",
        login_hint: config.expected,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256"
    }).toString();
    return url.href;
}

function sameSecret(a, b) {
    const left = Buffer.from(String(a || ""));
    const right = Buffer.from(String(b || ""));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// El id_token llega directamente del endpoint de tokens de Google por TLS (OpenID Connect Core §3.1.3.7),
// por lo que basta validar emisor, audiencia, vigencia y correo verificado.
function validateTokenResponse(body, config, now = Date.now()) {
    if (typeof body?.refresh_token !== "string" || !body.refresh_token) {
        throw new Error("Google no entregó un refresh token. Retira el acceso de la aplicación en https://myaccount.google.com/permissions y repite la autorización.");
    }
    const scopes = String(body.scope || "").split(/\s+/).filter(Boolean);
    if (!scopes.includes(GMAIL_SEND_SCOPE)) throw new Error("La autorización no incluye el permiso gmail.send. Repite el proceso y acepta ese permiso.");
    const extraGmail = scopes.filter(scope => scope.includes("/auth/gmail.") && scope !== GMAIL_SEND_SCOPE);
    if (extraGmail.length || scopes.includes("https://mail.google.com/")) throw new Error("La autorización incluye permisos de Gmail adicionales; retira el acceso y repite el proceso.");
    let claims;
    try { claims = JSON.parse(Buffer.from(String(body.id_token || "").split(".")[1] || "", "base64url").toString("utf8")); } catch { claims = null; }
    if (!claims || !["https://accounts.google.com", "accounts.google.com"].includes(claims.iss) || claims.aud !== config.clientId || !(Number(claims.exp) * 1000 > now)) {
        throw new Error("No se pudo confirmar la identidad de la cuenta autorizada.");
    }
    if (claims.email_verified !== true || String(claims.email || "").toLowerCase() !== config.expected) {
        throw new Error("La cuenta que autorizó no es la cuenta institucional esperada. No se guardó nada; retira el acceso de esa cuenta y repite con la correcta.");
    }
    return { refreshToken: body.refresh_token, scopes };
}

async function exchangeCode(config, code, verifier) {
    const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: "authorization_code", code_verifier: verifier }).toString(),
        redirect: "error"
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const name = typeof body?.error === "string" && /^[a-z_]{1,64}$/.test(body.error) ? body.error : "desconocido";
        throw new Error(`Google rechazó el intercambio del código (HTTP ${response.status}, ${name}).`);
    }
    return body;
}

function page(title, text) {
    const esc = value => value.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
    return `<!doctype html><html lang="es"><meta charset="utf-8"><title>${esc(title)}</title><body style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:60px auto;color:#1e2a16"><h1 style="color:#1E5C00">${esc(title)}</h1><p>${esc(text)}</p></body></html>`;
}

async function main(env = process.env) {
    const config = readConfig(env);
    const state = crypto.randomBytes(32).toString("base64url");
    const pkce = createPkce();
    let finished = false;
    const servers = [];
    const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Tiempo agotado: no se completó la autorización en 10 minutos.")), TIMEOUT_MS);
        const handler = async (request, response) => {
            const url = new URL(request.url, config.redirectUri);
            const reply = (status, title, text) => { response.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }); response.end(page(title, text)); };
            if (request.method !== "GET" || url.pathname !== CALLBACK_PATH) return reply(404, "No encontrado", "Esta dirección solo atiende el retorno de Google.");
            if (finished) return reply(410, "Autorización ya procesada", "Este proceso solo admite un intento. Ejecuta el script de nuevo si hace falta.");
            if (!sameSecret(url.searchParams.get("state"), state)) return reply(400, "Solicitud rechazada", "El parámetro state no coincide; puede ser un intento de suplantación.");
            finished = true;
            clearTimeout(timer);
            if (url.searchParams.get("error")) {
                reply(400, "Autorización cancelada", "No se concedió el permiso. Puedes cerrar esta pestaña.");
                return reject(new Error("La autorización fue cancelada o denegada en Google."));
            }
            try {
                const tokens = validateTokenResponse(await exchangeCode(config, String(url.searchParams.get("code") || ""), pkce.verifier), config);
                reply(200, "Autorización completada", "El Sistema PIAR ya puede enviar correos con esta cuenta. Puedes cerrar esta pestaña.");
                resolve(tokens);
            } catch (error) {
                reply(400, "Autorización no válida", error.message);
                reject(error);
            }
        };
        for (const host of ["127.0.0.1", "::1"]) {
            const server = http.createServer(handler);
            server.on("error", error => { if (host === "127.0.0.1") reject(error); });
            server.listen(config.port, host);
            servers.push(server);
        }
        console.log(`1. Confirma que el cliente OAuth tiene registrada esta URI de redirección exacta: ${config.redirectUri}`);
        console.log("2. Abre este enlace en el navegador e inicia sesión con la cuenta institucional:");
        console.log(buildAuthorizationUrl(config, state, pkce.challenge));
        console.log("Esperando la respuesta de Google (máximo 10 minutos)…");
    }).finally(() => { for (const server of servers) server.close(); });
    fs.writeFileSync(config.output, result.refreshToken, { encoding: "utf8", flag: "wx", mode: 0o600 });
    console.log(`Autorización correcta (permisos: ${result.scopes.join(", ")}).`);
    console.log(`Refresh token guardado en ${config.output} (fuera del repositorio). No se mostró en pantalla.`);
    console.log("Siguiente paso: cargarlo en Railway como GMAIL_REFRESH_TOKEN con --stdin (docs/DESPLIEGUE_RAILWAY.md §7.3) y guardar el archivo en el gestor de contraseñas o borrarlo después.");
}

if (require.main === module) {
    main().catch(error => { console.error(`Autorización de Gmail no completada: ${error.message}`); process.exitCode = 1; });
}

module.exports = { readConfig, assertOutsideRepository, buildAuthorizationUrl, validateTokenResponse, createPkce, sameSecret, SCOPES, CALLBACK_PATH };
