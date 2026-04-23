// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageActionMenu } from '../MessageActionMenu';

describe('MessageActionMenu', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders and invokes onClose on Escape', () => {
    const onClose = vi.fn();
    render(
      <MessageActionMenu
        anchor={new DOMRect(10, 10, 100, 40)}
        actions={[
          { id: 'select', label: 'Select', icon: <span />, onClick: () => undefined },
        ]}
        onClose={onClose}
      />,
    );
    expect(screen.getByTestId('message-action-menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape', cancelable: true, bubbles: true });
    expect(onClose).toHaveBeenCalled();
  });
});
