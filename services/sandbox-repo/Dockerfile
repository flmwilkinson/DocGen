# Repo Runner Sandbox Service Dockerfile
FROM node:20-alpine

# Install Docker CLI for Docker-in-Docker support
RUN apk add --no-cache docker-cli bash git

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json .

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Create non-root user
RUN adduser -D -s /bin/bash sandbox && \
    mkdir -p /tmp/repos && \
    chown -R sandbox:sandbox /tmp/repos

# Expose port
EXPOSE 8002

# Note: When running, mount docker socket for container execution
# -v /var/run/docker.sock:/var/run/docker.sock:ro

CMD ["node", "index.js"]

