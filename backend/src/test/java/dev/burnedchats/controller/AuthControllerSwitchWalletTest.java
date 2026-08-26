package dev.burnedchats.controller;

import dev.burnedchats.config.TelegramProperties;
import dev.burnedchats.exception.WalletProofException;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.repository.WalletTelegramLinkChallengeStore;
import dev.burnedchats.security.AuthAccountLinkService;
import dev.burnedchats.security.AuthCredentials;
import dev.burnedchats.security.AuthenticationService;
import dev.burnedchats.security.SessionTokenService;
import dev.burnedchats.security.TelegramAuthService;
import dev.burnedchats.ton.TonProofVerifier;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import static org.assertj.core.api.Assertions.assertThat;
import org.mockito.ArgumentCaptor;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@DisplayName("AuthController switchWallet")
class AuthControllerSwitchWalletTest {

    private static final String INIT_DATA = "init-data";
    private static final String SESSION = "session-token";
    private static final String WALLET_A = "0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final String WALLET_B = "0:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    private static final String NEW_PROOF = "{\"proof\":{\"payload\":\"new-nonce\"}}";
    private static final String PREV_PROOF = "{\"proof\":{\"payload\":\"prev-nonce\"}}";

    private AuthAccountLinkService authAccountLinkService;
    private AuthController controller;

    @BeforeEach
    void setUp() {
        authAccountLinkService = mock(AuthAccountLinkService.class);
        controller = new AuthController(
                mock(TonProofVerifier.class),
                mock(AuthenticationService.class),
                mock(SessionTokenService.class),
                authAccountLinkService,
                mock(TelegramAuthService.class),
                mock(TelegramProperties.class));
    }

    @Test
    @DisplayName("TMA happy path without previous proof returns 200 linked payload")
    void tmaHappyPathReturns200() {
        when(authAccountLinkService.switchWallet(
                        eq(INIT_DATA), isNull(), eq(WALLET_B), eq(NEW_PROOF), isNull(),
                        isNull(), isNull(), isNull(), isNull()))
                .thenReturn(Mono.just(linkedUser(WALLET_B)));

        StepVerifier.create(controller.switchWallet(new AuthController.SwitchWalletRequest(
                        INIT_DATA, null, WALLET_B, NEW_PROOF, null, null, null, null, null)))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
                    assertThat(resp.getBody()).containsEntry("ok", Boolean.TRUE);
                    assertThat(resp.getBody()).containsEntry("walletLinked", Boolean.TRUE);
                    assertThat(resp.getBody()).containsEntry("walletAddress", WALLET_B);
                    assertThat(resp.getBody()).containsEntry("internalId", "user-1");
                    assertThat(resp.getBody()).containsEntry("authType", "TELEGRAM");
                    assertThat(resp.getBody()).containsEntry("displayName", "Alice");
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("web happy path with both proofs returns 200")
    void webHappyPathReturns200() {
        when(authAccountLinkService.switchWallet(
                        isNull(), eq(SESSION), eq(WALLET_B), eq(NEW_PROOF), eq(PREV_PROOF),
                        isNull(), isNull(), isNull(), isNull()))
                .thenReturn(Mono.just(linkedUser(WALLET_B)));

        StepVerifier.create(controller.switchWallet(new AuthController.SwitchWalletRequest(
                        null, SESSION, WALLET_B, NEW_PROOF, PREV_PROOF, null, null, null, null)))
                .assertNext(resp -> assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK))
                .verifyComplete();
    }

    @Test
    @DisplayName("foreign internalId returns 409 CONFLICT with no-write semantics from service")
    void conflictReturns409WithCode() {
        when(authAccountLinkService.switchWallet(any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(Mono.error(new IllegalStateException("Wallet already linked to another account")));

        StepVerifier.create(controller.switchWallet(new AuthController.SwitchWalletRequest(
                        INIT_DATA, null, WALLET_B, NEW_PROOF, null, null, null, null, null)))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
                    assertBodyCode(resp, "CONFLICT");
                    assertThat(resp.getBody()).containsEntry(
                            "message", "Wallet already linked to another account");
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("proof failure uses the same HTTP map as link-wallet")
    void proofFailureSameHttpMapAsLinkWallet() {
        when(authAccountLinkService.switchWallet(any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(Mono.error(new WalletProofException(
                        WalletProofException.Reason.SIGNATURE_INVALID,
                        "signature mismatch",
                        null)));

        StepVerifier.create(controller.switchWallet(new AuthController.SwitchWalletRequest(
                        INIT_DATA, null, WALLET_B, NEW_PROOF, null, null, null, null, null)))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
                    assertBodyCode(resp, "SIGNATURE_INVALID");
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("missing walletAddress/walletProof → 400")
    void missingRequiredFieldsReturns400() {
        StepVerifier.create(controller.switchWallet(new AuthController.SwitchWalletRequest(
                        INIT_DATA, null, "", NEW_PROOF, null, null, null, null, null)))
                .assertNext(resp -> assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST))
                .verifyComplete();
    }

    @Test
    @DisplayName("last-method unlink still returns 400")
    void lastMethodUnlinkStill400() {
        when(authAccountLinkService.unlinkWallet(INIT_DATA))
                .thenReturn(Mono.error(new IllegalStateException("Cannot unlink the last sign-in method")));

        StepVerifier.create(controller.unlinkWallet(new AuthController.InitDataOnlyRequest(INIT_DATA)))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(resp.getBody()).containsEntry(
                            "message", "Cannot unlink the last sign-in method");
                })
                .verifyComplete();
    }

    @Nested
    @DisplayName("AuthAccountLinkService switch rules")
    class ServiceRules {
        private AuthenticationService authenticationService;
        private TonProofVerifier tonProofVerifier;
        private SessionTokenService sessionTokenService;
        private UserIdentityRepository userIdentityRepository;
        private AuthAccountLinkService service;

        @BeforeEach
        void setUpService() {
            authenticationService = mock(AuthenticationService.class);
            tonProofVerifier = mock(TonProofVerifier.class);
            sessionTokenService = mock(SessionTokenService.class);
            userIdentityRepository = mock(UserIdentityRepository.class);
            service = new AuthAccountLinkService(
                    authenticationService,
                    tonProofVerifier,
                    sessionTokenService,
                    userIdentityRepository,
                    mock(WalletTelegramLinkChallengeStore.class));
            when(userIdentityRepository.walletsEqual(anyString(), anyString())).thenCallRealMethod();
            when(userIdentityRepository.canonicalWalletRaw(anyString())).thenCallRealMethod();
        }

        @Test
        @DisplayName("web without Telegram → 400 and no Redis write")
        void webWithoutTelegramDoesNotWrite() {
            UnifiedUser walletOnly = new UnifiedUser(
                    "user-1", AuthType.WALLET, "Alice", null, WALLET_A, null);
            when(sessionTokenService.validateAndRefresh(SESSION)).thenReturn(Mono.just("user-1"));
            when(userIdentityRepository.findById("user-1")).thenReturn(Mono.just(walletOnly));

            StepVerifier.create(service.switchWallet(null, SESSION, WALLET_B, NEW_PROOF, PREV_PROOF))
                    .expectErrorSatisfies(ex -> {
                        assertThat(ex).isInstanceOf(IllegalArgumentException.class);
                        assertThat(ex.getMessage()).contains("Telegram");
                    })
                    .verify();

            verify(userIdentityRepository, never()).switchWallet(anyString(), anyString());
            verify(tonProofVerifier, never()).verify(any());
        }

        @Test
        @DisplayName("web without previousWalletProof → 400")
        void webWithoutPreviousProofReturns400() {
            stubTelegramWebUser();

            StepVerifier.create(service.switchWallet(null, SESSION, WALLET_B, NEW_PROOF, null))
                    .expectError(IllegalArgumentException.class)
                    .verify();

            verify(userIdentityRepository, never()).switchWallet(anyString(), anyString());
        }

        @Test
        @DisplayName("previous proof address ≠ current linked → 400")
        void previousProofMismatchReturns400() {
            stubTelegramWebUser();
            when(tonProofVerifier.verify(any(AuthCredentials.class)))
                    .thenReturn(Mono.just(new TonProofVerifier.VerifiedTonProof(WALLET_B, "prev", 1L)));

            StepVerifier.create(service.switchWallet(null, SESSION, WALLET_B, NEW_PROOF, PREV_PROOF))
                    .expectErrorSatisfies(ex -> {
                        assertThat(ex).isInstanceOf(IllegalArgumentException.class);
                        assertThat(ex.getMessage()).contains("previousWalletProof");
                    })
                    .verify();

            verify(userIdentityRepository, never()).switchWallet(anyString(), anyString());
        }

        @Test
        @DisplayName("TMA switch without previous proof verifies only the new wallet")
        void tmaLostSeedDoesNotRequirePreviousProof() {
            UnifiedUser tma = linkedUser(WALLET_A);
            when(authenticationService.authenticate(any(AuthCredentials.class))).thenReturn(Mono.just(tma));
            when(userIdentityRepository.findByTelegramId(42L)).thenReturn(Mono.just("user-1"));
            when(tonProofVerifier.verify(any(AuthCredentials.class)))
                    .thenReturn(Mono.just(new TonProofVerifier.VerifiedTonProof(WALLET_B, "new", 1L)));
            when(userIdentityRepository.switchWallet("user-1", WALLET_B)).thenReturn(Mono.empty());
            when(userIdentityRepository.findById("user-1"))
                    .thenReturn(Mono.just(tma), Mono.just(linkedUser(WALLET_B)));

            StepVerifier.create(service.switchWallet(INIT_DATA, null, WALLET_B, NEW_PROOF, null))
                    .assertNext(user -> assertThat(user.walletAddress()).isEqualTo(WALLET_B))
                    .verifyComplete();

            verify(tonProofVerifier).verify(any(AuthCredentials.class));
            verify(userIdentityRepository).switchWallet("user-1", WALLET_B);
        }

        @Test
        @DisplayName("no linked wallet → 400 and no write")
        void noWalletLinkedDoesNotWrite() {
            UnifiedUser noWallet = new UnifiedUser(
                    "user-1", AuthType.TELEGRAM, "Alice", 42L, null, null);
            when(authenticationService.authenticate(any(AuthCredentials.class))).thenReturn(Mono.just(noWallet));
            when(userIdentityRepository.findByTelegramId(42L)).thenReturn(Mono.just("user-1"));
            when(userIdentityRepository.findById("user-1")).thenReturn(Mono.just(noWallet));

            StepVerifier.create(service.switchWallet(INIT_DATA, null, WALLET_B, NEW_PROOF, null))
                    .expectErrorSatisfies(ex -> {
                        assertThat(ex).isInstanceOf(IllegalArgumentException.class);
                        assertThat(ex.getMessage()).contains("No wallet linked");
                    })
                    .verify();

            verify(userIdentityRepository, never()).switchWallet(anyString(), anyString());
        }

        @Test
        @DisplayName("web switch forwards identity on previous and new proofs")
        void webSwitchForwardsIdentityOnBothProofs() {
            UnifiedUser both = linkedUser(WALLET_A);
            when(sessionTokenService.validateAndRefresh(SESSION)).thenReturn(Mono.just("user-1"));
            when(userIdentityRepository.findById("user-1"))
                    .thenReturn(Mono.just(both), Mono.just(linkedUser(WALLET_B)));
            when(tonProofVerifier.verify(any(AuthCredentials.class)))
                    .thenReturn(Mono.just(new TonProofVerifier.VerifiedTonProof(WALLET_A, "prev", 1L)))
                    .thenReturn(Mono.just(new TonProofVerifier.VerifiedTonProof(WALLET_B, "new", 1L)));
            when(userIdentityRepository.switchWallet("user-1", WALLET_B)).thenReturn(Mono.empty());

            StepVerifier.create(service.switchWallet(
                            null, SESSION, WALLET_B, NEW_PROOF, PREV_PROOF,
                            "new-pk", "new-si", "prev-pk", "prev-si"))
                    .assertNext(user -> assertThat(user.walletAddress()).isEqualTo(WALLET_B))
                    .verifyComplete();

            ArgumentCaptor<AuthCredentials> captor = ArgumentCaptor.forClass(AuthCredentials.class);
            verify(tonProofVerifier, times(2)).verify(captor.capture());
            assertThat(captor.getAllValues().get(0).walletPublicKey()).isEqualTo("prev-pk");
            assertThat(captor.getAllValues().get(0).walletStateInit()).isEqualTo("prev-si");
            assertThat(captor.getAllValues().get(1).walletPublicKey()).isEqualTo("new-pk");
            assertThat(captor.getAllValues().get(1).walletStateInit()).isEqualTo("new-si");
        }

        private void stubTelegramWebUser() {
            UnifiedUser both = linkedUser(WALLET_A);
            when(sessionTokenService.validateAndRefresh(SESSION)).thenReturn(Mono.just("user-1"));
            when(userIdentityRepository.findById("user-1")).thenReturn(Mono.just(both));
        }
    }

    private static UnifiedUser linkedUser(String wallet) {
        return new UnifiedUser("user-1", AuthType.TELEGRAM, "Alice", 42L, wallet, null);
    }

    private static void assertBodyCode(ResponseEntity<Map<String, Object>> resp, String expectedCode) {
        assertThat(resp.getBody()).isNotNull();
        assertThat(resp.getBody().get("code")).isEqualTo(expectedCode);
        assertThat(resp.getBody().get("message")).isNotNull();
    }
}
