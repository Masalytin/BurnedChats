package dev.burnedchats.model.enums;

/**
 * On-chain {@code proposalType} values (see {@code governance-payload.tact}).
 */
public enum ProposalType {
    PARAMETER_CHANGE(0),
    FEATURE_PRIORITY(1),
    TREASURY_SPEND(2),
    EMERGENCY(3);

    private final int id;

    ProposalType(int id) {
        this.id = id;
    }

    public int id() {
        return id;
    }

    public static ProposalType fromId(int id) {
        for (ProposalType t : values()) {
            if (t.id == id) {
                return t;
            }
        }
        throw new IllegalArgumentException("Unknown proposal type: " + id);
    }
}
