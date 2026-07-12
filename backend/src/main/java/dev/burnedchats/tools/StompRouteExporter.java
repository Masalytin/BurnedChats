package dev.burnedchats.tools;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * Gradle entry point for {@code exportStompRoutes}.
 *
 * <p>Writes {@code docs/specs/stomp-routes.json} with a {@code generatedAt} timestamp.
 * CI drift-check (IMP-APICTR-04) should compare route entries ignoring {@code generatedAt}.
 */
@SuppressWarnings("checkstyle:HideUtilityClassConstructor")
public final class StompRouteExporter {

    private StompRouteExporter() {
    }

    public static void main(String[] args) throws IOException {
        Path output = resolveOutputPath(args);
        List<StompRouteInventory.InboundRoute> routes = StompRouteInventory.scan();
        Path parent = output.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        Files.writeString(output, StompRouteInventory.toJson(routes));
        System.out.println("Exported " + routes.size() + " STOMP routes to " + output);
    }

    static Path resolveOutputPath(String[] args) {
        if (args.length > 0) {
            return Path.of(args[0]);
        }
        return Path.of("docs", "specs", "stomp-routes.json");
    }
}
