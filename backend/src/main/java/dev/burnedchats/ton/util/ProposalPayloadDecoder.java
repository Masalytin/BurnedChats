package dev.burnedchats.ton.util;

import dev.burnedchats.model.enums.ProposalType;
import dev.burnedchats.ton.exception.TonRpcException;
import org.ton.ton4j.address.Address;
import org.ton.ton4j.cell.Cell;
import org.ton.ton4j.cell.CellSlice;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Locale;

/**
 * Decodes governance proposal {@code payload} cells ({@code governance-payload.tact}) using ton4j.
 */
public final class ProposalPayloadDecoder {

    private ProposalPayloadDecoder() {
    }

    public record ParameterChangePayload(String targetRaw, long methodId, String argsCellBase64) {}

    public record FeaturePriorityPayload(String description, String cid) {}

    public record TreasurySpendPayload(String treasuryRaw, String recipientRaw, BigInteger amountNano, String reason) {}

    public record EmergencyPayload(String targetRaw, long methodId, String argsCellBase64, String reason) {}

    /**
     * Decodes root payload cell (BoC base64 as returned in Ton Center stack for {@code cell} type).
     */
    public static Object decode(String payloadCellBase64, ProposalType type) {
        if (payloadCellBase64 == null || payloadCellBase64.isBlank()) {
            throw new TonRpcException("empty proposal payload cell");
        }
        Cell root = Cell.fromBocBase64(payloadCellBase64);
        CellSlice s = CellSlice.beginParse(root);
        return switch (type) {
            case PARAMETER_CHANGE -> decodeParameterChange(s);
            case FEATURE_PRIORITY -> decodeFeaturePriority(s);
            case TREASURY_SPEND -> decodeTreasurySpend(s);
            case EMERGENCY -> decodeEmergency(s);
        };
    }

    /** Short UI title extracted from decoded payload or type fallback. */
    public static String titleFromDecoded(Object decoded, ProposalType type) {
        if (decoded instanceof ParameterChangePayload p) {
            return "Parameter change @" + shortenAddr(p.targetRaw()) + " method 0x"
                    + Long.toUnsignedString(p.methodId(), 16);
        }
        if (decoded instanceof FeaturePriorityPayload p) {
            String d = p.description() == null ? "" : p.description().trim();
            if (d.isEmpty()) {
                return "Feature priority";
            }
            int nl = d.indexOf('\n');
            String head = nl < 0 ? d : d.substring(0, nl);
            return head.length() <= 120 ? head : head.substring(0, 117) + "...";
        }
        if (decoded instanceof TreasurySpendPayload p) {
            String r = p.reason() == null ? "" : p.reason().trim();
            if (!r.isEmpty()) {
                return r.length() <= 120 ? r : r.substring(0, 117) + "...";
            }
            return "Treasury spend → " + shortenAddr(p.recipientRaw());
        }
        if (decoded instanceof EmergencyPayload p) {
            String r = p.reason() == null ? "" : p.reason().trim();
            if (!r.isEmpty()) {
                return r.length() <= 120 ? r : r.substring(0, 117) + "...";
            }
            return "Emergency @" + shortenAddr(p.targetRaw());
        }
        return type.name().toLowerCase(Locale.ROOT).replace('_', ' ');
    }

    private static ParameterChangePayload decodeParameterChange(CellSlice s) {
        Address target = s.loadAddress();
        BigInteger mid = s.loadUint(32);
        Cell args = s.loadRef();
        maybeEndParsePayload(s);
        return new ParameterChangePayload(addressRaw(target), mid.longValueExact(), cellToB64(args));
    }

    private static FeaturePriorityPayload decodeFeaturePriority(CellSlice s) {
        Cell desc = s.loadRef();
        Cell cid = s.loadRef();
        maybeEndParsePayload(s);
        String description = utf8PlainCell(desc);
        String cidText = utf8PlainCell(cid);
        return new FeaturePriorityPayload(description, cidText);
    }

    private static TreasurySpendPayload decodeTreasurySpend(CellSlice s) {
        Address treasury = s.loadAddress();
        Address recipient = s.loadAddress();
        BigInteger amt = s.loadCoins();
        Cell reason = s.loadRef();
        maybeEndParsePayload(s);
        return new TreasurySpendPayload(addressRaw(treasury), addressRaw(recipient), amt, utf8PlainCell(reason));
    }

    private static EmergencyPayload decodeEmergency(CellSlice s) {
        Address target = s.loadAddress();
        BigInteger mid = s.loadUint(32);
        Cell args = s.loadRef();
        Cell reason = s.loadRef();
        maybeEndParsePayload(s);
        return new EmergencyPayload(addressRaw(target), mid.longValueExact(), cellToB64(args), utf8PlainCell(reason));
    }

    /** Tact validation allows trailing emptiness only; tolerate unread padding bits/refs. */
    private static void maybeEndParsePayload(CellSlice s) {
        try {
            s.endParse();
        } catch (Throwable ignored) {
            // tolerate non-zero trailing padding in tooling-generated cells
        }
    }

    private static String addressRaw(Address a) {
        return a == null ? "" : a.toRaw();
    }

    private static String shortenAddr(String raw) {
        if (raw == null || raw.length() <= 14) {
            return raw == null ? "" : raw;
        }
        int c = raw.indexOf(':');
        if (c < 0) {
            return raw.substring(0, 6) + "…";
        }
        String hex = raw.substring(c + 1);
        if (hex.length() <= 8) {
            return raw;
        }
        return raw.substring(0, c + 1) + hex.substring(0, 4) + "…" + hex.substring(hex.length() - 4);
    }

    private static String cellToB64(Cell c) {
        return Base64.getEncoder().encodeToString(c.toBoc(false));
    }

    private static String utf8PlainCell(Cell cell) {
        CellSlice cs = CellSlice.beginParse(cell);
        if (cs.getRefsCount() == 0) {
            byte[] bytes = cs.loadSignedBytes();
            cs.endParse();
            return new String(bytes, StandardCharsets.UTF_8).replace('\u0000', ' ').trim();
        }
        String snake = cs.loadSnakeString();
        if (snake != null && !snake.isBlank()) {
            return snake.trim();
        }
        byte[] bytes = cs.loadSignedBytes();
        return new String(bytes, StandardCharsets.UTF_8).replace('\u0000', ' ').trim();
    }
}
