// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdvancedTab } from './AdvancedTab';

describe('AdvancedTab dead Phase 5 UI (IMP-DBGPANEL-10)', () => {
  it('does not offer Mock or Metrics sub-tabs; Replay remains', () => {
    render(<AdvancedTab />);

    expect(screen.queryByRole('button', { name: /Mock/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Metrics/i })).toBeNull();
    expect(screen.queryByText('Mock Server')).toBeNull();
    expect(screen.queryByText('Timing')).toBeNull();
    expect(screen.getByText('Replay')).toBeTruthy();
  });

  it('does not change the Settings debugPanelEnabled toggle', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/pages/SettingsPage.tsx'),
      'utf8'
    );
    expect(src).toMatch(/id="settings-debug-panel"/);
    expect(src).toMatch(/prefs\.debugPanelEnabled/);
  });
});
