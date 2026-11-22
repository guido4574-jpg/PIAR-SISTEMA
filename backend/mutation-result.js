function classifyMutation(result, exists) {
    const changedRows = result && typeof result === "object"
        ? Number(result.changedRows ?? result.affectedRows ?? 0)
        : Number(result || 0);
    if (changedRows > 0) return "changed";
    return exists ? "unchanged" : "not_found";
}

module.exports = { classifyMutation };
