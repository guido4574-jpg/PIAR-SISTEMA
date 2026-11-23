const INSTITUTIONAL_ROLES = ["Administrador", "Rector", "Coordinador", "Psicóloga"];
const STUDENT_AND_TEACHER_MANAGERS = ["Administrador", "Rector", "Coordinador"];
// Psicóloga consults PIAR content institutionally but does not edit it; it
// registers diagnoses and professional observations (traceable by author).
const PIAR_EDITORS = ["Administrador", "Rector", "Coordinador", "Docente"];
const PIAR_CLOSERS = ["Administrador", "Rector", "Coordinador"];
const OBSERVATION_CREATORS = ["Coordinador", "Psicóloga", "Docente"];
const FOLLOW_UP_CREATORS = ["Coordinador", "Docente"];
const DIAGNOSIS_EDITORS = ["Administrador", "Rector", "Coordinador", "Psicóloga"];
const DIAGNOSIS_REMOVERS = ["Administrador", "Rector", "Coordinador"];

function includesRole(roles, role) {
    return roles.includes(role);
}

// Estudiante: read-only access to its own PIAR (list and detail). Ownership and
// the allow-listed projection are enforced in student-portal.js; every other
// route, including diagnoses, observations, follow-ups, versions, history,
// reports and student profiles, is denied.
function canStudentAccess(method, pathname) {
    return method === "GET" && (pathname === "/api/piar" || /^\/api\/piar\/\d+$/.test(pathname));
}

function canAccessRoleResource(role, method, pathname) {
    if (!role) return false;
    if (role === "Estudiante") return canStudentAccess(method, pathname);

    // Psicóloga has institution-wide read scope (approved functional proposal).
    // A per-case assignment scope is still an open institutional decision.

    if (pathname.startsWith("/api/usuarios")) {
        const approval = /^\/api\/usuarios\/\d+\/aprobacion$/.test(pathname);
        // Registro con aprobación manual: Administrador y Rector revisan solicitudes. El Rector solo ve y
        // decide las de Docente, Psicóloga y Coordinador (registration-approval.js); las de perfil Rector
        // siguen reservadas al Administrador porque no hay un proceso aprobado para validar esa identidad.
        // El Rector no accede al resto de la administración de cuentas.
        if (pathname === "/api/usuarios/solicitudes") return method === "GET" && includesRole(["Administrador", "Rector"], role);
        if (approval) return method === "POST" && includesRole(["Administrador", "Rector"], role);
        if (/^\/api\/usuarios\/\d+\/reactivacion$/.test(pathname)) return method === "POST" && role === "Administrador";
        if (method === "GET") return role === "Administrador";
        return role === "Administrador" && ["POST", "PUT", "DELETE"].includes(method);
    }

    if (pathname === "/api/docentes" || /^\/api\/docentes\/\d+$/.test(pathname)) {
        if (method === "GET") return includesRole([...INSTITUTIONAL_ROLES, "Docente"], role);
        return includesRole(STUDENT_AND_TEACHER_MANAGERS, role) && ["POST", "PUT", "DELETE"].includes(method);
    }

    if (pathname === "/api/estudiantes" || /^\/api\/estudiantes\/\d+$/.test(pathname)) {
        if (method === "GET") return includesRole([...INSTITUTIONAL_ROLES, "Docente"], role);
        return includesRole(STUDENT_AND_TEACHER_MANAGERS, role) && ["POST", "PUT", "DELETE"].includes(method);
    }

    if (pathname === "/api/piar" || /^\/api\/piar\/\d+$/.test(pathname)) {
        if (method === "GET") return includesRole([...INSTITUTIONAL_ROLES, "Docente"], role);
        if (["POST", "PUT"].includes(method)) return includesRole(PIAR_EDITORS, role);
        if (method === "DELETE") return includesRole(PIAR_CLOSERS, role);
        return false;
    }

    if (/^\/api\/piar\/\d+\/versiones(?:\/\d+)?$/.test(pathname)) {
        return method === "GET" && includesRole([...INSTITUTIONAL_ROLES, "Docente"], role);
    }

    if (/^\/api\/piar\/\d+\/reapertura$/.test(pathname)) {
        return method === "POST" && role === "Coordinador";
    }

    if (/^\/api\/piar\/\d+\/docentes(?:\/\d+)?$/.test(pathname)) {
        if (method === "GET") return includesRole([...INSTITUTIONAL_ROLES, "Docente"], role);
        return includesRole(PIAR_CLOSERS, role) && ["POST", "DELETE"].includes(method);
    }

    if (/^\/api\/piar\/\d+\/ajustes(?:\/\d+)?$/.test(pathname)) {
        if (method === "GET") return includesRole([...INSTITUTIONAL_ROLES, "Docente"], role);
        if (role === "Docente") {
            return (method === "POST" && /^\/api\/piar\/\d+\/ajustes$/.test(pathname))
                || (method === "PUT" && /^\/api\/piar\/\d+\/ajustes\/\d+$/.test(pathname));
        }
        return includesRole(PIAR_EDITORS, role) && ["POST", "PUT", "DELETE"].includes(method);
    }

    if (/^\/api\/piar\/\d+\/dua(?:\/\d+)?$/.test(pathname)) {
        if (method === "GET") return /\/dua$/.test(pathname) && includesRole([...INSTITUTIONAL_ROLES, "Docente"], role);
        if (method === "POST") return /\/dua$/.test(pathname) && includesRole(PIAR_EDITORS, role);
        return method === "PUT" && /\/dua\/\d+$/.test(pathname) && includesRole(PIAR_EDITORS, role);
    }

    if (/^\/api\/piar\/\d+\/barreras$/.test(pathname)
        || /^\/api\/piar\/\d+\/ajustes\/\d+\/evidencias$/.test(pathname)) {
        if (method === "GET") return includesRole([...INSTITUTIONAL_ROLES, "Docente"], role);
        return method === "POST" && includesRole(PIAR_EDITORS, role);
    }

    const resource = pathname.match(/^\/api\/(diagnosticos|seguimientos|observaciones)(?:\/\d+)?$/)?.[1];
    if (resource) {
        if (method === "GET") return includesRole([...INSTITUTIONAL_ROLES, "Docente"], role);
        if (resource === "diagnosticos") {
            if (method === "POST") return ["Coordinador", "Psicóloga"].includes(role);
            if (method === "PUT") return includesRole(DIAGNOSIS_EDITORS, role);
            return method === "DELETE" && includesRole(DIAGNOSIS_REMOVERS, role);
        }
        // Observations and follow-ups are immutable once registered.
        if (method === "POST") return includesRole(resource === "observaciones" ? OBSERVATION_CREATORS : FOLLOW_UP_CREATORS, role);
        return false;
    }

    // Any role that can read a PIAR may persist a report of it; the API scopes Docente to assigned PIARs.
    if (pathname === "/api/reportes" && method === "POST") return includesRole([...INSTITUTIONAL_ROLES, "Docente"], role);

    if (["/api/historial", "/api/reportes", "/api/dashboard/resumen"].some(base => pathname === base || pathname.startsWith(`${base}/`))) {
        return method === "GET" && includesRole([...INSTITUTIONAL_ROLES, "Docente"], role);
    }

    return false;
}

function authorizationStatus(user, method, pathname) {
    if (!user) return 401;
    return canAccessRoleResource(user.rol, method, pathname) ? 200 : 403;
}

module.exports = { authorizationStatus, canAccessRoleResource };
