package dev.burnedchats.controller;

import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.security.SessionTokenService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@DisplayName("DevAuthController devLogin")
class DevAuthControllerTest {

    private static final UnifiedUser DEV_USER = new UnifiedUser(
            "internal-id-1", AuthType.WALLET, "dev-...nt-a", null, "dev-agent-a", null);

    private UserIdentityRepository userIdentityRepository;
    private SessionTokenService sessionTokenService;

    @BeforeEach
    void setUp() {
        userIdentityRepository = mock(UserIdentityRepository.class);
        sessionTokenService = mock(SessionTokenService.class);
    }

    private DevAuthController controller(boolean enabled) {
        return new DevAuthController(userIdentityRepository, sessionTokenService, enabled);
    }

    @Test
    @DisplayName("enabled: issues token and user payload")
    void enabledIssuesToken() {
        when(userIdentityRepository.findOrCreateByWallet("dev-agent-a")).thenReturn(Mono.just(DEV_USER));
        when(sessionTokenService.issueToken("internal-id-1")).thenReturn(Mono.just("token-123"));

        StepVerifier.create(controller(true).devLogin(new DevAuthController.DevLoginRequest("agent-a")))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
                    assertThat(resp.getBody()).containsEntry("token", "token-123");
                    @SuppressWarnings("unchecked")
                    Map<String, Object> user = (Map<String, Object>) resp.getBody().get("user");
                    assertThat(user).containsEntry("internalId", "internal-id-1");
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("disabled flag: returns 404 and never touches repositories")
    void disabledReturns404() {
        StepVerifier.create(controller(false).devLogin(new DevAuthController.DevLoginRequest("agent-a")))
                .assertNext(resp -> assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND))
                .verifyComplete();

        verifyNoInteractions(userIdentityRepository, sessionTokenService);
    }

    @Test
    @DisplayName("invalid label: returns 400")
    void invalidLabelReturns400() {
        StepVerifier.create(controller(true).devLogin(new DevAuthController.DevLoginRequest("BAD LABEL!")))
                .assertNext(resp -> assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST))
                .verifyComplete();

        verifyNoInteractions(userIdentityRepository, sessionTokenService);
    }

    @Test
    @DisplayName("missing body: returns 400")
    void missingBodyReturns400() {
        StepVerifier.create(controller(true).devLogin(null))
                .assertNext(resp -> assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST))
                .verifyComplete();
    }

    @Test
    @DisplayName("repository error: returns 500 with generic message")
    void repositoryErrorReturns500() {
        when(userIdentityRepository.findOrCreateByWallet(anyString()))
                .thenReturn(Mono.error(new IllegalStateException("redis down")));

        StepVerifier.create(controller(true).devLogin(new DevAuthController.DevLoginRequest("agent-a")))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
                    assertThat(resp.getBody()).containsEntry("message", "Dev login failed");
                })
                .verifyComplete();
    }
}
