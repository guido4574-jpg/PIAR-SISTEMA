// Administración de cuentas (solo Administrador): consultar, filtrar, crear
// (decisión D3: Docente, Psicólogo(a), Coordinador o Rector, con verificación del
// correo y aprobación posterior), editar nombre/correo (D1), desactivar y
// reactivar. El rol de una cuenta existente no se cambia desde la interfaz.
// Depende de funciones auxiliares de app.js.

const USER_STATE_LABELS = Object.freeze({
    activo: "Activo",
    inactivo: "Inactivo",
    pendiente: "Pendiente de aprobación",
    pendiente_verificacion: "Pendiente de verificar correo",
    rechazado: "Rechazado"
});

let userAdminCache = [];

async function renderUserAdministration() {
    const root = document.getElementById("viewRoot");
    if (!root) return;
    if (currentSessionUser?.rol !== "Administrador") {
        root.innerHTML = '<div class="table-card"><p>No tienes autorización para administrar usuarios.</p></div>';
        return;
    }
    root.innerHTML = '<div class="table-card"><p role="status">Cargando usuarios…</p></div>';
    try {
        const result = await apiGetUsers();
        userAdminCache = result.data || [];
        root.innerHTML = `
            <div class="table-card">
                <div class="table-header">
                    <h3>Cuentas institucionales</h3>
                    <span>${userAdminCache.length} cuentas</span>
                    <button class="btn-modern small-btn" type="button" data-onclick="openUserCreateModal()">Nueva cuenta</button>
                </div>
                <div class="form-grid">
                    <div><label for="userFilterText">Buscar</label><input id="userFilterText" class="input-modern" type="search" placeholder="Nombre, correo o documento" data-oninput="filterUserAdministration()"></div>
                    <div><label for="userFilterState">Estado</label><select id="userFilterState" class="input-modern" data-onchange="filterUserAdministration()">
                        <option value="">Todos</option>
                        ${Object.entries(USER_STATE_LABELS).map(([value, label]) => `<option value="${value}">${escapeHTML(label)}</option>`).join("")}
                    </select></div>
                </div>
                <div id="userAdminTable">${userAdminTable(userAdminCache)}</div>
            </div>`;
    } catch {
        root.innerHTML = '<div class="table-card"><p role="alert">No se pudieron cargar los usuarios.</p><button class="table-btn" type="button" data-onclick="renderUserAdministration()">Reintentar</button></div>';
    }
}

function filterUserAdministration() {
    const text = String(document.getElementById("userFilterText")?.value || "").trim().toLowerCase();
    const stateFilter = document.getElementById("userFilterState")?.value || "";
    const filtered = userAdminCache.filter(user => (!stateFilter || user.estado === stateFilter)
        && (!text || [user.nombre, user.correo, user.documento].some(value => String(value || "").toLowerCase().includes(text))));
    const table = document.getElementById("userAdminTable");
    if (table) table.innerHTML = userAdminTable(filtered);
}

function userAdminTable(users) {
    if (!users.length) return emptyState("No hay cuentas con ese criterio.");
    return `<div class="responsive-table"><table class="modern-table">
        <thead><tr><th>Nombre</th><th>Correo</th><th>Documento</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th>Acciones</th></tr></thead>
        <tbody>${users.map(user => {
            const id = Number(user.id_usuario);
            const self = id === Number(currentSessionUser?.id);
            return `<tr>
                <td>${escapeHTML(user.nombre)}</td>
                <td>${escapeHTML(user.correo)}</td>
                <td>${escapeHTML(user.documento)}</td>
                <td>${escapeHTML(typeof roleLabel === "function" ? roleLabel(user.rol) : user.rol)}</td>
                <td>${escapeHTML(USER_STATE_LABELS[user.estado] || user.estado)}</td>
                <td>${escapeHTML(user.ultimo_acceso_at ? formatVersionDate(user.ultimo_acceso_at) : "Sin registro")}</td>
                <td>
                    <button class="table-btn" type="button" data-onclick="openUserEditModal(${id})">Editar</button>
                    ${user.estado === "activo" && !self ? `<button class="table-btn" type="button" data-onclick="changeUserState(${id}, 'desactivar')">Desactivar</button>` : ""}
                    ${user.estado === "inactivo" ? `<button class="table-btn" type="button" data-onclick="changeUserState(${id}, 'reactivar')">Reactivar</button>` : ""}
                </td>
            </tr>`;
        }).join("")}</tbody></table></div>`;
}

function openUserEditModal(userId) {
    const user = userAdminCache.find(item => Number(item.id_usuario) === Number(userId));
    if (!user) return;
    openModal("Editar cuenta", `
        <form class="modal-form" data-onsubmit="saveUserEdit(event, ${Number(userId)})">
            <p class="trace-form-feedback" data-form-feedback id="user-edit-error" role="alert" hidden></p>
            <label for="userEditName">Nombre completo</label>
            <input id="userEditName" class="input-modern" name="nombre" maxlength="150" required value="${escapeHTML(user.nombre)}">
            <label for="userEditEmail">Correo</label>
            <input id="userEditEmail" class="input-modern" name="correo" type="email" maxlength="150" required value="${escapeHTML(user.correo)}">
            <small>Si cambias el correo, se enviará un enlace de verificación al nuevo; el actual sigue vigente hasta que se confirme.</small>
            <small>El perfil (${escapeHTML(typeof roleLabel === "function" ? roleLabel(user.rol) : user.rol)}) no se cambia desde esta ventana.</small>
            <button class="btn-modern" type="submit">Guardar</button>
        </form>`);
}

const USER_CREATE_HELP = Object.freeze({
    staff: "La cuenta queda pendiente de aprobación en «Solicitudes»; no se envía enlace de verificación. La contraseña temporal debe cambiarse en el primer acceso.",
    student: "La cuenta queda vinculada al estudiante seleccionado. Al verificar su correo puede ingresar con la contraseña temporal, que debe cambiar en el primer acceso. Solo verá su propio PIAR."
});

// Estudiantes activos sin cuenta vinculada (el servidor vuelve a comprobarlo).
function studentAccountOptions() {
    const students = (typeof state !== "undefined" && Array.isArray(state.students)) ? state.students : [];
    return students
        .filter(student => student.estado === "activo" && student.cuenta_vinculada === false)
        .map(student => `<option value="${Number(student.id_estudiante || student.id)}">${escapeHTML(fullName(student))} · ${escapeHTML(student.documento || "")}</option>`)
        .join("");
}

function toggleStudentAccountFields(select) {
    const studentRole = select?.value === "Estudiante";
    const fields = document.getElementById("userCreateStudentFields");
    if (fields) { fields.hidden = !studentRole; fields.disabled = !studentRole; }
    const help = document.getElementById("userCreateHelp");
    if (help) help.textContent = studentRole ? USER_CREATE_HELP.student : USER_CREATE_HELP.staff;
}

function prefillStudentAccount(select) {
    const students = (typeof state !== "undefined" && Array.isArray(state.students)) ? state.students : [];
    const student = students.find(item => Number(item.id_estudiante || item.id) === Number(select?.value));
    if (!student) return;
    const fill = (id, value) => { const input = document.getElementById(id); if (input && value) input.value = value; };
    fill("userCreateName", student.nombres);
    fill("userCreateLastName", student.apellidos);
    fill("userCreateDocument", student.documento);
}

function openUserCreateModal() {
    if (currentSessionUser?.rol !== "Administrador") return;
    openModal("Nueva cuenta", `
        <form class="modal-form" data-onsubmit="saveUserCreate(event)">
            <p class="trace-form-feedback" data-form-feedback id="user-create-error" role="alert" hidden></p>
            <div class="form-grid">
                <div><label for="userCreateName">Nombre</label><input id="userCreateName" class="input-modern" name="nombre" maxlength="100" required autocomplete="off"></div>
                <div><label for="userCreateLastName">Apellidos</label><input id="userCreateLastName" class="input-modern" name="apellidos" maxlength="100" required autocomplete="off"></div>
                <div><label for="userCreateDocument">Documento</label><input id="userCreateDocument" class="input-modern" name="documento" maxlength="30" required autocomplete="off"></div>
                <div><label for="userCreateEmail">Correo</label><input id="userCreateEmail" class="input-modern" name="correo" type="email" maxlength="150" required autocomplete="off"></div>
                <div><label for="userCreateRole">Perfil</label><select id="userCreateRole" class="input-modern" name="rol" required data-onchange="toggleStudentAccountFields(this)">${requestableRoleOptions("Docente")}<option value="Estudiante">Estudiante</option></select></div>
                <div><label for="userCreatePassword">Contraseña temporal</label><input id="userCreatePassword" class="input-modern" name="password" type="password" minlength="14" maxlength="72" required autocomplete="new-password"></div>
            </div>
            <fieldset id="userCreateStudentFields" class="form-grid" hidden disabled>
                <legend>Vinculación con el estudiante</legend>
                <div><label for="userCreateStudent">Estudiante</label><select id="userCreateStudent" class="input-modern" name="id_estudiante" required data-onchange="prefillStudentAccount(this)"><option value="">Seleccione un estudiante</option>${studentAccountOptions()}</select></div>
                <div class="checkbox-field"><input id="userCreateGuardianConsent" name="autorizacion_acudiente" type="checkbox" required><label for="userCreateGuardianConsent">La institución cuenta con la autorización del acudiente para el tratamiento de los datos del estudiante.</label></div>
            </fieldset>
            <small id="userCreateHelp">${USER_CREATE_HELP.staff}</small>
            <button class="btn-modern" type="submit">Crear cuenta</button>
        </form>`);
}

async function saveUserCreate(event) {
    event.preventDefault();
    const form = beginTraceFormSubmission(event);
    if (!form) return;
    try {
        if (!validateTraceForm(form, [["nombre", "El nombre"], ["apellidos", "Los apellidos"], ["documento", "El documento"], ["correo", "El correo"], ["password", "La contraseña temporal"]])) return;
        const result = await apiCreate("users", formData(form));
        closeModal();
        await renderUserAdministration();
        showToastMessage(result?.message || "Cuenta creada.");
    } catch (error) { showTraceFormError(form, error); }
    finally { endTraceFormSubmission(form); }
}

async function saveUserEdit(event, userId) {
    event.preventDefault();
    const form = beginTraceFormSubmission(event);
    if (!form) return;
    try {
        if (!validateTraceForm(form, [["nombre", "El nombre"], ["correo", "El correo"]])) return;
        const result = await apiUpdate("users", Number(userId), formData(form));
        closeModal();
        await renderUserAdministration();
        // Con cambio de correo, el actual sigue vigente hasta que se confirme el nuevo.
        showToastMessage(result?.message || "Cuenta actualizada.");
    } catch (error) { showTraceFormError(form, error); }
    finally { endTraceFormSubmission(form); }
}

async function changeUserState(userId, action) {
    const message = action === "desactivar"
        ? "¿Desactivar esta cuenta? Se cerrarán sus sesiones y no podrá ingresar."
        : "¿Reactivar esta cuenta?";
    if (!window.confirm(message)) return;
    try {
        if (action === "desactivar") await apiDelete("users", Number(userId));
        else await apiCreate(`users/${Number(userId)}/reactivacion`, {});
        await renderUserAdministration();
        showToastMessage(action === "desactivar" ? "Cuenta desactivada." : "Cuenta reactivada.");
    } catch (error) {
        showToastMessage(error.message || "No fue posible actualizar la cuenta.", "warning");
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { USER_STATE_LABELS, userAdminTable, studentAccountOptions, toggleStudentAccountFields };
}
