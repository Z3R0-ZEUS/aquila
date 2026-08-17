import { neighbors, key, hexDistance } from './hex.js';
import { TERRAIN, moveCost } from './data/terrain.js';
import { typeOf } from './data/units.js';

function enemyZocKeys(battle, faction) {
  const z = new Set();
  for (const u of battle.units) {
    if (u.strength <= 0 || u.faction === faction || u.hidden) continue;
    z.add(key(u.q, u.r));
    for (const n of neighbors(u)) z.add(key(n.q, n.r));
  }
  return z;
}

export function reachable(battle, unit) {
  const t = typeOf(unit);
  const ignoreZoc = t.traits.includes('ignoreZoc') || t.traits.includes('skirmish');
  const zoc = ignoreZoc ? new Set() : enemyZocKeys(battle, unit.faction);
  const start = key(unit.q, unit.r);
  const best = new Map();
  best.set(start, { cost: 0, prev: null, q: unit.q, r: unit.r });
  const q = [{ cost: 0, q: unit.q, r: unit.r }];

  while (q.length) {
    q.sort((a, b) => a.cost - b.cost);
    const cur = q.shift();
    const ck = key(cur.q, cur.r);
    if (cur.cost !== best.get(ck).cost) continue;
    if (cur.cost > 0 && zoc.has(ck) && !ignoreZoc) continue;

    for (const n of neighbors(cur)) {
      const cell = battle.cell(n.q, n.r);
      if (!cell) continue;
      const terr = TERRAIN[cell.terrain];
      if (!terr || terr.impassable) continue;
      const occ = battle.unitAt(n.q, n.r);
      if (occ && occ.faction !== unit.faction && !occ.hidden) continue;
      if (occ && occ.faction === unit.faction) continue;
      let cost = moveCost(cell.terrain, t, battle.weather);
      if (!isFinite(cost)) continue;
      if (zoc.has(key(n.q, n.r)) && !ignoreZoc) cost += 1;
      const next = cur.cost + cost;
      if (next > unit.mpRemaining) continue;
      const nk = key(n.q, n.r);
      const prevBest = best.get(nk);
      if (prevBest && prevBest.cost <= next) continue;
      best.set(nk, { cost: next, prev: ck, q: n.q, r: n.r });
      q.push({ cost: next, q: n.q, r: n.r });
    }
  }

  const hexes = [];
  const cameFrom = new Map();
  for (const [k, v] of best) {
    if (k === start) continue;
    hexes.push({ q: v.q, r: v.r, cost: v.cost });
    cameFrom.set(k, v.prev);
  }
  return { hexes, cameFrom, start };
}

export function reconstructPath(cameFrom, start, dest) {
  const path = [];
  let k = key(dest.q, dest.r);
  const sk = key(start.q, start.r);
  while (k && k !== sk) {
    const [q, r] = k.split(',').map(Number);
    path.push({ q, r });
    k = cameFrom.get(k);
  }
  path.reverse();
  return path;
}

export function attackTargets(battle, unit) {
  const t = typeOf(unit);
  const out = [];
  for (const e of battle.units) {
    if (e.strength <= 0 || e.faction === unit.faction) continue;
    if (e.hidden && hexDistance(unit, e) > 1 && !t.traits.includes('recon')) continue;
    const melee = hexDistance(unit, e) === 1;
    const missile = t.range > 0 && unit.ammo > 0 && hexDistance(unit, e) <= t.range && hexDistance(unit, e) >= 1;
    if (melee || missile) out.push({ unit: e, melee, missile: missile && !melee ? true : missile && t.range > 1 && hexDistance(unit, e) > 1 });
  }
  return out;
}

export function moveThenAttackHexes(battle, unit) {
  if (unit.acted) return [];
  const t = typeOf(unit);
  const { hexes } = reachable(battle, unit);
  const spots = [{ q: unit.q, r: unit.r, cost: 0 }, ...hexes];
  const seen = new Set();
  const result = [];
  for (const h of spots) {
    for (const e of battle.units) {
      if (e.strength <= 0 || e.faction === unit.faction) continue;
      if (e.hidden && hexDistance(h, e) > 1 && !t.traits.includes('recon')) continue;
      const d = hexDistance(h, e);
      const canMelee = d === 1;
      const canMissile = t.range > 0 && unit.ammo > 0 && d <= t.range && d >= 1;
      if (!canMelee && !canMissile) continue;
      const k = `${e.id}@${h.q},${h.r}`;
      if (seen.has(k)) continue;
      seen.add(k);
      result.push({ from: h, target: e, melee: canMelee, missile: canMissile && !canMelee });
    }
  }
  return result;
}
