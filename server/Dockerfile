FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY prisma ./prisma
# Prisma reads the datasource URL while validating/generating its client.
# This build-only placeholder is replaced by DATABASE_URL at runtime.
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public" npx prisma generate
COPY src ./src
USER node
EXPOSE 8787
CMD ["node", "src/server.js"]
