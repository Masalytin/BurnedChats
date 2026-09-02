// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { resetPresenceStore } from '../../presence/presenceStore';
import { IncomingRequestView } from './IncomingRequestView';

describe('IncomingRequestView presence', () => {
  beforeEach(() => {
    resetPresenceStore();
  });

  it('does not hardcode Connected and seeds from fromOnline', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <IncomingRequestView
          request={{
            id: 'sess-1',
            fromInternalId: 'peer-1',
            fromName: 'Alice',
            createdAt: Date.now(),
            expiresAt: Date.now() + 60_000,
            fromOnline: false,
          }}
          onAccept={vi.fn()}
          onReject={vi.fn()}
        />
      </I18nextProvider>,
    );

    expect(screen.queryByText(/connected/i)).toBeNull();
    expect(screen.getByText(/offline/i)).toBeTruthy();
  });
});
