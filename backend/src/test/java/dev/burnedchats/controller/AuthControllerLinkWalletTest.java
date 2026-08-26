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
import org.junit.jupiter.api.Nested;
import org.mockito.ArgumentCaptor;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@DisplayName("AuthController linkWallet")
class AuthControllerLinkWalletTest {

    private static final String INIT_DATA = "init-data";
    private static final String WALLET_ADDRESS = "EQBo3W19O92qLjdoYbERATFtQUh1Qp_NZJ6JU_lXyLnGUJT_";
    private static final String WALLET_PROOF = "{\"proof\":{}}";

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
    @DisplayName("invalid ton_proof returns 401 with JSON code")
    void proofRejectedReturns401WithCode() {
        when(authAccountLinkService.linkWallet(anyString(), anyString(), anyString(), any(), any()))
                .thenReturn(Mono.error(new WalletProofException(
                        WalletProofException.Reason.SIGNATURE_INVALID,
                        "signature mismatch",
                        null)));

        StepVerifier.create(controller.linkWallet(new AuthController.LinkWalletRequest(
                        INIT_DATA, WALLET_ADDRESS, WALLET_PROOF, null, null)))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
                    assertBodyCode(resp, "SIGNATURE_INVALID");
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("wallet already linked returns 409 with CONFLICT code")
    void conflictReturns409WithCode() {
        when(authAccountLinkService.linkWallet(anyString(), anyString(), anyString(), any(), any()))
                .thenReturn(Mono.error(new IllegalStateException("Wallet already linked to another account")));

        StepVerifier.create(controller.linkWallet(new AuthController.LinkWalletRequest(
                        INIT_DATA, WALLET_ADDRESS, WALLET_PROOF, null, null)))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
                    assertBodyCode(resp, "CONFLICT");
                    assertThat(resp.getBody()).containsEntry(
                            "message", "Wallet already linked to another account");
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("unexpected internal error returns 500 with INTERNAL code")
    void internalErrorReturns500WithCode() {
        when(authAccountLinkService.linkWallet(anyString(), anyString(), anyString(), any(), any()))
                .thenReturn(Mono.error(new RuntimeException("redis down")));

        StepVerifier.create(controller.linkWallet(new AuthController.LinkWalletRequest(
                        INIT_DATA, WALLET_ADDRESS, WALLET_PROOF, null, null)))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
                    assertBodyCode(resp, "INTERNAL");
                    assertThat(resp.getBody()).containsEntry("message", "Wallet link failed");
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("linkTelegramChallenge uses t.me/{bot}/app?startapp=")
    void telegramLinkUsesAppPath() {
        TelegramProperties props = new TelegramProperties();
        props.getBot().setUsername("BurnedChatsBot");
        AuthAccountLinkService link = mock(AuthAccountLinkService.class);
        when(link.createTelegramLinkChallenge("sess")).thenReturn(Mono.just("challenge-1"));
        AuthController deepLinkController = new AuthController(
                mock(TonProofVerifier.class),
                mock(AuthenticationService.class),
                mock(SessionTokenService.class),
                link,
                mock(TelegramAuthService.class),
                props);

        StepVerifier.create(deepLinkController.linkTelegramChallenge(
                        new AuthController.SessionTokenOnlyRequest("sess")))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
                    assertThat(resp.getBody()).isNotNull();
                    assertThat(resp.getBody().get("telegramLink"))
                            .isEqualTo("https://t.me/BurnedChatsBot/app?startapp=lt_challenge-1");
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("successful link returns 200 linked accounts payload")
    void happyPathReturns200() {
        UnifiedUser user = new UnifiedUser(
                "user-1",
                AuthType.TELEGRAM,
                "Alice",
                42L,
                "0:abc",
                null);
        when(authAccountLinkService.linkWallet(anyString(), anyString(), anyString(), any(), any()))
                .thenReturn(Mono.just(user));

        StepVerifier.create(controller.linkWallet(new AuthController.LinkWalletRequest(
                        INIT_DATA, WALLET_ADDRESS, WALLET_PROOF, null, null)))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
                    assertThat(resp.getBody()).containsEntry("ok", Boolean.TRUE);
                    assertThat(resp.getBody()).containsEntry("walletLinked", Boolean.TRUE);
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("identity pair is forwarded to the link service")
    void identityPairForwardedToService() {
        UnifiedUser user = new UnifiedUser(
                "user-1", AuthType.TELEGRAM, "Alice", 42L, "0:abc", null);
        when(authAccountLinkService.linkWallet(
                        eq(INIT_DATA), eq(WALLET_ADDRESS), eq(WALLET_PROOF), eq("pk-hex"), eq("state-init")))
                .thenReturn(Mono.just(user));

        StepVerifier.create(controller.linkWallet(new AuthController.LinkWalletRequest(
                        INIT_DATA, WALLET_ADDRESS, WALLET_PROOF, "pk-hex", "state-init")))
                .assertNext(resp -> assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK))
                .verifyComplete();

        verify(authAccountLinkService).linkWallet(
                INIT_DATA, WALLET_ADDRESS, WALLET_PROOF, "pk-hex", "state-init");
    }

    @Test
    @DisplayName("incomplete identity pair returns 400 INVALID_REQUEST without linking")
    void incompleteIdentityPairReturns400() {
        when(authAccountLinkService.linkWallet(anyString(), anyString(), anyString(), any(), any()))
                .thenReturn(Mono.error(new WalletProofException(
                        WalletProofException.Reason.INVALID_REQUEST,
                        "walletPublicKey and walletStateInit must be provided together",
                        null)));

        StepVerifier.create(controller.linkWallet(new AuthController.LinkWalletRequest(
                        INIT_DATA, WALLET_ADDRESS, WALLET_PROOF, "pk-only", null)))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertBodyCode(resp, "INVALID_REQUEST");
                })
                .verifyComplete();
    }

    @Nested
    @DisplayName("AuthAccountLinkService link identity")
    class ServiceIdentity {
        private AuthenticationService authenticationService;
        private TonProofVerifier tonProofVerifier;
        private UserIdentityRepository userIdentityRepository;
        private AuthAccountLinkService service;

        @BeforeEach
        void setUpService() {
            authenticationService = mock(AuthenticationService.class);
            tonProofVerifier = mock(TonProofVerifier.class);
            userIdentityRepository = mock(UserIdentityRepository.class);
            service = new AuthAccountLinkService(
                    authenticationService,
                    tonProofVerifier,
                    mock(SessionTokenService.class),
                    userIdentityRepository,
                    mock(WalletTelegramLinkChallengeStore.class));
        }

        @Test
        @DisplayName("full identity pair is passed to TonProofVerifier (no TonCenter path)")
        void identityPairPassedToVerifier() {
            UnifiedUser tg = new UnifiedUser(
                    "user-1", AuthType.TELEGRAM, "Alice", 42L, null, null);
            when(authenticationService.authenticate(any(AuthCredentials.class))).thenReturn(Mono.just(tg));
            when(tonProofVerifier.verify(any(AuthCredentials.class)))
                    .thenReturn(Mono.just(new TonProofVerifier.VerifiedTonProof("0:abc", "nonce", 1L)));
            when(userIdentityRepository.linkWallet("user-1", "0:abc")).thenReturn(Mono.empty());
            when(userIdentityRepository.findById("user-1"))
                    .thenReturn(Mono.just(new UnifiedUser(
                            "user-1", AuthType.TELEGRAM, "Alice", 42L, "0:abc", null)));

            StepVerifier.create(service.linkWallet(
                            INIT_DATA, WALLET_ADDRESS, WALLET_PROOF, "pk-hex", "state-init"))
                    .assertNext(user -> assertThat(user.walletAddress()).isEqualTo("0:abc"))
                    .verifyComplete();

            ArgumentCaptor<AuthCredentials> captor = ArgumentCaptor.forClass(AuthCredentials.class);
            verify(tonProofVerifier).verify(captor.capture());
            assertThat(captor.getValue().walletPublicKey()).isEqualTo("pk-hex");
            assertThat(captor.getValue().walletStateInit()).isEqualTo("state-init");
        }

        @Test
        @DisplayName("no identity keeps RPC-fallback credentials")
        void missingIdentityUsesTwoArgCredentials() {
            UnifiedUser tg = new UnifiedUser(
                    "user-1", AuthType.TELEGRAM, "Alice", 42L, null, null);
            when(authenticationService.authenticate(any(AuthCredentials.class))).thenReturn(Mono.just(tg));
            when(tonProofVerifier.verify(any(AuthCredentials.class)))
                    .thenReturn(Mono.error(new WalletProofException(
                            WalletProofException.Reason.PUBLIC_KEY_UNAVAILABLE,
                            "Unable to resolve wallet public key from TON API",
                            null)));

            StepVerifier.create(service.linkWallet(INIT_DATA, WALLET_ADDRESS, WALLET_PROOF))
                    .expectErrorSatisfies(ex -> {
                        assertThat(ex).isInstanceOf(WalletProofException.class);
                        assertThat(((WalletProofException) ex).getReason())
                                .isEqualTo(WalletProofException.Reason.PUBLIC_KEY_UNAVAILABLE);
                    })
                    .verify();

            ArgumentCaptor<AuthCredentials> captor = ArgumentCaptor.forClass(AuthCredentials.class);
            verify(tonProofVerifier).verify(captor.capture());
            assertThat(captor.getValue().walletPublicKey()).isNull();
            assertThat(captor.getValue().walletStateInit()).isNull();
            verify(userIdentityRepository, never()).linkWallet(anyString(), anyString());
        }

        @Test
        @DisplayName("incomplete pair is INVALID_REQUEST and does not verify")
        void incompletePairDoesNotVerify() {
            StepVerifier.create(service.linkWallet(
                            INIT_DATA, WALLET_ADDRESS, WALLET_PROOF, "pk-only", null))
                    .expectErrorSatisfies(ex -> {
                        assertThat(ex).isInstanceOf(WalletProofException.class);
                        assertThat(((WalletProofException) ex).getReason())
                                .isEqualTo(WalletProofException.Reason.INVALID_REQUEST);
                    })
                    .verify();

            verify(tonProofVerifier, never()).verify(any());
        }
    }

    private static void assertBodyCode(ResponseEntity<Map<String, Object>> resp, String expectedCode) {
        assertThat(resp.getBody()).isNotNull();
        assertThat(resp.getBody().get("code")).isEqualTo(expectedCode);
        assertThat(resp.getBody().get("message")).isNotNull();
    }
}
