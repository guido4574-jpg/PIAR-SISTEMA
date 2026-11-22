"use strict";

const { createLimiter, createMemoryRateLimitStore, combine } = require("./rate-limit-store");

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

// Only failed attempts are counted. The strict limit is keyed by the
// (IP, account) pair, so a third party exhausting it only blocks itself and
// cannot lock the legitimate owner out from another network. The per-account
// ceiling is deliberately high: reaching it needs many distinct addresses,
// and it still caps distributed guessing against a single account.
const DEFAULT_LIMITS = Object.freeze({
    pair: { limit: 5, windowMs: FIFTEEN_MINUTES },
    ip: { limit: 30, windowMs: FIFTEEN_MINUTES },
    account: { limit: 100, windowMs: ONE_HOUR }
});

function createLoginThrottle({ store = createMemoryRateLimitStore(), limits = DEFAULT_LIMITS } = {}) {
    const pair = createLimiter(store, { name: "login-pair", ...limits.pair });
    const ip = createLimiter(store, { name: "login-ip", ...limits.ip });
    const account = createLimiter(store, { name: "login-account", ...limits.account });
    const keys = (clientIp, emailHash) => [`${clientIp || "unknown"}|${emailHash || "missing-email"}`, clientIp || "unknown", emailHash || "missing-email"];
    const limiters = [pair, ip, account];

    return {
        check: (clientIp, emailHash) => combine(limiters, "peek", keys(clientIp, emailHash)),
        recordFailure: (clientIp, emailHash) => combine(limiters, "consume", keys(clientIp, emailHash)),
        recordSuccess: (clientIp, emailHash) => pair.reset(keys(clientIp, emailHash)[0])
    };
}

module.exports = { createLoginThrottle, DEFAULT_LIMITS };
