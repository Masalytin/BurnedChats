package dev.burnedchats.config;

import dev.burnedchats.security.pow.PowAction;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Field defaults of {@link PowProperties} must match {@code application.yml}
 * (IMP-POWFAST-04 on-device recalibration). {@code new PowProperties()} is used
 * in tests that skip yaml binding.
 */
class PowPropertiesTest {

    @Test
    @DisplayName("new PowProperties() without yaml matches the on-device table")
    void fieldDefaultsMatchOnDeviceTable() {
        PowProperties properties = new PowProperties();

        assertThat(properties.getBase().getSearch()).isEqualTo(12);
        assertThat(properties.getBase().getSessionCreate()).isEqualTo(14);
        assertThat(properties.getBase().getInvite()).isEqualTo(14);
        assertThat(properties.getBase().getDmInvite()).isEqualTo(14);
        assertThat(properties.getBase().getRoomCreate()).isEqualTo(16);
        assertThat(properties.getCeiling()).isEqualTo(18);
    }

    @Test
    @DisplayName("baseDifficultyFor returns per-action defaults")
    void baseDifficultyForReturnsConfiguredBases() {
        PowProperties properties = new PowProperties();

        assertThat(properties.baseDifficultyFor(PowAction.SEARCH)).isEqualTo(12);
        assertThat(properties.baseDifficultyFor(PowAction.SESSION_CREATE)).isEqualTo(14);
        assertThat(properties.baseDifficultyFor(PowAction.INVITE)).isEqualTo(14);
        assertThat(properties.baseDifficultyFor(PowAction.DM_INVITE)).isEqualTo(14);
        assertThat(properties.baseDifficultyFor(PowAction.ROOM_CREATE)).isEqualTo(16);
    }

    @Test
    @DisplayName("baseDifficultyFor clips to ceiling")
    void baseDifficultyForClipsToCeiling() {
        PowProperties properties = new PowProperties();
        properties.setCeiling(13);
        properties.getBase().setRoomCreate(16);

        assertThat(properties.baseDifficultyFor(PowAction.ROOM_CREATE)).isEqualTo(13);
    }
}
