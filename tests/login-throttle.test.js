"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoginThrottle } = require("../backend/login-throttle");

test("only failed attempts count and the strict limit applies to the (IP, account) pair", async () => {
    const throttle = createLoginThrottle();
    for (let attempt = 0; attempt < 5; attempt += 1) {
        assert.equal((await throttle.check("client-a", "address-a")).allowed, true);
        await throttle.recordFailure("client-a", "address-a");
    }
    assert.equal((await throttle.check("client-a", "address-a")).allowed, false);
    // The same account from another network is not locked by the attacker.
    assert.equal((await throttle.check("client-b", "address-a")).allowed, true);
    // The attacker can still use its own address for other accounts until its IP budget is spent.
    assert.equal((await throttle.check("client-a", "address-b")).allowed, true);
});

test("a successful login clears the pair counter", async () => {
    const throttle = createLoginThrottle();
    for (let attempt = 0; attempt < 4; attempt += 1) await throttle.recordFailure("client-c", "address-c");
    await throttle.recordSuccess("client-c", "address-c");
    for (let attempt = 0; attempt < 4; attempt += 1) await throttle.recordFailure("client-c", "address-c");
    assert.equal((await throttle.check("client-c", "address-c")).allowed, true);
});

test("per-IP limit caps spraying across many accounts and returns a retry interval", async () => {
    const throttle = createLoginThrottle({ limits: {
        pair: { limit: 5, windowMs: 60_000 }, ip: { limit: 3, windowMs: 60_000 }, account: { limit: 100, windowMs: 60_000 }
    } });
    for (let attempt = 0; attempt < 3; attempt += 1) await throttle.recordFailure("client-d", `address-${attempt}`);
    const result = await throttle.check("client-d", "address-new");
    assert.equal(result.allowed, false);
    assert.ok(result.retryAfterSeconds > 0);
});

test("per-account ceiling needs many distinct addresses to trigger", async () => {
    const throttle = createLoginThrottle({ limits: {
        pair: { limit: 5, windowMs: 60_000 }, ip: { limit: 30, windowMs: 60_000 }, account: { limit: 10, windowMs: 60_000 }
    } });
    for (let index = 0; index < 9; index += 1) await throttle.recordFailure(`client-${index}`, "target");
    assert.equal((await throttle.check("owner", "target")).allowed, true);
    await throttle.recordFailure("client-9", "target");
    assert.equal((await throttle.check("owner", "target")).allowed, false);
});
