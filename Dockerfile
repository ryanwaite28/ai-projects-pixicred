# Build stage — assembles pre-built Lambda artifacts into the image
FROM node:20-alpine AS build
WORKDIR /app
COPY dist/ ./dist/
COPY node_modules/ ./node_modules/

# Runtime stage
FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
# CMD is overridden per Lambda service in docker-compose.yml
CMD ["node", "dist/lambdas/index.js"]
