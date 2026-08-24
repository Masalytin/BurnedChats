package dev.burnedchats.observability;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class LogFieldPolicyTest {

    @Test
    void forbiddenKeysIncludeCiphertextAndSecrets() {
        assertThat(LogFieldPolicy.FORBIDDEN_MDC_KEYS)
                .contains("encryptedContent", "initData", "token");
    }

    @Test
    void sanitizeMdcDropsForbiddenKeysAndKeepsAllowlisted() {
        Map<String, String> raw = new HashMap<>();
        raw.put("sessionId", "s1");
        raw.put("roomId", "r1");
        raw.put("destination", "/app/message.send");
        raw.put("internalIdPrefix", "abcd1234");
        raw.put("encryptedContent", "cipher-blob");
        raw.put("initData", "query_id=secret");
        raw.put("token", "bearer-secret");

        Map<String, String> clean = LogFieldPolicy.sanitizeMdc(raw);

        assertThat(clean).containsEntry("sessionId", "s1")
                .containsEntry("roomId", "r1")
                .containsEntry("destination", "/app/message.send")
                .containsEntry("internalIdPrefix", "abcd1234")
                .doesNotContainKeys("encryptedContent", "initData", "token");
    }

    @Test
    void prefixInternalIdIsPrefixOnlyNeverFullId() {
        assertThat(LogFieldPolicy.prefixInternalId("abcdef0123456789deadbeef"))
                .isEqualTo("abcdef01");
        assertThat(LogFieldPolicy.prefixInternalId("ab")).isEqualTo("ab");
        assertThat(LogFieldPolicy.prefixInternalId(null)).isNull();
    }
}
