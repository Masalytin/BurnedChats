/**
 * Telegram Bot and Mini App integration.
 *
 * <p>This package contains all Telegram-related functionality:
 * <ul>
 *   <li>Bot command handlers</li>
 *   <li>Mini App authentication (initData validation)</li>
 *   <li>Notification sending</li>
 *   <li>Webhook handling</li>
 * </ul>
 *
 * <p>Key classes:
 * <ul>
 *   <li>{@link dev.burnedchats.telegram.BurnedChatsBot} - Main bot with /start and /help commands</li>
 *   <li>{@link dev.burnedchats.telegram.TelegramBotConfig} - Bot registration (Long Polling)</li>
 *   <li>{@code TelegramAuthService} - initData HMAC-SHA256 validation (Sprint 2.2)</li>
 *   <li>{@code NotificationService} - Push notifications to users (Sprint 3.3)</li>
 * </ul>
 */
package dev.burnedchats.telegram;

