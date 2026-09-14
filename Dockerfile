FROM node:22-alpine

# Instalar Git para poder clonar el repositorio
RUN apk add --no-cache git

# Directorio de trabajo
WORKDIR /app

# Clonar el proyecto PIAR desde GitHub
RUN git clone https://github.com/guido4574-jpg/PIAR-SISTEMA.git .

# Instalar las dependencias
RUN npm ci

# Entorno de ejecución
ENV NODE_ENV=production

# Puerto de la aplicación
ENV PORT=8080
ENV DB_HOST=host.docker.internal
ENV DB_PORT=3306

# Exponer el puerto del contenedor
EXPOSE 8080

# Iniciar la aplicación
CMD ["npm", "start"]