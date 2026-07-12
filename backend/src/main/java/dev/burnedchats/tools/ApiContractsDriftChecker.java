package dev.burnedchats.tools;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * Compares committed API contract artifacts against freshly generated exports.
 *
 * <p>Used by Gradle {@code checkApiContracts} and CI drift gate (IMP-APICTR-04).
 */
@SuppressWarnings("checkstyle:HideUtilityClassConstructor")
public final class ApiContractsDriftChecker {

    private ApiContractsDriftChecker() {
    }

    public static void main(String[] args) {
        Path openApiPath = resolveOpenApiPath(args);
        Path stompRoutesPath = resolveStompRoutesPath(args);

        List<String> failures = checkAll(openApiPath, stompRoutesPath);
        if (failures.isEmpty()) {
            System.out.println("API contract artifacts are up to date.");
            return;
        }

        System.err.println("API contract drift detected:");
        failures.forEach(message -> System.err.println("  - " + message));
        System.exit(1);
    }

    static Path resolveOpenApiPath(String[] args) {
        if (args.length > 0) {
            return Path.of(args[0]);
        }
        return Path.of("docs", "specs", "openapi.yaml");
    }

    static Path resolveStompRoutesPath(String[] args) {
        if (args.length > 1) {
            return Path.of(args[1]);
        }
        return Path.of("docs", "specs", "stomp-routes.json");
    }

    /**
     * Runs OpenAPI and STOMP drift checks against committed files on disk.
     *
     * @return human-readable failure messages; empty when both artifacts match
     */
    public static List<String> checkAll(Path openApiCommitted, Path stompRoutesCommitted) {
        List<String> failures = new ArrayList<>();

        try {
            String freshOpenApi = OpenApiExporter.normalizeYaml(OpenApiExporter.fetchOpenApiYaml());
            checkOpenApiDrift(openApiCommitted, freshOpenApi).ifPresent(failures::add);
        } catch (IOException e) {
            failures.add("openapi.yaml: failed to generate fresh export — " + e.getMessage());
        }

        try {
            String freshStomp = StompRouteInventory.toCanonicalJson(StompRouteInventory.scan());
            String committedStomp = Files.readString(stompRoutesCommitted);
            checkStompRoutesDrift(stompRoutesCommitted, committedStomp, freshStomp).ifPresent(failures::add);
        } catch (IOException e) {
            failures.add("stomp-routes.json: failed to read or compare — " + e.getMessage());
        }

        return failures;
    }

    /**
     * Compares committed OpenAPI YAML on disk with a freshly normalized export string.
     */
    static Optional<String> checkOpenApiDrift(Path openApiCommitted, String freshNormalizedYaml)
            throws IOException {
        String committedRaw = Files.readString(openApiCommitted);
        String committedNormalized = OpenApiExporter.normalizeYaml(committedRaw);
        String freshNormalized = OpenApiExporter.normalizeYaml(freshNormalizedYaml);

        if (Objects.equals(committedNormalized, freshNormalized)) {
            return Optional.empty();
        }
        return Optional.of(
                "openapi.yaml drift: committed file differs from ./gradlew exportOpenApi output "
                        + "(re-run export and commit)");
    }

    /**
     * Compares committed STOMP inventory JSON with a fresh canonical export string.
     */
    static Optional<String> checkStompRoutesDrift(Path stompRoutesCommitted, String freshCanonicalJson)
            throws IOException {
        String committed = Files.readString(stompRoutesCommitted);
        return checkStompRoutesDrift(stompRoutesCommitted, committed, freshCanonicalJson);
    }

    static Optional<String> checkStompRoutesDrift(
            Path stompRoutesCommitted,
            String committedJson,
            String freshCanonicalJson) throws IOException {
        String committedCanonical = StompRouteInventory.toCanonicalJsonFromExisting(committedJson);
        String freshCanonical = StompRouteInventory.toCanonicalJsonFromExisting(freshCanonicalJson);

        if (Objects.equals(committedCanonical, freshCanonical)) {
            return Optional.empty();
        }
        return Optional.of(
                "stomp-routes.json drift: committed file differs from ./gradlew exportStompRoutes output "
                        + "(re-run export and commit)");
    }
}
