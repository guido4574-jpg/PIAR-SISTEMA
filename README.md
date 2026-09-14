# Proyecto PIAR

Aplicacion web para seguimiento PIAR/PR, estudiantes, docentes, observaciones y reportes.

## Estructura

```text
assets/       Recursos visuales
backend/      Servidor Node temporal y API local de apoyo
css/          Estilos de la aplicacion
data/         Datos persistidos en JSON para pruebas locales
docs/         Documentacion del proyecto
js/           Logica frontend, configuracion y datos base
logs/         Salidas del servidor local
index.html    Entrada principal de la aplicacion
```

## Ejecutar

Instala las dependencias:

```bash
npm install
```

Copia `.env.example` como `.env` y completa `DB_PASSWORD` con la misma contraseña que usa tu instalación local de MySQL. No compartas ni subas ese archivo.

El host local predeterminado es `127.0.0.1`. Para Docker se podrá cambiar posteriormente a `mysql` mediante `DB_HOST`.

También puedes iniciar el proyecto con:

```bash
npm start
```

El modo de desarrollo disponible usa el watcher integrado de Node.js:

```bash
npm run dev
```

La forma compatible anterior continúa disponible:

```bash
node backend/server.js
```

Luego abrir:

```text
http://localhost:8080
```

La API local queda en:

```text
http://localhost:8080/api
```

## Variables de entorno

Las variables principales son:

| Variable | Uso | Valor local recomendado |
|---|---|---|
| `PORT` | Puerto del servidor | `8080` |
| `DB_HOST` | Host MySQL | `127.0.0.1` |
| `DB_PORT` | Puerto MySQL | `3306` |
| `DB_NAME` | Base de datos | `piar` |
| `DB_USER` | Usuario MySQL | El usuario local configurado |
| `DB_PASSWORD` | Contraseña MySQL | La contraseña local, solo en `.env` |
| `CORS_ORIGIN` | Orígenes permitidos | `http://localhost:8080,http://127.0.0.1:8080` |

La ruta `GET /api/health` comprueba la disponibilidad de la API y ejecuta una consulta básica contra MySQL.
