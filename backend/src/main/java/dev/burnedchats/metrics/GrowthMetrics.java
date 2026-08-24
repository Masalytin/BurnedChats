package dev.burnedchats.metrics;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Anonymous product counters (no user / internalId tags). Use Prometheus {@code increase()}.
 */
@Component
public class GrowthMetrics {

    public static final String ROOMS_CREATED = "rooms_created";
    public static final String SESSIONS_CREATED = "sessions_created";
    public static final String DM_INVITES_REDEEMED = "dm_invites_redeemed";
    public static final String BOT_NOTIFY_SENT = "bot_notify_sent";
    public static final String TAG_TYPE = "type";

    private final Counter roomsCreated;
    private final Counter sessionsCreated;
    private final Counter dmInvitesRedeemed;
    private final MeterRegistry registry;
    private final Map<String, Counter> botNotifyByType = new ConcurrentHashMap<>();

    public GrowthMetrics(MeterRegistry registry) {
        this.registry = registry;
        this.roomsCreated = Counter.builder(ROOMS_CREATED)
                .description("Rooms created")
                .register(registry);
        this.sessionsCreated = Counter.builder(SESSIONS_CREATED)
                .description("DM sessions created")
                .register(registry);
        this.dmInvitesRedeemed = Counter.builder(DM_INVITES_REDEEMED)
                .description("Personal DM invites redeemed")
                .register(registry);
    }

    public void incrementRoomsCreated() {
        roomsCreated.increment();
    }

    public void incrementSessionsCreated() {
        sessionsCreated.increment();
    }

    public void incrementDmInvitesRedeemed() {
        dmInvitesRedeemed.increment();
    }

    public void incrementBotNotifySent(String type) {
        if (type == null || type.isBlank()) {
            return;
        }
        botNotifyByType.computeIfAbsent(type, t -> Counter.builder(BOT_NOTIFY_SENT)
                        .description("Telegram bot notifications sent")
                        .tag(TAG_TYPE, t)
                        .register(registry))
                .increment();
    }
}
