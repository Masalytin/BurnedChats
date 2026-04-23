# ===== BUILD STAGE =====
FROM eclipse-temurin:21-jdk-alpine AS builder

WORKDIR /app

# Copy Gradle wrapper and build files
COPY gradlew gradlew.bat ./
COPY gradle/ gradle/
COPY build.gradle.kts settings.gradle.kts gradle.properties ./
COPY backend/build.gradle.kts backend/

# Fix line endings (Windows CRLF -> Unix LF) and make executable
RUN sed -i 's/\r$//' gradlew && chmod +x gradlew

# Download dependencies (layer caching)
RUN ./gradlew dependencies --no-daemon -q || true

# Copy source code (lombok.config must be present: @Slf4j field name LOG)
COPY backend/lombok.config backend/
COPY backend/src backend/src
COPY config/ config/

# Build the application
RUN ./gradlew :backend:bootJar --no-daemon -x test

# ===== RUNTIME STAGE =====
FROM eclipse-temurin:21-jre-alpine

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# Copy the built JAR from builder stage
COPY --from=builder /app/backend/build/libs/burned-chats-backend.jar app.jar

# Create logs and file storage directories
RUN mkdir -p /app/logs /data/files && \
    chown -R appuser:appgroup /app /data/files

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/actuator/health || exit 1

# JVM options for containers
ENV JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0 -XX:+UseG1GC -Djava.security.egd=file:/dev/./urandom"

# Run the application
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]

