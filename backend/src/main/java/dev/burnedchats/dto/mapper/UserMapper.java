package dev.burnedchats.dto.mapper;

import dev.burnedchats.dto.response.UserResponse;
import dev.burnedchats.model.TelegramUser;
import dev.burnedchats.model.UnifiedUser;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.Named;

/**
 * MapStruct mapper for user profile to UserResponse conversion.
 */
@Mapper(componentModel = "spring")
public interface UserMapper {

    /**
     * Convert TelegramUser model to UserResponse DTO.
     *
     * @param user the Telegram user model
     * @return user response DTO
     */
    @Mapping(target = "internalId", ignore = true)
    @Mapping(target = "displayName", source = "user", qualifiedByName = "toDisplayName")
    @Mapping(target = "premium", source = "premium")
    @Mapping(target = "online", constant = "false")
    UserResponse toResponse(TelegramUser user);

    /**
     * Convert TelegramUser to UserResponse with online status.
     *
     * @param user   the Telegram user model
     * @param online whether user is currently online
     * @return user response DTO
     */
    @Mapping(target = "internalId", ignore = true)
    @Mapping(target = "displayName", source = "user", qualifiedByName = "toDisplayName")
    @Mapping(target = "premium", source = "user.premium")
    @Mapping(target = "online", source = "online")
    UserResponse toResponse(TelegramUser user, boolean online);

    /**
     * Convert TelegramUser to UserResponse with online status and internal id.
     */
    default UserResponse toResponse(TelegramUser user, boolean online, String internalId) {
        UserResponse response = toResponse(user, online);
        response.setInternalId(internalId);
        return response;
    }

    /**
     * Convert UnifiedUser identity profile to UserResponse.
     */
    @Mapping(target = "id", source = "user.telegramId")
    @Mapping(target = "username", ignore = true)
    @Mapping(target = "displayName", source = "user.displayName")
    @Mapping(target = "photoUrl", source = "user.avatarUrl")
    @Mapping(target = "premium", constant = "false")
    @Mapping(target = "internalId", source = "user.internalId")
    @Mapping(target = "online", source = "online")
    UserResponse toResponse(UnifiedUser user, boolean online);

    /**
     * Custom mapping for display name.
     */
    @Named("toDisplayName")
    default String toDisplayName(TelegramUser user) {
        if (user == null) {
            return null;
        }
        return user.getDisplayName();
    }
}
