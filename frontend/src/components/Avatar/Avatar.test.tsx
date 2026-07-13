// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';

describe('Avatar', () => {
  it('shows initials when src is missing', () => {
    render(<Avatar name="John Doe" />);
    expect(screen.getByText('JD')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('falls back to initials when the Telegram photo URL fails to load', () => {
    render(
      <Avatar
        name="John Doe"
        src="https://t.me/i/userpic/320/expired.svg"
      />,
    );

    const img = screen.getByRole('img');
    fireEvent.error(img);

    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('JD')).toBeTruthy();
  });
});
