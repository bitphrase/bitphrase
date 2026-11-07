/**
 * The PWA (build/pages/) in headless Chrome, served over HTTP: the service worker
 * takes control, the manifest is valid and the app installable; it works with the
 * server gone; a new deploy installs beside the running version and waits for
 * Update, which brings it in and drops the old cache; "Updated to …" is said once.
 *
 * Requires `npm run build` and Chrome (or CHROME=/path/to/chrome).
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, extname, join } from 'node:path';
import { checker, root } from '../tools/load.mjs';
import { CHROME, openPage } from './browser.mjs';

const PAGES = join(root, 'build', 'pages');
if (!CHROME) {
  console.log('Chrome not found: set CHROME=/path/to/chrome. PWA test skipped.');
  process.exit(0);
}
if (!existsSync(join(PAGES, 'index.html'))) {
  console.error('No build/pages/: run npm run build first');
  process.exit(1);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
// Set, the server drops every connection: the network is gone.
let down = false;
// Set, the server hands out a service worker of this version and cache: a new deploy, as the page sees it.
let nextVersion = null;
const server = createServer(async (req, res) => {
  if (down) return req.socket.destroy();
  const path = new URL(req.url, 'http://localhost').pathname;
  const name = path.endsWith('/') ? 'index.html' : basename(path);
  try {
    let body = await readFile(join(PAGES, name));
    if (name === 'sw.js' && nextVersion) {
      body = body
        .toString()
        .replace(/const VERSION = '[^']*'/, `const VERSION = '${nextVersion}'`)
        .replace(/const CACHE = '[^']*'/, `const CACHE = 'bitphrase-${nextVersion}'`);
    }
    res.setHeader('content-type', TYPES[extname(name)] ?? 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const { check, done } = checker();
const { page, evaluate, until, close, fill, requests, problems } = await openPage(`${origin}/`);
const line = `(document.getElementById('update-line')?.textContent ?? '')`;
const clickUpdateLine = () => evaluate(`document.querySelector('#update-line button').click()`);
const reload = async () => {
  await evaluate('window.__beforeReload = true');
  await page('Page.reload');
  return until("!window.__beforeReload && document.readyState === 'complete' && !!document.getElementById('version')?.textContent", 15000);
};
const workerVersion = () =>
  evaluate(`new Promise((resolve) => { const c = new MessageChannel(); c.port1.onmessage = (e) => resolve(e.data); navigator.serviceWorker.controller.postMessage('version', [c.port2]); })`);

try {
  check('pwa: page loaded', await until("document.readyState === 'complete' && !!document.getElementById('version')?.textContent"), true);
  await fill('ui-lang', 'en', 'change');
  check('pwa: service worker in control', await until('navigator.serviceWorker.controller !== null', 15000), true);
  check('pwa: manifest parsed', (await page('Page.getAppManifest')).errors, []);
  check('pwa: installable', (await page('Page.getInstallabilityErrors')).installabilityErrors, []);
  const running = await evaluate("document.getElementById('version').textContent");
  check('pwa: the worker knows its version', await workerVersion(), running);
  check('pwa: footer offers a check', await until(`${line} === '· Check for updates'`), true);

  down = true;
  check('pwa: loads with the server gone', await reload(), true);
  check('pwa: and works', await until("!!document.getElementById('enc-format')?.options.length"), true);
  await until(`${line}.includes('Check for updates')`);
  await clickUpdateLine();
  check('pwa: no server, no check', await until(`${line}.includes('No connection: could not check for updates.')`), true);
  down = false;
  await clickUpdateLine();
  check('pwa: nothing new', await until(`${line}.includes('This is the latest version.')`), true);

  nextVersion = '9.9.9';
  await clickUpdateLine();
  check('pwa: a new version ready', await until(`${line}.includes('Version 9.9.9 is ready.')`, 15000), true);
  check('pwa: the update survives a language switch', (await fill('ui-lang', 'ru', 'change'), await evaluate(line)), '· Версия 9.9.9 готова. Обновить');
  await fill('ui-lang', 'en', 'change');
  check('pwa: the old worker still serves', await workerVersion(), running);
  await evaluate('window.__beforeReload = true');
  await clickUpdateLine();
  check('pwa: Update reloads the page', await until("!window.__beforeReload && document.readyState === 'complete' && !!document.getElementById('version')?.textContent", 15000), true);
  check('pwa: the new worker serves', await until('navigator.serviceWorker.controller !== null'), true);
  check('pwa: its version', await workerVersion(), '9.9.9');
  check('pwa: the old cache gone', await evaluate('caches.keys()'), ['bitphrase-9.9.9']);

  down = true;
  check('pwa: offline after the update', await reload(), true);
  down = false;
  // The page served is the same, only the worker changed: what the app ran before is set back to see the note.
  await evaluate("localStorage.setItem('bitphrase:version', '0.0.1')");
  await reload();
  check('pwa: "updated" said once', await until(`document.getElementById('toast').textContent === ${JSON.stringify(`Updated to version ${running}.`)}`), true);
  await reload();
  check('pwa: and not again', await evaluate("document.getElementById('toast').hidden"), true);

  check('pwa: only its own origin', requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:')), []);
  check('pwa: no JS errors', problems, []);
} finally {
  await close();
  server.close();
}

done('pwa');
