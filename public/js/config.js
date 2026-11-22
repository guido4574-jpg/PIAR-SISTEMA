window.PIAR_API_CONFIG = {
    mode: "local",
    adapter: "piar",

    baseUrl: window.location.origin,

    token: "",

    // Entrega académica: el acceso con Google, Microsoft y Apple queda oculto en la
    // interfaz. El código OAuth/OIDC, la vinculación de identidades (D4 y D5) y sus
    // rutas del backend se conservan para una fase futura; poner true lo reactiva.
    features: {
        externalAuth: false
    },

    endpoints: {
        appConfig: "/api/config",
        health: "/api/health",
        authRegister: "/api/auth/register",
        authLogin: "/api/auth/login",
        authInitialPasswordChange: "/api/auth/initial-password-change",
        authLogout: "/api/auth/logout",
        authMe: "/api/auth/me",
        authPasswordResetRequest: "/api/auth/password-reset/request",
        authPasswordResetConfirm: "/api/auth/password-reset/confirm",
        authEmailVerificationConfirm: "/api/auth/email-verification/confirm",
        authEmailVerificationRequest: "/api/auth/email-verification/request",
        authEmailChangeConfirm: "/api/auth/email-change/confirm",
        authIdentities: "/api/auth/identities",
        users: "/api/usuarios",
        students: "/api/estudiantes",
        teachers: "/api/docentes",
        piar: "/api/piar",
        diagnostics: "/api/diagnosticos",
        followUps: "/api/seguimientos",
        observations: "/api/observaciones",
        history: "/api/historial",
        reports: "/api/reportes",
        dashboard: "/api/dashboard/resumen"
    },

    responseDataPath: "",

    headers: {}
};
