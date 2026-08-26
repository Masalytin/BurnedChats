// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { FooterSection } from './FooterSection';

function renderFooter() {
  return render(
    <MemoryRouter>
      <FooterSection />
    </MemoryRouter>,
  );
}

describe('FooterSection token discovery', () => {
  it('adds a third footer-link BURN to /token without opening a new tab', () => {
    renderFooter();

    const burn = screen.getByRole('link', { name: 'BURN' });
    expect(burn.getAttribute('href')).toBe('/token');
    expect(burn.getAttribute('target')).toBeNull();
    expect(burn.className.split(/\s+/)).toContain('footer-link');
    expect(burn.className.split(/\s+/)).not.toContain('hero-cta');

    const footerLinks = document.querySelectorAll('.footer-link');
    expect(footerLinks).toHaveLength(3);
    expect(footerLinks[2]).toBe(burn);
  });

  it('keeps GitHub and Docs as external _blank links', () => {
    renderFooter();

    const github = screen.getByRole('link', { name: /GitHub/ });
    const docs = screen.getByRole('link', { name: /Docs/ });
    expect(github.getAttribute('target')).toBe('_blank');
    expect(docs.getAttribute('target')).toBe('_blank');
  });

  it('keeps exactly two hero-cta buttons (Telegram / Web)', () => {
    renderFooter();

    expect(document.querySelectorAll('.hero-cta')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Open Burned Chats in Telegram' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Burned Chats Web App' })).toBeTruthy();
  });
});
