export interface DmMessageOwnershipContext {
  userInternalId: string;
  userTelegramId?: number;
}

/** Primary: stable internalId; fallback: non-zero Telegram id (legacy). */
export function isOwnDmMessage(
  ctx: DmMessageOwnershipContext,
  senderInternalId?: string | null,
  senderId?: number | null,
): boolean {
  if (ctx.userInternalId && senderInternalId) {
    return senderInternalId === ctx.userInternalId;
  }
  if (ctx.userTelegramId != null && ctx.userTelegramId !== 0 && senderId != null) {
    return senderId === ctx.userTelegramId;
  }
  return false;
}
