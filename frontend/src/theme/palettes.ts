/**
 * BurnedChats palette catalog — hex locked in appearance-themes DESIGN.md.
 * Preview tokens feed IMP-THEME-03; chrome hex feed IMP-THEME-05.
 */

export type BurnedPaletteId = 'ember' | 'bone' | 'nocturne';

export const OUTGOING_BUBBLE_BG = '#FF6B35';
export const OUTGOING_BUBBLE_TEXT = '#FFFFFF';

export interface PaletteTokens {
  bgPrimary: string;
  bgSecondary: string;
  bgElevated: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textLink: string;
  textAccent: string;
}

export interface BurnedPalette {
  id: BurnedPaletteId;
  tokens: PaletteTokens;
  preview: {
    canvas: string;
    incomingBg: string;
    incomingText: string;
    outgoingBg: string;
    outgoingText: string;
  };
  chrome: {
    header: string;
    bottomBar: string;
  };
}

function palette(
  id: BurnedPaletteId,
  tokens: PaletteTokens,
  incoming: { bg: string; text: string },
): BurnedPalette {
  return {
    id,
    tokens,
    preview: {
      canvas: tokens.bgPrimary,
      incomingBg: incoming.bg,
      incomingText: incoming.text,
      outgoingBg: OUTGOING_BUBBLE_BG,
      outgoingText: OUTGOING_BUBBLE_TEXT,
    },
    chrome: {
      header: tokens.bgSecondary,
      bottomBar: tokens.bgSecondary,
    },
  };
}

export const BURNED_PALETTES: Record<BurnedPaletteId, BurnedPalette> = {
  ember: palette(
    'ember',
    {
      bgPrimary: '#12110F',
      bgSecondary: '#1C1A17',
      bgElevated: '#26231E',
      textPrimary: '#F5F0E8',
      textSecondary: '#9A9388',
      textMuted: '#6F6A62',
      textLink: '#FF8A5B',
      textAccent: '#FF6B35',
    },
    { bg: '#26231E', text: '#F5F0E8' },
  ),
  bone: palette(
    'bone',
    {
      bgPrimary: '#F6F1E8',
      bgSecondary: '#EBE4D6',
      bgElevated: '#FFFCF7',
      textPrimary: '#1A1612',
      textSecondary: '#6B6358',
      textMuted: '#8A8276',
      textLink: '#A83A12',
      textAccent: '#E85D28',
    },
    { bg: '#EBE4D6', text: '#1A1612' },
  ),
  nocturne: palette(
    'nocturne',
    {
      bgPrimary: '#0B0E14',
      bgSecondary: '#131821',
      bgElevated: '#1A2130',
      textPrimary: '#E8EEF7',
      textSecondary: '#8B97AB',
      textMuted: '#6B7688',
      textLink: '#7EB6FF',
      textAccent: '#FF6B35',
    },
    { bg: '#1A2130', text: '#E8EEF7' },
  ),
};

export const BURNED_PALETTE_IDS: BurnedPaletteId[] = ['ember', 'bone', 'nocturne'];
