package dev.burnedchats.ton;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.netty.channel.ChannelOption;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.http.codec.json.Jackson2JsonDecoder;
import org.springframework.http.codec.json.Jackson2JsonEncoder;
import org.springframework.web.reactive.function.client.ExchangeStrategies;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;

import java.time.Duration;
import java.util.Objects;

/**
 * TON Center HTTP client and {@code app.ton} properties.
 */
@Configuration
@EnableConfigurationProperties(TonConfig.TonSettings.class)
public class TonConfig {

    /**
     * Properties under {@code app.ton}.
     */
    @ConfigurationProperties(prefix = "app.ton")
    public static class TonSettings {

        private Network network = Network.TESTNET;

        private final Rpc rpc = new Rpc();

        private final Cache cache = new Cache();

        private final Addresses addresses = new Addresses();

        public Network getNetwork() {
            return network;
        }

        public void setNetwork(Network network) {
            this.network = Objects.requireNonNull(network);
        }

        public Rpc getRpc() {
            return rpc;
        }

        public Cache getCache() {
            return cache;
        }

        public Addresses getAddresses() {
            return addresses;
        }

        /**
         * Target network; drives documentation and defaults, endpoint still explicit in config.
         */
        public enum Network {
            TESTNET,
            MAINNET
        }

        /**
         * RPC client options.
         */
        public static class Rpc {
            private String endpoint = "https://testnet.toncenter.com/api/v2";
            private String apiKey = "";
            private int timeoutMs = 5000;
            /**
             * Total HTTP attempts per logical call (first try plus retries on transient failures).
             */
            private int retryAttempts = 3;
            /**
             * Max concurrent outbound Ton Center HTTP calls per JVM (non-blocking permit).
             */
            private int maxInFlight = 5;

            public String getEndpoint() {
                return endpoint;
            }

            public void setEndpoint(String endpoint) {
                this.endpoint = endpoint;
            }

            public String getApiKey() {
                return apiKey;
            }

            public void setApiKey(String apiKey) {
                this.apiKey = apiKey != null ? apiKey : "";
            }

            public int getTimeoutMs() {
                return timeoutMs;
            }

            public void setTimeoutMs(int timeoutMs) {
                this.timeoutMs = timeoutMs;
            }

            public int getRetryAttempts() {
                return retryAttempts;
            }

            public void setRetryAttempts(int retryAttempts) {
                this.retryAttempts = retryAttempts;
            }

            public int getMaxInFlight() {
                return maxInFlight;
            }

            public void setMaxInFlight(int maxInFlight) {
                this.maxInFlight = maxInFlight;
            }
        }

        /**
         * Redis cache for stable RPC reads.
         */
        public static class Cache {
            private int ttlSeconds = 60;

            public int getTtlSeconds() {
                return ttlSeconds;
            }

            public void setTtlSeconds(int ttlSeconds) {
                this.ttlSeconds = ttlSeconds;
            }
        }

        /**
         * Well-known Burn token related contracts (addresses as Ton Center accepts them).
         */
        public static class Addresses {
            private String jettonMaster = "";
            private String stakingMaster = "";
            private String governor = "";
            private String treasury = "";

            public String getJettonMaster() {
                return jettonMaster;
            }

            public void setJettonMaster(String jettonMaster) {
                this.jettonMaster = jettonMaster;
            }

            public String getStakingMaster() {
                return stakingMaster;
            }

            public void setStakingMaster(String stakingMaster) {
                this.stakingMaster = stakingMaster;
            }

            public String getGovernor() {
                return governor;
            }

            public void setGovernor(String governor) {
                this.governor = governor;
            }

            public String getTreasury() {
                return treasury;
            }

            public void setTreasury(String treasury) {
                this.treasury = treasury;
            }
        }
    }

    @Bean(name = "tonWebClient")
    public WebClient tonWebClient(TonSettings settings, ObjectMapper objectMapper) {
        int timeoutMs = Math.max(1, settings.getRpc().getTimeoutMs());
        HttpClient httpClient = HttpClient.create()
                .responseTimeout(Duration.ofMillis(timeoutMs))
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, timeoutMs);

        ExchangeStrategies strategies = ExchangeStrategies.builder()
                .codecs(configurer -> {
                    configurer.defaultCodecs().jackson2JsonEncoder(new Jackson2JsonEncoder(objectMapper));
                    configurer.defaultCodecs().jackson2JsonDecoder(new Jackson2JsonDecoder(objectMapper));
                })
                .build();

        WebClient.Builder builder = WebClient.builder()
                .baseUrl(trimTrailingSlash(settings.getRpc().getEndpoint()))
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
                .exchangeStrategies(strategies);

        String apiKey = settings.getRpc().getApiKey();
        if (apiKey != null && !apiKey.isBlank()) {
            builder.defaultHeader("X-API-Key", apiKey);
        }

        return builder.build();
    }

    private static String trimTrailingSlash(String endpoint) {
        if (endpoint == null || endpoint.isEmpty()) {
            return "";
        }
        return endpoint.endsWith("/") ? endpoint.substring(0, endpoint.length() - 1) : endpoint;
    }
}
