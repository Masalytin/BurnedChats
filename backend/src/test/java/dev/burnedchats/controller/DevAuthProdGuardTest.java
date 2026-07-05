package dev.burnedchats.controller;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@DisplayName("DevAuthProdGuard")
class DevAuthProdGuardTest {

    @Test
    @DisplayName("prod profile + dev-auth enabled: fails fast")
    void prodWithDevAuthEnabledFailsFast() {
        Environment environment = mock(Environment.class);
        when(environment.acceptsProfiles(Profiles.of("prod"))).thenReturn(true);

        DevAuthProdGuard guard = new DevAuthProdGuard(environment, true);

        assertThatThrownBy(guard::assertNotProdWithDevAuth)
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("DEV_AUTH must be disabled when the prod profile is active");
    }

    @Test
    @DisplayName("prod profile + dev-auth disabled: starts normally")
    void prodWithDevAuthDisabledStarts() {
        Environment environment = mock(Environment.class);
        when(environment.acceptsProfiles(Profiles.of("prod"))).thenReturn(true);

        DevAuthProdGuard guard = new DevAuthProdGuard(environment, false);

        assertThatCode(guard::assertNotProdWithDevAuth).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("dev profile + dev-auth enabled: starts normally")
    void devProfileWithDevAuthEnabledStarts() {
        Environment environment = mock(Environment.class);
        when(environment.acceptsProfiles(Profiles.of("prod"))).thenReturn(false);

        DevAuthProdGuard guard = new DevAuthProdGuard(environment, true);

        assertThatCode(guard::assertNotProdWithDevAuth).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("test profile + dev-auth enabled: starts normally")
    void testProfileWithDevAuthEnabledStarts() {
        Environment environment = mock(Environment.class);
        when(environment.acceptsProfiles(Profiles.of("prod"))).thenReturn(false);

        DevAuthProdGuard guard = new DevAuthProdGuard(environment, true);

        assertThatCode(guard::assertNotProdWithDevAuth).doesNotThrowAnyException();
    }
}
