import { hexDistance, offsetToAxial, neighbors } from './hex.js';
import { killChance, previewCombat, resolveCombat, applyHits, inMissileRange } from './combat.js';
import { Battle, restoreBattle } from './game.js';
import { SCENARIOS } from './data/scenarios.js';
import { defaultCore } from './campaign.js';
import { makeUnit } from './data/units.js';
import { reachable } from './pathfind.js';
import { runAiTurn } from './ai.js';
import { reinforcePointCost, canReinforce, affordablePoints } from './actions.js';

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
  const b = new Battle(sc, { core: defaultCore(), seed: 1, skipDeploy: true });
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
  assert('hits match the roll', doomed.strength === 1);
  applyHits(doomed, 1, 0);
  assert('wounded unit can be destroyed', doomed.strength === 0);

  const weak = makeUnit('warband', { strength: 4 });
  const slain = applyHits(weak, 1, 0);
  assert('one kill is one kill', slain === 1 && weak.strength === 3);

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
    const bat = new Battle(s, { core: defaultCore(), seed: 42, skipDeploy: true });
    assert(`${s.id} has cells`, bat.cells.size > 20);
    assert(`${s.id} units placed`, bat.units.length >= 4);
  }
  assert('six campaign fields', SCENARIOS.length === 6);
  assert('angrivarian present', SCENARIOS.some((s) => s.id === 'angrivarian'));

  const ger = new Battle(SCENARIOS[0], { core: defaultCore(), playerFaction: 'germania', seed: 2, skipDeploy: true });
  assert('german player faction', ger.playerFaction === 'germania' && ger.enemyFaction === 'rome');
  const gUnit = ger.units.find((u) => u.faction === 'germania' && u.strength > 0);
  ger.select(gUnit.id);
  assert('german unit selectable', ger.selected && ger.selected.faction === 'germania');

  const snap = new Battle(SCENARIOS[0], { core: defaultCore(), seed: 9, skipDeploy: true });
  const again = restoreBattle(snap.toJSON());
  assert('restore keeps units', again.units.length === snap.units.length);
  assert('restore keeps turn', again.turn === snap.turn);

  const play = new Battle(SCENARIOS[0], { core: defaultCore(), seed: 7, skipDeploy: true });
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

  const fight = new Battle(SCENARIOS[4], { core: defaultCore(), seed: 3, skipDeploy: true });
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

  const dep = new Battle(SCENARIOS[0], { core: defaultCore(), seed: 11, honors: 80 });
  assert('starts in deploy', dep.phase === 'deploy');
  assert('deploy hexes exist', dep.deployKeys.size > 4);
  const empty = dep.emptyDeployHexes();
  assert('empty deploy hexes', empty.length > 0);
  const bought = dep.startPurchase('auxilia') && dep.placePurchase(empty[0].q, empty[0].r);
  assert('purchase during deploy', !!bought && dep.treasury === 80 - 50);
  const hired = dep.units.find((u) => u.hiredThisBattle);
  assert('hired unit on map', !!hired && hired.typeId === 'auxilia');
  const romeLine = dep.units.find((u) => u.faction === 'rome' && u.typeId === 'legion');
  const dest = dep.emptyDeployHexes()[0];
  if (romeLine && dest) {
    const shifted = dep.tryDeployMove(romeLine, dest.q, dest.r);
    assert('reposition in deploy', !!shifted && romeLine.q === dest.q);
  } else {
    assert('reposition in deploy', true);
  }
  assert('cannot attack in deploy', dep.tryAttack(romeLine, dep.units.find((u) => u.faction === 'germania'), {}) === null);
  assert('begin battle', dep.beginBattle() && dep.phase === 'player');

  const refBat = new Battle(SCENARIOS[0], { core: defaultCore(), seed: 12, honors: 80, skipDeploy: true });
  const wounded = refBat.units.find((u) => u.faction === 'rome' && u.typeId === 'legion' && u.strength > 0);
  assert('reinforce target', !!wounded);
  wounded.strength = 6;
  wounded.experience = 2;
  wounded.inSupply = true;
  wounded.acted = false;
  const nearEnemy = refBat.units.find((u) => u.faction === 'germania' && u.strength > 0);
  if (nearEnemy) {
    const holdQ = wounded.q;
    const holdR = wounded.r;
    wounded.q = nearEnemy.q + 3;
    wounded.r = nearEnemy.r + 3;
    if (!refBat.cell(wounded.q, wounded.r)) {
      wounded.q = holdQ;
      wounded.r = holdR;
    }
  }
  const check = canReinforce(refBat, wounded, false);
  if (check.ok) {
    const beforeXp = wounded.experience;
    const ok = refBat.reinforceUnit(wounded, false);
    assert('regular reinforce spends honors', ok && refBat.treasury < 80);
    assert('regular reinforce fills ranks', wounded.strength > 6);
    assert('regular reinforce dilutes experience', wounded.experience <= beforeXp);
    assert('reinforce spends the action', wounded.acted === true);
  } else {
    const isolated = makeUnit('legion', { q: 2, r: 4, strength: 6, experience: 2 });
    isolated.inSupply = true;
    refBat.units.push(isolated);
    isolated.q = 2;
    isolated.r = 4;
    const ok = refBat.reinforceUnit(isolated, false);
    assert('regular reinforce spends honors', ok);
    assert('regular reinforce fills ranks', isolated.strength > 6);
    assert('regular reinforce dilutes experience', isolated.experience < 2);
    assert('reinforce spends the action', isolated.acted === true);
  }

  const eliteBat = new Battle(SCENARIOS[0], { core: defaultCore(), seed: 13, honors: 80, skipDeploy: true });
  const vet = makeUnit('legion', { q: 2, r: 4, strength: 7, experience: 3, name: 'Cohors Test' });
  vet.inSupply = true;
  eliteBat.units.push(vet);
  const eliteOk = eliteBat.reinforceUnit(vet, true);
  assert('elite reinforce keeps stars', eliteOk && vet.experience === 3 && vet.strength > 7);

  const contact = new Battle(SCENARIOS[0], { core: defaultCore(), seed: 14, honors: 80, skipDeploy: true });
  const a = makeUnit('legion', { q: 1, r: 1, strength: 5 });
  const press = makeUnit('warband', { q: 2, r: 1, strength: 8 });
  a.inSupply = true;
  contact.units.push(a, press);
  assert('no reinforce in contact', canReinforce(contact, a, false).ok === false);

  const ammoBat = new Battle(SCENARIOS[0], { core: defaultCore(), seed: 15, honors: 40, skipDeploy: true });
  const sag = ammoBat.units.find((u) => u.typeId === 'sagittarii' || u.typeId === 'slingers') || makeUnit('sagittarii', { q: 2, r: 3 });
  if (!ammoBat.units.includes(sag)) {
    sag.inSupply = true;
    ammoBat.units.push(sag);
  }
  sag.ammo = 0;
  sag.acted = false;
  sag.inSupply = true;
  assert('resupply empty quivers', ammoBat.resupplyUnit(sag) && sag.ammo > 0 && sag.acted);

  const marcher = makeUnit('auxilia', { q: 3, r: 4 });
  marcher.inSupply = true;
  ammoBat.units.push(marcher);
  const mp = marcher.mpRemaining;
  assert('forced march', ammoBat.forcedMarchUnit(marcher) && marcher.mpRemaining === mp + 2 && marcher.disorder >= 1);
  const dummyFoe = ammoBat.units.find((u) => u.faction === 'germania' && u.strength > 0);
  assert('forced march cannot attack', !dummyFoe || ammoBat.tryAttack(marcher, dummyFoe) === null);

  const digger = makeUnit('legion', { q: 2, r: 4 });
  digger.inSupply = true;
  ammoBat.units.push(digger);
  assert('dig works', ammoBat.digIn(digger) && digger.entrench >= 1 && digger.acted);

  const host = makeUnit('auxilia', { q: 3, r: 5, strength: 4, experience: 2, name: 'Host' });
  const donor = makeUnit('auxilia', { q: 4, r: 5, strength: 3, experience: 0, name: 'Donor' });
  host.inSupply = true;
  donor.inSupply = true;
  ammoBat.units.push(host, donor);
  assert('merge absorbs', ammoBat.mergeUnits(host, donor) && host.strength === 7 && donor.strength === 0);

  const hero = ammoBat.units.find((u) => u.typeId === 'germanicus');
  if (hero) {
    const shaken = makeUnit('legion', { q: hero.q, r: hero.r });
    const n = neighbors(hero)[0];
    shaken.q = n.q;
    shaken.r = n.r;
    shaken.disorder = 2;
    shaken.inSupply = true;
    ammoBat.units.push(shaken);
    hero.acted = false;
    assert('hero rally', ammoBat.rallyUnit(hero) && shaken.disorder === 1);
  } else {
    assert('hero rally', true);
  }

  assert('point cost positive', reinforcePointCost(makeUnit('legion')) >= 3);
  assert('affordable points respect purse', affordablePoints(makeUnit('legion', { strength: 1 }), 8) >= 1);

  const losBat = new Battle(SCENARIOS[0], { core: defaultCore(), seed: 21, skipDeploy: true });
  const bow = makeUnit('sagittarii', { q: 0, r: 0, ammo: 3 });
  const screened = makeUnit('warband', { q: 2, r: 0 });
  const close = makeUnit('warband', { q: 1, r: 0 });
  bow.inSupply = true;
  losBat.units.push(bow, screened, close);
  const mid = losBat.cell(1, 0);
  if (mid) mid.terrain = 'denseForest';
  assert('no missile through timber', inMissileRange(losBat, bow, screened) === false);
  assert('adjacent missile still legal', inMissileRange(losBat, bow, close) === true);

  const rngBat = new Battle(SCENARIOS[0], { core: defaultCore(), seed: 33, skipDeploy: true });
  rngBat.rng();
  rngBat.rng();
  const rngAgain = restoreBattle(rngBat.toJSON());
  const twin = new Battle(SCENARIOS[0], { core: defaultCore(), seed: 33, skipDeploy: true });
  twin.rng();
  twin.rng();
  assert('restore continues rng', rngAgain.rng() === twin.rng());

  const fatCore = defaultCore();
  while (fatCore.length < 12) {
    fatCore.push({
      id: `core-extra-${fatCore.length}`,
      typeId: 'auxilia',
      name: `Extra ${fatCore.length}`,
      strength: 10,
      maxStrength: 10,
      experience: 0,
    });
  }
  const fat = new Battle(SCENARIOS[0], { core: fatCore, seed: 4, skipDeploy: true });
  assert('overflow core is placed', fat.units.filter((u) => u.core).length >= 12);

  const tribes = new Battle(SCENARIOS[1], { core: defaultCore(), playerFaction: 'germania', seed: 5, skipDeploy: true });
  const romans = tribes.units.filter((u) => u.faction === 'rome' && u.strength > 0);
  tribes.flags.romeStart = romans.length;
  romans.forEach((u, i) => { if (i > 0) u.strength = 0; });
  tribes.updateObjectives();
  tribes.checkEnd();
  assert('tribes can win chatti without burn', tribes.result && tribes.result.kind !== 'defeat');

  const pont = new Battle(SCENARIOS[2], { core: defaultCore(), playerFaction: 'germania', seed: 6, skipDeploy: true });
  const band = pont.units.find((u) => u.faction === 'germania' && u.strength > 0);
  const exitHex = [...pont.cells.values()].find((c) => c.extract);
  assert('pontes has extract hex', !!exitHex && !!band);
  if (band && exitHex) {
    band.q = exitHex.q;
    band.r = exitHex.r;
    pont.checkSpecialHex(band);
    assert('tribes do not extract on pontes', band.strength > 0 && !band.extracted);
  }

  const ov = new Battle(SCENARIOS[4], { core: defaultCore(), seed: 8, skipDeploy: true });
  const horse = makeUnit('equites', { q: 5, r: 5 });
  const prey = makeUnit('warband', { q: 6, r: 5, strength: 1 });
  horse.inSupply = true;
  ov.units.push(horse, prey);
  ov.rng = () => 0.01;
  ov.tryAttack(horse, prey, { missile: false });
  assert('overrun occupies the hex', horse.q === 6 && horse.r === 5 && prey.strength === 0);

  const zocBat = new Battle(SCENARIOS[0], { core: defaultCore(), seed: 10, skipDeploy: true });
  const walker = makeUnit('auxilia', { q: 2, r: 5 });
  walker.mpRemaining = 8;
  const presser = makeUnit('warband', { q: 3, r: 5 });
  zocBat.units.push(walker, presser);
  const leave = reachable(zocBat, walker).hexes;
  assert('can leave a zoc', leave.length > 0);

  const idSnap = new Battle(SCENARIOS[0], { core: defaultCore(), seed: 11, skipDeploy: true });
  const restored = restoreBattle(idSnap.toJSON());
  const liveIds = new Set(restored.units.map((u) => u.id));
  const freshHire = makeUnit('auxilia', { q: 0, r: 0 });
  assert('restore does not reuse live ids', !liveIds.has(freshHire.id));

  const failed = results.filter((r) => !r.ok);
  return { results, failed, passed: results.length - failed.length };
}
