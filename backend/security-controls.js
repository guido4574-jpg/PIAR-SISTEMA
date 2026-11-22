"use strict";

const path = require("node:path");

function isAllowedMutationOrigin(request, allowedOrigins) {
    const origin = request.headers?.origin;
    if (origin) return allowedOrigins.has(origin);
    return String(request.headers?.["sec-fetch-site"] || "").toLowerCase() !== "cross-site";
}

function resolvePublicFilePath(publicRoot, requestPath) {
    let decoded;
    try {
        decoded = decodeURIComponent(String(requestPath || "/"));
    } catch {
        return null;
    }
    if (decoded.includes("\0")) return null;
    const target = path.resolve(publicRoot, `.${decoded.replace(/[\\/]+/g, path.sep)}`);
    const relative = path.relative(path.resolve(publicRoot), target);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    return target;
}

function isPathInside(rootPath, candidatePath) {
    const root = path.resolve(rootPath);
    const candidate = path.resolve(candidatePath);
    const relative = path.relative(root, candidate);
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function parseAllowedOrigins(value, fallback) {
    const entries = String(value || fallback).split(",").map(item => item.trim()).filter(Boolean);
    const origins = new Set();
    for (const item of entries) {
        try {
            const parsed = new URL(item);
            if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password
                && !parsed.pathname.replace(/\/$/, "") && !parsed.search && !parsed.hash && parsed.origin === item) {
                origins.add(parsed.origin);
            }
        } catch {
            // Ignore malformed or wildcard entries; credentialed CORS requires exact origins.
        }
    }
    return origins;
}

module.exports = { isAllowedMutationOrigin, isPathInside, parseAllowedOrigins, resolvePublicFilePath };
