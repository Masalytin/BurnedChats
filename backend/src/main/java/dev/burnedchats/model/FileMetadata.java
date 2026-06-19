package dev.burnedchats.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Metadata for an encrypted file stored on the server.
 *
 * <p>Stored in Redis as {@code file_meta:{fileId}} (Hash) with TTL 24 hours.
 * The server never sees file contents — only opaque metadata needed for
 * access control, cleanup, and context binding.
 *
 * @see dev.burnedchats.repository.FileMetadataRepository
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FileMetadata {

    /** Unique file identifier (UUID v4). */
    private String fileId;

    /** Canonical uploader identity (internalId) for both auth modes. */
    private String uploaderInternalId;

    /** Telegram user ID of the uploader (optional; legacy / best-effort). */
    private String uploaderTgId;

    /** Context type: "session" or "room". */
    private String contextType;

    /** Session ID or Room ID the file belongs to. */
    private String contextId;

    /** Size of the encrypted blob in bytes. */
    private Long size;

    /** Unix timestamp (millis) when the file was uploaded. */
    private Long createdAt;
}
