import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import {
  XSS_HTML,
  XSS_NAMES,
  BAD_URLS,
  BAD_COLORS,
  encodeAdp1,
  profileWithLabel,
  profileWithCustomZone,
  profileWithClimb,
  profileLegacyV2,
  LABEL_COORDS
} from './security/payloads.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist', 'index.html');
const TEMPLATES_KEY = 'gta5-airdrop-tool-v3-templates';

if (!fs.existsSync(DIST)) {
  console.error('dist/index.html not found — run: npm run build');
  process.exit(1);
}

const url = 'file:///' + DIST.replace(/\\/g, '/');

const results = [];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function assertNoInjection(page, { allowImportAlert = false, allowInvalidUrlAlert = false } = {}) {
  const state = await page.evaluate(() => {
    function hasInjectedEventHandlers(html) {
      if (/<img[^>]+\sonerror\s*=/i.test(html)) return true;
      if (/<script[\s>]/i.test(html)) return true;
      if (/<iframe[^>]+\ssrc\s*=\s*["']javascript:/i.test(html)) return true;
      if (/<svg[^>]+\sonload\s*=/i.test(html)) return true;
      return false;
    }

    return {
      xssHit: window.__xssHit === 1,
      unexpectedAlert: window.__unexpectedAlert || null,
      scriptTags: [
        ...document.querySelectorAll('#zlist script'),
        ...document.querySelectorAll('#histList script'),
        ...document.querySelectorAll('.leaflet-marker-pane script'),
        ...document.querySelectorAll('#tplMenu script')
      ].length,
      injectedHandlers: ['#zlist', '#histList', '#tplMenu', '.leaflet-marker-pane'].some(sel => {
        const el = document.querySelector(sel);
        if (!el) return false;
        return hasInjectedEventHandlers(el.innerHTML);
      }),
      polluted: Object.prototype.isAdmin === true || ({}).polluted === true
    };
  });

  const alertOk =
    !state.unexpectedAlert ||
    (allowImportAlert && String(state.unexpectedAlert).startsWith('Ошибка импорта')) ||
    (allowInvalidUrlAlert && String(state.unexpectedAlert).startsWith('Неверная ссылка'));

  assert(!state.xssHit, 'window.__xssHit was set — script execution');
  assert(alertOk, `unexpected alert: ${state.unexpectedAlert}`);
  assert(state.scriptTags === 0, `found ${state.scriptTags} injected <script> nodes`);
  assert(!state.injectedHandlers, 'injected event handler in DOM HTML');
  assert(!state.polluted, 'prototype pollution on Object.prototype');
}

async function bootPage(browser) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__xssHit = 0;
    window.__unexpectedAlert = null;
    window.alert = (msg) => {
      window.__unexpectedAlert = String(msg);
    };
  });

  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate((key) => localStorage.removeItem(key), TEMPLATES_KEY);
  await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  return page;
}

function attachPromptQueue(page, answers) {
  let idx = 0;
  const handler = async (dialog) => {
    await dialog.accept(idx < answers.length ? answers[idx++] : '');
  };
  page.on('dialog', handler);
  return () => page.off('dialog', handler);
}

async function importAdp1(page, templateName, code) {
  const stop = attachPromptQueue(page, [templateName, code]);
  try {
    await page.evaluate(() => window.importTemplateDialog());
    await page.waitForTimeout(800);
  } finally {
    stop();
  }
}

async function runCase(name, fn, injectionOpts = {}) {
  const browser = await chromium.launch();
  try {
    const page = await bootPage(browser);
    await fn(page);
    await assertNoInjection(page, injectionOpts);
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    console.log(`FAIL  ${name}: ${err.message}`);
  } finally {
    await browser.close();
  }
}

console.log('Security injection tests —', url);
console.log('—'.repeat(60));

for (const payload of XSS_HTML) {
  await runCase(`ADP1 import: label "${payload.slice(0, 40)}…"`, async (page) => {
    const code = encodeAdp1(profileWithLabel(payload));
    await importAdp1(page, 'xss-label-test', code);
    const markerHtml = await page.locator('.leaflet-marker-pane').innerHTML();
    assert(!/<img[^>]+onerror/i.test(markerHtml), 'unescaped onerror in marker HTML');
    assert(!/<script/i.test(markerHtml), 'script tag in marker HTML');
  });
}

for (const name of XSS_NAMES) {
  await runCase(`ADP1 import: custom zone name`, async (page) => {
    const code = encodeAdp1(profileWithCustomZone(name));
    await importAdp1(page, 'xss-zone', code);
    const sidebar = await page.locator('#zlist').innerHTML();
    assert(!/<img/i.test(sidebar), 'unescaped HTML in zone list');
    if (name.includes('<') || name.includes('>')) {
      assert(!sidebar.includes('&lt;') && !sidebar.includes('&gt;'), 'angle brackets should be stripped from zone name');
    }
  });
}

for (const color of BAD_COLORS) {
  await runCase(`ADP1 import: label color "${color.slice(0, 30)}"`, async (page) => {
    const code = encodeAdp1(profileWithLabel('color-test', color));
    await importAdp1(page, 'xss-color', code);
    const markerHtml = await page.locator('.leaflet-marker-pane').innerHTML();
    assert(!/javascript:/i.test(markerHtml), 'javascript: in marker HTML');
  });
}

for (const badUrl of BAD_URLS) {
  await runCase(`ADP1 import: climb URL rejected`, async (page) => {
    const code = encodeAdp1(profileWithClimb(badUrl));
    await importAdp1(page, 'xss-climb', code);
    const climbCount = await page.locator('.map-climb-wrap').count();
    assert(climbCount === 0, `malicious climb rendered (${climbCount})`);
  });
}

await runCase('ADP1 import: prototype pollution payload', async (page) => {
  const json = '{"v":3,"a":{"0":[[],[],[]]},"c":[],"constructor":{"prototype":{"polluted":true,"isAdmin":true}}}';
  const code = 'ADP1:' + Buffer.from(json, 'utf8').toString('base64');
  await importAdp1(page, 'proto-test', code);
});

await runCase('ADP1 import: legacy v2 XSS zone name', async (page) => {
  const code = encodeAdp1(profileLegacyV2('<img src=x onerror="window.__xssHit=1">'));
  await importAdp1(page, 'legacy-v2', code);
});

await runCase('localStorage: poisoned template name', async (page) => {
  await page.evaluate(({ key, payloadName }) => {
    const store = {
      activeId: 'default',
      templates: {
        default: {
          name: payloadName,
          updated: Date.now(),
          data: { v: 3, std: {}, custom: [] }
        }
      }
    };
    localStorage.setItem(key, JSON.stringify(store));
  }, { key: TEMPLATES_KEY, payloadName: '<img src=x onerror="window.__xssHit=1">' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const triggerText = await page.locator('#tplTrigger').textContent();
  assert(!triggerText.includes('<img'), 'template name rendered as raw HTML');
});

await runCase('live label edit: XSS payload', async (page) => {
  const payload = '<img src=x onerror="window.__xssHit=1">';
  await page.click('#bt-text');
  const box = await page.locator('#map').boundingBox();
  assert(box, 'map not visible');
  await page.click('#map', { position: { x: box.width / 2, y: box.height / 2 } });
  await page.waitForTimeout(300);
  await page.fill('#inlineTextInput', payload);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const markerHtml = await page.locator('.leaflet-marker-pane').innerHTML();
  assert(!/<img[^>]+onerror/i.test(markerHtml), 'live label escaped in map HTML');
});

await runCase('YouTube prompt: rejects javascript URL', async (page) => {
  const stop = attachPromptQueue(page, ['javascript:window.__xssHit=1']);
  try {
    await page.click('#bt-climb');
    const box = await page.locator('#map').boundingBox();
    await page.click('#map', { position: { x: box.width / 2, y: box.height / 2 } });
    await page.waitForTimeout(500);
    const count = await page.locator('.map-climb-wrap').count();
    assert(count === 0, 'climb added from javascript: URL');
  } finally {
    stop();
  }
}, { allowInvalidUrlAlert: true });

await runCase('YouTube prompt: accepts valid watch URL', async (page) => {
  const stop = attachPromptQueue(page, ['https://www.youtube.com/watch?v=dQw4w9WgXcQ']);
  try {
    await page.click('#bt-climb');
    const box = await page.locator('#map').boundingBox();
    await page.click('#map', { position: { x: box.width / 2, y: box.height / 2 } });
    await page.waitForTimeout(500);
    const count = await page.locator('.map-climb-wrap').count();
    assert(count === 1, 'valid climb not added');
  } finally {
    stop();
  }
});

await runCase('import dialog: invalid ADP1 shows error, no XSS', async (page) => {
  const stop = attachPromptQueue(page, ['bad', '<script>window.__xssHit=1</script>']);
  try {
    await page.evaluate(() => window.importTemplateDialog());
    await page.waitForTimeout(500);
    const alertMsg = await page.evaluate(() => window.__unexpectedAlert);
    assert(alertMsg && alertMsg.startsWith('Ошибка импорта'), 'expected import error alert');
  } finally {
    stop();
  }
}, { allowImportAlert: true });

await runCase('history panel: escaped zone rename in description', async (page) => {
  const evilName = '<img src=x onerror="window.__xssHit=1">';
  const code = encodeAdp1(profileWithCustomZone(evilName));
  await importAdp1(page, 'hist-test', code);
  await page.evaluate(() => {
    window.setTool('none');
  });
  const histHtml = await page.locator('#histList').innerHTML();
  assert(!/<img/i.test(histHtml), 'history list contains raw HTML');
});

await runCase('template menu: poisoned name uses textContent', async (page) => {
  await page.evaluate(({ key }) => {
    const raw = localStorage.getItem(key);
    const store = JSON.parse(raw);
    store.templates.default.name = '"><img src=x onerror="window.__xssHit=1">';
    localStorage.setItem(key, JSON.stringify(store));
  }, { key: TEMPLATES_KEY });
  await page.evaluate(() => window.toggleTplMenu({ stopPropagation() {} }));
  await page.waitForTimeout(200);
  const menuHtml = await page.locator('#tplMenu').innerHTML();
  assert(!/<img/i.test(menuHtml), 'template menu raw HTML');
});

const failed = results.filter((r) => !r.ok);
console.log('—'.repeat(60));
console.log(`Done: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  failed.forEach((f) => console.log(`  - ${f.name}: ${f.error}`));
  process.exit(1);
}
