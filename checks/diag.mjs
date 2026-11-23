// Diagnostic one-shot renderer: renders ?shot=day with a ?skip= variant and
// saves checks/diag-<name>.png. Usage: node checks/diag.mjs <name> <skip-param>
// (skip-param may be empty). Temporary diagnostic tool, not part of the game.
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8129;
const CHROME = '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [name, skip] = process.argv.slice(2);
if (!name) {
  console.error('usage: node checks/diag.mjs <name> [skip]');
  process.exit(2);
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    server.stdout.on('data', (d) => { out += d; });
    server.stderr.on('data', (d) => { out += d; });
    server.on('error', reject);
    const check = async () => {
      for (let i = 0; i < 30; i++) {
        if (out.includes('game/ is on')) return resolve(server);
        await sleep(300);
      }
      try { server.kill('SIGTERM'); } catch { /* gone */ }
      reject(new Error(`server did not come up; output so far: ${out.slice(0, 500)}`));
    };
    check();
  });
}

function runChrome(url, shotPath) {
  return new Promise((resolve) => {
    const child = spawn(CHROME, [
      '--headless', '--no-sandbox', '--disable-dev-shm-usage',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--window-size=1280,720',
      '--virtual-time-budget=9000', '--enable-logging=stderr',
      `--screenshot=${shotPath}`, url,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } resolve({ err, code: null }); }, 90000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ err, code }); });
  });
}

const server = await startServer();
const q = skip ? `?shot=day&skip=${skip}` : '?shot=day';
const shotPath = join(root, 'checks', `diag-${name}.png`);
const { err, code } = await runChrome(`http://127.0.0.1:${PORT}/${q}`, shotPath);
const exists = existsSync(shotPath);
console.log(`diag-${name}: ${exists ? `OK ${statSync(shotPath).size} bytes` : 'MISSING'} chrome exit ${code}`);
if (!exists) console.log(err.split('\n').filter(Boolean).slice(0, 20).join('\n'));
try { server.kill('SIGTERM'); } catch { /* gone */ }
await sleep(300);
process.exit(exists ? 0 : 1);
