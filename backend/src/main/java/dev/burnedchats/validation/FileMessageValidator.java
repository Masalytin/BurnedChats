package dev.burnedchats.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/**
 * Validates cross-field constraint: non-text messages require a fileId.
 *
 * <p>Rules:
 * <ul>
 *   <li>If {@code type} is {@code null} or {@code "text"} — valid (text message, no file fields needed)</li>
 *   <li>If {@code type} is {@code "image"}, {@code "video"}, or {@code "file"} — {@code fileId} must be non-blank</li>
 * </ul>
 */
public class FileMessageValidator implements ConstraintValidator<ValidFileMessage, FileMessageAware> {

    private static final String TEXT_TYPE = "text";

    @Override
    public boolean isValid(FileMessageAware value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }

        String type = value.getType();
        if (type == null || TEXT_TYPE.equals(type)) {
            return true;
        }

        String fileId = value.getFileId();
        if (fileId == null || fileId.isBlank()) {
            context.disableDefaultConstraintViolation();
            context.buildConstraintViolationWithTemplate("fileId is required when type is '" + type + "'")
                    .addPropertyNode("fileId")
                    .addConstraintViolation();
            return false;
        }

        return true;
    }
}
