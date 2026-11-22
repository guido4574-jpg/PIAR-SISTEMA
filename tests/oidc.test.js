"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
    configuredProvider,
    providerSettings,
    buildAuthorizationRequest,
    completeAuthorization,
    createTransactionMaterial,
    planExternalIdentityResolution
} = require("../backend/oidc");

const common = { NODE_ENV: "test", APP_BASE_URL: "http://127.0.0.1:8081" };

test("provider readiness validates required credentials and safe exact callback URLs", () => {
    const google = { ...common, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", GOOGLE_REDIRECT_URI: "http://127.0.0.1:8081/api/auth/oidc/google/callback" };
    assert.equal(configuredProvider("google", google), true);
    assert.equal(configuredProvider("google", { ...google, GOOGLE_REDIRECT_URI: "https://evil.example/api/auth/oidc/google/callback" }), false);
    assert.equal(configuredProvider("google", { ...google, GOOGLE_REDIRECT_URI: "http://127.0.0.1:8081/wrong" }), false);
    assert.equal(providerSettings("google", { ...google, GOOGLE_REDIRECT_URI: "javascript:alert(1)" }), null);
    assert.equal(configuredProvider("microsoft", { ...common, MICROSOFT_CLIENT_ID: "id", MICROSOFT_CLIENT_SECRET: "secret", MICROSOFT_TENANT_ID: "common", MICROSOFT_REDIRECT_URI: "http://127.0.0.1/callback" }), false);
    assert.equal(providerSettings("microsoft", { ...common, MICROSOFT_CLIENT_ID: "id", MICROSOFT_CLIENT_SECRET: "secret", MICROSOFT_TENANT_ID: "consumers", MICROSOFT_REDIRECT_URI: "http://127.0.0.1:8081/api/auth/oidc/microsoft/callback" }).issuer, "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0");
    assert.equal(configuredProvider("apple", { ...common, APPLE_CLIENT_ID: "id", APPLE_TEAM_ID: "team", APPLE_KEY_ID: "key", APPLE_PRIVATE_KEY: "key", APPLE_REDIRECT_URI: "http://127.0.0.1:8081/api/auth/oidc/apple/callback" }), true);
    assert.equal(configuredProvider("unknown", {}), false);
});

test("OIDC authorization and callback require one-time transaction material", async () => {
    const valid = { state: "s".repeat(32), nonce: "n".repeat(32), codeVerifier: "v".repeat(43) };
    await assert.rejects(buildAuthorizationRequest({ provider: "google", ...valid, discover: async () => { throw new Error("not configured"); } }), /not configured/);
    await assert.rejects(buildAuthorizationRequest({ provider: "google", state: "short", nonce: valid.nonce, codeVerifier: valid.codeVerifier }), /transaction is invalid/);
    await assert.rejects(completeAuthorization({ provider: "google", callbackUrl: "http://localhost/callback", state: "short", nonce: valid.nonce, codeVerifier: valid.codeVerifier }), /transaction is invalid/);
});

test("OIDC transaction material is high entropy and distinct", () => {
    const first = createTransactionMaterial();
    const second = createTransactionMaterial();
    for (const value of Object.values(first)) assert.match(value, /^[A-Za-z0-9_-]{43}$/);
    assert.notDeepEqual(first, second);
});

test("OIDC callback requires the discovered issuer and an unexpired signed claim set", async () => {
    const identity = { iss: "https://accounts.google.com", sub: "provider-user", exp: Math.floor(Date.now() / 1000) + 300, aud: "google-client", email: "user@example.invalid", email_verified: true };
    const authorizationCodeGrant = async (_configuration, _url, checks, options) => {
        assert.equal(checks.expectedNonce, "n".repeat(32));
        assert.equal(options.redirect_uri, "https://app.example.invalid/api/auth/oidc/google/callback");
        return { claims: () => identity };
    };
    const discover = async () => ({ configuration: {}, issuer: "https://accounts.google.com", redirectUri: new URL("https://app.example.invalid/api/auth/oidc/google/callback") });
    const args = { provider: "google", callbackUrl: "https://app.example.invalid/api/auth/oidc/google/callback?code=code&state=state", state: "s".repeat(32), nonce: "n".repeat(32), codeVerifier: "v".repeat(43), env: { NODE_ENV: "production", APP_BASE_URL: "https://app.example.invalid", GOOGLE_CLIENT_ID: "google-client", GOOGLE_CLIENT_SECRET: "google-secret", GOOGLE_REDIRECT_URI: "https://app.example.invalid/api/auth/oidc/google/callback" }, discover, authorizationCodeGrant };
    const result = await completeAuthorization(args);
    assert.equal(result.subject, "provider-user");
    assert.equal(result.emailVerified, true);
    identity.iss = "https://attacker.example";
    await assert.rejects(completeAuthorization(args), /issuer is invalid/);
    identity.iss = "https://accounts.google.com";
    identity.exp = Math.floor(Date.now() / 1000) - 1;
    await assert.rejects(completeAuthorization(args), /expired/);
    identity.exp = Math.floor(Date.now() / 1000) + 300;
    identity.aud = "other-client";
    await assert.rejects(completeAuthorization(args), /audience is invalid/);
    await assert.rejects(completeAuthorization({ ...args, callbackUrl: "https://attacker.example/callback?code=code&state=state" }), /callback URI is invalid/);
});

test("email equality alone never links an external identity to a local account", () => {
    assert.deepEqual(planExternalIdentityResolution({ matchingEmailUserId: 22 }), { action: "require-login-before-linking" });
    assert.deepEqual(planExternalIdentityResolution({ matchingEmailUserId: 22, authenticatedUserId: 22 }), { action: "link-after-authenticated-consent", userId: 22 });
    assert.deepEqual(planExternalIdentityResolution({ linkedUserId: 22, matchingEmailUserId: 22 }), { action: "login", userId: 22 });
    assert.deepEqual(planExternalIdentityResolution({}), { action: "complete-institutional-onboarding" });
});
