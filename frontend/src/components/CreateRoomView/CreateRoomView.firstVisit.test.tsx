// @vitest-environment happy-dom
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import { useBackButton } from '@/hooks/useBackButton';
import { ONBOARDING_STORAGE_KEY } from '@/onboarding/onboardingProgress';

import { CreateRoomView } from './CreateRoomView';

const backButtonClickHandlers: Array<() => void> = [];

vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return {
    ...actual,
    useReducedMotion: () => false,
  };
});

vi.mock('@twa-dev/sdk', () => ({
  default: {
    initData: 'test-init-data',
    initDataUnsafe: { user: { language_code: 'en' } },
    CloudStorage: { getItem: () => {} },
    BackButton: {
      show: vi.fn(),
      hide: vi.fn(),
      onClick: vi.fn((handler: () => void) => {
        backButtonClickHandlers.push(handler);
      }),
      offClick: vi.fn((handler: () => void) => {
        const index = backButtonClickHandlers.indexOf(handler);
        if (index >= 0) backButtonClickHandlers.splice(index, 1);
      }),
    },
  },
}));

vi.mock('../Toast/ToastContext', () => ({
  useToast: () => ({
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

function renderCreateRoom(
  props: Partial<{
    onSubmit: (password: string | null, joinMode: string, roomName?: string) => void;
    onCancel: () => void;
    onHelpOpenChange: (open: boolean) => void;
  }> = {},
) {
  const onSubmit = props.onSubmit ?? vi.fn();
  const onCancel = props.onCancel ?? vi.fn();
  const result = render(
    <I18nextProvider i18n={i18n}>
      <CreateRoomView
        onSubmit={onSubmit}
        onCancel={onCancel}
        onHelpOpenChange={props.onHelpOpenChange}
      />
    </I18nextProvider>,
  );
  return { ...result, onSubmit, onCancel };
}

/** Mirrors App handleBackButton no-op while create-room Help is open. */
function AppBackHarness({ onHome }: { onHome: () => void }) {
  const [createRoomHelpOpen, setCreateRoomHelpOpen] = useState(false);

  const handleBackButton = () => {
    if (createRoomHelpOpen) {
      return;
    }
    onHome();
  };

  useBackButton({
    visible: !createRoomHelpOpen,
    onBack: handleBackButton,
  });

  return (
    <I18nextProvider i18n={i18n}>
      <CreateRoomView
        onSubmit={vi.fn()}
        onCancel={onHome}
        onHelpOpenChange={setCreateRoomHelpOpen}
      />
    </I18nextProvider>
  );
}

describe('CreateRoomView first-visit help', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    localStorage.clear();
    backButtonClickHandlers.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    backButtonClickHandlers.length = 0;
  });

  it('opens HelpSheet rooms.create immediately on first mount', () => {
    renderCreateRoom();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Creating a room' })).toBeTruthy();
  });

  it('marks createRoomHint on close and does not auto-open on remount', () => {
    const { unmount } = renderCreateRoom();

    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(i18n.t('aria.closeDialog')));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? '')).toEqual({
      v: 1,
      seen: { createRoomHint: true },
    });

    unmount();
    renderCreateRoom();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: i18n.t('room.create.title') })).toBeTruthy();
  });

  it('closes the sheet on Escape without calling onCancel', () => {
    const { onCancel } = renderCreateRoom();

    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('closes the sheet via Telegram BackButton without calling onCancel', async () => {
    const { onCancel } = renderCreateRoom();

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(backButtonClickHandlers.length).toBeGreaterThan(0);

    for (const handler of [...backButtonClickHandlers]) {
      handler();
    }

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('keeps App Back a no-op while the sheet is open (does not go home)', async () => {
    const onHome = vi.fn();
    render(<AppBackHarness onHome={onHome} />);

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(backButtonClickHandlers.length).toBeGreaterThan(0);

    for (const handler of [...backButtonClickHandlers]) {
      handler();
    }

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(onHome).not.toHaveBeenCalled();
  });

  it('still opens rooms.create from HelpTrigger after the hint is seen', () => {
    localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({ v: 1, seen: { createRoomHint: true } }),
    );

    renderCreateRoom();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /what is this/i }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Creating a room' })).toBeTruthy();
  });

  it('reports help open state to onHelpOpenChange on first visit', () => {
    const onHelpOpenChange = vi.fn();
    renderCreateRoom({ onHelpOpenChange });

    expect(onHelpOpenChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByLabelText(i18n.t('aria.closeDialog')));

    expect(onHelpOpenChange).toHaveBeenCalledWith(false);
  });
});
