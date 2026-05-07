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

    private MockWebServer server;
    private StakingVerifier verifier;
    private ReactiveRedisTemplate<String, String> redisTemplate;
    private ReactiveValueOperations<String, String> valueOps;
    private ObjectMapper objectMapper;
    private TonSettings settings;

    private final ConcurrentHashMap<String, String> redisBacking = new ConcurrentHashMap<>();

    @BeforeEach
    void setUp() throws IOException {
        redisBacking.clear();
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

        WebClient webClient = WebClient.builder().baseUrl(settings.getRpc().getEndpoint()).build();
        TonService tonService = new TonService(
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

    /**
     * @param pendingForGold when {@code true}, GOLD tier pending rewards return {@code 2} nano (otherwise {@code 0}).
     */
    private void installDispatcher(boolean pendingForGold) {
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

                    return switch (methodNode) {
                        case "get_staking_lock" -> json(stakingLockResp);
                        case "get_voting_power" -> json(
                                "{\"ok\":true,\"result\":{\"exit_code\":0,\"stack\":[[\"num\",\"0xC8\"]]}}");
                        case "get_lock_config" -> json(lockConfigBody(singleStackUint(root)));
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
        int mult = MULT_X100[tier];
        int share = SHARE_PCT[tier];
        return """
                {"ok":true,"result":{"exit_code":0,"stack":[
                  ["num","0x0"],["num","0x%x"],["num","0x%x"]
                ]}}
                """.formatted(mult, share).replaceAll("\\s+", "");
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
