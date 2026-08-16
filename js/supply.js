import { neighbors, key } from './hex.js';
import { TERRAIN } from './data/terrain.js';

export function markSupply(battle) {
  const sources = [];
  for (const c of battle.cells.values()) {
    if (c.supplySource || TERRAIN[c.terrain]?.supply) sources.push(c);
  }
  const romeZoc = zocSet(battle, 'rome');
  const gerZoc = zocSet(battle, 'germania');

  const romeReach = flood(battle, sources, 'rome', gerZoc);
  const gerReach = flood(battle, sources.filter((s) => s.germanSupply) .concat(
    [...battle.cells.values()].filter((c) => c.germanSupply)
  ), 'germania', romeZoc);

  // Germans also draw supply from their map-edge / forest camps
  if (gerReach.size === 0) {
    const camps = [...battle.cells.values()].filter((c) => c.germanSupply || c.terrain === 'oppidum');
    for (const c of camps) gerReach.add(key(c.q, c.r));
    const extra = flood(battle, camps, 'germania', romeZoc);
    for (const k of extra) gerReach.add(k);
  }

  for (const u of battle.units) {
    if (u.strength <= 0) {
      u.inSupply = true;
      continue;
    }
    const here = key(u.q, u.r);
    u.inSupply = u.faction === 'rome' ? romeReach.has(here) : gerReach.has(here) || defaultGermanSupply(battle, u);
  }
}

function defaultGermanSupply(battle, u) {
  const c = battle.cell(u.q, u.r);
  if (!c) return false;
  return c.terrain === 'lightForest' || c.terrain === 'denseForest' || c.terrain === 'oppidum' || c.germanSupply;
}

function zocSet(battle, faction) {
  const z = new Set();
  for (const u of battle.units) {
    if (u.strength <= 0 || u.faction !== faction || u.hidden) continue;
    for (const n of neighbors(u)) z.add(key(n.q, n.r));
  }
  return z;
}

function flood(battle, sources, friendFaction, enemyZoc) {
  const seen = new Set();
  const q = [];
  for (const s of sources) {
    const k = key(s.q, s.r);
    if (seen.has(k)) continue;
    seen.add(k);
    q.push(s);
  }
  while (q.length) {
    const cur = q.shift();
    for (const n of neighbors(cur)) {
      const cell = battle.cell(n.q, n.r);
      if (!cell) continue;
      const terr = TERRAIN[cell.terrain];
      if (!terr || terr.impassable) continue;
      const k = key(n.q, n.r);
      if (seen.has(k)) continue;
      const occ = battle.unitAt(n.q, n.r);
      if (occ && occ.faction !== friendFaction && !occ.hidden) continue;
      if (enemyZoc.has(k) && !(occ && occ.faction === friendFaction)) continue;
      seen.add(k);
      q.push(n);
    }
  }
  return seen;
}

export function applyAttrition(battle) {
  const notes = [];
  for (const u of battle.units) {
    if (u.strength <= 0 || u.inSupply) continue;
    if (battle.rng() < 0.1) {
      u.strength = Math.max(1, u.strength - 1);
      notes.push(`${u.name} loses a man to hunger and wet.`);
    }
  }
  return notes;
}
