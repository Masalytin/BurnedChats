/**
 * WebSocket message handlers for STOMP communication.
 *
 * <p>This package contains handlers that process incoming WebSocket messages
 * and coordinate responses. Handlers are responsible for:
 * <ul>
 *   <li>Processing STOMP messages from clients</li>
 *   <li>Validating message payloads</li>
 *   <li>Coordinating with services for business logic</li>
 *   <li>Sending responses back to clients</li>
 * </ul>
 *
 * <p>Key handlers planned:
 * <ul>
 *   <li>{@code SessionHandler} - Chat session management</li>
 *   <li>{@code MessageHandler} - Message relay</li>
 *   <li>{@code HandshakeHandler} - Key exchange coordination</li>
 *   <li>{@code BurnHandler} - Session destruction</li>
 * </ul>
 */
package dev.burnedchats.handler;

