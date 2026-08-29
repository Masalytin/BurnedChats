// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { HomeTour } from './HomeTour';

const homePageSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../pages/HomePage.tsx'),
  'utf-8',
);

vi.mock('@twa-dev/sdk', () => ({
  default: {
    initData: 'test-init-data',
    initDataUnsafe: { user: { language_code: 'en' } },
    CloudStorage: { getItem: () => {} },
    BackButton: {
      show: vi.fn(),
      hide: vi.fn(),
      onClick: vi.fn(),
      offClick: vi.fn(),
    },
  },
}));

vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return {
    ...actual,
    useReducedMotion: () => false,
  };
});

const TITLES = {
  search: 'Tour search title',
  createRoom: 'Tour create-room title',
  myQr: 'Tour my-qr title',
};

function addTourResources() {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      help: {
        tour: {
          common: { next: 'Next', skip: 'Skip tour', done: 'Done' },
          homeSearch: { title: TITLES.search, body: ['Search body'] },
          homeCreateRoom: { title: TITLES.createRoom, body: ['Create body'] },
          homeMyQr: { title: TITLES.myQr, body: ['QR body'] },
        },
      },
    },
    true,
    true,
  );
}

function TourTargets({ includeMyQr = true }: { includeMyQr?: boolean }) {
  return (
    <main className="layout-main">
      <form data-tour="search">
        <input aria-label="Search" />
      </form>
      <div className="home-rooms-actions">
        <button type="button" data-tour="create-room">
          Create Room
        </button>
      </div>
      {includeMyQr ? (
        <button type="button" data-tour="my-qr">
          My QR
        </button>
      ) : null}
    </main>
  );
}

function renderTour(
  props: Partial<{
    open: boolean;
    onComplete: () => void;
    onSkipAll: () => void;
    includeMyQr: boolean;
  }> = {},
) {
  const onComplete = props.onComplete ?? vi.fn();
  const onSkipAll = props.onSkipAll ?? vi.fn();
  const result = render(
    <I18nextProvider i18n={i18n}>
      <TourTargets includeMyQr={props.includeMyQr ?? true} />
      <HomeTour
        open={props.open ?? true}
        onComplete={onComplete}
        onSkipAll={onSkipAll}
      />
    </I18nextProvider>,
  );
  return { ...result, onComplete, onSkipAll };
}

describe('HomeTour', () => {
  beforeEach(() => {
    addTourResources();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('walks search → create-room → my-qr and changes topicKey', async () => {
    renderTour();

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(TITLES.search);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(TITLES.createRoom);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(TITLES.myQr);
    });
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /skip step/i })).toBeNull();
  });

  it('skips a missing my-qr target and still completes', async () => {
    const { onComplete } = renderTour({ includeMyQr: false });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(TITLES.search);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(TITLES.createRoom);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the create-room control when overlay or hole is clicked', async () => {
    const onCreateRoom = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <main className="layout-main">
          <form data-tour="search">
            <input aria-label="Search" />
          </form>
          <button type="button" data-tour="create-room" onClick={onCreateRoom}>
            Create Room
          </button>
        </main>
        <HomeTour open onComplete={vi.fn()} onSkipAll={vi.fn()} />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2 })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(TITLES.createRoom);
    });

    fireEvent.click(document.querySelector('.coachmark-overlay')!);
    fireEvent.click(document.querySelector('.coachmark-hole')!);
    expect(onCreateRoom).not.toHaveBeenCalled();
  });

  it('exposes only Skip tour, not skip-step', async () => {
    const { onSkipAll } = renderTour();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Skip tour' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: /skip step/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    expect(onSkipAll).toHaveBeenCalledTimes(1);
  });

  it('does not render when closed', () => {
    renderTour({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('HomePage data-tour anchors', () => {
  it('places a single create-room tour id on rooms-actions, not the empty-state CTA', () => {
    expect(homePageSrc.match(/data-tour="create-room"/g)?.length).toBe(1);
    const actionsStart = homePageSrc.indexOf('home-rooms-actions');
    const emptyStart = homePageSrc.indexOf('home-empty-state');
    expect(actionsStart).toBeGreaterThanOrEqual(0);
    expect(emptyStart).toBeGreaterThan(actionsStart);
    expect(homePageSrc.slice(actionsStart, emptyStart)).toContain('data-tour="create-room"');
    expect(homePageSrc.slice(emptyStart)).not.toContain('data-tour="create-room"');
  });

  it('marks search and my-qr only — three tour ids total', () => {
    expect(homePageSrc.match(/data-tour="/g)?.length).toBe(3);
    expect(homePageSrc).toContain('data-tour="search"');
    expect(homePageSrc).toContain('data-tour="my-qr"');
    expect(homePageSrc).not.toMatch(/onJoinViaQr[\s\S]{0,180}data-tour=/);
    expect(homePageSrc).not.toMatch(/onScanDmQr[\s\S]{0,180}data-tour=/);
  });
});
