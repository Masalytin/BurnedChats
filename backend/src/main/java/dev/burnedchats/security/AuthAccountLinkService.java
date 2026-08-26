package dev.burnedchats.security;

import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.exception.WalletProofException;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.repository.WalletTelegramLinkChallengeStore;
import dev.burnedchats.ton.TonProofVerifier;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

/**
 * Account linking flows: Telegram user binds a wallet; wallet user binds Telegram via challenge + Mini App.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AuthAccountLinkService {

    private final AuthenticationService authenticationService;
    private final TonProofVerifier tonProofVerifier;
    private final SessionTokenService sessionTokenService;
    private final UserIdentityRepository userIdentityRepository;
    private final WalletTelegramLinkChallengeStore challengeStore;

    /**
     * Telegram Mini App session links a verified TON wallet address to the same internal id.
     */
    public Mono<UnifiedUser> linkWallet(String initData, String walletAddress, String walletProof) {
        return linkWallet(initData, walletAddress, walletProof, null, null);
    }

    public Mono<UnifiedUser> linkWallet(
            String initData,
            String walletAddress,
            String walletProof,
            String walletPublicKey,
            String walletStateInit) {
        if (incompleteIdentityPair(walletPublicKey, walletStateInit)) {
            return Mono.error(new WalletProofException(
                    WalletProofException.Reason.INVALID_REQUEST,
                    "walletPublicKey and walletStateInit must be provided together",
                    null));
        }
        String maskedAddress = maskWalletAddress(walletAddress);
        AuthCredentials walletCreds = walletProofCredentials(
                walletProof, walletAddress, walletPublicKey, walletStateInit);
        return authenticationService.authenticate(AuthCredentials.telegram(initData))
                .flatMap(tgUser -> tonProofVerifier.verify(walletCreds)
                        .flatMap(verified -> userIdentityRepository
                                .linkWallet(tgUser.internalId(), verified.walletAddress())
                                .then(userIdentityRepository.findById(tgUser.internalId()))
                                .switchIfEmpty(Mono.error(new IllegalStateException("User not found after link")))))
                .doOnError(ex -> {
                    if (ex instanceof WalletProofException) {
                        return;
                    }
                    LOG.warn(
                            "link-wallet failed: reason={} address={}",
                            linkFailureReason(ex),
                            maskedAddress);
                });
    }

    private static String linkFailureReason(Throwable ex) {
        if (ex instanceof IllegalStateException) {
            return "CONFLICT";
        }
        if (ex instanceof AuthenticationException) {
            return "UNAUTHORIZED";
        }
        if (ex instanceof IllegalArgumentException) {
            return "BAD_REQUEST";
        }
        return "INTERNAL";
    }

    static AuthCredentials walletProofCredentials(
            String walletProof,
            String walletAddress,
            String walletPublicKey,
            String walletStateInit) {
        if (hasIdentityPair(walletPublicKey, walletStateInit)) {
            return AuthCredentials.wallet(walletProof, walletAddress, walletPublicKey, walletStateInit);
        }
        return AuthCredentials.wallet(walletProof, walletAddress);
    }

    static boolean hasIdentityPair(String publicKey, String stateInit) {
        return !blank(publicKey) && !blank(stateInit);
    }

    static boolean incompleteIdentityPair(String publicKey, String stateInit) {
        return blank(publicKey) != blank(stateInit);
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private static String maskWalletAddress(String address) {
        if (address == null || address.isBlank()) {
            return "";
        }
        String trimmed = address.trim();
        if (trimmed.length() <= 10) {
            return trimmed;
        }
        return trimmed.substring(0, 6) + "..." + trimmed.substring(trimmed.length() - 4);
    }

    /**
     * Produce a challenge id stored in Redis; Mini App completes with {@link #completeTelegramLink}.
     */
    public Mono<String> createTelegramLinkChallenge(String sessionToken) {
        if (sessionToken == null || sessionToken.isBlank()) {
            return Mono.error(new AuthenticationException("Session token is required"));
        }
        return sessionTokenService.validateAndRefresh(sessionToken.trim())
                .switchIfEmpty(Mono.error(new AuthenticationException("Invalid or expired wallet session")))
                .flatMap(internalId -> userIdentityRepository.findById(internalId)
                        .switchIfEmpty(Mono.error(new AuthenticationException("Wallet session user not found")))
                        .flatMap(user -> {
                            if (user.authType() != AuthType.WALLET) {
                                return Mono.error(new IllegalArgumentException(
                                        "Telegram link challenge is only for wallet accounts"));
                            }
                            return challengeStore.createChallengeForInternalId(internalId);
                        }));
    }

    /**
     * Mini App submits initData to bind Telegram to the wallet user referenced by challengeId.
     */
    public Mono<UnifiedUser> completeTelegramLink(String challengeId, String initData) {
        return challengeStore.takeInternalId(challengeId)
                .switchIfEmpty(Mono.error(new AuthenticationException("Invalid or expired link challenge")))
                .flatMap(internalId -> authenticationService.authenticate(AuthCredentials.telegram(initData))
                        .flatMap(verifiedIdentity -> userIdentityRepository.findById(internalId)
                                .switchIfEmpty(Mono.error(new AuthenticationException("User not found")))
                                .flatMap(walletUser -> {
                                    if (walletUser.authType() != AuthType.WALLET) {
                                        return Mono.error(new IllegalArgumentException(
                                                "Invalid account state for telegram link"));
                                    }
                                    Long tgId = verifiedIdentity.telegramId();
                                    if (tgId == null) {
                                        return Mono.error(new AuthenticationException("Telegram user missing"));
                                    }
                                    return userIdentityRepository
                                            .linkTelegram(internalId, tgId)
                                            .then(userIdentityRepository.findById(internalId))
                                            .switchIfEmpty(Mono.error(new IllegalStateException(
                                                    "User not found after telegram link")));
                                })));
    }

    /**
     * Rotate the linked TON wallet on the same {@code internalId}. Telegram must stay linked.
     * Web viewers must prove the currently linked address; TMA may omit the previous proof (lost seed).
     */
    public Mono<UnifiedUser> switchWallet(
            String initData,
            String sessionToken,
            String walletAddress,
            String walletProof,
            String previousWalletProof) {
        return switchWallet(
                initData, sessionToken, walletAddress, walletProof, previousWalletProof,
                null, null, null, null);
    }

    public Mono<UnifiedUser> switchWallet(
            String initData,
            String sessionToken,
            String walletAddress,
            String walletProof,
            String previousWalletProof,
            String walletPublicKey,
            String walletStateInit,
            String previousWalletPublicKey,
            String previousWalletStateInit) {
        if (incompleteIdentityPair(walletPublicKey, walletStateInit)
                || incompleteIdentityPair(previousWalletPublicKey, previousWalletStateInit)) {
            return Mono.error(new WalletProofException(
                    WalletProofException.Reason.INVALID_REQUEST,
                    "walletPublicKey and walletStateInit must be provided together",
                    null));
        }
        boolean webViewer = sessionToken != null && !sessionToken.isBlank();
        String maskedAddress = maskWalletAddress(walletAddress);
        return loadLinkedIdentity(initData, sessionToken)
                .flatMap(user -> {
                    if (user.telegramId() == null) {
                        return Mono.error(new IllegalArgumentException(
                                "Telegram is required to switch wallet"));
                    }
                    String currentWallet = user.walletAddress();
                    if (currentWallet == null || currentWallet.isBlank()) {
                        return Mono.error(new IllegalArgumentException("No wallet linked"));
                    }
                    Mono<Void> previousGate = Mono.empty();
                    if (webViewer) {
                        if (previousWalletProof == null || previousWalletProof.isBlank()) {
                            return Mono.error(new IllegalArgumentException(
                                    "previousWalletProof is required"));
                        }
                        previousGate = tonProofVerifier
                                .verify(walletProofCredentials(
                                        previousWalletProof,
                                        currentWallet,
                                        previousWalletPublicKey,
                                        previousWalletStateInit))
                                .flatMap(verifiedPrev -> {
                                    if (!userIdentityRepository.walletsEqual(
                                            verifiedPrev.walletAddress(), currentWallet)) {
                                        return Mono.error(new IllegalArgumentException(
                                                "previousWalletProof does not match the linked wallet"));
                                    }
                                    return Mono.empty();
                                });
                    }
                    return previousGate
                            .then(tonProofVerifier.verify(walletProofCredentials(
                                    walletProof, walletAddress, walletPublicKey, walletStateInit)))
                            .flatMap(verifiedNew -> {
                                if (!userIdentityRepository.walletsEqual(
                                        verifiedNew.walletAddress(), walletAddress)) {
                                    return Mono.error(new IllegalArgumentException(
                                            "walletProof does not match walletAddress"));
                                }
                                return userIdentityRepository
                                        .switchWallet(user.internalId(), verifiedNew.walletAddress())
                                        .then(userIdentityRepository.findById(user.internalId()))
                                        .switchIfEmpty(Mono.error(new IllegalStateException(
                                                "User not found after switch")));
                            });
                })
                .doOnError(ex -> {
                    if (ex instanceof WalletProofException) {
                        return;
                    }
                    LOG.warn(
                            "switch-wallet failed: reason={} address={}",
                            linkFailureReason(ex),
                            maskedAddress);
                });
    }

    /** Resolve Telegram or wallet-authenticated viewer and load merged identity including cross-links. */
    public Mono<UnifiedUser> loadLinkedIdentity(String initData, String sessionToken) {
        boolean hasInit = initData != null && !initData.isBlank();
        boolean hasSession = sessionToken != null && !sessionToken.isBlank();
        if (hasInit == hasSession) {
            return Mono.error(new IllegalArgumentException("Provide exactly one of initData or sessionToken"));
        }
        if (hasInit) {
            return resolveTelegramViewer(initData);
        }
        return resolveWalletViewer(sessionToken.trim());
    }

    public Mono<UnifiedUser> unlinkWallet(String initData) {
        return resolveTelegramViewer(initData)
                .flatMap(u -> userIdentityRepository.unlinkWallet(u.internalId())
                        .then(userIdentityRepository.findById(u.internalId()))
                        .switchIfEmpty(Mono.error(new IllegalStateException("Failed to reload user after unlink"))));
    }

    public Mono<UnifiedUser> unlinkTelegram(String sessionToken) {
        return resolveWalletViewer(sessionToken.trim())
                .flatMap(u -> userIdentityRepository.unlinkTelegram(u.internalId())
                        .then(userIdentityRepository.findById(u.internalId()))
                        .switchIfEmpty(Mono.error(new IllegalStateException("Failed to reload user after unlink"))));
    }

    private Mono<UnifiedUser> resolveTelegramViewer(String initData) {
        return authenticationService.authenticate(AuthCredentials.telegram(initData))
                .flatMap(derived -> {
                    if (derived.telegramId() == null) {
                        return Mono.error(new AuthenticationException("Telegram user id missing"));
                    }
                    return userIdentityRepository.findByTelegramId(derived.telegramId())
                            .flatMap(mappedId -> userIdentityRepository.findById(mappedId))
                            .switchIfEmpty(userIdentityRepository.findById(derived.internalId()))
                            .switchIfEmpty(Mono.just(derived));
                });
    }

    private Mono<UnifiedUser> resolveWalletViewer(String sessionToken) {
        return sessionTokenService.validateAndRefresh(sessionToken)
                .switchIfEmpty(Mono.error(new AuthenticationException("Invalid or expired wallet session")))
                .flatMap(internalId -> userIdentityRepository.findById(internalId)
                        .switchIfEmpty(Mono.error(new AuthenticationException("Wallet session user not found"))));
    }
}
