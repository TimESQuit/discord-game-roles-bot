# Build stage: installs production dependencies. The build tools are only a fallback
# in case better-sqlite3 has no prebuilt binary; they never reach the runtime stage.
FROM node:26-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@12.18.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Runtime stage: no build tools.
FROM node:26-slim
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY drizzle ./drizzle
RUN mkdir -p /app/data && chown node:node /app/data
USER node
CMD ["node", "src/main.ts"]
