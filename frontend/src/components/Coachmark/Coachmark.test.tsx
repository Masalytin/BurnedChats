// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { Coachmark } from './Coachmark';

const coachmarkDir = path.dirname(fileURLToPath(import.meta.url));
const coachmarkCss = readFileSync(path.join(coachmarkDir, 'Coachmark.css'), 'utf-8');
const themeCss = readFileSync(
  path.join(coachmarkDir, '../../styles/theme.css'),
  'utf-8',
);
const helpSheetCss = readFileSync(
  path.join(coachmarkDir, '../HelpSheet/HelpSheet.css'),
  'utf-8',
);

function cssBlock(css: string, selector: string): string {
  const idx = css.indexOf(selector);
  expect(idx).toBeGreaterThanOrEqual(0);
  const start = css.indexOf('{', idx);
  const end = css.indexOf('}', start);
  return css.slice(start, end + 1);
}

function declaredZIndex(css: string, selector: string): number {
  const match = cssBlock(css, selector).match(/z-index:\s*(\d+)/);
  expect(match).toBeTruthy();
  return Number(match![1]);
}

function themeToken(name: string): number {
  const match = themeCss.match(new RegExp(`${name}:\\s*(\\d+)`));
  expect(match).toBeTruthy();
  return Number(match![1]);
}

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

const BUTTON_LABELS = {
  next: 'Coachmark Next',
  skip: 'Coachmark Skip tour',
  done: 'Coachmark Done',
};

function addTestHelpResources(lang = 'en') {
  i18n.addResourceBundle(
    lang,
    'translation',
    {
      help: {
        test: {
          topic: {
            title: 'Coachmark test title',
            body: ['Coachmark first paragraph.', 'Coachmark second paragraph.'],
          },
        },
        tour: {
          common: {
            next: BUTTON_LABELS.next,
            skip: BUTTON_LABELS.skip,
            done: BUTTON_LABELS.done,
          },
        },
      },
    },
    true,
    true,
  );
}

function mockTargetRect(el: HTMLElement, rect: Partial<DOMRect> = {}) {
  const box = {
    x: 20,
    y: 40,
    width: 120,
    height: 36,
    top: 40,
    left: 20,
    right: 140,
    bottom: 76,
    toJSON: () => ({}),
    ...rect,
  };
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(box as DOMRect);
}

function renderCoachmark(
  props: Partial<{
    target: HTMLElement | null;
    topicKey: string;
    stepIndex: number;
    stepCount: number;
    onNext: () => void;
    onSkipAll: () => void;
  }> = {},
) {
  const onNext = props.onNext ?? vi.fn();
  const onSkipAll = props.onSkipAll ?? vi.fn();
  const result = render(
    <I18nextProvider i18n={i18n}>
      <Coachmark
        target={props.target === undefined ? null : props.target}
        topicKey={props.topicKey ?? TEST_TOPIC}
        stepIndex={props.stepIndex ?? 0}
        stepCount={props.stepCount ?? 3}
        onNext={onNext}
        onSkipAll={onSkipAll}
      />
    </I18nextProvider>,
  );
  return { ...result, onNext, onSkipAll };
}

describe('Coachmark', () => {
  beforeEach(() => {
    addTestHelpResources();
  });

  afterEach(() => {
    vi.clearAllMocks();
    useReducedMotionMock.mockReturnValue(false);
    backButtonClickHandlers.length = 0;
  });

  it('renders without throwing when target is null and does not draw a hole', () => {
    expect(() => renderCoachmark({ target: null })).not.toThrow();

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.querySelector('.coachmark-hole')).toBeNull();
  });

  it('calls onNext exactly once per Next click', () => {
    const { onNext } = renderCoachmark();

    fireEvent.click(screen.getByRole('button', { name: BUTTON_LABELS.next }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('calls onSkipAll exactly once per Skip click', () => {
    const { onSkipAll } = renderCoachmark();

    fireEvent.click(screen.getByRole('button', { name: BUTTON_LABELS.skip }));
    expect(onSkipAll).toHaveBeenCalledTimes(1);
  });

  it('calls onSkipAll exactly once on Escape', () => {
    const { onSkipAll } = renderCoachmark();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onSkipAll).toHaveBeenCalledTimes(1);
  });

  it('calls onSkipAll exactly once via Telegram BackButton', () => {
    const { onSkipAll } = renderCoachmark();

    expect(backButtonClickHandlers.length).toBeGreaterThan(0);
    backButtonClickHandlers[backButtonClickHandlers.length - 1]();
    expect(onSkipAll).toHaveBeenCalledTimes(1);
  });

  it('does not click the DOM target when overlay or hole is clicked', () => {
    const target = document.createElement('button');
    target.type = 'button';
    target.textContent = 'Spotlight target';
    const onTargetClick = vi.fn();
    target.addEventListener('click', onTargetClick);
    document.body.appendChild(target);
    mockTargetRect(target);

    renderCoachmark({ target });

    const overlay = document.querySelector('.coachmark-overlay');
    const hole = document.querySelector('.coachmark-hole');
    expect(overlay).toBeTruthy();
    expect(hole).toBeTruthy();

    fireEvent.click(overlay!);
    fireEvent.click(hole!);
    expect(onTargetClick).not.toHaveBeenCalled();
    target.remove();
  });

  it('marks the dialog as reduced-motion when prefers-reduced-motion is active', () => {
    useReducedMotionMock.mockReturnValue(true);
    renderCoachmark();

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('data-reduced-motion')).toBe('true');
    expect(coachmarkCss).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(coachmarkCss).toMatch(/animation:\s*none/);
  });

  it('declares coachmark overlay z-index above HelpSheet (10100)', () => {
    const helpZ = declaredZIndex(helpSheetCss, '.help-sheet-backdrop');
    const overlayZ = themeToken('--bc-z-coachmark');
    const tooltipZ = themeToken('--bc-z-coachmark-tooltip');

    expect(helpZ).toBe(10100);
    expect(overlayZ).toBeGreaterThan(helpZ);
    expect(tooltipZ).toBeGreaterThan(overlayZ);
    expect(coachmarkCss).toMatch(/z-index:\s*var\(--bc-z-coachmark\)/);
    expect(coachmarkCss).toMatch(/z-index:\s*var\(--bc-z-coachmark-tooltip\)/);
  });

  it('exposes dialog a11y and focuses the primary CTA', async () => {
    renderCoachmark();

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      'Coachmark test title',
    );
    expect(screen.getByText('Coachmark first paragraph.')).toBeTruthy();

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: BUTTON_LABELS.next }),
      );
    });
  });

  it('shows Done instead of Next on the last step and still calls onNext', () => {
    const { onNext } = renderCoachmark({ stepIndex: 2, stepCount: 3 });

    expect(screen.queryByRole('button', { name: BUTTON_LABELS.next })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: BUTTON_LABELS.done }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('keeps the tooltip and Next inside a short viewport when the hole is near the bottom', () => {
    const viewportHeight = 480;
    const tooltipHeight = 180;
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: viewportHeight,
    });
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 360,
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        offsetTop: 0,
        offsetLeft: 0,
        width: 360,
        height: viewportHeight,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    const offsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetHeight',
    );
    const offsetWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetWidth',
    );
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        if ((this as HTMLElement).classList?.contains('coachmark-tooltip')) {
          return tooltipHeight;
        }
        return offsetHeight?.get?.call(this) ?? 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() {
        if ((this as HTMLElement).classList?.contains('coachmark-tooltip')) {
          return 280;
        }
        return offsetWidth?.get?.call(this) ?? 0;
      },
    });

    const target = document.createElement('button');
    target.type = 'button';
    document.body.appendChild(target);
    mockTargetRect(target, {
      top: 400,
      left: 16,
      width: 120,
      height: 40,
      bottom: 440,
    });

    try {
      renderCoachmark({ target });
      const tooltip = screen.getByRole('dialog');
      const top = Number.parseFloat(tooltip.style.top);
      expect(Number.isFinite(top)).toBe(true);
      expect(top).toBeLessThan(400);
      expect(top + tooltipHeight).toBeLessThanOrEqual(viewportHeight);
      expect(screen.getByRole('button', { name: BUTTON_LABELS.next })).toBeTruthy();
    } finally {
      target.remove();
      if (offsetHeight) {
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
      }
      if (offsetWidth) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth);
      }
    }
  });

  it('declares a max-height so a tall tooltip can scroll to Next', () => {
    expect(coachmarkCss).toMatch(/max-height:\s*calc\(var\(--app-height/);
    expect(coachmarkCss).toMatch(/overflow-y:\s*auto/);
    expect(cssBlock(coachmarkCss, '.coachmark-tooltip__actions')).toMatch(
      /position:\s*sticky/,
    );
  });

  it('portals to document.body so a parent stacking context cannot trap it', () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <div className="layout">
          <main className="layout-main">
            <Coachmark
              target={null}
              topicKey={TEST_TOPIC}
              stepIndex={0}
              stepCount={3}
              onNext={vi.fn()}
              onSkipAll={vi.fn()}
            />
          </main>
        </div>
      </I18nextProvider>,
    );

    const overlay = document.querySelector('.coachmark-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay?.parentElement).toBe(document.body);
    expect(container.querySelector('.coachmark-overlay')).toBeNull();
  });
});
