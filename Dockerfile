# Imagen de producción de PIAR-SISTEMA (Railway u otro servicio de contenedores).
# Solo dependencias de producción, sin pruebas, documentación ni scripts locales,
# y ejecución con el usuario sin privilegios "node".
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY backend ./backend
COPY public ./public
COPY database/migrations ./database/migrations
# Herramientas de verificación para ejecutar con `railway ssh` dentro de la red privada.
COPY scripts/verificar-produccion.js scripts/probar-correo.js scripts/admin-transfer.js ./scripts/

USER node
EXPOSE 8080

# Railway inyecta PORT; la comprobación de salud se configura en railway.json.
CMD ["node", "backend/server.js"]
