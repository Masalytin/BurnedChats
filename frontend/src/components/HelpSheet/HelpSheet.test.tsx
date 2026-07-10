// @vitest-environment happy-dom
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { HelpSheet } from './HelpSheet';
import { HelpTrigger } from './HelpTrigger';

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

const TEST_TOPIC = 'test.topic';

function addTestHelpResources(lang = 'en') {
  i18n.addResourceBundle(
    lang,
    'translation',
    {
      help: {
        common: { trigger: 'What is this?' },
        test: {
          topic: {
            title: 'Test help title',
            body: ['First paragraph.', 'Second paragraph.'],
          },
        },
      },
    },
    true,
    true,
  );
}

function renderHelpSheet(
  props: Partial<{
    open: boolean;
    onClose: () => void;
    topicKey: string;
  }> = {},
) {
  const onClose = props.onClose ?? vi.fn();
  const result = render(
    <I18nextProvider i18n={i18n}>
      <HelpSheet
        open={props.open ?? true}
        onClose={onClose}
        topicKey={props.topicKey ?? TEST_TOPIC}
      />
    </I18nextProvider>,
  );
  return { ...result, onClose };
}

describe('HelpSheet', () => {
  beforeEach(() => {
    addTestHelpResources();
  });

  afterEach(() => {
    vi.clearAllMocks();
    useReducedMotionMock.mockReturnValue(false);
    backButtonClickHandlers.length = 0;
  });

  it('renders dialog with aria-modal and aria-labelledby when open', () => {
    renderHelpSheet();

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();

    const title = screen.getByRole('heading', { level: 2 });
    expect(title.textContent).toBe('Test help title');
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
  });

  it('renders body paragraphs from i18n returnObjects array', () => {
    renderHelpSheet();

    expect(screen.getByText('First paragraph.')).toBeTruthy();
    expect(screen.getByText('Second paragraph.')).toBeTruthy();
  });

  it('does not render when closed', () => {
    renderHelpSheet({ open: false });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on backdrop click', () => {
    const onClose = vi.fn();
    renderHelpSheet({ onClose });

    const backdrop = document.querySelector('.help-sheet-backdrop');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when clicking inside the sheet panel', () => {
    const onClose = vi.fn();
    renderHelpSheet({ onClose });

    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    renderHelpSheet({ onClose });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on close button click', () => {
    const onClose = vi.fn();
    renderHelpSheet({ onClose });

    fireEvent.click(screen.getByLabelText(i18n.t('aria.closeDialog')));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focuses close button when opened', async () => {
    renderHelpSheet();

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByLabelText(i18n.t('aria.closeDialog')),
      );
    });
  });

  it('traps focus: Tab from last focusable wraps to first', () => {
    renderHelpSheet();

    const closeBtn = screen.getByLabelText(i18n.t('aria.closeDialog'));
    closeBtn.focus();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(closeBtn);
  });

  it('marks sheet as reduced-motion when prefers-reduced-motion is active', () => {
    useReducedMotionMock.mockReturnValue(true);
    renderHelpSheet();

    const sheet = document.querySelector('.help-sheet-panel');
    expect(sheet?.getAttribute('data-reduced-motion')).toBe('true');
  });

  it('closes via Telegram BackButton when registered', () => {
    const onClose = vi.fn();
    renderHelpSheet({ onClose });

    expect(backButtonClickHandlers.length).toBeGreaterThan(0);
    backButtonClickHandlers[backButtonClickHandlers.length - 1]();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders without crashing when topic keys are missing', () => {
    renderHelpSheet({ topicKey: 'missing.topic' });

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('');
  });

  it('uses scrollable body container for long content', () => {
    i18n.addResourceBundle(
      'en',
      'translation',
      {
        help: {
          test: {
            topic: {
              title: 'Long topic',
              body: Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}.`),
            },
          },
        },
      },
      true,
      true,
    );
    renderHelpSheet();

    const body = document.querySelector('.help-sheet-body');
    expect(body).toBeTruthy();
    expect(body?.className).toBe('help-sheet-body');
    expect(body?.children.length).toBe(40);
  });
});

describe('HelpTrigger', () => {
  beforeEach(() => {
    addTestHelpResources();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls onOpen when clicked', () => {
    const onOpen = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <HelpTrigger onOpen={onOpen} />
      </I18nextProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /what is this/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('uses custom label when provided', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <HelpTrigger onOpen={vi.fn()} label="Custom help" />
      </I18nextProvider>,
    );

    expect(screen.getByRole('button', { name: 'Custom help' })).toBeTruthy();
  });
});

describe('HelpTrigger + HelpSheet integration', () => {
  beforeEach(() => {
    addTestHelpResources();
  });

  it('opens HelpSheet when trigger is clicked', () => {
    function Harness() {
      const [helpOpen, setHelpOpen] = useState(false);
      return (
        <I18nextProvider i18n={i18n}>
          <HelpTrigger onOpen={() => setHelpOpen(true)} />
          <HelpSheet
            open={helpOpen}
            onClose={() => setHelpOpen(false)}
            topicKey={TEST_TOPIC}
          />
        </I18nextProvider>
      );
    }

    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /what is this/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
