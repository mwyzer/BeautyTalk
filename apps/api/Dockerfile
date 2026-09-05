# BeautyAI API — production image (workspace monorepo; tsx at runtime resolves TS workspaces).

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.base.json tsconfig.json ./
COPY apps/api ./apps/api
COPY packages ./packages

RUN npm ci
RUN npm run build -w @beautyai/shared && npm run build -w @beautyai/db

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/package.json package.json
COPY --from=builder /app/package-lock.json package-lock.json
COPY --from=builder /app/tsconfig.base.json tsconfig.base.json
COPY --from=builder /app/tsconfig.json tsconfig.json
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules node_modules

ENV PORT=4000
EXPOSE 4000

CMD ["npx", "tsx", "apps/api/src/server.ts"]