package dev.burnedchats.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("FileStorageProperties.resolveMetadataTtl")
class FileStoragePropertiesTtlTest {

    private static final Duration DEFAULT_24H = Duration.ofHours(24);

    @Test
    @DisplayName("uses default when no room constraints")
    void defaultWhenNoRoom() {
        assertThat(FileStorageProperties.resolveMetadataTtl(DEFAULT_24H, null, null))
                .isEqualTo(DEFAULT_24H);
    }

    @Test
    @DisplayName("extends to room message TTL when it is longer than 24h")
    void extendsToMessageTtl() {
        assertThat(FileStorageProperties.resolveMetadataTtl(DEFAULT_24H, 3 * 24 * 3600, Duration.ofDays(30)))
                .isEqualTo(Duration.ofDays(3));
    }

    @Test
    @DisplayName("caps at remaining room hash TTL")
    void capsAtRoomHash() {
        assertThat(FileStorageProperties.resolveMetadataTtl(DEFAULT_24H, 3 * 24 * 3600, Duration.ofHours(2)))
                .isEqualTo(Duration.ofHours(2));
    }

    @Test
    @DisplayName("does not sniff MIME — only durations")
    void durationsOnly() {
        assertThat(FileStorageProperties.resolveMetadataTtl(Duration.ofHours(1), 60, null))
                .isEqualTo(Duration.ofHours(1));
    }
}
