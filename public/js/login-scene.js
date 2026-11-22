// Escena animada de la pantalla de acceso del Sistema PIAR.
// Referencias: video de la lámpara con cordón (movimiento), «PIAR LOGIN.png»
// (composición: lámpara, libro abierto, haz, tarjetas de cristal) y «DAS PIAR.png»
// (identidad: personas que surgen del libro, lema de inclusión).
//
// Secuencia: el cordón da un tirón, el foco parpadea y se enciende, la luz llena la
// habitación, el libro se abre, sale un resplandor con partículas y una estela que
// asciende hacia cuatro tarjetas de cristal con símbolos de inclusión.
//
// Reglas:
// - Decorativa: todo el arte está en aria-hidden. El único control es el cordón, un
//   botón real que cambia el tono de la luz (lila, turquesa, cálido); nunca oculta el
//   formulario ni es necesario para acceder.
// - El estado final (luz encendida, libro abierto) es el estado base del CSS. Sin
//   animaciones (prefers-reduced-motion o fallo) se ve la escena final estática.
// - Sin recursos externos: SVG en línea y CSS 3D, compatible con la CSP.
(function exposeLoginScene(global) {
    "use strict";

    const TONES = Object.freeze(["lila", "turquesa", "calida"]);
    // Tras ~25 s se pausan los bucles decorativos para ahorrar recursos.
    const REST_AFTER_MS = 25000;
    let introPlayed = false;
    let chosenTone = null;
    let restTimer = null;

    // Tarjetas de cristal (PIAR LOGIN.png): personas, mente, rompecabezas y libro.
    const TILES = [
        '<svg viewBox="0 0 24 24" focusable="false"><circle cx="8" cy="8" r="3"/><circle cx="16.5" cy="9" r="2.5"/><path d="M2.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><path d="M13.5 15.2c.9-.8 1.9-1.2 3-1.2 2.3 0 4 1.6 4.5 4.5"/></svg>',
        '<svg viewBox="0 0 24 24" focusable="false"><path d="M9 20v-3.2A7 7 0 1 1 18 11c0 1 .6 1.5 1.4 2.3L18 14v2.5a1.5 1.5 0 0 1-1.5 1.5H15v2"/><circle cx="11.5" cy="10" r="2.2"/><path d="M11.5 6.6v1.2M11.5 12.2v1.2M8.1 10h1.2M13.9 10h1.2"/></svg>',
        '<svg viewBox="0 0 24 24" focusable="false"><path d="M4 9h3.2a2 2 0 1 1 3.6 0H14v3.2a2 2 0 1 0 0 3.6V19H4v-3.2a2 2 0 1 0 0-3.6z"/><path d="M14 9h2.8a2 2 0 1 1 3.2 0V19h-6"/></svg>',
        '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 6.5c-2-1.4-4.6-2-8-1.8v12.6c3.4-.2 6 .4 8 1.8 2-1.4 4.6-2 8-1.8V4.7c-3.4-.2-6 .4-8 1.8z"/><path d="M12 6.5v12.6M6.5 9.2c1.3 0 2.6.3 3.6.8M6.5 12.4c1.3 0 2.6.3 3.6.8M13.9 10c1-.5 2.3-.8 3.6-.8M13.9 13.2c1-.5 2.3-.8 3.6-.8"/></svg>'
    ];

    // Ilustraciones de las páginas (PIAR LOGIN.png): corazón-rompecabezas y personas,
    // incluida una en silla de ruedas; birrete y mano con corazón.
    const PAGE_LEFT = `
        <svg class="auth-book-art" viewBox="0 0 100 130" focusable="false">
            <path d="M50 46s-17-10-17-22a9 9 0 0 1 17-4 9 9 0 0 1 17 4c0 12-17 22-17 22z" fill="#C9B6FF"/>
            <path d="M50 20v8a3.5 3.5 0 1 0 0 7v8" stroke="#FFFDF7" stroke-width="2.4" fill="none"/>
            <g fill="#8B6CF5">
                <circle cx="22" cy="72" r="4.2"/><path d="M16 96l2.5-17h7l2.5 17h-3l-2-11-2 11z"/>
                <circle cx="40" cy="74" r="4"/><path d="M36 80h7l1 8h7l3 8h-3l-2.4-5H38z"/>
                <circle cx="44" cy="99" r="5.5" fill="none" stroke="#8B6CF5" stroke-width="2.2"/>
                <circle cx="62" cy="72" r="4.2"/><path d="M56 96l2.5-17h7l2.5 17h-3l-2-11-2 11z"/>
                <circle cx="79" cy="75" r="3.6"/><path d="M74 96l2.2-15h6l2.2 15h-2.6l-1.8-9.5-1.8 9.5z"/>
            </g>
        </svg>`;

    const PAGE_RIGHT = `
        <svg class="auth-book-art" viewBox="0 0 100 130" focusable="false">
            <path d="M50 18l28 11-28 11-28-11z" fill="#8B6CF5"/>
            <path d="M33 34v9c0 4 7.6 7 17 7s17-3 17-7v-9" fill="#A68BFA"/>
            <path d="M76 30v12" stroke="#8B6CF5" stroke-width="2.4" stroke-linecap="round"/>
            <path d="M50 92s-11-6.5-11-14a6 6 0 0 1 11-3 6 6 0 0 1 11 3c0 7.5-11 14-11 14z" fill="#C9B6FF"/>
            <path d="M22 98c7 0 10 4 18 4h18c3 0 3 4 0 4H44M22 106c9 2 16 6 26 6 7 0 22-9 28-13 2.5-1.6.5-4.6-2-3.4l-14 7" fill="none" stroke="#8B6CF5" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;

    // Lámpara de escritorio en coordenadas del escenario (600 × 450).
    const LAMP = `
        <svg class="auth-scene-lamp" viewBox="0 0 600 450" preserveAspectRatio="xMidYMid meet" focusable="false">
            <defs>
                <linearGradient id="piarBeam" gradientUnits="userSpaceOnUse" x1="192" y1="128" x2="420" y2="400">
                    <stop offset="0" class="auth-luz-stop" stop-opacity="0.85"/>
                    <stop offset="0.6" class="auth-luz-stop" stop-opacity="0.28"/>
                    <stop offset="1" class="auth-luz-stop" stop-opacity="0.04"/>
                </linearGradient>
                <radialGradient id="piarBulb" cx="0.5" cy="0.5" r="0.5">
                    <stop offset="0" stop-color="#FFFFFF"/>
                    <stop offset="0.5" stop-color="#FFF6E2"/>
                    <stop offset="1" class="auth-luz-stop" stop-opacity="0"/>
                </radialGradient>
                <linearGradient id="piarShade" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stop-color="#2A3160"/>
                    <stop offset="1" stop-color="#0D1230"/>
                </linearGradient>
                <linearGradient id="piarArm" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stop-color="#2C3466"/>
                    <stop offset="1" stop-color="#121735"/>
                </linearGradient>
            </defs>
            <polygon class="auth-lamp-beam" points="146,161 240,94 572,352 262,442" fill="url(#piarBeam)"/>
            <g class="auth-lamp-body">
                <ellipse cx="100" cy="414" rx="66" ry="11" fill="#04061A" opacity="0.6"/>
                <path d="M46 404c0-10 24-16 54-16s54 6 54 16v4c0 4-24 8-54 8s-54-4-54-8z" fill="url(#piarArm)"/>
                <path d="M96 396 L60 215" stroke="url(#piarArm)" stroke-width="11" stroke-linecap="round"/>
                <path d="M60 215 L154 89" stroke="url(#piarArm)" stroke-width="10" stroke-linecap="round"/>
                <circle cx="96" cy="396" r="8" fill="#141938" class="auth-luz-stroke" stroke-width="2.5"/>
                <circle cx="60" cy="215" r="10" fill="#141938" class="auth-luz-stroke" stroke-width="3"/>
                <g transform="translate(170 95) rotate(-35)">
                    <circle class="auth-lamp-bulb" cx="0" cy="36" r="30" fill="url(#piarBulb)"/>
                    <path d="M-60 40 C-60 -24 60 -24 60 40 Z" fill="url(#piarShade)"/>
                    <path d="M-50 14 C-42 -8 -20 -16 0 -16" stroke="rgba(255,255,255,0.18)" stroke-width="4" stroke-linecap="round" fill="none"/>
                    <path d="M-60 40 L60 40" class="auth-luz-stroke" stroke-width="3.5" stroke-linecap="round"/>
                    <circle cx="-14" cy="-16" r="7" fill="#141938" class="auth-luz-stroke" stroke-width="2.5"/>
                </g>
            </g>
        </svg>`;

    // Estela de luz que asciende del libro a las tarjetas, y conector punteado entre ellas.
    const TRAIL = `
        <svg class="auth-scene-trail" viewBox="0 0 600 450" preserveAspectRatio="xMidYMid meet" focusable="false">
            <path class="auth-trail-line auth-luz-stroke" d="M392 352 C 360 300, 330 280, 300 250 S 420 150, 530 92" fill="none" stroke-width="2.4" stroke-linecap="round"/>
            <path class="auth-trail-dots" d="M262 262 L 340 196 L 430 150 L 520 108" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.6" stroke-dasharray="2 7" stroke-linecap="round"/>
        </svg>`;

    // Siluetas de personas que surgen del libro iluminado (DAS PIAR.png).
    const PEOPLE = `
        <svg class="auth-scene-people" viewBox="0 0 120 70" focusable="false">
            <circle cx="60" cy="14" r="9"/><path d="M42 70c0-14 8-26 18-26s18 12 18 26z"/>
            <circle cx="30" cy="26" r="7"/><path d="M16 70c0-11 6-20 14-20s14 9 14 20z"/>
            <circle cx="90" cy="26" r="7"/><path d="M76 70c0-11 6-20 14-20s14 9 14 20z"/>
        </svg>`;

    const BOOK = `
        <div class="auth-scene-desk">
            <div class="auth-scene-book">
                <div class="auth-book-back"></div>
                <div class="auth-book-page auth-book-page-left">${PAGE_LEFT}</div>
                <div class="auth-book-page auth-book-page-right">${PAGE_RIGHT}</div>
                <div class="auth-book-leaf"></div>
                <div class="auth-book-leaf"></div>
                <div class="auth-book-leaf"></div>
                <div class="auth-book-cover"></div>
            </div>
        </div>`;

    function toneFor(mode) {
        if (chosenTone !== null) return TONES[chosenTone];
        return mode === "register" ? "turquesa" : "lila";
    }

    function repeat(count, html) {
        return Array.from({ length: count }, () => html).join("");
    }

    function markup(mode = "login") {
        const played = introPlayed;
        introPlayed = true;
        const tiles = TILES.map(icon => `<span class="auth-scene-tile">${icon}</span>`).join("");
        return `
            <div class="auth-scene${played ? " auth-scene-played" : ""}" data-tono="${toneFor(mode)}">
                <div class="auth-scene-room" aria-hidden="true">
                    <span class="auth-room-shelf"></span>
                    <span class="auth-room-shelf auth-room-shelf-right"></span>
                    <span class="auth-room-plant"></span>
                    <span class="auth-room-desk"></span>
                    <span class="auth-room-ambient"></span>
                    <div class="auth-scene-dust">${repeat(16, "<span></span>")}</div>
                </div>
                <div class="auth-scene-stage">
                    <div class="auth-scene-art" aria-hidden="true">
                        ${BOOK}
                        <div class="auth-scene-glow">${PEOPLE}</div>
                        ${TRAIL}
                        <div class="auth-scene-particles">${repeat(14, "<span></span>")}</div>
                        <div class="auth-scene-tiles">${tiles}</div>
                        ${LAMP}
                    </div>
                    <button class="auth-lamp-cord" type="button" aria-label="Cambiar el tono de la luz de la lámpara" title="Tira del cordón para cambiar la luz">
                        <span class="auth-lamp-cord-line"></span>
                        <span class="auth-lamp-cord-knob"></span>
                    </button>
                    <span class="auth-lamp-hint" aria-hidden="true">Tira del cordón</span>
                </div>
                <p class="auth-scene-badge" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="9.5"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>
                    <span>Educación inclusiva para todos y todas</span>
                </p>
            </div>`;
    }

    // Cambia el tono de la luz y lo refleja en la escena y en la tarjeta de acceso.
    function cycleTone(root) {
        const current = TONES.indexOf(root.dataset.tono);
        chosenTone = (current + 1) % TONES.length;
        root.dataset.tono = TONES[chosenTone];
        const container = root.closest?.(".auth-container");
        if (container) container.dataset.tono = TONES[chosenTone];
        return TONES[chosenTone];
    }

    // Activa el cordón (clic, teclado o arrastre) y programa la pausa de los bucles.
    function start(root) {
        clearTimeout(restTimer);
        if (!root || !root.classList) return;
        const container = root.closest?.(".auth-container");
        if (container) container.dataset.tono = root.dataset.tono;
        restTimer = setTimeout(() => root.classList.add("auth-scene-rest"), REST_AFTER_MS);
        const cord = root.querySelector?.(".auth-lamp-cord");
        if (!cord) return;
        let startY = null;
        let pulled = 0;
        let ignoreClick = false;
        const tug = () => {
            cord.classList.remove("auth-lamp-cord-tug");
            void cord.offsetWidth;
            cord.classList.add("auth-lamp-cord-tug");
        };
        cord.addEventListener("pointerdown", event => {
            startY = event.clientY;
            pulled = 0;
            cord.setPointerCapture?.(event.pointerId);
        });
        cord.addEventListener("pointermove", event => {
            if (startY === null) return;
            pulled = Math.max(0, Math.min(48, event.clientY - startY));
            cord.style.setProperty("--tiron", `${pulled}px`);
        });
        const release = () => {
            if (startY === null) return;
            startY = null;
            cord.style.removeProperty("--tiron");
            if (pulled > 18) {
                cycleTone(root);
                ignoreClick = true;
            }
        };
        cord.addEventListener("pointerup", release);
        cord.addEventListener("pointercancel", release);
        // Clic simple, Enter o Espacio.
        cord.addEventListener("click", () => {
            if (ignoreClick) {
                ignoreClick = false;
                return;
            }
            cycleTone(root);
            tug();
        });
    }

    const api = Object.freeze({ markup, start, cycleTone, TONES, REST_AFTER_MS });
    global.PiarLoginScene = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
