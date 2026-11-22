// Estudiante: read-only view of the student's own PIAR. The API already limits
// the data to the session student and drops diagnoses, professional
// observations, follow-ups, versions and health reports; this view only avoids
// offering sections or controls the role cannot use. Depends on helpers
// defined in app.js and piar-management.js.

function studentPiarProgress(piar) {
    const values = (piar.ajustes || []).map(ajuste => Number(ajuste.avance || 0));
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function studentPiarTeacherName(piar) {
    const principal = (piar.docentes || []).find(docente => Number(docente.id_docente) === Number(piar.teacherId)) || piar.docentes?.[0];
    return principal?.nombre || "Sin asignar";
}

function studentPiarCards(piars) {
    if (!piars.length) {
        return emptyState("Aún no tienes un PIAR registrado. Si crees que es un error, consulta con Coordinación.");
    }
    return piars.map(piar => {
        const progress = studentPiarProgress(piar);
        return `
            <div class="piar-card">
                <div class="piar-top">
                    <h3>${escapeHTML(piar.titulo || "PIAR")}</h3>
                    <span class="piar-status ${statusClass(piar.estado)}">${escapeHTML(labelStatus(piar.estado))}</span>
                </div>
                <p>${escapeHTML(piar.objetivoGeneral || piar.objetivo_general || "")}</p>
                <div class="detail-list">
                    <span><strong>Docente:</strong> ${escapeHTML(studentPiarTeacherName(piar))}</span>
                    <span><strong>Periodo:</strong> ${escapeHTML(piar.periodo)}</span>
                    <span><strong>Revisión:</strong> ${escapeHTML(piar.fechaRevision || "")}</span>
                </div>
                <div class="progress-section">
                    <div class="progress-info"><span>Implementación</span><span>${progress}%</span></div>
                    <div class="progress-bar"><div class="progress-fill" style="width:${Number(progress) || 0}%"></div></div>
                </div>
                <div class="student-actions">
                    <button class="btn-modern small-btn" type="button" data-onclick="viewOwnPIAR(${Number(piar.id)})">Ver mi PIAR</button>
                </div>
            </div>
        `;
    }).join("");
}

function renderStudentPIAR() {
    document.getElementById("viewRoot").innerHTML = `
        <p class="auth-status-note" role="status">Consulta de solo lectura. Si necesitas un cambio en tu PIAR, habla con tu docente o con Coordinación.</p>
        <div id="piarGrid" class="piar-grid">
            ${studentPiarCards(state.piars)}
        </div>
    `;
}

function studentDuaSection(piar) {
    const items = piar.dua || [];
    if (!items.length) return "";
    return `
        <h3 class="section-title">Diseño Universal para el Aprendizaje (DUA)</h3>
        ${Object.entries(DUA_PRINCIPLE_LABELS).map(([principle, label]) => {
            const entries = items.filter(item => item.principio === principle);
            return entries.length ? `
                <div class="info-card wide-info">
                    <h4>${escapeHTML(label)}</h4>
                    ${entries.map(item => `
                        <p><strong>${escapeHTML(item.area || "Transversal")}:</strong> ${escapeHTML(item.estrategia)}</p>
                        ${item.recursos ? `<p><strong>Recursos:</strong> ${escapeHTML(item.recursos)}</p>` : ""}
                    `).join("")}
                </div>` : "";
        }).join("")}`;
}

function viewOwnPIAR(piarId) {
    const piar = state.piars.find(item => Number(item.id) === Number(piarId));
    if (!piar) return showToastMessage("No se encontró el PIAR.", "warning");
    const studentName = piar.estudiante?.nombre || currentSessionUser?.nombre || "Estudiante";

    openModal("Mi PIAR", `
        <div class="piar-detail">
            <div class="student-avatar large-avatar">${escapeHTML(initials(studentName))}</div>
            <h2>${escapeHTML(studentName)}</h2>
            <p>${escapeHTML(piar.periodo)} | ${escapeHTML(labelStatus(piar.estado))} | Avance ${studentPiarProgress(piar)}%</p>
            <div class="piar-actions no-print" role="toolbar" aria-label="Acciones del PIAR">
                <button class="table-btn" type="button" data-onclick="printPiarDetail()">Imprimir / Guardar PDF</button>
            </div>
            <div class="profile-info">
                ${infoCard("Docente responsable", studentPiarTeacherName(piar))}
                ${infoCard("Fecha de revisión", piar.fechaRevision)}
                ${infoCard("Objetivo general", piar.objetivoGeneral)}
                ${infoCard("Metas", piar.metas)}
                ${infoCard("Valoración pedagógica", piar.caracterizacion)}
                ${infoCard("Barreras identificadas", piar.barreras_texto)}
                ${infoCard("Estrategias de aula", piar.estrategias)}
                ${infoCard("Proyectos", piar.proyectos)}
                ${infoCard("Continuidad durante recesos", piar.actividades_receso)}
                ${infoCard("Otra información relevante", piar.otra_informacion)}
                ${infoCard("Acta de acuerdos y compromisos", piar.acta_acuerdos)}
                ${infoCard("Informe anual", piar.informe_anual)}
                ${infoCard("Entrega pedagógica", piar.entrega_pedagogica)}
            </div>
            ${studentDuaSection(piar)}
            <h3 class="section-title">Barreras identificadas en contexto</h3>
            ${(piar.barreras || []).map(barrier => `
                <div class="info-card wide-info">
                    <h4>${escapeHTML(barrier.contexto)} · ${escapeHTML(barrier.fecha_identificacion)}</h4>
                    <p>${escapeHTML(barrier.descripcion)}</p>
                    ${barrier.actividad ? `<p><strong>Actividad:</strong> ${escapeHTML(barrier.actividad)}</p>` : ""}
                    ${barrier.condicion_entorno ? `<p><strong>Condición del entorno:</strong> ${escapeHTML(barrier.condicion_entorno)}</p>` : ""}
                </div>
            `).join("") || emptyState("No hay barreras registradas.")}
            <h3 class="section-title">Ajustes razonables</h3>
            ${(piar.ajustes || []).map(ajuste => `
                <div class="info-card wide-info">
                    <h4>${escapeHTML(ajuste.area)} - ${escapeHTML(ajuste.tipo)}</h4>
                    <p><strong>Estrategia:</strong> ${escapeHTML(ajuste.estrategia)}</p>
                    ${ajuste.recursos ? `<p><strong>Recursos:</strong> ${escapeHTML(ajuste.recursos)}</p>` : ""}
                    <p><strong>Responsable:</strong> ${escapeHTML(ajuste.responsable_usuario_nombre || ajuste.responsable || "Sin responsable identificado")}</p>
                    ${ajuste.resultado_esperado ? `<p><strong>Resultado esperado:</strong> ${escapeHTML(ajuste.resultado_esperado)}</p>` : ""}
                    ${ajuste.indicador_logro ? `<p><strong>Indicador de logro:</strong> ${escapeHTML(ajuste.indicador_logro)}</p>` : ""}
                    ${ajuste.fecha_revision_prevista ? `<p><strong>Revisión prevista:</strong> ${escapeHTML(ajuste.fecha_revision_prevista)}</p>` : ""}
                    <p><strong>Avance:</strong> ${escapeHTML(ajuste.avance)}%</p>
                    ${(ajuste.evidencias || []).map(evidence => `<p><strong>Evidencia · ${escapeHTML(evidence.fecha)}:</strong> ${escapeHTML(evidence.descripcion)}</p>`).join("")}
                </div>
            `).join("") || emptyState("No hay ajustes razonables registrados.")}
        </div>
    `);
}

if (typeof module !== "undefined") {
    module.exports = { studentPiarCards, studentPiarProgress, viewOwnPIAR, renderStudentPIAR };
}
