package dev.burnedchats.security;

/**
 * Credential payload dispatched to authentication strategies (Telegram Mini App initData or wallet proofs later).
 *
 * @param type          {@code telegram} | {@code wallet}; blank with initData only means Telegram (compat)
 * @param initData      Telegram Mini App initData (URL-encoded query string)
 * @param walletProof   optional signed proof (e.g. ton_proof payload) for wallet auth
 * @param walletAddress optional wallet identifier for wallet auth
 */
public record AuthCredentials(
        String type,
        String initData,
        String walletProof,
        String walletAddress
) {

    /**
     * Build credentials for Telegram Mini App authentication.
     */
    public static AuthCredentials telegram(String initData) {
        return new AuthCredentials("telegram", initData, null, null);
    }

    /**
     * Build credentials for wallet-based authentication (used by future strategies).
     */
    public static AuthCredentials wallet(String walletProof, String walletAddress) {
        return new AuthCredentials("wallet", null, walletProof, walletAddress);
    }
}
