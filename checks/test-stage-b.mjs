// test-stage-b.mjs — Stage B verification in Node, no browser needed.
// Runs the SAME drive.js / missions.js the game runs:
//   1. top speed per driving profile (exact km/h, 0 building collisions)
//   2. reverse distance in 2.5 s (S = reverse, as in the game)
//   3. red-light stop: the player car stops before the line, never crosses
//      it on red, and proceeds after green
//   4. 90 s traffic: stops, red-runs, min follow gap, collisions, off-road,
//      pedestrian crossings
//   5. collision damage (building + parked car) and speed loss on impact
//   6. E enter/exit: nearest drivable within 6 m, exit spot is free,
//      no prompt far from any car, parked cars are locked
//   7. on-foot walking blocked by a building
//   8. headlight cone: a car ahead is lit, a car behind / to the side is not
//   9. missions 1-4 played to completion by the autopilot: cash per mission,
//      total $2,000, timer stays 0 before the first move, finale broadcast
//  10. traffic-light cycle: 26 s, green 16 / amber 2 / red 8
// Usage: node checks/test-stage-b.mjs   (exit 0 = all pass)
import { generateCity, SEED, PLAZA } from '../game/src/city.js';
import {
  PROFILES, kmh, ms, forwardOf, rotOf,
  initTraffic, stepTraffic, makeTrafficStats,
  initPedestrians, stepPedestrians,
  makePlayerCar, stepCar,
  makeWalker, stepWalker,
  nearestDrivable, nearestParked, exitSpot,
  findPath, autopilotInput, autopilotFollow, lightState, stopOffsetFor,
  carsInHeadlightCone, buildingHit,
} from '../game/src/drive.js';
import { MISSIONS, createMissions, stepMissions, currentTarget } from '../game/src/missions.js';

const DT = 1 / 60;
let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}

const city = generateCity(SEED);
const t0 = Date.now();
// A standalone test car (not in city.cars, so traffic never interferes).
const testCar = (x, z, rot = 0) => ({ x, z, rot, kind: 'drivable', color: '#ffffff' });

// --- 1. top speed per profile -------------------------------------------
// Secondary-east road (x=1000), straight from z=-1400 heading +z.
for (const [name, prof] of Object.entries(PROFILES)) {
  const obj = testCar(1000, -1400, 0);
  const car = makePlayerCar(obj, name);
  let maxKmh = 0;
  let collisions = 0;
  for (let i = 0; i < 60 / DT; i++) {
    const evs = stepCar(car, { throttle: 1, brake: 0, steer: 0, handbrake: false, reverse: false }, DT, city, []);
    maxKmh = Math.max(maxKmh, Math.abs(kmh(car.speed)));
    collisions += evs.length;
  }
  check(`top speed ${name}`, Math.abs(maxKmh - prof.top) < 0.5 && collisions === 0,
    `max ${maxKmh.toFixed(1)} km/h (want ${prof.top}), collisions ${collisions}, end z=${obj.z.toFixed(0)}`);
}

// --- 2. reverse ----------------------------------------------------------
{
  const obj = testCar(1000, 0, 0);
  const car = makePlayerCar(obj, 'sedan');
  const z0 = obj.z;
  for (let i = 0; i < 2.5 / DT; i++) {
    stepCar(car, { throttle: 0, brake: 0, steer: 0, handbrake: false, reverse: true }, DT, city, []);
  }
  const dist = z0 - obj.z;
  check('reverse 2.5 s', dist >= 11 && dist <= 16, `reversed ${dist.toFixed(1)} m (want 11-16)`);
}

// --- 3. red-light stop ----------------------------------------------------
{
  const traffic = initTraffic(city);
  const route = traffic.routes.find((r) => r.name === 'boulevard');
  // Stop on the southbound lane (x=392) at the (400,-600) intersection:
  // the cross road is a secondary (half-width 14), so the line sits 16 m
  // before the centre. Light phase offset 16: amber t=0, red t=2-10,
  // green from t=10.
  const stop = route.stops.find((s) => s.ix === 400 && s.iz === -600 && Math.abs(s.x - 392) < 2);
  const lineZ = stop.z;
  const obj = testCar(392, -700, 0);
  const car = makePlayerCar(obj, 'sedan');
  let stoppedBeforeLine = false;
  let crossedOnRed = false;
  let stopGap = null;
  let passedAfterGreen = false;
  for (let i = 0; i < 25 / DT; i++) {
    const t = i * DT;
    const state = lightState(stop.light, t);
    const obstacles = [];
    if (state !== 'green') obstacles.push({ x: stop.x, z: lineZ, speed: 0 });
    const input = autopilotInput(obj, { x: 392, z: -500 }, DT, { cruise: ms(60), obstacles });
    stepCar(car, input, DT, city, []);
    const front = obj.z + 2.25;
    if (state === 'red' && front >= lineZ) crossedOnRed = true;
    if (state === 'red' && Math.abs(car.speed) < 0.1 && front < lineZ && !stoppedBeforeLine) {
      stoppedBeforeLine = true;
      stopGap = lineZ - front;
    }
    // Proceeded = crossed the stop line after the light turned green.
    if (state === 'green' && obj.z > lineZ + 8) passedAfterGreen = true;
  }
  check('red-light stop', stoppedBeforeLine && !crossedOnRed && passedAfterGreen,
    `line at z=${lineZ.toFixed(0)}, stopped ${stopGap === null ? 'never' : stopGap.toFixed(1) + ' m'} before it, red-runs ${crossedOnRed ? 1 : 0}, proceeded after green: ${passedAfterGreen}`);
}

// --- 4. 300 s traffic ------------------------------------------------------
// 300 s (not 90): cars start ~400 m apart, so the follow-gap only engages
// once the faster cars catch the slower ones — that takes minutes.
{
  const traffic = initTraffic(city);
  const peds = initPedestrians(city);
  const stats = makeTrafficStats();
  for (let i = 0; i < 300 / DT; i++) {
    const t = i * DT;
    stepTraffic(traffic, city, DT, t, [], stats);
    stepPedestrians(peds, DT, stats);
  }
  check('traffic 300 s stops', stats.stops > 0, `${stats.stops} stops`);
  check('traffic 300 s red-runs', stats.redRuns === 0, `${stats.redRuns} red-runs`);
  check('traffic 300 s min follow gap', stats.minGap === Infinity || stats.minGap >= 7,
    `min gap ${stats.minGap === Infinity ? 'none' : stats.minGap.toFixed(1) + ' m'} (target 8)`);
  check('traffic 300 s collisions', stats.collisions === 0, `${stats.collisions} collisions`);
  check('traffic 300 s off-road', stats.offRoadFrames === 0, `${stats.offRoadFrames} off-road frames (max ${stats.maxOffRoad.toFixed(1)} m)`);
  check('traffic 300 s ped crossings', stats.crossings > 0, `${stats.crossings} crossings`);
}

// --- 5. collision damage ---------------------------------------------------
{
  // Building: aim at a big axis-aligned building from 60 m away.
  // Heading +x is rotOf(1, 0) = -PI/2 (forward = (-sin rot, cos rot)).
  const b = city.buildings.find((bb) => bb.rot === 0 && bb.w > 30 && bb.d > 30);
  const obj = testCar(b.x - b.w / 2 - 60, b.z, rotOf(1, 0));
  const car = makePlayerCar(obj, 'sedan');
  let dmg = 0;
  let speedBefore = 0;
  let speedAfter = null;
  let hit = false;
  for (let i = 0; i < 10 / DT; i++) {
    speedBefore = Math.abs(car.speed);
    const evs = stepCar(car, { throttle: 1, brake: 0, steer: 0, handbrake: false, reverse: false }, DT, city, []);
    if (evs.length > 0) { hit = true; dmg = evs.reduce((s, e) => s + e.damage, 0); speedAfter = Math.abs(car.speed); break; }
  }
  check('building collision damage', hit && dmg > 0 && speedBefore > 5, `damage ${dmg.toFixed(1)} at ${kmh(speedBefore).toFixed(0)} km/h`);
  check('collision cuts speed', speedAfter !== null && speedAfter < speedBefore * 0.5, `speed after ${speedAfter === null ? 'no hit' : kmh(speedAfter).toFixed(1) + ' km/h'}`);
  // Parked car: the same car object as an `others` entry.
  const p1 = testCar(1000, -1400, 0);
  const p2 = testCar(1000, -1380, 0);
  const w1 = makePlayerCar(p1, 'compact');
  let dmg2 = 0;
  for (let i = 0; i < 6 / DT; i++) {
    const evs = stepCar(w1, { throttle: 1, brake: 0, steer: 0, handbrake: false, reverse: false }, DT, city, [p2]);
    if (evs.length > 0) { dmg2 = evs.reduce((s, e) => s + e.damage, 0); break; }
  }
  check('car-car collision damage', dmg2 > 0, `damage ${dmg2.toFixed(1)}`);
}

// --- 6. E enter/exit --------------------------------------------------------
{
  const drivableCars = city.cars.filter((c) => c.kind === 'drivable');
  const car0 = drivableCars[0];
  const toPlaza = [PLAZA.x - car0.x, PLAZA.z - car0.z];
  const tpl = Math.hypot(toPlaza[0], toPlaza[1]) || 1;
  const mara = makeWalker(car0.x + (toPlaza[0] / tpl) * 4, car0.z + (toPlaza[1] / tpl) * 4);
  const near = nearestDrivable(city, mara.x, mara.z, 6);
  check('prompt near a drivable car', near !== null && near.dist <= 6,
    near ? `nearest ${near.dist.toFixed(1)} m` : 'none');
  const wrapper = near ? makePlayerCar(near.car, 'sedan') : null;
  check('enter car wraps the same object', wrapper !== null && wrapper.obj === near.car && wrapper.speed === 0,
    wrapper ? wrapper.profile : 'null');
  const spot = near ? exitSpot(city, near.car) : null;
  check('exit spot is free', spot !== null && !buildingHit(city, spot.x, spot.z, 2) &&
    Math.hypot(spot.x - near.car.x, spot.z - near.car.z) < 5,
    spot ? `spot (${spot.x.toFixed(1)}, ${spot.z.toFixed(1)})` : 'null');
  const far = nearestDrivable(city, 0, 0, 6);
  check('no prompt far from any drivable car', far === null, 'no car within 6 m of (0,0)');
  const pc = city.cars.find((c) => c.kind === 'parked');
  const parked = nearestParked(city, pc.x + 3, pc.z, 6);
  const parkedAsDrivable = nearestDrivable(city, pc.x + 3, pc.z, 6);
  check('parked car is locked (not drivable)', parked !== null && parkedAsDrivable === null,
    parked ? `parked ${parked.dist.toFixed(1)} m away` : 'none');
}

// --- 7. on-foot walking blocked by a building -------------------------------
{
  const b = city.buildings.find((bb) => bb.rot === 0 && bb.w > 20 && bb.d > 20);
  const wall = b.x - b.w / 2;
  const mara = makeWalker(wall - 6, b.z);
  let entered = false;
  for (let i = 0; i < 5 / DT; i++) {
    stepWalker(mara, { mx: 1, mz: 0 }, false, DT, city, []);
    if (mara.x > wall - 0.4) entered = true;
  }
  check('walker blocked by building', !entered && mara.x < wall - 0.4,
    `stopped at x=${mara.x.toFixed(1)} (wall at ${wall.toFixed(1)})`);
}

// --- 8. headlight cone -------------------------------------------------------
{
  const player = testCar(400, -400, 0);
  const ahead = testCar(400, -385, 0);
  const behind = testCar(400, -415, 0);
  const side = testCar(410, -400, 0);
  const lit = carsInHeadlightCone(player, [player, ahead, behind, side]);
  check('headlight cone lights the car ahead', lit.includes(ahead) && !lit.includes(behind) && !lit.includes(side),
    `lit: ahead=${lit.includes(ahead)} behind=${lit.includes(behind)} side=${lit.includes(side)}`);
}

// --- 8b. autopilot overtake -----------------------------------------------
// Oncoming stopped car: the autopilot steers around it (creep) instead of
// waiting forever. Same-direction stopped car: it waits behind it.
{
  // Oncoming: player heading +z, obstacle heading -z, stopped 15 m ahead.
  const obj = testCar(400, -400, 0);
  const car = makePlayerCar(obj, 'sedan');
  const oncoming = { x: 400, z: -385, speed: 0, kind: 'car', rot: Math.PI };
  let reached = false;
  for (let i = 0; i < 30 / DT; i++) {
    const input = autopilotInput(obj, { x: 400, z: -300 }, DT, { cruise: ms(55), obstacles: [oncoming] });
    stepCar(car, input, DT, city, []);
    if (obj.z > -310) { reached = true; break; }
  }
  check('autopilot overtakes a stopped oncoming car', reached, `reached z=${obj.z.toFixed(0)} (obstacle at -385, target -300)`);
  // Same direction: player heading +z, obstacle heading +z, stopped ahead.
  const obj2 = testCar(400, -400, 0);
  const car2 = makePlayerCar(obj2, 'sedan');
  const ahead = { x: 400, z: -385, speed: 0, kind: 'car', rot: 0 };
  for (let i = 0; i < 15 / DT; i++) {
    const input = autopilotInput(obj2, { x: 400, z: -300 }, DT, { cruise: ms(55), obstacles: [ahead] });
    stepCar(car2, input, DT, city, []);
  }
  check('autopilot waits behind a stopped car in its lane', obj2.z < -390 && Math.abs(car2.speed) < 0.1,
    `stopped at z=${obj2.z.toFixed(1)} (obstacle at -385), speed ${Math.abs(car2.speed).toFixed(2)}`);
}

// --- 9. missions 1-4 played to completion ------------------------------------
// Obstacles for the autopilot, mirroring main.js obstaclesAhead:
// traffic cars ahead + red/amber lights ahead (stop line 8 m early).
function obstaclesAhead(traffic, px, pz, fx, fz, t) {
  const obs = [];
  for (const tc of traffic.cars) {
    const rx = tc.car.x - px;
    const rz = tc.car.z - pz;
    const along = rx * fx + rz * fz;
    const lat = Math.abs(rx * -fz + rz * fx);
    if (along > 0 && along < 24 && lat < 3.5) obs.push({ x: tc.car.x, z: tc.car.z, speed: tc.speed, kind: 'car', rot: tc.car.rot });
  }
  for (const l of city.trafficLights) {
    const ix = l.x - 34;
    const iz = l.z - 34;
    const rx = ix - px;
    const rz = iz - pz;
    const along = rx * fx + rz * fz;
    const lat = Math.abs(rx * -fz + rz * fx);
    if (along > 0 && along < 26 && lat < 6) {
      if (lightState(l, t) !== 'green') {
        const axis = Math.abs(fz) > Math.abs(fx) ? 'z' : 'x';
        const off = stopOffsetFor(ix, iz, axis);
        obs.push({ x: px + fx * (along - off), z: pz + fz * (along - off), speed: 0, kind: 'light' });
      }
    }
  }
  return obs;
}
{
  const missions = createMissions();
  const traffic = initTraffic(city);
  const peds = initPedestrians(city);
  const stats = makeTrafficStats();
  const drivableCars = city.cars.filter((c) => c.kind === 'drivable');
  const car0 = drivableCars[0];
  const toPlaza = [PLAZA.x - car0.x, PLAZA.z - car0.z];
  const tpl = Math.hypot(toPlaza[0], toPlaza[1]) || 1;
  const mara = makeWalker(car0.x + (toPlaza[0] / tpl) * 4, car0.z + (toPlaza[1] / tpl) * 4);
  const PROFILES_BY_IDX = ['compact', 'sedan', 'van', 'coupe', 'sedan', 'compact', 'coupe', 'van'];
  let playerCar = null;
  let mode = 'walk';
  let waypoints = null;
  let idx = 0;
  let moved = false;
  let t = 0;
  const MAX_T = 1800;
  let done = false;
  while (t < MAX_T && !done) {
    const target = currentTarget(missions);
    if (!target) { done = true; break; }
    const pos = playerCar ? { x: playerCar.obj.x, z: playerCar.obj.z } : { x: mara.x, z: mara.z };
    const dist = Math.hypot(target.x - pos.x, target.z - pos.z);
    if (mode === 'walk') {
      // Walk the last stretch to the marker. The threshold (30 m) must be
      // larger than the drive-exit distance (12 m) plus the exit offset
      // (3.2 m) — otherwise Mara exits, is still beyond the walk threshold,
      // re-enters the car at once, exits again, and loops forever.
      if (dist <= 30) {
        stepWalker(mara, { mx: target.x - mara.x, mz: target.z - mara.z }, false, DT, city, city.cars);
        moved = true;
      } else {
        const near = nearestDrivable(city, mara.x, mara.z, 6);
        if (near) {
          playerCar = makePlayerCar(near.car, PROFILES_BY_IDX[drivableCars.indexOf(near.car)] ?? 'sedan');
          mode = 'drive';
          waypoints = null;
          idx = 0;
        } else {
          let best = null;
          let bestD = Infinity;
          for (const c of drivableCars) {
            const d = Math.hypot(c.x - mara.x, c.z - mara.z);
            if (d < bestD) { bestD = d; best = c; }
          }
          if (best) stepWalker(mara, { mx: best.x - mara.x, mz: best.z - mara.z }, true, DT, city, city.cars);
          moved = true;
        }
      }
    } else {
      if (dist <= 12) {
        const spot = exitSpot(city, playerCar.obj);
        mara.x = spot.x;
        mara.z = spot.z;
        mara.rot = playerCar.obj.rot;
        playerCar = null;
        mode = 'walk';
        waypoints = null;
        idx = 0;
      } else {
        if (!waypoints) {
          waypoints = findPath(city, { x: playerCar.obj.x, z: playerCar.obj.z }, target);
          idx = 0;
          if (!waypoints) {
            console.log(`FAIL  findPath returned null for target (${target.x}, ${target.z}) from (${playerCar.obj.x.toFixed(0)}, ${playerCar.obj.z.toFixed(0)})`);
            failures++;
            break;
          }
        }
        const [fx, fz] = forwardOf(playerCar.obj.rot);
        const obs = obstaclesAhead(traffic, playerCar.obj.x, playerCar.obj.z, fx, fz, t);
        const res = autopilotFollow(playerCar.obj, waypoints, idx, DT, { cruise: ms(55), obstacles: obs });
        idx = res.nextIdx;
        stepCar(playerCar, res.input, DT, city, city.cars.filter((c) => c !== playerCar.obj));
        moved = true;
      }
    }
    const pos2 = playerCar ? { x: playerCar.obj.x, z: playerCar.obj.z } : { x: mara.x, z: mara.z };
    stepMissions(missions, pos2, moved, DT);
    const playerObs = playerCar ? [{ x: playerCar.obj.x, z: playerCar.obj.z, speed: playerCar.speed }] : [];
    stepTraffic(traffic, city, DT, t, playerObs, stats);
    stepPedestrians(peds, DT, stats);
    t += DT;
  }
  check('missions all completed', missions.idx >= MISSIONS.length, `idx ${missions.idx}/${MISSIONS.length}, t=${t.toFixed(0)} s`);
  check('mission cash total $2,000', missions.cash === 2000, `$${missions.cash}`);
  const expected = [250, 500, 450, 800];
  const perOk = expected.every((v, i) => missions.earned[i] === v);
  check('mission cash per mission', perOk, `$${missions.earned.join(' + $')} = $${missions.cash}`);
  check('mission 4 finale broadcast', missions.broadcast === 'THE DEBT IS SETTLED — Solmar hears Mara\'s name', missions.broadcast || 'none');
  check('mission timer runs after first move', missions.timer > 0 && moved, `timer ${missions.timer.toFixed(1)} s`);
  check('mission traffic red-runs during playthrough', stats.redRuns === 0, `${stats.redRuns} red-runs`);
  // Timer-before-move: a fresh mission set keeps timer 0 while idle.
  const m2 = createMissions();
  for (let i = 0; i < 5 / DT; i++) stepMissions(m2, { x: PLAZA.x + 4, z: PLAZA.z }, false, DT);
  check('mission timer 0 while idle', m2.timer === 0, `timer ${m2.timer}`);
}

// --- 10. traffic-light cycle --------------------------------------------------
{
  const traffic = initTraffic(city);
  const route = traffic.routes.find((r) => r.name === 'boulevard');
  const light = route.stops[0].light;
  const states = [];
  for (let t = 0; t < 26; t += 0.5) states.push(lightState(light, t));
  const green = states.filter((s) => s === 'green').length;
  const amber = states.filter((s) => s === 'amber').length;
  const red = states.filter((s) => s === 'red').length;
  check('light cycle 26 s (green 16 / amber 2 / red 8)', green === 32 && amber === 4 && red === 16,
    `green ${green * 0.5}s amber ${amber * 0.5}s red ${red * 0.5}s`);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failures === 0 ? 0 : 1);
