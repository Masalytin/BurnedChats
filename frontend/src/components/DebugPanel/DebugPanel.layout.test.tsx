// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@twa-dev/sdk', () => ({
  default: {
    initData: '',
    initDataUnsafe: { user: { language_code: 'en' } },
    platform: 'ios',
    version: '7.0',
    ready: vi.fn(),
    expand: vi.fn(),
    close: vi.fn(),
  },
}));

import { DebugPanel } from './DebugPanel';

const CSS_PATH = resolve(process.cwd(), 'src/components/DebugPanel/DebugPanel.css');

function panelCss(): string {
  return readFileSync(CSS_PATH, 'utf8');
}

function block(css: string, selector: string): string {
  const idx = css.indexOf(selector);
  expect(idx).toBeGreaterThanOrEqual(0);
  const start = css.indexOf('{', idx);
  const end = css.indexOf('}', start);
  return css.slice(start, end + 1);
}

describe('DebugPanel mobile tab chrome (overflow)', () => {
  beforeEach(() => {
    localStorage.setItem('debug-panel-expanded', 'true');
    localStorage.setItem('debug-panel-minimized', 'false');
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('keeps overflow-x hidden on the sheet so header chrome does not pan', () => {
    const content = block(panelCss(), '.debug-content');
    expect(content).toMatch(/overflow-x:\s*hidden/);
  });

  it('wraps tab buttons instead of overflowing Advanced/Logs off-screen', () => {
    const css = panelCss();
    const tabs = block(css, '.debug-tabs');
    expect(tabs).toMatch(/flex-wrap:\s*wrap/);
    expect(css).toMatch(/@media \(max-width:\s*540px\)/);
    expect(css).toMatch(/calc\(\(100% - 8px\) \/ 3\)/);
  });

  it('shows all six tabs plus minimize/close when expanded', () => {
    render(
      <DebugPanel
        isConnected={false}
        isConnecting={false}
        reconnectAttempt={0}
        wsError={null}
      />
    );

    expect(screen.getByRole('button', { name: /Advanced/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Logs/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Status/ })).toBeTruthy();
    expect(screen.getByTitle('Minimize to floating button')).toBeTruthy();
    expect(screen.getByTitle('Close panel')).toBeTruthy();
  });
});
