/**
 * Headless Chrome for browser tests (DevTools protocol over Node's built-in
 * WebSocket, no puppeteer). openPage(path) opens a page from file:// (or a URL) and returns
 * evaluate/until/shot, plus a log of network requests and JS errors. Screenshots: `--shots DIR`.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
export const CHROME =
  process.env.CHROME ??
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openPage(file) {
  const profile = await mkdtemp(join(tmpdir(), 'bitphrase-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const wsUrl = await new Promise((resolve, reject) => {
    let err = '';
    chrome.stderr.on('data', (d) => {
      err += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
      if (m) resolve(m[1]);
    });
    chrome.on('exit', () => reject(new Error(`Chrome exited: ${err}`)));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      nextId += 1;
      pending.set(nextId, { resolve, reject });
      ws.send(JSON.stringify({ id: nextId, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  const requests = [];
  const problems = [];
  listeners.push((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Network.requestWillBeSent') requests.push(msg.params.request.url);
    if (msg.method === 'Runtime.exceptionThrown') problems.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') problems.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  await page('Runtime.enable');
  await page('Network.enable');
  await page('Page.enable');
  const evaluate = async (expression) => {
    const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${expression}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const until = async (expression, ms = 5000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        if (await evaluate(expression)) return true;
      } catch {
        // the page is still loading
      }
      await sleep(50);
    }
    return false;
  };
  const shot = async (name, width, height) => {
    if (!SHOTS) return;
    await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: width < 600 });
    await sleep(150);
    const { data } = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await mkdir(SHOTS, { recursive: true });
    await writeFile(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
  };
  const close = async () => {
    ws.close();
    chrome.kill();
    await sleep(200);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  };
  await page('Page.navigate', { url: /^[a-z]+:/.test(file) ? file : pathToFileURL(file).href });
  /** Set a field's value and dispatch input/change. */
  const fill = (id, value, event = 'input') =>
    evaluate(`(() => { const t = document.getElementById(${JSON.stringify(id)}); t.value = ${JSON.stringify(value)}; t.dispatchEvent(new Event(${JSON.stringify(event)})); })()`);
  return { send, page, evaluate, until, shot, close, fill, requests, problems };
}
