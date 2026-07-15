package dev.burnedchats.ton;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.burnedchats.ton.TonConfig.TonSettings;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
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
import java.util.HexFormat;

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
        jettonService = new JettonService(tonService, settings, redisTemplate);
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
    @DisplayName("resolveJettonWallet returns wallet address from master get_wallet_address")
    void resolveJettonWalletHappyPath() {
        when(valueOps.get(anyString())).thenReturn(Mono.empty());

        String walletBoc = TonAddressBoc.addressCellToBocBase64(WALLET_RAW);
        String walletAddrResp = """
                {"ok":true,"result":{"exit_code":0,"stack":[["tvm.Slice","%s"]]} }
                """.formatted(walletBoc).replaceAll("\\s+", "");

        server.enqueue(new MockResponse().setBody(walletAddrResp).addHeader("Content-Type", "application/json"));

        StepVerifier.create(jettonService.resolveJettonWallet(ANY_USER))
                .expectNext(WALLET_RAW)
                .verifyComplete();
    }

    @Test
    @DisplayName("resolveJettonWallet empty when wallet address is zero")
    void resolveJettonWalletZeroAddress() {
        when(valueOps.get(anyString())).thenReturn(Mono.empty());

        String zeroWallet = "0:" + "00".repeat(32);
        String walletBoc = TonAddressBoc.addressCellToBocBase64(zeroWallet);
        String walletAddrResp = """
                {"ok":true,"result":{"exit_code":0,"stack":[["tvm.Slice","%s"]]} }
                """.formatted(walletBoc).replaceAll("\\s+", "");

        server.enqueue(new MockResponse().setBody(walletAddrResp).addHeader("Content-Type", "application/json"));

        StepVerifier.create(jettonService.resolveJettonWallet(ANY_USER))
                .verifyComplete();
    }
}
