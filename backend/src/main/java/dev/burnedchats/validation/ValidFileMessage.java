package dev.burnedchats.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Validates that file-related fields are consistent with the message type.
 *
 * <p>When {@code type} is not {@code "text"} (i.e. {@code "image"}, {@code "video"},
 * or {@code "file"}), the {@code fileId} field must be non-blank.
 *
 * <p>Applied at the class level on message request DTOs that implement
 * {@link FileMessageAware}.
 *
 * @see FileMessageValidator
 */
@Documented
@Constraint(validatedBy = FileMessageValidator.class)
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface ValidFileMessage {

    String message() default "fileId is required for non-text message types";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
