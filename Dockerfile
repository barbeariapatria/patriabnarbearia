FROM node:22-alpine
WORKDIR /app
ENV TZ=America/Sao_Paulo NODE_ENV=production DATA_DIR=/data
RUN apk add --no-cache tzdata
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "--no-warnings", "server.js"]
