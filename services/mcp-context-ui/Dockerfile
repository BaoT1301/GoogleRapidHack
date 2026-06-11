# MCP Context UI Dockerfile — multi-stage: build with Node, serve with nginx
# Stage 1: Build
FROM node:22-alpine AS build

WORKDIR /app

# No build args required — this is an internal tool with zero authentication

# Copy package files from the isolated context
COPY package.json package-lock.json ./
RUN npm ci

# Copy all source files from the isolated context
COPY . .
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine

# Copy custom nginx config for this service
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built static files
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO /dev/null http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
