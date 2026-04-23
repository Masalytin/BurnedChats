package dev.burnedchats.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.ReactiveRedisConnectionFactory;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceClientConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.connection.lettuce.LettucePoolingClientConfiguration;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext;
import org.springframework.data.redis.serializer.StringRedisSerializer;

import io.lettuce.core.ClientOptions;
import io.lettuce.core.SocketOptions;
import io.lettuce.core.TimeoutOptions;
import io.lettuce.core.resource.ClientResources;
import io.lettuce.core.resource.DefaultClientResources;
import org.apache.commons.pool2.impl.GenericObjectPoolConfig;

import java.time.Duration;

/**
 * Redis configuration using Lettuce reactive client.
 *
 * <p>Provides both reactive and imperative Redis templates for flexibility:
 * <ul>
 *   <li>{@link ReactiveRedisTemplate} - for non-blocking operations</li>
 *   <li>{@link RedisTemplate} - for blocking operations when needed</li>
 * </ul>
 *
 * <p>Uses connection pooling for better performance under load.
 *
 * @see <a href="https://lettuce.io/">Lettuce Redis Client</a>
 */
@Configuration
public class RedisConfig {

    private static final Logger LOG = LoggerFactory.getLogger(RedisConfig.class);

    @Value("${spring.data.redis.host:localhost}")
    private String redisHost;

    @Value("${spring.data.redis.port:6379}")
    private int redisPort;

    @Value("${spring.data.redis.password:}")
    private String redisPassword;

    @Value("${spring.data.redis.database:0}")
    private int redisDatabase;

    @Value("${spring.data.redis.timeout:10s}")
    private Duration commandTimeout;

    @Value("${spring.data.redis.lettuce.pool.max-active:10}")
    private int maxActive;

    @Value("${spring.data.redis.lettuce.pool.max-idle:5}")
    private int maxIdle;

    @Value("${spring.data.redis.lettuce.pool.min-idle:1}")
    private int minIdle;

    /**
     * Create Lettuce client resources with default settings.
     *
     * <p>Client resources are shared across all connections for efficiency.
     *
     * @return configured client resources
     */
    @Bean(destroyMethod = "shutdown")
    public ClientResources clientResources() {
        return DefaultClientResources.builder()
                .ioThreadPoolSize(4)
                .computationThreadPoolSize(4)
                .build();
    }

    /**
     * Create Lettuce connection factory with pooling support.
     *
     * <p>Configures:
     * <ul>
     *   <li>Connection pooling via Apache Commons Pool2</li>
     *   <li>Socket timeouts for reliability</li>
     *   <li>Auto-reconnect on connection loss</li>
     * </ul>
     *
     * @param clientResources shared client resources
     * @return configured connection factory
     */
    @Bean
    public LettuceConnectionFactory lettuceConnectionFactory(ClientResources clientResources) {
        // Redis server configuration
        RedisStandaloneConfiguration serverConfig = new RedisStandaloneConfiguration();
        serverConfig.setHostName(redisHost);
        serverConfig.setPort(redisPort);
        serverConfig.setDatabase(redisDatabase);

        if (redisPassword != null && !redisPassword.isEmpty()) {
            serverConfig.setPassword(redisPassword);
        }

        // Connection pool configuration
        GenericObjectPoolConfig<Object> poolConfig = new GenericObjectPoolConfig<>();
        poolConfig.setMaxTotal(maxActive);
        poolConfig.setMaxIdle(maxIdle);
        poolConfig.setMinIdle(minIdle);
        poolConfig.setTestOnBorrow(true);
        poolConfig.setTestWhileIdle(true);
        poolConfig.setTimeBetweenEvictionRuns(Duration.ofSeconds(30));

        // Socket options for connection reliability
        SocketOptions socketOptions = SocketOptions.builder()
                .connectTimeout(Duration.ofSeconds(10))
                .keepAlive(true)
                .build();

        // Client options with auto-reconnect
        ClientOptions clientOptions = ClientOptions.builder()
                .socketOptions(socketOptions)
                .autoReconnect(true)
                .disconnectedBehavior(ClientOptions.DisconnectedBehavior.REJECT_COMMANDS)
                .timeoutOptions(TimeoutOptions.enabled(commandTimeout))
                .build();

        // Lettuce client configuration with pooling
        LettuceClientConfiguration clientConfig = LettucePoolingClientConfiguration.builder()
                .poolConfig(poolConfig)
                .clientResources(clientResources)
                .clientOptions(clientOptions)
                .commandTimeout(commandTimeout)
                .build();

        LettuceConnectionFactory factory = new LettuceConnectionFactory(serverConfig, clientConfig);
        factory.setShareNativeConnection(false);  // Don't share for reactive use

        LOG.info("Redis connection factory configured: host={}, port={}, database={}, pool.maxActive={}",
                redisHost, redisPort, redisDatabase, maxActive);

        return factory;
    }

    /**
     * Create reactive Redis template for non-blocking operations.
     *
     * <p>Uses String serializer for keys and JSON serializer for values.
     * This is the primary template for reactive Redis operations.
     *
     * @param connectionFactory the reactive connection factory
     * @return configured reactive Redis template
     */
    @Bean
    public ReactiveRedisTemplate<String, Object> reactiveRedisTemplate(
            ReactiveRedisConnectionFactory connectionFactory) {

        StringRedisSerializer keySerializer = new StringRedisSerializer();
        GenericJackson2JsonRedisSerializer valueSerializer = new GenericJackson2JsonRedisSerializer();

        RedisSerializationContext<String, Object> serializationContext =
                RedisSerializationContext.<String, Object>newSerializationContext(keySerializer)
                        .key(keySerializer)
                        .value(valueSerializer)
                        .hashKey(keySerializer)
                        .hashValue(valueSerializer)
                        .build();

        LOG.debug("Reactive Redis template created with JSON serialization");

        return new ReactiveRedisTemplate<>(connectionFactory, serializationContext);
    }

    /**
     * Create reactive Redis template specifically for String values.
     *
     * <p>Useful for simple key-value operations without JSON overhead.
     *
     * @param connectionFactory the reactive connection factory
     * @return configured reactive Redis template for strings
     */
    @Bean
    public ReactiveRedisTemplate<String, String> reactiveStringRedisTemplate(
            ReactiveRedisConnectionFactory connectionFactory) {

        StringRedisSerializer serializer = new StringRedisSerializer();

        RedisSerializationContext<String, String> serializationContext =
                RedisSerializationContext.<String, String>newSerializationContext(serializer)
                        .key(serializer)
                        .value(serializer)
                        .hashKey(serializer)
                        .hashValue(serializer)
                        .build();

        return new ReactiveRedisTemplate<>(connectionFactory, serializationContext);
    }

    /**
     * Create imperative Redis template for blocking operations.
     *
     * <p>Use this when reactive is not suitable (e.g., in synchronous contexts).
     *
     * @param connectionFactory the connection factory
     * @return configured Redis template
     */
    @Bean
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory connectionFactory) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(connectionFactory);

        // Use String serializer for keys
        StringRedisSerializer keySerializer = new StringRedisSerializer();
        template.setKeySerializer(keySerializer);
        template.setHashKeySerializer(keySerializer);

        // Use JSON serializer for values
        GenericJackson2JsonRedisSerializer valueSerializer = new GenericJackson2JsonRedisSerializer();
        template.setValueSerializer(valueSerializer);
        template.setHashValueSerializer(valueSerializer);

        template.setEnableTransactionSupport(false);
        template.afterPropertiesSet();

        LOG.debug("Imperative Redis template created with JSON serialization");

        return template;
    }
}

