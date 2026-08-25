package dev.burnedchats.service;

import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.telegram.BotMessageService;
import dev.burnedchats.telegram.BurnedChatsBot;
import dev.burnedchats.metrics.GrowthMetrics;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.time.Duration;

/**
 * Generic Telegram pings for rooms (no names, no message content). Coalesced 2 min per room.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RoomTelegramNotifyService {

    private static final Duration COALESCE = Duration.ofMinutes(2);
    private static final String COALESCE_PREFIX = "notify:room:";

    private final RoomMembersRepository roomMembersRepository;
    private final OnlineStatusRepository onlineStatusRepository;
    private final UserIdentityRepository userIdentityRepository;
    private final BurnedChatsBot telegramBot;
    private final BotMessageService botMessages;
    private final ReactiveRedisTemplate<String, String> redisTemplate;

    @Autowired(required = false)
    private GrowthMetrics growthMetrics;

    public Mono<Void> notifyOfflineMembers(String roomId, String senderInternalId) {
        if (roomId == null || roomId.isBlank()) {
            return Mono.empty();
        }
        String coalKey = COALESCE_PREFIX + roomId;
        return redisTemplate.opsForValue()
                .setIfAbsent(coalKey, "1", COALESCE)
                .flatMap(first -> {
                    if (!Boolean.TRUE.equals(first)) {
                        return Mono.empty();
                    }
                    return roomMembersRepository.getMembers(roomId)
                            .filter(id -> senderInternalId == null || !senderInternalId.equals(id))
                            .filterWhen(id -> onlineStatusRepository.isOnline(id)
                                    .map(online -> !Boolean.TRUE.equals(online)))
                            .flatMap(this::telegramIdOf)
                            .distinct()
                            .flatMap(tg -> sendRoomPing(tg, roomId))
                            .then();
                })
                .onErrorResume(e -> {
                    LOG.warn("Room telegram notify failed roomId={}: {}", roomId, e.getMessage());
                    return Mono.empty();
                });
    }

    public Mono<Void> notifyOwnerJoinRequest(String ownerInternalId, String roomId) {
        if (ownerInternalId == null || ownerInternalId.isBlank()) {
            return Mono.empty();
        }
        return onlineStatusRepository.isOnline(ownerInternalId)
                .flatMap(online -> {
                    if (Boolean.TRUE.equals(online)) {
                        return Mono.empty();
                    }
                    return telegramIdOf(ownerInternalId)
                            .flatMap(tg -> botMessages.getForUser("bot.notify.roomJoinRequest", tg)
                                    .map(text -> {
                                        telegramBot.sendNotificationWithButton(tg, text, "room_" + roomId);
                                        if (growthMetrics != null) {
                                            growthMetrics.incrementBotNotifySent("room_join_request");
                                        }
                                        return text;
                                    })
                                    .then());
                })
                .onErrorResume(e -> {
                    LOG.warn("Join-request telegram notify failed: {}", e.getMessage());
                    return Mono.empty();
                });
    }

    private Mono<Long> telegramIdOf(String internalId) {
        return userIdentityRepository.findById(internalId)
                .mapNotNull(UnifiedUser::telegramId)
                .filter(id -> id != null && id > 0);
    }

    private Mono<Void> sendRoomPing(Long telegramId, String roomId) {
        return botMessages.getForUser("bot.notify.roomMessage", telegramId)
                .doOnNext(text -> {
                    telegramBot.sendNotificationWithButton(telegramId, text, "room_" + roomId);
                    if (growthMetrics != null) {
                        growthMetrics.incrementBotNotifySent("room_message");
                    }
                })
                .then();
    }
}
