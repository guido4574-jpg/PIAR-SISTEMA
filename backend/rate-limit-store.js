"use strict";

const crypto = require("node:crypto");

// Fixed-window limiters with interchangeable storage:
// - memory: single process (development, one instance).
// - mysql: shared by every instance through table limite_solicitudes
//   (migration 012). Bucket keys are stored as SHA-256 so IPs and emails
//   never reach the table in clear text.

function decision(allowed, remainingMs) {
    return { allowed, retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(remainingMs / 1000)) };
}

function createMemoryRateLimitStore({ maxKeys = 20000, now = Date.now } = {}) {
    const buckets = new Map();
    let operations = 0;

    function prune(currentTime) {
        for (const [key, bucket] of buckets) {
            if (currentTime >= bucket.expiresAt) buckets.delete(key);
        }
    }

    function active(key, currentTime) {
        const bucket = buckets.get(key);
        if (bucket && currentTime < bucket.expiresAt) return bucket;
        if (bucket) buckets.delete(key);
        return null;
    }

    return {
        kind: "memory",
        async consume(key, limit, windowMs) {
            const currentTime = now();
            operations += 1;
            if (operations % 128 === 0 || buckets.size >= maxKeys) prune(currentTime);
            let bucket = active(key, currentTime);
            if (!bucket) {
                // Fail closed when the table is saturated instead of growing without bound.
                if (buckets.size >= maxKeys) return decision(false, windowMs);
                bucket = { count: 0, expiresAt: currentTime + windowMs };
                buckets.set(key, bucket);
            }
            bucket.count += 1;
            return decision(bucket.count <= limit, bucket.expiresAt - currentTime);
        },
        async peek(key, limit) {
            const currentTime = now();
            const bucket = active(key, currentTime);
            return decision(!bucket || bucket.count < limit, bucket ? bucket.expiresAt - currentTime : 0);
        },
        async reset(key) {
            buckets.delete(key);
        }
    };
}

function createMysqlRateLimitStore(db) {
    const query = (sql, values) => db.promise().query(sql, values).then(([rows]) => rows);
    const hashKey = key => crypto.createHash("sha256").update(key).digest("hex");

    return {
        kind: "mysql",
        async consume(key, limit, windowMs) {
            const hashed = hashKey(key);
            // Assignments run left to right: conteo must read the previous expira_at.
            await query(`INSERT INTO limite_solicitudes (clave, conteo, expira_at)
                VALUES (?, 1, DATE_ADD(NOW(3), INTERVAL ? MICROSECOND))
                ON DUPLICATE KEY UPDATE
                    conteo = IF(expira_at <= NOW(3), 1, conteo + 1),
                    expira_at = IF(expira_at <= NOW(3), VALUES(expira_at), expira_at)`, [hashed, windowMs * 1000]);
            const rows = await query(`SELECT conteo, GREATEST(0, TIMESTAMPDIFF(MICROSECOND, NOW(3), expira_at)) AS restante_us
                FROM limite_solicitudes WHERE clave = ?`, [hashed]);
            const row = rows[0] || { conteo: 1, restante_us: windowMs * 1000 };
            return decision(Number(row.conteo) <= limit, Number(row.restante_us) / 1000);
        },
        async peek(key, limit) {
            const rows = await query(`SELECT conteo, GREATEST(0, TIMESTAMPDIFF(MICROSECOND, NOW(3), expira_at)) AS restante_us
                FROM limite_solicitudes WHERE clave = ? AND expira_at > NOW(3)`, [hashKey(key)]);
            if (!rows.length) return decision(true, 0);
            return decision(Number(rows[0].conteo) < limit, Number(rows[0].restante_us) / 1000);
        },
        async reset(key) {
            await query("DELETE FROM limite_solicitudes WHERE clave = ?", [hashKey(key)]);
        }
    };
}

function createLimiter(store, { name, limit, windowMs }) {
    if (!name || !Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs < 1) {
        throw new TypeError("A limiter needs a name, a positive limit and windowMs.");
    }
    const bucket = key => `${name}:${String(key || "unknown")}`;
    return {
        consume: key => store.consume(bucket(key), limit, windowMs),
        peek: key => store.peek(bucket(key), limit, windowMs),
        reset: key => store.reset(bucket(key))
    };
}

function createRateLimitStore(env = process.env, db) {
    const kind = String(env.RATE_LIMIT_STORE || "memory").trim().toLowerCase();
    if (kind === "memory") return createMemoryRateLimitStore();
    if (kind === "mysql") {
        if (!db) throw new Error("RATE_LIMIT_STORE=mysql requiere una conexión MySQL.");
        return createMysqlRateLimitStore(db);
    }
    throw new Error("RATE_LIMIT_STORE debe ser 'memory' o 'mysql'.");
}

async function combine(limiters, operation, keys) {
    const results = await Promise.all(limiters.map((limiter, index) => limiter[operation](keys[index])));
    return {
        allowed: results.every(result => result.allowed),
        retryAfterSeconds: Math.max(0, ...results.map(result => result.retryAfterSeconds))
    };
}

module.exports = { createMemoryRateLimitStore, createMysqlRateLimitStore, createLimiter, createRateLimitStore, combine };
