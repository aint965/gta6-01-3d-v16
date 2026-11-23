// drive.mjs — headless drive test for Stage A. Serves game/ on port 8127,
// loads each ?shot= view in the headless Chromium shell (SwiftShader),
// captures console/page errors from its stderr log, saves the screenshots
// and converts any over the 256 KiB cap to JPEG. Run: node checks/drive.mjs
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, unlinkSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const shotsDir = join(repo, 'screenshots');
const PORT = 8127;
const CHROME = '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';
const SHOTS = [
  { name: '1-boulevard-day.png', query: '?shot=day&seed=20261123' },
  { name: '2-sunset.png', query: '?shot=sunset&seed=20261123' },
  { name: '3-night.png', query: '?shot=night&seed=20261123' },
  { name: '4-plaza.png', query: '?shot=plaza&seed=20261123' },
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

function runChrome(url, shotPath) {
  return new Promise((resolve) => {
    const args = [
      '--headless',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      '--window-size=1280,720',
      '--virtual-time-budget=9000',
      '--enable-logging=stderr',
      `--screenshot=${shotPath}`,
      url,
    ];
    const child = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } resolve({ out, err, code: null, timedOut: true }); }, 90000);
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
  // Clean stale screenshots first: an earlier run may have left a .jpg next to
  // a re-rendered .png (or vice versa), and the dossier caps screenshots/ at
  // exactly the 4 files shots.json lists.
  for (const f of readdirSync(shotsDir)) {
    unlinkSync(join(shotsDir, f));
  }
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
  const up = await waitForServer(`http://127.0.0.1:${PORT}/`);
  if (!up) {
    console.log('DRIVE FAIL: dev server did not come up');
    try { server.kill('SIGTERM'); } catch { /* gone */ }
    process.exit(1);
  }
  console.log(`server up on ${PORT}`);
  let totalErrors = 0;
  let missing = 0;
  const finalShots = [];
  for (const s of SHOTS) {
    const shotPath = join(shotsDir, s.name);
    const url = `http://127.0.0.1:${PORT}/${s.query}`;
    const { err, code, timedOut } = await runChrome(url, shotPath);
    const errors = consoleErrors(err);
    totalErrors += errors.length;
    const exists = existsSync(shotPath);
    if (!exists) missing++;
    let size = 0;
    if (exists) {
      try { size = statSync(shotPath).size; } catch { /* vanished */ }
    }
    let finalName = s.name;
    if (exists && size > 262144) {
      const jpg = await convertToJpeg(shotPath);
      if (jpg) {
        finalName = jpg.split('/').pop();
        size = statSync(jpg).size;
        console.log(`  ${s.name}: over cap — converted to ${finalName} (${size} bytes)`);
      }
    }
    console.log(`  ${s.name}: ${exists ? 'OK' : 'MISSING'} ${size} bytes, chrome exit ${code}, console errors: ${errors.length}${timedOut ? ' (TIMED OUT)' : ''}`);
    for (const e of errors.slice(0, 5)) console.log(`    ! ${e}`);
    if (!exists) {
      console.log(`    chrome stderr (first 25 lines):`);
      for (const line of err.split('\n').filter((l) => l.trim() !== '').slice(0, 25)) console.log(`    | ${line}`);
    }
    finalShots.push({ name: finalName, query: s.query });
  }
  // shots.json must list exactly what is on disk.
  writeFileSync(join(repo, 'shots.json'), JSON.stringify(finalShots.map((f) => ({ name: f.name, query: f.query })), null, 0) + '\n');
  try { server.kill('SIGTERM'); } catch { /* gone */ }
  await sleep(500);
  if (totalErrors === 0 && missing === 0) {
    console.log(`DRIVE OK: 4/4 shots, 0 console errors`);
    process.exit(0);
  } else {
    console.log(`DRIVE FAIL: ${totalErrors} console errors, ${missing} missing shots`);
    process.exit(1);
  }
}

main();
