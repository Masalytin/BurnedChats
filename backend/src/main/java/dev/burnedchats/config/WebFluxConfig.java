package dev.burnedchats.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Web MVC configuration for the BurnedChats backend.
 *
 * <p>Configures web handling including CORS settings
 * for the Telegram Mini App frontend.
 *
 * <p>Note: We use Spring MVC (servlet-based) instead of WebFlux
 * because STOMP over WebSocket requires a Servlet container.
 * Reactive operations are still possible using Project Reactor.
 */
@Configuration
@EnableWebMvc
public class WebFluxConfig implements WebMvcConfigurer {

    /**
     * Configure CORS mappings for cross-origin requests.
     *
     * <p>Allows requests from Telegram Mini App domains and localhost for development.
     *
     * @param registry the CORS registry
     */
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowedOriginPatterns(
                        "https://burnedchats.net",
                        "https://*.burnedchats.net",
                        "https://*.telegram.org",
                        "https://web.telegram.org",
                        "http://localhost:*",
                        "https://localhost:*"
                )
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true)
                .maxAge(3600);
    }
}

