"use strict";

// Single password policy for registration, reset and initial change.
// bcrypt only uses the first 72 bytes, so longer inputs are rejected
// instead of being silently truncated.
const PASSWORD_MIN_LENGTH = 14;
const PASSWORD_MAX_BYTES = 72;
const PASSWORD_POLICY_MESSAGE = `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres y no superar ${PASSWORD_MAX_BYTES} bytes.`;

function passwordPolicyError(password) {
    const value = String(password ?? "");
    if ([...value].length < PASSWORD_MIN_LENGTH || Buffer.byteLength(value, "utf8") > PASSWORD_MAX_BYTES) {
        return PASSWORD_POLICY_MESSAGE;
    }
    return null;
}

module.exports = { PASSWORD_MIN_LENGTH, PASSWORD_MAX_BYTES, PASSWORD_POLICY_MESSAGE, passwordPolicyError };
