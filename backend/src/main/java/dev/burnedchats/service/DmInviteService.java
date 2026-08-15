package dev.burnedchats.service;

import dev.burnedchats.config.PowProperties;
import dev.burnedchats.config.TelegramProperties;
import dev.burnedchats.dto.event.DmInviteMintedEvent;
import dev.burnedchats.dto.request.CreateSessionRequest;
import dev.burnedchats.dto.request.PowSolution;
import dev.burnedchats.exception.PowInvalidException;
import dev.burnedchats.exception.PowRequiredException;
import dev.burnedchats.model.DmInviteToken;
import dev.burnedchats.repository.DmInviteTokenRepository;
import dev.burnedchats.security.pow.AdaptiveDifficultyService;
import dev.burnedchats.security.pow.PowAction;
import dev.burnedchats.security.pow.PowVerificationService;
import dev.burnedchats.service.RateLimitService.RateLimitType;
import dev.burnedchats.service.SessionLifecycleService.CreateSessionResult;
import dev.burnedchats.util.ParticipantContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;

/**
 * Personal DM invite mint / redeem (IMP-DMINVITE-01).
 *
 * <p>Mint is gated by PoW {@link PowAction#DM_INVITE} then {@link RateLimitType#DM_INVITE_MINT}.
 * Redeem consumes the opaque token and creates a normal {@code ChatRequest} via
 * {@link SessionLifecycleService#createSession} without bypassing {@code session.create} PoW.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DmInviteService {

    public static final String STARTAPP_PREFIX = "dm_invite_";

    private static final int TOKEN_BYTES = 32;
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final DmInviteTokenRepository dmInviteTokenRepository;
    private final PowVerificationService powVerificationService;
    private final AdaptiveDifficultyService adaptiveDifficultyService;
    private final PowProperties powProperties;
    private final RateLimitService rateLimitService;
    private final SessionLifecycleService sessionLifecycleService;
    private final TelegramProperties telegramProperties;

    /**
     * Mint a single-use personal DM invite for the authenticated owner.
     */
    public Mono<DmInviteMintedEvent> mint(ParticipantContext owner, PowSolution pow) {
        return enforceMintGate(owner, pow)
                .then(Mono.defer(() -> persistNewToken(owner)))
                .doOnSuccess(e -> LOG.info("DM invite minted by owner={}", owner.internalId()))
                .doOnError(e -> LOG.warn("DM invite mint failed for owner={}: {}",
                        owner.internalId(), e.getMessage()));
    }

    /**
     * Redeem a DM invite: scanner becomes ChatRequest initiator; owner is recipient.
     *
     * @return same {@link CreateSessionResult} as {@code session.create} business path
     */
    public Mono<CreateSessionResult> redeem(ParticipantContext redeemer, String tokenValue) {
        return rateLimitService.enforceRateLimit(redeemer.internalId(), RateLimitType.DM_INVITE_REDEEM)
                .then(Mono.defer(() -> consumeAndCreate(redeemer, tokenValue)))
                .doOnError(e -> LOG.warn("DM invite redeem failed for redeemer={}: {}",
                        redeemer.internalId(), e.getMessage()));
    }

    /**
     * Canonical deep-link URL for a minted token.
     *
     * <p>Primary (when {@code telegram.mini-app.url} is configured):
     * {@code {mini-app.url}/join#dm_invite_{token}} — token in the URL fragment so it
     * is not sent to the server or logged in access logs. Mirrors room
     * {@code InviteTokenService.buildInviteUrl} ({@code /join#invite_}).
     *
     * <p>Fallback (mini-app URL not configured):
     * {@code https://t.me/{bot}/app?startapp=dm_invite_{token}}.
     */
    public String buildInviteUrl(String tokenValue) {
        String miniAppUrl = telegramProperties.getMiniApp().getUrl();
        if (miniAppUrl != null && !miniAppUrl.isBlank()) {
            String base = miniAppUrl.endsWith("/")
                    ? miniAppUrl.substring(0, miniAppUrl.length() - 1)
                    : miniAppUrl;
            return base + "/join#" + STARTAPP_PREFIX + tokenValue;
        }
        String botUsername = telegramProperties.getBot().getUsername();
        return "https://t.me/" + botUsername + "/app?startapp=" + STARTAPP_PREFIX + tokenValue;
    }

    private Mono<Void> enforceMintGate(ParticipantContext owner, PowSolution pow) {
        Mono<Void> powGate = Mono.empty();
        if (powProperties.isEnabled()) {
            powGate = adaptiveDifficultyService.recordGatedAttempt()
                    .then(powVerificationService.verify(PowAction.DM_INVITE, pow))
                    .onErrorResume(PowRequiredException.class, e ->
                            adaptiveDifficultyService.recordRejected().then(Mono.error(e)))
                    .onErrorResume(PowInvalidException.class, e ->
                            adaptiveDifficultyService.recordRejected().then(Mono.error(e)));
        }
        return powGate.then(Mono.defer(() -> rateLimitService.enforceRateLimit(
                owner.internalId(), RateLimitType.DM_INVITE_MINT)));
    }

    private Mono<DmInviteMintedEvent> persistNewToken(ParticipantContext owner) {
        String tokenValue = generateSecureToken();
        long expiresAt = Instant.now()
                .plus(DmInviteToken.DEFAULT_TTL_MINUTES, ChronoUnit.MINUTES)
                .toEpochMilli();

        DmInviteToken token = DmInviteToken.builder()
                .token(tokenValue)
                .ownerInternalId(owner.internalId())
                .expiresAt(expiresAt)
                .maxUses(DmInviteToken.DEFAULT_MAX_USES)
                .usedCount(0)
                .build();

        return dmInviteTokenRepository.save(token)
                .thenReturn(DmInviteMintedEvent.success(
                        tokenValue,
                        buildInviteUrl(tokenValue),
                        expiresAt,
                        DmInviteToken.DEFAULT_MAX_USES));
    }

    private Mono<CreateSessionResult> consumeAndCreate(ParticipantContext redeemer, String tokenValue) {
        if (tokenValue == null || tokenValue.isBlank()) {
            return Mono.error(new IllegalArgumentException("DM_INVITE_NOT_FOUND"));
        }

        return dmInviteTokenRepository.findByToken(tokenValue.trim())
                .switchIfEmpty(Mono.error(new IllegalArgumentException("DM_INVITE_NOT_FOUND")))
                .flatMap(token -> validateForRedeem(redeemer, token)
                        .then(Mono.defer(() -> consumeUse(token)))
                        .then(Mono.defer(() -> {
                            CreateSessionRequest request = CreateSessionRequest.builder()
                                    .recipientInternalId(token.getOwnerInternalId())
                                    .build();
                            return sessionLifecycleService.createSession(redeemer, request);
                        })));
    }

    private Mono<Void> validateForRedeem(ParticipantContext redeemer, DmInviteToken token) {
        if (token.getExpiresAt() != null && token.getExpiresAt() < Instant.now().toEpochMilli()) {
            return Mono.defer(() -> dmInviteTokenRepository.deleteTokenAndIndex(
                            token.getToken(), token.getOwnerInternalId()))
                    .then(Mono.error(new IllegalArgumentException("DM_INVITE_EXPIRED")));
        }
        if (isExhausted(token)) {
            return Mono.defer(() -> dmInviteTokenRepository.deleteTokenAndIndex(
                            token.getToken(), token.getOwnerInternalId()))
                    .then(Mono.error(new IllegalArgumentException("DM_INVITE_EXHAUSTED")));
        }
        if (redeemer.internalId().equals(token.getOwnerInternalId())) {
            return Mono.error(new IllegalArgumentException("SELF_REDEEM"));
        }
        return Mono.empty();
    }

    private Mono<Void> consumeUse(DmInviteToken token) {
        return dmInviteTokenRepository.incrementUseCount(token.getToken())
                .flatMap(newCount -> {
                    if (newCount < 0) {
                        return Mono.error(new IllegalStateException("INTERNAL_ERROR"));
                    }
                    if (newCount > token.getMaxUses()) {
                        return Mono.error(new IllegalArgumentException("DM_INVITE_EXHAUSTED"));
                    }
                    if (newCount >= token.getMaxUses()) {
                        return dmInviteTokenRepository.deleteTokenAndIndex(
                                token.getToken(), token.getOwnerInternalId());
                    }
                    return Mono.empty();
                });
    }

    private static boolean isExhausted(DmInviteToken token) {
        return token.getMaxUses() != null
                && token.getUsedCount() != null
                && token.getUsedCount() >= token.getMaxUses();
    }

    private String generateSecureToken() {
        byte[] bytes = new byte[TOKEN_BYTES];
        SECURE_RANDOM.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }
}
