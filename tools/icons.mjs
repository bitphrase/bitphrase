/**
 * Renders the PWA's PNG icons (assets/pwa/) from assets/icon.svg in headless Chrome.
 * Run by hand after the icon changes: `npm run icons`; the PNGs are committed, so the
 * build needs no Chrome.
 *
 * - icon-192, icon-512: the icon as it is, rounded corners transparent;
 * - icon-maskable-512: full-bleed background, the picture shrunk into the safe zone
 *   (a circle of 80% of the side), which Android crops to any shape;
 * - apple-touch-icon (180): full-bleed and opaque, iOS rounds the corners itself.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './load.mjs';
import { CHROME, openPage } from '../tests/browser.mjs';

if (!CHROME) {
  console.error('Chrome not found: set CHROME=/path/to/chrome');
  process.exit(1);
}

const svg = (await readFile(join(root, 'assets', 'icon.svg'), 'utf8')).trim();
// The first element is the rounded background; the rest is the picture.
const background = /<rect width="64" height="64" rx="\d+" fill="(#[0-9a-f]+)"\/>/i.exec(svg);
if (!background) throw new Error('assets/icon.svg: expected a <rect width="64" height="64" rx=… fill=…/> background first');
const picture = svg.slice(background.index + background[0].length, svg.lastIndexOf('</svg>'));
const square = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${background[1]}"/>${inner}</svg>`;
// The picture spans x 10–54, y 20–50: its corners lie 26.6 from (32, 35), 0.85 of it is within 40% of 64.
const maskable = square(`<g transform="translate(32 32) scale(0.85) translate(-32 -35)">${picture}</g>`);

const ICONS = [
  ['icon-192.png', 192, svg],
  ['icon-512.png', 512, svg],
  ['icon-maskable-512.png', 512, maskable],
  ['apple-touch-icon.png', 180, square(picture)],
];

const { page, until, close } = await openPage('about:blank');
try {
  await page('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await mkdir(join(root, 'assets', 'pwa'), { recursive: true });
  for (const [name, size, source] of ICONS) {
    const uri = `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`;
    const html = `<body style="margin:0"><img src="${uri}" width="${size}" height="${size}" style="display:block"></body>`;
    await page('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    await page('Page.navigate', { url: `data:text/html;base64,${Buffer.from(html).toString('base64')}` });
    if (!(await until("document.images[0]?.complete && document.images[0].naturalWidth > 0"))) throw new Error(`${name}: the SVG did not load`);
    const { data } = await page('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
    await writeFile(join(root, 'assets', 'pwa', name), Buffer.from(data, 'base64'));
    console.log(`assets/pwa/${name} ${size}×${size}`);
  }
} finally {
  await close();
}
