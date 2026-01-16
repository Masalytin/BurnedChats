package dev.burnedchats.dto.mapper;

import dev.burnedchats.dto.response.UserResponse;
import dev.burnedchats.model.TelegramUser;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.Named;

/**
 * MapStruct mapper for TelegramUser to UserResponse conversion.
 *
 * <p>This mapper demonstrates MapStruct usage with custom mappings.
 * Spring will automatically create an implementation bean.
 *
 * <p>Example usage:
 * <pre>{@code
 * @Autowired
 * private UserMapper userMapper;
 *
 * public UserResponse getUser(TelegramUser user) {
 *     return userMapper.toResponse(user);
 * }
 * }</pre>
 */
@Mapper(componentModel = "spring")
public interface UserMapper {

    /**
     * Convert TelegramUser model to UserResponse DTO.
     *
     * @param user the Telegram user model
     * @return user response DTO
     */
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
    @Mapping(target = "displayName", source = "user", qualifiedByName = "toDisplayName")
    @Mapping(target = "premium", source = "user.premium")
    @Mapping(target = "online", source = "online")
    UserResponse toResponse(TelegramUser user, boolean online);

    /**
     * Custom mapping for display name.
     *
     * @param user the Telegram user
     * @return formatted display name
     */
    @Named("toDisplayName")
    default String toDisplayName(TelegramUser user) {
        if (user == null) {
            return null;
        }
        return user.getDisplayName();
    }
}

