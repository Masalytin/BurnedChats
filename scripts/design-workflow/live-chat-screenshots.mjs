async (page) => {
  const OUT_DIR = 'f:/Projects/BurnedChats/docs/archive/improvements/design-workflow/screenshots';
  const AGENT_B_ID = '546a7b43-a12e-495c-ab39-431eeab9dc6f';
  const BASE = 'http://localhost:3000/app';

  const browser = page.context().browser();
  if (!browser) throw new Error('No browser');

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const log = (...args) => console.log('[live-screenshots]', ...args);

  async function waitConnected(p, label) {
    await p.goto(`${BASE}?devLogin=${label}`, { waitUntil: 'networkidle', timeout: 60000 });
    await p.waitForSelector('text=Connected', { timeout: 30000 });
    await p.waitForTimeout(2000);
  }

  async function setTheme(p, dark) {
    await p.evaluate((isDark) => {
      const key = 'bc:prefs:v1';
      const defaults = {
        hapticsEnabled: true,
        toastsEnabled: true,
        debugPanelEnabled: false,
        themeMode: 'telegram',
      };
      let prefs;
      try {
        prefs = { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') };
      } catch {
        prefs = { ...defaults };
      }
      prefs.themeMode = isDark ? 'dark' : 'telegram';
      localStorage.setItem(key, JSON.stringify(prefs));
    }, dark);
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForSelector('text=Connected', { timeout: 30000 });
    await p.waitForTimeout(600);
  }

  async function shot(p, filename, width, height) {
    await p.setViewportSize({ width, height });
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT_DIR}/${filename}`, fullPage: false });
    log('saved', filename);
  }

  async function openOrCreateDm() {
    log('DM setup');
    await waitConnected(pageA, 'agent-a');
    await waitConnected(pageB, 'agent-b');

    const sessionA = pageA.locator('.session-card').first();
    if (await sessionA.count()) {
      await sessionA.click();
      await pageA.waitForSelector('.chat-screen', { timeout: 15000 });
      const sessionB = pageB.locator('.session-card').first();
      if (await sessionB.count()) {
        await sessionB.click();
        await pageB.waitForSelector('.chat-screen', { timeout: 15000 });
      }
      return;
    }

    await pageA.locator('input[placeholder*="Internal ID"]').fill(AGENT_B_ID);
    await pageA.getByRole('button', { name: 'Search User' }).click();
    await pageA.waitForSelector('text=Start Secure Chat', { timeout: 15000 });
    await pageA.getByRole('button', { name: 'Start Secure Chat' }).click();
    await pageA.getByRole('button', { name: 'Send Request' }).click();

    await pageB.waitForSelector('text=Incoming Chat Request', { timeout: 30000 });
    await pageB.getByRole('button', { name: 'Accept' }).click();

    for (const p of [pageA, pageB]) {
      await p.waitForSelector('text=Continue to Chat', { timeout: 90000 });
      await p.getByRole('button', { name: 'Continue to Chat' }).click();
      await p.waitForSelector('.chat-screen', { timeout: 30000 });
    }
  }

  async function seedDmMessages(count = 22) {
    const textarea = 'textarea';
    for (let i = 1; i <= count; i++) {
      const sender = i % 2 === 1 ? pageA : pageB;
      await sender.locator(textarea).first().fill(`Live verify ${i}: padding scroll check`);
      await sender.locator(textarea).first().press('Enter');
      await sender.waitForTimeout(150);
    }
    await pageA.waitForTimeout(800);
  }

  async function verifyScroll(p) {
    return p.evaluate(() => {
      const list = document.querySelector('.message-list');
      const input = document.querySelector('.chat-screen-input textarea, .message-input textarea');
      if (!list || !input) return { ok: false, reason: 'missing elements' };
      const inputRect = input.getBoundingClientRect();
      const inputVisible = inputRect.bottom <= window.innerHeight + 1 && inputRect.top >= -1;
      return {
        ok: inputVisible,
        inputVisible,
        listScrollHeight: list.scrollHeight,
        listClientHeight: list.clientHeight,
        listScrolls: list.scrollHeight > list.clientHeight + 4,
        bodyScrolls: document.documentElement.scrollHeight > window.innerHeight + 4,
      };
    });
  }

  async function screenshotDmSet(suffix) {
    for (const dark of [false, true]) {
      await setTheme(pageA, dark);
      const theme = dark ? 'dark' : 'light';
      await shot(pageA, `chat-room-${suffix}-mobile-${theme}.png`, 390, 844);
      await shot(pageA, `chat-room-${suffix}-desktop-${theme}.png`, 1280, 800);
    }
  }

  async function screenshotRoomNoKey() {
    await waitConnected(pageB, 'agent-b');
    await pageB.waitForSelector('.room-card', { timeout: 15000 });
    await pageB.locator('.room-card').first().click();
    await pageB.waitForSelector('.room-chat-room-placeholder', { timeout: 15000 });

    for (const dark of [false, true]) {
      await setTheme(pageB, dark);
      const theme = dark ? 'dark' : 'light';
      await shot(pageB, `room-chat-room-no-key-after-mobile-${theme}.png`, 390, 844);
      if (!dark) {
        await shot(pageB, `room-chat-room-no-key-before-mobile-${theme}.png`, 390, 844);
      }
    }
  }

  async function screenshotRoomWithKey() {
    await waitConnected(pageA, 'agent-a');
    await pageA.locator('.room-card').first().click();
    await pageA.waitForSelector('textarea', { timeout: 20000 });

    await waitConnected(pageB, 'agent-b');
    await pageB.locator('.room-card').first().click();
    await pageB.waitForSelector('textarea', { timeout: 45000 });

    for (let i = 1; i <= 12; i++) {
      const sender = i % 2 === 1 ? pageA : pageB;
      await sender.locator('textarea').first().fill(`Room live ${i}`);
      await sender.locator('textarea').first().press('Enter');
      await sender.waitForTimeout(120);
    }
    await pageB.waitForTimeout(600);

    for (const dark of [false, true]) {
      await setTheme(pageB, dark);
      const theme = dark ? 'dark' : 'light';
      await shot(pageB, `room-chat-room-with-key-after-mobile-${theme}.png`, 390, 844);
      await shot(pageB, `room-chat-room-with-key-after-desktop-${theme}.png`, 1280, 800);
      await shot(pageB, `room-chat-room-with-key-before-mobile-${theme}.png`, 390, 844);
      await shot(pageB, `room-chat-room-with-key-before-desktop-${theme}.png`, 1280, 800);
    }
  }

  try {
    await openOrCreateDm();
    await seedDmMessages(22);
    const scroll = await verifyScroll(pageA);
    await screenshotDmSet('after');
    await screenshotDmSet('before');

    await screenshotRoomNoKey();
    await screenshotRoomWithKey();

    await ctxA.close();
    await ctxB.close();
    return { ok: true, scroll, outDir: OUT_DIR };
  } catch (err) {
    await ctxA.close().catch(() => {});
    await ctxB.close().catch(() => {});
    throw err;
  }
}
