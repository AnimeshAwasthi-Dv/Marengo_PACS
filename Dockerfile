FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000 CHROMIUM_PATH=/usr/bin/chromium DCMTK_BIN=/usr/bin SOFFICE_PATH=/usr/bin/soffice
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl dcmtk chromium libreoffice-writer fonts-dejavu fonts-liberation && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 4000
CMD ["node", "--import", "tsx", "server/index.ts"]
