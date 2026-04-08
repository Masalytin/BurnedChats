package dev.burnedchats.util;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@DisplayName("SecretAnswerHasher")
class SecretAnswerHasherTest {

    @Nested
    @DisplayName("hash")
    class Hash {
        @Test
        @DisplayName("same logical answer normalizes to same hash")
        void sameAfterNormalization() {
            String h1 = SecretAnswerHasher.hash("  Barsik  ");
            String h2 = SecretAnswerHasher.hash("barsik");
            assertEquals(h1, h2);
        }

        @Test
        @DisplayName("different answers yield different hashes")
        void differentAnswers() {
            String h1 = SecretAnswerHasher.hash("a");
            String h2 = SecretAnswerHasher.hash("b");
            assertNotEquals(h1, h2);
        }
    }

    @Nested
    @DisplayName("constantTimeEquals")
    class ConstantTimeEquals {
        @Test
        @DisplayName("returns true for equal digests")
        void equalDigests() {
            String h = SecretAnswerHasher.hash("secret");
            assertTrue(SecretAnswerHasher.constantTimeEquals(h, h));
            assertTrue(SecretAnswerHasher.constantTimeEquals(
                    SecretAnswerHasher.hash("x"),
                    SecretAnswerHasher.hash("X ")));
        }

        @Test
        @DisplayName("returns false for different digests")
        void differentDigests() {
            String a = SecretAnswerHasher.hash("one");
            String b = SecretAnswerHasher.hash("two");
            assertFalse(SecretAnswerHasher.constantTimeEquals(a, b));
        }

        @Test
        @DisplayName("returns false for null or invalid base64")
        void nullOrInvalid() {
            String h = SecretAnswerHasher.hash("ok");
            assertFalse(SecretAnswerHasher.constantTimeEquals(null, h));
            assertFalse(SecretAnswerHasher.constantTimeEquals(h, null));
            assertFalse(SecretAnswerHasher.constantTimeEquals(h, "not-valid-base64!!!"));
        }
    }
}
