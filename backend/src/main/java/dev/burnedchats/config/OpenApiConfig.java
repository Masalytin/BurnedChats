package dev.burnedchats.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

/**
 * springdoc OpenAPI metadata for dev/testnet Swagger UI.
 *
 * <p>Production disables api-docs and swagger-ui via {@code application-prod.yml}.
 */
@Configuration
@Profile({"dev", "testnet"})
public class OpenApiConfig {

    @Bean
    public OpenAPI burnedChatsOpenApi() {
        return new OpenAPI()
                .info(new Info()
                        .title("Burned Chats API")
                        .description("REST surface for Burned Chats Telegram Mini App")
                        .version("0.4.3"));
    }
}
