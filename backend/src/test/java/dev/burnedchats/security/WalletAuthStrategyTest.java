package dev.burnedchats.security;

import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.exception.WalletProofException;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.ton.TonProofVerifier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@DisplayName("WalletAuthStrategy")
class WalletAuthStrategyTest {

    private static final String RAW_ADDR = "0:" + "cc".repeat(32);

    @Mock
    private TonProofVerifier tonProofVerifier;

    @Mock
    private UserIdentityRepository userIdentityRepository;

    private WalletAuthStrategy strategy;

    @BeforeEach
    void setUp() {
        strategy = new WalletAuthStrategy(tonProofVerifier, userIdentityRepository);
    }

    @Test
    @DisplayName("passes WalletProofException through without wrapping")
    void passesWalletProofExceptionThrough() {
        WalletProofException ex = new WalletProofException(
                WalletProofException.Reason.DOMAIN_MISMATCH, "domain mismatch", null);
        AuthCredentials creds = AuthCredentials.wallet("{}", "0:" + "aa".repeat(32));

        when(tonProofVerifier.verify(creds)).thenReturn(Mono.error(ex));

        StepVerifier.create(strategy.authenticate(creds))
                .expectErrorSatisfies(err -> {
                    assertThat(err).isInstanceOf(WalletProofException.class);
                    assertThat(((WalletProofException) err).getReason())
                            .isEqualTo(WalletProofException.Reason.DOMAIN_MISMATCH);
                })
                .verify();
    }

    @Test
    @DisplayName("wraps generic runtime failures in Reason.INTERNAL")
    void wrapsGenericRuntimeInInternal() {
        AuthCredentials creds = AuthCredentials.wallet("{}", "0:" + "bb".repeat(32));
        when(tonProofVerifier.verify(creds)).thenReturn(Mono.error(new RuntimeException("boom")));

        StepVerifier.create(strategy.authenticate(creds))
                .expectErrorSatisfies(err -> {
                    assertThat(err).isInstanceOf(WalletProofException.class);
                    WalletProofException wpe = (WalletProofException) err;
                    assertThat(wpe.getReason()).isEqualTo(WalletProofException.Reason.INTERNAL);
                    assertThat(wpe.getCause()).isInstanceOf(RuntimeException.class);
                })
                .verify();
    }

    @Test
    @DisplayName("keeps AuthenticationException for unsupported credentials type")
    void keepsAuthenticationExceptionForUnsupported() {
        AuthCredentials creds = AuthCredentials.telegram("init");

        StepVerifier.create(strategy.authenticate(creds))
                .expectError(AuthenticationException.class)
                .verify();
    }

    @Test
    @DisplayName("authenticates when proof verification succeeds")
    void authenticatesOnSuccess() {
        AuthCredentials creds = AuthCredentials.wallet("{}", RAW_ADDR);
        UnifiedUser user = new UnifiedUser("id-1", AuthType.WALLET, "w", null, RAW_ADDR, null);
        TonProofVerifier.VerifiedTonProof verified =
                new TonProofVerifier.VerifiedTonProof(RAW_ADDR, "nonce", 1L);

        when(tonProofVerifier.verify(creds)).thenReturn(Mono.just(verified));
        when(userIdentityRepository.findOrCreateByWallet(any())).thenReturn(Mono.just(user));

        StepVerifier.create(strategy.authenticate(creds))
                .expectNext(user)
                .verifyComplete();
    }
}
