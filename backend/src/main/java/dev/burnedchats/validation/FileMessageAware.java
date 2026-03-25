package dev.burnedchats.validation;

/**
 * Interface for DTOs that carry file message fields.
 *
 * <p>Used by {@link FileMessageValidator} to perform cross-field validation:
 * when {@code type} is not {@code "text"}, {@code fileId} must be present.
 */
public interface FileMessageAware {

    String getType();

    String getFileId();
}
