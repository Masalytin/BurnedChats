package dev.burnedchats.tools;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.RegexPatternTypeFilter;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;

import java.io.IOException;
import java.lang.reflect.Method;
import java.lang.reflect.Parameter;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Reflection scanner for inbound STOMP {@link MessageMapping} routes under
 * {@code dev.burnedchats.handler.**}.
 */
public final class StompRouteInventory {

    private static final String HANDLER_PACKAGE = "dev.burnedchats.handler";
    private static final String APP_PREFIX = "/app";
    private static final Pattern HANDLER_CLASS_PATTERN =
            Pattern.compile("dev\\.burnedchats\\.handler\\..+");
    private static final ObjectMapper JSON = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

    private StompRouteInventory() {
    }

    public record InboundRoute(String destination, String handler, String method, String requestType) {
    }

    public record Inventory(int version, String generatedAt, List<InboundRoute> inbound) {
    }

    public record CanonicalInventory(int version, List<InboundRoute> inbound) {
    }

    public static List<InboundRoute> scan() {
        ClassPathScanningCandidateComponentProvider scanner =
                new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new RegexPatternTypeFilter(HANDLER_CLASS_PATTERN));

        List<InboundRoute> routes = new ArrayList<>();
        ClassLoader classLoader = Thread.currentThread().getContextClassLoader();

        scanner.findCandidateComponents(HANDLER_PACKAGE).forEach(beanDefinition -> {
            try {
                Class<?> handlerClass = Class.forName(beanDefinition.getBeanClassName(), false, classLoader);
                collectRoutes(handlerClass, routes);
            } catch (ClassNotFoundException e) {
                throw new IllegalStateException(
                        "Failed to load handler class: " + beanDefinition.getBeanClassName(), e);
            }
        });

        routes.sort(Comparator.comparing(InboundRoute::destination));
        return List.copyOf(routes);
    }

    public static String toJson(List<InboundRoute> routes) {
        Inventory inventory = new Inventory(1, Instant.now().toString(), routes);
        try {
            return JSON.writerWithDefaultPrettyPrinter().writeValueAsString(inventory);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize STOMP inventory", e);
        }
    }

    public static String toCanonicalJson(List<InboundRoute> routes) {
        CanonicalInventory inventory = new CanonicalInventory(1, routes);
        try {
            return JSON.writerWithDefaultPrettyPrinter().writeValueAsString(inventory);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize canonical STOMP inventory", e);
        }
    }

    /**
     * Parses committed or fresh JSON and re-serializes without volatile {@code generatedAt}.
     */
    public static String toCanonicalJsonFromExisting(String json) {
        try {
            JsonNode root = JSON.readTree(json);
            JsonNode inboundNode = root.get("inbound");
            if (inboundNode == null || !inboundNode.isArray()) {
                throw new IllegalStateException("STOMP inventory JSON must contain an inbound array");
            }
            List<InboundRoute> routes = JSON.readerForListOf(InboundRoute.class).readValue(inboundNode);
            return toCanonicalJson(routes);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to parse STOMP inventory JSON", e);
        }
    }

    private static void collectRoutes(Class<?> handlerClass, List<InboundRoute> routes) {
        for (Method method : handlerClass.getDeclaredMethods()) {
            MessageMapping mapping = method.getAnnotation(MessageMapping.class);
            if (mapping == null) {
                continue;
            }
            String destinationSuffix = resolveLiteralDestination(mapping, handlerClass, method);
            routes.add(new InboundRoute(
                    APP_PREFIX + destinationSuffix,
                    handlerClass.getName(),
                    method.getName(),
                    resolveRequestType(method)));
        }
    }

    private static String resolveLiteralDestination(
            MessageMapping mapping,
            Class<?> handlerClass,
            Method method) {
        String[] values = mapping.value();
        if (values.length != 1) {
            throw new IllegalStateException(
                    "Expected exactly one @MessageMapping value on "
                            + handlerClass.getName() + "#" + method.getName());
        }
        String value = values[0];
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(
                    "Empty @MessageMapping value on " + handlerClass.getName() + "#" + method.getName());
        }
        if (value.contains("{") || value.contains("}") || value.startsWith("#")) {
            throw new IllegalStateException(
                    "Non-literal @MessageMapping value '" + value + "' on "
                            + handlerClass.getName() + "#" + method.getName());
        }
        return value.startsWith("/") ? value : "/" + value;
    }

    private static String resolveRequestType(Method method) {
        for (Parameter parameter : method.getParameters()) {
            if (parameter.isAnnotationPresent(Payload.class)) {
                return parameter.getType().getName();
            }
        }
        return null;
    }
}
