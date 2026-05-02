package dev.burnedchats.metrics;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Micrometer metrics for {@code burnedchats.offline_queue.*} and last-known
 * list sizes to approximate {@code expired_messages} when a Redis key times out
 * (see {@link #removeTrackedListSize} on keyspace).
 */
@Component
public class OfflineQueueMetrics {

    public static final String METRIC_ENQUEUED = "burnedchats.offline_queue.enqueued";
    public static final String METRIC_DROPPED = "burnedchats.offline_queue.dropped_overflow";
    public static final String METRIC_DELIVERED = "burnedchats.offline_queue.delivered";
    public static final String METRIC_EXPIRED = "burnedchats.offline_queue.expired_messages";
    public static final String TAG_SESSION_TYPE = "session_type";
    public static final String METRIC_SIZE = "burnedchats.offline_queue.size";
    public static final String TAG_TOTAL = "sum_scope";

    private static final String SUM_DM = "dm_lists";
    private static final String SUM_ROOM = "room_lists";

    private final Map<String, Long> listSizes = new ConcurrentHashMap<>();

    private final Counter enqueuedDm;
    private final Counter enqueuedRoom;
    private final Counter droppedDm;
    private final Counter droppedRoom;
    private final Counter deliveredDm;
    private final Counter deliveredRoom;
    private final Counter deliveredDmEdit;
    private final Counter deliveredDmDeletion;
    private final Counter expiredMessagesDm;
    private final Counter expiredMessagesRoom;
    private final AtomicLong sizeGaugeDm = new AtomicLong(0L);
    private final AtomicLong sizeGaugeRoom = new AtomicLong(0L);

    public OfflineQueueMetrics(MeterRegistry registry) {
        this.enqueuedDm = Counter.builder(METRIC_ENQUEUED)
                .description("Off-line list enqueue operations (one per message written)")
                .tag(TAG_SESSION_TYPE, OfflineSessionType.dm.name())
                .register(registry);
        this.enqueuedRoom = Counter.builder(METRIC_ENQUEUED)
                .tag(TAG_SESSION_TYPE, OfflineSessionType.room.name())
                .register(registry);
        this.droppedDm = Counter.builder(METRIC_DROPPED)
                .description("Messages dropped due to per-session list cap (trim from head)")
                .tag(TAG_SESSION_TYPE, OfflineSessionType.dm.name())
                .register(registry);
        this.droppedRoom = Counter.builder(METRIC_DROPPED)
                .tag(TAG_SESSION_TYPE, OfflineSessionType.room.name())
                .register(registry);
        this.deliveredDm = Counter.builder(METRIC_DELIVERED)
                .description("Messages sent to client (sync/relayed delivery), then removed from list")
                .tag(TAG_SESSION_TYPE, OfflineSessionType.dm.name())
                .register(registry);
        this.deliveredRoom = Counter.builder(METRIC_DELIVERED)
                .tag(TAG_SESSION_TYPE, OfflineSessionType.room.name())
                .register(registry);
        this.deliveredDmEdit = Counter.builder(METRIC_DELIVERED)
                .description("DM tombstone edits delivered via sync and removed from Redis")
                .tag(TAG_SESSION_TYPE, OfflineSessionType.dm_edit.name())
                .register(registry);
        this.deliveredDmDeletion = Counter.builder(METRIC_DELIVERED)
                .description("DM tombstone deletions delivered via sync and removed from Redis")
                .tag(TAG_SESSION_TYPE, OfflineSessionType.dm_deletion.name())
                .register(registry);
        this.expiredMessagesDm = Counter.builder(METRIC_EXPIRED)
                .description("Messages lost to Redis key TTL, approximated from last known list size")
                .tag(TAG_SESSION_TYPE, OfflineSessionType.dm.name())
                .register(registry);
        this.expiredMessagesRoom = Counter.builder(METRIC_EXPIRED)
                .tag(TAG_SESSION_TYPE, OfflineSessionType.room.name())
                .register(registry);
        Gauge.builder(METRIC_SIZE, sizeGaugeDm, AtomicLong::get)
                .description("Sum of LLEN over all DM message list keys (periodic scan)")
                .tag(TAG_SESSION_TYPE, OfflineSessionType.dm.name())
                .tag(TAG_TOTAL, SUM_DM)
                .strongReference(true)
                .register(registry);
        Gauge.builder(METRIC_SIZE, sizeGaugeRoom, AtomicLong::get)
                .description("Sum of LLEN over all room message list keys (periodic scan)")
                .tag(TAG_SESSION_TYPE, OfflineSessionType.room.name())
                .tag(TAG_TOTAL, SUM_ROOM)
                .strongReference(true)
                .register(registry);
    }

    public void recordEnqueued(OfflineSessionType type) {
        (type == OfflineSessionType.dm ? enqueuedDm : enqueuedRoom).increment();
    }

    public void recordDroppedOverflow(OfflineSessionType type, long n) {
        if (n <= 0) {
            return;
        }
        (type == OfflineSessionType.dm ? droppedDm : droppedRoom).increment(n);
    }

    public void recordDelivered(OfflineSessionType type, long messageCount) {
        if (messageCount <= 0) {
            return;
        }
        switch (type) {
            case dm -> deliveredDm.increment(messageCount);
            case room -> deliveredRoom.increment(messageCount);
            case dm_edit -> deliveredDmEdit.increment(messageCount);
            case dm_deletion -> deliveredDmDeletion.increment(messageCount);
            default -> {
                throw new IllegalStateException("Unhandled offline session type: " + type);
            }
        }
    }

    public void setTrackedListSize(String redisListKey, long listSize) {
        if (redisListKey == null || !OfflineQueueKeyUtil.isMessageListKey(redisListKey)) {
            return;
        }
        listSizes.put(redisListKey, Math.max(0, listSize));
    }

    public void removeTrackedListKey(String redisListKey) {
        if (redisListKey == null) {
            return;
        }
        listSizes.remove(redisListKey);
    }

    /**
     * Called when a Redis list key for messages expires (keyspace) — uses last recorded size
     * to approximate lost messages. Misses if the process never wrote to that list.
     */
    public void onListKeyExpired(String redisListKey) {
        Long n = listSizes.remove(redisListKey);
        if (n == null || n <= 0) {
            return;
        }
        OfflineSessionType t = OfflineQueueKeyUtil.typeForListKeyOrNull(redisListKey);
        if (t == null) {
            return;
        }
        (t == OfflineSessionType.dm ? expiredMessagesDm : expiredMessagesRoom).increment(n);
    }

    public void updateScannedListSizes(long dmTotal, long roomTotal) {
        sizeGaugeDm.set(Math.max(0, dmTotal));
        sizeGaugeRoom.set(Math.max(0, roomTotal));
    }
}
