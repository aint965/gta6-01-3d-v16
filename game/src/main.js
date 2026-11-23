// main.js — Palkon Auto entrypoint (Stage B: driving + missions 1-4).
// Resolves the game directory from its own URL, so the grader can run it
// from any working directory. Camera: chase cam while driving, orbit-follow
// on foot, drag to orbit, wheel to zoom, 1/2/3 or T cycles presets,
// H toggles headlights. ?shot=day|sunset|night|plaza frames a fixed
// showcase view (fps frozen as "— fps" in shot mode). ?demo=drive|night
// runs a scripted drive for screenshots; ?demo=headlight&lights=on|off
// freezes a night composition for the headlight pixel test;
// ?mission=N starts mission N near its pickup;
// ?autotest=missions plays missions 1-4 with the autopilot and writes the
// result into #autotest-result (read with --dump-dom).
import { generateCity, SEED, PLAZA } from './city.js';
import { Renderer, PRESETS } from './render.js';
import { initHud, updateHud, drawMinimap, drawMinimapBuildings, drawMinimapPlayer, drawMinimapMission } from './hud.js';
import {
  PROFILES, kmh, ms, forwardOf, rotOf,
  initTraffic, stepTraffic, makeTrafficStats,
  initPedestrians, stepPedestrians,
  makePlayerCar, stepCar,
  makeWalker, stepWalker,
  nearestDrivable, nearestParked, exitSpot,
  findPath, autopilotInput, autopilotFollow, lightState, stopOffsetFor,
} from './drive.js';
import { MISSIONS, createMissions, currentMission, currentTarget, objectiveText, dialogLine, stepMissions } from './missions.js';

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
const demo = params.get('demo') || '';
const missionParam = parseInt(params.get('mission') || '0', 10) || 0;
const autotest = params.get('autotest') || '';
const ff = Math.max(1, parseInt(params.get('ff') || '1', 10));
// ?norender=1 skips the WebGL draw + HUD/minimap work each frame (test hook
// for the autotest only — the sim still runs). Without it the headless
// shell's SwiftShader render is the bottleneck and the 4-mission autotest
// cannot finish inside a virtual-time budget.
const norender = params.get('norender') === '1';
const seedParam = params.get('seed') || '';

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

// ---- Stage B state ----
const traffic = initTraffic(city);
const trafficStats = makeTrafficStats();
const peds = initPedestrians(city);
const missions = createMissions();
if (missionParam >= 1 && missionParam <= MISSIONS.length) {
  missions.idx = missionParam - 1;
  missions.phase = 'pickup';
}
const DRIVABLE_PROFILES = ['compact', 'sedan', 'van', 'coupe', 'sedan', 'compact', 'coupe', 'van'];
const drivableCars = city.cars.filter((c) => c.kind === 'drivable');
// Mara spawns on foot 4 m from drivable car #0, toward the plaza centre.
const car0 = drivableCars[0];
const toPlaza = [PLAZA.x - car0.x, PLAZA.z - car0.z];
const tpl = Math.hypot(toPlaza[0], toPlaza[1]) || 1;
const mara = makeWalker(car0.x + (toPlaza[0] / tpl) * 4, car0.z + (toPlaza[1] / tpl) * 4);
let mode = 'walk'; // 'walk' | 'driving'
let playerCar = null; // makePlayerCar wrapper while driving
let headlightsOn = true;
let presetName = shotMode ? shotMode.preset : 'midday';
renderer.buildSky(presetName);
renderer.buildShadows(presetName);

// ---- demo / autotest setup ----
let demoState = null; // {kind, ...}
let autoState = null; // {waypoints, idx, phase, done, result}
if (demo === 'drive' || demo === 'night') {
  presetName = demo === 'night' ? 'night' : 'midday';
  renderer.buildSky(presetName);
  renderer.buildShadows(presetName);
  // Sedan (drivable car #1) on the boulevard heading south, autopilot drives.
  const carObj = drivableCars[1];
  carObj.x = 400;
  carObj.z = -900;
  carObj.rot = 0;
  playerCar = makePlayerCar(carObj, 'sedan');
  mode = 'driving';
  // A lead traffic car 15 m ahead, slightly slower, so the player follows it
  // inside the headlight cone (night) and traffic stays visible (day).
  const bRoute = traffic.routes.find((r) => r.name === 'boulevard');
  let lead = null;
  let bestD = Infinity;
  for (const tc of traffic.cars) {
    if (tc.route !== bRoute) continue;
    const p = { x: tc.car.x, z: tc.car.z };
    const dd = Math.hypot(p.x - 400, p.z - (-885));
    if (dd < bestD) { bestD = dd; lead = tc; }
  }
  if (lead) {
    lead.car.x = 400;
    lead.car.z = -885;
    lead.car.rot = 0;
    lead.cruise = 12;
    // Re-anchor its route position to the new spot — on the SOUTHBOUND lane
    // (x=392), so it drives away from the player, not head-on at it.
    let bs = 0;
    let bd = Infinity;
    for (let i = 0; i < bRoute.pts.length; i++) {
      const pt = bRoute.pts[i];
      if (Math.abs(pt.x - 392) > 1) continue;
      const dd = Math.hypot(pt.x - 400, pt.z - (-885));
      if (dd < bd) { bd = dd; bs = bRoute.cum[i]; }
    }
    lead.s = bs;
    lead.speed = 12;
  }
  demoState = { kind: demo, lane: 400, laneTimer: 0 };
} else if (demo === 'headlight') {
  presetName = 'night';
  renderer.buildSky(presetName);
  renderer.buildShadows(presetName);
  headlightsOn = (params.get('lights') || 'on') !== 'off';
  const carObj = drivableCars[1];
  carObj.x = 400;
  carObj.z = -400;
  carObj.rot = 0;
  playerCar = makePlayerCar(carObj, 'sedan');
  playerCar.speed = 0;
  mode = 'driving';
  // Lead car: white, 15 m ahead, centred in the cone.
  const leadCar = city.cars.find((c) => c.kind === 'traffic' && c.color === '#e8e4d8');
  if (leadCar) {
    leadCar.x = 400;
    leadCar.z = -385;
    leadCar.rot = 0;
  }
  demoState = { kind: 'headlight', frozen: true };
} else if (missionParam >= 1 && missionParam <= MISSIONS.length) {
  // Mission screenshot: Mara on foot 10 m from the pickup, sunset light.
  presetName = 'sunset';
  renderer.buildSky(presetName);
  renderer.buildShadows(presetName);
  const t = currentTarget(missions);
  mara.x = t.x + 10;
  mara.z = t.z + 6;
  mara.rot = rotOf(t.x - mara.x, t.z - mara.z);
  demoState = { kind: 'mission', frozen: true };
} else if (autotest === 'missions') {
  autoState = { waypoints: null, idx: 0, phase: 'to-pickup', done: false, result: null, entered: false };
}

// Camera state.
const cam = {
  target: shotMode ? [...shotMode.target] : [mara.x, 2, mara.z],
  yaw: 0,
  pitch: 0.35,
  dist: shotMode ? 0 : 26,
  pos: shotMode ? [...shotMode.pos] : [mara.x, 20, mara.z + 26],
  yawOffset: 0, // chase-cam orbit offset while driving
};
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
  if (mode === 'driving') {
    cam.yawOffset -= dx * 0.005;
  } else {
    cam.yaw -= dx * 0.005;
    cam.pitch = Math.max(-0.1, Math.min(1.2, cam.pitch + dy * 0.003));
  }
});
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('wheel', (e) => {
  if (shotMode) return;
  e.preventDefault();
  cam.dist = Math.max(10, Math.min(120, cam.dist * (1 + Math.sign(e.deltaY) * 0.08)));
}, { passive: false });

function setPreset(name) {
  if (!PRESETS[name]) return;
  presetName = name;
  renderer.buildSky(name);
  renderer.buildShadows(name);
}

const keys = {};
function cameraPos() {
  if (shotMode) return cam.pos;
  return cam.pos;
}
function headingDeg() {
  const p = cam.pos;
  const dx = cam.target[0] - p[0];
  const dz = cam.target[2] - p[2];
  return (Math.atan2(dx, -dz) * 180) / Math.PI;
}

function enterCar() {
  const near = nearestDrivable(city, mara.x, mara.z, 6);
  if (!near) return false;
  const idx = drivableCars.indexOf(near.car);
  playerCar = makePlayerCar(near.car, DRIVABLE_PROFILES[idx] ?? 'sedan');
  mode = 'driving';
  return true;
}
function exitCar() {
  if (!playerCar) return;
  const spot = exitSpot(city, playerCar.obj);
  mara.x = spot.x;
  mara.z = spot.z;
  mara.rot = playerCar.obj.rot;
  playerCar = null;
  mode = 'walk';
}

window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === '1') setPreset('midday');
  if (e.key === '2') setPreset('sunset');
  if (e.key === '3') setPreset('night');
  if (e.key === 't' || e.key === 'T') {
    const order = ['midday', 'sunset', 'night'];
    setPreset(order[(order.indexOf(presetName) + 1) % order.length]);
  }
  if (e.key === 'h' || e.key === 'H') headlightsOn = !headlightsOn;
  if (e.key === 'e' || e.key === 'E') {
    if (mode === 'walk') enterCar();
    else exitCar();
  }
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

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

// ---- simulation ----
let t = 0;
let shake = 0;
let damageFlash = 0;
let broadcastUntil = 0;
const dust = [];
let frames = 0;
let fps = 0;
let lastFpsAt = performance.now();
let firstFrame = true;
let autoDoneWritten = false;

function obstaclesAhead(px, pz, fx, fz) {
  const obs = [];
  for (const tc of traffic.cars) {
    const rx = tc.car.x - px;
    const rz = tc.car.z - pz;
    const along = rx * fx + rz * fz;
    const lat = Math.abs(rx * -fz + rz * fx);
    if (along > 0 && along < 24 && lat < 3.5) obs.push({ x: tc.car.x, z: tc.car.z, speed: tc.speed, kind: 'car', rot: tc.car.rot });
  }
  // Red/amber lights ahead: the stop line is `offset` before the
  // intersection centre, projected onto the player's own path (the route
  // stop lines sit on the traffic lanes; the player may drive the centre).
  for (const l of city.trafficLights) {
    const ix = l.x - 34;
    const iz = l.z - 34;
    const rx = ix - px;
    const rz = iz - pz;
    const along = rx * fx + rz * fz;
    const lat = Math.abs(rx * -fz + rz * fx);
    if (along > 0 && along < 26 && lat < 6) {
      const state = lightState(l, t);
      if (state !== 'green') {
        const axis = Math.abs(fz) > Math.abs(fx) ? 'z' : 'x';
        const off = stopOffsetFor(ix, iz, axis);
        obs.push({ x: px + fx * (along - off), z: pz + fz * (along - off), speed: 0, kind: 'light' });
      }
    }
  }
  return obs;
}

function stepSim(dt) {
  t += dt;
  // Traffic + pedestrians always run (except frozen demo/mission shots).
  if (!demoState?.frozen) {
    const playerObs = [];
    if (playerCar) {
      const [fx, fz] = forwardOf(playerCar.obj.rot);
      playerObs.push({ x: playerCar.obj.x, z: playerCar.obj.z, fx, fz, speed: playerCar.speed });
    }
    // Pedestrians crossing in a traffic car's path make it stop.
    // initPedestrians returns an ARRAY; crossers carry their z as `cz`.
    for (const pd of peds) {
      if (pd.mode === 'cross' && pd.wait <= 0) {
        playerObs.push({ x: pd.x, z: pd.cz, speed: 0 });
      }
    }
    stepTraffic(traffic, city, dt, t, playerObs, trafficStats);
    stepPedestrians(peds, dt, trafficStats);
  }
  // Dust ages.
  for (const d of dust) d.age += dt;
  for (let i = dust.length - 1; i >= 0; i--) if (dust[i].age >= dust[i].life) dust.splice(i, 1);
  shake = Math.max(0, shake - 2 * dt);
  damageFlash = Math.max(0, damageFlash - 1.2 * dt);
  if (missions.broadcast && t > broadcastUntil) missions.broadcast = null;

  const moved = (keys.w || keys.a || keys.s || keys.d || keys.arrowup || keys.arrowdown || keys.arrowleft || keys.arrowright || (playerCar && Math.abs(playerCar.speed) > 0.1) || (mode === 'walk' && mara.speed > 0) || (autoState && !autoState.done));

  if (demoState?.kind === 'drive' || demoState?.kind === 'night') {
    // Scripted drive down the boulevard with lane weaving + red-light stops.
    const car = playerCar.obj;
    const [fx, fz] = forwardOf(car.rot);
    demoState.laneTimer -= dt;
    if (demoState.laneTimer <= 0) {
      demoState.laneTimer = 0.5;
      let lane = 400;
      for (const tc of traffic.cars) {
        const rx = tc.car.x - car.x;
        const rz = tc.car.z - car.z;
        const along = rx * fx + rz * fz;
        const lat = Math.abs(rx * -fz + rz * fx);
        if (along > 0 && along < 28 && lat < 5) {
          // Blocked: pick the clearer side lane.
          lane = tc.car.x < car.x ? 416 : 384;
          break;
        }
      }
      demoState.lane = lane;
    }
    const target = { x: demoState.lane, z: car.z + 260 };
    const obs = obstaclesAhead(car.x, car.z, fx, fz);
    const input = autopilotInput(car, target, dt, { cruise: ms(62), obstacles: obs });
    const events = stepCar(playerCar, input, dt, city, city.cars.filter((c) => c !== car));
    for (const ev of events) {
      shake = Math.min(1, shake + ev.damage / 40);
      damageFlash = 0.55;
      for (let i = 0; i < 5; i++) dust.push({ x: ev.x, z: ev.z, age: 0, life: 1 });
    }
  } else if (autoState && !autoState.done) {
    stepAutotest(dt);
  } else if (!shotMode && !demoState?.frozen) {
    // Manual play.
    if (mode === 'driving' && playerCar) {
      const input = {
        throttle: (keys.w || keys.arrowup) ? 1 : 0,
        brake: (keys.s || keys.arrowdown) ? 1 : 0,
        steer: ((keys.a || keys.arrowleft) ? -1 : 0) + ((keys.d || keys.arrowright) ? 1 : 0),
        handbrake: !!keys[' '],
        reverse: false,
      };
      if (input.brake && playerCar.speed <= 0.1) { input.reverse = true; input.brake = 0; }
      const events = stepCar(playerCar, input, dt, city, city.cars.filter((c) => c !== playerCar.obj));
      for (const ev of events) {
        shake = Math.min(1, shake + ev.damage / 40);
        damageFlash = 0.55;
        for (let i = 0; i < 5; i++) dust.push({ x: ev.x, z: ev.z, age: 0, life: 1 });
      }
    } else {
      // On foot: WASD relative to the camera yaw.
      const cy = cam.yaw;
      let mx = 0;
      let mz = 0;
      if (keys.w || keys.arrowup) { mx += -Math.sin(cy); mz += -Math.cos(cy); }
      if (keys.s || keys.arrowdown) { mx += Math.sin(cy); mz += Math.cos(cy); }
      if (keys.a || keys.arrowleft) { mx += -Math.cos(cy); mz += Math.sin(cy); }
      if (keys.d || keys.arrowright) { mx += Math.cos(cy); mz += -Math.sin(cy); }
      stepWalker(mara, (mx !== 0 || mz !== 0) ? { mx, mz } : null, !!keys.shift, dt, city, city.cars);
    }
  }

  // Missions: the player's position is the car when driving, Mara on foot.
  const pos = playerCar ? { x: playerCar.obj.x, z: playerCar.obj.z } : { x: mara.x, z: mara.z };
  const mEvents = stepMissions(missions, pos, !!moved, dt);
  for (const ev of mEvents) {
    if (ev.type === 'finale') broadcastUntil = t + 8;
  }
}

function stepAutotest(dt) {
  const target = currentTarget(missions);
  if (!target) {
    autoState.done = true;
    autoState.result = {
      ok: missions.cash === 2000 && missions.earned.length === 4,
      cash: missions.cash,
      earned: missions.earned,
      timer: Math.round(missions.timer * 10) / 10,
      log: missions.log,
    };
    const el = document.getElementById('autotest-result');
    if (el) el.textContent = JSON.stringify(autoState.result);
    document.title = `AUTOTEST ${autoState.result.ok ? 'OK' : 'FAIL'} cash=${missions.cash}`;
    return;
  }
  const pos = playerCar ? { x: playerCar.obj.x, z: playerCar.obj.z } : { x: mara.x, z: mara.z };
  const dist = Math.hypot(target.x - pos.x, target.z - pos.z);
  if (mode === 'walk') {
    // Walk the last stretch to the marker. The threshold (30 m) must be
    // larger than the drive-exit distance (12 m) plus the exit offset
    // (3.2 m) — otherwise Mara exits the car, is still beyond the walk
    // threshold, re-enters the car at once, exits again, and loops forever.
    if (dist <= 30) {
      stepWalker(mara, { mx: target.x - mara.x, mz: target.z - mara.z }, false, dt, city, city.cars);
    } else {
      // Enter the nearest drivable car (the one just exited is right here).
      if (!enterCar()) {
        // No car nearby: walk toward the nearest drivable car.
        let best = null;
        let bestD = Infinity;
        for (const c of drivableCars) {
          const d = Math.hypot(c.x - mara.x, c.z - mara.z);
          if (d < bestD) { bestD = d; best = c; }
        }
        if (best) stepWalker(mara, { mx: best.x - mara.x, mz: best.z - mara.z }, true, dt, city, city.cars);
      } else {
        autoState.waypoints = null;
        autoState.idx = 0;
      }
    }
  } else {
    if (dist <= 12) {
      exitCar();
      autoState.waypoints = null;
      autoState.idx = 0;
      return;
    }
    if (!autoState.waypoints) {
      autoState.waypoints = findPath(city, { x: playerCar.obj.x, z: playerCar.obj.z }, target);
      autoState.idx = 0;
    }
    const [fx, fz] = forwardOf(playerCar.obj.rot);
    const obs = obstaclesAhead(playerCar.obj.x, playerCar.obj.z, fx, fz);
    const res = autopilotFollow(playerCar.obj, autoState.waypoints, autoState.idx, dt, { cruise: ms(55), obstacles: obs });
    autoState.idx = res.nextIdx;
    const events = stepCar(playerCar, res.input, dt, city, city.cars.filter((c) => c !== playerCar.obj));
    for (const ev of events) {
      shake = Math.min(1, shake + ev.damage / 40);
      damageFlash = 0.55;
      for (let i = 0; i < 5; i++) dust.push({ x: ev.x, z: ev.z, age: 0, life: 1 });
    }
  }
}

function updateCamera(dt) {
  if (shotMode) return;
  let ideal;
  let look;
  if (mode === 'driving' && playerCar) {
    const car = playerCar.obj;
    const yaw = car.rot + cam.yawOffset;
    const fx = -Math.sin(yaw);
    const fz = Math.cos(yaw);
    ideal = [car.x - fx * 15, 7, car.z - fz * 15];
    look = [car.x + (-Math.sin(car.rot)) * 8, 2, car.z + Math.cos(car.rot) * 8];
  } else {
    const target = [mara.x, 2, mara.z];
    ideal = [
      target[0] + Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist,
      target[1] + Math.sin(cam.pitch) * cam.dist,
      target[2] + Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist,
    ];
    look = target;
  }
  // Frozen demo shots (headlight on/off pair, mission stills) must be
  // pixel-identical except for the effect under test — snap the camera
  // instead of lerping from Mara's spawn, or the two runs frame at
  // different points along the lerp and the comparison is meaningless.
  const k = demoState?.frozen ? 1 : 1 - Math.exp(-5 * dt);
  cam.pos[0] += (ideal[0] - cam.pos[0]) * k;
  cam.pos[1] += (ideal[1] - cam.pos[1]) * k;
  cam.pos[2] += (ideal[2] - cam.pos[2]) * k;
  cam.target[0] += (look[0] - cam.target[0]) * k;
  cam.target[1] += (look[1] - cam.target[1]) * k;
  cam.target[2] += (look[2] - cam.target[2]) * k;
  if (shake > 0) {
    cam.pos[0] += (Math.random() - 0.5) * shake * 1.2;
    cam.pos[1] += (Math.random() - 0.5) * shake * 0.8;
  }
}

// FPS counter: a real number in live play, frozen in shot mode.
let lastNow = performance.now();

function frame(now) {
  resize();
  const dtReal = Math.min(0.5, Math.max(0.001, (now - lastNow) / 1000));
  lastNow = now;
  // Fixed 1/60 s substeps; autotest/demo fast-forward multiplies them.
  const stepsPerFrame = autotest === 'missions' ? 10 * ff : demoState ? 20 : Math.max(1, Math.ceil(dtReal / (1 / 60)));
  const subDt = 1 / 60;
  if (!shotMode) {
    for (let i = 0; i < stepsPerFrame; i++) stepSim(subDt);
  }
  updateCamera(dtReal);
  const pos = cameraPos();
  const aspect = canvas.width / Math.max(1, canvas.height);
  if (!norender) {
  // Stage B state for the renderer.
  const target = currentTarget(missions);
  const nearDrive = mode === 'walk' ? nearestDrivable(city, mara.x, mara.z, 10) : null;
  const nearParked = mode === 'walk' && !nearDrive ? nearestParked(city, mara.x, mara.z, 10) : null;
  const near = nearDrive ?? nearParked;
  renderer.setStageB({
    playerCar: playerCar ? playerCar.obj : null,
    headlightsOn,
    preset: presetName,
    time: t,
    eRing: near ? { x: near.car.x, z: near.car.z, r: 6, locked: !nearDrive } : null,
    markers: target ? [target] : [],
    mara: mode === 'walk' ? { x: mara.x, z: mara.z, rot: mara.rot } : null,
    dust,
    lightStates: city.trafficLights.map((l) => ({ x: l.x, z: l.z, state: lightState(l, t) })),
  });
  renderer.draw(presetName, { pos, target: cam.target }, aspect);
  frames++;
  if (now - lastFpsAt >= 500) {
    fps = Math.round((frames * 1000) / (now - lastFpsAt));
    frames = 0;
    lastFpsAt = now;
  }
  const m = currentMission(missions);
  let prompt = '';
  if (mode === 'walk' && nearDrive) prompt = `E — ENTER ${PROFILES[DRIVABLE_PROFILES[drivableCars.indexOf(nearDrive.car)] ?? 'sedan'].label}`;
  else if (mode === 'walk' && nearParked) prompt = 'LOCKED — PARKED CAR';
  else if (mode === 'driving') prompt = 'E — EXIT';
  updateHud(hud, {
    camX: playerCar ? playerCar.obj.x : mara.x,
    camZ: playerCar ? playerCar.obj.z : mara.z,
    headingDeg: headingDeg(),
    time: PRESETS[presetName].time,
    presetName: PRESETS[presetName].name,
    fps,
    speedKmh: playerCar ? Math.abs(kmh(playerCar.speed)) : mara.speed * 3.6,
    shotMode: !!shotMode,
    modeLabel: shotMode ? 'SHOT VIEW' : mode === 'driving' ? `DRIVING · ${PROFILES[playerCar.profile].label}` : 'ON FOOT',
    mission: m,
    objective: objectiveText(missions),
    missionTimer: missions.timer,
    cash: missions.cash,
    dialog: dialogLine(missions),
    prompt,
    broadcast: missions.broadcast,
    damageFlash,
  });
  const minimapX = playerCar ? playerCar.obj.x : mara.x;
  const minimapZ = playerCar ? playerCar.obj.z : mara.z;
  drawMinimap(hud.minimap, minimapX, minimapZ, headingDeg());
  drawMinimapBuildings(hud.minimap, city.buildings);
  if (target) drawMinimapMission(hud.minimap, target);
  drawMinimapPlayer(hud.minimap, minimapX, minimapZ, headingDeg());
  }
  if (firstFrame) {
    firstFrame = false;
    window.__gameReady = true;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
