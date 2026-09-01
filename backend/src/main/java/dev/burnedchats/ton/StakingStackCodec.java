package dev.burnedchats.ton;

import com.fasterxml.jackson.databind.JsonNode;
import dev.burnedchats.model.enums.StakingTier;
import dev.burnedchats.ton.dto.StakeInfo;
import dev.burnedchats.ton.dto.TierConfigDto;
import dev.burnedchats.ton.exception.TonRpcException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.math.BigInteger;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Ton Center stack flattening and get-method parsers for staking snapshot reads.
 */
final class StakingStackCodec {

    private static final Logger LOG = LoggerFactory.getLogger(StakingStackCodec.class);

    private StakingStackCodec() {
    }

    static Optional<StakeInfo> parseStake(JsonNode result, StakingTier tier) {
        List<JsonNode> flat = flattenStackNodes(result);
        if (flat.size() < 5) {
            return Optional.empty();
        }
        BigInteger amount = parseNum(flat.get(0));
        if (amount.signum() <= 0) {
            return Optional.empty();
        }
        int tierNum = parseNum(flat.get(1)).intValueExact();
        long start = parseNum(flat.get(2)).longValueExact();
        long lastClaim = parseNum(flat.get(3)).longValueExact();
        long unlock = parseNum(flat.get(4)).longValueExact();
        StakingTier onChain = StakingTier.fromId(tierNum);
        if (onChain != tier) {
            LOG.trace("Stake tier mismatch param={} chain={}", tier, onChain);
        }
        return Optional.of(new StakeInfo(onChain, amount, start, unlock, lastClaim, BigInteger.ZERO));
    }

    static TierConfigDto parseLockConfig(JsonNode result, StakingTier tier) {
        List<JsonNode> flat = flattenStackNodes(result);
        if (flat.size() < 3) {
            throw new TonRpcException("get_lock_config stack too small");
        }
        long lockDurationSec = parseNum(flat.get(0)).longValueExact();
        double multiplier = parseNum(flat.get(1)).intValueExact() / 100.0;
        int share = parseNum(flat.get(2)).intValueExact();
        return new TierConfigDto(tier, lockDurationSec, multiplier, share);
    }

    static BigInteger firstStackNum(JsonNode result) {
        JsonNode stack = result.get("stack");
        if (stack == null || stack.size() < 1) {
            return BigInteger.ZERO;
        }
        return parseNum(stack.get(0));
    }

    static String extractAddressFromStack(JsonNode result) {
        JsonNode stack = result.get("stack");
        if (stack == null || stack.size() < 1) {
            throw new TonRpcException("empty stack for address");
        }
        return TonAddressBoc.decodeRawAddressFromSingleRootBoc(cellBase64(stack.get(0)));
    }

    static List<JsonNode> flattenStackNodes(JsonNode result) {
        JsonNode stack = result.get("stack");
        if (stack == null || !stack.isArray()) {
            return List.of();
        }
        if (stack.size() == 1 && stack.get(0).isArray()) {
            JsonNode sole = stack.get(0);
            String soleType = sole.size() >= 2 ? sole.get(0).asText("") : "";
            if ("tuple".equalsIgnoreCase(soleType) || "list".equalsIgnoreCase(soleType)) {
                JsonNode tuple = sole.get(1);
                List<JsonNode> out = new ArrayList<>();
                JsonNode elements = tuple != null && tuple.isObject() ? tuple.get("elements") : tuple;
                if (elements != null && elements.isArray()) {
                    for (JsonNode n : elements) {
                        out.add(n);
                    }
                }
                return out;
            }
        }
        List<JsonNode> out = new ArrayList<>();
        for (JsonNode n : stack) {
            out.add(n);
        }
        return out;
    }

    static BigInteger parseNum(JsonNode item) {
        String raw;
        if (item.isArray() && item.size() >= 2) {
            raw = item.get(1).asText();
        } else if (item.has("number")) {
            JsonNode n = item.get("number");
            raw = n.isObject() && n.has("number") ? n.get("number").asText() : n.asText();
        } else if (item.has("value")) {
            raw = item.get("value").asText();
        } else {
            raw = item.asText();
        }
        raw = raw.trim();
        if (raw.startsWith("0x") || raw.startsWith("0X")) {
            return new BigInteger(raw.substring(2), 16);
        }
        return new BigInteger(raw);
    }

    private static String cellBase64(JsonNode stackEntry) {
        if (stackEntry.isArray() && stackEntry.size() >= 2) {
            JsonNode v = stackEntry.get(1);
            if (v.isTextual()) {
                return v.asText();
            }
            if (v.isObject() && v.has("bytes")) {
                return v.get("bytes").asText();
            }
        }
        if (stackEntry.isObject() && stackEntry.has("bytes")) {
            return stackEntry.get("bytes").asText();
        }
        throw new TonRpcException("Cannot read cell/slice value");
    }
}
