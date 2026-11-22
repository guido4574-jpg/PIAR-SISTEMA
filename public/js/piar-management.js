// PIAR lifecycle management: edit, close/reopen, teacher assignment and DUA.
// Every action is authorised again by the API; these checks only hide
// controls a role cannot use. Depends on helpers defined in app.js.

const DUA_PRINCIPLE_LABELS = Object.freeze({
    representacion: "Múltiples formas de representación",
    accion_expresion: "Múltiples formas de acción y expresión",
    implicacion: "Múltiples formas de implicación"
});

const PIAR_TEXT_FIELDS = [
    ["objetivo_general", "Objetivo general"],
    ["metas", "Metas"],
    ["caracterizacion", "Valoración pedagógica"],
    ["barreras", "Barreras identificadas (resumen)"],
    ["estrategias", "Estrategias de aula"],
    ["informes_salud", "Informes aportados"],
    ["proyectos", "Proyectos"],
    ["actividades_receso", "Continuidad durante recesos"],
    ["otra_informacion", "Otra información relevante"],
    ["acta_acuerdos", "Acta de acuerdos y compromisos"],
    ["informe_anual", "Informe anual"],
    ["entrega_pedagogica", "Entrega pedagógica"]
];

function sessionRole() {
    return currentSessionUser?.rol;
}

function findPiar(piarId) {
    return state.piars.find(item => Number(item.id) === Number(piarId));
}

function canEditPiarContent(piar) {
    return Boolean(piar) && piar.estado !== "cerrado"
        && ["Administrador", "Rector", "Coordinador", "Docente"].includes(sessionRole());
}

function canClosePiar(piar) {
    return Boolean(piar) && piar.estado !== "cerrado" && ["Administrador", "Rector", "Coordinador"].includes(sessionRole());
}

function canReopenPiar(piar) {
    return Boolean(piar) && piar.estado === "cerrado" && sessionRole() === "Coordinador";
}

function canManagePiarTeachers(piar) {
    return Boolean(piar) && ["Administrador", "Rector", "Coordinador"].includes(sessionRole());
}

function piarActionBar(piar) {
    const id = Number(piar.id);
    const buttons = [
        canEditPiarContent(piar) ? `<button class="btn-modern small-btn" type="button" data-onclick="openPiarEditModal(${id})">Editar PIAR</button>` : "",
        canManagePiarTeachers(piar) ? `<button class="table-btn" type="button" data-onclick="openPiarTeachersModal(${id})">Docentes asignados</button>` : "",
        canClosePiar(piar) ? `<button class="table-btn" type="button" data-onclick="openPiarStatusModal(${id}, 'cerrar')">Cerrar PIAR</button>` : "",
        canReopenPiar(piar) ? `<button class="table-btn" type="button" data-onclick="openPiarStatusModal(${id}, 'reabrir')">Reabrir PIAR</button>` : "",
        `<button class="table-btn" type="button" data-onclick="printPiarDetail()">Imprimir / Guardar PDF</button>`
    ].filter(Boolean);
    const closedNote = piar.estado === "cerrado"
        ? '<p class="auth-status-note" role="status">Este PIAR está cerrado. Solo Coordinación puede reabrirlo para registrar cambios.</p>'
        : "";
    return `<div class="piar-actions no-print" role="toolbar" aria-label="Acciones del PIAR">${buttons.join("")}</div>${closedNote}`;
}

function duaSection(piar) {
    const items = piar.dua || [];
    const editable = canEditPiarContent(piar);
    const groups = Object.entries(DUA_PRINCIPLE_LABELS).map(([principle, label]) => {
        const entries = items.filter(item => item.principio === principle);
        return `
            <div class="info-card wide-info">
                <h4>${escapeHTML(label)}</h4>
                ${entries.map(item => `
                    <p><strong>${escapeHTML(item.area || "Transversal")}:</strong> ${escapeHTML(item.estrategia)}</p>
                    ${item.recursos ? `<p><strong>Recursos:</strong> ${escapeHTML(item.recursos)}</p>` : ""}
                    <small>Registrada por ${escapeHTML(item.autor_nombre || "usuario institucional")}</small>
                    ${editable ? `<button class="table-btn no-print" type="button" data-onclick="openDuaModal(${Number(piar.id)}, ${Number(item.id_dua)})">Editar</button>` : ""}
                `).join("") || emptyState("Sin estrategias registradas para este principio.")}
            </div>`;
    }).join("");
    return `
        <div class="section-heading-row">
            <h3 class="section-title">Diseño Universal para el Aprendizaje (DUA)</h3>
            ${editable ? `<button class="table-btn no-print" type="button" data-onclick="openDuaModal(${Number(piar.id)})">Registrar estrategia DUA</button>` : ""}
        </div>
        ${groups}`;
}

function openPiarEditModal(piarId) {
    const piar = findPiar(piarId);
    if (!canEditPiarContent(piar)) return showToastMessage("No tienes permiso para editar este PIAR o está cerrado.", "warning");
    openModal("Editar PIAR", `
        <form class="modal-form" data-onsubmit="savePiarEdit(event, ${Number(piarId)})">
            <p class="trace-form-feedback" data-form-feedback id="piar-edit-error" role="alert" hidden></p>
            <div class="form-grid">
                <div><label for="piarEditTitle">Título</label><input id="piarEditTitle" class="input-modern" name="titulo" maxlength="150" required value="${escapeHTML(piar.titulo || "")}"></div>
                <div><label for="piarEditPeriod">Periodo</label><input id="piarEditPeriod" class="input-modern" name="periodo" maxlength="50" required value="${escapeHTML(piar.periodo || "")}"></div>
                <div><label for="piarEditYear">Año</label><input id="piarEditYear" class="input-modern" name="anio" type="number" min="2000" max="2100" required value="${escapeHTML(piar.anio || "")}"></div>
                <div><label for="piarEditReview">Fecha de revisión</label><input id="piarEditReview" class="input-modern" name="fecha_revision" type="date" value="${escapeHTML(String(piar.fecha_revision || piar.fechaRevision || "").slice(0, 10))}"></div>
            </div>
            ${PIAR_TEXT_FIELDS.map(([name, label]) => `
                <label for="piarEdit_${name}">${escapeHTML(label)}</label>
                <textarea id="piarEdit_${name}" class="input-modern" name="${name}" maxlength="20000">${escapeHTML(piar[name] ?? (name === "barreras" ? piar.barreras_texto : "") ?? "")}</textarea>`).join("")}
            <label for="piarEditJustification">Justificación del cambio</label>
            <textarea id="piarEditJustification" class="input-modern" name="justificacion" maxlength="1000" required aria-describedby="piar-edit-error" placeholder="Motivo pedagógico de la actualización (queda en el historial de versiones)"></textarea>
            <button class="btn-modern" type="submit">Guardar cambios</button>
        </form>`);
}

async function savePiarEdit(event, piarId) {
    event.preventDefault();
    const form = beginTraceFormSubmission(event);
    if (!form) return;
    try {
        if (!validateTraceForm(form, [["justificacion", "La justificación"]])) return;
        const data = formData(form);
        const piar = findPiar(piarId);
        // Solo se envían los campos que cambiaron. Un campo opcional que se vació
        // se envía vacío y el servidor lo guarda vacío; los obligatorios no se vacían.
        const payload = { justificacion: data.justificacion };
        for (const [name] of [["titulo"], ["periodo"], ["anio"], ["fecha_revision"], ...PIAR_TEXT_FIELDS]) {
            const current = name === "barreras" ? piar.barreras_texto : name === "fecha_revision" ? String(piar.fecha_revision || "").slice(0, 10) : piar[name];
            const next = String(data[name] ?? "").trim();
            if (next !== String(current ?? "").trim()) payload[name] = next;
        }
        const result = await apiUpdate("piar", Number(piarId), payload);
        await refreshPiarInState(piarId);
        closeModal();
        viewPIAR(Number(piarId));
        showToastMessage(result.data?.unchanged ? "No había cambios para guardar." : "PIAR actualizado y versionado.");
    } catch (error) { showTraceFormError(form, error); }
    finally { endTraceFormSubmission(form); }
}

function openPiarStatusModal(piarId, action) {
    const piar = findPiar(piarId);
    const closing = action === "cerrar";
    if (closing ? !canClosePiar(piar) : !canReopenPiar(piar)) return showToastMessage("No tienes permiso para esta acción.", "warning");
    openModal(closing ? "Cerrar PIAR" : "Reabrir PIAR", `
        <form class="modal-form" data-onsubmit="savePiarStatus(event, ${Number(piarId)}, '${closing ? "cerrar" : "reabrir"}')">
            <p class="trace-form-feedback" data-form-feedback id="piar-status-error" role="alert" hidden></p>
            <p>${closing ? "Al cerrar el PIAR no se podrán registrar cambios hasta que Coordinación lo reabra." : "El PIAR quedará en revisión y se podrán registrar cambios."}</p>
            <label for="piarStatusJustification">Justificación</label>
            <textarea id="piarStatusJustification" class="input-modern" name="justificacion" maxlength="1000" required aria-describedby="piar-status-error"></textarea>
            <button class="btn-modern" type="submit">${closing ? "Cerrar PIAR" : "Reabrir PIAR"}</button>
        </form>`);
}

async function savePiarStatus(event, piarId, action) {
    event.preventDefault();
    const form = beginTraceFormSubmission(event);
    if (!form) return;
    try {
        if (!validateTraceForm(form, [["justificacion", "La justificación"]])) return;
        const { justificacion } = formData(form);
        if (action === "cerrar") await apiRequest(`piar/${Number(piarId)}`, "DELETE", { justificacion });
        else await apiCreate(`piar/${Number(piarId)}/reapertura`, { justificacion });
        await refreshPiarInState(piarId);
        closeModal();
        renderApp(currentView);
        viewPIAR(Number(piarId));
        showToastMessage(action === "cerrar" ? "PIAR cerrado." : "PIAR reabierto en revisión.");
    } catch (error) { showTraceFormError(form, error); }
    finally { endTraceFormSubmission(form); }
}

function openPiarTeachersModal(piarId) {
    const piar = findPiar(piarId);
    if (!canManagePiarTeachers(piar)) return showToastMessage("No tienes permiso para gestionar docentes.", "warning");
    const assigned = piar.docentes || [];
    const assignedIds = new Set(assigned.map(item => Number(item.id_docente)));
    const available = state.teachers.filter(teacher => !assignedIds.has(Number(teacher.id)) && (teacher.estado || "activo") === "activo");
    openModal("Docentes asignados al PIAR", `
        <div class="modal-form">
            ${assigned.map(item => `
                <div class="info-card wide-info">
                    <h4>${escapeHTML(item.nombre)}${Number(item.es_responsable_principal) === 1 ? " · Responsable principal" : ""}</h4>
                    <p>${escapeHTML(item.area || "Sin área")}</p>
                    <button class="table-btn" type="button" data-onclick="removePiarTeacher(${Number(piarId)}, ${Number(item.id_docente)})">Retirar</button>
                </div>`).join("") || emptyState("Este PIAR no tiene docentes asignados.")}
        </div>
        <form class="modal-form" data-onsubmit="assignPiarTeacher(event, ${Number(piarId)})">
            <p class="trace-form-feedback" data-form-feedback id="piar-teacher-error" role="alert" hidden></p>
            <label for="piarTeacherSelect">Asignar docente</label>
            <select id="piarTeacherSelect" class="input-modern" name="id_docente" required>
                <option value="">Selecciona un docente activo</option>
                ${available.map(teacher => `<option value="${Number(teacher.id)}">${escapeHTML(fullTeacherName(teacher))} · ${escapeHTML(teacher.area || "")}</option>`).join("")}
            </select>
            <label><input type="checkbox" name="es_responsable_principal" value="1"> Responsable principal</label>
            <button class="btn-modern" type="submit" ${available.length ? "" : "disabled"}>Asignar</button>
        </form>`);
}

async function assignPiarTeacher(event, piarId) {
    event.preventDefault();
    const form = beginTraceFormSubmission(event);
    if (!form) return;
    try {
        if (!validateTraceForm(form, [["id_docente", "El docente"]])) return;
        const data = formData(form);
        await apiCreate(`piar/${Number(piarId)}/docentes`, { id_docente: Number(data.id_docente), es_responsable_principal: data.es_responsable_principal === "1" });
        await refreshPiarInState(piarId);
        openPiarTeachersModal(piarId);
        showToastMessage("Docente asignado.");
    } catch (error) { showTraceFormError(form, error); }
    finally { endTraceFormSubmission(form); }
}

async function removePiarTeacher(piarId, teacherId) {
    if (!window.confirm("¿Retirar a este docente del PIAR? Perderá el acceso a su información.")) return;
    try {
        await apiRequest(`piar/${Number(piarId)}/docentes`, "DELETE", { id_docente: Number(teacherId) });
        await refreshPiarInState(piarId);
        openPiarTeachersModal(piarId);
        showToastMessage("Docente retirado del PIAR.");
    } catch (error) {
        showToastMessage(error.message, "warning");
    }
}

function openDuaModal(piarId, duaId) {
    const piar = findPiar(piarId);
    if (!canEditPiarContent(piar)) return showToastMessage("No tienes permiso para editar este PIAR o está cerrado.", "warning");
    const current = duaId ? (piar.dua || []).find(item => Number(item.id_dua) === Number(duaId)) : null;
    const areas = ["", ...(state.areas || [])];
    openModal(current ? "Editar estrategia DUA" : "Registrar estrategia DUA", `
        <form class="modal-form" data-onsubmit="saveDua(event, ${Number(piarId)}, ${current ? Number(current.id_dua) : "null"})">
            <p class="trace-form-feedback" data-form-feedback id="dua-form-error" role="alert" hidden></p>
            <label for="duaPrinciple">Principio DUA</label>
            <select id="duaPrinciple" class="input-modern" name="principio" required>
                ${Object.entries(DUA_PRINCIPLE_LABELS).map(([value, label]) => `<option value="${value}" ${current?.principio === value ? "selected" : ""}>${escapeHTML(label)}</option>`).join("")}
            </select>
            <label for="duaArea">Área</label>
            <select id="duaArea" class="input-modern" name="area">${areas.map(area => `<option value="${escapeHTML(area)}" ${(current?.area || "") === area ? "selected" : ""}>${escapeHTML(area || "Sin área específica")}</option>`).join("")}</select>
            <label for="duaStrategy">Estrategia</label>
            <textarea id="duaStrategy" class="input-modern" name="estrategia" required maxlength="20000" aria-describedby="dua-form-error">${escapeHTML(current?.estrategia || "")}</textarea>
            <label for="duaResources">Recursos y apoyos</label>
            <textarea id="duaResources" class="input-modern" name="recursos" maxlength="20000">${escapeHTML(current?.recursos || "")}</textarea>
            <button class="btn-modern" type="submit">Guardar estrategia</button>
        </form>`);
}

async function saveDua(event, piarId, duaId) {
    event.preventDefault();
    const form = beginTraceFormSubmission(event);
    if (!form) return;
    try {
        if (!validateTraceForm(form, [["estrategia", "La estrategia"]])) return;
        const payload = formData(form);
        if (duaId) await apiUpdate(`piar/${Number(piarId)}/dua`, Number(duaId), payload);
        else await apiCreate(`piar/${Number(piarId)}/dua`, payload);
        await refreshPiarInState(piarId);
        closeModal();
        viewPIAR(Number(piarId));
        showToastMessage("Estrategia DUA guardada.");
    } catch (error) { showTraceFormError(form, error); }
    finally { endTraceFormSubmission(form); }
}

function printPiarDetail() {
    document.body.classList.add("printing-piar");
    window.addEventListener("afterprint", () => document.body.classList.remove("printing-piar"), { once: true });
    window.print();
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { DUA_PRINCIPLE_LABELS, canEditPiarContent, canClosePiar, canReopenPiar, canManagePiarTeachers, piarActionBar, duaSection };
}
