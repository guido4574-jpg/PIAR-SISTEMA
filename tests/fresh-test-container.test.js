"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { assertFreshTestContainer } = require("../scripts/fresh-test-container");

function valid(overrides = {}) {
    return [{ Name: "/piar-mysql-test-fresh", Config: { Image: "mysql:8.0" }, State: { Running: true, Health: { Status: "healthy" } },
        HostConfig: { Tmpfs: { "/var/lib/mysql": "" } }, Mounts: [],
        NetworkSettings: { Ports: { "3306/tcp": [{ HostIp: "127.0.0.1", HostPort: "3308" }] } }, ...overrides }];
}

test("accepts only the named fresh tmpfs MySQL container on loopback 3308", () => {
    assert.equal(assertFreshTestContainer(valid()), true);
});

test("rejects persistent, wrong-port, wrong-image, stopped, or unverified containers", () => {
    const cases = [
        valid({ Name: "/piar-mysql-test" }), valid({ Config: { Image: "mysql:8.4" } }),
        valid({ State: { Running: false, Health: { Status: "healthy" } } }),
        valid({ State: { Running: true, Health: { Status: "starting" } } }), valid({ HostConfig: { Tmpfs: {} } }),
        valid({ Mounts: [{ Destination: "/var/lib/mysql", Type: "volume" }] }),
        valid({ NetworkSettings: { Ports: { "3306/tcp": [{ HostIp: "0.0.0.0", HostPort: "3308" }] } } }),
        valid({ NetworkSettings: { Ports: { "3306/tcp": [{ HostIp: "127.0.0.1", HostPort: "3308" }, { HostIp: "127.0.0.1", HostPort: "3307" }] } } }),
        valid({ NetworkSettings: { Ports: { "3306/tcp": [{ HostIp: "127.0.0.1", HostPort: "3308" }], "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "8080" }] } } })
    ];
    for (const item of cases) assert.throws(() => assertFreshTestContainer(item), /se cancela/);
    assert.throws(() => assertFreshTestContainer([]), /se cancela/);
});
