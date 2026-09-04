package dev.burnedchats.tools;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import com.fasterxml.jackson.dataformat.yaml.YAMLGenerator;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Iterator;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import java.util.TreeMap;

/**
 * Gradle entry point for {@code exportOpenApi}.
 *
 * <p>Boots a dev-profile test context, fetches {@code /v3/api-docs.yaml}, and writes a
 * deterministic {@code docs/specs/openapi.yaml} (sorted paths, no volatile metadata).
 */
@SuppressWarnings("checkstyle:HideUtilityClassConstructor")
public final class OpenApiExporter {

    private static final ObjectMapper YAML = new ObjectMapper(
            YAMLFactory.builder()
                    .disable(YAMLGenerator.Feature.WRITE_DOC_START_MARKER)
                    .build());

    private OpenApiExporter() {
    }

    public static void main(String[] args) throws IOException {
        Path output = resolveOutputPath(args);
        String yaml = fetchOpenApiYaml();
        String normalized = normalizeYaml(yaml);
        Path parent = output.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        Files.writeString(output, normalized);
        System.out.println("Exported OpenAPI spec to " + output.toAbsolutePath());
    }

    static Path resolveOutputPath(String[] args) {
        if (args.length > 0) {
            return Path.of(args[0]);
        }
        return Path.of("docs", "specs", "openapi.yaml");
    }

    static String fetchOpenApiYaml() {
        SpringApplication application = new SpringApplication(dev.burnedchats.BurnedChatsApplication.class);
        application.setWebApplicationType(WebApplicationType.SERVLET);
        application.setAdditionalProfiles("dev", "test");
        Map<String, Object> defaults = new HashMap<>();
        defaults.put("server.port", "0");
        defaults.put("spring.main.lazy-initialization", "true");
        defaults.put("spring.data.redis.host", "localhost");
        defaults.put("spring.data.redis.port", "6379");
        defaults.put("telegram.bot.token", "");
        defaults.put("telegram.bot.username", "ExportBot");
        defaults.put("telegram.bot.webhook.enabled", "false");
        defaults.put("telegram.mini-app.url", "https://export.example.com");
        defaults.put("rate-limit.enabled", "false");
        defaults.put("pow.enabled", "false");
        defaults.put("app.files.storage-path",
                System.getProperty("java.io.tmpdir") + "/burnedchats-export-files/");
        defaults.put("burnedchats.messages.offline-queue.keyspace-listener-enabled", "false");
        defaults.put("burnedchats.users.deadman.keyspace-listener-enabled", "false");
        defaults.put("springdoc.api-docs.enabled", "true");
        defaults.put("springdoc.swagger-ui.enabled", "true");
        application.setDefaultProperties(defaults);

        try (ConfigurableApplicationContext context = application.run()) {
            int port = context.getEnvironment().getProperty("local.server.port", Integer.class, 8080);
            RestClient client = RestClient.create();
            ResponseEntity<String> response = client.get()
                    .uri("http://localhost:" + port + "/v3/api-docs.yaml")
                    .retrieve()
                    .toEntity(String.class);
            String body = response.getBody();
            return body == null ? "" : body;
        }
    }

    static String normalizeYaml(String yaml) throws IOException {
        JsonNode root = YAML.readTree(yaml);
        if (!(root instanceof ObjectNode objectNode)) {
            throw new IllegalStateException("OpenAPI export root must be an object");
        }

        objectNode.remove("x-springdoc");
        objectNode.remove("x-generator");
        if (objectNode.has("info") && objectNode.get("info").isObject()) {
            ((ObjectNode) objectNode.get("info")).remove("x-generated-at");
        }

        JsonNode pathsNode = objectNode.get("paths");
        if (pathsNode != null && pathsNode.isObject()) {
            TreeMap<String, JsonNode> sortedPaths = new TreeMap<>();
            Iterator<Map.Entry<String, JsonNode>> fields = pathsNode.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> entry = fields.next();
                sortedPaths.put(entry.getKey(), entry.getValue());
            }
            ObjectNode sortedPathsNode = YAML.createObjectNode();
            sortedPaths.forEach((path, node) -> sortedPathsNode.set(path, sortOperationResponses(node)));
            objectNode.set("paths", sortedPathsNode);
        }

        objectNode.remove("servers");

        List<String> keys = new ArrayList<>();
        objectNode.fieldNames().forEachRemaining(keys::add);
        keys.sort(Comparator.naturalOrder());
        ObjectNode orderedRoot = YAML.createObjectNode();
        for (String key : keys) {
            orderedRoot.set(key, objectNode.get(key));
        }

        return YAML.writerWithDefaultPrettyPrinter().writeValueAsString(orderedRoot);
    }

    /**
     * Springdoc emits HTTP status keys in HashMap order; sort them so export and
     * the drift check are deterministic (IMP-TONREAD-07).
     */
    private static JsonNode sortOperationResponses(JsonNode pathItem) {
        if (!(pathItem instanceof ObjectNode pathObj)) {
            return pathItem;
        }
        Iterator<Map.Entry<String, JsonNode>> methods = pathObj.fields();
        while (methods.hasNext()) {
            Map.Entry<String, JsonNode> method = methods.next();
            JsonNode op = method.getValue();
            if (!(op instanceof ObjectNode opObj) || !opObj.has("responses") || !opObj.get("responses").isObject()) {
                continue;
            }
            TreeMap<String, JsonNode> sorted = new TreeMap<>();
            Iterator<Map.Entry<String, JsonNode>> statuses = opObj.get("responses").fields();
            while (statuses.hasNext()) {
                Map.Entry<String, JsonNode> status = statuses.next();
                sorted.put(status.getKey(), status.getValue());
            }
            ObjectNode sortedResponses = YAML.createObjectNode();
            sorted.forEach(sortedResponses::set);
            opObj.set("responses", sortedResponses);
        }
        return pathObj;
    }
}
