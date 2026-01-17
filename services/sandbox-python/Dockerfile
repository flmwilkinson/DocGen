# Python Sandbox Service Dockerfile
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create non-root user for security
RUN useradd -m -s /bin/bash sandbox && \
    mkdir -p /tmp/sandbox && \
    chown -R sandbox:sandbox /tmp/sandbox

# Set resource limits in entrypoint
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Expose port
EXPOSE 8001

# Run as non-root user
USER sandbox

# Start the service
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]

