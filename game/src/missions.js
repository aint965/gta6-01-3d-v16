// missions.js — Stage B: missions 1-4 (Mara Venn vs Bastion Civic / Silas
// Rook; helpers Neri + Oren). Clean-play total $2,000; mission 4 is the
// finale (collect, deliver, then a city-wide broadcast moment).
// Pure logic (no DOM): the Node sim imports the same code the game runs.
// Every objective appears in 3 forms at once: dialog + HUD panel + world
// marker. The timer does NOT run before the player moves. Triggers are
// generous (7 m) and never time out.

export const MISSIONS = [
  {
    id: 1,
    title: 'A Receipt for Sunshine',
    reward: 250,
    speaker: 'Neri',
    pickupDialog: 'Neri: "Mara — the receipt is at the fountain. Bastion\'s men are watching the plaza, so walk it in, don\'t drive it in."',
    deliverDialog: 'Oren: "South Market, stall by the spice sacks. Hand it over and the Sunshine account is ours."',
    pickup: { x: 400, z: 110, label: 'Fountain, Central Plaza' },
    drop: { x: 200, z: 900, label: 'Spice stall, South Market' },
  },
  {
    id: 2,
    title: 'Salt Ledger',
    reward: 500,
    speaker: 'Oren',
    pickupDialog: 'Oren: "The salt ledger is on the canal bridge — Rook\'s courier drops it at midnight. Take it before the tide turns."',
    deliverDialog: 'Neri: "Old Solmar, the diagonal lane. The ledger goes to the woman with the blue door. She\'ll know what it means."',
    pickup: { x: -1500, z: 0, label: 'Canal bridge, Canal Ward' },
    drop: { x: -200, z: 0, label: 'Blue door, Old Solmar' },
  },
  {
    id: 3,
    title: 'After the Shutters',
    reward: 450,
    speaker: 'Neri',
    pickupDialog: 'Neri: "The grocers close at dusk, but the goods still have to move. Pick the crate up in the Citrus Quarter."',
    deliverDialog: 'Oren: "Pearl Marina, the white jetty. After the shutters means after the shutters — no headlights, no hurry, no witnesses."',
    pickup: { x: 1200, z: 300, label: 'Citrus grove, Citrus Quarter' },
    drop: { x: -1100, z: -900, label: 'White jetty, Pearl Marina' },
  },
  {
    id: 4,
    title: 'Glass Debt',
    reward: 800,
    speaker: 'Oren',
    pickupDialog: 'Oren: "Last one, Mara. The debt papers are in Glasspoint — Rook keeps them where the glass is thickest. Take them and it\'s over."',
    deliverDialog: 'Neri: "Bring them to the clock tower. When the papers burn, the whole city hears it. This is the morning we take back."',
    pickup: { x: 1000, z: -1000, label: 'Glasspoint tower lobby' },
    drop: { x: 400, z: -100, label: 'Clock tower, Central Plaza' },
    finale: true,
  },
];

export const PICKUP_RADIUS = 7;
export const DROP_RADIUS = 7;

export function createMissions() {
  return {
    idx: 0, // current mission index (0-based)
    phase: 'pickup', // 'pickup' | 'deliver' | 'done'
    cash: 0,
    timer: 0, // seconds; runs only after the player first moves
    timerRunning: false,
    broadcast: null, // set on the finale: the city-wide announcement
    log: [], // [{mission, event, cash}]
    earned: [], // cash per mission, in order
  };
}

export function currentMission(state) {
  if (state.idx >= MISSIONS.length) return null;
  return MISSIONS[state.idx];
}

// The active target: what the world marker, HUD panel and dialog describe.
export function currentTarget(state) {
  const m = currentMission(state);
  if (!m) return null;
  if (state.phase === 'pickup') {
    return { x: m.pickup.x, z: m.pickup.z, kind: 'pickup', label: m.pickup.label, color: '#ffd25f', mission: m };
  }
  return { x: m.drop.x, z: m.drop.z, kind: 'deliver', label: m.drop.label, color: '#4ade80', mission: m };
}

export function objectiveText(state) {
  const m = currentMission(state);
  if (!m) return 'All missions complete — Solmar is yours.';
  if (state.phase === 'pickup') return `Pick up: ${m.pickup.label}`;
  return `Deliver: ${m.drop.label}`;
}

export function dialogLine(state) {
  const m = currentMission(state);
  if (!m) return 'Neri: "That\'s all of it, Mara. The morning is ours."';
  return state.phase === 'pickup' ? m.pickupDialog : m.deliverDialog;
}

// Step the mission state. `pos`: the player's position {x, z}.
// `moved`: true once the player has moved at all (driving or walking).
// Returns events: [{type:'pickup'|'delivered'|'finale', mission, cash}].
export function stepMissions(state, pos, moved, dt) {
  const events = [];
  if (moved && !state.timerRunning) state.timerRunning = true;
  if (state.timerRunning) state.timer += dt;
  const m = currentMission(state);
  if (!m) return events;
  const target = currentTarget(state);
  const d = Math.hypot(pos.x - target.x, pos.z - target.z);
  const radius = target.kind === 'pickup' ? PICKUP_RADIUS : DROP_RADIUS;
  if (d > radius) return events;
  if (state.phase === 'pickup') {
    state.phase = 'deliver';
    state.log.push({ mission: m.id, event: 'pickup' });
    events.push({ type: 'pickup', mission: m });
  } else {
    state.cash += m.reward;
    state.earned.push(m.reward);
    state.log.push({ mission: m.id, event: 'delivered', cash: m.reward });
    events.push({ type: 'delivered', mission: m, cash: m.reward });
    if (m.finale) {
      state.broadcast = 'THE DEBT IS SETTLED — Solmar hears Mara\'s name';
      state.phase = 'done';
      state.idx = MISSIONS.length;
      events.push({ type: 'finale', mission: m, cash: m.reward });
    } else {
      state.idx += 1;
      state.phase = 'pickup';
    }
  }
  return events;
}
