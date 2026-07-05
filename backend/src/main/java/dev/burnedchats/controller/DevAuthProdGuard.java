package dev.burnedchats.controller;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

/**
 * Fail-fast guard: dev-auth must never be enabled under the {@code prod} profile.
 *
 * <p>Placed outside {@link DevAuthController} because that controller is
 * {@code @Profile("dev")} and would not be instantiated in production, so an
 * in-controller check would never run.
 */
@Component
public class DevAuthProdGuard {

    private final Environment environment;
    private final boolean devAuthEnabled;

    DevAuthProdGuard(
            Environment environment,
            @Value("${burnedchats.dev-auth.enabled:${DEV_AUTH_ENABLED:false}}") boolean devAuthEnabled) {
        this.environment = environment;
        this.devAuthEnabled = devAuthEnabled;
    }

    @PostConstruct
    void assertNotProdWithDevAuth() {
        if (environment.acceptsProfiles(Profiles.of("prod")) && devAuthEnabled) {
            throw new IllegalStateException("DEV_AUTH must be disabled when the prod profile is active");
        }
    }
}
