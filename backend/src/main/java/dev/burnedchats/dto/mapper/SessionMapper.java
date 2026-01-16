package dev.burnedchats.dto.mapper;

import dev.burnedchats.dto.response.SessionResponse;
import dev.burnedchats.dto.response.UserResponse;
import dev.burnedchats.model.Session;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

/**
 * MapStruct mapper for Session to SessionResponse conversion.
 *
 * <p>This mapper handles the conversion of Session model to
 * client-facing SessionResponse DTO, including context-aware
 * mappings based on which user is requesting the data.
 */
@Mapper(componentModel = "spring")
public interface SessionMapper {

    /**
     * Convert Session to SessionResponse for a specific user.
     *
     * <p>The response is customized based on who is requesting:
     * - peer contains the other user's info
     * - verified/peerVerified are set relative to the requester
     *
     * @param session      the session model
     * @param peer         the peer user response
     * @param isInitiator  whether the requester is the initiator
     * @return session response DTO
     */
    @Mapping(target = "sessionId", source = "session.id")
    @Mapping(target = "status", source = "session.status")
    @Mapping(target = "peer", source = "peer")
    @Mapping(target = "verified", expression = "java(isInitiator ? session.isInitiatorVerified() : session.isResponderVerified())")
    @Mapping(target = "peerVerified", expression = "java(isInitiator ? session.isResponderVerified() : session.isInitiatorVerified())")
    @Mapping(target = "createdAt", source = "session.createdAt")
    @Mapping(target = "lastActivityAt", source = "session.lastActivityAt")
    SessionResponse toResponse(Session session, UserResponse peer, boolean isInitiator);

    /**
     * Simple conversion without peer info (for internal use).
     *
     * @param session the session model
     * @return session response DTO with null peer
     */
    @Mapping(target = "sessionId", source = "id")
    @Mapping(target = "peer", ignore = true)
    @Mapping(target = "verified", constant = "false")
    @Mapping(target = "peerVerified", constant = "false")
    SessionResponse toBasicResponse(Session session);
}



