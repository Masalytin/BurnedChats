package dev.burnedchats.service;

import dev.burnedchats.model.FileMetadata;
import dev.burnedchats.repository.FileMetadataRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@DisplayName("FileMessageRelayValidator")
class FileMessageRelayValidatorTest {

    private static final String FILE_ID = "file-uuid-1";
    private static final String CONTEXT_ID = "session-uuid";
    private static final String WALLET_INTERNAL_ID = "550e8400-e29b-41d4-a716-446655440000";
    private static final String OTHER_WALLET_INTERNAL_ID = "660e8400-e29b-41d4-a716-446655440001";
    private static final Long TG_ID = 123456789L;
    private static final String TG_INTERNAL_ID = "tg:123456789";

    @Mock
    private FileMetadataRepository fileMetadataRepository;

    private FileMessageRelayValidator validator;

    @BeforeEach
    void setUp() {
        validator = new FileMessageRelayValidator(fileMetadataRepository);
    }

    @Nested
    @DisplayName("validateFileMessage — wallet ownership")
    class WalletOwnership {

        @Test
        @DisplayName("wallet uploader matches by uploaderInternalId")
        void walletOwnerOk() {
            when(fileMetadataRepository.findById(FILE_ID)).thenReturn(Mono.just(metadata(
                    WALLET_INTERNAL_ID, null, CONTEXT_ID)));

            StepVerifier.create(validator.validateFileMessage(
                    FILE_ID, null, WALLET_INTERNAL_ID, null, CONTEXT_ID))
                    .verifyComplete();
        }

        @Test
        @DisplayName("different wallet internalId returns FILE_NOT_OWNED")
        void foreignWalletRejected() {
            when(fileMetadataRepository.findById(FILE_ID)).thenReturn(Mono.just(metadata(
                    WALLET_INTERNAL_ID, null, CONTEXT_ID)));

            StepVerifier.create(validator.validateFileMessage(
                    FILE_ID, null, OTHER_WALLET_INTERNAL_ID, null, CONTEXT_ID))
                    .expectErrorSatisfies(ex -> {
                        assert ex instanceof FileMessageRelayValidator.FileValidationException;
                        var fve = (FileMessageRelayValidator.FileValidationException) ex;
                        assert "FILE_NOT_OWNED".equals(fve.getErrorCode());
                        assert FILE_ID.equals(fve.getFileId());
                    })
                    .verify();
        }

        @Test
        @DisplayName("wallet sender with null telegramId does not false-match legacy uploaderTgId-only")
        void nullTgIdDoesNotFalseMatchLegacy() {
            when(fileMetadataRepository.findById(FILE_ID)).thenReturn(Mono.just(FileMetadata.builder()
                    .fileId(FILE_ID)
                    .uploaderInternalId(null)
                    .uploaderTgId(WALLET_INTERNAL_ID)
                    .contextId(CONTEXT_ID)
                    .build()));

            StepVerifier.create(validator.validateFileMessage(
                    FILE_ID, null, WALLET_INTERNAL_ID, null, CONTEXT_ID))
                    .expectErrorSatisfies(ex -> {
                        assert ex instanceof FileMessageRelayValidator.FileValidationException;
                        assert "FILE_NOT_OWNED".equals(
                                ((FileMessageRelayValidator.FileValidationException) ex).getErrorCode());
                    })
                    .verify();
        }
    }

    @Nested
    @DisplayName("validateFileMessage — Telegram / legacy metadata")
    class TelegramAndLegacy {

        @Test
        @DisplayName("Telegram uploader matches by uploaderInternalId")
        void telegramOwnerByInternalId() {
            when(fileMetadataRepository.findById(FILE_ID)).thenReturn(Mono.just(metadata(
                    TG_INTERNAL_ID, String.valueOf(TG_ID), CONTEXT_ID)));

            StepVerifier.create(validator.validateFileMessage(
                    FILE_ID, null, TG_INTERNAL_ID, TG_ID, CONTEXT_ID))
                    .verifyComplete();
        }

        @Test
        @DisplayName("legacy uploaderTgId-only metadata OK for Telegram sender")
        void legacyUploaderTgIdOnlyOk() {
            when(fileMetadataRepository.findById(FILE_ID)).thenReturn(Mono.just(FileMetadata.builder()
                    .fileId(FILE_ID)
                    .uploaderInternalId(null)
                    .uploaderTgId(String.valueOf(TG_ID))
                    .contextId(CONTEXT_ID)
                    .build()));

            StepVerifier.create(validator.validateFileMessage(
                    FILE_ID, null, TG_INTERNAL_ID, TG_ID, CONTEXT_ID))
                    .verifyComplete();
        }

        @Test
        @DisplayName("legacy metadata rejects wrong Telegram sender")
        void legacyWrongTelegramSender() {
            when(fileMetadataRepository.findById(FILE_ID)).thenReturn(Mono.just(FileMetadata.builder()
                    .fileId(FILE_ID)
                    .uploaderInternalId(null)
                    .uploaderTgId(String.valueOf(TG_ID))
                    .contextId(CONTEXT_ID)
                    .build()));

            StepVerifier.create(validator.validateFileMessage(
                    FILE_ID, null, TG_INTERNAL_ID, 999999999L, CONTEXT_ID))
                    .expectError(FileMessageRelayValidator.FileValidationException.class)
                    .verify();
        }
    }

    @Nested
    @DisplayName("isOwner unit checks")
    class IsOwner {

        @Test
        @DisplayName("prefers uploaderInternalId over uploaderTgId")
        void prefersInternalId() {
            FileMetadata meta = FileMetadata.builder()
                    .uploaderInternalId(WALLET_INTERNAL_ID)
                    .uploaderTgId(String.valueOf(TG_ID))
                    .build();

            assert FileMessageRelayValidator.isOwner(meta, WALLET_INTERNAL_ID, TG_ID);
            assert !FileMessageRelayValidator.isOwner(meta, OTHER_WALLET_INTERNAL_ID, TG_ID);
        }
    }

    private static FileMetadata metadata(String uploaderInternalId, String uploaderTgId, String contextId) {
        return FileMetadata.builder()
                .fileId(FILE_ID)
                .uploaderInternalId(uploaderInternalId)
                .uploaderTgId(uploaderTgId)
                .contextType("session")
                .contextId(contextId)
                .build();
    }
}
