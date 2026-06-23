FROM node:lts-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

USER node

ENTRYPOINT ["node", "index.js"]
