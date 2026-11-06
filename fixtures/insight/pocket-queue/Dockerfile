# Container image for Pocket Queue, built with Docker.
FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY dist ./dist
EXPOSE 8080
CMD ["node", "dist/index.js"]
