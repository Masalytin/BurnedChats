package dev.burnedchats.handler;

import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.exception.BurnedChatsException;
import dev.burnedchats.exception.PowInvalidException;
import dev.burnedchats.exception.PowRequiredException;
import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.exception.SessionException;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.support.MethodArgumentNotValidException;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.validation.BindingResult;
import org.springframework.validation.FieldError;
import org.springframework.validation.method.ParameterValidationResult;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

/**
 * Global exception handler for WebSocket/STOMP messaging.
 *
 * <p>Handles exceptions thrown during message processing and
 * sends appropriate error responses to the user.
 */
@Slf4j
@ControllerAdvice
public class WebSocketExceptionHandler {

    /**
     * Handle RateLimitException (5.1.6).
     *
     * <p>Sends an error response with retry-after information.
     *
     * @param exception the rate limit exception
     * @return error response map
     */
    @MessageExceptionHandler(RateLimitException.class)
    @SendToUser("/queue/errors")
    public Map<String, Object> handleRateLimitException(RateLimitException exception) {
        LOG.warn("Rate limit exceeded: {}", exception.getMessage());

        Map<String, Object> response = baseError("RATE_LIMIT_EXCEEDED", exception.getMessage());
        response.put("retryAfter", exception.getRetryAfterSeconds());
        return response;
    }

    /**
     * Handle missing or expired PoW challenge on gated actions.
     */
    @MessageExceptionHandler(PowRequiredException.class)
    @SendToUser("/queue/errors")
    public Map<String, Object> handlePowRequiredException(PowRequiredException exception) {
        LOG.debug("PoW required: {}", exception.getMessage());
        return baseError("POW_REQUIRED", exception.getMessage());
    }

    /**
     * Handle invalid PoW solution (wrong hash, action mismatch, replay).
     */
    @MessageExceptionHandler(PowInvalidException.class)
    @SendToUser("/queue/errors")
    public Map<String, Object> handlePowInvalidException(PowInvalidException exception) {
        LOG.debug("PoW invalid: {}", exception.getMessage());
        return baseError("POW_INVALID", exception.getMessage());
    }

    /**
     * Handle authentication failures surfaced during STOMP message handling.
     */
    @MessageExceptionHandler(AuthenticationException.class)
    @SendToUser("/queue/errors")
    public Map<String, Object> handleAuthenticationException(AuthenticationException exception) {
        LOG.warn("Authentication error: {}", exception.getMessage());
        return baseError(exception.getErrorCode(), exception.getMessage());
    }

    /**
     * Handle session domain errors with structured client codes.
     */
    @MessageExceptionHandler(SessionException.class)
    @SendToUser("/queue/errors")
    public Map<String, Object> handleSessionException(SessionException exception) {
        LOG.debug("Session error [{}]: {}", exception.getErrorCode(), exception.getMessage());
        return baseError(exception.getErrorCode(), exception.getMessage());
    }

    /**
     * Handle Bean Validation failures on {@code @Payload @Valid} arguments.
     *
     * <p>STOMP message handling throws the <em>messaging</em>
     * {@link org.springframework.messaging.handler.annotation.support.MethodArgumentNotValidException},
     * not the servlet {@code org.springframework.web.bind} variant — catching the wrong type let every
     * invalid payload fall through to {@code INTERNAL_ERROR} instead of {@code VALIDATION_ERROR}.
     */
    @MessageExceptionHandler(MethodArgumentNotValidException.class)
    @SendToUser("/queue/errors")
    public Map<String, Object> handleMethodArgumentNotValidException(MethodArgumentNotValidException exception) {
        BindingResult bindingResult = exception.getBindingResult();
        FieldError fieldError = bindingResult != null ? bindingResult.getFieldError() : null;
        String message = fieldError != null && fieldError.getDefaultMessage() != null
                ? fieldError.getDefaultMessage()
                : "Validation failed";
        LOG.debug("Payload validation failed: {}", message);
        Map<String, Object> response = baseError("VALIDATION_ERROR", message);
        if (fieldError != null && fieldError.getField() != null) {
            response.put("field", fieldError.getField());
        }
        return response;
    }

    /**
     * Handle method-level validation failures (Spring 6.1+).
     */
    @MessageExceptionHandler(HandlerMethodValidationException.class)
    @SendToUser("/queue/errors")
    public Map<String, Object> handleHandlerMethodValidationException(HandlerMethodValidationException exception) {
        ParameterValidationResult first = exception.getAllValidationResults().stream()
                .findFirst()
                .orElse(null);
        String message = "Validation failed";
        String field = null;
        if (first != null) {
            field = first.getMethodParameter().getParameterName();
            if (!first.getResolvableErrors().isEmpty()) {
                message = first.getResolvableErrors().get(0).getDefaultMessage();
            }
        }
        LOG.debug("Method validation failed: {}", message);
        Map<String, Object> response = baseError("VALIDATION_ERROR", message);
        if (field != null) {
            response.put("field", field);
        }
        return response;
    }

    /**
     * Handle constraint violations from {@code @Validated} handler methods.
     */
    @MessageExceptionHandler(ConstraintViolationException.class)
    @SendToUser("/queue/errors")
    public Map<String, Object> handleConstraintViolationException(ConstraintViolationException exception) {
        ConstraintViolation<?> violation = exception.getConstraintViolations().stream()
                .findFirst()
                .orElse(null);
        String message = violation != null ? violation.getMessage() : "Validation failed";
        LOG.debug("Constraint violation: {}", message);
        Map<String, Object> response = baseError("VALIDATION_ERROR", message);
        if (violation != null && violation.getPropertyPath() != null) {
            response.put("field", violation.getPropertyPath().toString());
        }
        return response;
    }

    /**
     * Handle remaining domain exceptions with their declared error codes.
     */
    @MessageExceptionHandler(BurnedChatsException.class)
    @SendToUser("/queue/errors")
    public Map<String, Object> handleBurnedChatsException(BurnedChatsException exception) {
        LOG.warn("Domain error [{}]: {}", exception.getErrorCode(), exception.getMessage());
        return baseError(exception.getErrorCode(), exception.getMessage());
    }

    /**
     * Handle generic exceptions.
     *
     * @param exception the exception
     * @return error response map
     */
    @MessageExceptionHandler(Exception.class)
    @SendToUser("/queue/errors")
    public Map<String, Object> handleException(Exception exception) {
        LOG.error("Unhandled WebSocket exception: {}", exception.getMessage(), exception);
        return baseError("INTERNAL_ERROR", "An unexpected error occurred");
    }

    private static Map<String, Object> baseError(String errorCode, String message) {
        Map<String, Object> response = new HashMap<>();
        response.put("success", false);
        response.put("error", errorCode);
        response.put("message", message);
        response.put("timestamp", Instant.now().toString());
        return response;
    }
}
