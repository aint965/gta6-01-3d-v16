// hud.js — permanent grouped HUD + district-coloured minimap.
// Layout (never changes between modes): title + district top-left,
// compass strip top-centre, clock + preset + fps top-right, minimap
// bottom-right, speedometer bottom-left, controls line bottom-centre.
import { DISTRICTS, ROADS, CANAL, BEACH, PLAZA, districtAt } from './city.js';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function initHud() {
  return {
    district: document.getElementById('hud-district'),
    tagline: document.getElementById('hud-tagline'),
    standing: document.getElementById('hud-standing-fill'),
    standingText: document.getElementById('hud-standing-text'),
    compass: document.getElementById('hud-compass'),
    clock: document.getElementById('hud-clock'),
    preset: document.getElementById('hud-preset'),
    fps: document.getElementById('hud-fps'),
    speed: document.getElementById('hud-speed'),
    minimap: document.getElementById('hud-minimap'),
  };
}

// Heading in degrees (0 = north, -z). Returns the 8-point label.
export function compassLabel(yawDeg) {
  const idx = Math.round((((yawDeg % 360) + 360) % 360) / 45) % 8;
  return COMPASS[idx];
}

export function drawMinimap(canvas, camX, camZ, headingDeg) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const sx = (x) => ((x + 1920) / 3840) * W;
  const sz = (z) => ((z + 1728) / 3456) * H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#10161c';
  ctx.fillRect(0, 0, W, H);
  // Water + beach.
  ctx.fillStyle = '#2e6f8e';
  ctx.fillRect(sx(CANAL.x0), sz(-1200), sx(CANAL.x1) - sx(CANAL.x0), sz(1200) - sz(-1200));
  ctx.fillStyle = '#e0cf9a';
  ctx.fillRect(sx(BEACH.x0), sz(BEACH.z0), sx(BEACH.x1) - sx(BEACH.x0), sz(BEACH.z1) - sz(BEACH.z0));
  // Roads.
  ctx.fillStyle = '#4a4f55';
  for (const r of ROADS) {
    if (r.axis === 'z') ctx.fillRect(sx(r.cx - r.w / 2), 0, (r.w / 3840) * W, H);
    else ctx.fillRect(0, sz(r.cz - r.w / 2), W, (r.w / 3456) * H);
  }
  // Boulevard highlighted.
  ctx.fillStyle = '#8a6a3a';
  ctx.fillRect(sx(400 - 32), 0, (64 / 3840) * W, H);
  // Plaza.
  ctx.fillStyle = '#ffd25f';
  ctx.beginPath();
  ctx.arc(sx(PLAZA.x), sz(PLAZA.z), 4, 0, Math.PI * 2);
  ctx.fill();
  // Buildings coloured by district (drawn by the main loop's city ref).
  return { sx, sz };
}

export function drawMinimapBuildings(canvas, buildings) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const sx = (x) => ((x + 1920) / 3840) * W;
  const sz = (z) => ((z + 1728) / 3456) * H;
  const colors = {};
  for (const d of DISTRICTS) colors[d.id] = d.palette[0];
  for (const b of buildings) {
    ctx.fillStyle = colors[b.district] ?? '#888888';
    const w = Math.max(1.5, (b.w / 3840) * W);
    const h = Math.max(1.5, (b.d / 3456) * H);
    ctx.fillRect(sx(b.x) - w / 2, sz(b.z) - h / 2, w, h);
  }
}

export function drawMinimapPlayer(canvas, camX, camZ, headingDeg) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const sx = (x) => ((x + 1920) / 3840) * W;
  const sz = (z) => ((z + 1728) / 3456) * H;
  const x = sx(camX);
  const y = sz(camZ);
  const a = ((headingDeg - 90) * Math.PI) / 180; // 0 deg heading = north (-z)
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#10161c';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7);
  ctx.lineTo(x + Math.cos(a + 2.5) * 5, y + Math.sin(a + 2.5) * 5);
  ctx.lineTo(x + Math.cos(a - 2.5) * 5, y + Math.sin(a - 2.5) * 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

export function updateHud(els, state) {
  const d = districtAt(state.camX, state.camZ);
  els.district.textContent = d.name.toUpperCase();
  els.tagline.textContent = d.tagline;
  els.standing.style.width = `${d.standing}%`;
  els.standingText.textContent = `${d.standing} standing`;
  els.compass.textContent = compassLabel(state.headingDeg);
  els.clock.textContent = state.time;
  els.preset.textContent = state.presetName;
  els.fps.textContent = state.shotMode ? '— fps' : `${state.fps} fps`;
  els.speed.textContent = `${Math.round(state.speedKmh)} km/h`;
}
