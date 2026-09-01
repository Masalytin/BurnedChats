package dev.burnedchats.ton;

import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;

import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.IntSupplier;

/**
 * Non-blocking outbound permit. Waiters park on a {@link Sinks.One}; never
 * {@link java.util.concurrent.Semaphore#acquire()} on the event loop.
 */
final class OutboundGate {

    private final IntSupplier maxPermits;
    private final AtomicInteger inUse = new AtomicInteger(0);
    private final ConcurrentLinkedQueue<Sinks.One<Void>> waiters = new ConcurrentLinkedQueue<>();

    OutboundGate(IntSupplier maxPermits) {
        this.maxPermits = maxPermits;
    }

    Mono<Void> acquire() {
        return Mono.defer(() -> {
            if (tryAcquire()) {
                return Mono.empty();
            }
            Sinks.One<Void> waiter = Sinks.one();
            waiters.offer(waiter);
            if (tryAcquire()) {
                if (waiters.remove(waiter)) {
                    return Mono.empty();
                }
                release();
                return waiter.asMono();
            }
            return waiter.asMono().doOnCancel(() -> waiters.remove(waiter));
        });
    }

    void release() {
        Sinks.One<Void> waiter = waiters.poll();
        if (waiter == null) {
            inUse.updateAndGet(used -> Math.max(0, used - 1));
            return;
        }
        Sinks.EmitResult result = waiter.tryEmitEmpty();
        if (result.isFailure()) {
            release();
        }
    }

    private boolean tryAcquire() {
        int cap = Math.max(1, maxPermits.getAsInt());
        while (true) {
            int used = inUse.get();
            if (used >= cap) {
                return false;
            }
            if (inUse.compareAndSet(used, used + 1)) {
                return true;
            }
        }
    }
}
