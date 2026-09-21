-- PIAR base schema for an empty Railway MySQL database.
-- Non-destructive: no CREATE DATABASE, USE, DROP, TRUNCATE, DELETE, or seed data.
-- Run inside the database provided by DB_NAME / MYSQLDATABASE.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE IF NOT EXISTS usuario (
    id_usuario INT NOT NULL AUTO_INCREMENT,
    nombre VARCHAR(150) NOT NULL,
    documento VARCHAR(30) NOT NULL,
    correo VARCHAR(150) NOT NULL,
    rol VARCHAR(30) NOT NULL DEFAULT 'Docente',
    contrasena VARCHAR(255) NOT NULL DEFAULT '',
    password_hash VARCHAR(255) NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'activo',
    ultimo_acceso_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_usuario),
    UNIQUE KEY uq_usuario_documento (documento),
    UNIQUE KEY uq_usuario_correo (correo),
    KEY idx_usuario_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sesion_usuario (
    id_sesion INT NOT NULL AUTO_INCREMENT,
    id_usuario INT NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_sesion),
    UNIQUE KEY uq_sesion_usuario_token_hash (token_hash),
    KEY idx_sesion_usuario_usuario (id_usuario),
    KEY idx_sesion_usuario_expires (expires_at),
    CONSTRAINT fk_sesion_usuario_usuario
        FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS estudiante (
    id_estudiante INT NOT NULL AUTO_INCREMENT,
    nombre VARCHAR(200) NOT NULL,
    documento VARCHAR(30) NOT NULL,
    edad INT NULL,
    curso VARCHAR(50) NULL,
    condicion_especial VARCHAR(150) NULL,
    nombres VARCHAR(100) NULL,
    apellidos VARCHAR(100) NULL,
    fecha_nacimiento DATE NULL,
    jornada VARCHAR(30) NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'activo',
    acudiente VARCHAR(150) NULL,
    telefono VARCHAR(30) NULL,
    contexto TEXT NULL,
    valoracion TEXT NULL,
    fortalezas JSON NULL,
    barreras JSON NULL,
    apoyos_requeridos JSON NULL,
    actividades_casa TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_estudiante),
    UNIQUE KEY uq_estudiante_documento (documento),
    KEY idx_estudiante_estado (estado),
    KEY idx_estudiante_curso (curso),
    KEY idx_estudiante_condicion (condicion_especial)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS docente (
    id_docente INT NOT NULL AUTO_INCREMENT,
    nombre VARCHAR(150) NOT NULL,
    area VARCHAR(100) NULL,
    correo VARCHAR(150) NULL,
    nombres VARCHAR(100) NULL,
    apellidos VARCHAR(100) NULL,
    documento VARCHAR(20) NULL,
    cargo VARCHAR(100) NULL,
    telefono VARCHAR(30) NULL,
    perfil TEXT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'activo',
    id_usuario INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_docente),
    KEY idx_docente_estado (estado),
    KEY idx_docente_usuario (id_usuario),
    CONSTRAINT fk_docente_usuario
        FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coordinador (
    id_coordinador INT NOT NULL AUTO_INCREMENT,
    nombre VARCHAR(150) NOT NULL,
    correo VARCHAR(150) NULL,
    documento VARCHAR(30) NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'activo',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_coordinador)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS psicologa (
    id_psicologa INT NOT NULL AUTO_INCREMENT,
    nombre VARCHAR(150) NOT NULL,
    correo VARCHAR(150) NULL,
    documento VARCHAR(30) NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'activo',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_psicologa)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS piar (
    id_piar INT NOT NULL AUTO_INCREMENT,
    id_estudiante INT NOT NULL,
    id_usuario_creador INT NULL,
    titulo VARCHAR(200) NOT NULL,
    periodo VARCHAR(50) NOT NULL,
    anio INT NOT NULL,
    estado VARCHAR(30) NOT NULL DEFAULT 'draft',
    objetivo_general TEXT NULL,
    metas TEXT NULL,
    caracterizacion TEXT NULL,
    barreras TEXT NULL,
    estrategias TEXT NULL,
    informes_salud TEXT NULL,
    proyectos TEXT NULL,
    fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_revision DATE NULL,
    fecha_cierre DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_piar),
    KEY idx_piar_estudiante (id_estudiante),
    KEY idx_piar_usuario_creador (id_usuario_creador),
    KEY idx_piar_estado (estado),
    CONSTRAINT fk_piar_estudiante
        FOREIGN KEY (id_estudiante) REFERENCES estudiante (id_estudiante),
    CONSTRAINT fk_piar_usuario_creador
        FOREIGN KEY (id_usuario_creador) REFERENCES usuario (id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS piar_docente (
    id_piar INT NOT NULL,
    id_docente INT NOT NULL,
    es_responsable_principal BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_piar, id_docente),
    KEY idx_piar_docente_docente (id_docente),
    CONSTRAINT fk_piar_docente_piar
        FOREIGN KEY (id_piar) REFERENCES piar (id_piar),
    CONSTRAINT fk_piar_docente_docente
        FOREIGN KEY (id_docente) REFERENCES docente (id_docente)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS piar_ajuste (
    id_ajuste INT NOT NULL AUTO_INCREMENT,
    id_piar INT NOT NULL,
    area VARCHAR(100) NOT NULL,
    tipo VARCHAR(100) NOT NULL,
    estrategia TEXT NOT NULL,
    recursos TEXT NULL,
    responsable VARCHAR(150) NULL,
    avance DECIMAL(5,2) NOT NULL DEFAULT 0,
    estado VARCHAR(20) NOT NULL DEFAULT 'activo',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_ajuste),
    KEY idx_piar_ajuste_piar (id_piar),
    CONSTRAINT fk_piar_ajuste_piar
        FOREIGN KEY (id_piar) REFERENCES piar (id_piar),
    CONSTRAINT chk_piar_ajuste_avance
        CHECK (avance >= 0 AND avance <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS diagnostico (
    id_diagnostico INT NOT NULL AUTO_INCREMENT,
    tipo_diagnostico VARCHAR(100) NOT NULL,
    fecha DATE NULL,
    descripcion TEXT NULL,
    id_estudiante INT NULL,
    id_psicologa INT NULL,
    id_piar INT NULL,
    id_usuario_creador INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_diagnostico),
    KEY idx_diagnostico_estudiante (id_estudiante),
    KEY idx_diagnostico_psicologa (id_psicologa),
    KEY idx_diagnostico_piar (id_piar),
    KEY idx_diagnostico_usuario (id_usuario_creador),
    CONSTRAINT fk_diagnostico_estudiante
        FOREIGN KEY (id_estudiante) REFERENCES estudiante (id_estudiante),
    CONSTRAINT fk_diagnostico_psicologa
        FOREIGN KEY (id_psicologa) REFERENCES psicologa (id_psicologa),
    CONSTRAINT fk_diagnostico_piar
        FOREIGN KEY (id_piar) REFERENCES piar (id_piar),
    CONSTRAINT fk_diagnostico_usuario
        FOREIGN KEY (id_usuario_creador) REFERENCES usuario (id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS seguimiento (
    id_seguimiento INT NOT NULL AUTO_INCREMENT,
    fecha DATE NULL,
    descripcion TEXT NULL,
    responsable VARCHAR(150) NULL,
    id_estudiante INT NULL,
    id_coordinador INT NULL,
    id_piar INT NULL,
    id_usuario_responsable INT NULL,
    estado VARCHAR(30) NULL,
    acuerdos TEXT NULL,
    evolucion TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_seguimiento),
    KEY idx_seguimiento_estudiante (id_estudiante),
    KEY idx_seguimiento_coordinador (id_coordinador),
    KEY idx_seguimiento_piar (id_piar),
    KEY idx_seguimiento_usuario (id_usuario_responsable),
    CONSTRAINT fk_seguimiento_estudiante
        FOREIGN KEY (id_estudiante) REFERENCES estudiante (id_estudiante),
    CONSTRAINT fk_seguimiento_coordinador
        FOREIGN KEY (id_coordinador) REFERENCES coordinador (id_coordinador),
    CONSTRAINT fk_seguimiento_piar
        FOREIGN KEY (id_piar) REFERENCES piar (id_piar),
    CONSTRAINT fk_seguimiento_usuario
        FOREIGN KEY (id_usuario_responsable) REFERENCES usuario (id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS observacion (
    id_observacion INT NOT NULL AUTO_INCREMENT,
    fecha DATE NULL,
    descripcion TEXT NULL,
    docente_responsable VARCHAR(150) NULL,
    id_estudiante INT NULL,
    id_docente INT NULL,
    id_piar INT NULL,
    id_usuario_autor INT NULL,
    tipo VARCHAR(50) NULL,
    avance DECIMAL(5,2) NULL,
    estado VARCHAR(30) NULL,
    acuerdos TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_observacion),
    KEY idx_observacion_estudiante (id_estudiante),
    KEY idx_observacion_docente (id_docente),
    KEY idx_observacion_piar (id_piar),
    KEY idx_observacion_usuario (id_usuario_autor),
    CONSTRAINT fk_observacion_estudiante
        FOREIGN KEY (id_estudiante) REFERENCES estudiante (id_estudiante),
    CONSTRAINT fk_observacion_docente
        FOREIGN KEY (id_docente) REFERENCES docente (id_docente),
    CONSTRAINT fk_observacion_piar
        FOREIGN KEY (id_piar) REFERENCES piar (id_piar),
    CONSTRAINT fk_observacion_usuario
        FOREIGN KEY (id_usuario_autor) REFERENCES usuario (id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS historial (
    id_historial INT NOT NULL AUTO_INCREMENT,
    id_piar INT NULL,
    id_usuario_creador INT NULL,
    tipo_registro VARCHAR(50) NULL,
    id_referencia INT NULL,
    descripcion TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_historial),
    KEY idx_historial_piar (id_piar),
    KEY idx_historial_usuario (id_usuario_creador),
    CONSTRAINT fk_historial_piar
        FOREIGN KEY (id_piar) REFERENCES piar (id_piar),
    CONSTRAINT fk_historial_usuario
        FOREIGN KEY (id_usuario_creador) REFERENCES usuario (id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS historial_detalle (
    id_detalle INT NOT NULL AUTO_INCREMENT,
    id_historial INT NOT NULL,
    tipo_registro VARCHAR(50) NULL,
    id_referencia INT NULL,
    id_usuario INT NULL,
    descripcion TEXT NULL,
    fecha_evento DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    valor_anterior JSON NULL,
    valor_nuevo JSON NULL,
    PRIMARY KEY (id_detalle),
    KEY idx_historial_detalle_historial (id_historial),
    KEY idx_historial_detalle_usuario (id_usuario),
    KEY idx_historial_detalle_fecha (fecha_evento),
    CONSTRAINT fk_historial_detalle_historial
        FOREIGN KEY (id_historial) REFERENCES historial (id_historial),
    CONSTRAINT fk_historial_detalle_usuario
        FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reporte (
    id_reporte INT NOT NULL AUTO_INCREMENT,
    id_piar INT NULL,
    id_usuario INT NULL,
    tipo VARCHAR(100) NULL,
    formato VARCHAR(20) NULL,
    filtros JSON NULL,
    nombre_archivo VARCHAR(255) NULL,
    ruta_archivo VARCHAR(500) NULL,
    estado VARCHAR(30) NOT NULL DEFAULT 'generado',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_reporte),
    KEY idx_reporte_piar (id_piar),
    KEY idx_reporte_usuario (id_usuario),
    KEY idx_reporte_estado (estado),
    CONSTRAINT fk_reporte_piar
        FOREIGN KEY (id_piar) REFERENCES piar (id_piar),
    CONSTRAINT fk_reporte_usuario
        FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
