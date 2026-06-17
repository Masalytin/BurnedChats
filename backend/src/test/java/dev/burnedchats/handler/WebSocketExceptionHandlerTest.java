package dev.burnedchats.handler;

import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.exception.BurnedChatsException;
import dev.burnedchats.exception.PowInvalidException;
import dev.burnedchats.exception.PowRequiredException;
import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.exception.SessionException;
import dev.burnedchats.exception.WalletProofException;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Path;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.handler.annotation.support.MethodArgumentNotValidException;
import org.springframework.validation.BeanPropertyBindingResult;
import org.springframework.validation.FieldError;

import java.time.Duration;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class WebSocketExceptionHandlerTest {

    private WebSocketExceptionHandler handler;

    @BeforeEach
    void setUp() {
        handler = new WebSocketExceptionHandler();
    }

    @Test
    @DisplayName("RateLimitException maps to RATE_LIMIT_EXCEEDED with retryAfter")
    void mapsRateLimitException() {
        Map<String, Object> response = handler.handleRateLimitException(
                new RateLimitException("slow down", Duration.ofSeconds(30)));

        assertThat(response.get("success")).isEqualTo(false);
        assertThat(response.get("error")).isEqualTo("RATE_LIMIT_EXCEEDED");
        assertThat(response.get("retryAfter")).isEqualTo(30L);
        assertThat(response.get("timestamp")).isNotNull();
    }

    @Test
    @DisplayName("PowRequiredException maps to POW_REQUIRED")
    void mapsPowRequiredException() {
        Map<String, Object> response = handler.handlePowRequiredException(new PowRequiredException("need pow"));

        assertThat(response.get("error")).isEqualTo("POW_REQUIRED");
    }

    @Test
    @DisplayName("PowInvalidException maps to POW_INVALID")
    void mapsPowInvalidException() {
        Map<String, Object> response = handler.handlePowInvalidException(new PowInvalidException("bad pow"));

        assertThat(response.get("error")).isEqualTo("POW_INVALID");
    }

    @Test
    @DisplayName("AuthenticationException maps to AUTH_ERROR")
    void mapsAuthenticationException() {
        Map<String, Object> response = handler.handleAuthenticationException(
                AuthenticationException.invalidSignature());

        assertThat(response.get("error")).isEqualTo("AUTH_ERROR");
        assertThat(response.get("message")).isEqualTo("Invalid initData signature");
    }

    @Test
    @DisplayName("SessionException maps to specific session error code")
    void mapsSessionException() {
        Map<String, Object> response = handler.handleSessionException(SessionException.notFound("sess-1"));

        assertThat(response.get("error")).isEqualTo("SESSION_NOT_FOUND");
        assertThat(response.get("message")).asString().contains("sess-1");
    }

    @Test
    @DisplayName("MethodArgumentNotValidException maps to VALIDATION_ERROR with field")
    void mapsMethodArgumentNotValidException() {
        BeanPropertyBindingResult bindingResult =
                new BeanPropertyBindingResult(new Object(), "sendMessageRequest");
        bindingResult.addError(new FieldError("sendMessageRequest", "sessionId", "Session ID is required"));

        MethodArgumentNotValidException exception = mock(MethodArgumentNotValidException.class);
        when(exception.getBindingResult()).thenReturn(bindingResult);

        Map<String, Object> response = handler.handleMethodArgumentNotValidException(exception);

        assertThat(response.get("error")).isEqualTo("VALIDATION_ERROR");
        assertThat(response.get("field")).isEqualTo("sessionId");
        assertThat(response.get("message")).isEqualTo("Session ID is required");
    }

    @Test
    @DisplayName("ConstraintViolationException maps to VALIDATION_ERROR")
    void mapsConstraintViolationException() {
        @SuppressWarnings("unchecked")
        ConstraintViolation<Object> violation = mock(ConstraintViolation.class);
        Path path = mock(Path.class);
        when(path.toString()).thenReturn("query");
        when(violation.getMessage()).thenReturn("Search query cannot be empty");
        when(violation.getPropertyPath()).thenReturn(path);

        Map<String, Object> response = handler.handleConstraintViolationException(
                new ConstraintViolationException(Set.of(violation)));

        assertThat(response.get("error")).isEqualTo("VALIDATION_ERROR");
        assertThat(response.get("field")).isEqualTo("query");
    }

    @Test
    @DisplayName("BurnedChatsException maps to declared error code")
    void mapsBurnedChatsException() {
        Map<String, Object> response = handler.handleBurnedChatsException(
                new WalletProofException(WalletProofException.Reason.NONCE_MISSING, "nonce missing", null));

        assertThat(response.get("error")).isEqualTo("NONCE_MISSING");
    }

    @Test
    @DisplayName("Generic BurnedChatsException without custom code uses BURNED_CHATS_ERROR")
    void mapsGenericBurnedChatsException() {
        Map<String, Object> response = handler.handleBurnedChatsException(
                new BurnedChatsException("something failed"));

        assertThat(response.get("error")).isEqualTo("BURNED_CHATS_ERROR");
    }

    @Test
    @DisplayName("Unhandled exception maps to INTERNAL_ERROR")
    void mapsGenericException() {
        Map<String, Object> response = handler.handleException(new IllegalStateException("boom"));

        assertThat(response.get("error")).isEqualTo("INTERNAL_ERROR");
        assertThat(response.get("message")).isEqualTo("An unexpected error occurred");
    }
}
