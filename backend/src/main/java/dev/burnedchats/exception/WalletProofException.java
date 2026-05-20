package dev.burnedchats.exception;

import org.springframework.http.HttpStatus;

/**
 * Typed failure for TON Connect {@code ton_proof} verification.
 */
public class WalletProofException extends BurnedChatsException {

    private static final long serialVersionUID = 1L;

    /**
     * Machine-readable rejection reason surfaced to clients as {@code code}.
     */
    public enum Reason {
        INVALID_REQUEST,
        PROOF_TIMESTAMP_FUTURE,
        PROOF_EXPIRED,
        DOMAIN_MISMATCH,
        DOMAIN_LENGTH_MISMATCH,
        NONCE_MISSING,
        NONCE_UNKNOWN,
        ADDRESS_INVALID,
        PUBLIC_KEY_UNAVAILABLE,
        SIGNATURE_INVALID,
        INTERNAL;

        public HttpStatus httpStatus() {
            return switch (this) {
                case INVALID_REQUEST, ADDRESS_INVALID -> HttpStatus.BAD_REQUEST;
                case PUBLIC_KEY_UNAVAILABLE -> HttpStatus.BAD_GATEWAY;
                case INTERNAL -> HttpStatus.INTERNAL_SERVER_ERROR;
                default -> HttpStatus.UNAUTHORIZED;
            };
        }
    }

    private final Reason reason;

    public WalletProofException(Reason reason, String message, Throwable cause) {
        super(message, reason.name(), cause);
        this.reason = reason;
    }

    public Reason getReason() {
        return reason;
    }
}
