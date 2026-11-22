"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { isAllowedMutationOrigin, isPathInside, parseAllowedOrigins, resolvePublicFilePath } = require("../backend/security-controls");

test("mutation origin allows exact local origins and rejects cross-site or wildcard origins", () => {
    const origins = parseAllowedOrigins("http://localhost:8080, https://piar.example.org, *", "");
    assert.equal(origins.has("*"), false);
    assert.equal(isAllowedMutationOrigin({ headers: { origin: "http://localhost:8080" } }, origins), true);
    assert.equal(isAllowedMutationOrigin({ headers: { origin: "https://evil.example" } }, origins), false);
    assert.equal(isAllowedMutationOrigin({ headers: { "sec-fetch-site": "cross-site" } }, origins), false);
    assert.equal(isAllowedMutationOrigin({ headers: {} }, origins), true);
});

test("static path resolution stays inside public after decoding traversal attempts", () => {
    const publicRoot = path.resolve("public");
    assert.equal(resolvePublicFilePath(publicRoot, "/index.html"), path.join(publicRoot, "index.html"));
    assert.equal(resolvePublicFilePath(publicRoot, "/%2e%2e/backend/auth.js"), null);
    assert.equal(resolvePublicFilePath(publicRoot, "/..%2f..%2f.env"), null);
    assert.equal(resolvePublicFilePath(publicRoot, "/%ZZ"), null);
    assert.equal(resolvePublicFilePath(publicRoot, "/%00secret"), null);
    assert.equal(isPathInside(publicRoot, path.join(publicRoot, "index.html")), true);
    assert.equal(isPathInside(publicRoot, path.resolve("backend", "auth.js")), false);
});
