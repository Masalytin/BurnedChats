package dev.burnedchats.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.time.Instant;

/**
 * Tombstone for a DM message deleted for everyone, delivered to the peer on sync
 * if they were offline at delete time.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MessageDeletion implements Serializable {

    private static final long serialVersionUID = 1L;

    private String messageId;
    private Long deletedByTgId;
    private Instant deletedAt;
}
