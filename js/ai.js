import { hexDistance, neighbors } from './hex.js';
import { typeOf, isHero, effectiveStrength } from './data/units.js';
import { reachable } from './pathfind.js';
import { previewCombat, inMissileRange } from './combat.js';
import { TERRAIN } from './data/terrain.js';
import { markSupply } from './supply.js';

export function runAiTurn(battle) {
  const acts = [];
  const side = battle.enemyFaction || 'germania';
  const foes = battle.units
    .filter((u) => u.faction === side && u.strength > 0)
    .sort((a, b) => typeOf(b).initiative - typeOf(a).initiative);

  for (const u of foes) {
    if (u.strength <= 0 || battle.result) break;
    u.mpRemaining = typeOf(u).move;
    u.moved = false;
    u.acted = false;
    const act = actUnit(battle, u);
    if (act) acts.push(act);
  }
  battle.recoverSide(side);
  markSupply(battle);
  return acts;
}

function actUnit(battle, unit) {
  const t = typeOf(unit);
  const enemies = battle.units.filter((e) => e.faction === battle.playerFaction && e.strength > 0 && !e.extracted);
  if (!enemies.length) return null;
  const bold = battle.difficulty === 'veteran' ? 0.75 : battle.difficulty === 'recruit' ? 1.8 : 1.15;

  const shot = bestShot(battle, unit, enemies);
  if (shot && shot.score >= 1.2) {
    const res = battle.tryAttack(unit, shot.target, { ai: true, missile: true });
    return { type: 'attack', unit, target: shot.target, result: res, missile: true };
  }

  const { hexes } = reachable(battle, unit);
  const spots = [{ q: unit.q, r: unit.r, cost: 0 }, ...hexes];
  let best = { score: -999, spot: spots[0], target: null, missile: false, melee: false };

  for (const spot of spots) {
    let stand = standScore(battle, unit, spot);
    const cell = battle.cell(spot.q, spot.r);
    const terr = TERRAIN[cell?.terrain || 'clear'];
    if (unit.faction === 'germania' && (terr.id === 'denseForest' || terr.id === 'lightForest')) stand += 1.2;
    if (unit.faction === 'rome' && terr.id === 'clear') stand += 0.6;
    if (terr.id === 'marsh' && t.traits.includes('cavalry')) stand -= 5;
    if (cell?.principia || cell?.gate) stand += unit.faction === 'germania' ? 6 : 3;
    if (cell?.extract) stand += 2;
    if (cell?.eagle) stand += 2;
    if (cell?.terrain === 'causeway') stand += 2.5;
    if (isHero(unit) && terr.id === 'clear' && unit.faction === 'germania') stand -= 1;

    for (const e of enemies) {
      const d = hexDistance(spot, e);
      if (d === 1) {
        const fake = { ...unit, q: spot.q, r: spot.r };
        const prev = previewCombat(battle, fake, e, { missile: false });
        const score = stand + attackScore(prev, unit, e);
        if (score > best.score) best = { score, spot, target: e, missile: false, melee: true };
      } else if (t.range > 0 && unit.ammo > 0 && d <= t.range && d >= 1) {
        const fake = { ...unit, q: spot.q, r: spot.r };
        if (d > 1 && !inMissileRange(battle, fake, e)) continue;
        const prev = previewCombat(battle, fake, e, { missile: true });
        const score = stand + attackScore(prev, unit, e) * 0.85 + (d > 1 ? 0.4 : 0);
        if (score > best.score) best = { score, spot, target: e, missile: true, melee: false };
      }
    }

    const nearest = enemies.reduce((a, e) => (hexDistance(spot, e) < hexDistance(spot, a) ? e : a), enemies[0]);
    const approach = stand + 3 - hexDistance(spot, nearest) * 0.55 + objectivePull(battle, spot, unit);
    if (!best.target && approach > best.score) best = { score: approach, spot, target: null, missile: false, melee: false };
    else if (approach > best.score + 3 && isHero(unit) && effectiveStrength(unit) <= 3) {
      best = { score: approach, spot, target: null, missile: false, melee: false };
    }
  }

  if (best.melee && best.target) {
    const fake = { ...unit, q: best.spot.q, r: best.spot.r };
    const prev = previewCombat(battle, fake, best.target, { missile: false });
    if (prev.toAttacker.kills * bold >= effectiveStrength(unit) - (isHero(unit) ? 2 : 0.5)) {
      best.melee = false;
      best.target = null;
    }
  }

  if (best.spot.q !== unit.q || best.spot.r !== unit.r) {
    const moved = battle.tryMove(unit, best.spot.q, best.spot.r);
    if (!moved) {
      unit.acted = true;
      return { type: 'move', unit, to: { q: unit.q, r: unit.r } };
    }
    if (unit.hidden && TERRAIN[battle.cell(unit.q, unit.r)?.terrain]?.id === 'clear') unit.hidden = false;
  }

  if (best.target && (best.melee || best.missile) && !unit.acted) {
    const res = battle.tryAttack(unit, best.target, { ai: true, missile: best.missile });
    return { type: 'attack', unit, target: best.target, result: res, missile: best.missile };
  }

  unit.acted = true;
  return { type: 'move', unit, to: { q: unit.q, r: unit.r } };
}

function bestShot(battle, unit, enemies) {
  const t = typeOf(unit);
  if (t.range <= 0 || unit.ammo <= 0) return null;
  let best = null;
  for (const e of enemies) {
    const d = hexDistance(unit, e);
    if (d < 1 || d > t.range) continue;
    if (!inMissileRange(battle, unit, e)) continue;
    const prev = previewCombat(battle, unit, e, { missile: true });
    const score = attackScore(prev, unit, e);
    if (!best || score > best.score) best = { target: e, score };
  }
  return best;
}

function attackScore(prev, unit, enemy) {
  const deal = prev.toDefender.kills + prev.toDefender.disorder * 0.35;
  const take = prev.toAttacker.kills + prev.toAttacker.disorder * 0.35;
  let s = deal * 2.2 - take * (isHero(unit) ? 3.5 : 1.6);
  if (isHero(enemy)) s += 2;
  if (enemy.entrench) s += 0.3;
  if (typeOf(enemy).class === 'artillery') s += 0.8;
  return s;
}

function standScore(battle, unit, spot) {
  let s = 0;
  const adj = neighbors(spot).filter((n) => {
    const u = battle.unitAt(n.q, n.r);
    return u && u.faction === battle.playerFaction;
  }).length;
  if (adj >= 2 && !isHero(unit)) s += 1.4;
  if (adj >= 2 && isHero(unit)) s -= 1.5;
  return s;
}

function objectivePull(battle, spot, unit) {
  let p = 0;
  for (const c of battle.cells.values()) {
    if (c.principia) p += (unit.faction === 'germania' ? 4 : 1.2) / (1 + hexDistance(spot, c));
    if (c.gate) p += 2 / (1 + hexDistance(spot, c));
    if (c.terrain === 'causeway') p += 1.2 / (1 + hexDistance(spot, c));
    if (c.eagle) p += 2 / (1 + hexDistance(spot, c));
  }
  return p;
}
