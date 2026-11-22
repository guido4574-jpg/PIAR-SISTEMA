(function exposeSafeHtml(global) {
    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        })[character]);
    }
    global.escapeHTML = escapeHTML;
    if (typeof module !== "undefined" && module.exports) module.exports = { escapeHTML };
})(globalThis);
