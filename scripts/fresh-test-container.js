"use strict";

function assertFreshTestContainer(metadata) {
    const container = Array.isArray(metadata) ? metadata[0] : metadata;
    const name = String(container?.Name || "").replace(/^\//, "");
    const config = container?.Config || {};
    const state = container?.State || {};
    const tmpfs = container?.HostConfig?.Tmpfs || {};
    const mounts = Array.isArray(container?.Mounts) ? container.Mounts : [];
    const portMappings = container?.NetworkSettings?.Ports || {};
    const published = Object.entries(portMappings).flatMap(([containerPort, bindings]) =>
        (Array.isArray(bindings) ? bindings : []).map(binding => ({ containerPort, ...binding }))
    );
    const safe = name === "piar-mysql-test-fresh"
        && config.Image === "mysql:8.0"
        && state.Running === true
        && state.Health?.Status === "healthy"
        && Object.hasOwn(tmpfs, "/var/lib/mysql")
        && !mounts.some(mount => mount.Destination === "/var/lib/mysql")
        && published.length === 1
        && published[0].containerPort === "3306/tcp"
        && published[0].HostIp === "127.0.0.1"
        && published[0].HostPort === "3308";
    if (!safe) throw new Error("La integración se cancela: Docker no confirma el contenedor MySQL fresh efímero en loopback:3308.");
    return true;
}

module.exports = { assertFreshTestContainer };
