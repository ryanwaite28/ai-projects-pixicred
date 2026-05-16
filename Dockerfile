# Build stage — assembles pre-built Lambda artifacts into the image
FROM node:20-alpine AS build
WORKDIR /app
COPY dist/ ./dist/
COPY node_modules/ ./node_modules/

# Runtime stage (used for Lambda packaging via CI/CD)
FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
# CMD is overridden per Lambda service in docker-compose.yml
CMD ["node", "dist/lambdas/index.js"]

# Local dev stage — installs Linux-native deps and generates the Prisma client for
# the container OS. dist/ is NOT copied here; it must be volume-mounted at runtime
# from the host after running `npm run build`.
FROM node:20-slim AS local-dev
WORKDIR /app
COPY package*.json ./
COPY prisma/ ./prisma/
RUN npm ci && npx prisma generate
CMD ["node", "dist/local/api-server.js"]
