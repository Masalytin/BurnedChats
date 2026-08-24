import { describe, expect, it } from 'vitest';
import { isReconnectExhausted } from '../reconnectExhausted';

describe('isReconnectExhausted', () => {
  it('is true only when disconnected after the attempt cap', () => {
    expect(isReconnectExhausted(false, 10, 10)).toBe(true);
    expect(isReconnectExhausted(true, 10, 10)).toBe(false);
    expect(isReconnectExhausted(false, 9, 10)).toBe(false);
    expect(isReconnectExhausted(false, 3, 0)).toBe(false);
  });
});
