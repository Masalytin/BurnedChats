// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDefaultPreferences,
  savePreferences,
} from '@/preferences/preferencesStorage';
import { clearStompMessages, logStompMessage } from './hooks/useDebugState';

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
    clearStompMessages();
    localStorage.clear();
  });

  it('keeps overflow-x hidden on the sheet so header chrome does not pan', () => {
    const content = block(panelCss(), '.debug-content');
    expect(content).toMatch(/overflow-x:\s*hidden/);
  });

  it('wraps tab buttons instead of overflowing Logs off-screen', () => {
    const css = panelCss();
    const tabs = block(css, '.debug-tabs');
    expect(tabs).toMatch(/flex-wrap:\s*wrap/);
    expect(css).toMatch(/@media \(max-width:\s*540px\)/);
    expect(css).toMatch(/calc\(\(100% - 8px\) \/ 3\)/);
  });

  it('shows Status/Flow/Messages/Crypto/Logs plus minimize/close; no Advanced', () => {
    render(
      <DebugPanel
        isConnected={false}
        isConnecting={false}
        reconnectAttempt={0}
        wsError={null}
      />
    );

    expect(screen.queryByRole('button', { name: /Advanced/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Status/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Flow/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Messages/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Crypto/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Logs/ })).toBeTruthy();
    expect(screen.getByTitle('Minimize to floating button')).toBeTruthy();
    expect(screen.getByTitle('Close panel')).toBeTruthy();
  });

  it('falls back when persisted tab is the removed Advanced id', () => {
    localStorage.setItem('debug-panel-tab', 'advanced');
    render(
      <DebugPanel
        isConnected={false}
        isConnecting={false}
        reconnectAttempt={0}
        wsError={null}
      />
    );

    expect(screen.queryByRole('button', { name: /Advanced/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Status/ })).toBeTruthy();
  });

  it('Export State copies STOMP dest/command/size/timestamp without bodies', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    savePreferences({ ...getDefaultPreferences(), debugPanelEnabled: true });
    logStompMessage(
      'outgoing',
      '/app/session.create',
      'SEND',
      {},
      { secretExpectedAnswer: 'hunter2' }
    );

    render(
      <DebugPanel
        isConnected={false}
        isConnecting={false}
        reconnectAttempt={0}
        wsError={null}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Logs/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export State/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const json = JSON.parse(writeText.mock.calls[0][0] as string) as {
      stomp: Array<Record<string, unknown>>;
    };
    expect(json.stomp).toHaveLength(1);
    expect(json.stomp[0]).toMatchObject({
      direction: 'outgoing',
      destination: '/app/session.create',
      command: 'SEND',
    });
    expect(json.stomp[0]).toHaveProperty('size');
    expect(json.stomp[0]).toHaveProperty('timestamp');
    expect(json.stomp[0]).not.toHaveProperty('body');
    expect(JSON.stringify(json)).not.toContain('hunter2');
  });
});
