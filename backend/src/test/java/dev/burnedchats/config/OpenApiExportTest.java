package dev.burnedchats.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Iterator;
import java.util.Set;
import java.util.TreeSet;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@ActiveProfiles({"dev", "test"})
@DisplayName("OpenAPI export (dev profile)")
class OpenApiExportTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    @DisplayName("public REST paths present; dev-login and webhook absent")
    void devExportBaselineIncludesPublicPaths() throws Exception {
        String json = mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();

        JsonNode root = objectMapper.readTree(json);
        Set<String> paths = new TreeSet<>();
        Iterator<String> fieldNames = root.path("paths").fieldNames();
        while (fieldNames.hasNext()) {
            paths.add(fieldNames.next());
        }

        assertThat(paths.size()).isGreaterThanOrEqualTo(14);
        assertThat(paths).contains("/api/auth/nonce");
        assertThat(paths).contains("/api/health");
        assertThat(paths).anyMatch(path -> path.startsWith("/api/files/"));
        assertThat(paths).noneMatch(path -> path.startsWith("/api/governance/"));
        assertThat(paths).noneMatch(path -> path.contains("/staking-profile"));
        assertThat(paths).noneMatch(path -> path.contains("dev-login"));
        assertThat(paths).noneMatch(path -> path.contains("/telegram/webhook"));
    }

    @Test
    @DisplayName("removed governance and staking-profile routes return 404")
    void removedTokenRoutesReturn404() throws Exception {
        String sampleAddress = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";
        mockMvc.perform(get("/api/governance/active-proposals")).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/governance/recent-proposals")).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/governance/proposals/1")).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/governance/voting-power").param("address", sampleAddress))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/wallet/staking-profile").param("address", sampleAddress))
                .andExpect(status().isNotFound());
    }
}
