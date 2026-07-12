# Simplified Dockerfile using pre-built binaries from GitHub Releases
# Supports: linux/amd64, linux/arm64

ARG VERSION=latest

FROM debian:bookworm-slim

# Install required dependencies
RUN apt-get update && \
    apt-get install -y \
      sqlite3 \
      ca-certificates \
      curl \
      file \
      && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Download the appropriate binary based on architecture
# TARGETARCH is automatically set by Docker buildx (amd64 or arm64)
ARG TARGETARCH
ARG VERSION

# Determine correct architecture and download binary
RUN echo "=== Binary Download Information ===" && \
    echo "TARGETARCH from buildx: ${TARGETARCH}" && \
    echo "System uname -m: $(uname -m)" && \
    echo "Version: ${VERSION}" && \
    # Use TARGETARCH if set, otherwise detect from system
    if [ -z "${TARGETARCH}" ]; then \
      case "$(uname -m)" in \
        x86_64) ARCH=amd64 ;; \
        aarch64) ARCH=arm64 ;; \
        *) echo "Unsupported architecture: $(uname -m)"; exit 1 ;; \
      esac; \
    else \
      ARCH="${TARGETARCH}"; \
    fi && \
    echo "Using architecture: ${ARCH}" && \
    if [ "${VERSION}" = "latest" ]; then \
      DOWNLOAD_URL="https://github.com/ALange/TinyClaude/releases/latest/download/tinyclaude-linux-${ARCH}"; \
    else \
      DOWNLOAD_URL="https://github.com/ALange/TinyClaude/releases/download/v${VERSION}/tinyclaude-linux-${ARCH}"; \
    fi && \
    echo "Downloading from: ${DOWNLOAD_URL}" && \
    curl -L -f -o /usr/local/bin/tinyclaude "${DOWNLOAD_URL}" || (echo "Failed to download binary from ${DOWNLOAD_URL}"; exit 1) && \
    chmod +x /usr/local/bin/tinyclaude && \
    echo "Binary downloaded successfully" && \
    file /usr/local/bin/tinyclaude && \
    # Verify the binary can execute (basic sanity check)
    /usr/local/bin/tinyclaude --version || (echo "Binary verification failed - exec format error"; exit 1) && \
    echo "==================================="

# Create a non-root user to run the application
RUN useradd -r -u 1000 -m -s /bin/bash tinyclaude && \
    mkdir -p /data && \
    chown -R tinyclaude:tinyclaude /data /app

# Set environment variables
ENV NODE_ENV=production
ENV TINYCLAUDE_DB_PATH=/data/tinyclaude.db
ENV XDG_CONFIG_HOME=/data
ENV TINYCLAUDE_LOG_DIR=/app/logs

# Create logs directory with proper permissions
RUN mkdir -p /app/logs /data && chown -R tinyclaude:tinyclaude /app/logs /data

# Expose default port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Add labels for version tracking (will be overridden by GitHub Actions metadata)
ARG VERSION
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.title="tinyclaude"
LABEL org.opencontainers.image.description="Load balancer proxy for Claude API with intelligent distribution across multiple OAuth accounts"
LABEL org.opencontainers.image.source="https://github.com/ALange/TinyClaude"

# Create startup script that shows version
RUN echo '#!/bin/bash\n\
echo "================================="\n\
echo "tinyclaude Docker Container"\n\
echo "================================="\n\
echo "Architecture: $(uname -m)"\n\
echo ""\n\
/usr/local/bin/tinyclaude --version\n\
echo "================================="\n\
echo ""\n\
exec /usr/local/bin/tinyclaude "$@"\n\
' > /usr/local/bin/entrypoint.sh && chmod +x /usr/local/bin/entrypoint.sh

# Switch to non-root user
USER tinyclaude

# Add volume mount for persistent data only
VOLUME ["/data"]

# Use the startup script as entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["--serve", "--port", "8080"]
