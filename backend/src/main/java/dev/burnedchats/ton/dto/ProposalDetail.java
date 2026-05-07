package dev.burnedchats.ton.dto;

import java.math.BigInteger;

/**
 * Full proposal read model including decoded execution payload.
 *
 * <p>{@code totalVoters} is filled with {@code 0} until a contract getter or off-chain indexer exposes
 * voter-count ({@code Proposal} stores a map without a public size getter).
 */
public record ProposalDetail(
        ProposalSummary summary,
        Object decodedPayload,
        BigInteger quorumRequired,
        BigInteger thresholdRequired,
        int totalVoters
) {
}
