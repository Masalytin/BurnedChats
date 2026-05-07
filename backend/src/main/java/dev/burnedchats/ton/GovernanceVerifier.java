package dev.burnedchats.ton;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.burnedchats.model.enums.ProposalState;
import dev.burnedchats.model.enums.ProposalType;
import dev.burnedchats.ton.TonConfig.TonSettings;
import dev.burnedchats.ton.dto.ProposalDetail;
import dev.burnedchats.ton.dto.ProposalSummary;
import dev.burnedchats.ton.dto.UserVote;
import dev.burnedchats.ton.exception.TonContractException;
import dev.burnedchats.ton.exception.TonRpcException;
import dev.burnedchats.ton.util.ProposalPayloadDecoder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.util.function.Tuple2;
import reactor.util.function.Tuple8;

import java.math.BigInteger;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.stream.LongStream;

/**
 * Read-only governor / proposal helpers (RPC via {@link TonService}, Redis cache TTL 30s).
 */
@Service
public class GovernanceVerifier {

    private static final Logger LOG = LoggerFactory.getLogger(GovernanceVerifier.class);

    private static final String CACHE_VER = "v1";
    private static final Duration CACHE_TTL = Duration.ofSeconds(30);

    private final TonService tonService;
    private final TonSettings settings;
    private final StakingVerifier stakingVerifier;
    private final ReactiveRedisTemplate<String, String> stringRedis;
    private final ObjectMapper objectMapper;

    public GovernanceVerifier(
            TonService tonService,
            TonSettings settings,
            StakingVerifier stakingVerifier,
            ReactiveRedisTemplate<String, String> stringRedis,
            ObjectMapper objectMapper) {
        this.tonService = tonService;
        this.settings = settings;
        this.stakingVerifier = stakingVerifier;
        this.stringRedis = stringRedis;
        this.objectMapper = objectMapper;
    }

    /** All proposals with governor-reported {@link ProposalState#ACTIVE} state. */
    public Flux<ProposalSummary> getActiveProposals() {
        return proposalCount()
                .flatMapMany(count -> {
                    if (count <= 0) {
                        return Flux.empty();
                    }
                    return Flux.fromStream(LongStream.range(0, count).boxed())
                            .concatMap(id -> governorProposalState(id)
                                    .flatMap(state -> state == ProposalState.ACTIVE.code()
                                            ? proposalSummaryCached(id)
                                            : Mono.empty()));
                });
    }

    /** Recent proposals by id descending (most recent first), including terminal states. */
    public Flux<ProposalSummary> getRecentProposals(int limit) {
        int lim = Math.max(1, limit);
        return proposalCount()
                .flatMapMany(count -> {
                    if (count <= 0) {
                        return Flux.empty();
                    }
                    long start = Math.max(0, count - lim);
                    return Flux.fromStream(LongStream.iterate(count - 1, i -> i >= start, i -> i - 1).boxed())
                            .concatMap(this::proposalSummaryCached);
                });
    }

    /** Full proposal with decoded payload. */
    public Mono<ProposalDetail> getProposal(long proposalId) {
        if (proposalId < 0) {
            return Mono.error(new TonRpcException("negative proposal id"));
        }
        return proposalDetailCached(proposalId);
    }

    /**
     * User vote if they are marked as voted on-chain. {@link UserVote#support()} is often {@code null}
     * because the contract stores only a flag (see {@code proposal.tact}).
     */
    public Mono<Optional<UserVote>> getUserVote(long proposalId, String userAddress) {
        if (proposalId < 0) {
            return Mono.error(new TonRpcException("negative proposal id"));
        }
        return proposalContractAddress(proposalId)
                .flatMap(addr -> tonService.runGetMethod(
                                addr, "has_voted", List.of(TonAddressBoc.sliceStackArg(userAddress)))
                        .map(GovernanceVerifier::parseBoolStack)
                        .defaultIfEmpty(false)
                        .flatMap(voted -> {
                            if (!Boolean.TRUE.equals(voted)) {
                                return Mono.just(Optional.<UserVote>empty());
                            }
                            return stakingVerifier
                                    .getVotingPower(userAddress)
                                    .map(vp -> Optional.of(new UserVote(proposalId, null, vp, 0L)));
                        })
                        .onErrorResume(TonContractException.class, e -> Mono.just(Optional.empty())));
    }

    /** Delegates to {@link StakingVerifier#getVotingPower(String)}. */
    public Mono<BigInteger> getUserVotingPower(String userAddress) {
        return stakingVerifier.getVotingPower(userAddress);
    }

    private Mono<ProposalSummary> proposalSummaryCached(long id) {
        String key = summaryCacheKey(id);
        return readCache(key, ProposalSummary.class)
                .switchIfEmpty(Mono.defer(() -> loadProposalDetailFromChain(id)
                        .map(ProposalDetail::summary)
                        .flatMap(s -> writeCache(key, s, CACHE_TTL).thenReturn(s))));
    }

    private Mono<ProposalDetail> proposalDetailCached(long id) {
        String key = detailCacheKey(id);
        return readCache(key, ProposalDetail.class)
                .switchIfEmpty(Mono.defer(() -> loadProposalDetailFromChain(id)
                        .flatMap(d -> writeCache(key, d, CACHE_TTL).thenReturn(d))));
    }

    private Mono<ProposalDetail> loadProposalDetailFromChain(long id) {
        return proposalContractAddress(id)
                .flatMap(addr -> {
                    var bulk = Mono.zip(
                            runGm(addr, "get_proposal_type", List.of()),
                            runGm(addr, "get_proposer", List.of()),
                            runGm(addr, "get_payload", List.of()),
                            runGm(addr, "get_start_time", List.of()),
                            runGm(addr, "get_end_time", List.of()),
                            runGm(addr, "get_state", List.of()),
                            runGm(addr, "get_for_votes", List.of()),
                            runGm(addr, "get_against_votes", List.of()));
                    Mono<Tuple2<JsonNode, JsonNode>> extras = Mono.zip(
                            runGm(addr, "get_quorum_required", List.of()),
                            runGm(addr, "get_threshold_bps", List.of()));
                    return Mono.zip(bulk, extras)
                            .map(t -> proposalDetailFromStack(id, t.getT1(), t.getT2()));
                });
    }

    private ProposalDetail proposalDetailFromStack(
            long id,
            Tuple8<JsonNode, JsonNode, JsonNode, JsonNode, JsonNode, JsonNode, JsonNode, JsonNode> main,
            Tuple2<JsonNode, JsonNode> extra) {

        JsonNode rpcProposalType = main.getT1();
        JsonNode rpcProposer = main.getT2();
        JsonNode rpcPayload = main.getT3();
        JsonNode rpcStart = main.getT4();
        JsonNode rpcEnd = main.getT5();
        JsonNode rpcState = main.getT6();
        JsonNode rpcForVotes = main.getT7();
        JsonNode rpcAgainstVotes = main.getT8();

        ProposalType type = ProposalType.fromId(num(rpcProposalType, 0).intValueExact());
        String proposer = TonAddressBoc.decodeRawAddressFromSingleRootBoc(cellB64(rpcProposer, 0));
        String payloadB64 = cellB64(rpcPayload, 0);
        long start = num(rpcStart, 0).longValueExact();
        long end = num(rpcEnd, 0).longValueExact();
        ProposalState state = ProposalState.fromCode(num(rpcState, 0).intValueExact());
        BigInteger forV = num(rpcForVotes, 0);
        BigInteger againstV = num(rpcAgainstVotes, 0);
        BigInteger quorum = num(extra.getT1(), 0);
        BigInteger thresh = num(extra.getT2(), 0);

        Object decoded;
        try {
            decoded = ProposalPayloadDecoder.decode(payloadB64, type);
        } catch (RuntimeException ex) {
            LOG.debug("payload decode failed proposalId={}: {}", id, ex.toString());
            decoded = new RawPayloadFallback(payloadB64, ex.getMessage());
        }
        String title = ProposalPayloadDecoder.titleFromDecoded(decoded, type);
        ProposalSummary summary = new ProposalSummary(id, type, proposer, title, start, end, state, forV, againstV);
        return new ProposalDetail(summary, decoded, quorum, thresh, 0);
    }

    private Mono<JsonNode> runGm(String contract, String method, List<Object> args) {
        return tonService.runGetMethod(contract, method, args);
    }

    private Mono<Long> proposalCount() {
        String governor = requireGovernor();
        return tonService
                .runGetMethod(governor, "get_proposal_count", List.of())
                .map(n -> num(n, 0).longValueExact());
    }

    private Mono<Integer> governorProposalState(long id) {
        String governor = requireGovernor();
        return tonService
                .runGetMethod(governor, "get_proposal_state", List.of(TonAddressBoc.numStackArg(id)))
                .map(n -> num(n, 0).intValueExact())
                .defaultIfEmpty(ProposalState.UNKNOWN.code());
    }

    private Mono<String> proposalContractAddress(long id) {
        String governor = requireGovernor();
        return tonService
                .runGetMethod(governor, "get_proposal", List.of(TonAddressBoc.numStackArg(id)))
                .map(n -> TonAddressBoc.decodeRawAddressFromSingleRootBoc(cellB64(n, 0)));
    }

    private static boolean parseBoolStack(JsonNode result) {
        BigInteger v = num(result, 0);
        return v.signum() != 0;
    }

    private static BigInteger num(JsonNode result, int stackIndex) {
        List<JsonNode> flat = flattenStack(result);
        if (flat.size() <= stackIndex) {
            return BigInteger.ZERO;
        }
        return parseNum(flat.get(stackIndex));
    }

    private static String cellB64(JsonNode result, int stackIndex) {
        List<JsonNode> flat = flattenStack(result);
        if (flat.size() <= stackIndex) {
            throw new TonRpcException("cell stack index out of range");
        }
        return cellBase64(flat.get(stackIndex));
    }

    private static List<JsonNode> flattenStack(JsonNode result) {
        JsonNode stack = result.get("stack");
        if (stack == null || !stack.isArray()) {
            return List.of();
        }
        if (stack.size() == 1 && stack.get(0).isArray()) {
            JsonNode sole = stack.get(0);
            if (sole.size() >= 2 && "tuple".equalsIgnoreCase(sole.get(0).asText(""))) {
                JsonNode tuple = sole.get(1);
                List<JsonNode> out = new ArrayList<>();
                if (tuple != null && tuple.isArray()) {
                    for (JsonNode n : tuple) {
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

    private static BigInteger parseNum(JsonNode item) {
        String raw;
        if (item.isArray() && item.size() >= 2) {
            raw = item.get(1).asText();
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

    private <T> Mono<T> readCache(String key, Class<T> type) {
        return stringRedis.opsForValue()
                .get(key)
                .filter(s -> s != null && !s.isBlank())
                .flatMap(json -> Mono.fromCallable(() -> objectMapper.readValue(json, type)));
    }

    private Mono<Boolean> writeCache(String key, Object value, Duration ttl) {
        try {
            String json = objectMapper.writeValueAsString(value);
            return stringRedis.opsForValue().set(key, json, ttl).defaultIfEmpty(false);
        } catch (JsonProcessingException e) {
            return Mono.error(new TonRpcException("governance cache serialize", e));
        }
    }

    private String summaryCacheKey(long id) {
        return "ton:governance:summary:" + CACHE_VER + ":" + id;
    }

    private String detailCacheKey(long id) {
        return "ton:governance:detail:" + CACHE_VER + ":" + id;
    }

    private String requireGovernor() {
        String g = settings.getAddresses().getGovernor();
        if (g == null || g.isBlank()) {
            throw new TonRpcException("app.ton.addresses.governor is not configured");
        }
        return g.trim();
    }

    /**
     * Fallback when payload layout is unexpected; keeps API structured while surfacing raw BoC.
     */
    public record RawPayloadFallback(String payloadCellBase64, String errorMessage) {}

}
