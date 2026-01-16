package dev.burnedchats;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * Main entry point for BurnedChats backend application.
 *
 * <p>This Spring Boot application provides the backend services for
 * the BurnedChats Telegram Mini App, including WebSocket messaging,
 * Telegram Bot integration, and session management.
 */
@SpringBootApplication
@ConfigurationPropertiesScan("dev.burnedchats.config")
public class BurnedChatsApplication {

    /**
     * Application entry point.
     *
     * @param args command line arguments
     */
    public static void main(String[] args) {
        SpringApplication.run(BurnedChatsApplication.class, args);
    }
}


