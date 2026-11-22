"use strict";

// Kept only as a compatibility guard. The former helper could mark an
// administrator's email verified based on an operator assertion.
function validAdminInput() { return false; }

async function createPrimaryAdmin() {
    throw new Error("Este flujo fue deshabilitado; usa scripts/bootstrap-local-primary-admin.js, que crea una cuenta pendiente de verificación real.");
}

module.exports = { validAdminInput, createPrimaryAdmin };
