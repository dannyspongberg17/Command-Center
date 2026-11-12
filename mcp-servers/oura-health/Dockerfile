# ---- build stage: compile TypeScript ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime stage: only compiled JS + production deps ----
FROM node:22-alpine
# The server drops from root to this uid/gid (the built-in "node" user)
# right after the entrypoint fixes ownership of the mounted data volume.
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/data RUN_AS_UID=1000 RUN_AS_GID=1000
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data && chown node:node /data
EXPOSE 8080
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
