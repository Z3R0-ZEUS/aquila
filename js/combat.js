import { hexDistance, neighbors, hexLine } from './hex.js';
import { TERRAIN } from './data/terrain.js';
import { typeOf, effectiveStrength, upgradeKindOf } from './data/units.js';

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function killChance(atkMinusDef) {
  return clamp(0.30 + atkMinusDef * 0.10, 0.14, 0.92);
}

export function disorderChance(atkMinusDef) {
  return clamp(0.22 + atkMinusDef * 0.06, 0.12, 0.62);
}

function has(unit, trait) {
  return typeOf(unit).traits.includes(trait);
}

function cellOf(battle, q, r) {
  return battle.cell(q, r);
}

function terrainOf(battle, unit) {
  const c = cellOf(battle, unit.q, unit.r);
  return TERRAIN[c ? c.terrain : 'clear'];
}

function adjacentEnemies(battle, unit) {
  return neighbors(unit).filter((p) => {
    const u = battle.unitAt(p.q, p.r);
    return u && u.faction !== unit.faction;
  }).length;
}

function auraBonus(battle, unit, kind) {
  let bonus = 0;
  for (const u of battle.units) {
    if (u.strength <= 0) continue;
    if (hexDistance(u, unit) > 1) continue;
    const t = typeOf(u);
    if (kind === 'rome' && t.traits.includes('auraRome') && unit.faction === 'rome') bonus += 1;
    if (kind === 'germania' && t.traits.includes('auraGermania') && unit.faction === 'germania') bonus += 1;
  }
  return bonus;
}

export function canCharge(battle, attacker, defender, isMissile) {
  if (isMissile) return 0;
  const at = typeOf(attacker);
  if (at.charge <= 0) return 0;
  if (attacker.chargedThisTurn) return 0;
  const terr = terrainOf(battle, defender);
  if (terr.noCharge) return 0;
  if (has(attacker, 'cavalry') && terr.cavalryCharge) return at.charge + terr.cavalryCharge;
  if (has(attacker, 'forestCharge') && (terr.id === 'lightForest' || terr.id === 'denseForest')) {
    return at.charge + 1;
  }
  if (has(attacker, 'cavalry') && terr.id === 'clear') return at.charge + 2;
  if (at.charge && terr.id === 'clear') return at.charge;
  return 0;
}

export function combatContext(battle, attacker, defender, opts = {}) {
  const at = typeOf(attacker);
  const dt = typeOf(defender);
  const isMissile = !!opts.missile;
  const aCell = cellOf(battle, attacker.q, attacker.r);
  const dCell = cellOf(battle, defender.q, defender.r);
  const aTerr = TERRAIN[aCell?.terrain || 'clear'];
  const dTerr = TERRAIN[dCell?.terrain || 'clear'];
  const weather = battle.weather;

  const mods = [];
  let atk = isMissile ? at.missileAtk : at.meleeAtk;
  let def = isMissile ? dt.missileDef : dt.meleeDef;

  if (isMissile) {
    atk += dTerr.missileMod;
    if (dTerr.missileMod) mods.push({ label: `${dTerr.name} missile`, val: dTerr.missileMod });
    if (dTerr.downhillMissile && (aCell?.elevation || 0) > (dCell?.elevation || 0)) {
      atk += dTerr.downhillMissile;
      mods.push({ label: 'Downhill', val: dTerr.downhillMissile });
    }
    if (weather === 'rain') {
      atk -= 1;
      mods.push({ label: 'Rain', val: -1 });
    }
    if (has(attacker, 'forestAccuracy')) {
      if (dTerr.id === 'lightForest' || dTerr.id === 'denseForest') {
        atk += 1;
        mods.push({ label: 'Woodland hunters', val: 1 });
      } else if (dTerr.id === 'clear') {
        atk -= 1;
        mods.push({ label: 'Open ground (hunters)', val: -1 });
      }
    }
    if (has(attacker, 'entrenchBreaker')) {
      atk += Math.min(2, defender.entrench);
      if (defender.entrench) mods.push({ label: 'Bolts vs works', val: Math.min(2, defender.entrench) });
    }
  } else {
    def += dTerr.meleeDef;
    if (dTerr.meleeDef) mods.push({ label: `${dTerr.name} defense`, val: dTerr.meleeDef, side: 'def' });
    if (dTerr.germanBonus && defender.faction === 'germania') {
      def += dTerr.germanBonus;
      mods.push({ label: 'Germania woods', val: dTerr.germanBonus, side: 'def' });
    }
    if (has(defender, 'formed') && (dTerr.id === 'denseForest' || dTerr.id === 'marsh')) {
      def -= 2;
      mods.push({ label: 'Formed in bad ground', val: -2, side: 'def' });
    }
    if (has(attacker, 'formed') && (aTerr.id === 'denseForest' || aTerr.id === 'marsh')) {
      atk -= 1;
      mods.push({ label: 'Formed attacking from bad ground', val: -1 });
    }
    if (dTerr.crossing) {
      atk -= 1;
      mods.push({ label: 'Crossing', val: -1 });
    }
  }

  const charge = canCharge(battle, attacker, defender, isMissile);
  if (charge) {
    atk += charge;
    mods.push({ label: 'Charge', val: charge });
  }

  if (attacker.upgrades?.arm) {
    const kind = upgradeKindOf(at);
    if (kind === 'missile' && isMissile) {
      atk += 1;
      mods.push({ label: 'Armed', val: 1 });
    } else if (kind === 'charge' && !isMissile) {
      atk += 1;
      mods.push({ label: 'Armed', val: 1 });
    }
  }
  if (defender.upgrades?.arm) {
    const kind = upgradeKindOf(dt);
    if (kind === 'armor' && !isMissile) {
      def += 1;
      mods.push({ label: 'Armed', val: 1, side: 'def' });
    } else if (kind === 'ward' && isMissile) {
      def += 1;
      mods.push({ label: 'Armed', val: 1, side: 'def' });
    } else if (kind === 'armor' && isMissile) {
      def += 1;
      mods.push({ label: 'Armed', val: 1, side: 'def' });
    }
  }

  if (attacker.experience) {
    atk += Math.floor(attacker.experience / 2);
    if (attacker.experience >= 2) mods.push({ label: 'Experience', val: Math.floor(attacker.experience / 2) });
  }
  if (defender.experience) {
    def += Math.floor(defender.experience / 2);
    if (defender.experience >= 2) mods.push({ label: 'Defender veterans', val: Math.floor(defender.experience / 2), side: 'def' });
  }

  if (defender.testudo) {
    if (isMissile) {
      def += 2;
      mods.push({ label: 'Testudo', val: 2, side: 'def' });
    } else {
      def += 1;
      mods.push({ label: 'Testudo', val: 1, side: 'def' });
    }
  }

  if (defender.entrench && !isMissile) {
    def += defender.entrench;
    mods.push({ label: 'Entrenchment', val: defender.entrench, side: 'def' });
  } else if (defender.entrench && isMissile && !has(attacker, 'entrenchBreaker')) {
    def += Math.ceil(defender.entrench / 2);
    mods.push({ label: 'Entrenchment (vs shot)', val: Math.ceil(defender.entrench / 2), side: 'def' });
  }

  const flanks = adjacentEnemies(battle, defender);
  if (!isMissile && flanks >= 2) {
    atk += flanks - 1;
    mods.push({ label: 'Flanked', val: flanks - 1 });
  }

  const aAura = auraBonus(battle, attacker, attacker.faction === 'rome' ? 'rome' : 'germania');
  if (aAura) {
    atk += aAura;
    mods.push({ label: 'Commander', val: aAura });
  }
  const dAura = auraBonus(battle, defender, defender.faction === 'rome' ? 'rome' : 'germania');
  if (dAura) {
    def += dAura;
    mods.push({ label: 'Enemy commander', val: dAura, side: 'def' });
  }

  if (!attacker.inSupply) {
    atk -= 1;
    mods.push({ label: 'Out of supply', val: -1 });
  }
  if (!defender.inSupply) {
    def -= 1;
    mods.push({ label: 'Defender out of supply', val: -1, side: 'def' });
  }

  if (attacker.hidden && has(attacker, 'ambush')) {
    atk += 1;
    mods.push({ label: 'Ambush', val: 1 });
  }

  if (weather === 'fog' && has(attacker, 'fogFighter')) {
    atk += 1;
    mods.push({ label: 'Night raid', val: 1 });
  }

  let aInit = at.initiative + aAura + (attacker.hidden && has(attacker, 'ambush') ? 2 : 0);
  let dInit = dt.initiative + dAura;
  if (weather === 'fog' && has(attacker, 'fogFighter')) aInit += 1;

  const aStrikes = Math.max(1, effectiveStrength(attacker));
  const dStrikes = Math.max(1, effectiveStrength(defender));

  return {
    isMissile,
    atk,
    def,
    aInit,
    dInit,
    aStrikes,
    dStrikes,
    charge,
    mods,
    diff: atk - def,
    retDiff: (isMissile ? dt.missileAtk : dt.meleeAtk) - (isMissile ? at.missileDef : at.meleeDef),
  };
}

export function expectedLosses(ctx, fromStrikes, diff) {
  const k = killChance(diff);
  const d = disorderChance(diff);
  return {
    kills: fromStrikes * k,
    disorder: fromStrikes * d * (1 - k * 0.35),
    killChance: k,
    disorderChance: d,
  };
}

export function previewCombat(battle, attacker, defender, opts = {}) {
  const ctx = combatContext(battle, attacker, defender, opts);
  const firstStrike = !ctx.isMissile && ctx.aInit - ctx.dInit >= 3;
  const defenderFirst = !ctx.isMissile && ctx.dInit - ctx.aInit >= 3;

  const atkExp = expectedLosses(ctx, ctx.aStrikes, ctx.diff);
  let defStrikes = ctx.dStrikes;
  if (firstStrike) defStrikes = Math.max(0, ctx.dStrikes - Math.round(atkExp.kills));
  const retDiff = returnDiff(battle, attacker, defender, ctx);
  const canReturn = !ctx.isMissile || (hexDistance(attacker, defender) === 1 && typeOf(defender).range > 0 && defender.ammo > 0);
  const noReturn = typeOf(attacker).traits.includes('noMeleeReturn') && ctx.isMissile;
  const defExp = canReturn && !noReturn && !defenderFirst
    ? expectedLosses(ctx, defStrikes, retDiff)
    : { kills: 0, disorder: 0, killChance: 0, disorderChance: 0 };

  let atkOnDefender = atkExp;
  if (defenderFirst && canReturn) {
    const first = expectedLosses(ctx, ctx.dStrikes, retDiff);
    const reduced = Math.max(1, ctx.aStrikes - Math.round(first.kills));
    atkOnDefender = expectedLosses(ctx, reduced, ctx.diff);
    return withRetreatHint({
      ctx,
      firstStrike: false,
      defenderFirst: true,
      toDefender: atkOnDefender,
      toAttacker: first,
      canReturn: true,
    }, defender);
  }

  return withRetreatHint({
    ctx,
    firstStrike,
    defenderFirst: false,
    toDefender: atkOnDefender,
    toAttacker: defExp,
    canReturn: canReturn && !noReturn,
  }, defender);
}

function withRetreatHint(prev, defender) {
  prev.retreat = shouldRetreat(
    { ...defender, strength: Math.max(0, defender.strength - Math.round(prev.toDefender.kills)) },
    prev.toDefender.kills
  );
  return prev;
}

function returnDiff(battle, attacker, defender, ctx) {
  if (ctx.isMissile) {
    const dt = typeOf(defender);
    const at = typeOf(attacker);
    return dt.missileAtk - at.missileDef;
  }
  const swapped = combatContext(battle, defender, attacker, { missile: false });
  return swapped.diff;
}

function rollStrikes(rng, strikes, kChance, dChance) {
  let kills = 0;
  let disorder = 0;
  for (let i = 0; i < strikes; i++) {
    const r = rng();
    if (r < kChance) kills += 1;
    else if (r < kChance + dChance) disorder += 1;
  }
  return { kills, disorder };
}

export function applyHits(unit, kills, disorder) {
  let k = Math.max(0, Math.round(kills));
  k = Math.min(unit.strength, k);
  unit.strength -= k;
  unit.disorder = Math.min(unit.strength, unit.disorder + Math.max(0, Math.round(disorder)));
  if (unit.strength <= 0) {
    unit.strength = 0;
    unit.disorder = 0;
  }
  return k;
}

export function shouldRetreat(unit, incomingKills) {
  const eff = effectiveStrength(unit);
  if (unit.strength <= 0) return 'dead';
  if (incomingKills >= 3 && eff <= 3) return 'rout';
  if (incomingKills >= 2 && eff <= 4) return 'retreat';
  if (unit.disorder >= unit.strength && unit.strength > 0) return 'retreat';
  return null;
}

export function resolveCombat(battle, attacker, defender, opts = {}) {
  const rng = battle.rng;
  const prev = previewCombat(battle, attacker, defender, opts);
  const ctx = prev.ctx;
  const log = [];

  const atkK = killChance(ctx.diff);
  const atkD = disorderChance(ctx.diff);
  const retDff = returnDiff(battle, attacker, defender, ctx);
  const defK = killChance(retDff);
  const defD = disorderChance(retDff);

  let aKills = 0;
  let aDis = 0;
  let dKills = 0;
  let dDis = 0;

  const fire = (from, to, strikes, kc, dc, label) => {
    const { kills, disorder } = rollStrikes(rng, strikes, kc, dc);
    const applied = applyHits(to, kills, disorder);
    log.push(`${label}: ${applied} slain, ${disorder} disordered`);
    return { kills: applied, disorder };
  };

  if (prev.defenderFirst && prev.canReturn) {
    const r = fire(defender, attacker, ctx.dStrikes, defK, defD, `${defender.name} strikes first`);
    dKills = r.kills;
    dDis = r.disorder;
    if (attacker.strength > 0) {
      const r2 = fire(attacker, defender, Math.max(1, ctx.aStrikes - r.kills), atkK, atkD, `${attacker.name} replies`);
      aKills = r2.kills;
      aDis = r2.disorder;
    }
  } else {
    const r = fire(attacker, defender, ctx.aStrikes, atkK, atkD, `${attacker.name} ${ctx.isMissile ? 'looses' : 'charges'}`);
    aKills = r.kills;
    aDis = r.disorder;
    if (prev.canReturn && defender.strength > 0) {
      const strikes = prev.firstStrike ? Math.max(0, ctx.dStrikes - r.kills) : ctx.dStrikes;
      if (strikes > 0) {
        const r2 = fire(defender, attacker, strikes, defK, defD, `${defender.name} returns`);
        dKills = r2.kills;
        dDis = r2.disorder;
      }
    }
  }

  if (ctx.isMissile) {
    attacker.ammo = Math.max(0, attacker.ammo - 1);
  }
  attacker.acted = true;
  attacker.mpRemaining = 0;
  attacker.hidden = false;
  if (!ctx.isMissile && ctx.charge) attacker.chargedThisTurn = true;
  defender.hidden = false;
  defender.entrench = Math.max(0, defender.entrench - (ctx.isMissile ? 0 : 1));

  if (aKills > 0 && attacker.experience < 5 && battle.rng() < 0.35 + aKills * 0.1) {
    attacker.experience += 1;
  }

  const retreat = shouldRetreat(defender, aKills);

  return {
    preview: prev,
    aKills,
    aDis,
    dKills,
    dDis,
    retreat,
    defenderDead: defender.strength <= 0,
    attackerDead: attacker.strength <= 0,
    log,
    overrun: defender.strength <= 0 && (has(attacker, 'overrun') || (has(attacker, 'overrunDisordered') && aDis + aKills >= 4)),
  };
}

export function inMissileRange(battle, attacker, defender) {
  const t = typeOf(attacker);
  if (t.range <= 0 || attacker.ammo <= 0) return false;
  const dist = hexDistance(attacker, defender);
  if (dist < 1 || dist > t.range) return false;
  if (dist === 1 && t.range >= 1) return true;
  return hasLine(battle, attacker, defender);
}

function hasLine(battle, a, b) {
  const line = hexLine(a, b);
  for (let i = 1; i < line.length - 1; i++) {
    const c = battle.cell(line[i].q, line[i].r);
    if (!c) return false;
    if (c.terrain === 'denseForest' || c.terrain === 'oppidum' || c.terrain === 'castra') return false;
    if (battle.unitAt(line[i].q, line[i].r)) return false;
  }
  return true;
}

export function canMelee(attacker, defender) {
  return hexDistance(attacker, defender) === 1;
}
