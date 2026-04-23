package dev.burnedchats.metrics;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

import java.time.Duration;

/**
 * Periodically sets {@link OfflineQueueMetrics} gauges: sum of {@code LLEN} over
 * DM and room message list keys (SCAN + per-key LLEN), low cardinality.
 */
@Component
public class OfflineQueueSizeSampler {

    private static final Logger log = LoggerFactory.getLogger(OfflineQueueSizeSampler.class);
    private static final ScanOptions SCAN_OPTIONS = ScanOptions.scanOptions()
            .match("messages:*")
            .count(500)
            .build();

    private final ReactiveRedisTemplate<String, String> redisTemplate;
    private final OfflineQueueMetrics metrics;

    public OfflineQueueSizeSampler(
            ReactiveRedisTemplate<String, String> redisTemplate,
            OfflineQueueMetrics metrics) {
        this.redisTemplate = redisTemplate;
        this.metrics = metrics;
    }

    @Scheduled(fixedRateString = "${burnedchats.metrics.offline-queue.scan-interval-ms:60000}")
    public void rescanTotalSizes() {
        redisTemplate.scan(SCAN_OPTIONS)
                .filter(key -> {
                    if (key.startsWith("messages:count:")) {
                        return false;
                    }
                    return OfflineQueueKeyUtil.isUserMessageListKey(key)
                            || OfflineQueueKeyUtil.isRoomMessageListKey(key);
                })
                .concatMap(key -> redisTemplate.opsForList()
                        .size(key)
                        .map(size -> {
                            if (size == null || size < 0) {
                                return 0L;
                            }
                            return size;
                        })
                        .defaultIfEmpty(0L)
                        .map(sz -> {
                            if (OfflineQueueKeyUtil.isUserMessageListKey(key)) {
                                return new long[] { sz, 0L };
                            }
                            return new long[] { 0L, sz };
                        }))
                .reduce(
                        new long[] { 0L, 0L },
                        (a, b) -> new long[] { a[0] + b[0], a[1] + b[1] }
                )
                .doOnNext(totals -> metrics.updateScannedListSizes(totals[0], totals[1]))
                .onErrorResume(e -> {
                    log.debug("Offline queue size scan failed: {}", e.getMessage());
                    return Mono.empty();
                })
                .block(Duration.ofSeconds(30));
    }
}
