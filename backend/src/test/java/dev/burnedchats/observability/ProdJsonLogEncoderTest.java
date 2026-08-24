package dev.burnedchats.observability;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.encoder.JsonEncoder;
import ch.qos.logback.classic.spi.LoggingEvent;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ProdJsonLogEncoderTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void jsonEncoderProducesParseableObjectWithAllowlistedMdc() throws Exception {
        Map<String, String> mdc = LogFieldPolicy.sanitizeMdc(Map.of(
                "sessionId", "ws-1",
                "destination", "/app/message.send",
                "internalIdPrefix", "abcd1234",
                "encryptedContent", "MUST-NOT-APPEAR"
        ));

        LoggingEvent event = new LoggingEvent();
        event.setLoggerName("dev.burnedchats.test");
        event.setLevel(Level.INFO);
        event.setMessage("accepted");
        event.setMDCPropertyMap(new LinkedHashMap<>(mdc));

        LoggerContext ctx = new LoggerContext();
        JsonEncoder encoder = new JsonEncoder();
        encoder.setContext(ctx);
        encoder.start();
        String json = new String(encoder.encode(event), StandardCharsets.UTF_8);
        encoder.stop();

        JsonNode root = MAPPER.readTree(json);
        assertThat(root.isObject()).isTrue();
        assertThat(root.toString()).doesNotContain("MUST-NOT-APPEAR");
        assertThat(root.toString()).doesNotContain("encryptedContent");
        assertThat(findMdc(root, "sessionId")).isEqualTo("ws-1");
        assertThat(findMdc(root, "destination")).isEqualTo("/app/message.send");
    }

    private static String findMdc(JsonNode root, String key) {
        JsonNode mdc = root.get("mdc");
        if (mdc != null && mdc.has(key)) {
            return mdc.get(key).asText();
        }
        JsonNode nested = root.get("MDC");
        if (nested != null && nested.has(key)) {
            return nested.get(key).asText();
        }
        return root.path(key).asText(null);
    }
}
