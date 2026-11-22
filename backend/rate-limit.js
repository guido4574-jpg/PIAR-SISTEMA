function createRateLimiter({ limit, windowMs, maxKeys = 10000, now = Date.now }) {
    if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs < 1) {
        throw new TypeError("A positive limit and windowMs are required.");
    }
    const buckets = new Map();
    let checks = 0;

    function prune(currentTime) {
        for (const [key, bucket] of buckets) {
            if (currentTime - bucket.startedAt >= windowMs) buckets.delete(key);
        }
    }

    return function check(key) {
        const currentTime = now();
        checks++;
        if (checks % 128 === 0 || buckets.size >= maxKeys) prune(currentTime);
        const normalizedKey = String(key || "unknown");
        let bucket = buckets.get(normalizedKey);
        if (!bucket || currentTime - bucket.startedAt >= windowMs) {
            if (buckets.size >= maxKeys) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)) };
            bucket = { startedAt: currentTime, count: 0 };
            buckets.set(normalizedKey, bucket);
        }
        if (bucket.count >= limit) {
            return {
                allowed: false,
                retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (currentTime - bucket.startedAt)) / 1000))
            };
        }
        bucket.count++;
        return { allowed: true, retryAfterSeconds: 0 };
    };
}

module.exports = { createRateLimiter };
