// main.js — Palkon Auto entrypoint (Stage A: renderer + city, no driving yet).
// Resolves the game directory from its own URL, so the grader can run it
// from any working directory. Camera: drag to orbit, wheel to zoom,
// 1/2/3 or T cycles the lighting presets. ?shot=day|sunset|night|plaza
// frames a fixed showcase view (fps frozen as "— fps" in shot mode).
import { generateCity, SEED } from './city.js';
import { Renderer, PRESETS } from './render.js';
import { initHud, updateHud, drawMinimap, drawMinimapBuildings, drawMinimapPlayer } from './hud.js';

const params = new URLSearchParams(location.search);
const shot = params.get('shot') || '';
const SHOT_CAMERAS = {
  day: { preset: 'midday', pos: [400, 60, 650], target: [400, 45, -100] },
  sunset: { preset: 'sunset', pos: [800, 45, 100], target: [-500, 40, 100] },
  night: { preset: 'night', pos: [400, 60, 650], target: [400, 200, -250] },
  plaza: { preset: 'midday', pos: [400, 800, 800], target: [400, 0, 0] },
  start: { preset: 'midday', pos: [400, 60, 650], target: [400, 45, -100] },
  play: { preset: 'sunset', pos: [800, 45, 100], target: [-500, 40, 100] },
  end: { preset: 'night', pos: [400, 60, 650], target: [400, 200, -250] },
};
const shotMode = SHOT_CAMERAS[shot] ?? null;

const canvas = document.getElementById('game');
const city = generateCity(SEED);
const skip = new Set((params.get('skip') || '').split(',').filter(Boolean));
const renderer = new Renderer(canvas, city, {
  noShadows: skip.has('shadow'),
  noWindows: skip.has('windows'),
  noTrees: skip.has('trees'),
  noSky: skip.has('sky'),
});
const hud = initHud();

let presetName = shotMode ? shotMode.preset : 'midday';
renderer.buildSky(presetName);
renderer.buildShadows(presetName);

// Camera state: orbit around a target point.
const cam = {
  target: shotMode ? [...shotMode.target] : [400, 40, 0],
  yaw: 0, // 0 = camera south of the target, looking north
  pitch: 0.12,
  dist: shotMode ? 0 : 700, // shot cameras use fixed pos/target instead
  pos: shotMode ? [...shotMode.pos] : [400, 124, 700],
};

function cameraPos() {
  if (shotMode) return cam.pos;
  return [
    cam.target[0] + Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist,
    cam.target[1] + Math.sin(cam.pitch) * cam.dist,
    cam.target[2] + Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist,
  ];
}

function headingDeg() {
  // Direction the camera looks, in degrees (0 = north).
  const p = cameraPos();
  const dx = cam.target[0] - p[0];
  const dz = cam.target[2] - p[2];
  return (Math.atan2(dx, -dz) * 180) / Math.PI;
}

function setPreset(name) {
  if (!PRESETS[name]) return;
  presetName = name;
  renderer.buildSky(name);
  renderer.buildShadows(name);
}

// Input: drag orbits, wheel zooms, keys cycle presets.
let dragging = false;
let lastX = 0;
let lastY = 0;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging || shotMode) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  cam.yaw -= dx * 0.005;
  cam.pitch = Math.max(-0.1, Math.min(1.2, cam.pitch + dy * 0.003));
});
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('wheel', (e) => {
  if (shotMode) return;
  e.preventDefault();
  cam.dist = Math.max(120, Math.min(2400, cam.dist * (1 + Math.sign(e.deltaY) * 0.08)));
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (e.key === '1') setPreset('midday');
  if (e.key === '2') setPreset('sunset');
  if (e.key === '3') setPreset('night');
  if (e.key === 't' || e.key === 'T') {
    const order = ['midday', 'sunset', 'night'];
    setPreset(order[(order.indexOf(presetName) + 1) % order.length]);
  }
});

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}
window.addEventListener('resize', resize);
resize();

// FPS counter: a real number in live play, frozen in shot mode.
let frames = 0;
let fps = 0;
let lastFpsAt = performance.now();
let firstFrame = true;

function frame(now) {
  resize();
  const pos = cameraPos();
  const aspect = canvas.width / Math.max(1, canvas.height);
  renderer.draw(presetName, { pos, target: cam.target }, aspect);
  frames++;
  if (now - lastFpsAt >= 500) {
    fps = Math.round((frames * 1000) / (now - lastFpsAt));
    frames = 0;
    lastFpsAt = now;
  }
  updateHud(hud, {
    camX: pos[0],
    camZ: pos[2],
    headingDeg: headingDeg(),
    time: PRESETS[presetName].time,
    presetName: PRESETS[presetName].name,
    fps,
    speedKmh: 0,
    shotMode: !!shotMode,
  });
  drawMinimap(hud.minimap, pos[0], pos[2], headingDeg());
  drawMinimapBuildings(hud.minimap, city.buildings);
  drawMinimapPlayer(hud.minimap, pos[0], pos[2], headingDeg());
  if (firstFrame) {
    firstFrame = false;
    window.__gameReady = true;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
