FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --include=dev
COPY tailwind.config.cjs ./
COPY src ./src
COPY public ./public
COPY data ./data
RUN npm run build && npm prune --omit=dev
EXPOSE 3000
USER node
HEALTHCHECK CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "src/server.js"]
