package dev.burnedchats.observability;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class ProdLogbackConfigTest {

    @Test
    void prodProfileUsesLogbackJsonEncoder() throws Exception {
        Path xml = Path.of("src/main/resources/logback-spring.xml");
        if (!Files.exists(xml)) {
            xml = Path.of("backend/src/main/resources/logback-spring.xml");
        }
        String body = Files.readString(xml, StandardCharsets.UTF_8);
        int prod = body.indexOf("<springProfile name=\"prod\">");
        assertThat(prod).isGreaterThanOrEqualTo(0);
        String prodBlock = body.substring(prod);
        int end = prodBlock.indexOf("</springProfile>");
        assertThat(end).isGreaterThan(0);
        prodBlock = prodBlock.substring(0, end);
        assertThat(prodBlock).contains("ch.qos.logback.classic.encoder.JsonEncoder");
        assertThat(prodBlock).contains("burned-chats.json.log");
        assertThat(body).doesNotContain("name=\"FILE\"");
    }
}
