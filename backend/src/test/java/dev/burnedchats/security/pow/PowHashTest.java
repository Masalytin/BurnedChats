package dev.burnedchats.security.pow;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Cross-platform PoW hash tests (DESIGN.md §2.4).
 */
@DisplayName("PowHash")
class PowHashTest {

    private static final String NORMATIVE_CHALLENGE_ID = "00112233445566778899aabbccddeeff";
    private static final String NORMATIVE_NONCE = "1373";
    private static final int NORMATIVE_DIFFICULTY = 12;

    @Test
    @DisplayName("normative cross-platform vector meets difficulty 12 with nonce 1373")
    void normativeCrossPlatformVector() {
        assertTrue(PowHash.meetsDifficulty(
                NORMATIVE_CHALLENGE_ID, NORMATIVE_NONCE, NORMATIVE_DIFFICULTY));
    }

    @Test
    @DisplayName("normative digest has exactly 12 leading zero bits")
    void normativeLeadingZeroBits() {
        byte[] hash = PowHash.sha256(NORMATIVE_CHALLENGE_ID + NORMATIVE_NONCE);
        assertEquals(12, PowHash.leadingZeroBits(hash));
    }

    @Test
    @DisplayName("leadingZeroBits counts bits not hex characters")
    void leadingZeroBitsCountsBitsNotHexChars() {
        // 0x0d = 00001101 — four leading zero bits in the byte, not one hex char
        byte[] hash = hexToBytes("000d341cfc0f454bb1c5ce0e062e52d567c3e8cd7f467c96e0eaa8be1307ba80");
        assertEquals(12, PowHash.leadingZeroBits(hash));
    }

    @Test
    @DisplayName("all-zero digest has 256 leading zero bits capped by array length")
    void allZeroDigest() {
        byte[] hash = new byte[32];
        assertEquals(256, PowHash.leadingZeroBits(hash));
    }

    @Test
    @DisplayName("first non-zero byte partial zeros")
    void partialByteZeros() {
        byte[] hash = new byte[32];
        hash[0] = 0x10; // 00010000 — three leading zero bits
        assertEquals(3, PowHash.leadingZeroBits(hash));
    }

    private static byte[] hexToBytes(String hex) {
        byte[] bytes = new byte[hex.length() / 2];
        for (int i = 0; i < bytes.length; i++) {
            int index = i * 2;
            bytes[i] = (byte) Integer.parseInt(hex.substring(index, index + 2), 16);
        }
        return bytes;
    }
}
