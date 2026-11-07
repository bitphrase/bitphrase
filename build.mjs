/**
 * Builds src/ into ONE self-contained build/bitphrase.html: styles, dictionaries
 * (src/core/dict.json, wallet word lists), the icon and the compiled TypeScript
 * are inlined, so the file opens from file:// with no network and no sibling files.
 *
 * Beside it goes build/pages/: the same page as an installable PWA for GitHub
 * Pages — a manifest, icons and a service worker that keeps it offline.
 *
 * The version lives only in package.json: the page displays it, the PWA's cache is
 * named after it; a non-release build gets a commit suffix (0.1.0+1a2b3c4) so it is
 * not mistaken for a release. Modeled on html-password-manager/build.mjs.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const at = (...parts) => join(root, ...parts);
const watch = process.argv.includes('--watch');
/** pwa: this page also goes to build/pages/ as the installable app. */
const PAGES = [{ dir: 'src/app', out: 'bitphrase.html', pwa: true }];

async function readRelease() {
  const { version } = JSON.parse(await readFile(at('package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`package.json: version must be x.y.z, not ${version}`);
  const git = (...args) => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return '';
    }
  };
  // The release workflow names the tag it builds; a checkout of a tag may not list it.
  const tagged = process.env.RELEASE_TAG === `v${version}` || git('tag', '--points-at', 'HEAD').split('\n').includes(`v${version}`);
  const commit = tagged ? '' : git('rev-parse', '--short', 'HEAD');
  return { version, label: commit ? `${version}+${commit}` : version };
}

/** `</script` inside a string would close the inline tag prematurely. */
const guard = (code) => code.replace(/<\/(script|style)/gi, '<\\/$1');

async function bundle(entry, label) {
  const result = await build({
    entryPoints: [at(entry)],
    bundle: true,
    format: 'iife',
    target: ['es2022'],
    platform: 'browser',
    minify: !watch,
    sourcemap: false,
    legalComments: 'none',
    charset: 'utf8',
    define: { __APP_VERSION__: JSON.stringify(label) },
    write: false,
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error('esbuild returned an empty result');
  return output.text;
}

/** The whole point of the build: nothing is loaded from outside at runtime. */
function assertSelfContained(html) {
  const offenders = [
    [/<script[^>]+\ssrc=/i, '<script src=…>'],
    [/<link[^>]+href=["'](?!data:)/i, '<link href=…>'],
    [/@import\s+(url\()?["']?(?!data:)/i, '@import'],
    [/url\(\s*["']?https?:/i, 'url(http…)'],
  ];
  for (const [pattern, name] of offenders) {
    if (pattern.test(html)) throw new Error(`External reference left in the file: ${name}`);
  }
  if (!html.includes('http-equiv="Content-Security-Policy"')) throw new Error('Missing Content-Security-Policy meta tag');
}

/**
 * `<!--` followed by `<script` before `-->` puts the HTML parser into the
 * "double escaped" state: the closing `</script>` no longer closes, and the page
 * executes nothing.
 */
function assertScriptCloses(code) {
  const open = code.indexOf('<!--');
  if (open >= 0) {
    const close = code.indexOf('-->', open);
    const script = code.slice(open, close < 0 ? undefined : close).search(/<script/i);
    if (script >= 0) throw new Error('Inline script contains "<!--" and "<script": the tag will not close');
  }
}

async function buildOnce() {
  const release = await readRelease();
  for (const page of PAGES) await buildPage(page, release);
}

async function buildPage({ dir, out, pwa }, release) {
  const [template, styles, icon, appJs] = await Promise.all([
    readFile(at(dir, 'template.html'), 'utf8'),
    readFile(at(dir, 'styles.css'), 'utf8'),
    readFile(at('assets/icon.svg'), 'utf8'),
    bundle(`${dir}/main.ts`, release.label),
  ]);
  const code = guard(appJs);
  assertScriptCloses(code);
  const iconUri = `data:image/svg+xml;base64,${Buffer.from(icon.trim(), 'utf8').toString('base64')}`;
  // Replace via a function: otherwise `$&` and the like in the code would corrupt the result.
  const html = template
    .replace('/*__STYLES__*/', () => styles)
    .replace('/*__APP__*/', () => code)
    .replaceAll('__ICON__', () => iconUri);
  assertSelfContained(html);
  await mkdir(at('build'), { recursive: true });
  await writeFile(at('build', out), html, 'utf8');
  const kb = (n) => (n / 1024).toFixed(1);
  console.log(`build/${out} ${release.label} — ${kb(Buffer.byteLength(html, 'utf8'))} KB (code with dictionaries ${kb(Buffer.byteLength(appJs, 'utf8'))} KB)`);
  if (pwa) await buildPwa(html, release);
}

/** Under assets/; each goes to build/pages/ under its own name. */
const PWA_ICONS = ['icon.svg', 'pwa/icon-192.png', 'pwa/icon-512.png', 'pwa/icon-maskable-512.png', 'pwa/apple-touch-icon.png'];

/**
 * The page's CSP forbids every fetch; the installed app needs its manifest, its
 * service worker and its icons, all from its own origin. connect-src stays 'none',
 * so the page itself still reaches nothing.
 */
function allowPwa(html) {
  const pattern = /(http-equiv="Content-Security-Policy" content=")([^"]*)/;
  if (!pattern.test(html)) throw new Error('Missing Content-Security-Policy meta tag');
  return html.replace(pattern, (_, attr, policy) => {
    const directives = new Map(policy.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...sources]) => [name, sources]));
    if (!directives.has('img-src')) throw new Error('The Content-Security-Policy has no img-src');
    directives.get('img-src').push("'self'");
    directives.set('manifest-src', ["'self'"]);
    directives.set('worker-src', ["'self'"]);
    return attr + [...directives].map(([name, sources]) => [name, ...sources].join(' ')).join('; ');
  });
}

/**
 * build/pages/: the page plus what makes it installable. Every path is relative,
 * so it works under a project site's /<repo>/ prefix.
 */
async function buildPwa(html, release) {
  const dir = at('build', 'pages');
  const head = [
    '<link rel="manifest" href="manifest.webmanifest">',
    '<link rel="apple-touch-icon" href="apple-touch-icon.png">',
    '<meta name="theme-color" content="#fbfbfa" media="(prefers-color-scheme: light)">',
    '<meta name="theme-color" content="#17181c" media="(prefers-color-scheme: dark)">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
    // The page registers the worker itself (update.ts): this is how it knows it is the PWA.
    '<meta name="service-worker" content="sw.js">',
  ].join('\n');
  const page = allowPwa(html).replace('</head>', () => `${head}\n</head>`);
  // A deploy between two releases changes the page, not the version: the hash tells them apart.
  const cache = `${release.version}-${createHash('sha256').update(page).digest('hex').slice(0, 12)}`;

  const manifest = {
    name: 'Bitphrase',
    short_name: 'Bitphrase',
    description: 'Card numbers, phone numbers, passwords, crypto seeds ↔ funny, memorable sentences. Works offline.',
    id: './',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#fbfbfa',
    theme_color: '#3b5bdb',
    icons: [
      { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };

  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const worker = (await readFile(at('src/pwa/sw.js'), 'utf8')).replaceAll('__CACHE__', cache).replaceAll('__VERSION__', release.label);
  await Promise.all([
    writeFile(join(dir, 'index.html'), page, 'utf8'),
    writeFile(join(dir, 'sw.js'), worker, 'utf8'),
    writeFile(join(dir, 'manifest.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    // Without it Pages runs the files through Jekyll, which is only wasted time here.
    writeFile(join(dir, '.nojekyll'), '', 'utf8'),
    ...PWA_ICONS.map((path) => copyFile(at('assets', path), join(dir, basename(path)))),
  ]);
  console.log(`build/pages/ — PWA for GitHub Pages (cache ${cache})`);
}

await buildOnce();

if (watch) {
  const { watch: watchDir } = await import('node:fs');
  let pending = null;
  for (const dir of ['src', 'assets']) {
    watchDir(at(dir), { recursive: true }, () => {
      clearTimeout(pending);
      pending = setTimeout(() => buildOnce().catch((error) => console.error(error.message)), 120);
    });
  }
  console.log('watching src/ and assets/ …');
}
