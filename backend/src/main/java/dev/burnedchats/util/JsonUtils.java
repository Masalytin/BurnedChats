package dev.burnedchats.util;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Optional;

/**
 * JSON serialization utility class.
 *
 * <p>Provides convenient methods for JSON serialization and deserialization
 * with proper error handling and logging.
 */
public final class JsonUtils {

    private static final Logger LOG = LoggerFactory.getLogger(JsonUtils.class);

    private static final ObjectMapper MAPPER = createObjectMapper();

    private JsonUtils() {
        // Utility class, no instantiation
    }

    private static ObjectMapper createObjectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        mapper.disable(SerializationFeature.FAIL_ON_EMPTY_BEANS);
        return mapper;
    }

    /**
     * Serialize object to JSON string.
     *
     * @param object the object to serialize
     * @return JSON string, or empty string on error
     */
    public static String toJson(Object object) {
        if (object == null) {
            return "null";
        }
        try {
            return MAPPER.writeValueAsString(object);
        } catch (JsonProcessingException e) {
            LOG.error("Failed to serialize object to JSON: {}", e.getMessage());
            return "";
        }
    }

    /**
     * Serialize object to JSON string, throwing on error.
     *
     * @param object the object to serialize
     * @return JSON string
     * @throws JsonProcessingException if serialization fails
     */
    public static String toJsonStrict(Object object) throws JsonProcessingException {
        return MAPPER.writeValueAsString(object);
    }

    /**
     * Deserialize JSON string to object.
     *
     * @param json  the JSON string
     * @param clazz the target class
     * @param <T>   the target type
     * @return Optional containing the deserialized object, or empty on error
     */
    public static <T> Optional<T> fromJson(String json, Class<T> clazz) {
        if (json == null || json.isBlank()) {
            return Optional.empty();
        }
        try {
            return Optional.ofNullable(MAPPER.readValue(json, clazz));
        } catch (JsonProcessingException e) {
            LOG.error("Failed to deserialize JSON to {}: {}", clazz.getSimpleName(), e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Deserialize JSON string to object, throwing on error.
     *
     * @param json  the JSON string
     * @param clazz the target class
     * @param <T>   the target type
     * @return the deserialized object
     * @throws JsonProcessingException if deserialization fails
     */
    public static <T> T fromJsonStrict(String json, Class<T> clazz) throws JsonProcessingException {
        return MAPPER.readValue(json, clazz);
    }

    /**
     * Get the shared ObjectMapper instance.
     *
     * <p>Use this when you need custom serialization options.
     *
     * @return the ObjectMapper instance
     */
    public static ObjectMapper getMapper() {
        return MAPPER;
    }
}



