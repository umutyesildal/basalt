# Build from the repository root: docker build -f backend/Dockerfile .
FROM node:20-slim AS build
WORKDIR /app/backend
COPY vendor/basalt-bigint-buffer-1.0.0.tgz /app/vendor/basalt-bigint-buffer-1.0.0.tgz
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --workspaces=false --ignore-scripts --no-audit --no-fund
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

FROM node:20-slim
WORKDIR /app/backend
ENV NODE_ENV=production
COPY vendor/basalt-bigint-buffer-1.0.0.tgz /app/vendor/basalt-bigint-buffer-1.0.0.tgz
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --workspaces=false --ignore-scripts --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/backend/dist ./dist
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
