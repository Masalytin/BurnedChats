package dev.burnedchats.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.burnedchats.config.RateLimitProperties;
import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.service.RateLimitService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.mock.web.DelegatingServletOutputStream;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("RestRateLimitInterceptor")
class RestRateLimitInterceptorTest {

    @Mock
    private RateLimitService rateLimitService;

    @Mock
    private HttpServletRequest request;

    @Mock
    private HttpServletResponse response;

    private RestRateLimitInterceptor interceptor;
    private ByteArrayOutputStream responseBody;

    @BeforeEach
    void setUp() throws Exception {
        RateLimitProperties properties = new RateLimitProperties();
        properties.getRequests().setPerMinute(60);
        interceptor = new RestRateLimitInterceptor(
                rateLimitService, properties, new ObjectMapper(), 20, 0);

        responseBody = new ByteArrayOutputStream();
        when(response.getOutputStream()).thenReturn(new DelegatingServletOutputStream(responseBody));
    }

    @Test
    @DisplayName("auth path within limit: passes through")
    void authWithinLimit() {
        when(request.getRequestURI()).thenReturn("/api/auth/wallet");
        when(request.getRemoteAddr()).thenReturn("203.0.113.10");

        boolean allowed = interceptor.preHandle(request, response, new Object());

        assertThat(allowed).isTrue();
        verify(rateLimitService).checkRateLimitBlocking(eq("auth"), eq("203.0.113.10"), eq(20), any());
    }

    @Test
    @DisplayName("rpc path within limit: uses inherited rpc budget")
    void rpcWithinLimit() {
        when(request.getRequestURI()).thenReturn("/api/wallet/burn-balance");
        when(request.getRemoteAddr()).thenReturn("203.0.113.11");

        boolean allowed = interceptor.preHandle(request, response, new Object());

        assertThat(allowed).isTrue();
        verify(rateLimitService).checkRateLimitBlocking(eq("rpc"), eq("203.0.113.11"), eq(60), any());
    }

    @Test
    @DisplayName("exceeded limit: returns 429 with Retry-After")
    void exceededLimitReturns429() throws Exception {
        when(request.getRequestURI()).thenReturn("/api/wallet/jetton-wallet");
        when(request.getHeader("X-Forwarded-For")).thenReturn("198.51.100.5, 10.0.0.1");
        doThrow(new RateLimitException(Duration.ofSeconds(42)))
                .when(rateLimitService)
                .checkRateLimitBlocking(eq("rpc"), eq("198.51.100.5"), eq(60), any());

        boolean allowed = interceptor.preHandle(request, response, new Object());

        assertThat(allowed).isFalse();
        verify(response).setStatus(429);
        verify(response).setHeader("Retry-After", "42");

        @SuppressWarnings("unchecked")
        Map<String, Object> body = new ObjectMapper().readValue(
                responseBody.toString(StandardCharsets.UTF_8), Map.class);
        assertThat(body.get("error")).isEqualTo("RATE_LIMIT_EXCEEDED");
        assertThat(body.get("retryAfter")).isEqualTo(42);
    }

    @Test
    @DisplayName("health and unrelated paths are not rate limited")
    void unrelatedPathsSkipped() {
        when(request.getRequestURI()).thenReturn("/actuator/health");

        boolean allowed = interceptor.preHandle(request, response, new Object());

        assertThat(allowed).isTrue();
        verify(rateLimitService, never()).checkRateLimitBlocking(any(), any(), any(int.class), any());
    }

    @Test
    @DisplayName("authenticated requests include token suffix in client key")
    void authenticatedClientKey() {
        when(request.getRequestURI()).thenReturn("/api/auth/linked-accounts");
        when(request.getRemoteAddr()).thenReturn("127.0.0.1");
        when(request.getHeader("X-Auth-Token")).thenReturn("opaque-session-token");

        interceptor.preHandle(request, response, new Object());

        verify(rateLimitService).checkRateLimitBlocking(
                eq("auth"),
                eq("127.0.0.1:token:" + "opaque-session-token".trim().hashCode()),
                eq(20),
                any());
    }

    @Test
    @DisplayName("resolveClientIp prefers X-Forwarded-For left-most hop")
    void resolveClientIpUsesForwardedFor() {
        when(request.getHeader("X-Forwarded-For")).thenReturn("203.0.113.7, 10.0.0.2");

        assertThat(RestRateLimitInterceptor.resolveClientIp(request)).isEqualTo("203.0.113.7");
    }
}
