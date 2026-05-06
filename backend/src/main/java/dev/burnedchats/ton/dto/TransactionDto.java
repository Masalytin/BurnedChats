package dev.burnedchats.ton.dto;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Summary view of a TON account transaction from Ton Center {@code getTransactions}.
 *
 * @param account     raw account id string when present
 * @param utime       unix execution time when present
 * @param logicalTime logical time string when present
 * @param hash        transaction hash when present
 * @param raw         full transaction JSON for forward compatibility
 */
public record TransactionDto(
        String account,
        Long utime,
        String logicalTime,
        String hash,
        JsonNode raw) {
}
