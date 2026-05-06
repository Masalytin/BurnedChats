package dev.burnedchats.ton.exception;

import dev.burnedchats.exception.BurnedChatsException;

/**
 * Failure talking to TON HTTP API (Ton Center v2 or compatible).
 */
public class TonRpcException extends BurnedChatsException {

    private static final long serialVersionUID = 1L;

    public static final String ERROR_CODE = "TON_RPC";

    public TonRpcException(String message) {
        super(message, ERROR_CODE);
    }

    public TonRpcException(String message, Throwable cause) {
        super(message, ERROR_CODE, cause);
    }
}
