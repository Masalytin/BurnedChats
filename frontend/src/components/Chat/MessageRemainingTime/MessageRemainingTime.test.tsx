// @vitest-environment happy-dom
import type { ComponentProps } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ToastProvider } from '@/components/Toast';
import type { DecryptedFileMessage, DecryptedMessage } from '@/types';
import * as formatChatDateSeparator from '@/utils/formatChatDateSeparator';
import * as useMessageCore from '@/hooks/useMessageCore';
import * as fileDownloadService from '@/services/fileDownloadService';
import { resetChatClockForTests } from '@/hooks/useChatClock';
import { MessageList } from '../MessageList';
import { MessageRemainingTime } from './MessageRemainingTime';

const NOW = new Date('2026-09-04T12:00:00.000Z').getTime();

function renderRemaining(ttlAnchorMs: number, ttlSeconds: number) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MessageRemainingTime ttlAnchorMs={ttlAnchorMs} ttlSeconds={ttlSeconds} />
    </I18nextProvider>,
  );
}

function textMessage(overrides: Partial<DecryptedMessage> = {}): DecryptedMessage {
  return {
    id: 'msg-1',
    sessionId: 'sess-1',
    fromUserId: 2,
    content: 'hello',
    timestamp: NOW - 60_000,
    ttlAnchorMs: NOW - 60_000,
    status: 'delivered',
    isOwn: false,
    type: 'text',
    ...overrides,
  };
}

function imageMessage(overrides: Partial<DecryptedFileMessage> = {}): DecryptedFileMessage {
  return {
    id: 'img-1',
    sessionId: 'sess-1',
    fromUserId: 2,
    content: '',
    timestamp: NOW - 10_000,
    ttlAnchorMs: NOW - 10_000,
    status: 'delivered',
    isOwn: false,
    type: 'image',
    fileId: 'file-1',
    fileSize: 1024,
    fileMeta: { fileName: 'pic.jpg', mimeType: 'image/jpeg' },
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

describe('MessageRemainingTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    resetChatClockForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is not in the tree when remaining is 120s', () => {
    const { container } = renderRemaining(NOW, 180);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders remaining text when remaining is 45s', () => {
    renderRemaining(NOW - 15_000, 60);

    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/0:45/);
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('is not in the tree when ttlSeconds is 0', () => {
    const { container } = renderRemaining(NOW - 50_000, 0);

    expect(container.firstChild).toBeNull();
  });

  it('does not increase MessageList render count on the shared tick', () => {
    const dateSpy = vi.spyOn(formatChatDateSeparator, 'formatChatDateSeparator');
    renderList({
      messages: [
        textMessage({
          id: 'near',
          content: 'soon gone',
          timestamp: NOW - 140_000,
          ttlAnchorMs: NOW - 140_000,
        }),
        textMessage({
          id: 'far',
          content: 'still far',
          timestamp: NOW - 10_000,
          ttlAnchorMs: NOW - 10_000,
        }),
      ],
      messageTtlSeconds: 180,
    });

    const afterMount = dateSpy.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);
    expect(screen.getByRole('status').textContent).toMatch(/0:40/);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(dateSpy.mock.calls.length).toBe(afterMount);
    expect(screen.getByRole('status').textContent).toMatch(/0:39/);
  });

  it('does not call decrypt or download on the shared tick', () => {
    const decryptSpy = vi.spyOn(useMessageCore, 'decryptTextContent');
    const downloadSpy = vi.spyOn(fileDownloadService, 'downloadThumbnail').mockResolvedValue('blob:thumb');

    renderList({
      messages: [
        textMessage({
          id: 'near',
          content: 'soon gone',
          timestamp: NOW - 140_000,
          ttlAnchorMs: NOW - 140_000,
        }),
        imageMessage({
          fileSize: 1024,
          fileMeta: { fileName: 'pic.jpg', mimeType: 'image/jpeg' },
        }),
      ],
      messageTtlSeconds: 180,
    });

    expect(screen.getByRole('status')).toBeTruthy();
    const decryptAfterMount = decryptSpy.mock.calls.length;
    const downloadAfterMount = downloadSpy.mock.calls.length;

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(decryptSpy.mock.calls.length).toBe(decryptAfterMount);
    expect(downloadSpy.mock.calls.length).toBe(downloadAfterMount);
  });
});
