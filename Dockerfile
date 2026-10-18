FROM node:22-alpine AS client-builder
WORKDIR /app
COPY client/package*.json ./client/
RUN npm --prefix client ci
COPY client/ ./client/
RUN npm --prefix client run build

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

# Ensure non-root node user owns /app and images/ directory for local uploads
RUN mkdir -p /app/images && chown -R node:node /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=client-builder --chown=node:node /app/public/app ./public/app
COPY --chown=node:node . .

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://localhost:${PORT:-3001}/api/health || exit 1

# run pending migrations, then start the server
CMD ["sh", "-c", "npx sequelize-cli db:migrate && node server.js"]
