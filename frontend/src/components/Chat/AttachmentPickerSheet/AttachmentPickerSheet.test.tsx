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

vi.mock('@/hooks/useHaptics', () => ({
  useHaptics: () => ({
    selectionChanged: vi.fn(),
  }),
}));

function renderSheet(
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

describe('AttachmentPickerSheet lifecycle', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps file input in DOM after option click without synchronous onClose', () => {
    const onClose = vi.fn();
    renderSheet({ onClose });

    const photoLabel = screen.getByText(i18n.t('files.picker.photo'));
    fireEvent.click(photoLabel);

    expect(onClose).not.toHaveBeenCalled();
    const photoInput = document.querySelector(
      `input[type="file"][accept="${ATTACH_PICKER_ACCEPT_PHOTO}"]`,
    );
    expect(photoInput).toBeTruthy();
  });

  it('closes sheet after file selection via onChange', () => {
    const onClose = vi.fn();
    const onFileChange = vi.fn();
    renderSheet({ onClose, onFileChange });

    const photoInput = document.querySelector(
      `input[type="file"][accept="${ATTACH_PICKER_ACCEPT_PHOTO}"]`,
    ) as HTMLInputElement;
    expect(photoInput).toBeTruthy();

    const file = new File(['pixels'], 'photo.png', { type: 'image/png' });
    fireEvent.change(photoInput, { target: { files: [file] } });

    expect(onFileChange).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on cancel button click', () => {
    const onClose = vi.fn();
    renderSheet({ onClose });

    fireEvent.click(screen.getByText(i18n.t('common.cancel')));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on backdrop click', () => {
    const onClose = vi.fn();
    renderSheet({ onClose });

    const backdrop = document.querySelector('.attachment-picker-sheet-backdrop');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
