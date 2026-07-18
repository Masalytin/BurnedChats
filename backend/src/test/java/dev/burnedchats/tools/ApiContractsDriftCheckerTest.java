package dev.burnedchats.tools;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("ApiContractsDriftChecker")
class ApiContractsDriftCheckerTest {

    @TempDir
    Path tempDir;

    @Test
    @DisplayName("OpenAPI drift: identical normalized content passes")
    void openApiIdenticalContentPasses() throws IOException {
        String yaml = """
                openapi: 3.0.1
                info:
                  title: Test
                paths:
                  /api/health:
                    get:
                      responses:
                        '200':
                          description: OK
                """;

        Path committed = tempDir.resolve("openapi.yaml");
        Files.writeString(committed, yaml);

        assertThat(ApiContractsDriftChecker.checkOpenApiDrift(committed, yaml)).isEmpty();
    }

    @Test
    @DisplayName("OpenAPI drift: changed paths fails")
    void openApiChangedContentFails() throws IOException {
        String committedYaml = """
                openapi: 3.0.1
                info:
                  title: Test
                paths:
                  /api/health:
                    get:
                      responses:
                        '200':
                          description: OK
                """;
        String freshYaml = """
                openapi: 3.0.1
                info:
                  title: Test
                paths:
                  /api/probe:
                    get:
                      responses:
                        '200':
                          description: OK
                """;

        Path committed = tempDir.resolve("openapi.yaml");
        Files.writeString(committed, committedYaml);

        assertThat(ApiContractsDriftChecker.checkOpenApiDrift(committed, freshYaml))
                .isPresent()
                .get()
                .asString()
                .contains("openapi.yaml");
    }

    @Test
    @DisplayName("STOMP drift: ignores generatedAt timestamp")
    void stompIgnoresGeneratedAt() throws IOException {
        String committed = """
                {
                  "version" : 1,
                  "generatedAt" : "2026-01-01T00:00:00Z",
                  "inbound" : [ {
                    "destination" : "/app/heartbeat",
                    "handler" : "dev.burnedchats.handler.HeartbeatHandler",
                    "method" : "heartbeat",
                    "requestType" : null
                  } ]
                }
                """;
        String fresh = """
                {
                  "version" : 1,
                  "generatedAt" : "2026-07-12T12:00:00Z",
                  "inbound" : [ {
                    "destination" : "/app/heartbeat",
                    "handler" : "dev.burnedchats.handler.HeartbeatHandler",
                    "method" : "heartbeat",
                    "requestType" : null
                  } ]
                }
                """;

        Path committedPath = tempDir.resolve("stomp-routes.json");
        Files.writeString(committedPath, committed);

        assertThat(ApiContractsDriftChecker.checkStompRoutesDrift(committedPath, fresh)).isEmpty();
    }

    @Test
    @DisplayName("STOMP drift: route change fails")
    void stompRouteChangeFails() throws IOException {
        String committed = StompRouteInventory.toCanonicalJson(List.of(
                new StompRouteInventory.InboundRoute(
                        "/app/heartbeat",
                        "dev.burnedchats.handler.HeartbeatHandler",
                        "heartbeat",
                        null)));
        String fresh = StompRouteInventory.toCanonicalJson(List.of(
                new StompRouteInventory.InboundRoute(
                        "/app/probe.route",
                        "dev.burnedchats.handler.ProbeHandler",
                        "probe",
                        null)));

        Path committedPath = tempDir.resolve("stomp-routes.json");
        Files.writeString(committedPath, committed);

        assertThat(ApiContractsDriftChecker.checkStompRoutesDrift(committedPath, fresh))
                .isPresent();
    }

    @Test
    @DisplayName("committed artifacts match fresh export on clean tree")
    void committedArtifactsMatchFreshExport() throws IOException {
        Path repoRoot = Path.of(System.getProperty("user.dir")).getParent();
        if (repoRoot == null) {
            throw new IllegalStateException("user.dir parent (repo root) must not be null");
        }
        Path openApi = repoRoot.resolve("docs/specs/openapi.yaml");
        Path stompRoutes = repoRoot.resolve("docs/specs/stomp-routes.json");

        List<String> failures = ApiContractsDriftChecker.checkAll(openApi, stompRoutes);

        assertThat(failures)
                .as("Run ./gradlew exportOpenApi exportStompRoutes and commit if this fails")
                .isEmpty();
    }
}
