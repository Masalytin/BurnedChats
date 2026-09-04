import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en.json';

describe('help copy for send-time TTL (IMP-DISAPPEAR-05)', () => {
  const chatBody = en.help.chat.about.body.join(' ');
  const filesBody = en.help.files.about.body.join(' ');

  it('help.chat.about describes send-time TTL, either DM side, and room owner — not after-read', () => {
    expect(chatBody.toLowerCase()).toMatch(/sent/);
    expect(chatBody.toLowerCase()).not.toMatch(/after (it is |they('| a)re )?read/);
    expect(chatBody.toLowerCase()).toMatch(/either (side|person)|either .+ chat/);
    expect(chatBody.toLowerCase()).toMatch(/owner/);
  });

  it('help.files.about says the file bubble hides and the relay blob may outlive it', () => {
    expect(filesBody.toLowerCase()).toMatch(/bubble|hides/);
    expect(filesBody.toLowerCase()).toMatch(/blob|relay/);
    expect(filesBody.toLowerCase()).toMatch(/may still live|file or session ttl|session ttl|file ttl/);
  });
});
