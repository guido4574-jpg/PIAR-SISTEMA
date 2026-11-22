"use strict";

const net = require("node:net");

// Resolves the client address for rate limiting and audit events.
// X-Forwarded-For is honoured only when the TCP peer is an explicitly
// configured proxy; otherwise any client could spoof its address.
function normalizeAddress(value) {
    const address = String(value || "").trim();
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    return mapped ? mapped[1] : address;
}

function parseTrustedProxies(value) {
    const list = new net.BlockList();
    const entries = String(value || "").split(",").map(item => item.trim()).filter(Boolean);
    for (const entry of entries) {
        if (entry === "loopback") {
            list.addSubnet("127.0.0.0", 8, "ipv4");
            list.addAddress("::1", "ipv6");
            continue;
        }
        const [address, prefix] = entry.split("/");
        const family = net.isIP(address);
        if (!family) throw new Error(`TRUSTED_PROXIES contiene una dirección no válida: ${entry}`);
        const type = family === 4 ? "ipv4" : "ipv6";
        if (prefix === undefined) {
            list.addAddress(address, type);
            continue;
        }
        const bits = Number(prefix);
        if (!Number.isInteger(bits) || bits < 0 || bits > (family === 4 ? 32 : 128)) {
            throw new Error(`TRUSTED_PROXIES contiene un prefijo no válido: ${entry}`);
        }
        list.addSubnet(address, bits, type);
    }
    return { list, configured: entries.length > 0 };
}

function isTrusted(trusted, address) {
    const family = net.isIP(address);
    if (!trusted.configured || !family) return false;
    return trusted.list.check(address, family === 4 ? "ipv4" : "ipv6");
}

function createClientIpResolver(trustedProxiesSetting = process.env.TRUSTED_PROXIES) {
    const trusted = parseTrustedProxies(trustedProxiesSetting);
    return function clientIp(request) {
        const peer = normalizeAddress(request?.socket?.remoteAddress) || "unknown";
        if (!isTrusted(trusted, peer)) return peer;

        const forwarded = String(request.headers?.["x-forwarded-for"] || "")
            .split(",").map(normalizeAddress).filter(Boolean);
        // Walk from the closest hop outwards and stop at the first address not
        // owned by a trusted proxy; anything further left is client-controlled.
        for (let index = forwarded.length - 1; index >= 0; index -= 1) {
            const candidate = forwarded[index];
            if (!net.isIP(candidate)) return peer;
            if (!isTrusted(trusted, candidate)) return candidate;
        }
        return forwarded[0] || peer;
    };
}

module.exports = { createClientIpResolver, normalizeAddress, parseTrustedProxies };
