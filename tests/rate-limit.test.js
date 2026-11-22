const test = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimiter } = require("../backend/rate-limit");

test("rate limiter permits the configured requests, then throttles until expiry", () => {
    let time = 1000;
    const limit = createRateLimiter({ limit: 2, windowMs: 60000, now: () => time });
    assert.equal(limit("client").allowed, true);
    assert.equal(limit("client").allowed, true);
    const blocked = limit("client");
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSeconds, 60);
    time += 60000;
    assert.equal(limit("client").allowed, true);
});

test("rate limiter isolates keys and bounds retained buckets", () => {
    let time = 0;
    const limit = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 1, now: () => time });
    assert.equal(limit("one").allowed, true);
    assert.equal(limit("two").allowed, false);
    time = 1000;
    assert.equal(limit("two").allowed, true);
});
