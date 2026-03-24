package dev.burnedchats.service;

import org.springframework.core.io.buffer.DataBuffer;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Abstraction for encrypted file storage.
 *
 * <p>MVP implementation uses local filesystem ({@link LocalFileStorageService}).
 * Future implementations may use S3/MinIO without changing consumers.
 *
 * <p>All files are stored as opaque encrypted blobs — the server never
 * has access to plaintext content or encryption keys.
 */
public interface FileStorageService {

    /**
     * Save an encrypted file blob.
     *
     * @param fileId unique file identifier (UUID)
     * @param data   encrypted file content as a reactive stream
     * @return the storage path of the saved file
     */
    Mono<String> save(String fileId, Flux<DataBuffer> data);

    /**
     * Retrieve an encrypted file blob as a streaming response.
     *
     * @param fileId unique file identifier
     * @return reactive stream of data buffers
     */
    Flux<DataBuffer> get(String fileId);

    /**
     * Delete an encrypted file from storage.
     *
     * @param fileId unique file identifier
     * @return true if the file was deleted, false if it did not exist
     */
    Mono<Boolean> delete(String fileId);

    /**
     * Check whether a file exists in storage.
     *
     * @param fileId unique file identifier
     * @return true if the file exists
     */
    Mono<Boolean> exists(String fileId);

    /**
     * List all file IDs currently in storage.
     * Used by the cleanup job to reconcile filesystem state with Redis metadata.
     *
     * @return stream of file IDs present in storage
     */
    Flux<String> listAll();
}
