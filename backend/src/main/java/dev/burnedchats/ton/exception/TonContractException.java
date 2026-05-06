package dev.burnedchats.ton.exception;

import dev.burnedchats.exception.BurnedChatsException;

/**
 * Get-method exited with non-zero TVM exit code or contract read was invalid.
 */
public class TonContractException extends BurnedChatsException {

    private static final long serialVersionUID = 1L;

    public static final String ERROR_CODE = "TON_CONTRACT";

    private final int exitCode;

    public TonContractException(String message, int exitCode) {
        super(message, ERROR_CODE);
        this.exitCode = exitCode;
    }

    public int getExitCode() {
        return exitCode;
    }
}
