// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'jest-axe';
import { MessageActionMenu } from '../MessageActionMenu/MessageActionMenu';

describe('message actions a11y (axe)', () => {
  it('MessageActionMenu has no automatic axe violations', async () => {
    const { container } = render(
      <MessageActionMenu
        anchor={new DOMRect(10, 10, 100, 40)}
        actions={[
          { id: 'copy', label: 'Copy', icon: <span />, onClick: () => undefined },
        ]}
        onClose={() => undefined}
        labelledById="test-msg-label"
      />,
    );
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
