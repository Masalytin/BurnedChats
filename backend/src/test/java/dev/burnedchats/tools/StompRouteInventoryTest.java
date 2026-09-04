package dev.burnedchats.tools;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("StompRouteInventory")
class StompRouteInventoryTest {

    @Test
    @DisplayName("scans all inbound @MessageMapping routes")
    void scansAllInboundRoutes() {
        List<StompRouteInventory.InboundRoute> routes = StompRouteInventory.scan();

        assertThat(routes).hasSize(58);
    }

    @Test
    @DisplayName("every destination uses /app/ prefix")
    void destinationsUseAppPrefix() {
        List<StompRouteInventory.InboundRoute> routes = StompRouteInventory.scan();

        assertThat(routes)
                .extracting(StompRouteInventory.InboundRoute::destination)
                .allMatch(destination -> destination.startsWith("/app/"));
    }

    @Test
    @DisplayName("destinations are unique")
    void destinationsAreUnique() {
        List<StompRouteInventory.InboundRoute> routes = StompRouteInventory.scan();

        Set<String> destinations = routes.stream()
                .map(StompRouteInventory.InboundRoute::destination)
                .collect(Collectors.toSet());

        assertThat(destinations).hasSize(routes.size());
    }

    @Test
    @DisplayName("room.create maps to CreateRoomRequest on RoomHandler")
    void roomCreateSpotCheck() {
        List<StompRouteInventory.InboundRoute> routes = StompRouteInventory.scan();

        StompRouteInventory.InboundRoute roomCreate = routes.stream()
                .filter(route -> "/app/room.create".equals(route.destination()))
                .findFirst()
                .orElseThrow();

        assertThat(roomCreate.handler()).isEqualTo("dev.burnedchats.handler.RoomHandler");
        assertThat(roomCreate.method()).isEqualTo("createRoom");
        assertThat(roomCreate.requestType()).isEqualTo("dev.burnedchats.dto.request.CreateRoomRequest");
    }

    @Test
    @DisplayName("scan results are sorted by destination")
    void scanResultsSortedByDestination() {
        List<StompRouteInventory.InboundRoute> routes = StompRouteInventory.scan();

        assertThat(routes)
                .extracting(StompRouteInventory.InboundRoute::destination)
                .isSorted();
    }
}
