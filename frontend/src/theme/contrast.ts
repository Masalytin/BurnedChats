export type TelegramThemeStatus = 'ok' | 'unsafe';

export interface TelegramThemeParams {
  bg_color?: string;
  text_color?: string;
  button_color?: string;
  button_text_color?: string;
  hint_color?: string;
}

/** WCAG 1.4.3 AA for body text (bg + text). */
export const TEXT_CONTRAST_MIN = 4.5;

/**
 * WCAG 1.4.11 UI / large-text floor for button + button_text.
 * Official Telegram button hexes fail 4.5:1 against white label text.
 */
export const BUTTON_CONTRAST_MIN = 3;

/** Soft hint check — never flips the status to unsafe. */
export const HINT_CONTRAST_MIN = 3;

interface Srgb {
  r: number;
  g: number;
  b: number;
}

export function parseThemeHex(value: string | undefined): Srgb | null {
  if (!value) {
    return null;
  }
  const raw = value.trim();
  const hex = raw.startsWith('#') ? raw.slice(1) : raw;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return {
      r: Number.parseInt(hex[0] + hex[0], 16),
      g: Number.parseInt(hex[1] + hex[1], 16),
      b: Number.parseInt(hex[2] + hex[2], 16),
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex) || /^[0-9a-fA-F]{8}$/.test(hex)) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }
  return null;
}

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }: Srgb): number {
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

export function contrastRatio(luminanceA: number, luminanceB: number): number {
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

function pairContrast(a: Srgb, b: Srgb): number {
  return contrastRatio(relativeLuminance(a), relativeLuminance(b));
}

export function evaluateTelegramTheme(
  params?: TelegramThemeParams | null,
): TelegramThemeStatus {
  if (!params) {
    return 'unsafe';
  }

  const bg = parseThemeHex(params.bg_color);
  const text = parseThemeHex(params.text_color);
  const button = parseThemeHex(params.button_color);
  const buttonText = parseThemeHex(params.button_text_color);

  if (!bg || !text || !button || !buttonText) {
    return 'unsafe';
  }

  if (pairContrast(bg, text) < TEXT_CONTRAST_MIN) {
    return 'unsafe';
  }

  if (pairContrast(button, buttonText) < BUTTON_CONTRAST_MIN) {
    return 'unsafe';
  }

  // hint_color is checked at HINT_CONTRAST_MIN in docs only — never a blocker.
  return 'ok';
}
