// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StompMessagesState } from '../hooks/useDebugState';
import { MessagesTab } from './MessagesTab';

const emptyStomp: StompMessagesState = {
  messages: [],
  correlatedMessages: [],
  filter: { direction: 'all', destination: null },
};

describe('MessagesTab Pairs view (IMP-DBGPANEL-08)', () => {
  it('does not offer a Pairs toggle because correlation is not wired', () => {
    render(<MessagesTab state={emptyStomp} />);

    expect(screen.queryByRole('button', { name: 'Pairs' })).toBeNull();
    expect(screen.queryByText('Request/Response Pairs')).toBeNull();
    expect(screen.getByText(/correlation is not wired/i)).toBeTruthy();
  });
});
