import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const distFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist', 'index.html');
const url = 'file:///' + distFile.replace(/\\/g, '/');

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(1500);

const state = await page.evaluate(() => ({
  hasMapTiles: !!document.querySelector('#map .leaflet-tile-pane img, #map .leaflet-tile-loaded'),
  hasLeaflet: !!document.querySelector('#map.leaflet-container'),
  toolBtn: !!document.getElementById('bt-draw'),
  onTimelineSlider: typeof window.onTimelineSlider
}));

await page.click('#bt-draw');
await page.waitForTimeout(200);

const beforeSlider = await page.evaluate(() => ({
  timelineVal: document.getElementById('timelineVal')?.textContent,
  phaseLabel: document.getElementById('phaseLabel')?.textContent,
  slider: document.getElementById('timelineSlider')?.value
}));

await page.locator('#timelineSlider').evaluate((el) => {
  el.value = '300';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(200);

const afterSlider = await page.evaluate(() => ({
  timelineVal: document.getElementById('timelineVal')?.textContent,
  phaseLabel: document.getElementById('phaseLabel')?.textContent,
  slider: document.getElementById('timelineSlider')?.value,
  trackP2: document.getElementById('timelineTrack')?.style.getPropertyValue('--tl-p2')
}));

await browser.close();

console.log('URL:', url);
console.log('State:', state);
console.log('Before slider:', beforeSlider);
console.log('After slider:', afterSlider);
console.log('Page errors:', errors.length ? errors : 'none');

const sliderWorked =
  afterSlider.slider === '300' &&
  afterSlider.timelineVal !== beforeSlider.timelineVal &&
  afterSlider.phaseLabel === '3';

if (errors.length || !state.hasLeaflet || state.onTimelineSlider !== 'function' || !sliderWorked) {
  process.exit(1);
}
