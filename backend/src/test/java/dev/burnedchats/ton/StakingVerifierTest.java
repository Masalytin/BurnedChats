package dev.burnedchats.ton;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.burnedchats.model.enums.StakingTier;
import dev.burnedchats.ton.TonConfig.TonSettings;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.data.redis.core.ReactiveValueOperations;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.io.IOException;
import java.math.BigInteger;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@DisplayName("StakingVerifier")
class StakingVerifierTest {

    private static final String STAKER =
            "EQBo3W19O92qLjdoYbERATFtQUh1Qp_NZJ6JU_lXyLnGUJT_";

    private static final int[] MULT_X100 = {100, 150, 200, 300};
    private static final int[] SHARE_PCT = {5, 10, 25, 60};
    private static final long[] LOCK_SEC = {0L, 15_552_000L, 31_536_000L, 94_608_000L};
    private static final int[] TVL_NANO = {1_000, 2_000, 3_000, 4_000};

    private MockWebServer server;
    private StakingVerifier verifier;
    private TonService tonService;
    private ReactiveRedisTemplate<String, String> redisTemplate;
    private ReactiveValueOperations<String, String> valueOps;
    private ObjectMapper objectMapper;
    private TonSettings settings;

    private final ConcurrentHashMap<String, String> redisBacking = new ConcurrentHashMap<>();
    private final List<String> deletedKeys = new ArrayList<>();

    @BeforeEach
    void setUp() throws IOException {
        redisBacking.clear();
        deletedKeys.clear();
        server = new MockWebServer();
        server.start();

        objectMapper = new ObjectMapper();
        settings = new TonSettings();
        settings.getRpc().setEndpoint(server.url("/api/v2").toString().replaceAll("/$", ""));
        settings.getRpc().setRetryAttempts(3);
        settings.getRpc().setTimeoutMs(5000);
        settings.getCache().setTtlSeconds(30);
        settings.getAddresses().setJettonMaster(STAKER);
        settings.getAddresses().setStakingMaster(STAKER);

        @SuppressWarnings("unchecked")
        ReactiveRedisTemplate<String, String> template = mock(ReactiveRedisTemplate.class);
        redisTemplate = template;
        valueOps = mock(ReactiveValueOperations.class);
        when(template.opsForValue()).thenReturn(valueOps);
        when(valueOps.set(anyString(), anyString(), any(Duration.class)))
                .thenAnswer(inv -> {
                    redisBacking.put(inv.getArgument(0), inv.getArgument(1));
                    return Mono.just(true);
                });
        when(valueOps.get(anyString()))
                .thenAnswer(inv -> Mono.justOrEmpty(redisBacking.get(inv.getArgument(0))));
        when(valueOps.setIfAbsent(anyString(), anyString(), any(Duration.class)))
                .thenAnswer(inv -> {
                    String key = inv.getArgument(0);
                    if (redisBacking.containsKey(key)) {
                        return Mono.just(false);
                    }
                    redisBacking.put(key, inv.getArgument(1));
                    return Mono.just(true);
                });
        when(template.delete(anyString()))
                .thenAnswer(inv -> {
                    String key = inv.getArgument(0);
                    deletedKeys.add(key);
                    return Mono.just(redisBacking.remove(key) != null ? 1L : 0L);
                });

        WebClient webClient = WebClient.builder().baseUrl(settings.getRpc().getEndpoint()).build();
        tonService = new TonService(
                webClient, settings, redisTemplate, objectMapper, new SimpleMeterRegistry());
        verifier = new StakingVerifier(tonService, settings, redisTemplate, objectMapper);
    }

    @AfterEach
    void tearDown() throws IOException {
        server.shutdown();
    }

    @Test
    @DisplayName("getVotingPower reads on-chain get_voting_power from StakingMaster")
    void votingPower() {
        installDispatcher(false);
        StepVerifier.create(verifier.getVotingPower(STAKER))
                .expectNext(new BigInteger("200"))
                .verifyComplete();
    }

    @Test
    @DisplayName("second getVotingPower hits Redis caches (tier cfg + Ton RPC)")
    void votingPowerCachedNoExtraHttp() {
        installDispatcher(false);
        StepVerifier.create(verifier.getVotingPower(STAKER))
                .expectNext(new BigInteger("200"))
                .verifyComplete();
        int afterFirst = server.getRequestCount();
        StepVerifier.create(verifier.getVotingPower(STAKER))
                .expectNext(new BigInteger("200"))
                .verifyComplete();
        assertThat(server.getRequestCount()).isEqualTo(afterFirst);
    }

    @Test
    @DisplayName("getStakes attaches pending rewards per tier")
    void getStakesIncludesPending() {
        installDispatcher(true);
        StepVerifier.create(verifier.getStakes(STAKER))
                .assertNext(list -> {
                    assertThat(list).hasSize(1);
                    assertThat(list.getFirst().tier()).isEqualTo(StakingTier.GOLD);
                    assertThat(list.getFirst().pendingRewards()).isEqualTo(new BigInteger("2"));
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("getHighestTier picks max ordinal tier")
    void highestTier() {
        installDispatcher(true);
        StepVerifier.create(verifier.getHighestTier(STAKER))
                .expectNextMatches(o -> o.isPresent() && o.get() == StakingTier.GOLD)
                .verifyComplete();
    }

    @Test
    @DisplayName("hasMinTier compares against highest tier")
    void hasMinTier() {
        installDispatcher(true);
        StepVerifier.create(verifier.hasMinTier(STAKER, StakingTier.SILVER))
                .expectNext(true)
                .verifyComplete();

        installDispatcher(true);
        StepVerifier.create(verifier.hasMinTier(STAKER, StakingTier.DIAMOND))
                .expectNext(false)
                .verifyComplete();
    }

    @Test
    @DisplayName("getPendingReward returns nano payout")
    void pendingRewards() {
        installDispatcher(true);
        StepVerifier.create(verifier.getPendingRewards(STAKER, StakingTier.GOLD))
                .expectNext(new BigInteger("2"))
                .verifyComplete();
    }

    @Test
    @DisplayName("nano fields serialize as decimal strings, not JSON numbers")
    void nanoFieldsSerializeAsDecimalStrings() throws Exception {
        var gold = new dev.burnedchats.ton.dto.StakeInfo(
                StakingTier.GOLD,
                new BigInteger("10000000000"),
                1L,
                2L,
                3L,
                new BigInteger("123456"));
        var profile = new dev.burnedchats.ton.dto.UserStakingProfile(
                STAKER,
                StakingTier.GOLD,
                new BigInteger("10000000000"),
                new BigInteger("20000000000"),
                List.of(gold),
                List.of(),
                Map.of(StakingTier.GOLD, new BigInteger("9999999999999")));

        JsonNode json = objectMapper.readTree(objectMapper.writeValueAsString(profile));
        assertThat(json.get("totalStakedNano").isTextual()).isTrue();
        assertThat(json.get("totalStakedNano").asText()).isEqualTo("10000000000");
        assertThat(json.get("votingPowerNano").isTextual()).isTrue();
        assertThat(json.get("stakes").get(0).get("amount").isTextual()).isTrue();
        assertThat(json.get("stakes").get(0).get("pendingRewards").asText()).isEqualTo("123456");
        assertThat(json.get("liveTierTvls").get("GOLD").isTextual()).isTrue();
        assertThat(json.get("liveTierTvls").get("GOLD").asText()).isEqualTo("9999999999999");
    }

    @Test
    @DisplayName("snapshot includes 4 full tier configs, 4 TVL, and mapped stakes")
    void snapshotIncludesFullTierConfigsAndTvls() {
        installDispatcher(true);
        StepVerifier.create(verifier.getStakingProfile(STAKER, false))
                .assertNext(p -> {
                    assertThat(p.stakes()).hasSize(1);
                    assertThat(p.stakes().getFirst().tier()).isEqualTo(StakingTier.GOLD);
                    assertThat(p.stakes().getFirst().amount()).isEqualTo(BigInteger.valueOf(100));
                    assertThat(p.stakes().getFirst().pendingRewards()).isEqualTo(BigInteger.valueOf(2));
                    assertThat(p.tierConfigs()).hasSize(4);
                    for (StakingTier t : StakingTier.values()) {
                        var cfg = p.tierConfigs().stream().filter(c -> c.tier() == t).findFirst().orElseThrow();
                        assertThat(cfg.lockDurationSec()).isEqualTo(LOCK_SEC[t.getId()]);
                        assertThat(cfg.multiplier()).isEqualTo(MULT_X100[t.getId()] / 100.0);
                        assertThat(cfg.rewardSharePercent()).isEqualTo(SHARE_PCT[t.getId()]);
                        assertThat(p.liveTierTvls().get(t)).isEqualTo(BigInteger.valueOf(TVL_NANO[t.getId()]));
                    }
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("catalog snapshot: empty stakes, address null, catalog filled")
    void catalogOnlyEmptyStakes() {
        installDispatcher(false);
        StepVerifier.create(verifier.getCatalogSnapshot())
                .assertNext(p -> {
                    assertThat(p.address()).isNull();
                    assertThat(p.stakes()).isEmpty();
                    assertThat(p.tierConfigs()).hasSize(4);
                    assertThat(p.liveTierTvls()).hasSize(4);
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("user RPC fail leaves existing catalog Redis untouched")
    void userRpcFailDoesNotOverwriteCatalog() {
        installDispatcher(false);
        StepVerifier.create(verifier.getCatalogSnapshot()).expectNextCount(1).verifyComplete();
        String tierKey = redisBacking.keySet().stream()
                .filter(k -> k.startsWith("ton:staking:tiercfg:v2:"))
                .findFirst()
                .orElseThrow();
        String catalogJson = redisBacking.get(tierKey);
        installFailingUserRpc();
        StepVerifier.create(verifier.getStakingProfile(STAKER, false))
                .expectErrorSatisfies(e -> assertThat(e).isInstanceOf(dev.burnedchats.ton.exception.TonRpcException.class))
                .verify();
        assertThat(redisBacking.get(tierKey)).isEqualTo(catalogJson);
    }

    @Test
    @DisplayName("user OK + TVL RPC fail: snapshot 200 with last TVL or omitted keys")
    void userOkTvlRpcFailOmitsTvlNot502() {
        installDispatcherOmitTvl();
        StepVerifier.create(verifier.getStakingProfile(STAKER, false))
                .assertNext(p -> {
                    assertThat(p.stakes()).hasSize(1);
                    assertThat(p.tierConfigs()).hasSize(4);
                    assertThat(p.liveTierTvls()).isEmpty();
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("fresh=1 DELs profile v2 + computed user get-keys, not catalog")
    void freshDeletesProfileAndUserRpcKeysNotCatalog() {
        installDispatcher(true);
        StepVerifier.create(verifier.getStakingProfile(STAKER, false)).expectNextCount(1).verifyComplete();
        String profileKey = "ton:staking:profile:v2:" + TonAddressBoc.normalizeKey(STAKER);
        assertThat(redisBacking).containsKey(profileKey);
        String tierKey = redisBacking.keySet().stream()
                .filter(k -> k.startsWith("ton:staking:tiercfg:v2:"))
                .findFirst()
                .orElseThrow();
        String tvlKey = "ton:staking:tvl:v2:" + TonAddressBoc.normalizeKey(STAKER);
        String lockKey = "ton:staking:lock:v1:" + TonAddressBoc.normalizeKey(STAKER);
        String catalogBefore = redisBacking.get(tierKey);
        deletedKeys.clear();

        StepVerifier.create(verifier.getStakingProfile(STAKER, true)).expectNextCount(1).verifyComplete();

        assertThat(deletedKeys).contains(profileKey);
        assertThat(deletedKeys).noneMatch(k -> k.equals(tierKey) || k.equals(tvlKey) || k.equals(lockKey));
        assertThat(deletedKeys).noneMatch(k -> k.contains("get_lock_config")
                || k.contains("get_master_total_stake")
                || k.contains("get_staking_lock"));
        assertThat(deletedKeys).anyMatch(k -> k.contains(":get_stake:"));
        assertThat(deletedKeys).anyMatch(k -> k.contains(":get_pending_reward:"));
        assertThat(deletedKeys).anyMatch(k -> k.contains(":get_voting_power:"));
        assertThat(redisBacking.get(tierKey)).isEqualTo(catalogBefore);
        assertThat(userRpcKeys()).allMatch(deletedKeys::contains);
    }

    @Test
    @DisplayName("repeat fresh=1 within 15s does not DEL again")
    void repeatFreshWithinWindowSkipsSecondDel() {
        installDispatcher(true);
        StepVerifier.create(verifier.getStakingProfile(STAKER, true)).expectNextCount(1).verifyComplete();
        String profileKey = "ton:staking:profile:v2:" + TonAddressBoc.normalizeKey(STAKER);
        deletedKeys.clear();
        StepVerifier.create(verifier.getStakingProfile(STAKER, true)).expectNextCount(1).verifyComplete();
        assertThat(deletedKeys).doesNotContain(profileKey);
        assertThat(deletedKeys).noneMatch(k -> k.contains(":get_stake:"));
    }

    @Test
    @DisplayName("legacy tiercfg:v1 and profile:v1 keys are ignored")
    void ignoresLegacyV1CacheKeys() {
        String nk = TonAddressBoc.normalizeKey(STAKER);
        redisBacking.put("ton:staking:profile:v1:" + nk, "{\"address\":\"stale\"}");
        redisBacking.put("ton:staking:tiercfg:v1:" + nk, "{\"0\":100}");
        installDispatcher(true);
        StepVerifier.create(verifier.getStakingProfile(STAKER, false))
                .assertNext(p -> {
                    assertThat(p.tierConfigs()).hasSize(4);
                    assertThat(p.stakes()).hasSize(1);
                    assertThat(redisBacking).containsKey("ton:staking:profile:v2:" + nk);
                    assertThat(redisBacking).containsKey("ton:staking:profile:v1:" + nk);
                })
                .verifyComplete();
    }

    /**
     * @param pendingForGold when {@code true}, GOLD tier pending rewards return {@code 2} nano (otherwise {@code 0}).
     */
    private void installDispatcher(boolean pendingForGold) {
        installDispatcher(pendingForGold, false, false);
    }

    private void installFailingUserRpc() {
        installDispatcher(true, true, false);
    }

    private void installDispatcherOmitTvl() {
        installDispatcher(true, false, true);
    }

    private void installDispatcher(boolean pendingForGold, boolean failUserRpc, boolean failTvl) {
        String lockBoc = TonAddressBoc.addressCellToBocBase64("0:" + "dd".repeat(32));
        final String stakingLockResp;
        try {
            stakingLockResp = stakingLockResponseJson(lockBoc);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }

        server.setDispatcher(new Dispatcher() {
            @Override
            public MockResponse dispatch(RecordedRequest request) {
                String path = request.getPath();
                if (path == null || !path.contains("runGetMethod")) {
                    return new MockResponse().setResponseCode(404);
                }
                try {
                    JsonNode root = objectMapper.readTree(request.getBody().readUtf8());
                    String methodNode = root.get("method").asText();

                    if (failUserRpc && ("get_stake".equals(methodNode) || "get_voting_power".equals(methodNode))) {
                        return new MockResponse().setResponseCode(500).setBody("user rpc down");
                    }
                    if (failTvl && "get_master_total_stake".equals(methodNode)) {
                        return new MockResponse().setResponseCode(500).setBody("tvl down");
                    }
                    return switch (methodNode) {
                        case "get_staking_lock" -> json(stakingLockResp);
                        case "get_voting_power" -> json(
                                "{\"ok\":true,\"result\":{\"exit_code\":0,\"stack\":[[\"num\",\"0xC8\"]]}}");
                        case "get_lock_config" -> json(lockConfigBody(singleStackUint(root)));
                        case "get_master_total_stake" -> json(tvlBody(singleStackUint(root)));
                        case "get_stake" -> json(stakeBodyForTier(secondStackUint(root)));
                        case "get_pending_reward" -> json(pendingBody(secondStackUint(root), pendingForGold));
                        default -> new MockResponse().setResponseCode(501).setBody("unexpected method: " + methodNode);
                    };
                } catch (IOException e) {
                    return new MockResponse().setResponseCode(500).setBody(e.getMessage());
                }
            }
        });
    }

    private String stakingLockResponseJson(String lockBocBase64) throws JsonProcessingException {
        ObjectNode root = objectMapper.createObjectNode();
        root.put("ok", true);
        ObjectNode result = objectMapper.createObjectNode();
        result.put("exit_code", 0);
        ArrayNode stack = objectMapper.createArrayNode();
        ArrayNode slicePair = objectMapper.createArrayNode();
        slicePair.add("tvm.Slice");
        slicePair.add(lockBocBase64);
        stack.add(slicePair);
        result.set("stack", stack);
        root.set("result", result);
        return objectMapper.writeValueAsString(root);
    }

    private static MockResponse json(String body) {
        return new MockResponse().setBody(body).addHeader("Content-Type", "application/json");
    }

    private static int singleStackUint(JsonNode root) {
        JsonNode stack = root.get("stack");
        return parseNumCell(stack.get(0)).intValueExact();
    }

    private static int secondStackUint(JsonNode root) {
        JsonNode stack = root.get("stack");
        return parseNumCell(stack.get(1)).intValueExact();
    }

    private static BigInteger parseNumCell(JsonNode pair) {
        String raw = pair.get(1).asText("").trim();
        if (raw.startsWith("0x") || raw.startsWith("0X")) {
            return new BigInteger(raw.substring(2), 16);
        }
        return new BigInteger(raw);
    }

    private static String lockConfigBody(int tier) {
        long lock = LOCK_SEC[tier];
        int mult = MULT_X100[tier];
        int share = SHARE_PCT[tier];
        return """
                {"ok":true,"result":{"exit_code":0,"stack":[
                  ["num","0x%x"],["num","0x%x"],["num","0x%x"]
                ]}}
                """.formatted(lock, mult, share).replaceAll("\\s+", "");
    }

    private static String tvlBody(int tier) {
        return """
                {"ok":true,"result":{"exit_code":0,"stack":[["num","0x%x"]]}}
                """.formatted(TVL_NANO[tier]).replaceAll("\\s+", "");
    }

    private List<String> userRpcKeys() {
        String master = STAKER;
        List<String> keys = new ArrayList<>();
        keys.add(tonService.cacheKey(master, "get_voting_power", List.of(TonAddressBoc.sliceStackArg(STAKER))));
        for (StakingTier t : StakingTier.values()) {
            List<Object> args = List.of(TonAddressBoc.sliceStackArg(STAKER), TonAddressBoc.numStackArg(t.getId()));
            keys.add(tonService.cacheKey(master, "get_stake", args));
            keys.add(tonService.cacheKey(master, "get_pending_reward", args));
        }
        return keys;
    }

    private static String stakeBodyForTier(int tier) {
        if (tier == StakingTier.GOLD.getId()) {
            return stakeBody(100, tier, 1, 10, 200);
        }
        return emptyStakeBody(tier);
    }

    private static String pendingBody(int tier, boolean pendingForGold) {
        if (pendingForGold && tier == StakingTier.GOLD.getId()) {
            return "{\"ok\":true,\"result\":{\"exit_code\":0,\"stack\":[[\"num\",\"0x2\"]]}}";
        }
        return "{\"ok\":true,\"result\":{\"exit_code\":0,\"stack\":[[\"num\",\"0x0\"]]}}";
    }

    private static String emptyStakeBody(int tier) {
        return """
                {"ok":true,"result":{"exit_code":0,"stack":[
                  ["num","0x0"],["num","0x%x"],["num","0x0"],["num","0x0"],["num","0x0"]
                ]}}
                """.formatted(tier).replaceAll("\\s+", "");
    }

    private static String stakeBody(int amount, int tier, int start, int lastClaim, int unlock) {
        return """
                {"ok":true,"result":{"exit_code":0,"stack":[
                  ["num","0x%x"],["num","0x%x"],["num","0x%x"],["num","0x%x"],["num","0x%x"]
                ]}}
                """.formatted(amount, tier, start, lastClaim, unlock).replaceAll("\\s+", "");
    }
}
