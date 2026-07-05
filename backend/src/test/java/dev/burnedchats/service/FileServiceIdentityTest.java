package dev.burnedchats.service;

import dev.burnedchats.model.FileMetadata;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.repository.FileMetadataRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.security.RestIdentityAuthService;
import dev.burnedchats.security.RestIdentityAuthService.ResolvedIdentity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DefaultDataBufferFactory;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Instant;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link FileService} identity-driven upload/download authorization.
 *
 * <p>Identity resolution is delegated to {@link RestIdentityAuthService}; these tests
 * verify FileService uses the resolved {@code internalId} for membership checks.
 */
@ExtendWith(MockitoExtension.class)
class FileServiceIdentityTest {

    private static final String SESSION_ID = "session-abc";
    private static final String LEGACY_INTERNAL_ID = "legacy-telegram-internal";
    private static final String LINKED_INTERNAL_ID = "linked-wallet-internal";
    private static final String WALLET_INTERNAL_ID = "wallet-only-internal";

    @Mock
    private RestIdentityAuthService restIdentityAuthService;

    @Mock
    private FileStorageService fileStorageService;

    @Mock
    private FileMetadataRepository fileMetadataRepository;

    @Mock
    private SessionRepository sessionRepository;

    @Mock
    private RoomMembersRepository roomMembersRepository;

    @Mock
    private FileValidationService fileValidationService;

    @InjectMocks
    private FileService fileService;

    @BeforeEach
    void stubValidationAndStorage() {
        when(fileValidationService.validateUpload(anyLong(), anyString(), anyString()))
                .thenReturn(Mono.empty());
        when(fileStorageService.save(anyString(), any())).thenReturn(Mono.empty());
        when(fileStorageService.fileSize(anyString())).thenReturn(Mono.just(4L));
        when(fileMetadataRepository.save(any(FileMetadata.class))).thenReturn(Mono.empty());
    }

    @Test
    void uploadTelegramOnlyUsesResolvedLegacyInternalId() {
        when(restIdentityAuthService.resolve(null, "init", null))
                .thenReturn(Mono.just(new ResolvedIdentity(LEGACY_INTERNAL_ID, "1001")));
        stubActiveSession(LEGACY_INTERNAL_ID);

        Flux<DataBuffer> data = Flux.just(new DefaultDataBufferFactory().wrap(new byte[4]));

        StepVerifier.create(fileService.upload(null, "init", null, "session", SESSION_ID, 4, data))
                .expectNextMatches(result -> result.fileId() != null && result.size() == 4)
                .verifyComplete();
    }

    @Test
    void uploadLinkedTelegramUsesMappedInternalId() {
        when(restIdentityAuthService.resolve("telegram", "init", null))
                .thenReturn(Mono.just(new ResolvedIdentity(LINKED_INTERNAL_ID, "2002")));
        stubActiveSession(LINKED_INTERNAL_ID);

        Flux<DataBuffer> data = Flux.just(new DefaultDataBufferFactory().wrap(new byte[4]));

        StepVerifier.create(fileService.upload("telegram", "init", null, "session", SESSION_ID, 4, data))
                .expectNextCount(1)
                .verifyComplete();
    }

    @Test
    void uploadWalletOnlyUsesSessionInternalId() {
        when(restIdentityAuthService.resolve("wallet", null, "token"))
                .thenReturn(Mono.just(new ResolvedIdentity(WALLET_INTERNAL_ID, WALLET_INTERNAL_ID)));
        stubActiveSession(WALLET_INTERNAL_ID);

        Flux<DataBuffer> data = Flux.just(new DefaultDataBufferFactory().wrap(new byte[4]));

        StepVerifier.create(fileService.upload("wallet", null, "token", "session", SESSION_ID, 4, data))
                .expectNextCount(1)
                .verifyComplete();
    }

    private void stubActiveSession(String participantInternalId) {
        when(sessionRepository.findById(SESSION_ID)).thenReturn(Mono.just(Session.builder()
                .id(SESSION_ID)
                .initiatorInternalId(participantInternalId)
                .status(SessionStatus.ACTIVE)
                .createdAt(Instant.now())
                .lastActivityAt(Instant.now())
                .build()));
    }
}
