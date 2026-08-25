package dev.burnedchats.service;

import dev.burnedchats.config.PowProperties;
import dev.burnedchats.config.TelegramProperties;
import dev.burnedchats.dto.event.SessionCreatedEvent;
import dev.burnedchats.dto.request.CreateSessionRequest;
import dev.burnedchats.dto.request.PowSolution;
import dev.burnedchats.exception.PowRequiredException;
import dev.burnedchats.model.DmInviteToken;
import dev.burnedchats.repository.DmInviteTokenRepository;
import dev.burnedchats.security.pow.AdaptiveDifficultyService;
import dev.burnedchats.security.pow.PowAction;
import dev.burnedchats.security.pow.PowVerificationService;
import dev.burnedchats.service.RateLimitService.RateLimitType;
import dev.burnedchats.service.SessionLifecycleService.CreateSessionResult;
import dev.burnedchats.util.ParticipantContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@DisplayName("DmInviteService")
class DmInviteServiceTest {

    private static final String OWNER_ID = "owner-internal-uuid-000000000001";
    private static final String REDEEMER_ID = "redeemer-internal-uuid-000000002";
    private static final String TOKEN = "a".repeat(64);

    @Mock
    private DmInviteTokenRepository dmInviteTokenRepository;
    @Mock
    private PowVerificationService powVerificationService;
    @Mock
    private AdaptiveDifficultyService adaptiveDifficultyService;
    @Mock
    private PowProperties powProperties;
    @Mock
    private RateLimitService rateLimitService;
    @Mock
    private SessionLifecycleService sessionLifecycleService;
    @Mock
    private TelegramProperties telegramProperties;
    @Mock
    private TelegramProperties.MiniApp miniApp;
    @Mock
    private TelegramProperties.Bot bot;

    @InjectMocks
    private DmInviteService dmInviteService;

    private final ParticipantContext owner = new ParticipantContext(OWNER_ID, 111L, "alice", "Alice");
    private final ParticipantContext redeemer = new ParticipantContext(REDEEMER_ID, 222L, "bob", "Bob");

    @Nested
    @DisplayName("mint")
    class Mint {

        @Test
        @DisplayName("rejects mint when PoW is missing")
        void rejectsMintWithoutPow() {
            when(powProperties.isEnabled()).thenReturn(true);
            when(adaptiveDifficultyService.recordGatedAttempt()).thenReturn(Mono.empty());
            when(powVerificationService.verify(eq(PowAction.DM_INVITE), eq(null)))
                    .thenReturn(Mono.error(new PowRequiredException()));
            when(adaptiveDifficultyService.recordRejected()).thenReturn(Mono.empty());

            StepVerifier.create(dmInviteService.mint(owner, null))
                    .expectError(PowRequiredException.class)
                    .verify();

            verify(dmInviteTokenRepository, never()).save(any());
            verify(rateLimitService, never()).enforceRateLimit(any(String.class), any());
        }

        @Test
        @DisplayName("mints token with maxUses=1 and default TTL after valid PoW")
        void mintsTokenAfterValidPow() {
            PowSolution pow = PowSolution.builder().challengeId("c1").nonce("1").build();
            when(powProperties.isEnabled()).thenReturn(true);
            when(adaptiveDifficultyService.recordGatedAttempt()).thenReturn(Mono.empty());
            when(powVerificationService.verify(eq(PowAction.DM_INVITE), eq(pow))).thenReturn(Mono.empty());
            when(rateLimitService.enforceRateLimit(OWNER_ID, RateLimitType.DM_INVITE_MINT))
                    .thenReturn(Mono.empty());
            when(dmInviteTokenRepository.save(any(DmInviteToken.class))).thenReturn(Mono.just(true));
            when(telegramProperties.getMiniApp()).thenReturn(miniApp);
            when(miniApp.getUrl()).thenReturn("https://burnedchats.net");

            long before = Instant.now().toEpochMilli();

            StepVerifier.create(dmInviteService.mint(owner, pow))
                    .assertNext(event -> {
                        assertThat(event.isSuccess()).isTrue();
                        assertThat(event.getToken()).hasSize(64);
                        assertThat(event.getMaxUses()).isEqualTo(1);
                        assertThat(event.getInviteUrl()).isEqualTo(
                                "https://burnedchats.net/join#dm_invite_" + event.getToken());
                        assertThat(event.getExpiresAt()).isGreaterThan(before);
                        long ttlMs = event.getExpiresAt() - before;
                        assertThat(ttlMs).isBetween(
                                (DmInviteToken.DEFAULT_TTL_MINUTES * 60_000L) - 5_000L,
                                (DmInviteToken.DEFAULT_TTL_MINUTES * 60_000L) + 5_000L);
                    })
                    .verifyComplete();

            ArgumentCaptor<DmInviteToken> captor = ArgumentCaptor.forClass(DmInviteToken.class);
            verify(dmInviteTokenRepository).save(captor.capture());
            DmInviteToken saved = captor.getValue();
            assertThat(saved.getOwnerInternalId()).isEqualTo(OWNER_ID);
            assertThat(saved.getMaxUses()).isEqualTo(1);
            assertThat(saved.getUsedCount()).isEqualTo(0);
            assertThat(saved.getToken()).hasSize(64);
        }
    }

    @Nested
    @DisplayName("redeem")
    class Redeem {

        @Test
        @DisplayName("creates ChatRequest pipeline Bob→Alice for valid token")
        void redeemCreatesSessionForOwner() {
            DmInviteToken token = activeToken(OWNER_ID);
            when(rateLimitService.enforceRateLimit(REDEEMER_ID, RateLimitType.DM_INVITE_REDEEM))
                    .thenReturn(Mono.empty());
            when(dmInviteTokenRepository.findByToken(TOKEN)).thenReturn(Mono.just(token));
            when(dmInviteTokenRepository.incrementUseCount(TOKEN)).thenReturn(Mono.just(1L));
            when(dmInviteTokenRepository.deleteTokenAndIndex(TOKEN, OWNER_ID)).thenReturn(Mono.empty());

            SessionCreatedEvent ok = SessionCreatedEvent.success(
                    "sess-1", null, false, Instant.now(), Instant.now().plusSeconds(300));
            CreateSessionResult.Created created = new CreateSessionResult.Created(
                    ok, OWNER_ID, null, true, 111L, null, null, "sess-1");
            when(sessionLifecycleService.createSession(eq(redeemer), any(CreateSessionRequest.class)))
                    .thenReturn(Mono.just(created));

            StepVerifier.create(dmInviteService.redeem(redeemer, TOKEN))
                    .assertNext(result -> {
                        assertThat(result).isInstanceOf(CreateSessionResult.Created.class);
                        CreateSessionResult.Created c = (CreateSessionResult.Created) result;
                        assertThat(c.recipientInternalId()).isEqualTo(OWNER_ID);
                        assertThat(c.sessionId()).isEqualTo("sess-1");
                    })
                    .verifyComplete();

            ArgumentCaptor<CreateSessionRequest> reqCaptor =
                    ArgumentCaptor.forClass(CreateSessionRequest.class);
            verify(sessionLifecycleService).createSession(eq(redeemer), reqCaptor.capture());
            assertThat(reqCaptor.getValue().getRecipientInternalId()).isEqualTo(OWNER_ID);
            assertThat(reqCaptor.getValue().getPow()).isNull();
            verify(dmInviteTokenRepository).incrementUseCount(TOKEN);
            verify(dmInviteTokenRepository).deleteTokenAndIndex(TOKEN, OWNER_ID);
        }

        @Test
        @DisplayName("rejects double redeem when token already exhausted")
        void rejectsDoubleRedeem() {
            DmInviteToken token = DmInviteToken.builder()
                    .token(TOKEN)
                    .ownerInternalId(OWNER_ID)
                    .expiresAt(Instant.now().plusSeconds(600).toEpochMilli())
                    .maxUses(1)
                    .usedCount(1)
                    .build();
            when(rateLimitService.enforceRateLimit(REDEEMER_ID, RateLimitType.DM_INVITE_REDEEM))
                    .thenReturn(Mono.empty());
            when(dmInviteTokenRepository.findByToken(TOKEN)).thenReturn(Mono.just(token));
            when(dmInviteTokenRepository.deleteTokenAndIndex(TOKEN, OWNER_ID)).thenReturn(Mono.empty());

            StepVerifier.create(dmInviteService.redeem(redeemer, TOKEN))
                    .expectErrorMatches(e -> e instanceof IllegalArgumentException
                            && "DM_INVITE_EXHAUSTED".equals(e.getMessage()))
                    .verify();

            verify(sessionLifecycleService, never()).createSession(any(), any());
            verify(dmInviteTokenRepository).deleteTokenAndIndex(TOKEN, OWNER_ID);
        }

        @Test
        @DisplayName("rejects redeem of expired token")
        void rejectsExpired() {
            DmInviteToken token = DmInviteToken.builder()
                    .token(TOKEN)
                    .ownerInternalId(OWNER_ID)
                    .expiresAt(Instant.now().minusSeconds(10).toEpochMilli())
                    .maxUses(1)
                    .usedCount(0)
                    .build();
            when(rateLimitService.enforceRateLimit(REDEEMER_ID, RateLimitType.DM_INVITE_REDEEM))
                    .thenReturn(Mono.empty());
            when(dmInviteTokenRepository.findByToken(TOKEN)).thenReturn(Mono.just(token));
            when(dmInviteTokenRepository.deleteTokenAndIndex(TOKEN, OWNER_ID)).thenReturn(Mono.empty());

            StepVerifier.create(dmInviteService.redeem(redeemer, TOKEN))
                    .expectErrorMatches(e -> e instanceof IllegalArgumentException
                            && "DM_INVITE_EXPIRED".equals(e.getMessage()))
                    .verify();

            verify(sessionLifecycleService, never()).createSession(any(), any());
        }

        @Test
        @DisplayName("rejects self-redeem by owner")
        void rejectsSelfRedeem() {
            DmInviteToken token = activeToken(OWNER_ID);
            when(rateLimitService.enforceRateLimit(OWNER_ID, RateLimitType.DM_INVITE_REDEEM))
                    .thenReturn(Mono.empty());
            when(dmInviteTokenRepository.findByToken(TOKEN)).thenReturn(Mono.just(token));

            StepVerifier.create(dmInviteService.redeem(owner, TOKEN))
                    .expectErrorMatches(e -> e instanceof IllegalArgumentException
                            && "SELF_REDEEM".equals(e.getMessage()))
                    .verify();

            verify(sessionLifecycleService, never()).createSession(any(), any());
            verify(dmInviteTokenRepository, never()).incrementUseCount(any());
        }

        @Test
        @DisplayName("rejects unknown token")
        void rejectsNotFound() {
            when(rateLimitService.enforceRateLimit(REDEEMER_ID, RateLimitType.DM_INVITE_REDEEM))
                    .thenReturn(Mono.empty());
            when(dmInviteTokenRepository.findByToken(TOKEN)).thenReturn(Mono.empty());

            StepVerifier.create(dmInviteService.redeem(redeemer, TOKEN))
                    .expectErrorMatches(e -> e instanceof IllegalArgumentException
                            && "DM_INVITE_NOT_FOUND".equals(e.getMessage()))
                    .verify();
        }
    }

    @Nested
    @DisplayName("buildInviteUrl")
    class BuildInviteUrl {

        @Test
        @DisplayName("uses fragment prefix dm_invite_ when mini-app URL configured")
        void usesFragmentPrefix() {
            when(telegramProperties.getMiniApp()).thenReturn(miniApp);
            when(miniApp.getUrl()).thenReturn("https://burnedchats.net/");

            assertThat(dmInviteService.buildInviteUrl(TOKEN))
                    .isEqualTo("https://burnedchats.net/join#dm_invite_" + TOKEN);
        }

        @Test
        @DisplayName("falls back to startapp=dm_invite_ when mini-app URL empty")
        void fallsBackToStartapp() {
            when(telegramProperties.getMiniApp()).thenReturn(miniApp);
            when(miniApp.getUrl()).thenReturn("");
            when(telegramProperties.getBot()).thenReturn(bot);
            when(bot.getUsername()).thenReturn("BurnedChatsBot");

            assertThat(dmInviteService.buildInviteUrl(TOKEN))
                    .isEqualTo("https://t.me/BurnedChatsBot/app?startapp=dm_invite_" + TOKEN);
        }
    }

    private static DmInviteToken activeToken(String ownerInternalId) {
        return DmInviteToken.builder()
                .token(TOKEN)
                .ownerInternalId(ownerInternalId)
                .expiresAt(Instant.now().plusSeconds(600).toEpochMilli())
                .maxUses(1)
                .usedCount(0)
                .build();
    }
}
