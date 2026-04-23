// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeTextToClipboard } from '../clipboard';

describe('writeTextToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false for empty string', async () => {
    expect(await writeTextToClipboard('')).toBe(false);
  });

  it('uses navigator.clipboard.writeText when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const ok = await writeTextToClipboard('hello');
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to execCommand when clipboard API throws', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('denied')),
      },
    });
    const execCommand = vi.fn().mockReturnValue(true);
    type DocExec = Document & { execCommand?: (command: string) => boolean };
    const doc = document as DocExec;
    const prev = doc.execCommand;
    doc.execCommand = execCommand;
    const ok = await writeTextToClipboard('fallback');
    expect(ok).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    doc.execCommand = prev;
  });
});
