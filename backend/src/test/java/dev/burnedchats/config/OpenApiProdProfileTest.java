package dev.burnedchats.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@ActiveProfiles({"prod", "test"})
@TestPropertySource(properties = {
    "spring.data.redis.host=localhost",
    "spring.data.redis.password=",
    "telegram.bot.token=",
    "telegram.bot.username=TestBot",
    "telegram.bot.webhook.enabled=false",
    "telegram.mini-app.url=https://test.example.com",
    "security.cors.allowed-origins=https://test.example.com",
    "springdoc.api-docs.enabled=false",
    "springdoc.swagger-ui.enabled=false"
})
@DisplayName("OpenAPI prod profile guard")
class OpenApiProdProfileTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    @DisplayName("swagger-ui and api-docs return 404")
    void prodProfileDisablesSpringdocEndpoints() throws Exception {
        mockMvc.perform(get("/swagger-ui.html")).andExpect(status().isNotFound());
        mockMvc.perform(get("/v3/api-docs")).andExpect(status().isNotFound());
    }
}
