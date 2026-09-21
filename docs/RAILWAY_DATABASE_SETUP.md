# PIAR Railway Database Setup

## Problema

Railway crea una base de datos vacia, normalmente llamada `railway`. El backend puede conectarse correctamente, pero los endpoints que consultan tablas reales fallan si el esquema no ha sido inicializado.

El caso observado es:

```json
{"error":"Error interno del servidor"}
```

con logs similares a:

```text
La tabla 'railway.estudiante' no existe
```

## Variables esperadas en Railway

Configura el servicio backend usando referencias al servicio MySQL:

```text
NODE_ENV=production
DB_HOST=${{MySQL.MYSQLHOST}}
DB_PORT=${{MySQL.MYSQLPORT}}
DB_NAME=${{MySQL.MYSQLDATABASE}}
DB_USER=${{MySQL.MYSQLUSER}}
DB_PASSWORD=${{MySQL.MYSQLPASSWORD}}
DB_CONNECTION_LIMIT=10
```

No cambies `DB_NAME` manualmente a `piar` en Railway. El backend debe usar la base entregada por `MYSQLDATABASE`.

## Migracion base para una base vacia

El archivo recomendado para inicializar Railway es:

```text
database/migrations/000_railway_schema.sql
```

Este archivo:

- Crea solamente las tablas que usa el backend.
- No contiene credenciales.
- No contiene datos de prueba.
- No contiene `CREATE DATABASE`.
- No contiene `USE`.
- No contiene `DROP`, `TRUNCATE` ni `DELETE`.
- No se ejecuta automaticamente al arrancar el servidor.

## Ejecutar la migracion

Desde un entorno que tenga las variables `DB_*` apuntando al MySQL de Railway, ejecuta:

```bash
npm run db:migrate:railway
```

Para una base local antigua que ya tenga tablas parciales, revisa primero el esquema existente. Si corresponde, puedes aplicar la migracion incremental:

```bash
npm run db:migrate:mvp
```

## Validacion posterior

Despues de inicializar la base:

```text
GET /api/health
```

debe responder:

```json
{"status":"ok","database":"connected"}
```

Luego valida:

```text
GET /api/data
```

Debe dejar de fallar por tabla inexistente. Si responde sin estudiantes, eso significa que el esquema existe pero aun no hay datos cargados.
