FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY public ./public
COPY migrations ./migrations
COPY templates ./templates
USER node
EXPOSE 3000
CMD ["npm", "run", "start:web"]
