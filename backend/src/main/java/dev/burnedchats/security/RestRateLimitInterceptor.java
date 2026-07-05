package dev.burnedchats.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.burnedchats.config.RateLimitProperties;
import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.service.RateLimitService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;

/**
 * MVC interceptor applying Redis-backed rate limits to public REST surfaces.
 *
 * <p>Separate budgets for auth ({@code /api/auth/**}) and RPC-proxy routes
 * ({@code /api/wallet/**}, {@code /api/governance/**}). Keys are per client IP
 * with an optional identity suffix when {@code X-Auth-Token} is present.
 */
@Slf4j
@Component
public class RestRateLimitInterceptor implements HandlerInterceptor {

    private static final Duration ONE_MINUTE = Duration.ofMinutes(1);
    private static final String GROUP_AUTH = "auth";
    private static final String GROUP_RPC = "rpc";
    private static final String AUTH_TOKEN_HEADER = "X-Auth-Token";

    private final RateLimitService rateLimitService;
    private final RateLimitProperties rateLimitProperties;
    private final ObjectMapper objectMapper;
    private final int authRequestsPerMinute;
    private final int rpcRequestsPerMinute;

    public RestRateLimitInterceptor(
            RateLimitService rateLimitService,
            RateLimitProperties rateLimitProperties,
            ObjectMapper objectMapper,
            @Value("${rate-limit.rest.auth.requests-per-minute:20}") int authRequestsPerMinute,
            @Value("${rate-limit.rest.rpc.requests-per-minute:0}") int rpcRequestsPerMinuteOverride) {
        this.rateLimitService = rateLimitService;
        this.rateLimitProperties = rateLimitProperties;
        this.objectMapper = objectMapper;
        this.authRequestsPerMinute = authRequestsPerMinute;
        this.rpcRequestsPerMinute = rpcRequestsPerMinuteOverride > 0
                ? rpcRequestsPerMinuteOverride
                : rateLimitProperties.getRequests().getPerMinute();
    }

    @Override
    public boolean preHandle(
            @NonNull HttpServletRequest request,
            @NonNull HttpServletResponse response,
            @NonNull Object handler) {
        if (!rateLimitProperties.isEnabled()) {
            return true;
        }

        String path = request.getRequestURI();
        String group = resolveGroup(path);
        if (group == null) {
            return true;
        }

        int maxRequests = GROUP_AUTH.equals(group) ? authRequestsPerMinute : rpcRequestsPerMinute;
        String clientKey = resolveClientKey(request);

        try {
            rateLimitService.checkRateLimitBlocking(group, clientKey, maxRequests, ONE_MINUTE);
            return true;
        } catch (RateLimitException e) {
            LOG.warn("REST rate limit exceeded: group={}, clientKey={}, path={}", group, clientKey, path);
            writeRateLimitResponse(response, e);
            return false;
        }
    }

    private static String resolveGroup(String path) {
        if (path.startsWith("/api/auth/") || "/api/auth".equals(path)) {
            return GROUP_AUTH;
        }
        if (path.startsWith("/api/wallet/") || "/api/wallet".equals(path)
                || path.startsWith("/api/governance/") || "/api/governance".equals(path)) {
            return GROUP_RPC;
        }
        return null;
    }

    private static String resolveClientKey(HttpServletRequest request) {
        String ip = resolveClientIp(request);
        String token = request.getHeader(AUTH_TOKEN_HEADER);
        if (token != null && !token.isBlank()) {
            return ip + ":token:" + token.trim().hashCode();
        }
        return ip;
    }

    /**
     * Prefer the left-most {@code X-Forwarded-For} hop when behind a trusted reverse proxy.
     */
    static String resolveClientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            int comma = forwarded.indexOf(',');
            return (comma >= 0 ? forwarded.substring(0, comma) : forwarded).trim();
        }
        String realIp = request.getHeader("X-Real-IP");
        if (realIp != null && !realIp.isBlank()) {
            return realIp.trim();
        }
        return request.getRemoteAddr();
    }

    private void writeRateLimitResponse(HttpServletResponse response, RateLimitException exception) {
        response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
        response.setHeader("Retry-After", String.valueOf(exception.getRetryAfterSeconds()));
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        try {
            objectMapper.writeValue(response.getOutputStream(), Map.of(
                    "error", exception.getErrorCode(),
                    "message", exception.getMessage(),
                    "retryAfter", exception.getRetryAfterSeconds()));
        } catch (Exception e) {
            LOG.warn("Failed to write REST rate-limit response", e);
            response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
        }
    }
}
