package dev.burnedchats.controller;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import dev.burnedchats.service.RedisHealthService;
import reactor.core.publisher.Mono;

/**
 * Health check controller for the BurnedChats backend.
 *
 * <p>Provides basic health and status endpoints for monitoring,
 * including Redis connectivity checks.
 */
@RestController
@RequestMapping("/api")
public class HealthController {

    private final RedisHealthService redisHealthService;

    public HealthController(RedisHealthService redisHealthService) {
        this.redisHealthService = redisHealthService;
    }

    /**
     * Basic health check endpoint.
     *
     * @return health status response
     */
    @GetMapping("/health")
    public Mono<ResponseEntity<Map<String, Object>>> health() {
        return redisHealthService.isHealthy()
                .map(redisOk -> {
                    Map<String, Object> body = Map.of(
                            "status", redisOk ? "UP" : "DOWN",
                            "service", "burned-chats-backend",
                            "timestamp", Instant.now().toString()
                    );
                    HttpStatus status = redisOk ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
                    return ResponseEntity.status(status).body(body);
                });
    }

    /**
     * Detailed health check including Redis status.
     *
     * <p>Returns reactive response with Redis connectivity check.
     *
     * @return Mono emitting detailed health status
     */
    @GetMapping("/health/detailed")
    public Mono<Map<String, Object>> healthDetailed() {
        return redisHealthService.isHealthy()
                .map(redisHealthy -> {
                    Map<String, Object> health = new HashMap<>();
                    health.put("status", redisHealthy ? "UP" : "DEGRADED");
                    health.put("service", "burned-chats-backend");
                    health.put("timestamp", Instant.now().toString());
                    health.put("components", Map.of(
                            "redis", Map.of(
                                    "status", redisHealthy ? "UP" : "DOWN",
                                    "type", "lettuce-reactive"
                            ),
                            "websocket", Map.of(
                                    "status", "UP",
                                    "protocol", "STOMP"
                            )
                    ));
                    return health;
                });
    }

    /**
     * Application info endpoint.
     *
     * @return application information
     */
    @GetMapping("/info")
    public Map<String, Object> info() {
        return Map.of(
                "name", "BurnedChats Backend",
                "version", "0.1.0",
                "description", "Secure ephemeral chat backend for Telegram Mini App",
                "features", Map.of(
                        "websocket", "STOMP over WebSocket with SockJS fallback",
                        "redis", "Lettuce reactive client with connection pooling"
                )
        );
    }
}

