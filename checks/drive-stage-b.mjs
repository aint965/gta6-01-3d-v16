// drive-stage-b.mjs — headless drive test for Stage B. Reuses the dev server
// on port 8127 if it is already up (it serves game/ live from disk); starts
// its own only if the port is free. Captures the 4 final screenshots, the
// headlight on/off frozen pair, a mission-1 shot, and runs the in-browser
// mission autotest (?autotest=missions&ff=20, small window, --dump-dom).
// Run: node checks/drive-stage-b.mjs
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const shotsDir = join(repo, 'screenshots');
const checksDir = here;
const PORT = 8127;
const CHROME = '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';
// Final screenshots (exactly the 4 shots.json will list).
const SHOTS = [
  { name: 'drive-day.png', query: '?demo=drive', budget: 5000 },
  { name: '2-sunset.png', query: '?shot=sunset&seed=20261123', budget: 9000 },
  { name: 'night-drive.png', query: '?demo=night', budget: 5000 },
  { name: '4-plaza.png', query: '?shot=plaza&seed=20261123', budget: 9000, toJpg: true },
];
const EXTRA = [
  { name: 'headlight-on.png', query: '?demo=headlight&lights=on', budget: 9000 },
  { name: 'headlight-off.png', query: '?demo=headlight&lights=off', budget: 9000 },
  { name: 'mission-1.png', query: '?mission=1', budget: 9000 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  return false;
}

function runChrome(url, shotPath, budget, windowSize = '1280,720') {
  return new Promise((resolve) => {
    const args = [
      '--headless',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      `--window-size=${windowSize}`,
      `--virtual-time-budget=${budget}`,
      '--enable-logging=stderr',
      `--screenshot=${shotPath}`,
      url,
    ];
    const child = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } resolve({ out, err, code: null, timedOut: true }); }, 120000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ out, err, code, timedOut: false });
    });
  });
}

function runChromeDumpDom(url, budget, windowSize = '320,240') {
  return new Promise((resolve) => {
    const args = [
      '--headless',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      `--window-size=${windowSize}`,
      `--virtual-time-budget=${budget}`,
      '--enable-logging=stderr',
      '--dump-dom',
      url,
    ];
    const child = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } resolve({ out, err, code: null, timedOut: true }); }, 240000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ out, err, code, timedOut: false });
    });
  });
}

function consoleErrors(log) {
  const lines = log.split('\n');
  const bad = [];
  for (const line of lines) {
    if (/CONSOLE/i.test(line) && /(error|uncaught|failed|exception)/i.test(line)) bad.push(line.trim());
    if (/Uncaught/i.test(line)) bad.push(line.trim());
  }
  return bad;
}

async function convertToJpeg(pngPath) {
  const jpgPath = pngPath.replace(/\.png$/, '.jpg');
  const code = [
    'from PIL import Image',
    `im = Image.open(${JSON.stringify(pngPath)}).convert('RGB')`,
    `im.save(${JSON.stringify(jpgPath)}, quality=85)`,
  ].join('\n');
  const child = spawn('python3', ['-c', code], { stdio: 'inherit' });
  await new Promise((resolve) => child.on('close', resolve));
  if (existsSync(jpgPath)) {
    unlinkSync(pngPath);
    return jpgPath;
  }
  return null;
}

async function main() {
  mkdirSync(shotsDir, { recursive: true });
  // Reuse the dev server if it is already up (serves game/ live from disk).
  // Only start our own if the port is free.
  let server = null;
  const up = await waitForServer(`http://127.0.0.1:${PORT}/`, 8);
  if (!up) {
    console.log(`no server on ${PORT} — starting our own`);
    server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
    const up2 = await waitForServer(`http://127.0.0.1:${PORT}/`);
    if (!up2) {
      console.log('DRIVE FAIL: dev server did not come up');
      try { server.kill('SIGTERM'); } catch { /* gone */ }
      process.exit(1);
    }
  } else {
    console.log(`reusing server on ${PORT}`);
  }
  // Verify the server serves the CURRENT Stage B files (not a stale copy).
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/src/drive.js`);
    const text = await res.text();
    if (!text.includes('Stage B')) {
      console.log('DRIVE FAIL: server is serving a stale main/drive file');
      if (server) { try { server.kill('SIGTERM'); } catch { /* gone */ } }
      process.exit(1);
    }
  } catch (e) {
    console.log(`DRIVE FAIL: could not verify server content: ${e.message}`);
    if (server) { try { server.kill('SIGTERM'); } catch { /* gone */ } }
    process.exit(1);
  }
  // Clean stale screenshots first (dossier caps screenshots/ at exactly the
  // 4 files shots.json lists).
  for (const f of readdirSync(shotsDir)) {
    unlinkSync(join(shotsDir, f));
  }
  let totalErrors = 0;
  let missing = 0;
  const finalShots = [];
  async function capture(list, dir) {
    for (const s of list) {
      const shotPath = join(dir, s.name);
      const url = `http://127.0.0.1:${PORT}/${s.query}`;
      const { err, code, timedOut } = await runChrome(url, shotPath, s.budget);
      const errors = consoleErrors(err);
      totalErrors += errors.length;
      const exists = existsSync(shotPath);
      if (!exists) missing++;
      let size = 0;
      if (exists) {
        try { size = statSync(shotPath).size; } catch { /* vanished */ }
      }
      let finalName = s.name;
      if (exists && (size > 262144 || s.toJpg)) {
        const jpg = await convertToJpeg(shotPath);
        if (jpg) {
          finalName = jpg.split('/').pop();
          size = statSync(jpg).size;
          console.log(`  ${s.name}: over cap or toJpg — converted to ${finalName} (${size} bytes)`);
        }
      }
      console.log(`  ${s.name}: ${exists ? 'OK' : 'MISSING'} ${size} bytes, chrome exit ${code}, console errors: ${errors.length}${timedOut ? ' (TIMED OUT)' : ''}`);
      for (const e of errors.slice(0, 5)) console.log(`    ! ${e}`);
      if (!exists) {
        console.log(`    chrome stderr (first 25 lines):`);
        for (const line of err.split('\n').filter((l) => l.trim() !== '').slice(0, 25)) console.log(`    | ${line}`);
      }
      if (dir === shotsDir) finalShots.push({ name: finalName, query: s.query });
    }
  }
  console.log('final screenshots:');
  await capture(SHOTS, shotsDir);
  console.log('extra shots (checks/):');
  await capture(EXTRA, checksDir);
  // In-browser mission autotest (?autotest=missions, ff=20, small window,
  // norender=1 so the sim runs at full JS speed instead of being gated by
  // the SwiftShader render).
  console.log('browser autotest (?autotest=missions&ff=20&norender=1):');
  const autoUrl = `http://127.0.0.1:${PORT}/?autotest=missions&ff=20&norender=1`;
  const { out, err, code, timedOut } = await runChromeDumpDom(autoUrl, 20000);
  const autoErrors = consoleErrors(err);
  totalErrors += autoErrors.length;
  const m = out.match(/id="autotest-result"[^>]*>([^<]*)</);
  let autoOk = false;
  if (m && m[1]) {
    try {
      const res = JSON.parse(m[1]);
      autoOk = !!res.ok;
      console.log(`  autotest result: ok=${res.ok} cash=$${res.cash} earned=${JSON.stringify(res.earned)} timer=${res.timer}s`);
    } catch {
      console.log(`  autotest result unparseable: ${m[1].slice(0, 200)}`);
    }
  } else {
    const t = out.match(/<title>([^<]*)<\/title>/);
    console.log(`  autotest result NOT in DOM${t ? ` (title: ${t[1]})` : ''}${timedOut ? ' (TIMED OUT)' : ''}`);
  }
  console.log(`  autotest console errors: ${autoErrors.length}, chrome exit ${code}`);
  for (const e of autoErrors.slice(0, 5)) console.log(`    ! ${e}`);
  // shots.json must list exactly what is on disk.
  writeFileSync(join(repo, 'shots.json'), JSON.stringify(finalShots.map((f) => ({ name: f.name, query: f.query })), null, 0) + '\n');
  if (server) { try { server.kill('SIGTERM'); } catch { /* gone */ } await sleep(500); }
  if (totalErrors === 0 && missing === 0 && autoOk) {
    console.log(`DRIVE OK: 4/4 shots + extras, 0 console errors, browser autotest OK`);
    process.exit(0);
  } else {
    console.log(`DRIVE FAIL: ${totalErrors} console errors, ${missing} missing shots, autotest ok=${autoOk}`);
    process.exit(1);
  }
}

main();
