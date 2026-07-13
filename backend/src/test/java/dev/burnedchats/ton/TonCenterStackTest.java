package dev.burnedchats.ton;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("TonCenterStack")
class TonCenterStackTest {

    @Test
    @DisplayName("parseNumString handles Ton Center signed hex true (-0x1)")
    void signedHexTrue() {
        assertThat(TonCenterStack.parseNumString("-0x1")).isEqualTo(BigInteger.ONE.negate());
    }

    @Test
    @DisplayName("parseNumString handles unsigned hex zero")
    void unsignedHexZero() {
        assertThat(TonCenterStack.parseNumString("0x0")).isEqualTo(BigInteger.ZERO);
    }

    @Test
    @DisplayName("parseNumString handles decimal negative")
    void decimalNegative() {
        assertThat(TonCenterStack.parseNumString("-1")).isEqualTo(BigInteger.ONE.negate());
    }
}
