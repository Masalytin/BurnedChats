package dev.burnedchats.ton.dto;

import java.math.BigInteger;

/**
 * User's vote on a proposal. {@code support} may be {@code null} when the chain exposes only a
 * voted flag (see decision log P5-4-1-4). {@code voteTimestamp} is {@code 0} when unknown.
 */
public record UserVote(
        long proposalId,
        Boolean support,
        BigInteger vp,
        long voteTimestamp
) {
}
