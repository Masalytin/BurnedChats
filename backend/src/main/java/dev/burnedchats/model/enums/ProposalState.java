package dev.burnedchats.model.enums;

/**
 * Mirrors on-chain {@code Proposal.state} ({@code proposal.tact}) and governor snapshot values.
 */
public enum ProposalState {
    ACTIVE(0),
    SUCCEEDED(1),
    DEFEATED(2),
    QUEUED(3),
    EXECUTED(4),
    CANCELLED(5),
    UNKNOWN(255);

    private final int code;

    ProposalState(int code) {
        this.code = code;
    }

    public int code() {
        return code;
    }

    public static ProposalState fromCode(int code) {
        for (ProposalState s : values()) {
            if (s.code == code) {
                return s;
            }
        }
        return UNKNOWN;
    }
}
