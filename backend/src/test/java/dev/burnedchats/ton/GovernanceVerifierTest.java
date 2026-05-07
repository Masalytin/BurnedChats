package dev.burnedchats.ton;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.burnedchats.model.enums.ProposalState;
import dev.burnedchats.model.enums.ProposalType;
import dev.burnedchats.ton.TonConfig.TonSettings;
import dev.burnedchats.ton.dto.ProposalSummary;
import dev.burnedchats.ton.util.ProposalPayloadDecoder;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.data.redis.core.ReactiveValueOperations;
import org.springframework.web.reactive.function.client.WebClient;
import org.ton.ton4j.cell.CellBuilder;
import org.ton.ton4j.cell.Cell;
import org.ton.ton4j.utils.Utils;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.io.IOException;
import java.math.BigInteger;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("GovernanceVerifier")
class GovernanceVerifierTest {

    private static final String STAKER =
            "EQBo3W19O92qLjdoYbERATFtQUh1Qp_NZJ6JU_lXyLnGUJT_";

    private MockWebServer server;
    private GovernanceVerifier governanceVerifier;
    private ReactiveRedisTemplate<String, String> redisTemplate;
    private ReactiveValueOperations<String, String> valueOps;
    private ObjectMapper objectMapper;
    private TonSettings settings;
    private final ConcurrentHashMap<String, String> redisBacking = new ConcurrentHashMap<>();
    private String featurePriorityPayloadBase64;

    @Mock
    private StakingVerifier stakingVerifier;

    @BeforeEach
    void setUp() throws IOException {
        redisBacking.clear();
        Cell desc = CellBuilder.beginCell().storeString("Feature description line").endCell();
        Cell cid = CellBuilder.beginCell().storeString("bafyCID").endCell();
        Cell payload = CellBuilder.beginCell().storeRef(desc).storeRef(cid).endCell();
        featurePriorityPayloadBase64 = Utils.bytesToBase64(payload.toBoc(true));

        server = new MockWebServer();
        server.start();

        objectMapper = new ObjectMapper();
        settings = new TonSettings();
        settings.getRpc().setEndpoint(server.url("/api/v2").toString());
        settings.getRpc().setRetryAttempts(3);
        settings.getRpc().setTimeoutMs(5000);
        settings.getCache().setTtlSeconds(30);
        settings.getAddresses().setGovernor(STAKER);

        when(stakingVerifier.getVotingPower(anyString())).thenReturn(Mono.just(new BigInteger("42")));

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

        governanceVerifier = new GovernanceVerifier(tonService, settings, stakingVerifier, redisTemplate, objectMapper);
    }

    @AfterEach
    void tearDown() throws IOException {
        server.shutdown();
    }

    @Test
    @DisplayName("getProposal returns decoded FeaturePriority payload and summary")
    void getProposalDecodesPayload() {
        server.setDispatcher(newDispatcher(false));
        StepVerifier.create(governanceVerifier.getProposal(0))
                .assertNext(d -> {
                    assertThat(d.summary().id()).isZero();
                    assertThat(d.summary().type()).isEqualTo(ProposalType.FEATURE_PRIORITY);
                    assertThat(d.summary().state()).isEqualTo(ProposalState.ACTIVE);
                    assertThat(d.thresholdRequired()).isEqualTo(BigInteger.valueOf(5100));
                    assertThat(d.decodedPayload()).isInstanceOf(ProposalPayloadDecoder.FeaturePriorityPayload.class);
                    ProposalPayloadDecoder.FeaturePriorityPayload fp =
                            (ProposalPayloadDecoder.FeaturePriorityPayload) d.decodedPayload();
                    assertThat(fp.description()).contains("Feature description");
                    assertThat(fp.cid()).contains("bafyCID");
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("getActiveProposals returns only ACTIVE governor snapshots")
    void activeProposalsFiltered() {
        server.setDispatcher(newDispatcher(false));
        StepVerifier.create(governanceVerifier.getActiveProposals())
                .assertNext(s -> assertThat(s.id()).isZero())
                .verifyComplete();
    }

    @Test
    @DisplayName("getRecentProposals returns ids in descending order")
    void recentProposalsOrder() {
        server.setDispatcher(newDispatcher(false));
        StepVerifier.create(governanceVerifier.getRecentProposals(10).collectList())
                .assertNext(list -> assertThat(list).extracting(ProposalSummary::id).containsExactly(1L, 0L))
                .verifyComplete();
    }

    @Test
    @DisplayName("getUserVote empty when has_voted is false")
    void noVote() {
        server.setDispatcher(newDispatcher(false));
        StepVerifier.create(governanceVerifier.getUserVote(0, STAKER))
                .expectNext(Optional.empty())
                .verifyComplete();
    }

    @Test
    @DisplayName("getUserVote delegates VP when has_voted is true")
    void votedDelegatesVp() {
        server.setDispatcher(newDispatcher(true));
        StepVerifier.create(governanceVerifier.getUserVote(0, STAKER))
                .assertNext(opt -> assertThat(opt.orElseThrow().vp()).isEqualTo(new BigInteger("42")))
                .verifyComplete();
    }

    @Test
    @DisplayName("getUserVotingPower delegates to StakingVerifier")
    void votingPowerDelegate() {
        StepVerifier.create(governanceVerifier.getUserVotingPower(STAKER))
                .expectNext(new BigInteger("42"))
                .verifyComplete();
    }

    private Dispatcher newDispatcher(boolean hasVotedAlways) {
        return new Dispatcher() {
            @Override
            public MockResponse dispatch(RecordedRequest request) {
                try {
                    String path = request.getPath();
                    if (path == null || !path.contains("runGetMethod")) {
                        return new MockResponse().setResponseCode(404);
                    }
                    JsonNode body = objectMapper.readTree(request.getBody().readUtf8());
                    String method = extractMethod(body);
                    return switch (method) {
                        case "get_proposal_count" -> json(okExitNumStack(List.of(BigInteger.valueOf(2))));
                        case "get_proposal_state" -> proposalState(parseFirstUintArg(body));
                        case "get_proposal" -> json(okExitSliceStack(List.of(addrBoc(STAKER))));
                        case "has_voted" -> json(
                                okExitNumStack(List.of(hasVotedAlways ? BigInteger.ONE.negate() : BigInteger.ZERO)));
                        case "get_proposal_type" -> json(okExitNumStack(List.of(BigInteger.ONE)));
                        case "get_proposer" -> json(okExitSliceStack(List.of(addrBoc(STAKER))));
                        case "get_payload" -> json(okExitCellStack(List.of(featurePriorityPayloadBase64)));
                        case "get_start_time" -> json(okExitNumStack(List.of(BigInteger.valueOf(100))));
                        case "get_end_time" -> json(okExitNumStack(List.of(BigInteger.valueOf(200))));
                        case "get_state" -> json(okExitNumStack(List.of(BigInteger.ZERO)));
                        case "get_for_votes" -> json(okExitNumStack(List.of(BigInteger.TEN)));
                        case "get_against_votes" -> json(okExitNumStack(List.of(BigInteger.valueOf(2))));
                        case "get_quorum_required" -> json(okExitNumStack(List.of(BigInteger.valueOf(100))));
                        case "get_threshold_bps" -> json(okExitNumStack(List.of(BigInteger.valueOf(5100))));
                        default -> new MockResponse().setResponseCode(501).setBody("unexpected: " + method);
                    };
                } catch (IOException e) {
                    return new MockResponse().setResponseCode(500).setBody(e.getMessage());
                }
            }
        };
    }

    private static long parseFirstUintArg(JsonNode root) throws IOException {
        JsonNode stackIn = root.get("stack");
        if (stackIn == null || stackIn.size() < 1) {
            throw new IOException("missing stack args");
        }
        JsonNode pair = stackIn.get(0);
        String raw = pair.get(1).asText("");
        raw = raw.trim();
        BigInteger bi = raw.startsWith("0x") || raw.startsWith("0X")
                ? new BigInteger(raw.substring(2), 16)
                : new BigInteger(raw);
        return bi.longValueExact();
    }

    private static String extractMethod(JsonNode body) {
        JsonNode m = body.get("method");
        if (m == null) {
            return "";
        }
        if (m.isTextual()) {
            return m.asText();
        }
        if (m.isContainerNode() && m.has("value")) {
            return m.get("value").asText();
        }
        return m.asText();
    }

    private MockResponse proposalState(long id) {
        int state = id == 0 ? ProposalState.ACTIVE.code() : ProposalState.DEFEATED.code();
        return json(okExitNumStack(List.of(BigInteger.valueOf(state))));
    }

    private static String addrBoc(String friendly) {
        return TonAddressBoc.addressCellToBocBase64(friendly);
    }

    private static MockResponse json(String body) {
        return new MockResponse().setBody(body).addHeader("Content-Type", "application/json");
    }

    private static String okExitNumStack(List<BigInteger> nums) {
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"result\":{\"exit_code\":0,\"stack\":[");
        for (int i = 0; i < nums.size(); i++) {
            if (i > 0) {
                sb.append(',');
            }
            BigInteger n = nums.get(i);
            String v = n.signum() >= 0 ? "\"0x" + n.toString(16) + "\"" : "\"" + n + "\"";
            sb.append("[\"num\",").append(v).append(']');
        }
        sb.append("]}}");
        return sb.toString();
    }

    private static String okExitSliceStack(List<String> b64Cells) {
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"result\":{\"exit_code\":0,\"stack\":[");
        for (int i = 0; i < b64Cells.size(); i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append("[\"tvm.Slice\",\"").append(b64Cells.get(i)).append("\"]");
        }
        sb.append("]}}");
        return sb.toString();
    }

    private static String okExitCellStack(List<String> b64Cells) {
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"result\":{\"exit_code\":0,\"stack\":[");
        for (int i = 0; i < b64Cells.size(); i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append("[\"cell\",\"").append(b64Cells.get(i)).append("\"]");
        }
        sb.append("]}}");
        return sb.toString();
    }
}
