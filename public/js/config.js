window.PIAR_API_CONFIG = {
    mode: "local",
    adapter: "piar",

    baseUrl: window.location.origin,

    token: "",

    endpoints: {
        data: "/api/data",
        reset: "/api/reset",
        health: "/api/health",
        authRegister: "/api/auth/register",
        authLogin: "/api/auth/login",
        authLogout: "/api/auth/logout",
        authMe: "/api/auth/me",
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
