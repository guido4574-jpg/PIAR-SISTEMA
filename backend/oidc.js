"use strict";

const oidc = require("openid-client");
const crypto = require("node:crypto");

const PROVIDERS = Object.freeze({
    google: { issuer: "https://accounts.google.com", id: "GOOGLE_CLIENT_ID", secret: "GOOGLE_CLIENT_SECRET", redirect: "GOOGLE_REDIRECT_URI" },
    microsoft: { id: "MICROSOFT_CLIENT_ID", secret: "MICROSOFT_CLIENT_SECRET", redirect: "MICROSOFT_REDIRECT_URI" },
    apple: { id: "APPLE_CLIENT_ID", redirect: "APPLE_REDIRECT_URI" }
});

const MICROSOFT_CONSUMERS_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
const TENANT_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Decisión D4: política de tenants de Microsoft.
 * - MICROSOFT_TENANT_IDS: Tenant IDs (GUID) organizacionales autorizados, separados por comas.
 * - MICROSOFT_ALLOW_PERSONAL_ACCOUNTS=true: acepta cuentas personales (tenant de consumidores).
 * - MICROSOFT_TENANT_ID (anterior): un único GUID o "consumers"; se sigue admitiendo.
 * Cualquier valor no válido deja el proveedor sin configurar (falla cerrado).
 * Con un solo tenant se usa su autoridad; con varios, "organizations" o "common", y
 * openid-client valida el emisor con el tid del token. Después se exige que ese tid
 * esté en la lista autorizada.
 */
function microsoftTenantPolicy(env = process.env) {
    const entries = String(env.MICROSOFT_TENANT_IDS || "").split(",").map(value => value.trim()).filter(Boolean);
    const legacy = String(env.MICROSOFT_TENANT_ID || "").trim();
    if (legacy) entries.push(legacy);
    const personalFlag = String(env.MICROSOFT_ALLOW_PERSONAL_ACCOUNTS || "").trim().toLowerCase();
    if (personalFlag && !["true", "false"].includes(personalFlag)) return null;
    let allowPersonal = personalFlag === "true";
    const organizations = new Set();
    for (const entry of entries) {
        const value = entry.toLowerCase();
        if (value === "consumers" || value === MICROSOFT_CONSUMERS_TENANT) { allowPersonal = true; continue; }
        if (!TENANT_GUID.test(value)) return null;
        organizations.add(value);
    }
    const tenants = [...organizations];
    if (allowPersonal) tenants.push(MICROSOFT_CONSUMERS_TENANT);
    if (!tenants.length) return null;
    const authority = tenants.length === 1 ? tenants[0] : (allowPersonal ? "common" : "organizations");
    return Object.freeze({ tenants: Object.freeze(tenants), authority, allowPersonal });
}

function providerSettings(provider, env = process.env) {
    const definition = PROVIDERS[provider];
    if (!definition) return null;
    const tenantPolicy = provider === "microsoft" ? microsoftTenantPolicy(env) : null;
    if (provider === "microsoft" && !tenantPolicy) return null;
    const issuer = provider === "microsoft"
        ? `https://login.microsoftonline.com/${tenantPolicy.authority}/v2.0`
        : definition.issuer;
    const required = [definition.id, definition.redirect];
    if (definition.secret) required.push(definition.secret);
    if (provider === "apple") required.push("APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY");
    if (required.some(key => !String(env[key] || "").trim()) || !String(env.APP_BASE_URL || "").trim()) return null;
    let redirectUri;
    try { redirectUri = new URL(env[definition.redirect]); } catch { return null; }
    let appUrl;
    try { appUrl = new URL(env.APP_BASE_URL); } catch { return null; }
    const localTest = env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "::1"].includes(redirectUri.hostname);
    if ((redirectUri.protocol !== "https:" && !(localTest && appUrl.protocol === "http:"))
        || redirectUri.username || redirectUri.password || redirectUri.hash || redirectUri.search
        || redirectUri.origin !== appUrl.origin || redirectUri.pathname !== `/api/auth/oidc/${provider}/callback`) return null;
    return { issuer, clientId: env[definition.id], redirectUri, clientSecret: definition.secret ? env[definition.secret] : undefined, tenantPolicy };
}

function base64url(value) {
    return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

/**
 * Apple exige como client_secret un JWT ES256 firmado con la clave privada de la
 * cuenta de desarrollador (no un client_assertion). Se genera en cada uso y vence
 * en 5 minutos. Solo firma; toda validación de tokens la hace openid-client.
 */
function appleClientSecret(env = process.env, nowSeconds = Math.floor(Date.now() / 1000)) {
    const key = crypto.createPrivateKey(String(env.APPLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"));
    const header = base64url({ alg: "ES256", kid: String(env.APPLE_KEY_ID), typ: "JWT" });
    const payload = base64url({ iss: String(env.APPLE_TEAM_ID), iat: nowSeconds, exp: nowSeconds + 300, aud: "https://appleid.apple.com", sub: String(env.APPLE_CLIENT_ID) });
    const signature = crypto.sign("sha256", Buffer.from(header + "." + payload), { key, dsaEncoding: "ieee-p1363" });
    return header + "." + payload + "." + signature.toString("base64url");
}

function configuredProvider(provider, env = process.env) {
    return Boolean(providerSettings(provider, env));
}

function planExternalIdentityResolution({ linkedUserId, matchingEmailUserId, authenticatedUserId }) {
    if (linkedUserId) return { action: "login", userId: linkedUserId };
    if (authenticatedUserId) return { action: "link-after-authenticated-consent", userId: authenticatedUserId };
    if (matchingEmailUserId) return { action: "require-login-before-linking" };
    return { action: "complete-institutional-onboarding" };
}

async function discoverProvider(provider, env = process.env) {
    const settings = providerSettings(provider, env);
    if (!settings) throw new Error("External identity provider is not configured.");
    const clientSecret = provider === "apple" ? appleClientSecret(env) : settings.clientSecret;
    const clientMetadata = { client_secret: clientSecret };
    const clientAuthentication = oidc.ClientSecretPost(clientSecret);
    const configuration = await oidc.discovery(new URL(settings.issuer), settings.clientId, clientMetadata, clientAuthentication);
    return { configuration, ...settings };
}

async function buildAuthorizationRequest({ provider, state, nonce, codeVerifier, env = process.env, discover = discoverProvider }) {
    if (![state, nonce, codeVerifier].every(value => typeof value === "string" && value.length >= 32)) {
        throw new Error("External identity transaction is invalid.");
    }
    const { configuration, redirectUri } = await discover(provider, env);
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const parameters = {
        redirect_uri: redirectUri.href,
        response_type: "code",
        // Apple no admite el ámbito "profile"; con "name" o "email" exige form_post.
        scope: provider === "apple" ? "openid email name" : "openid email profile",
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: "S256"
    };
    if (provider === "apple") parameters.response_mode = "form_post";
    const url = oidc.buildAuthorizationUrl(configuration, parameters);
    return url;
}

async function completeAuthorization({ provider, callbackUrl, state, nonce, codeVerifier, env = process.env, discover = discoverProvider, authorizationCodeGrant = oidc.authorizationCodeGrant }) {
    if (![state, nonce, codeVerifier].every(value => typeof value === "string" && value.length >= 32)) {
        throw new Error("External identity transaction is invalid.");
    }
    const { configuration, redirectUri, issuer } = await discover(provider, env);
    const settings = providerSettings(provider, env);
    const callback = new URL(callbackUrl);
    if (callback.origin !== redirectUri.origin || callback.pathname !== redirectUri.pathname) throw new Error("External identity callback URI is invalid.");
    const tokens = await authorizationCodeGrant(configuration, callback, {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
        expectedNonce: nonce
    }, { redirect_uri: redirectUri.href });
    const claims = tokens.claims();
    if (!claims || typeof claims.sub !== "string" || !claims.sub) throw new Error("External identity subject is missing.");
    let expectedIssuer = issuer;
    if (provider === "microsoft") {
        // D4: el tenant del token debe estar autorizado y el emisor debe ser el de ese tenant.
        const tenant = typeof claims.tid === "string" ? claims.tid.toLowerCase() : "";
        if (!settings?.tenantPolicy || !settings.tenantPolicy.tenants.includes(tenant)) throw new Error("External identity tenant is not authorized.");
        expectedIssuer = "https://login.microsoftonline.com/" + tenant + "/v2.0";
    }
    if (typeof claims.iss !== "string" || claims.iss !== expectedIssuer) throw new Error("External identity issuer is invalid.");
    if (typeof claims.exp !== "number" || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error("External identity token is expired.");
    const clientId = settings?.clientId;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!clientId || !audiences.includes(clientId)) throw new Error("External identity audience is invalid.");
    const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
    const verifiedClaim = claims.email_verified;
    const emailVerified = verifiedClaim === true || verifiedClaim === "true";
    return {
        issuer: claims.iss,
        subject: claims.sub,
        email,
        emailVerified,
        name: typeof claims.name === "string" ? claims.name : "",
        // D5: Microsoft no emite email_verified; su identidad se respalda en el token
        // firmado de un tenant autorizado. Google y Apple deben declarar el correo verificado.
        verifiedIdentity: provider === "microsoft" || emailVerified
    };
}

function createTransactionMaterial() {
    return {
        state: crypto.randomBytes(32).toString("base64url"),
        nonce: crypto.randomBytes(32).toString("base64url"),
        codeVerifier: crypto.randomBytes(32).toString("base64url")
    };
}

module.exports = { microsoftTenantPolicy, appleClientSecret, MICROSOFT_CONSUMERS_TENANT, configuredProvider, providerSettings, discoverProvider, buildAuthorizationRequest, completeAuthorization, createTransactionMaterial, planExternalIdentityResolution };
