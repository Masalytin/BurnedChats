package dev.burnedchats.ton.dto;

import java.math.BigInteger;

/**
 * On-chain BURN jetton master snapshot (TEP-74 style master data + wallet code).
 */
public record JettonInfo(
        BigInteger totalSupply,
        boolean mintable,
        String admin,
        String walletCode,
        String metadataUri
) {
}
