import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, parseThemeHex, relativeLuminance, TEXT_CONTRAST_MIN } from './contrast';
import {
  BURNED_PALETTE_IDS,
  BURNED_PALETTES,
  OUTGOING_BUBBLE_BG,
  OUTGOING_BUBBLE_TEXT,
  type BurnedPaletteId,
} from './palettes';

const here = dirname(fileURLToPath(import.meta.url));

function hexContrast(foreground: string, background: string): number {
  const fg = parseThemeHex(foreground);
  const bg = parseThemeHex(background);
  if (!fg || !bg) {
    throw new Error(`invalid hex pair ${foreground} / ${background}`);
  }
  return contrastRatio(relativeLuminance(fg), relativeLuminance(bg));
}

function readCss(relativeFromTheme: string): string {
  return readFileSync(join(here, relativeFromTheme), 'utf8');
}

describe('Burned palette registry', () => {
  it('exposes ember, bone, and nocturne with preview and chrome hex', () => {
    expect(BURNED_PALETTE_IDS).toEqual(['ember', 'bone', 'nocturne']);
    for (const id of BURNED_PALETTE_IDS) {
      const palette = BURNED_PALETTES[id];
      expect(palette.id).toBe(id);
      expect(palette.preview.canvas).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(palette.chrome.header).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(palette.chrome.bottomBar).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it.each(BURNED_PALETTE_IDS)(
    '%s primary text on canvas meets 4.5:1',
    (id: BurnedPaletteId) => {
      const { tokens } = BURNED_PALETTES[id];
      expect(hexContrast(tokens.textPrimary, tokens.bgPrimary)).toBeGreaterThanOrEqual(
        TEXT_CONTRAST_MIN,
      );
    },
  );

  it('Bone link #A83A12 on #F6F1E8 meets 4.5:1', () => {
    expect(BURNED_PALETTES.bone.tokens.textLink).toBe('#A83A12');
    expect(BURNED_PALETTES.bone.tokens.bgPrimary).toBe('#F6F1E8');
    expect(hexContrast('#A83A12', '#F6F1E8')).toBeGreaterThanOrEqual(TEXT_CONTRAST_MIN);
  });

  it('Bone incoming is ink on #EBE4D6, not charcoal #242424', () => {
    const bone = BURNED_PALETTES.bone;
    expect(bone.preview.incomingBg).toBe('#EBE4D6');
    expect(bone.preview.incomingText).toBe('#1A1612');
    expect(bone.preview.incomingBg).not.toBe('#242424');
    expect(hexContrast(bone.preview.incomingText, bone.preview.incomingBg)).toBeGreaterThanOrEqual(
      TEXT_CONTRAST_MIN,
    );
  });

  it('outgoing bubble is #FF6B35 / #FFFFFF on every Burned palette', () => {
    expect(OUTGOING_BUBBLE_BG).toBe('#FF6B35');
    expect(OUTGOING_BUBBLE_TEXT).toBe('#FFFFFF');
    for (const id of BURNED_PALETTE_IDS) {
      const { preview } = BURNED_PALETTES[id];
      expect(preview.outgoingBg).toBe('#FF6B35');
      expect(preview.outgoingText).toBe('#FFFFFF');
    }
  });
});

describe('Burned palette CSS sheets', () => {
  it('defines ember, bone, and nocturne sheets with DESIGN hex', () => {
    const css = readCss('../preferences/preferencesTheme.css');

    expect(css).toContain("html[data-bc-theme='ember']");
    expect(css).toContain("html[data-bc-theme='bone']");
    expect(css).toContain("html[data-bc-theme='nocturne']");
    expect(css).not.toContain("html[data-bc-theme='dark']");

    expect(css).toMatch(/html\[data-bc-theme='ember'\][\s\S]*html\[data-bc-telegram-unsafe\]|html\[data-bc-telegram-unsafe\][\s\S]*html\[data-bc-theme='ember'\]/);

    const ember = BURNED_PALETTES.ember.tokens;
    expect(css).toContain(`--bc-bg-primary: ${ember.bgPrimary}`);
    expect(css).toContain(`--bc-text-primary: ${ember.textPrimary}`);

    const bone = BURNED_PALETTES.bone.tokens;
    expect(css).toContain(`--bc-bg-primary: ${bone.bgPrimary}`);
    expect(css).toContain(`--bc-text-link: ${bone.textLink}`);
    expect(css).toContain('--bc-message-incoming-bg: #EBE4D6');
    expect(css).toContain('--bc-message-incoming-text: #1A1612');

    const nocturne = BURNED_PALETTES.nocturne.tokens;
    expect(css).toContain(`--bc-bg-primary: ${nocturne.bgPrimary}`);
    expect(css).toContain(`--bc-text-link: ${nocturne.textLink}`);

    expect(css).toContain('--bc-message-outgoing-bg: #FF6B35');
    expect(css).toContain('--bc-message-outgoing-text: #FFFFFF');
  });

  it('does not keep #242424 elevated as a theme.css canon token', () => {
    const themeCss = readCss('../styles/theme.css');
    expect(themeCss).not.toMatch(/--bc-bg-elevated:\s*#242424/);
    expect(themeCss).toContain(
      '--bc-bg-elevated: color-mix(in srgb, var(--bc-text-primary) 8%, var(--bc-bg-primary))',
    );
  });
});
