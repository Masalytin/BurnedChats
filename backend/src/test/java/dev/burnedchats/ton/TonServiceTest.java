package dev.burnedchats.ton;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.burnedchats.ton.TonConfig.TonSettings;
import dev.burnedchats.ton.dto.TransactionDto;
import dev.burnedchats.ton.exception.TonContractException;
import dev.burnedchats.ton.exception.TonRpcException;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
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
import java.time.Duration;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link TonService} using {@link MockWebServer} and mocked Redis.
 */
@DisplayName("TonService")
class TonServiceTest {

    private MockWebServer server;
    private TonService tonService;
    private ReactiveRedisTemplate<String, String> redisTemplate;
    private ReactiveValueOperations<String, String> valueOps;
    private MeterRegistry meterRegistry;
    private ObjectMapper objectMapper;
    private TonSettings settings;

    @BeforeEach
    void setUp() throws IOException {
        server = new MockWebServer();
        server.start();

        objectMapper = new ObjectMapper();
        meterRegistry = new SimpleMeterRegistry();
        settings = new TonSettings();
        settings.getRpc().setEndpoint(server.url("/api/v2").toString().replaceAll("/$", ""));
        settings.getRpc().setApiKey("");
        settings.getRpc().setRetryAttempts(3);
        settings.getRpc().setTimeoutMs(5000);
        settings.getCache().setTtlSeconds(60);

        @SuppressWarnings("unchecked")
        ReactiveRedisTemplate<String, String> template = mock(ReactiveRedisTemplate.class);
        this.redisTemplate = template;
        valueOps = mock(ReactiveValueOperations.class);
        when(template.opsForValue()).thenReturn(valueOps);
        when(valueOps.set(anyString(), anyString(), any(Duration.class))).thenReturn(Mono.just(true));

        WebClient webClient = WebClient.builder().baseUrl(settings.getRpc().getEndpoint()).build();

        tonService = new TonService(webClient, settings, redisTemplate, objectMapper, meterRegistry);
    }

    @AfterEach
    void tearDown() throws IOException {
        server.shutdown();
    }

    @Test
    @DisplayName("runGetMethod returns jetton-style get-method result when exit_code is 0")
    void runGetMethodSuccess() {
        when(valueOps.get(anyString())).thenReturn(Mono.empty());

        String contract = "EQBo3W19O92qLjdoYbERATFtQUh1Qp_NZJ6JU_lXyLnGUJT_";
        String body = """
                {"ok":true,"result":{"gas_used":1234,"exit_code":0,"stack":[]}}
                """.trim();
        server.enqueue(new MockResponse().setBody(body).setHeader("Content-Type", "application/json"));

        StepVerifier.create(tonService.runGetMethod(contract, "get_jetton_data", List.of()))
                .expectNextMatches(node -> node.path("exit_code").asInt() == 0)
                .verifyComplete();

        Counter reqCounter = meterRegistry.find("burnedchats.ton.rpc.requests")
                .tag("operation", "runGetMethod")
                .counter();
        assertThat(reqCounter).isNotNull();
        assertThat(reqCounter.count()).isPositive();
    }

    @Test
    @DisplayName("runGetMethod maps non-zero exit_code to TonContractException")
    void runGetMethodContractError() {
        when(valueOps.get(anyString())).thenReturn(Mono.empty());

        String body = """
                {"ok":true,"result":{"gas_used":0,"exit_code":1,"stack":[]}}
                """.trim();
        server.enqueue(new MockResponse().setBody(body).setHeader("Content-Type", "application/json"));

        StepVerifier.create(tonService.runGetMethod("EQTest", "broken", List.of()))
                .expectError(TonContractException.class)
                .verify();
    }

    @Test
    @DisplayName("retries on HTTP 503 then succeeds")
    void retriesOn503() throws InterruptedException {
        when(valueOps.get(anyString())).thenReturn(Mono.empty());

        server.enqueue(new MockResponse().setResponseCode(503).setBody("busy"));
        String ok = """
                {"ok":true,"result":{"gas_used":0,"exit_code":0,"stack":[]}}
                """.trim();
        server.enqueue(new MockResponse().setBody(ok).setHeader("Content-Type", "application/json"));

        StepVerifier.create(tonService.runGetMethod("EQRetry", "get_jetton_data", List.of()))
                .expectNextCount(1)
                .verifyComplete();

        RecordedRequest first = server.takeRequest(2, TimeUnit.SECONDS);
        RecordedRequest second = server.takeRequest(2, TimeUnit.SECONDS);
        assertThat(first).isNotNull();
        assertThat(second).isNotNull();
        assertThat(first.getPath()).contains("runGetMethod");
        assertThat(second.getPath()).contains("runGetMethod");
    }

    @Test
    @DisplayName("getAccount cache hit skips HTTP call")
    void getAccountUsesCache() throws InterruptedException {
        String cached = """
                {"balance":"1000","state":1}
                """.trim();
        when(valueOps.get(anyString())).thenReturn(Mono.just(cached));

        StepVerifier.create(tonService.getAccount("EQCached"))
                .expectNextMatches(node -> "1000".equals(node.path("balance").asText()))
                .verifyComplete();

        RecordedRequest req = server.takeRequest(250, TimeUnit.MILLISECONDS);
        assertThat(req).as("no outbound HTTP when cache hit").isNull();

        Counter hitCounter = meterRegistry.find("burnedchats.ton.rpc.cache_hits")
                .tag("operation", "getAccount")
                .counter();
        assertThat(hitCounter).isNotNull();
        assertThat(hitCounter.count()).isPositive();
    }

    @Test
    @DisplayName("getTransactions maps result array to DTO flux")
    void getTransactionsFlux() {
        String raw = """
                {"ok":true,"result":[
                  {"@type":"ext.transaction","account":"0:abc","utime":1,
                   "transaction_id":{"lt":"2","hash":"dead"},
                   "address":{"account_address":"0:abc"}}
                ]}
                """.trim();
        server.enqueue(new MockResponse().setBody(raw).setHeader("Content-Type", "application/json"));

        StepVerifier.create(tonService.getTransactions("EQTx", 5).collectList())
                .assertNext(list -> {
                    assertThat(list).hasSize(1);
                    TransactionDto tx = list.get(0);
                    assertThat(tx.account()).isEqualTo("0:abc");
                    assertThat(tx.hash()).isEqualTo("dead");
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("increments Micrometer error counter on failed Ton response")
    void metricsOnError() {
        when(valueOps.get(anyString())).thenReturn(Mono.empty());

        server.enqueue(new MockResponse().setBody("{\"ok\":false,\"error\":\"nope\"}")
                .setHeader("Content-Type", "application/json"));

        StepVerifier.create(tonService.runGetMethod("EQErr", "x", List.of()))
                .expectError(TonRpcException.class)
                .verify();

        Counter errCounter = meterRegistry.find("burnedchats.ton.rpc.errors")
                .tag("operation", "runGetMethod")
                .counter();
        assertThat(errCounter).isNotNull();
        assertThat(errCounter.count()).isPositive();
    }
}
