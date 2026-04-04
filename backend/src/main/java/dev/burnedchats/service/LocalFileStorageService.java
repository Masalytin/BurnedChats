package dev.burnedchats.service;

import dev.burnedchats.config.FileStorageProperties;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.core.io.buffer.DefaultDataBufferFactory;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.io.IOException;
import java.nio.channels.AsynchronousFileChannel;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.stream.Stream;

/**
 * Local filesystem implementation of {@link FileStorageService}.
 *
 * <p>Stores encrypted file blobs as {@code {fileId}.enc} in a configurable directory.
 * Uses non-blocking I/O via {@link AsynchronousFileChannel} for WebFlux compatibility.
 */
@Service
public class LocalFileStorageService implements FileStorageService {

    private static final Logger log = LoggerFactory.getLogger(LocalFileStorageService.class);

    private static final String FILE_EXTENSION = ".enc";
    private static final int BUFFER_SIZE = 8192;

    private final Path storagePath;

    public LocalFileStorageService(FileStorageProperties properties) {
        this.storagePath = Path.of(properties.getStoragePath());
    }

    @PostConstruct
    void initStorageDirectory() {
        try {
            Files.createDirectories(storagePath);
            log.info("File storage directory ready: {}", storagePath.toAbsolutePath());
        } catch (IOException e) {
            throw new IllegalStateException("Cannot create file storage directory: " + storagePath, e);
        }
    }

    @Override
    public Mono<String> save(String fileId, Flux<DataBuffer> data) {
        Path filePath = resolve(fileId);

        return Mono.fromCallable(() ->
                        AsynchronousFileChannel.open(filePath,
                                StandardOpenOption.CREATE,
                                StandardOpenOption.WRITE,
                                StandardOpenOption.TRUNCATE_EXISTING))
                .subscribeOn(Schedulers.boundedElastic())
                .flatMap(channel ->
                        DataBufferUtils.write(data, channel)
                                .publishOn(Schedulers.boundedElastic())
                                .doOnTerminate(() -> closeQuietly(channel))
                                .then(Mono.just(filePath.toString())))
                .doOnSuccess(path -> log.debug("Saved file: {}", fileId))
                .doOnError(e -> log.error("Failed to save file: {}", fileId, e));
    }

    @Override
    public Flux<DataBuffer> get(String fileId) {
        Path filePath = resolve(fileId);

        return DataBufferUtils.read(
                filePath,
                new DefaultDataBufferFactory(),
                BUFFER_SIZE
        );
    }

    @Override
    public Mono<Boolean> delete(String fileId) {
        Path filePath = resolve(fileId);

        return Mono.fromCallable(() -> {
                    try {
                        return Files.deleteIfExists(filePath);
                    } catch (NoSuchFileException e) {
                        return false;
                    }
                })
                .subscribeOn(Schedulers.boundedElastic())
                .doOnSuccess(deleted -> {
                    if (deleted) {
                        log.debug("Deleted file: {}", fileId);
                    }
                });
    }

    @Override
    public Mono<Boolean> exists(String fileId) {
        Path filePath = resolve(fileId);

        return Mono.fromCallable(() -> Files.exists(filePath))
                .subscribeOn(Schedulers.boundedElastic());
    }

    @Override
    public Mono<Long> fileSize(String fileId) {
        Path filePath = resolve(fileId);

        return Mono.fromCallable(() -> {
                    if (!Files.exists(filePath)) {
                        return -1L;
                    }
                    return Files.size(filePath);
                })
                .subscribeOn(Schedulers.boundedElastic())
                .flatMap(size -> size < 0 ? Mono.empty() : Mono.just(size));
    }

    @Override
    public Flux<String> listAll() {
        return Mono.fromCallable(() -> {
                    try (Stream<Path> paths = Files.list(storagePath)) {
                        return paths
                                .filter(p -> p.getFileName().toString().endsWith(FILE_EXTENSION))
                                .map(p -> {
                                    String name = p.getFileName().toString();
                                    return name.substring(0, name.length() - FILE_EXTENSION.length());
                                })
                                .toList();
                    }
                })
                .subscribeOn(Schedulers.boundedElastic())
                .flatMapMany(Flux::fromIterable);
    }

    private Path resolve(String fileId) {
        return storagePath.resolve(fileId + FILE_EXTENSION);
    }

    private void closeQuietly(AsynchronousFileChannel channel) {
        try {
            if (channel.isOpen()) {
                channel.close();
            }
        } catch (IOException e) {
            log.warn("Failed to close file channel", e);
        }
    }
}
