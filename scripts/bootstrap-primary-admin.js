"use strict";

// Compatibility entry point. There is one implementation and one set of
// destination, verification, audit, and credential controls.
const bootstrap = require("./bootstrap-local-primary-admin");

if (require.main === module) bootstrap.main().catch(error => {
    process.stderr.write(`${error.code ? `MySQL error (${error.code})` : error.message}\n`);
    process.exitCode = 1;
});

module.exports = bootstrap;
