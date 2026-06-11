# Multi-stage build for MCP Context Manager
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (tree-sitter)
RUN apk add --no-cache python3 make g++

# Copy package files from the service directory
COPY services/mcp-context-manager/package.json services/mcp-context-manager/package-lock.json* ./

# Install dependencies
RUN npm ci

# Copy source code and TypeScript config
COPY services/mcp-context-manager/src ./src
COPY services/mcp-context-manager/tsconfig.json ./

# Build TypeScript to JavaScript
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install runtime dependencies for native modules and wget for healthcheck
RUN apk add --no-cache python3 make g++ wget

# Copy package files from the service directory
COPY services/mcp-context-manager/package.json services/mcp-context-manager/package-lock.json* ./

# Copy node_modules from builder (includes all dependencies)
COPY --from=builder /app/node_modules ./node_modules

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Expose MCP server port (if applicable)
EXPOSE 3001

# Set V8 heap limit — paired with 1536M cgroup limit (heap ≈ 2/3 of cgroup)
ENV NODE_OPTIONS="--max-old-space-size=1024"

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO /dev/null http://localhost:3001/api/health || exit 1

# Run the MCP server
CMD ["npm", "start"]
