package dev.burnedchats.ton;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.burnedchats.ton.TonConfig.TonSettings;
import dev.burnedchats.ton.dto.EffectiveFeeParams;
import dev.burnedchats.ton.dto.JettonInfo;
import dev.burnedchats.ton.dto.UserBalance;
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
import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.Duration;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@DisplayName("JettonService")
class JettonServiceTest {

    private static final String ANY_USER =
            "EQBo3W19O92qLjdoYbERATFtQUh1Qp_NZJ6JU_lXyLnGUJT_";
    private static final String WALLET_RAW =
            "0:" + "aa".repeat(32);

    private static final String REFERENCE_ADDRESS_BOC_HEX =
            "b5ee9c72410101010024000043800d1badafa77bb545c6ed0c362220262da8290ea853f9ac93d12a7f2af91738ca100e36f05e";

    private MockWebServer server;
    private JettonService jettonService;
    private ReactiveRedisTemplate<String, String> redisTemplate;
    private ReactiveValueOperations<String, String> valueOps;
    private ObjectMapper objectMapper;
    private TonSettings settings;

    @BeforeEach
    void setUp() throws IOException {
        server = new MockWebServer();
        server.start();

        objectMapper = new ObjectMapper();
        settings = new TonSettings();
        settings.getRpc().setEndpoint(server.url("/api/v2").toString().replaceAll("/$", ""));
        settings.getRpc().setRetryAttempts(3);
        settings.getRpc().setTimeoutMs(5000);
        settings.getCache().setTtlSeconds(30);
        settings.getAddresses().setJettonMaster(ANY_USER);

        @SuppressWarnings("unchecked")
        ReactiveRedisTemplate<String, String> template = mock(ReactiveRedisTemplate.class);
        redisTemplate = template;
        valueOps = mock(ReactiveValueOperations.class);
        when(template.opsForValue()).thenReturn(valueOps);
        when(valueOps.set(anyString(), anyString(), any(Duration.class))).thenReturn(Mono.just(true));

        WebClient webClient = WebClient.builder().baseUrl(settings.getRpc().getEndpoint()).build();
        TonService tonService = new TonService(
                webClient, settings, redisTemplate, objectMapper, new SimpleMeterRegistry());
        jettonService = new JettonService(tonService, settings, redisTemplate, objectMapper);
    }

    @AfterEach
    void tearDown() throws IOException {
        server.shutdown();
    }

    @Test
    @DisplayName("TonAddressBoC matches @ton/core reference")
    void addressBocMatchesCore() {
        byte[] expected = HexFormat.of().parseHex(REFERENCE_ADDRESS_BOC_HEX);
        byte[] actual = java.util.Base64.getDecoder().decode(TonAddressBoc.addressCellToBocBase64(ANY_USER));
        assertThat(actual).isEqualTo(expected);
        assertThat(TonAddressBoc.decodeRawAddressFromSingleRootBoc(TonAddressBoc.addressCellToBocBase64(WALLET_RAW)))
                .isEqualTo(WALLET_RAW);
    }

    @Test
    @DisplayName("getBurnBalance parses wallet balance from RPC stack")
    void getBurnBalanceParsing() {
        when(valueOps.get(anyString())).thenReturn(Mono.empty());

        String walletBoc = TonAddressBoc.addressCellToBocBase64(WALLET_RAW);
        String walletAddrResp = """
                {"ok":true,"result":{"exit_code":0,"stack":[["tvm.Slice","%s"]]} }
                """.formatted(walletBoc).replaceAll("\\s+", "");
        String walletDataResp = """
                {"ok":true,"result":{"exit_code":0,"stack":[["num","0x3b9aca00"]]}}
                """;

        server.enqueue(new MockResponse().setBody(walletAddrResp).addHeader("Content-Type", "application/json"));
        server.enqueue(new MockResponse().setBody(walletDataResp).addHeader("Content-Type", "application/json"));

        StepVerifier.create(jettonService.getBurnBalance(ANY_USER))
                .expectNext(new BigInteger("1000000000"))
                .verifyComplete();
    }

    @Test
    @DisplayName("getBurnBalanceFormatted divides by 1e9")
    void getBurnBalanceFormatted() {
        when(valueOps.get(anyString())).thenReturn(Mono.empty());

        String walletBoc = TonAddressBoc.addressCellToBocBase64(WALLET_RAW);
        String walletAddrResp = """
                {"ok":true,"result":{"exit_code":0,"stack":[["tvm.Slice","%s"]]} }
                """.formatted(walletBoc).replaceAll("\\s+", "");
        String walletDataResp = """
                {"ok":true,"result":{"exit_code":0,"stack":[["num","0x3b9aca00"]]}}
                """;

        server.enqueue(new MockResponse().setBody(walletAddrResp).addHeader("Content-Type", "application/json"));
        server.enqueue(new MockResponse().setBody(walletDataResp).addHeader("Content-Type", "application/json"));

        StepVerifier.create(jettonService.getBurnBalanceFormatted(ANY_USER))
                .expectNext(new BigDecimal("1.000000000"))
                .verifyComplete();
    }

    @Test
    @DisplayName("getJettonInfo cache hit skips HTTP")
    void jettonInfoUsesApplicationCache() throws Exception {
        String adminBoc = TonAddressBoc.addressCellToBocBase64("0:" + "bb".repeat(32));
        String contentBoc = TonAddressBoc.addressCellToBocBase64("0:" + "cc".repeat(32));
        String codeBoc = TonAddressBoc.addressCellToBocBase64("0:" + "dd".repeat(32));
        String adminRaw = TonAddressBoc.decodeRawAddressFromSingleRootBoc(adminBoc);
        JettonInfo cached = new JettonInfo(BigInteger.TEN, false, adminRaw, codeBoc, "");

        AtomicInteger redisGets = new AtomicInteger();
        when(valueOps.get(anyString())).thenAnswer(inv -> {
            String key = inv.getArgument(0, String.class);
            if (key.contains("ton:jetton:info")) {
                if (redisGets.getAndIncrement() == 0) {
                    return Mono.empty();
                }
                return Mono.just(objectMapper.writeValueAsString(cached));
            }
            return Mono.empty();
        });

        String jettonData = """
                {"ok":true,"result":{"exit_code":0,"stack":[
                  ["num","0xa"],
                  ["num","0x0"],
                  ["tvm.Slice","%s"],
                  ["tvm.Slice","%s"],
                  ["tvm.Slice","%s"]
                ]}}
                """
                .formatted(adminBoc, contentBoc, codeBoc)
                .replaceAll("\\s+", "");

        server.enqueue(new MockResponse().setBody(jettonData).addHeader("Content-Type", "application/json"));

        StepVerifier.create(jettonService.getJettonInfo()).expectNextCount(1).verifyComplete();

        RecordedRequest only = server.takeRequest(5, TimeUnit.SECONDS);
        assertThat(only).isNotNull();

        StepVerifier.create(jettonService.getJettonInfo()).expectNextCount(1).verifyComplete();

        RecordedRequest miss = server.takeRequest(250, TimeUnit.MILLISECONDS);
        assertThat(miss).as("second getJettonInfo must not hit Ton Center").isNull();
    }

    @Test
    @DisplayName("getJettonInfo accepts TVM x-prefix mintable (prod get_jetton_data x1)")
    void jettonInfoParsesTvmXPrefixMintable() {
        when(valueOps.get(anyString())).thenReturn(Mono.empty());
        String adminBoc = TonAddressBoc.addressCellToBocBase64("0:" + "bb".repeat(32));
        String contentBoc = TonAddressBoc.addressCellToBocBase64("0:" + "cc".repeat(32));
        String codeBoc = TonAddressBoc.addressCellToBocBase64("0:" + "dd".repeat(32));
        String jettonData = """
                {"ok":true,"result":{"exit_code":0,"stack":[
                  ["num","0xa"],
                  ["num","x1"],
                  ["tvm.Slice","%s"],
                  ["tvm.Slice","%s"],
                  ["tvm.Slice","%s"]
                ]}}
                """
                .formatted(adminBoc, contentBoc, codeBoc)
                .replaceAll("\\s+", "");
        server.enqueue(new MockResponse().setBody(jettonData).addHeader("Content-Type", "application/json"));

        StepVerifier.create(jettonService.getJettonInfo())
                .assertNext(info -> {
                    assertThat(info.totalSupply()).isEqualTo(BigInteger.TEN);
                    assertThat(info.mintable()).isTrue();
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("getEffectiveFeeParams reads basis points from master")
    void effectiveFees() {
        when(valueOps.get(anyString())).thenReturn(Mono.empty());
        String body = """
                {"ok":true,"result":{"exit_code":0,"stack":[
                  ["num","0x1f4"],["num","0x258"],["num","0x2bc"]
                ]}}
                """.replaceAll("\\s+", "");
        server.enqueue(new MockResponse().setBody(body).addHeader("Content-Type", "application/json"));

        StepVerifier.create(jettonService.getEffectiveFeeParams())
                .expectNext(new EffectiveFeeParams(500, 600, 700))
                .verifyComplete();
    }

    @Test
    @DisplayName("getBurnBalances limits concurrency and maps UserBalance entries")
    void bulkBalances() {
        when(valueOps.get(anyString())).thenReturn(Mono.empty());

        String u1 = "0:" + "aa".repeat(32);
        String u2 = "0:" + "bb".repeat(32);
        String u3 = "0:" + "cc".repeat(32);

        String walletBoc = TonAddressBoc.addressCellToBocBase64(WALLET_RAW);
        String walletAddrTemplate = """
                {"ok":true,"result":{"exit_code":0,"stack":[["tvm.Slice","%s"]]} }
                """.formatted(walletBoc).replaceAll("\\s+", "");
        String walletData = """
                {"ok":true,"result":{"exit_code":0,"stack":[["num","0x2540be400"]]}}
                """;

        // Concurrent getBurnBalances interleaves get_wallet_address / get_wallet_data;
        // a FIFO queue then serves the wrong body. Route by method name instead.
        server.setDispatcher(new Dispatcher() {
            @Override
            public MockResponse dispatch(RecordedRequest request) {
                String body = request.getBody().readUtf8();
                if (body.contains("\"get_wallet_address\"")) {
                    return new MockResponse()
                            .setBody(walletAddrTemplate)
                            .addHeader("Content-Type", "application/json");
                }
                if (body.contains("\"get_wallet_data\"")) {
                    return new MockResponse()
                            .setBody(walletData)
                            .addHeader("Content-Type", "application/json");
                }
                return new MockResponse().setResponseCode(404);
            }
        });

        StepVerifier.create(jettonService.getBurnBalances(List.of(u1, u2, u3)).collectList())
                .assertNext(list -> {
                    assertThat(list).hasSize(3);
                    var nanos = list.stream().map(UserBalance::balanceNano).sorted().collect(Collectors.toList());
                    assertThat(nanos).containsExactly(
                            new BigInteger("10000000000"),
                            new BigInteger("10000000000"),
                            new BigInteger("10000000000"));
                    for (UserBalance ub : list) {
                        assertThat(ub.balanceFormatted()).isEqualByComparingTo(new BigDecimal("10.000000000"));
                    }
                })
                .verifyComplete();
    }
}
