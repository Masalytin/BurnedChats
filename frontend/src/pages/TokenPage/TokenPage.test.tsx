// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseBackButton = vi.fn();

vi.mock('@/hooks/useBackButton', () => ({
  useBackButton: (options: { visible?: boolean; onBack?: () => void }) => mockUseBackButton(options),
}));

import { TokenPage } from './TokenPage';

function renderTokenPage(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/token" element={<TokenPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('TokenPage return contract', () => {
  beforeEach(() => {
    mockUseBackButton.mockReset();
    mockUseBackButton.mockReturnValue({
      show: vi.fn(),
      hide: vi.fn(),
      setVisible: vi.fn(),
    });
  });

  it('sends both Back links to / on a bare /token visit', () => {
    renderTokenPage('/token');

    const top = screen.getByRole('link', { name: 'Back to Burned Chats home' });
    const footer = screen.getByRole('link', { name: 'Back to Burned Chats' });
    expect(top.getAttribute('href')).toBe('/');
    expect(footer.getAttribute('href')).toBe('/');
    expect(top.textContent).toContain('Burned Chats');
    expect(footer.textContent).toContain('Back to Burned Chats');
  });

  it('sends both Back links to /app/wallet when from=wallet', () => {
    renderTokenPage('/token?from=wallet');

    const backs = screen.getAllByRole('link', { name: 'Back to wallet' });
    expect(backs).toHaveLength(2);
    for (const link of backs) {
      expect(link.getAttribute('href')).toBe('/app/wallet');
      expect(link.textContent).toContain('Back to wallet');
    }
  });

  it.each(['Wallet', 'wallet/', '/app/wallet', 'https://evil.example/phish'])(
    'treats from=%s as unknown and returns to /',
    (from) => {
      renderTokenPage(`/token?from=${encodeURIComponent(from)}`);

      expect(screen.getByRole('link', { name: 'Back to Burned Chats home' }).getAttribute('href')).toBe(
        '/',
      );
      expect(screen.getByRole('link', { name: 'Back to Burned Chats' }).getAttribute('href')).toBe('/');
      expect(screen.queryByRole('link', { name: 'Back to wallet' })).toBeNull();
    },
  );

  it('shows TMA BackButton only when from=wallet', () => {
    renderTokenPage('/token');
    expect(mockUseBackButton).toHaveBeenCalledWith(
      expect.objectContaining({ visible: false }),
    );

    mockUseBackButton.mockClear();
    renderTokenPage('/token?from=wallet');
    expect(mockUseBackButton).toHaveBeenCalledWith(
      expect.objectContaining({
        visible: true,
        onBack: expect.any(Function),
      }),
    );
  });
});
