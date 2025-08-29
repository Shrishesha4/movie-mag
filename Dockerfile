FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache \
    wget \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY src/ ./src/

# Create data directory
RUN mkdir -p /app/data && chmod 755 /app/data

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S movieuser -u 1001 -G nodejs && \
    chown -R movieuser:nodejs /app
USER movieuser

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
