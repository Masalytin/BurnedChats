package dev.burnedchats.config;

import dev.burnedchats.security.RateLimitInterceptor;
import dev.burnedchats.security.StompAuthInterceptor;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;
import org.springframework.web.socket.messaging.SessionSubscribeEvent;

/**
 * WebSocket configuration using STOMP protocol.
 *
 * <p>Sets up STOMP over WebSocket for real-time messaging
 * in the BurnedChats application with:
 * <ul>
 *   <li>Heartbeat configuration for connection health</li>
 *   <li>Channel interceptors for authentication (prepared for Sprint 2)</li>
 *   <li>Transport settings optimized for chat messages</li>
 *   <li>Session event logging for debugging</li>
 * </ul>
 */
@Configuration
@EnableWebSocketMessageBroker
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private static final Logger log = LoggerFactory.getLogger(WebSocketConfig.class);

    private final StompAuthInterceptor stompAuthInterceptor;
    private final RateLimitInterceptor rateLimitInterceptor;

    /**
     * Heartbeat interval from server to client (ms).
     * Default: 10 seconds.
     */
    @Value("${websocket.heartbeat.server:10000}")
    private long serverHeartbeat;

    /**
     * Expected heartbeat interval from client (ms).
     * Default: 10 seconds.
     */
    @Value("${websocket.heartbeat.client:10000}")
    private long clientHeartbeat;

    /**
     * Maximum message size in bytes.
     * Default: 64KB - sufficient for encrypted chat messages.
     */
    @Value("${websocket.message.max-size:65536}")
    private int maxMessageSize;

    /**
     * Send buffer size limit in bytes.
     * Default: 512KB.
     */
    @Value("${websocket.send.buffer-size:524288}")
    private int sendBufferSize;

    /**
     * Send timeout in milliseconds.
     * Default: 15 seconds.
     */
    @Value("${websocket.send.timeout:15000}")
    private int sendTimeout;

    /**
     * Configure the message broker for STOMP messaging.
     *
     * <p>Sets up:
     * <ul>
     *   <li>Simple in-memory broker for topic and queue destinations</li>
     *   <li>Application destination prefix for client messages</li>
     *   <li>User destination prefix for user-specific messages</li>
     *   <li>Heartbeat for connection health monitoring</li>
     * </ul>
     *
     * @param registry the message broker registry
     */
    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        // Create task scheduler for heartbeat
        ThreadPoolTaskScheduler taskScheduler = new ThreadPoolTaskScheduler();
        taskScheduler.setPoolSize(1);
        taskScheduler.setThreadNamePrefix("ws-heartbeat-");
        taskScheduler.initialize();

        // Enable simple in-memory broker for subscriptions
        // /topic - for broadcast messages (e.g., session events)
        // /queue - for point-to-point messages (e.g., user-specific notifications)
        registry.enableSimpleBroker("/topic", "/queue")
                .setHeartbeatValue(new long[]{serverHeartbeat, clientHeartbeat})
                .setTaskScheduler(taskScheduler);

        // Prefix for messages FROM clients TO server
        // Client sends to: /app/search, /app/session.create, /app/message.send, etc.
        registry.setApplicationDestinationPrefixes("/app");

        // Prefix for user-specific destinations
        // Server sends to: /user/{userId}/queue/notifications
        // Client subscribes to: /user/queue/notifications (resolved automatically)
        registry.setUserDestinationPrefix("/user");

        // Preserve publish order for message consistency
        registry.setPreservePublishOrder(true);

        log.info("Message broker configured with heartbeat: server={}ms, client={}ms",
                serverHeartbeat, clientHeartbeat);
    }

    /**
     * Register STOMP endpoints for WebSocket connections.
     *
     * <p>Clients connect to /ws endpoint with SockJS fallback support.
     * Allowed origins include Telegram Mini App domains and localhost for development.
     *
     * @param registry the STOMP endpoint registry
     */
    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        String[] allowedOrigins = {
            "https://*.telegram.org",
            "https://web.telegram.org",
            "https://burnedchats.net",
            "https://*.burnedchats.net",
            "http://localhost:*",
            "https://localhost:*"
        };

        // Primary WebSocket endpoint with SockJS fallback
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns(allowedOrigins)
                .withSockJS()
                .setClientLibraryUrl("https://cdn.jsdelivr.net/npm/sockjs-client@1/dist/sockjs.min.js")
                .setSessionCookieNeeded(false)
                .setHeartbeatTime(25000)  // SockJS heartbeat (25s)
                .setDisconnectDelay(5000);  // Delay before cleanup on disconnect

        // Raw WebSocket endpoint (without SockJS) for native WebSocket clients
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns(allowedOrigins);

        log.info("STOMP endpoints registered at /ws with SockJS fallback");
    }

    /**
     * Configure WebSocket transport settings.
     *
     * <p>Sets message size limits and timeouts appropriate for chat application.
     *
     * @param registry the transport registration
     */
    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registry) {
        registry.setMessageSizeLimit(maxMessageSize)        // Max incoming message size
                .setSendBufferSizeLimit(sendBufferSize)     // Send buffer limit
                .setSendTimeLimit(sendTimeout)              // Send timeout
                .setTimeToFirstMessage(30000);              // Time to first message after connect

        log.debug("WebSocket transport configured: maxMessageSize={}, sendBuffer={}, sendTimeout={}",
                maxMessageSize, sendBufferSize, sendTimeout);
    }

    /**
     * Configure inbound channel settings with authentication interceptor.
     *
     * <p>The {@link StompAuthInterceptor} validates Telegram initData
     * on STOMP CONNECT and sets up the user principal.
     *
     * @param registration the channel registration
     */
    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        // Thread pool for handling incoming messages
        registration.taskExecutor()
                .corePoolSize(4)
                .maxPoolSize(10)
                .queueCapacity(100);

        // Add authentication interceptor for validating Telegram initData
        // Add rate limiting interceptor (5.1.6)
        registration.interceptors(stompAuthInterceptor, rateLimitInterceptor);

        log.info("Inbound channel configured with StompAuthInterceptor and RateLimitInterceptor");
    }

    /**
     * Configure outbound channel settings.
     *
     * @param registration the channel registration
     */
    @Override
    public void configureClientOutboundChannel(ChannelRegistration registration) {
        registration.taskExecutor()
                .corePoolSize(4)
                .maxPoolSize(10);
    }

    // ==================== Session Event Listeners ====================
    // Note: Main event handling moved to WebSocketEventListener component
    // for business logic (online status, pending requests).
    // This listener only handles subscription debugging.

    /**
     * Handle subscription events for debugging.
     *
     * @param event the subscription event
     */
    @EventListener
    public void handleSubscription(SessionSubscribeEvent event) {
        String destination = (String) event.getMessage().getHeaders().get("simpDestination");
        String sessionId = (String) event.getMessage().getHeaders().get("simpSessionId");
        log.debug("Client subscribed: sessionId={}, destination={}", sessionId, destination);
    }
}


