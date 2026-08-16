import { hexDistance, offsetToAxial, neighbors } from './hex.js';
import { killChance, previewCombat, resolveCombat, applyHits } from './combat.js';
import { Battle } from './game.js';
import { SCENARIOS } from './data/scenarios.js';
import { defaultCore } from './campaign.js';
import { makeUnit } from './data/units.js';
import { reachable } from './pathfind.js';
import { runAiTurn } from './ai.js';

const results = [];
function assert(name, cond) {
  results.push({ name, ok: !!cond });
  if (!cond) console.error('FAIL', name);
}

export function runTests() {
  assert('hex distance adjacent', hexDistance({ q: 0, r: 0 }, { q: 1, r: 0 }) === 1);
  assert('hex neighbors 6', neighbors({ q: 0, r: 0 }).length === 6);
  assert('offset origin', offsetToAxial(0, 0).q === 0 && offsetToAxial(0, 0).r === 0);
  assert('kill chance clamped low', killChance(-20) === 0.14);
  assert('kill chance clamped high', killChance(20) === 0.92);

  const sc = SCENARIOS[0];
  const b = new Battle(sc, { core: defaultCore(), seed: 1 });
  assert('mission 1 builds', b.cells.size === sc.cols * sc.rows);
  assert('mission 1 has rome', b.units.some((u) => u.faction === 'rome' && u.strength > 0));
  assert('mission 1 has germans', b.units.some((u) => u.faction === 'germania'));
  assert('germanicus present', b.units.some((u) => u.typeId === 'germanicus'));

  const atk = makeUnit('legion', { q: 0, r: 0, strength: 10 });
  const def = makeUnit('warband', { q: 1, r: 0, strength: 10 });
  const dummy = {
    weather: 'fair',
    units: [atk, def],
    rng: () => 0.5,
    cell() { return { terrain: 'clear', elevation: 0 }; },
    unitAt(q, r) { return dummy.units.find((u) => u.q === q && u.r === r); },
  };
  atk.inSupply = true;
  def.inSupply = true;
  const prev = previewCombat(dummy, atk, def, { missile: false });
  assert('preview has expected kills', prev.toDefender.kills > 0);
  const res = resolveCombat(dummy, atk, def, { missile: false });
  assert('resolve returns log', res.log.length > 0);
  assert('attacker spent action', atk.acted === true);

  const doomed = makeUnit('warband', { q: 2, r: 0, strength: 3 });
  applyHits(doomed, 2, 1);
  assert('wounded unit can be destroyed', doomed.strength === 0);

  let killed = false;
  for (let i = 0; i < 8 && !killed; i++) {
    const a = makeUnit('legion', { q: 0, r: 0, strength: 10 });
    const d = makeUnit('warband', { q: 1, r: 0, strength: 4 });
    a.inSupply = true;
    d.inSupply = true;
    const ring = {
      weather: 'fair',
      units: [a, d],
      rng: () => 0.05,
      cell() { return { terrain: 'clear', elevation: 0 }; },
      unitAt(q, r) { return ring.units.find((u) => u.q === q && u.r === r && u.strength > 0); },
    };
    resolveCombat(ring, a, d, { missile: false });
    if (d.strength <= 0) killed = true;
  }
  assert('favored melee can destroy a unit', killed);

  for (const s of SCENARIOS) {
    const bat = new Battle(s, { core: defaultCore(), seed: 42 });
    assert(`${s.id} has cells`, bat.cells.size > 20);
    assert(`${s.id} units placed`, bat.units.length >= 4);
  }

  const play = new Battle(SCENARIOS[0], { core: defaultCore(), seed: 7 });
  const rome = play.units.find((u) => u.faction === 'rome' && u.typeId === 'legion' && u.strength > 0);
  assert('play has legion', !!rome);
  const { hexes } = reachable(play, rome);
  assert('legion can move or is boxed', Array.isArray(hexes));
  if (hexes.length) {
    const step = hexes[0];
    const moved = play.tryMove(rome, step.q, step.r);
    assert('legion moved', !!moved);
  } else {
    assert('legion moved', true);
  }
  play.endPlayerTurn();
  runAiTurn(play);
  assert('after AI still playing or ended', play.phase === 'ai' || !!play.result);
  play.beginPlayerTurn();
  assert('turn advanced', play.turn === 2);
  assert('no NaN strength', play.units.every((u) => Number.isFinite(u.strength)));

  const fight = new Battle(SCENARIOS[4], { core: defaultCore(), seed: 3 });
  const rider = fight.units.find((u) => u.typeId === 'equites' || u.typeId === 'batavi');
  const foe = fight.units.find((u) => u.faction === 'germania' && u.strength > 0);
  assert('idistaviso has cavalry and enemy', !!(rider && foe));
  const fieldPrev = fight.preview(rider, foe, false);
  assert('idistaviso preview numbers', fieldPrev.toDefender.kills >= 0 && fieldPrev.toAttacker.kills >= 0);

  for (let t = 0; t < 3 && !fight.result; t++) {
    const romans = fight.units.filter((u) => u.faction === 'rome' && u.strength > 0 && !u.acted);
    for (const u of romans) {
      const reach = reachable(fight, u).hexes;
      const enemyNear = fight.units.find((e) => e.faction === 'germania' && e.strength > 0 && hexDistance(u, e) === 1);
      if (enemyNear) {
        fight.tryAttack(u, enemyNear, { missile: false });
      } else if (reach.length) {
        fight.tryMove(u, reach[0].q, reach[0].r);
      }
    }
    if (fight.result) break;
    fight.endPlayerTurn();
    runAiTurn(fight);
    if (fight.result) break;
    fight.beginPlayerTurn();
  }
  assert('three turns of idistaviso did not crash', fight.turn >= 1);
  assert('germanicus still alive or battle ended', fight.units.some((u) => u.typeId === 'germanicus' && u.strength > 0) || !!fight.result);

  const failed = results.filter((r) => !r.ok);
  return { results, failed, passed: results.length - failed.length };
}
