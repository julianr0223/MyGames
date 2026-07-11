# Imagen ligera para el servidor del juego Stop
FROM node:20-alpine

WORKDIR /app

# Instala dependencias primero (mejor cache de capas)
COPY server/package.json ./
RUN npm install --omit=dev

# Copia el resto del servidor y los archivos estáticos
COPY server/ ./

ENV PORT=3000
EXPOSE 3000

# Healthcheck: el servidor expone /health
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+ (process.env.PORT||3000) +'/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
