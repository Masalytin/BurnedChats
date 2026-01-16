/**
 * Domain models and entities.
 *
 * <p>This package contains the core domain models representing
 * business entities in the BurnedChats application.
 *
 * <p>Key models:
 * <ul>
 *   <li>{@code Session} - Encrypted chat session between two users</li>
 *   <li>{@code ChatRequest} - Pending request to start a chat</li>
 *   <li>{@code TelegramUser} - Cached Telegram user information</li>
 *   <li>{@code Message} - Encrypted message metadata (content never stored)</li>
 * </ul>
 *
 * <p>Models in this package are designed for Redis storage and
 * use appropriate serialization strategies.
 */
package dev.burnedchats.model;

