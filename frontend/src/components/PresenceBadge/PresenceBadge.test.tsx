// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { applyPresenceEvent, resetPresenceStore } from '../../presence/presenceStore';
import { PresenceBadge } from './PresenceBadge';

describe('PresenceBadge', () => {
  beforeEach(() => {
    resetPresenceStore();
  });

  it('does not hardcode Connected; shows snapshot offline then live online', () => {
    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <PresenceBadge internalId="peer-1" snapshotOnline={false} />
      </I18nextProvider>,
    );

    expect(screen.getByText(/offline/i)).toBeTruthy();
    expect(screen.queryByText(/connected/i)).toBeNull();

    applyPresenceEvent('peer-1', true, Date.now());
    rerender(
      <I18nextProvider i18n={i18n}>
        <PresenceBadge internalId="peer-1" snapshotOnline={false} />
      </I18nextProvider>,
    );

    expect(screen.getByText(/online/i)).toBeTruthy();
  });
});
