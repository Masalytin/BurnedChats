import type { TFunction } from 'i18next';
import type { MessageStatus } from '@/types';

export function messageStatusAriaLabel(t: TFunction, status: MessageStatus): string {
  return t(`chat.messageStatus.${status}`);
}
