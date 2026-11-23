// verify-layout.mjs — layout verifier for Stage A. Imports the same city
// data the game renders and checks every placement rule. Exit code 0 only
// when there are 0 problems. Run: node checks/verify-layout.mjs
import { generateCity, SEED, CITY, ROADS, DIAGONAL, CANAL, HARBOUR, BEACH, PARK, PLAZA, roadContains, distToDiagonal, distToRoad, inRect } from '../game/src/city.js';

const city = generateCity(SEED);
const problems = [];
const note = (msg) => problems.push(msg);

// ---- buildings ----
for (const b of city.buildings) {
  if (b.x - b.r < CITY.x0 || b.x + b.r > CITY.x1 || b.z - b.r < CITY.z0 || b.z + b.r > CITY.z1) {
    note(`building at (${b.x.toFixed(0)}, ${b.z.toFixed(0)}) outside city bounds`);
  }
  if (roadContains(b.x, b.z, 8)) note(`building at (${b.x.toFixed(0)}, ${b.z.toFixed(0)}) on a road`);
  if (distToDiagonal(b.x, b.z) < DIAGONAL.w / 2 + 8) note(`building at (${b.x.toFixed(0)}, ${b.z.toFixed(0)}) on the diagonal avenue`);
  if (inRect(b.x, b.z, CANAL, 10)) note(`building at (${b.x.toFixed(0)}, ${b.z.toFixed(0)}) in the canal`);
  if (inRect(b.x, b.z, HARBOUR, 10)) note(`building at (${b.x.toFixed(0)}, ${b.z.toFixed(0)}) in the harbour`);
  if (inRect(b.x, b.z, BEACH, 6)) note(`building at (${b.x.toFixed(0)}, ${b.z.toFixed(0)}) on the beach`);
  if (inRect(b.x, b.z, PARK, 10)) note(`building at (${b.x.toFixed(0)}, ${b.z.toFixed(0)}) in the park`);
  if (Math.hypot(b.x - PLAZA.x, b.z - PLAZA.z) < PLAZA.r + 12) note(`building at (${b.x.toFixed(0)}, ${b.z.toFixed(0)}) in the plaza`);
}
for (let i = 0; i < city.buildings.length; i++) {
  for (let j = i + 1; j < city.buildings.length; j++) {
    const a = city.buildings[i];
    const b = city.buildings[j];
    if (Math.hypot(a.x - b.x, a.z - b.z) < a.r + b.r) {
      note(`buildings ${i} and ${j} overlap (${a.x.toFixed(0)},${a.z.toFixed(0)}) vs (${b.x.toFixed(0)},${b.z.toFixed(0)})`);
    }
  }
}

// ---- trees + lamps: never on a road or in the water ----
for (const t of city.trees) {
  if (roadContains(t.x, t.z, 2)) note(`tree at (${t.x.toFixed(0)}, ${t.z.toFixed(0)}) on a road`);
  if (inRect(t.x, t.z, CANAL, 2) || inRect(t.x, t.z, HARBOUR, 2)) note(`tree at (${t.x.toFixed(0)}, ${t.z.toFixed(0)}) in the water`);
}
for (const l of city.lamps) {
  if (roadContains(l.x, l.z, 1)) note(`lamp at (${l.x.toFixed(0)}, ${l.z.toFixed(0)}) on a road`);
  if (inRect(l.x, l.z, CANAL, 2)) note(`lamp at (${l.x.toFixed(0)}, ${l.z.toFixed(0)}) in the canal`);
}

// ---- cars: on/near roads, never inside a building ----
const buildingHit = (x, z, r = 4) => city.buildings.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + r);
for (const c of city.cars) {
  if (c.x < CITY.x0 || c.x > CITY.x1 || c.z < CITY.z0 || c.z > CITY.z1) note(`car (${c.kind}) at (${c.x.toFixed(0)}, ${c.z.toFixed(0)}) outside bounds`);
  if (buildingHit(c.x, c.z)) note(`car (${c.kind}) at (${c.x.toFixed(0)}, ${c.z.toFixed(0)}) inside a building`);
  if (c.kind === 'traffic' || c.kind === 'taxi') {
    if (distToRoad(c.x, c.z) > 2) note(`traffic car at (${c.x.toFixed(0)}, ${c.z.toFixed(0)}) off the road (gap ${distToRoad(c.x, c.z).toFixed(1)})`);
  }
  if (c.kind === 'parked') {
    if (distToRoad(c.x, c.z) > 2) note(`parked car at (${c.x.toFixed(0)}, ${c.z.toFixed(0)}) off the road (gap ${distToRoad(c.x, c.z).toFixed(1)})`);
  }
  if (c.kind === 'drivable') {
    if (distToRoad(c.x, c.z) > 60) note(`drivable car at (${c.x.toFixed(0)}, ${c.z.toFixed(0)}) far from any road`);
  }
}

// ---- pedestrians: on sidewalks (road + 12), the plaza ring, or the park ----
for (const p of city.pedestrians) {
  const onSidewalk = distToRoad(p.x, p.z) <= 12;
  const onPlazaRing = Math.abs(Math.hypot(p.x - PLAZA.x, p.z - PLAZA.z) - (PLAZA.r + 14)) <= 10;
  const inPark = inRect(p.x, p.z, PARK, 0);
  if (!onSidewalk && !onPlazaRing && !inPark) note(`pedestrian at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) off the sidewalk`);
  if (roadContains(p.x, p.z, 0)) note(`pedestrian at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) standing on the road`);
}

// ---- boats: in the water ----
for (const b of city.boats) {
  if (!inRect(b.x, b.z, CANAL, 0) && !inRect(b.x, b.z, HARBOUR, 0)) note(`boat at (${b.x.toFixed(0)}, ${b.z.toFixed(0)}) not in the water`);
}

// ---- counts ----
const counts = {
  buildings: city.buildings.length,
  trees: city.trees.length,
  lamps: city.lamps.length,
  trafficLights: city.trafficLights.length,
  parked: city.cars.filter((c) => c.kind === 'parked').length,
  drivable: city.cars.filter((c) => c.kind === 'drivable').length,
  traffic: city.cars.filter((c) => c.kind === 'traffic' || c.kind === 'taxi').length,
  pedestrians: city.pedestrians.length,
  boats: city.boats.length,
  signs: city.signs.length,
};
console.log(`counts: buildings ${counts.buildings}, trees ${counts.trees}, lamps ${counts.lamps}, traffic lights ${counts.trafficLights}, parked ${counts.parked}, drivable ${counts.drivable}, traffic ${counts.traffic}, pedestrians ${counts.pedestrians}, boats ${counts.boats}, signs ${counts.signs}`);
if (counts.buildings < 500) note(`only ${counts.buildings} buildings (need >= 500)`);
if (counts.trees < 150) note(`only ${counts.trees} trees (need >= 150)`);
if (counts.lamps < 100) note(`only ${counts.lamps} lamps (need >= 100)`);
if (counts.parked !== 54) note(`parked cars ${counts.parked} (need 54)`);
if (counts.drivable !== 8) note(`drivable cars ${counts.drivable} (need 8)`);
if (counts.traffic !== 40) note(`traffic cars ${counts.traffic} (need 40)`);
if (counts.pedestrians !== 40) note(`pedestrians ${counts.pedestrians} (need 40)`);
if (counts.trafficLights !== 13) note(`traffic lights ${counts.trafficLights} (need 13)`);
if (counts.boats !== 5) note(`boats ${counts.boats} (need 5)`);
if (counts.signs !== 4) note(`neon signs ${counts.signs} (need 4)`);

if (problems.length === 0) {
  console.log('LAYOUT OK: 0 problems');
  process.exit(0);
} else {
  console.log(`LAYOUT FAIL: ${problems.length} problems`);
  for (const p of problems.slice(0, 40)) console.log(`  - ${p}`);
  if (problems.length > 40) console.log(`  ... and ${problems.length - 40} more`);
  process.exit(1);
}
