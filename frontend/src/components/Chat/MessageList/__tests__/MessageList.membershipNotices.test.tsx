// @vitest-environment happy-dom
import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ToastProvider } from '@/components/Toast';
import { useMessageSelection } from '@/hooks/useMessageSelection';
import type { DecryptedMessage } from '@/types';
import ar from '@/i18n/locales/ar.json';
import de from '@/i18n/locales/de.json';
import en from '@/i18n/locales/en.json';
import es from '@/i18n/locales/es.json';
import fr from '@/i18n/locales/fr.json';
import ru from '@/i18n/locales/ru.json';
import uk from '@/i18n/locales/uk.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import { MessageList } from '../MessageList';

const NOTICE = {
  id: 'sys:ROOM_MEMBER_JOINED:peer-1:1700000000000',
  kind: 'joined' as const,
  memberInternalId: 'peer-1',
  displayName: 'Alice',
  timestamp: Date.now(),
};

function textMessage(overrides: Partial<DecryptedMessage> = {}): DecryptedMessage {
  return {
    id: 'msg-1',
    sessionId: 'room-1',
    fromUserId: 2,
    content: 'hello',
    timestamp: Date.now() - 60_000,
    status: 'delivered',
    isOwn: false,
    type: 'text',
    ...overrides,
  };
}

function renderList(
  props: Partial<ComponentProps<typeof MessageList>> & {
    messages?: DecryptedMessage[];
  } = {},
) {
  const { messages = [], ...rest } = props;
  return render(
    <I18nextProvider i18n={i18n}>
      <ToastProvider>
        <MessageList
          messages={messages}
          peerDisplayName="Peer"
          {...rest}
        />
      </ToastProvider>
    </I18nextProvider>,
  );
}

describe('MessageList membership notices (IMP-RMSYS-02)', () => {
  it('shows a notice row instead of empty-state when messages are empty', () => {
    renderList({ membershipNotices: [NOTICE] });

    expect(screen.queryByText(i18n.t('chat.emptyMessages'))).toBeNull();
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe(i18n.t('room.chat.system.joined', { name: 'Alice' }));
  });

  it('DM regression: empty messages and default notices still show empty-state', () => {
    renderList({ messages: [] });

    expect(screen.getByText(i18n.t('chat.emptyMessages'))).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not put a notice in selection and has no action menu / long-press', () => {
    function Harness() {
      const selection = useMessageSelection();
      return (
        <>
          <MessageList
            messages={[textMessage()]}
            membershipNotices={[NOTICE]}
            peerDisplayName="Peer"
            selection={selection}
          />
          <div data-testid="selected-count">{selection.count}</div>
          <div data-testid="selected-has-notice">
            {selection.isSelected(NOTICE.id) ? 'yes' : 'no'}
          </div>
        </>
      );
    }

    render(
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <Harness />
        </ToastProvider>
      </I18nextProvider>,
    );

    const status = screen.getByRole('status');
    fireEvent.click(status);
    fireEvent.contextMenu(status);

    expect(screen.getByTestId('selected-count').textContent).toBe('0');
    expect(screen.getByTestId('selected-has-notice').textContent).toBe('no');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('uses fallbackPeer when displayName is empty', () => {
    renderList({
      membershipNotices: [{ ...NOTICE, displayName: undefined }],
    });

    expect(screen.getByRole('status').textContent).toBe(
      i18n.t('room.chat.system.joined', { name: i18n.t('room.chat.fallbackPeer') }),
    );
  });
});

describe('room.chat.system i18n keys ×8 (IMP-RMSYS-02)', () => {
  const locales = { en, ru, de, fr, es, ar, 'zh-CN': zhCN, uk } as const;
  const kinds = ['joined', 'left', 'removed'] as const;

  it('defines non-empty room.chat.system.* in every locale', () => {
    for (const [lang, catalog] of Object.entries(locales)) {
      const system = (catalog as typeof en).room.chat.system;
      expect(system, `${lang} room.chat.system`).toBeDefined();
      for (const kind of kinds) {
        const value = system[kind];
        expect(typeof value, `${lang} room.chat.system.${kind}`).toBe('string');
        expect(value.length, `${lang} room.chat.system.${kind}`).toBeGreaterThan(0);
        expect(value).toContain('{{name}}');
      }
    }
  });

  it('uses masculine default RU copy without (ась)', () => {
    expect(ru.room.chat.system.joined).toBe('{{name}} присоединился к комнате');
    expect(ru.room.chat.system.left).toBe('{{name}} покинул комнату');
    expect(ru.room.chat.system.removed).toBe('{{name}} удалён из комнаты');
  });
});
