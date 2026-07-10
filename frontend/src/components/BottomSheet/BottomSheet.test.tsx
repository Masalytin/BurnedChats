// @vitest-environment happy-dom
import { useRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import WebApp from '@twa-dev/sdk';

import { BottomSheet } from './BottomSheet';

const useReducedMotionMock = vi.fn(() => false);
const backButtonClickHandlers: Array<() => void> = [];

vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return {
    ...actual,
    useReducedMotion: () => useReducedMotionMock(),
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

function Harness({
  open = true,
  onClose = vi.fn(),
  suspended = false,
  reducedMotionAware = false,
  focusOnOpen = true,
  backButtonVisible,
  onBack,
}: {
  open?: boolean;
  onClose?: () => void;
  suspended?: boolean;
  reducedMotionAware?: boolean;
  focusOnOpen?: boolean;
  backButtonVisible?: boolean;
  onBack?: () => void;
}) {
  const titleId = 'sheet-title';
  const closeRef = useRef<HTMLButtonElement>(null);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      ariaLabelledBy={titleId}
      suspended={suspended}
      reducedMotionAware={reducedMotionAware}
      focusOnOpen={focusOnOpen}
      initialFocusRef={closeRef}
      backButtonVisible={backButtonVisible}
      onBack={onBack}
      backdropClassName="test-backdrop"
      panelClassName="test-panel"
    >
      <h2 id={titleId}>Sheet title</h2>
      <button ref={closeRef} type="button" aria-label="Close sheet">
        Close
      </button>
      <button type="button">Action</button>
    </BottomSheet>
  );
}

describe('BottomSheet', () => {
  beforeEach(() => {
    useReducedMotionMock.mockReturnValue(false);
    backButtonClickHandlers.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
    useReducedMotionMock.mockReturnValue(false);
    backButtonClickHandlers.length = 0;
  });

  it('does not render when closed', () => {
    render(<Harness open={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders dialog with aria-modal and aria-labelledby when open', () => {
    render(<Harness />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('sheet-title');
    expect(dialog.className).toContain('test-panel');
  });

  it('closes on backdrop click', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    fireEvent.click(document.querySelector('.test-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when clicking inside the panel', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on Escape when suspended', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} suspended />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close on backdrop click when suspended', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} suspended />);

    fireEvent.click(document.querySelector('.test-backdrop')!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes via Telegram BackButton when open and not suspended', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    expect(backButtonClickHandlers.length).toBeGreaterThan(0);
    backButtonClickHandlers[backButtonClickHandlers.length - 1]();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides BackButton when suspended', () => {
    render(<Harness suspended />);
    expect(WebApp.BackButton.hide).toHaveBeenCalled();
    expect(WebApp.BackButton.show).not.toHaveBeenCalled();
  });

  it('uses custom onBack and backButtonVisible when provided', () => {
    const onBack = vi.fn();
    const onClose = vi.fn();
    render(
      <Harness
        onClose={onClose}
        onBack={onBack}
        backButtonVisible
        suspended
      />,
    );

    expect(backButtonClickHandlers.length).toBe(1);
    backButtonClickHandlers[0]();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('focuses initialFocusRef when opened', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Close sheet'));
    });
  });

  it('skips initial focus when focusOnOpen is false', async () => {
    render(<Harness focusOnOpen={false} />);

    await waitFor(() => {
      expect(document.activeElement).not.toBe(screen.getByLabelText('Close sheet'));
    });
  });

  it('traps focus: Tab from last focusable wraps to first', () => {
    render(<Harness />);

    const closeBtn = screen.getByLabelText('Close sheet');
    const actionBtn = screen.getByRole('button', { name: 'Action' });
    actionBtn.focus();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(closeBtn);
  });

  it('does not trap focus when suspended', () => {
    render(<Harness suspended />);

    const actionBtn = screen.getByRole('button', { name: 'Action' });
    actionBtn.focus();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(actionBtn);
  });

  it('marks panel as reduced-motion when enabled and prefers-reduced-motion is active', () => {
    useReducedMotionMock.mockReturnValue(true);
    render(<Harness reducedMotionAware />);

    const panel = screen.getByRole('dialog');
    expect(panel.getAttribute('data-reduced-motion')).toBe('true');
  });

  it('marks panel data-reduced-motion false when animation is enabled', () => {
    render(<Harness reducedMotionAware />);

    const panel = screen.getByRole('dialog');
    expect(panel.getAttribute('data-reduced-motion')).toBe('false');
  });
});
