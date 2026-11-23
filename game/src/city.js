// city.js — deterministic Solmar city data, seed 20261123.
// Everything the renderer, the verifier and later stages read comes from here:
// roads, districts, buildings, trees, lamps, cars, pedestrians, boats,
// traffic lights, neon signs, plaza, canal, harbour, beach and park.
import { mulberry32, range, rangeInt, pick, chance } from './rng.js';

export const SEED = 20261123;
export const CITY = { x0: -1920, x1: 1920, z0: -1728, z1: 1728 };

export const DISTRICTS = [
  { id: 'pearl-marina', name: 'Pearl Marina', tagline: 'White sails and quiet water', standing: 51, palette: ['#e8e4d8', '#ded8c8', '#f0ece2'], rect: { x0: -1920, x1: 400, z0: -1728, z1: -600 } },
  { id: 'glasspoint', name: 'Glasspoint', tagline: 'Glass towers over the bay', standing: 66, palette: ['#6f8fa8', '#5f7f96', '#7fa0b8'], rect: { x0: 400, x1: 1920, z0: -1728, z1: -600 } },
  { id: 'canal-ward', name: 'Canal Ward', tagline: 'Bridges, boats and morning markets', standing: 48, palette: ['#7fa8a0', '#6f9a92', '#8fb5ad'], rect: { x0: -1920, x1: -800, z0: -600, z1: 600 } },
  { id: 'old-solmar', name: 'Old Solmar', tagline: 'Old stone lanes by the canal', standing: 55, palette: ['#d9c49a', '#cbb184', '#e2d0ac'], rect: { x0: -800, x1: 400, z0: -600, z1: 600 } },
  { id: 'citrus-quarter', name: 'Citrus Quarter', tagline: 'Sunlit groves and glass towers', standing: 58, palette: ['#e0b34e', '#d1a23e', '#eac05e'], rect: { x0: 400, x1: 1920, z0: -600, z1: 600 } },
  { id: 'south-market', name: 'South Market', tagline: 'Spice stalls and late bargains', standing: 62, palette: ['#d77f69', '#c96f5c', '#e08d76'], rect: { x0: -1920, x1: 1200, z0: 600, z1: 1728 } },
  { id: 'sunstrand', name: 'Sunstrand Beach', tagline: 'Sand, surf and neon nights', standing: 59, palette: ['#e8d9a0', '#dcc98c', '#f0e2b0'], rect: { x0: 1200, x1: 1920, z0: 600, z1: 1728 } },
];

// Roads: axis-aligned rectangles (axis 'z' runs north-south, 'x' east-west).
export const ROADS = [
  { cx: 400, cz: 0, w: 64, len: 3456, axis: 'z', kind: 'boulevard' },
  { cx: 0, cz: 0, w: 48, len: 3840, axis: 'x', kind: 'avenue' },
  ...[-1400, -800, 1000, 1600].map((x) => ({ cx: x, cz: 0, w: 28, len: 3456, axis: 'z', kind: 'secondary' })),
  ...[-1200, -600, 600, 1200].map((z) => ({ cx: 0, cz: z, w: 28, len: 3840, axis: 'x', kind: 'secondary' })),
  ...[-1700, -1100, -500, 100, 700, 1300].map((x) => ({ cx: x, cz: 0, w: 18, len: 3456, axis: 'z', kind: 'local' })),
  ...[-1500, -900, -300, 300, 900, 1500].map((z) => ({ cx: 0, cz: z, w: 18, len: 3840, axis: 'x', kind: 'local' })),
];

// Old Solmar's off-grid diagonal avenue (a segment, not a rectangle).
export const DIAGONAL = { x1: -700, z1: -500, x2: 300, z2: 500, w: 24 };

export const CANAL = { x0: -1560, x1: -1440, z0: -1200, z1: 1200 };
export const HARBOUR = { x0: -1620, x1: -1180, z0: 1200, z1: 1520 };
export const BEACH = { x0: 1750, x1: 1920, z0: 600, z1: 1728 };
export const PARK = { x0: 700, x1: 1100, z0: 800, z1: 1200 };
export const PLAZA = { x: 400, z: 0, r: 130 };
export const TOWER = { x: 400, z: 0, w: 36, d: 36, h: 150 };
export const FOUNTAIN = { x: 400, z: 72, r: 22 };

export function districtAt(x, z) {
  for (const d of DISTRICTS) {
    const r = d.rect;
    if (x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1) return d;
  }
  return DISTRICTS[3]; // Old Solmar fallback (never reached by the partition)
}

export function inRect(x, z, r, margin = 0) {
  return x >= r.x0 - margin && x <= r.x1 + margin && z >= r.z0 - margin && z <= r.z1 + margin;
}

// Distance from a point to the diagonal avenue segment.
export function distToDiagonal(x, z) {
  const dx = DIAGONAL.x2 - DIAGONAL.x1;
  const dz = DIAGONAL.z2 - DIAGONAL.z1;
  const len2 = dx * dx + dz * dz;
  let t = ((x - DIAGONAL.x1) * dx + (z - DIAGONAL.z1) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = DIAGONAL.x1 + t * dx;
  const pz = DIAGONAL.z1 + t * dz;
  return Math.hypot(x - px, z - pz);
}

export function roadContains(x, z, margin = 0) {
  for (const r of ROADS) {
    if (r.axis === 'z') {
      if (Math.abs(x - r.cx) <= r.w / 2 + margin && Math.abs(z - r.cz) <= r.len / 2) return true;
    } else {
      if (Math.abs(z - r.cz) <= r.w / 2 + margin && Math.abs(x - r.cx) <= r.len / 2) return true;
    }
  }
  return false;
}

// Distance from a point to the nearest road centreline (0 when on a road).
export function distToRoad(x, z) {
  let best = Infinity;
  for (const r of ROADS) {
    let d;
    if (r.axis === 'z') {
      const along = Math.abs(z - r.cz) <= r.len / 2 ? 0 : Math.abs(z - r.cz) - r.len / 2;
      d = Math.hypot(Math.abs(x - r.cx) - r.w / 2, along);
      if (Math.abs(x - r.cx) <= r.w / 2) d = along;
    } else {
      const along = Math.abs(x - r.cx) <= r.len / 2 ? 0 : Math.abs(x - r.cx) - r.len / 2;
      d = Math.hypot(Math.abs(z - r.cz) - r.w / 2, along);
      if (Math.abs(z - r.cz) <= r.w / 2) d = along;
    }
    if (d < best) best = d;
  }
  const dd = distToDiagonal(x, z) - DIAGONAL.w / 2;
  if (dd < best) best = dd;
  return Math.max(0, best);
}

const CAR_COLORS = ['#c94f43', '#3f6fb5', '#e8e4d8', '#5a5f66', '#7a9e6a', '#b5762e', '#8a6fb5'];
const JACKETS = ['#e84c3d', '#f2c230', '#2e9e6b', '#3f6fb5', '#e86a9e', '#f2822e'];

export function generateCity(seed = SEED) {
  const rng = mulberry32(seed);

  // ---- buildings (jittered grid, rejection-sampled against roads/water/plaza) ----
  const buildings = [];
  for (let gx = -1900; gx <= 1900 && buildings.length < 750; gx += 80) {
    for (let gz = -1700; gz <= 1700 && buildings.length < 750; gz += 80) {
      if (chance(rng, 0.01)) continue; // empty lots: varied blocks, never a solid grid
      const x = gx + range(rng, -26, 26);
      const z = gz + range(rng, -26, 26);
      if (x < CITY.x0 + 60 || x > CITY.x1 - 60 || z < CITY.z0 + 60 || z > CITY.z1 - 60) continue;
      const d = districtAt(x, z);
      if (roadContains(x, z, 8) || distToDiagonal(x, z) < DIAGONAL.w / 2 + 8) continue;
      if (inRect(x, z, CANAL, 10) || inRect(x, z, HARBOUR, 10) || inRect(x, z, BEACH, 6) || inRect(x, z, PARK, 10)) continue;
      const w = range(rng, 28, 62);
      const dep = range(rng, 28, 62);
      const h = d.id === 'glasspoint' ? range(rng, 50, 130) : d.id === 'old-solmar' ? range(rng, 12, 26) : range(rng, 15, 48);
      const r = 0.5 * Math.hypot(w, dep) + 4;
      // Radius-aware margins: the building's own circle must clear the road
      // edge (so a car on the road never sits inside a building) and the
      // plaza ring (so the drivable cars parked around it stay clear).
      if (distToRoad(x, z) <= r + 4) continue;
      if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + 32 + r) continue;
      if (buildings.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + r)) continue;
      let rot = 0;
      if (d.id === 'old-solmar' && distToDiagonal(x, z) < 160) rot = (15 * Math.PI) / 180;
      else if (chance(rng, 0.12)) rot = (90 * Math.PI) / 180;
      const kind = d.id === 'glasspoint' ? 'glass' : d.id === 'old-solmar' ? 'brick' : chance(rng, 0.25) ? 'glass' : 'brick';
      buildings.push({
        x, z, w, d: dep, h, rot, district: d.id, kind,
        color: pick(rng, d.palette),
        roof: d.id === 'old-solmar' ? '#a85f45' : '#3a3f45',
        r, seed: Math.floor(rng() * 1e9),
      });
    }
  }

  // ---- trees: boulevard rows, canal promenade, park, scattered ----
  const trees = [];
  const addTree = (x, z) => {
    if (roadContains(x, z, 2) || inRect(x, z, CANAL, 2) || inRect(x, z, HARBOUR, 2) || inRect(x, z, BEACH, 2)) return;
    if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + 6) return;
    if (buildings.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + 6)) return;
    trees.push({ x, z, h: range(rng, 9, 15), shade: pick(rng, ['#3f7d44', '#4c8a3f', '#56856b']) });
  };
  for (let z = -1650; z <= 1650; z += 90) {
    addTree(400 - 38 + range(rng, -2, 2), z + range(rng, -8, 8));
    addTree(400 + 38 + range(rng, -2, 2), z + range(rng, -8, 8));
  }
  for (let z = -1150; z <= 1150; z += 80) addTree(-1420 + range(rng, -3, 3), z + range(rng, -6, 6));
  for (let i = 0; i < 70; i++) addTree(range(rng, PARK.x0 + 15, PARK.x1 - 15), range(rng, PARK.z0 + 15, PARK.z1 - 15));
  for (let i = 0; i < 60; i++) addTree(range(rng, -1800, 1800), range(rng, -1650, 1650));

  // ---- lamps: boulevard, cross avenue, plaza ring, promenade ----
  const lamps = [];
  const addLamp = (x, z) => {
    if (roadContains(x, z, 1) || inRect(x, z, CANAL, 2)) return;
    lamps.push({ x, z });
  };
  for (let z = -1650; z <= 1650; z += 110) {
    addLamp(400 - 36, z);
    addLamp(400 + 36, z + 55);
  }
  for (let x = -1850; x <= 1850; x += 110) {
    addLamp(x, -28);
    addLamp(x + 55, 28);
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    addLamp(PLAZA.x + Math.cos(a) * (PLAZA.r + 8), PLAZA.z + Math.sin(a) * (PLAZA.r + 8));
  }
  for (let z = -1100; z <= 1100; z += 140) addLamp(-1418, z);

  // ---- traffic lights at 13 intersections ----
  const lightSpots = [
    [400, -1200], [400, -600], [400, 0], [400, 600], [400, 1200],
    [-1400, 0], [-800, 0], [1000, 0], [1600, 0],
    [-800, -600], [-800, 600], [1000, -600], [1000, 600],
  ];
  const trafficLights = lightSpots.map(([x, z]) => ({ x: x + 34, z: z + 34 }));

  // ---- cars: parked (54), drivable (8, coral + roof sign), traffic (40, 3 taxis) ----
  const cars = [];
  const carOnRoad = (x, z, kind, color) => {
    cars.push({ x, z, rot: range(rng, -0.06, 0.06), kind, color });
  };
  for (let i = 0; i < 30; i++) {
    const z = -1600 + i * 110 + range(rng, -20, 20);
    carOnRoad(400 + (i % 2 === 0 ? -26 : 26), z, 'parked', pick(rng, CAR_COLORS));
  }
  for (let i = 0; i < 24; i++) {
    const x = -1800 + i * 155 + range(rng, -20, 20);
    carOnRoad(x, i % 2 === 0 ? -20 : 20, 'parked', pick(rng, CAR_COLORS));
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.3;
    cars.push({
      x: PLAZA.x + Math.cos(a) * 158, z: PLAZA.z + Math.sin(a) * 158,
      rot: a + Math.PI / 2, kind: 'drivable', color: '#d77f69',
    });
  }
  for (let i = 0; i < 40; i++) {
    if (i < 16) {
      cars.push({ x: 400 + (i % 2 === 0 ? -8 : 8), z: -1600 + i * 205, rot: i % 2 === 0 ? 0 : Math.PI, kind: i < 3 ? 'taxi' : 'traffic', color: i < 3 ? '#f2c230' : pick(rng, CAR_COLORS) });
    } else if (i < 28) {
      cars.push({ x: -1700 + (i - 16) * 290, z: (i - 16) % 2 === 0 ? -8 : 8, rot: (i - 16) % 2 === 0 ? Math.PI / 2 : -Math.PI / 2, kind: 'traffic', color: pick(rng, CAR_COLORS) });
    } else {
      cars.push({ x: (i % 2 === 0 ? -800 : 1000) + (i % 4 < 2 ? -8 : 8), z: -1200 + (i - 28) * 220, rot: 0, kind: 'traffic', color: pick(rng, CAR_COLORS) });
    }
  }

  // ---- pedestrians: sidewalks near the boulevard, plaza ring, park paths ----
  const pedestrians = [];
  for (let i = 0; i < 40; i++) {
    let placed = false;
    for (let tries = 0; tries < 10 && !placed; tries++) {
      let x, z;
      if (i < 20) {
        x = 400 + (i % 2 === 0 ? -38 : 38) + range(rng, -3, 3);
        z = range(rng, -1500, 1500);
      } else if (i < 30) {
        const a = range(rng, 0, Math.PI * 2);
        x = PLAZA.x + Math.cos(a) * (PLAZA.r + 14);
        z = PLAZA.z + Math.sin(a) * (PLAZA.r + 14);
      } else {
        x = range(rng, PARK.x0 + 10, PARK.x1 - 10);
        z = range(rng, PARK.z0 + 10, PARK.z1 - 10);
      }
      if (roadContains(x, z, 0)) continue;
      pedestrians.push({ x, z, rot: range(rng, 0, Math.PI * 2), jacket: pick(rng, JACKETS) });
      placed = true;
    }
    if (!placed) {
      // Fallback: a known-safe park corner (clear of the local roads).
      pedestrians.push({ x: 750 + i * 3, z: 850, rot: range(rng, 0, Math.PI * 2), jacket: pick(rng, JACKETS) });
    }
  }

  // ---- boats on the canal and in the harbour ----
  const boats = [
    { x: -1500, z: -800, rot: 0 }, { x: -1500, z: 0, rot: Math.PI }, { x: -1500, z: 800, rot: 0 },
    { x: -1400, z: 1360, rot: Math.PI / 2 }, { x: -1280, z: 1420, rot: -Math.PI / 2 },
  ];

  // ---- neon signs: billboards near the plaza, canal and beach ----
  const signs = [
    { text: 'SOLMAR', x: 520, z: -140, color: '#ff8a6a' },
    { text: 'PALKO', x: 280, z: 140, color: '#5fd3c8' },
    { text: 'MARINA', x: -1400, z: 900, color: '#7fb5ff' },
    { text: 'BEACH', x: 1720, z: 1000, color: '#ffd25f' },
  ];

  return { buildings, trees, lamps, trafficLights, cars, pedestrians, boats, signs };
}
