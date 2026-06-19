package dev.burnedchats.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.time.Instant;

/**
 * Short-lived server metadata for validating DM message ownership and the
 * 15-minute edit window when the message is no longer in the offline queue.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DmMessageEditableMeta implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * Stable sender identity for edit/delete ownership (wallet + Telegram).
     */
    private String senderInternalId;

    /**
     * Legacy Telegram user id; used when {@link #senderInternalId} is absent in older Redis entries.
     */
    private Long senderId;
    private Instant serverTimestamp;

    /**
     * Present for non-text messages after relay — used when deleting a delivered message
     * so attachment blobs can be removed from storage.
     */
    private String fileId;
    private String thumbnailFileId;
}
