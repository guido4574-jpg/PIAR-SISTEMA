-- Add missing PIAR learning-cycle fields without changing existing records.
-- Run only after confirming the target schema and reviewing the deployment plan.
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'piar' AND COLUMN_NAME = 'actividades_receso') = 0,
    'ALTER TABLE piar ADD COLUMN actividades_receso TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'piar' AND COLUMN_NAME = 'otra_informacion') = 0,
    'ALTER TABLE piar ADD COLUMN otra_informacion TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'piar' AND COLUMN_NAME = 'acta_acuerdos') = 0,
    'ALTER TABLE piar ADD COLUMN acta_acuerdos TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'piar' AND COLUMN_NAME = 'informe_anual') = 0,
    'ALTER TABLE piar ADD COLUMN informe_anual TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'piar' AND COLUMN_NAME = 'entrega_pedagogica') = 0,
    'ALTER TABLE piar ADD COLUMN entrega_pedagogica TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
