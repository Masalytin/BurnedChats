package dev.burnedchats.ton;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.burnedchats.ton.exception.TonRpcException;
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

    @Test
    @DisplayName("parseNumString handles TVM x-prefix hex (prod jetton-info \"x1\")")
    void tvmXPrefixHex() {
        assertThat(TonCenterStack.parseNumString("x1")).isEqualTo(BigInteger.ONE);
        assertThat(TonCenterStack.parseNumString("-x1")).isEqualTo(BigInteger.ONE.negate());
        assertThat(TonCenterStack.parseNumString("X1a")).isEqualTo(BigInteger.valueOf(26));
    }

    @Test
    @DisplayName("parseNumString wraps garbage as TonRpcException not NumberFormatException")
    void garbageIsTonRpcException() {
        assertThatThrownBy(() -> TonCenterStack.parseNumString("not-a-num"))
                .isInstanceOf(TonRpcException.class)
                .isNotInstanceOf(NumberFormatException.class);
    }
}
