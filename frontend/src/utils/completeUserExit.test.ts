import { describe, expect, it, vi } from 'vitest';
import { completeUserExit } from './completeUserExit';

describe('completeUserExit', () => {
  it('closes the Telegram Mini App when running inside Telegram', () => {
    const closeMiniApp = vi.fn();
    const logout = vi.fn();

    completeUserExit({ isInTelegram: true, closeMiniApp, logout });

    expect(closeMiniApp).toHaveBeenCalledTimes(1);
    expect(logout).not.toHaveBeenCalled();
  });

  it('logs out when running in a regular browser', () => {
    const closeMiniApp = vi.fn();
    const logout = vi.fn();

    completeUserExit({ isInTelegram: false, closeMiniApp, logout });

    expect(logout).toHaveBeenCalledTimes(1);
    expect(closeMiniApp).not.toHaveBeenCalled();
  });
});
