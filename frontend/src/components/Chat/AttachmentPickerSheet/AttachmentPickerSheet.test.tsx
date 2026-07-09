// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import {
  ATTACH_PICKER_ACCEPT_PHOTO,
  AttachmentPickerSheet,
} from './AttachmentPickerSheet';

const useReducedMotionMock = vi.fn(() => false);

vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return {
    ...actual,
    useReducedMotion: () => useReducedMotionMock(),
  };
});

vi.mock('@/hooks/useHaptics', () => ({
  useHaptics: () => ({
    selectionChanged: vi.fn(),
  }),
}));

function renderPicker(
  props: Partial<{
    open: boolean;
    onClose: () => void;
    onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  }> = {},
) {
  const onClose = props.onClose ?? vi.fn();
  const onFileChange = props.onFileChange ?? vi.fn();
  const result = render(
    <I18nextProvider i18n={i18n}>
      <AttachmentPickerSheet
        open={props.open ?? true}
        onClose={onClose}
        onFileChange={onFileChange}
      />
    </I18nextProvider>,
  );
  return { ...result, onClose, onFileChange };
}

describe('AttachmentPickerSheet FAB', () => {
  afterEach(() => {
    vi.clearAllMocks();
    useReducedMotionMock.mockReturnValue(false);
  });

  it('renders staggered FAB menu instead of bottom sheet dialog', () => {
    renderPicker();

    expect(document.querySelector('.attachment-picker-fab-menu')).toBeTruthy();
    expect(document.querySelector('.attachment-picker-sheet')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(i18n.t('files.picker.photo'))).toBeTruthy();
    expect(screen.getByText(i18n.t('files.picker.video'))).toBeTruthy();
    expect(screen.getByText(i18n.t('files.picker.document'))).toBeTruthy();
  });

  it('keeps file input in DOM after option click without synchronous onClose', () => {
    const onClose = vi.fn();
    renderPicker({ onClose });

    fireEvent.click(screen.getByText(i18n.t('files.picker.photo')));

    expect(onClose).not.toHaveBeenCalled();
    const photoInput = document.querySelector(
      `input[type="file"][accept="${ATTACH_PICKER_ACCEPT_PHOTO}"]`,
    );
    expect(photoInput).toBeTruthy();
  });

  it('closes menu after file selection via onChange', () => {
    const onClose = vi.fn();
    const onFileChange = vi.fn();
    renderPicker({ onClose, onFileChange });

    const photoInput = document.querySelector(
      `input[type="file"][accept="${ATTACH_PICKER_ACCEPT_PHOTO}"]`,
    ) as HTMLInputElement;

    const file = new File(['pixels'], 'photo.png', { type: 'image/png' });
    fireEvent.change(photoInput, { target: { files: [file] } });

    expect(onFileChange).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on outside backdrop click', () => {
    const onClose = vi.fn();
    renderPicker({ onClose });

    const backdrop = document.querySelector('.attachment-picker-fab-backdrop');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    renderPicker({ onClose });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('marks menu as reduced-motion when prefers-reduced-motion is active', () => {
    useReducedMotionMock.mockReturnValue(true);
    renderPicker();

    const menu = document.querySelector('.attachment-picker-fab-menu');
    expect(menu?.getAttribute('data-reduced-motion')).toBe('true');
  });
});
