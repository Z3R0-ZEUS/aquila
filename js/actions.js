import { neighbors, hexDistance } from './hex.js';
import { TERRAIN } from './data/terrain.js';
import { typeOf, UNIT_TYPES, SHOP_TYPES, GERMAN_SHOP_TYPES, isHero } from './data/units.js';

export function shopTypesFor(faction) {
  return faction === 'germania' ? GERMAN_SHOP_TYPES : SHOP_TYPES;
}

export function shopCatalogFor(faction) {
  return shopTypesFor(faction).map((id) => UNIT_TYPES[id]);
}

export function skirmishTreasury(difficulty) {
  if (difficulty === 'recruit') return 90;
  if (difficulty === 'veteran') return 35;
  return 60;
}

/** Prestige per missing strength point. Heroes use a flat levy. */
export function reinforcePointCost(unit) {
  const t = typeOf(unit);
  if (!t) return 99;
  if (t.unique || t.cost <= 0) return 5;
  return Math.max(3, Math.round(t.cost / t.maxStrength));
}

export function reinforceCap(unit) {
  const t = typeOf(unit);
  const starCap = t.overstrength || t.maxStrength;
  return Math.min(unit.maxStrength || starCap, starCap);
}

export function missingStrength(unit) {
  return Math.max(0, reinforceCap(unit) - unit.strength);
}

export function reinforceTotalCost(unit, elite = false) {
  const n = missingStrength(unit);
  if (n <= 0) return 0;
  const each = reinforcePointCost(unit) * (elite ? 2 : 1);
  return n * each;
}

export function affordablePoints(unit, treasury, elite = false) {
  const each = reinforcePointCost(unit) * (elite ? 2 : 1);
  if (each <= 0) return 0;
  return Math.min(missingStrength(unit), Math.floor(treasury / each));
}

export function adjacentEnemyCount(battle, unit) {
  let n = 0;
  for (const p of neighbors(unit)) {
    const u = battle.unitAt(p.q, p.r);
    if (u && u.faction !== unit.faction && u.strength > 0) n += 1;
  }
  return n;
}

export function isForestHex(battle, unit) {
  const terr = battle.cell(unit.q, unit.r)?.terrain;
  return terr === 'lightForest' || terr === 'denseForest';
}

export function canAct(battle, unit) {
  if (!unit || unit.strength <= 0 || unit.extracted) return false;
  if (unit.faction !== battle.playerFaction) return false;
  if (battle.result) return false;
  if (battle.phase === 'deploy') return true;
  if (battle.phase !== 'player') return false;
  return !unit.acted;
}

export function canReinforce(battle, unit, elite = false) {
  if (!canAct(battle, unit)) return { ok: false, why: 'This cohort has already had its orders.' };
  if (missingStrength(unit) <= 0) return { ok: false, why: 'The ranks are already full.' };
  if (battle.phase === 'player') {
    if (!unit.inSupply) return { ok: false, why: 'Replacements need a supply line.' };
    if (adjacentEnemyCount(battle, unit) > 0) return { ok: false, why: 'Cannot draft with the enemy in contact.' };
  }
  const pts = affordablePoints(unit, battle.treasury, elite);
  if (pts <= 0) return { ok: false, why: 'Not enough honors for a draft.' };
  return { ok: true, points: pts, cost: pts * reinforcePointCost(unit) * (elite ? 2 : 1) };
}

export function canResupply(battle, unit) {
  if (!canAct(battle, unit) || battle.phase !== 'player') return { ok: false };
  const t = typeOf(unit);
  if (!t.ammo) return { ok: false, why: 'This unit carries no ammunition.' };
  if (unit.ammo >= t.ammo) return { ok: false, why: 'Quivers are already full.' };
  if (!unit.inSupply) return { ok: false, why: 'The wagons cannot reach them.' };
  return { ok: true };
}

export function canForcedMarch(battle, unit) {
  if (!canAct(battle, unit) || battle.phase !== 'player') return { ok: false };
  if (unit.moved || unit.forcedMarch) return { ok: false, why: 'The column has already marched.' };
  if (unit.testudo) return { ok: false, why: 'Testudo cannot force the pace.' };
  return { ok: true };
}

export function canDig(battle, unit) {
  if (!canAct(battle, unit) || battle.phase !== 'player') return { ok: false };
  if (unit.moved) return { ok: false, why: 'They must stand to throw up works.' };
  const terr = TERRAIN[battle.cell(unit.q, unit.r)?.terrain] || TERRAIN.clear;
  const cap = terr.entrenchCap ?? 2;
  if (unit.entrench >= cap) return { ok: false, why: 'The ground will take no more works.' };
  return { ok: true, cap };
}

export function mergeDonors(battle, unit) {
  if (!canAct(battle, unit) || isHero(unit)) return [];
  if (battle.phase !== 'player' && battle.phase !== 'deploy') return [];
  const room = reinforceCap(unit) - unit.strength;
  if (room <= 0) return [];
  const out = [];
  for (const p of neighbors(unit)) {
    const d = battle.unitAt(p.q, p.r);
    if (!d || d.faction !== unit.faction || d.strength <= 0) continue;
    if (d.typeId !== unit.typeId || isHero(d) || d.id === unit.id) continue;
    out.push(d);
  }
  return out;
}

export function canRally(battle, unit) {
  if (!canAct(battle, unit) || battle.phase !== 'player') return { ok: false };
  if (!typeOf(unit).traits.includes('hero')) return { ok: false };
  const friends = battle.units.filter(
    (n) => n.faction === unit.faction && n.strength > 0 && n.disorder > 0 && hexDistance(n, unit) <= 1
  );
  if (!friends.length) return { ok: false, why: 'No shaken men in earshot.' };
  return { ok: true, friends };
}

export function canAmbush(battle, unit) {
  if (!canAct(battle, unit) || battle.phase !== 'player') return { ok: false };
  if (!typeOf(unit).traits.includes('ambush')) return { ok: false };
  if (unit.hidden) return { ok: false, why: 'Already lying in wait.' };
  if (!isForestHex(battle, unit)) return { ok: false, why: 'Ambush needs timber.' };
  if (adjacentEnemyCount(battle, unit) > 0) return { ok: false, why: 'The enemy is already on them.' };
  return { ok: true };
}

export function canScout(battle, unit) {
  if (!canAct(battle, unit) || battle.phase !== 'player') return { ok: false };
  if (!typeOf(unit).traits.includes('recon')) return { ok: false };
  return { ok: true };
}

export function canTestudo(battle, unit) {
  if (!canAct(battle, unit) || battle.phase !== 'player') return { ok: false };
  if (!typeOf(unit).traits.includes('formed')) return { ok: false };
  if (unit.moved) return { ok: false };
  return { ok: true };
}
