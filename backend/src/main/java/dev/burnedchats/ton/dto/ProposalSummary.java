package dev.burnedchats.ton.dto;

import dev.burnedchats.model.enums.ProposalState;
import dev.burnedchats.model.enums.ProposalType;

import java.math.BigInteger;

/**
 * High-level proposal row for governance UI.
 */
public record ProposalSummary(
        long id,
        ProposalType type,
        String proposer,
        String title,
        long startTime,
        long endTime,
        ProposalState state,
        BigInteger forVotes,
        BigInteger againstVotes
) {
}
