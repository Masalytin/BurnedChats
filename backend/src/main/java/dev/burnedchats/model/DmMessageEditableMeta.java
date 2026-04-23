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

    private Long senderId;
    private Instant serverTimestamp;
}
