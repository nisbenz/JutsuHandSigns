FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Vite bakes these into the bundle; the browser connects to the backend
# directly, so they must be reachable from the host, not the container.
ARG VITE_MATCH_WS_URL=ws://localhost:8000/ws/match
ARG VITE_JUTSU_WS_URL=ws://localhost:8000/ws/jutsu
ARG VITE_PVP_WS_URL=ws://localhost:8000/ws/pvp
ENV VITE_MATCH_WS_URL=$VITE_MATCH_WS_URL \
    VITE_JUTSU_WS_URL=$VITE_JUTSU_WS_URL \
    VITE_PVP_WS_URL=$VITE_PVP_WS_URL

COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
