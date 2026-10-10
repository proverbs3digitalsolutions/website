FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY db ./db
COPY scripts ./scripts
COPY src ./src
COPY public ./public
RUN mkdir -p /data/storage && chown -R node:node /data
USER node
ENV STORAGE_DIR=/data/storage PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "src/index.js"]
