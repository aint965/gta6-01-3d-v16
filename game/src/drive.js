// drive.js — Stage B: driving physics, traffic, pedestrians, collision,
// on-foot walking, E enter/exit, autopilot + road-grid routing.
// Pure logic (no DOM): the Node sim imports the same code the game runs.
// Units: metres, seconds. Car heading `rot` uses the renderer convention:
// forward = (-sin(rot), cos(rot)) in (x, z).
import { ROADS, DIAGONAL, CANAL, HARBOUR, BEACH, PARK, PLAZA, distToRoad, roadContains } from './city.js';

export const PROFILES = {
  compact: { top: 115, accel: 7.5, label: 'COMPACT' },
  sedan: { top: 130, accel: 8.0, label: 'SEDAN' },
  van: { top: 108, accel: 6.0, label: 'VAN' },
  coupe: { top: 158, accel: 9.5, label: 'COUPE' },
};
export const PROFILE_ORDER = ['compact', 'sedan', 'van', 'coupe'];

export const kmh = (ms) => ms * 3.6;
export const ms = (k) => k / 3.6;

// Forward vector for a heading rot.
export function forwardOf(rot) {
  return [-Math.sin(rot), Math.cos(rot)];
}
// Heading rot for a forward vector (fx, fz).
export function rotOf(fx, fz) {
  return Math.atan2(-fx, fz);
}

// ---------------------------------------------------------------- OBB math
// A rect: {x, z, hw, hd, rot} — half-width along local x, half-depth along
// local z. Local x axis maps to (cos rot, sin rot), local z to (-sin, cos).
function rectAxes(r) {
  const c = Math.cos(r.rot);
  const s = Math.sin(r.rot);
  return [[c, s], [-s, c]];
}
function rectCorners(r) {
  const [ax, az] = rectAxes(r);
  const pts = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    pts.push([r.x + ax[0] * sx * r.hw + az[0] * sz * r.hd, r.z + ax[1] * sx * r.hw + az[1] * sz * r.hd]);
  }
  return pts;
}
// SAT overlap test. Returns {overlap, nx, nz} (push-out normal + depth) or null.
export function obbOverlap(a, b) {
  const axes = [...rectAxes(a), ...rectAxes(b)];
  const ca = rectCorners(a);
  const cb = rectCorners(b);
  let minOverlap = Infinity;
  let minAxis = null;
  for (const [ax, az] of axes) {
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const [x, z] of ca) { const d = x * ax + z * az; if (d < minA) minA = d; if (d > maxA) maxA = d; }
    for (const [x, z] of cb) { const d = x * ax + z * az; if (d < minB) minB = d; if (d > maxB) maxB = d; }
    const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
    if (overlap <= 0) return null;
    if (overlap < minOverlap) { minOverlap = overlap; minAxis = [ax, az]; }
  }
  // Normal must point from b toward a (push a out of b).
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  if (minAxis && dx * minAxis[0] + dz * minAxis[1] < 0) minAxis = [-minAxis[0], -minAxis[1]];
  return { overlap: minOverlap, nx: minAxis[0], nz: minAxis[1] };
}
// Circle vs OBB: returns push-out {nx, nz, depth} or null.
export function circleObb(x, z, r, obb) {
  const c = Math.cos(-obb.rot);
  const s = Math.sin(-obb.rot);
  const dx = x - obb.x;
  const dz = z - obb.z;
  // Into the obb's local frame.
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const qx = Math.max(-obb.hw, Math.min(obb.hw, lx));
  const qz = Math.max(-obb.hd, Math.min(obb.hd, lz));
  const ddx = lx - qx;
  const ddz = lz - qz;
  const d2 = ddx * ddx + ddz * ddz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    // Back to world frame (rotate by +rot).
    const c2 = Math.cos(obb.rot);
    const s2 = Math.sin(obb.rot);
    const wx = (ddx / d) * c2 - (ddz / d) * s2;
    const wz = (ddx / d) * s2 + (ddz / d) * c2;
    return { nx: wx, nz: wz, depth: r - d };
  }
  // Centre inside the box: push out along the smallest penetration axis.
  const px = obb.hw - Math.abs(lx);
  const pz = obb.hd - Math.abs(lz);
  if (px < pz) {
    const sign = lx >= 0 ? 1 : -1;
    const c2 = Math.cos(obb.rot);
    const s2 = Math.sin(obb.rot);
    return { nx: sign * c2, nz: sign * s2, depth: px + r };
  }
  const sign = lz >= 0 ? 1 : -1;
  const c2 = Math.cos(obb.rot);
  const s2 = Math.sin(obb.rot);
  return { nx: -sign * s2, nz: sign * c2, depth: pz + r };
}

export function buildingObb(b) {
  return { x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, rot: b.rot };
}
export function carObb(c) {
  return { x: c.x, z: c.z, hw: 1.05, hd: 2.25, rot: c.rot };
}
export function buildingHit(city, x, z, r = 4) {
  for (const b of city.buildings) {
    if (Math.abs(b.x - x) > 70 || Math.abs(b.z - z) > 70) continue;
    if (Math.hypot(b.x - x, b.z - z) < b.r + r) return true;
  }
  return false;
}

// Cars inside a driven car's headlight cone (4-26 m ahead, < 4.5 m lateral).
// The renderer uses this for the warm emissive boost on the car ahead.
export function carsInHeadlightCone(playerCar, cars) {
  const [fx, fz] = forwardOf(playerCar.rot);
  const lit = [];
  for (const c of cars) {
    if (c === playerCar) continue;
    const rx = c.x - playerCar.x;
    const rz = c.z - playerCar.z;
    const along = rx * fx + rz * fz;
    const lat = Math.abs(rx * -fz + rz * fx);
    if (along > 4 && along < 26 && lat < 4.5) lit.push(c);
  }
  return lit;
}

// How far before an intersection centre a car must stop: the cross road's
// half-width + 2 m, so a waiting car sits clear of the cross lane. (A fixed
// 8 m put the stop line INSIDE the cross road — a car waiting there sat
// directly in cross traffic's path.)
export function stopOffsetFor(ix, iz, axis) {
  let hw = 0;
  for (const r of ROADS) {
    if (r.axis === axis) continue; // same direction, not a crossing
    if (r.axis === 'x') {
      if (Math.abs(iz - r.cz) <= r.w / 2 && Math.abs(ix - r.cx) <= r.len / 2) hw = Math.max(hw, r.w / 2);
    } else {
      if (Math.abs(ix - r.cx) <= r.w / 2 && Math.abs(iz - r.cz) <= r.len / 2) hw = Math.max(hw, r.w / 2);
    }
  }
  return hw + 2;
}

// Every route position where the route passes a point (one per leg — the
// route is a loop with an out leg and a return leg). Returns the s of the
// closest approach on each leg.
function passPositions(route, lx, lz, radius = 12) {
  const passes = [];
  let cur = null;
  for (let i = 0; i < route.pts.length; i++) {
    const d = Math.hypot(route.pts[i].x - lx, route.pts[i].z - lz);
    if (d < radius) {
      if (!cur || d < cur.d) cur = { s: route.cum[i], d };
    } else if (cur) {
      passes.push(cur.s);
      cur = null;
    }
  }
  if (cur) passes.push(cur.s);
  return passes;
}
// 26 s cycle: green 0-16, amber 16-18, red 18-26. Offset staggers lights.
export function lightState(light, t) {
  const ix = light.x - 34;
  const iz = light.z - 34;
  const off = (((ix * 3 + iz * 7) % 26) + 26) % 26;
  const p = (((t + off) % 26) + 26) % 26;
  if (p < 16) return 'green';
  if (p < 18) return 'amber';
  return 'red';
}

// ---------------------------------------------------------------- traffic routes
// A route is a dense polyline (points every ~4 m) with cumulative lengths.
function buildRoute(segments) {
  const pts = [];
  const push = (x, z) => {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(x - last.x, z - last.z) > 0.5) pts.push({ x, z });
  };
  for (const seg of segments) {
    if (seg.type === 'line') {
      const len = Math.hypot(seg.to[0] - seg.from[0], seg.to[1] - seg.from[1]);
      const n = Math.max(1, Math.round(len / 4));
      for (let i = 0; i <= n; i++) {
        push(seg.from[0] + ((seg.to[0] - seg.from[0]) * i) / n, seg.from[1] + ((seg.to[1] - seg.from[1]) * i) / n);
      }
    } else {
      // Arc: centre (cx, cz), radius r, angle a0 -> a1 (radians).
      const sweep = Math.abs(seg.a1 - seg.a0);
      const n = Math.max(2, Math.round((sweep * seg.r) / 4));
      for (let i = 0; i <= n; i++) {
        const a = seg.a0 + ((seg.a1 - seg.a0) * i) / n;
        push(seg.cx + Math.cos(a) * seg.r, seg.cz + Math.sin(a) * seg.r);
      }
    }
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  // Close the loop: the last point must connect back to the first.
  const closeLen = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z);
  const length = cum[cum.length - 1] + closeLen;
  return { pts, cum, length };
}

function routePointAt(route, s) {
  const { pts, cum, length } = route;
  s = ((s % length) + length) % length;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  const segLen = cum[lo + 1] - cum[lo] || 1;
  const t = (s - cum[lo]) / segLen;
  const a = pts[lo];
  const b = pts[lo + 1] ?? pts[0];
  const x = a.x + (b.x - a.x) * t;
  const z = a.z + (b.z - a.z) * t;
  const fx = b.x - a.x;
  const fz = b.z - a.z;
  const fl = Math.hypot(fx, fz) || 1;
  return { x, z, fx: fx / fl, fz: fz / fl };
}

function nearestS(route, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < route.pts.length; i++) {
    const d = Math.hypot(route.pts[i].x - x, route.pts[i].z - z);
    if (d < bestD) { bestD = d; best = route.cum[i]; }
  }
  return best;
}

// Routes: boulevard (16 cars), avenue (12), secondary west (6), secondary east (6).
export function buildRoutes(city) {
  const routes = [];
  const defs = [
    {
      name: 'boulevard',
      axis: 'z',
      segments: [
        { type: 'line', from: [392, -1600], to: [392, 1600] },
        { type: 'arc', cx: 400, cz: 1600, r: 8, a0: Math.PI, a1: 0 },
        { type: 'line', from: [408, 1600], to: [408, -1600] },
        { type: 'arc', cx: 400, cz: -1600, r: 8, a0: 0, a1: -Math.PI },
      ],
      lights: [[400, -1200], [400, -600], [400, 0], [400, 600], [400, 1200]],
    },
    {
      name: 'avenue',
      axis: 'x',
      segments: [
        { type: 'line', from: [1700, -8], to: [-1700, -8] },
        { type: 'arc', cx: -1700, cz: 0, r: 8, a0: -Math.PI / 2, a1: (-3 * Math.PI) / 2 },
        { type: 'line', from: [-1700, 8], to: [1700, 8] },
        { type: 'arc', cx: 1700, cz: 0, r: 8, a0: Math.PI / 2, a1: -Math.PI / 2 },
      ],
      lights: [[-1400, 0], [-800, 0], [400, 0], [1000, 0], [1600, 0]],
    },
    {
      name: 'secondary-west',
      axis: 'z',
      segments: [
        { type: 'line', from: [-807, -1400], to: [-807, 1400] },
        { type: 'arc', cx: -800, cz: 1400, r: 7, a0: Math.PI, a1: 0 },
        { type: 'line', from: [-793, 1400], to: [-793, -1400] },
        { type: 'arc', cx: -800, cz: -1400, r: 7, a0: 0, a1: -Math.PI },
      ],
      lights: [[-800, -600], [-800, 0], [-800, 600]],
    },
    {
      name: 'secondary-east',
      axis: 'z',
      segments: [
        { type: 'line', from: [993, -1400], to: [993, 1400] },
        { type: 'arc', cx: 1000, cz: 1400, r: 7, a0: Math.PI, a1: 0 },
        { type: 'line', from: [1007, 1400], to: [1007, -1400] },
        { type: 'arc', cx: 1000, cz: -1400, r: 7, a0: 0, a1: -Math.PI },
      ],
      lights: [[1000, -600], [1000, 0], [1000, 600]],
    },
  ];
  for (const def of defs) {
    const route = buildRoute(def.segments);
    // Stop points: one per leg (the route passes each intersection twice —
    // out leg and return leg), `offset` before the centre along the route,
    // so a waiting car sits clear of the cross lane. Each stop carries its
    // own (x, z) so the player autopilot can brake on the same line.
    const stops = [];
    for (const [lx, lz] of def.lights) {
      const light = city.trafficLights.find((tl) => tl.x - 34 === lx && tl.z - 34 === lz);
      if (!light) continue;
      const offset = stopOffsetFor(lx, lz, def.axis);
      for (const sCentre of passPositions(route, lx, lz)) {
        const s = sCentre - offset;
        const p = routePointAt(route, s);
        stops.push({ s, light, ix: lx, iz: lz, x: p.x, z: p.z });
      }
    }
    routes.push({ name: def.name, ...route, stops });
  }
  return routes;
}

export function initTraffic(city) {
  const routes = buildRoutes(city);
  const byName = {};
  for (const r of routes) byName[r.name] = r;
  const cars = [];
  let bi = 0, ai = 0, wi = 0, ei = 0;
  for (const c of city.cars) {
    if (c.kind !== 'traffic' && c.kind !== 'taxi') continue;
    let route;
    let idx;
    if (Math.abs(c.x - 400) <= 20 && Math.abs(c.z) <= 1700) { route = byName.boulevard; idx = bi++; }
    else if (Math.abs(c.z) <= 20 && Math.abs(c.x) <= 1800) { route = byName.avenue; idx = ai++; }
    else if (c.x < 0) { route = byName['secondary-west']; idx = wi++; }
    else { route = byName['secondary-east']; idx = ei++; }
    cars.push({
      car: c, route, s: nearestS(route, c.x, c.z),
      speed: 0, cruise: 8 + (idx % 5), // 8-12 m/s (29-43 km/h)
      lastStopKey: null, stoppedAtRed: false,
    });
  }
  return { routes, cars, overlapPairs: new Set() };
}

// One traffic step. `obstacles` = [{x, z, fx, fz, speed}] (player car, peds
// as slow movers). Returns nothing; stats accumulate in `stats`.
export function stepTraffic(traffic, city, dt, t, obstacles, stats) {
  for (const tc of traffic.cars) {
    const route = tc.route;
    const L = route.length;
    // Next stop point ahead (within 40 m).
    let stopAhead = null;
    let stopDist = Infinity;
    for (const st of route.stops) {
      let d = st.s - tc.s;
      if (d < 0) d += L;
      if (d < stopDist) { stopDist = d; stopAhead = st; }
    }
    let desired = tc.cruise;
    // Red / amber light: brake to stop 1.5 m before the stop line. The
    // stopping profile assumes 5 m/s^2 (the car brakes at 7), so it stops
    // a little early rather than overshooting the line.
    if (stopAhead && stopDist < 40) {
      const state = lightState(stopAhead.light, t);
      if (state !== 'green') {
        const brakeDist = (tc.speed * tc.speed) / (2 * 5);
        if (stopDist - 1.5 <= Math.max(brakeDist, 1)) {
          desired = Math.min(desired, Math.sqrt(2 * 5 * Math.max(0, stopDist - 1.5)));
          if (stopDist <= 3 && tc.speed < 0.5) tc.stoppedAtRed = true;
        }
      }
    }
    // Intersection priority (separate, wide window): the north-south
    // routes (boulevard and secondary) have priority over the east-west
    // avenue at every crossing — the routes share one light state, so
    // green alone does not clear the crossing. An avenue car that is
    // within 50 m of the centre and still approaching it waits while any
    // north-south car is within 50 m and moving. The wide window matters:
    // the yield must engage BEFORE the avenue car passes its stop line,
    // or it is committed and cannot stop. The north-south car never
    // yields, so there is no deadlock; a car waiting at its own stop line
    // is already clear of the cross lane (see stopOffsetFor).
    if (route.name === 'avenue' && stopAhead) {
      const toCx = stopAhead.ix - tc.car.x;
      const toCz = stopAhead.iz - tc.car.z;
      const distC = Math.hypot(toCx, toCz);
      const [fx, fz] = forwardOf(tc.car.rot);
      if (distC < 50 && fx * toCx + fz * toCz > 0) {
        for (const other of traffic.cars) {
          if (other === tc) continue;
          if (other.route.name === 'avenue') continue;
          if (other.speed <= 1) continue;
          if (Math.hypot(other.car.x - stopAhead.ix, other.car.z - stopAhead.iz) < 50) {
            desired = 0;
            break;
          }
        }
      }
    }
    // Follow gap: same route, car ahead within 25 m. A stopping profile
    // keeps the gap >= 8 m: the follower may close no faster than the
    // speed that still lets it stop 8 m behind the leader (profile decel
    // 3 m/s^2, below the car's 7, so it starts braking early enough for a
    // leader stopped at a red light as well as for a slower cruiser).
    for (const other of traffic.cars) {
      if (other === tc) continue;
      if (other.route !== route) continue;
      let d = other.s - tc.s;
      if (d < 0) d += L;
      if (d > 0 && d < 25) {
        if (d < stats.minGap) stats.minGap = d;
        const closing = Math.sqrt(2 * 3 * Math.max(0, d - 8));
        desired = Math.min(desired, other.speed + closing);
        if (d < 7) desired = 0; // already too close: stop, let the gap grow
      }
    }
    // Obstacles ahead (player car, crossing pedestrians): brake.
    const pos = routePointAt(route, tc.s);
    const fx = pos.fx;
    const fz = pos.fz;
    for (const o of obstacles) {
      const rx = o.x - pos.x;
      const rz = o.z - pos.z;
      const along = rx * fx + rz * fz;
      const lat = Math.abs(rx * -fz + rz * fx);
      if (along > 0 && along < 14 && lat < 3.5) {
        desired = Math.min(desired, along < 6 ? 0 : (o.speed ?? 0));
      }
    }
    // Accelerate / brake toward the desired speed.
    if (tc.speed < desired) tc.speed = Math.min(desired, tc.speed + 3 * dt);
    else tc.speed = Math.max(desired, tc.speed - 7 * dt);
    if (tc.speed < 0.02) tc.speed = 0;
    tc.car.speed = tc.speed;
    const prevS = tc.s;
    tc.s = (tc.s + tc.speed * dt) % L;
    // Red-run: crossing a stop line while its light is red.
    for (const st of route.stops) {
      const crossed = (prevS < st.s && tc.s >= st.s) || (prevS > tc.s && (st.s >= prevS || st.s < tc.s));
      if (crossed && tc.speed > 0.5) {
        if (lightState(st.light, t) === 'red') stats.redRuns++;
      }
    }
    // Count a stop at red (once per approach).
    if (tc.stoppedAtRed) {
      const key = `${stopAhead ? `${stopAhead.ix},${stopAhead.iz}` : ''}@${Math.floor(t / 26)}`;
      if (tc.lastStopKey !== key) { stats.stops++; tc.lastStopKey = key; }
      tc.stoppedAtRed = false;
    }
    const p = routePointAt(route, tc.s);
    tc.car.x = p.x;
    tc.car.z = p.z;
    tc.car.rot = rotOf(p.fx, p.fz);
    // Off-road check (should stay on the road through the whole loop).
    const gap = distToRoad(p.x, p.z);
    if (gap > 2) { stats.offRoadFrames++; if (gap > stats.maxOffRoad) stats.maxOffRoad = gap; }
  }
  // Pairwise traffic collisions (should be 0 with the follow-gap rule).
  // Counted as DISTINCT events: a pair overlapping for several frames
  // counts once, so the number means "how many crashes", not frames.
  for (let i = 0; i < traffic.cars.length; i++) {
    for (let j = i + 1; j < traffic.cars.length; j++) {
      const a = traffic.cars[i].car;
      const b = traffic.cars[j].car;
      const key = `${i}:${j}`;
      const overlapping = Math.abs(a.x - b.x) < 5 && Math.abs(a.z - b.z) < 5 && Math.hypot(a.x - b.x, a.z - b.z) < 4.4;
      if (overlapping) {
        if (!traffic.overlapPairs.has(key)) { traffic.overlapPairs.add(key); stats.collisions++; }
      } else {
        traffic.overlapPairs.delete(key);
      }
    }
  }
}

export function makeTrafficStats() {
  return { stops: 0, redRuns: 0, minGap: Infinity, collisions: 0, offRoadFrames: 0, maxOffRoad: 0, crossings: 0 };
}

// ---------------------------------------------------------------- pedestrians
export function initPedestrians(city) {
  const peds = [];
  city.pedestrians.forEach((p, i) => {
    if (i < 20) {
      // Boulevard sidewalk walkers.
      peds.push({ p, mode: 'sidewalk', x: p.x, z: p.z, dir: i % 2 === 0 ? 1 : -1, speed: 1.2 });
    } else if (i < 30) {
      // Plaza ring walkers.
      const a = Math.atan2(p.z - PLAZA.z, p.x - PLAZA.x);
      peds.push({ p, mode: 'ring', angle: a, dir: i % 2 === 0 ? 1 : -1 });
    } else {
      // Crossers: across the boulevard at z = -600 / 0 / 600.
      const cz = [-600, 0, 600][i % 3];
      const side = i % 2 === 0 ? -1 : 1;
      peds.push({ p, mode: 'cross', cz, x: side < 0 ? 362 : 438, side, wait: 1 + (i % 4), speed: 1.4 });
    }
  });
  return peds;
}

export function stepPedestrians(peds, dt, stats) {
  for (const w of peds) {
    if (w.mode === 'sidewalk') {
      w.z += w.dir * w.speed * dt;
      if (w.z > 1500) { w.z = 1500; w.dir = -1; }
      if (w.z < -1500) { w.z = -1500; w.dir = 1; }
      w.p.x = w.x;
      w.p.z = w.z;
      w.p.rot = rotOf(0, w.dir);
    } else if (w.mode === 'ring') {
      w.angle += w.dir * 0.02 * dt;
      w.p.x = PLAZA.x + Math.cos(w.angle) * (PLAZA.r + 14);
      w.p.z = PLAZA.z + Math.sin(w.angle) * (PLAZA.r + 14);
      w.p.rot = rotOf(-Math.sin(w.angle) * w.dir, Math.cos(w.angle) * w.dir);
    } else {
      // Cross: wait at the kerb, walk across, wait, walk back.
      if (w.wait > 0) {
        w.wait -= dt;
      } else {
        w.x += -w.side * w.speed * dt;
        if (w.side < 0 && w.x >= 438) { w.x = 438; w.side = 1; w.wait = 2 + (Math.abs(w.cz) % 3); if (stats) stats.crossings++; }
        if (w.side > 0 && w.x <= 362) { w.x = 362; w.side = -1; w.wait = 2 + (Math.abs(w.cz) % 3); if (stats) stats.crossings++; }
      }
      w.p.x = w.x;
      w.p.z = w.cz;
      w.p.rot = rotOf(-w.side, 0);
    }
  }
}

// ---------------------------------------------------------------- player car
export function makePlayerCar(carObj, profile) {
  // Keep the speed on the shared car object too: autopilotInput reads
  // car.speed from the raw object, and stepCar only updates the wrapper.
  carObj.speed = 0;
  return { obj: carObj, profile, speed: 0, damage: 0 };
}

// Step the player's car. `input`: {throttle, brake, steer, handbrake, reverse}.
// `others`: other cars (city.cars minus the player's) for collision.
// Returns events: [{type:'collision', damage, x, z}].
export function stepCar(player, input, dt, city, others) {
  const events = [];
  const prof = PROFILES[player.profile];
  const topMs = ms(prof.top);
  if (input.throttle > 0) player.speed += prof.accel * input.throttle * dt;
  if (input.brake > 0) player.speed -= 12 * input.brake * dt;
  if (input.reverse) player.speed -= prof.accel * 0.6 * dt;
  if (input.handbrake) player.speed -= Math.sign(player.speed) * 14 * dt;
  player.speed -= player.speed * 0.12 * dt;
  player.speed = Math.max(-ms(30), Math.min(topMs, player.speed));
  // Braking never reverses the car (reverse is a separate input): without
  // this, the autopilot's brake — held while waiting at a red light —
  // pushes the car backwards up to -30 km/h.
  if (!input.reverse && player.speed < 0) player.speed = 0;
  if (Math.abs(player.speed) < 0.05 && !input.throttle && !input.reverse) player.speed = 0;
  player.obj.speed = player.speed;
  const steerAngle = input.steer * 0.55 * (input.handbrake ? 1.5 : 1);
  player.obj.rot += steerAngle * (player.speed / 2.8) * dt;
  const [fx, fz] = forwardOf(player.obj.rot);
  const nx = player.obj.x + fx * player.speed * dt;
  const nz = player.obj.z + fz * player.speed * dt;
  // Collision: buildings + other cars (OBB vs OBB).
  const me = { x: nx, z: nz, hw: 1.05, hd: 2.25, rot: player.obj.rot };
  let hit = null;
  for (const b of city.buildings) {
    if (Math.abs(b.x - nx) > 70 || Math.abs(b.z - nz) > 70) continue;
    const ov = obbOverlap(me, buildingObb(b));
    if (ov) { hit = ov; break; }
  }
  if (!hit) {
    for (const o of others) {
      if (Math.abs(o.x - nx) > 10 || Math.abs(o.z - nz) > 10) continue;
      const ov = obbOverlap(me, carObb(o));
      if (ov) { hit = ov; break; }
    }
  }
  if (hit) {
    const impactKmh = Math.abs(kmh(player.speed));
    const damage = Math.max(0, impactKmh - 15) * 0.8;
    if (damage > 0.5) {
      player.damage = Math.min(100, player.damage + damage);
      events.push({ type: 'collision', damage, x: nx, z: nz });
    }
    player.obj.x = nx + hit.nx * (hit.overlap + 0.05);
    player.obj.z = nz + hit.nz * (hit.overlap + 0.05);
    player.speed *= 0.1;
    player.obj.speed = player.speed;
  } else {
    player.obj.x = nx;
    player.obj.z = nz;
  }
  return events;
}

// ---------------------------------------------------------------- on-foot (Mara)
export function makeWalker(x, z) {
  return { x, z, rot: 0, speed: 0 };
}

// `move`: {mx, mz} world-space unit vector (or null), `run`: boolean.
export function stepWalker(w, move, run, dt, city, cars) {
  const target = run ? 7 : 4;
  if (move && (move.mx !== 0 || move.mz !== 0)) {
    const len = Math.hypot(move.mx, move.mz) || 1;
    const vx = (move.mx / len) * target;
    const vz = (move.mz / len) * target;
    w.rot = rotOf(vx, vz);
    let nx = w.x + vx * dt;
    let nz = w.z + vz * dt;
    // Circle vs buildings + cars.
    for (const b of city.buildings) {
      if (Math.abs(b.x - nx) > 70 || Math.abs(b.z - nz) > 70) continue;
      const push = circleObb(nx, nz, 0.6, buildingObb(b));
      if (push) { nx += push.nx * push.depth; nz += push.nz * push.depth; }
    }
    for (const c of cars) {
      if (Math.abs(c.x - nx) > 8 || Math.abs(c.z - nz) > 8) continue;
      const push = circleObb(nx, nz, 0.6, carObb(c));
      if (push) { nx += push.nx * push.depth; nz += push.nz * push.depth; }
    }
    w.x = nx;
    w.z = nz;
    w.speed = target;
  } else {
    w.speed = 0;
  }
}

// ---------------------------------------------------------------- E enter/exit
export function nearestDrivable(city, x, z, maxDist = 6) {
  let best = null;
  let bestD = maxDist;
  for (const c of city.cars) {
    if (c.kind !== 'drivable') continue;
    const d = Math.hypot(c.x - x, c.z - z);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best ? { car: best, dist: bestD } : null;
}
export function nearestParked(city, x, z, maxDist = 6) {
  let best = null;
  let bestD = maxDist;
  for (const c of city.cars) {
    if (c.kind !== 'parked') continue;
    const d = Math.hypot(c.x - x, c.z - z);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best ? { car: best, dist: bestD } : null;
}
// Exit spot beside the car: pick the side with free space (no building/car).
export function exitSpot(city, car) {
  const [fx, fz] = forwardOf(car.rot);
  const rx = -fz;
  const rz = fx;
  for (const side of [1, -1]) {
    const x = car.x + rx * 3.2 * side;
    const z = car.z + rz * 3.2 * side;
    if (!buildingHit(city, x, z, 2)) return { x, z };
  }
  return { x: car.x + rx * 3.2, z: car.z + rz * 3.2 };
}

// ---------------------------------------------------------------- road-grid routing
// 40 m cells; drivable when the cell centre is on/near a road, on the plaza,
// or on the diagonal avenue. BFS, 4-neighbourhood.
const GRID = { cell: 40, x0: -1920, z0: -1728, nx: 96, nz: 87 };
function gridCell(x, z) {
  return {
    ix: Math.max(0, Math.min(GRID.nx - 1, Math.floor((x - GRID.x0) / GRID.cell))),
    iz: Math.max(0, Math.min(GRID.nz - 1, Math.floor((z - GRID.z0) / GRID.cell))),
  };
}
function gridCentre(ix, iz) {
  return { x: GRID.x0 + (ix + 0.5) * GRID.cell, z: GRID.z0 + (iz + 0.5) * GRID.cell };
}
function gridDrivable(city, ix, iz) {
  const { x, z } = gridCentre(ix, iz);
  if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + 10) return true;
  if (distToRoad(x, z) < 10) return true;
  return false;
}
export function findPath(city, from, to) {
  const a = gridCell(from.x, from.z);
  const b = gridCell(to.x, to.z);
  const key = (ix, iz) => iz * GRID.nx + ix;
  const prev = new Map();
  const seen = new Set([key(a.ix, a.iz)]);
  const queue = [[a.ix, a.iz]];
  let found = false;
  while (queue.length > 0) {
    const [ix, iz] = queue.shift();
    if (ix === b.ix && iz === b.iz) { found = true; break; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const jx = ix + dx;
      const jz = iz + dz;
      if (jx < 0 || jx >= GRID.nx || jz < 0 || jz >= GRID.nz) continue;
      const k = key(jx, jz);
      if (seen.has(k)) continue;
      if (!gridDrivable(city, jx, jz)) continue;
      seen.add(k);
      prev.set(k, key(ix, iz));
      queue.push([jx, jz]);
    }
  }
  if (!found) return null;
  const cells = [];
  let k = key(b.ix, b.iz);
  const startKey = key(a.ix, a.iz);
  while (k !== startKey) {
    cells.push(k);
    k = prev.get(k);
    if (k === undefined) return null;
  }
  cells.reverse();
  const pts = cells.map((kk) => gridCentre(kk % GRID.nx, Math.floor(kk / GRID.nx)));
  pts.push({ x: to.x, z: to.z });
  // Start and destination in the same cell: a single waypoint. (Without
  // this the smoothing loop below never advances and grows forever.)
  if (pts.length <= 1) return pts;
  // Smooth: skip ahead while the straight segment stays on drivable ground.
  // Stop when i is the last point (the destination is already in `out`).
  const out = [];
  let i = 0;
  const segClear = (p, q) => {
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    const n = Math.max(1, Math.ceil(len / 10));
    for (let s = 1; s < n; s++) {
      const x = p.x + ((q.x - p.x) * s) / n;
      const z = p.z + ((q.z - p.z) * s) / n;
      if (distToRoad(x, z) >= 10 && Math.hypot(x - PLAZA.x, z - PLAZA.z) >= PLAZA.r + 10) return false;
    }
    return true;
  };
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !segClear(pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

// ---------------------------------------------------------------- autopilot
// Steers a car toward a target point (pure pursuit). Returns the input for
// stepCar. `obstacles`: [{x, z, speed}] ahead — brake to follow/stop.
export function autopilotInput(car, target, dt, opts = {}) {
  const cruise = opts.cruise ?? ms(60);
  const [fx, fz] = forwardOf(car.rot);
  // Overtake: an ONCOMING car stopped directly ahead (it stopped for us —
  // a head-on deadlock, e.g. we drifted onto its lane) is steered around
  // instead of waited on. A car ahead in our own lane (same heading) is
  // never overtaken — we wait behind it — and a red light (kind 'light')
  // is never overtaken either.
  let steerTarget = target;
  let creep = 0;
  for (const o of opts.obstacles ?? []) {
    if (o.kind !== 'car' || (o.speed ?? 0) >= 0.5 || o.rot === undefined) continue;
    const rx = o.x - car.x;
    const rz = o.z - car.z;
    const along = rx * fx + rz * fz;
    const lat = rx * -fz + rz * fx;
    if (along <= 0 || along >= 12 || Math.abs(lat) >= 3.5) continue;
    const [ofx, ofz] = forwardOf(o.rot);
    if (fx * ofx + fz * ofz > 0.3) continue; // same direction: wait behind it
    // Oncoming (opposite heading) or crossing (perpendicular): steer around.
    const side = lat >= 0 ? -1 : 1; // pass on the opposite side
    steerTarget = { x: o.x + (-fz) * side * 6, z: o.z + fx * side * 6 };
    creep = ms(20);
    break;
  }
  const dx = target.x - car.x;
  const dz = target.z - car.z;
  const dist = Math.hypot(dx, dz);
  // Steer toward the overtake point when overtaking, else the target.
  const desiredRot = rotOf(steerTarget.x - car.x, steerTarget.z - car.z);
  let dRot = desiredRot - car.rot;
  while (dRot > Math.PI) dRot -= 2 * Math.PI;
  while (dRot < -Math.PI) dRot += 2 * Math.PI;
  const steer = Math.max(-1, Math.min(1, dRot * 2.2));
  let speed = cruise;
  if (dist < 25) speed = Math.min(speed, Math.max(ms(15), cruise * (dist / 25)));
  if (dist < 4) speed = 0;
  // Brake for obstacles ahead. A stopping profile (stop 6 m behind the
  // obstacle, or match its speed if it is moving) — a stopped obstacle
  // 20 m ahead must not freeze the car at its starting point.
  for (const o of opts.obstacles ?? []) {
    const rx = o.x - car.x;
    const rz = o.z - car.z;
    const along = rx * fx + rz * fz;
    const lat = Math.abs(rx * -fz + rz * fx);
    if (along > 0 && along < 22 && lat < 3.5) {
      const closing = Math.sqrt(2 * 5 * Math.max(0, along - 6));
      speed = Math.min(speed, (o.speed ?? 0) + closing);
    }
  }
  // Overtaking creeps past the oncoming car instead of stopping for it.
  if (creep > 0) speed = creep;
  const input = { throttle: 0, brake: 0, steer, handbrake: false, reverse: false };
  const curKmh = kmh(car.speed);
  if (speed <= 0.1) {
    input.brake = 1;
  } else if (curKmh < kmh(speed) - 2) {
    input.throttle = 1;
  } else if (curKmh > kmh(speed) + 2) {
    input.brake = 0.6;
  }
  return input;
}

// Follow a waypoint list with the autopilot. Returns {input, arrived, nextIdx}.
export function autopilotFollow(car, waypoints, idx, dt, opts = {}) {
  if (!waypoints || idx >= waypoints.length) return { input: { throttle: 0, brake: 1, steer: 0, handbrake: false, reverse: false }, arrived: true, nextIdx: idx };
  const target = waypoints[idx];
  const dist = Math.hypot(target.x - car.x, target.z - car.z);
  if (dist < 6) return autopilotFollow(car, waypoints, idx + 1, dt, opts);
  const input = autopilotInput(car, target, dt, opts);
  return { input, arrived: false, nextIdx: idx };
}
