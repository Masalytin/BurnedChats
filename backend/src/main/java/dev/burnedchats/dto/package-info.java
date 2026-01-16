/**
 * Data Transfer Objects for API communication.
 *
 * <p>This package contains DTOs used for:
 * <ul>
 *   <li>WebSocket message payloads (requests and responses)</li>
 *   <li>REST API request/response bodies</li>
 *   <li>Internal data transfer between layers</li>
 * </ul>
 *
 * <p>DTOs in this package are immutable where possible and use
 * Lombok annotations for boilerplate reduction.
 *
 * <p>Subpackages:
 * <ul>
 *   <li>{@code request} - Incoming message DTOs</li>
 *   <li>{@code response} - Outgoing message DTOs</li>
 *   <li>{@code event} - WebSocket event DTOs</li>
 * </ul>
 */
package dev.burnedchats.dto;

