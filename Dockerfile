FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime: the server has no npm dependencies (node:http), so only dist + server
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 PROJECT_DIR=/data/projects
COPY --from=build /app/dist ./dist
COPY server ./server
VOLUME /data/projects
EXPOSE 8080
CMD ["node", "server/index.mjs"]
