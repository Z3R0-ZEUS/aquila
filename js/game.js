import { key, neighbors, hexDistance, offsetToAxial } from './hex.js';
import { mulberry32, hashSeed } from './rng.js';
import { TERRAIN, CHAR_TERRAIN, moveCost } from './data/terrain.js';
import { typeOf, makeUnit, resetUnitIds, isHero, effectiveStrength, UNIT_TYPES } from './data/units.js';
import { reachable, reconstructPath, attackTargets } from './pathfind.js';
import { previewCombat, resolveCombat, inMissileRange, canMelee } from './combat.js';
import { markSupply, applyAttrition } from './supply.js';
import { SCENARIOS } from './data/scenarios.js';
import { MAX_SLOTS } from './campaign.js';
import {
  shopTypesFor,
  skirmishTreasury,
  reinforcePointCost,
  reinforceCap,
  missingStrength,
  affordablePoints,
  adjacentEnemyCount,
  canReinforce,
  canResupply,
  canForcedMarch,
  canDig,
  mergeDonors,
  canRally,
  canAmbush,
  canScout,
  canTestudo,
  canAct,
} from './actions.js';

export class Battle {
  constructor(scenario, opts = {}) {
    this.scenario = scenario;
    this.cols = scenario.cols;
    this.rows = scenario.rows;
    this.weather = scenario.weather || 'fair';
    this.turn = 1;
    this.maxTurns = scenario.maxTurns || 16;
    this.phase = opts.skipDeploy ? 'player' : 'deploy';
    this.cells = new Map();
    this.units = [];
    this.selectedId = null;
    this.log = [];
    this.anim = null;
    this.result = null;
    this.flags = { ...(scenario.flags || {}) };
    this.honorsEarned = 0;
    this.casualties = { rome: 0, germania: 0 };
    this.extracted = [];
    this.seed = opts.seed || (Date.now() % 1e9);
    this.rng = mulberry32(this.seed);
    this.coreSnapshot = opts.core || [];
    this.playerFaction = opts.playerFaction || 'rome';
    this.enemyFaction = this.playerFaction === 'rome' ? 'germania' : 'rome';
    this.difficulty = opts.difficulty || 'seasoned';
    this.mode = opts.mode || 'campaign';
    this.lastMove = null;
    this.treasury = opts.honors ?? (this.mode === 'skirmish' ? skirmishTreasury(this.difficulty) : 0);
    this.startingTreasury = this.treasury;
    this.deployKeys = new Set();
    this.pendingBuy = null;
    this.objectives = this.buildObjectives(scenario);
    this._idSeq = 1;
    this.buildMap(scenario);
    if (opts.restore) this.restore(opts.restore);
    else {
      this.placeUnits(scenario, opts);
      this.applyDifficulty();
      this.buildDeployZone();
    }
    markSupply(this);
    if (!opts.restore) {
      if (this.phase === 'deploy') this.pushLog(`Deployment — ${scenario.title}. Place the line, then begin.`);
      else this.pushLog(`Turn 1 — ${scenario.title}. Weather: ${this.weather}.`);
    }
  }

  buildObjectives(scenario) {
    if (this.playerFaction === 'rome') {
      return (scenario.objectives || []).map((o) => ({ ...o, done: false }));
    }
    const hero = (scenario.units || []).find((u) => u.typeId === 'arminius') ? 'arminius' : 'nobles';
    const objs = [
      { id: 'rout', type: 'routArmy', required: true, text: 'Break the Roman host (≤35% remaining)', done: false },
      { id: 'hero', type: 'survive', unit: hero, required: true, text: 'Your chieftain must live', done: false },
    ];
    if (scenario.failIf) {
      objs.push({
        id: 'seize',
        type: 'occupy',
        col: scenario.failIf.col,
        row: scenario.failIf.row,
        required: false,
        text: 'Seize their camp',
        done: false,
      });
    }
    if ((scenario.objectives || []).some((o) => o.type === 'eagle')) {
      objs.push({ id: 'deny', type: 'denyEagle', required: false, text: 'Keep the eagle from Rome', done: false });
    }
    return objs;
  }

  cell(q, r) {
    return this.cells.get(key(q, r));
  }

  unitAt(q, r) {
    return this.units.find((u) => u.strength > 0 && u.q === q && u.r === r);
  }

  unitById(id) {
    return this.units.find((u) => u.id === id);
  }

  get selected() {
    return this.selectedId ? this.unitById(this.selectedId) : null;
  }

  buildMap(scenario) {
    const lines = scenario.map.trim().split('\n').map((l) => l.trimEnd());
    for (let row = 0; row < this.rows; row++) {
      const line = lines[row] || '';
      for (let col = 0; col < this.cols; col++) {
        const ch = (line[col] || 'c').toLowerCase();
        const terrain = CHAR_TERRAIN[ch] || 'clear';
        const { offsetToAxial } = axial();
        const { q, r } = offsetToAxial(col, row);
        const c = {
          q,
          r,
          col,
          row,
          terrain,
          elevation: terrain === 'hill' || terrain === 'oppidum' ? 1 : 0,
          supplySource: false,
          germanSupply: false,
          extract: false,
          eagle: false,
          grave: false,
          gate: false,
          principia: false,
          burned: false,
        };
        this.cells.set(key(q, r), c);
      }
    }
    for (const m of scenario.markers || []) {
      const { offsetToAxial } = axial();
      const { q, r } = offsetToAxial(m.col, m.row);
      const c = this.cell(q, r);
      if (!c) continue;
      Object.assign(c, m.props || {});
      if (m.terrain) c.terrain = m.terrain;
    }
  }

  placeUnits(scenario, opts) {
    resetUnitIds(1);
    for (const p of scenario.units || []) {
      if (p.corePlaceholder) continue;
      const { offsetToAxial } = axial();
      const { q, r } = offsetToAxial(p.col, p.row);
      const spot = this.findEmpty(q, r) || { q, r };
      const u = makeUnit(p.typeId, {
        q: spot.q,
        r: spot.r,
        name: p.name,
        core: false,
        strength: p.strength,
        experience: p.experience,
        entrench: p.entrench,
        hidden: p.hidden,
      });
      this.units.push(u);
    }
    const core = opts.core || [];
    const corePlacements = (scenario.coreSlots || []).slice();
    let lastSpot = null;
    for (let i = 0; i < core.length; i++) {
      const cu = core[i];
      let spot = null;
      const slot = corePlacements[i];
      if (slot) {
        const { q, r } = offsetToAxial(slot.col, slot.row);
        spot = this.findEmpty(q, r);
      }
      if (!spot && lastSpot) spot = this.findEmpty(lastSpot.q, lastSpot.r);
      if (!spot) spot = this.findAnyEmpty();
      if (!spot) {
        this.pushLog(`${cu.name || cu.typeId} could not take the field.`);
        continue;
      }
      lastSpot = spot;
      const u = makeUnit(cu.typeId, {
        ...cu,
        q: spot.q,
        r: spot.r,
        core: this.playerFaction === 'rome',
        hidden: false,
      });
      this.units.push(u);
    }
  }

  findAnyEmpty() {
    for (const c of this.cells.values()) {
      if (TERRAIN[c.terrain]?.impassable) continue;
      if (!this.unitAt(c.q, c.r)) return { q: c.q, r: c.r };
    }
    return null;
  }

  applyDifficulty() {
    const enemy = this.enemyFaction;
    for (const u of this.units) {
      if (u.faction !== enemy || u.strength <= 0) continue;
      if (this.difficulty === 'recruit') {
        u.strength = Math.max(4, u.strength - 2);
      } else if (this.difficulty === 'veteran') {
        u.strength = Math.min(u.maxStrength + 1, u.strength + 1);
        u.maxStrength = Math.max(u.maxStrength, u.strength);
      }
    }
  }

  findEmpty(q, r) {
    if (!this.unitAt(q, r) && this.cell(q, r) && !TERRAIN[this.cell(q, r).terrain]?.impassable) {
      return { q, r };
    }
    const seen = new Set([key(q, r)]);
    const qe = [{ q, r }];
    while (qe.length) {
      const cur = qe.shift();
      for (const n of neighbors(cur)) {
        const k = key(n.q, n.r);
        if (seen.has(k)) continue;
        seen.add(k);
        const c = this.cell(n.q, n.r);
        if (!c || TERRAIN[c.terrain]?.impassable) continue;
        if (!this.unitAt(n.q, n.r)) return { q: n.q, r: n.r };
        qe.push(n);
      }
    }
    return null;
  }

  buildDeployZone() {
    const keys = new Set();
    const add = (q, r) => {
      const c = this.cell(q, r);
      if (!c || TERRAIN[c.terrain]?.impassable) return;
      keys.add(key(q, r));
    };
    if (this.playerFaction === 'rome') {
      for (const slot of this.scenario.coreSlots || []) {
        const { q, r } = offsetToAxial(slot.col, slot.row);
        add(q, r);
        for (const n of neighbors({ q, r })) add(n.q, n.r);
      }
    }
    for (const u of this.units) {
      if (u.faction !== this.playerFaction || u.strength <= 0) continue;
      add(u.q, u.r);
      for (const n of neighbors(u)) add(n.q, n.r);
    }
    this.deployKeys = keys;
  }

  inDeploy(q, r) {
    return this.deployKeys.has(key(q, r));
  }

  emptyDeployHexes() {
    const out = [];
    for (const k of this.deployKeys) {
      const [q, r] = k.split(',').map(Number);
      if (!this.unitAt(q, r)) out.push({ q, r });
    }
    return out;
  }

  coreSlotsUsed() {
    return this.units
      .filter((u) => u.core && (u.strength > 0 || u.extracted))
      .reduce((n, u) => n + (typeOf(u).slots || 1), 0);
  }

  canHireAsCore(typeId) {
    if (this.mode !== 'campaign' || this.playerFaction !== 'rome') return false;
    const t = UNIT_TYPES[typeId];
    if (!t) return false;
    return this.coreSlotsUsed() + (t.slots || 1) <= MAX_SLOTS;
  }

  beginBattle() {
    if (this.phase !== 'deploy' || this.result) return false;
    this.phase = 'player';
    this.pendingBuy = null;
    this.lastMove = null;
    this.selectedId = null;
    markSupply(this);
    this.revealVision();
    this.updateObjectives();
    this.pushLog(`Turn 1 — ${this.scenario.title}. Weather: ${weatherName(this.weather)}. The line is dressed.`);
    return true;
  }

  tryDeployMove(unit, q, r) {
    if (this.phase !== 'deploy' || !unit || unit.faction !== this.playerFaction) return null;
    if (!this.inDeploy(q, r)) return null;
    const occ = this.unitAt(q, r);
    if (occ && occ.id !== unit.id) {
      if (occ.faction !== this.playerFaction) return null;
      const from = { q: unit.q, r: unit.r };
      occ.q = unit.q;
      occ.r = unit.r;
      unit.q = q;
      unit.r = r;
      return { from, to: { q, r }, swapped: occ };
    }
    if (occ) return null;
    const from = { q: unit.q, r: unit.r };
    unit.q = q;
    unit.r = r;
    return { from, to: { q, r } };
  }

  startPurchase(typeId) {
    if (this.phase !== 'deploy') return false;
    const t = UNIT_TYPES[typeId];
    if (!t || t.faction !== this.playerFaction) return false;
    if (!shopTypesFor(this.playerFaction).includes(typeId)) return false;
    if (this.treasury < t.cost) return false;
    if (!this.emptyDeployHexes().length) return false;
    this.pendingBuy = typeId;
    return true;
  }

  cancelPurchase() {
    this.pendingBuy = null;
  }

  placePurchase(q, r) {
    if (this.phase !== 'deploy' || !this.pendingBuy) return null;
    if (!this.inDeploy(q, r) || this.unitAt(q, r)) return null;
    const typeId = this.pendingBuy;
    const t = UNIT_TYPES[typeId];
    if (this.treasury < t.cost) {
      this.pendingBuy = null;
      return null;
    }
    this.treasury -= t.cost;
    const core = this.canHireAsCore(typeId);
    const u = makeUnit(typeId, {
      q,
      r,
      core,
      hiredThisBattle: true,
      hidden: false,
    });
    this.units.push(u);
    this.pendingBuy = null;
    this.selectedId = u.id;
    markSupply(this);
    this.pushLog(`${u.name} joins the line${core ? ' and the core' : ' as auxilia'} (−${t.cost} honors).`);
    return u;
  }

  dismissHired(unit) {
    if (this.phase !== 'deploy' || !unit?.hiredThisBattle) return false;
    const t = typeOf(unit);
    this.treasury += t.cost;
    unit.strength = 0;
    this.units = this.units.filter((u) => u.id !== unit.id);
    if (this.selectedId === unit.id) this.selectedId = null;
    this.pushLog(`${unit.name} is sent back. +${t.cost} honors.`);
    return true;
  }

  spendAction(unit) {
    unit.acted = true;
    unit.mpRemaining = 0;
    this.lastMove = null;
  }

  reinforceUnit(unit, elite = false) {
    const check = canReinforce(this, unit, elite);
    if (!check.ok) return false;
    const pts = check.points;
    const each = reinforcePointCost(unit) * (elite ? 2 : 1);
    const cost = pts * each;
    const before = unit.strength;
    unit.strength += pts;
    this.treasury -= cost;
    if (!elite) {
      unit.experience = Math.floor((unit.experience * before) / unit.strength);
    }
    if (this.phase === 'player') this.spendAction(unit);
    const kind = elite ? 'Veteran drafts' : 'Replacements';
    this.pushLog(`${kind} for ${unit.name}: ${before} → ${unit.strength} (−${cost} honors).`);
    return true;
  }

  resupplyUnit(unit) {
    const check = canResupply(this, unit);
    if (!check.ok) return false;
    const t = typeOf(unit);
    unit.ammo = t.ammo;
    this.spendAction(unit);
    this.pushLog(`${unit.name} draws bolts and stones from the wagons.`);
    return true;
  }

  forcedMarchUnit(unit) {
    const check = canForcedMarch(this, unit);
    if (!check.ok) return false;
    unit.forcedMarch = true;
    unit.mpRemaining += 2;
    unit.disorder = Math.min(unit.strength, unit.disorder + 1);
    this.lastMove = null;
    this.pushLog(`${unit.name} forces the pace. Dust, then disorder.`);
    return true;
  }

  digIn(unit) {
    const check = canDig(this, unit);
    if (!check.ok) return false;
    const plus = typeOf(unit).traits.includes('entrenchPlus') && unit.inSupply ? 2 : 1;
    unit.entrench = Math.min(check.cap, unit.entrench + plus);
    unit.moved = true;
    this.spendAction(unit);
    this.pushLog(`${unit.name} throws up a ditch and bank.`);
    return true;
  }

  mergeUnits(unit, donor) {
    if (!unit || !donor) return false;
    if (!mergeDonors(this, unit).some((d) => d.id === donor.id)) return false;
    const room = reinforceCap(unit) - unit.strength;
    const take = Math.min(room, donor.strength);
    if (take <= 0) return false;
    const total = unit.strength + take;
    unit.experience = Math.round((unit.experience * unit.strength + donor.experience * take) / total);
    unit.strength += take;
    donor.strength -= take;
    if (donor.strength <= 0) {
      donor.strength = 0;
      donor.disorder = 0;
      this.pushLog(`${donor.name} is folded into ${unit.name}.`);
    } else {
      donor.disorder = Math.min(donor.strength, donor.disorder);
      this.pushLog(`${take} from ${donor.name} join ${unit.name}.`);
    }
    if (this.phase === 'player') this.spendAction(unit);
    if (this.selectedId === donor.id && donor.strength <= 0) this.selectedId = unit.id;
    return true;
  }

  rallyUnit(unit) {
    const check = canRally(this, unit);
    if (!check.ok) return false;
    for (const n of check.friends) n.disorder = Math.max(0, n.disorder - 1);
    this.spendAction(unit);
    this.pushLog(`${unit.name} rides the line. The shaken close up.`);
    return true;
  }

  ambushUnit(unit) {
    const check = canAmbush(this, unit);
    if (!check.ok) return false;
    unit.hidden = true;
    this.spendAction(unit);
    this.pushLog(`${unit.name} melts into the timber.`);
    return true;
  }

  scoutUnit(unit) {
    const check = canScout(this, unit);
    if (!check.ok) return false;
    this.revealNear(unit, 3);
    this.spendAction(unit);
    this.pushLog(`${unit.name} push into the brush and come back with eyes.`);
    return true;
  }

  doSpecial(act, unit, extra) {
    if (act === 'engineer') return this.engineerAction(unit);
    if (act === 'burn') return this.burnVillage(unit);
    if (act === 'testudo') return this.toggleTestudo(unit);
    if (act === 'reinforce') return this.reinforceUnit(unit, false);
    if (act === 'elite') return this.reinforceUnit(unit, true);
    if (act === 'resupply') return this.resupplyUnit(unit);
    if (act === 'march') return this.forcedMarchUnit(unit);
    if (act === 'dig') return this.digIn(unit);
    if (act === 'merge') return this.mergeUnits(unit, extra);
    if (act === 'rally') return this.rallyUnit(unit);
    if (act === 'ambush') return this.ambushUnit(unit);
    if (act === 'scout') return this.scoutUnit(unit);
    if (act === 'dismiss') return this.dismissHired(unit);
    if (act === 'wait') return this.waitUnit(unit);
    return false;
  }

  pushLog(msg) {
    this.log.unshift({ turn: this.turn, msg });
    if (this.log.length > 80) this.log.pop();
  }

  select(id) {
    const u = this.unitById(id);
    if (!u || u.faction !== this.playerFaction || u.strength <= 0) {
      this.selectedId = null;
      return;
    }
    this.selectedId = id;
    if (this.phase === 'deploy') this.pendingBuy = null;
  }

  playerCanOrder() {
    return this.phase === 'player' || this.phase === 'deploy';
  }

  moveRange(unit) {
    if (!unit || unit.acted || unit.faction !== this.phaseToFaction()) return { hexes: [], cameFrom: new Map() };
    if (this.phase === 'deploy') return { hexes: [], cameFrom: new Map() };
    return reachable(this, unit);
  }

  phaseToFaction() {
    return this.phase === 'ai' ? this.enemyFaction : this.playerFaction;
  }

  tryMove(unit, q, r) {
    if (this.phase === 'deploy') return this.tryDeployMove(unit, q, r);
    const acting = this.phaseToFaction();
    if ((this.phase !== 'player' && this.phase !== 'ai') || unit.faction !== acting || unit.acted) return null;
    const { hexes, cameFrom } = reachable(this, unit);
    const dest = hexes.find((h) => h.q === q && h.r === r);
    if (!dest) return null;
    const path = reconstructPath(cameFrom, unit, { q, r });
    const from = { q: unit.q, r: unit.r };
    if (this.phase === 'player') {
      this.lastMove = {
        id: unit.id,
        q: unit.q,
        r: unit.r,
        mp: unit.mpRemaining,
        entrench: unit.entrench,
        testudo: !!unit.testudo,
      };
    }
    unit.q = q;
    unit.r = r;
    unit.mpRemaining -= dest.cost;
    unit.moved = true;
    unit.entrench = 0;
    unit.testudo = false;
    if (typeOf(unit).traits.includes('recon')) this.revealNear(unit, 2);
    else this.revealNear(unit, 1);
    this.checkSpecialHex(unit);
    markSupply(this);
    return { path, from, to: { q, r } };
  }

  revealNear(unit, range) {
    for (const e of this.units) {
      if (e.faction === unit.faction || !e.hidden) continue;
      if (hexDistance(unit, e) <= range) e.hidden = false;
    }
  }

  checkSpecialHex(unit) {
    const c = this.cell(unit.q, unit.r);
    if (!c) return;
    if (c.eagle && unit.faction === 'rome') {
      c.eagle = false;
      this.flags.eagle = true;
      this.honorsEarned += 80;
      this.pushLog('The eagle of Legio XIX is recovered. Rome remembers.');
    }
    if (c.grave && unit.faction === 'rome' && !c.buried) {
      c.buried = true;
      this.flags.buried = (this.flags.buried || 0) + 1;
      this.honorsEarned += 15;
      this.pushLog('The bones of Varus\'s men are given earth and prayer.');
    }
    if (c.extract && unit.faction === 'rome') {
      this.extracted.push(unit.id);
      unit.strength = 0;
      unit.extracted = true;
      this.pushLog(`${unit.name} marches off the causeway toward the Rhine.`);
      if (this.selectedId === unit.id) this.selectedId = null;
    }
  }

  tryAttack(attacker, defender, opts = {}) {
    if (this.phase === 'deploy') return null;
    if (this.phase !== 'player' && !opts.ai) return null;
    if (attacker.forcedMarch && !opts.ai) return null;
    if (attacker.acted || attacker.strength <= 0 || defender.strength <= 0) return null;
    const missile = opts.missile ?? (inMissileRange(this, attacker, defender) && !canMelee(attacker, defender));
    if (!missile && !canMelee(attacker, defender)) return null;
    if (missile && !inMissileRange(this, attacker, defender)) return null;
    const result = resolveCombat(this, attacker, defender, { missile });
    this.casualties[defender.faction] += result.aKills;
    this.casualties[attacker.faction] += result.dKills;
    for (const line of result.log) this.pushLog(line);
    if (result.defenderDead) {
      this.pushLog(`${defender.name} is destroyed.`);
      if (isHero(defender) && defender.faction === 'germania') {
        this.flags.arminiusDown = true;
        this.honorsEarned += 40;
      }
    }
    this.lastMove = null;
    if (result.overrun && result.defenderDead) {
      const dest = { q: defender.q, r: defender.r };
      const cell = this.cell(dest.q, dest.r);
      const cost = cell ? moveCost(cell.terrain, typeOf(attacker), this.weather) : Infinity;
      if (cell && Number.isFinite(cost) && !this.unitAt(dest.q, dest.r)) {
        attacker.q = dest.q;
        attacker.r = dest.r;
        attacker.entrench = 0;
        attacker.testudo = false;
        attacker.moved = true;
        this.checkSpecialHex(attacker);
        markSupply(this);
        this.pushLog(`${attacker.name} overruns the hex.`);
      }
    }
    if (result.attackerDead && isHero(attacker) && attacker.faction === this.playerFaction) {
      this.result = { kind: 'defeat', title: 'The commander has fallen', text: `${attacker.name} is slain. The eagles dip.` };
    }
    if (result.retreat && defender.strength > 0) {
      const step = result.retreat === 'rout' ? 2 : 1;
      this.forceRetreat(defender, attacker, step);
    }
    this.updateObjectives();
    this.checkEnd();
    return result;
  }

  forceRetreat(unit, from, steps) {
    let q = unit.q;
    let r = unit.r;
    for (let i = 0; i < steps; i++) {
      const dq = unit.q - from.q;
      const dr = unit.r - from.r;
      const opts = neighbors(unit).sort((a, b) => {
        const awayA = hexDistance(a, from);
        const awayB = hexDistance(b, from);
        return awayB - awayA;
      });
      let moved = false;
      for (const n of opts) {
        const cell = this.cell(n.q, n.r);
        if (!cell || TERRAIN[cell.terrain]?.impassable) continue;
        if (this.unitAt(n.q, n.r)) continue;
        if (typeOf(unit).traits.includes('cavalry') && TERRAIN[cell.terrain].blockCavalry) continue;
        unit.q = n.q;
        unit.r = n.r;
        unit.entrench = 0;
        moved = true;
        break;
      }
      if (!moved) {
        unit.strength = Math.max(0, unit.strength - 1);
        this.casualties[unit.faction] += 1;
        this.pushLog(`${unit.name} has nowhere to fall back. Another man dies in the crush.`);
        break;
      }
    }
    if (q !== unit.q || r !== unit.r) {
      this.pushLog(`${unit.name} is driven back.`);
      if (steps >= 2) unit.disorder = Math.min(unit.strength, unit.disorder + 1);
    }
  }

  engineerAction(unit) {
    if (!typeOf(unit).traits.includes('engineer') || unit.acted) return false;
    const c = this.cell(unit.q, unit.r);
    if (!c) return false;
    if (c.terrain === 'brokenCauseway') {
      c.terrain = 'causeway';
      unit.acted = true;
      unit.mpRemaining = 0;
      this.pushLog('The immunes rebuild the planking. The causeway holds.');
      return true;
    }
    const canFortify = c.terrain === 'clear' || c.terrain === 'hill' || c.terrain === 'castra';
    if (canFortify && !this.flags.castraBuilt) {
      c.terrain = 'castra';
      c.supplySource = true;
      this.flags.castraBuilt = true;
      unit.acted = true;
      unit.mpRemaining = 0;
      this.pushLog('A marching camp rises. Ditch, palisade, four gates.');
      return true;
    }
    return false;
  }

  waitUnit(unit) {
    if (this.phase === 'deploy') return false;
    if (!unit || unit.acted || unit.faction !== this.playerFaction) return false;
    unit.acted = true;
    unit.mpRemaining = 0;
    this.lastMove = null;
    this.pushLog(`${unit.name} holds.`);
    return true;
  }

  undoMove() {
    if (!this.lastMove || this.phase !== 'player') return null;
    const u = this.unitById(this.lastMove.id);
    if (!u || u.acted || u.strength <= 0) return null;
    const to = { q: u.q, r: u.r };
    u.q = this.lastMove.q;
    u.r = this.lastMove.r;
    u.mpRemaining = this.lastMove.mp;
    u.entrench = this.lastMove.entrench;
    u.testudo = this.lastMove.testudo;
    u.moved = false;
    const from = { q: to.q, r: to.r };
    this.lastMove = null;
    markSupply(this);
    return { from: to, to: { q: u.q, r: u.r }, unit: u };
  }

  toggleTestudo(unit) {
    if (!canTestudo(this, unit) && !(unit.testudo && canAct(this, unit))) return false;
    const t = typeOf(unit);
    if (!t.traits.includes('formed') || unit.acted || unit.moved) return false;
    unit.testudo = !unit.testudo;
    if (unit.testudo) {
      unit.acted = true;
      unit.mpRemaining = 0;
      this.pushLog(`${unit.name} locks shields. Testudo.`);
    }
    return true;
  }

  nextIdle() {
    const idle = this.units.filter((u) => u.faction === this.playerFaction && u.strength > 0 && !u.acted && !u.extracted);
    if (!idle.length) return null;
    const i = idle.findIndex((u) => u.id === this.selectedId);
    const next = idle[(i + 1) % idle.length];
    this.select(next.id);
    return next;
  }

  burnVillage(unit) {
    const c = this.cell(unit.q, unit.r);
    if (!c || c.terrain !== 'village' || c.burned || unit.faction !== this.playerFaction || unit.acted) return false;
    c.burned = true;
    this.flags.burned = (this.flags.burned || 0) + 1;
    unit.acted = true;
    unit.mpRemaining = 0;
    this.honorsEarned += 10;
    this.pushLog('The village is put to the torch. The Chatti will remember the smoke.');
    this.updateObjectives();
    this.checkEnd();
    return true;
  }

  endPlayerTurn() {
    if (this.phase === 'deploy') {
      this.beginBattle();
      return;
    }
    if (this.phase !== 'player' || this.result) return;
    this.selectedId = null;
    this.lastMove = null;
    this.recoverSide(this.playerFaction);
    this.phase = 'ai';
    this.pushLog(this.enemyFaction === 'germania' ? 'The Germans move.' : 'The eagles advance.');
  }

  recoverSide(faction) {
    for (const u of this.units) {
      if (u.strength <= 0 || u.faction !== faction) continue;
      if (!u.moved && u.inSupply) {
        const cap = TERRAIN[this.cell(u.q, u.r)?.terrain]?.entrenchCap ?? 2;
        const plus = typeOf(u).traits.includes('entrenchPlus') && u.inSupply ? 2 : 1;
        u.entrench = Math.min(cap, u.entrench + plus);
      }
      if (u.inSupply) {
        u.disorder = Math.max(0, u.disorder - 1);
      }
      if (typeOf(u).traits.includes('auraRome') || typeOf(u).traits.includes('auraGermania')) {
        for (const n of this.units) {
          if (n.faction === u.faction && hexDistance(n, u) <= 1) {
            n.disorder = Math.max(0, n.disorder - 1);
          }
        }
      }
    }
  }

  beginPlayerTurn() {
    this.turn += 1;
    this.phase = 'player';
    this.runScripts();
    markSupply(this);
    const notes = applyAttrition(this);
    notes.forEach((n) => this.pushLog(n));
    for (const u of this.units) {
      if (u.strength <= 0) continue;
      u.moved = false;
      u.acted = false;
      u.chargedThisTurn = false;
      u.forcedMarch = false;
      u.mpRemaining = typeOf(u).move;
    }
    this.revealVision();
    this.updateObjectives();
    this.checkEnd();
    if (!this.result) this.pushLog(`Turn ${this.turn} — ${weatherName(this.weather)}.`);
  }

  revealVision() {
    for (const u of this.units) {
      if (u.faction !== this.playerFaction || u.strength <= 0) continue;
      const vis = 2 + (TERRAIN[this.cell(u.q, u.r)?.terrain]?.vision || 0);
      const range = this.weather === 'fog' ? Math.min(2, vis) : vis;
      this.revealNear(u, typeOf(u).traits.includes('recon') ? range + 1 : range);
    }
  }

  runScripts() {
    for (const s of this.scenario.scripts || []) {
      if (s.turn !== this.turn) continue;
      if (s.weather) {
        this.weather = s.weather;
        this.pushLog(`The weather turns: ${weatherName(s.weather)}.`);
      }
      if (s.spawn) {
        let arrived = 0;
        for (const p of s.spawn) {
          const { q, r } = offsetToAxial(p.col, p.row);
          const spot = this.findEmpty(q, r);
          if (!spot) {
            this.pushLog(`A ${p.name || p.typeId} could not reach the field.`);
            continue;
          }
          this.units.push(makeUnit(p.typeId, { q: spot.q, r: spot.r, hidden: p.hidden, name: p.name }));
          arrived += 1;
        }
        if (arrived) this.pushLog('Warhorns in the trees. Fresh warbands come on.');
      }
      if (s.breakCauseway) {
        for (const c of this.cells.values()) {
          if (c.terrain === 'causeway' && this.rng() < 0.25) c.terrain = 'brokenCauseway';
        }
        this.pushLog('Planks split. The long bridges sag into the black water.');
      }
    }
  }

  updateObjectives() {
    for (const o of this.objectives) {
      o.done = this.evalObjective(o);
    }
  }

  evalObjective(o) {
    if (o.type === 'hold') {
      const { offsetToAxial } = axial();
      const { q, r } = offsetToAxial(o.col, o.row);
      const u = this.unitAt(q, r);
      return !u || u.faction === this.playerFaction;
    }
    if (o.type === 'holdUntil') return this.turn >= this.maxTurns && this.evalObjective({ ...o, type: 'hold' });
    if (o.type === 'survive') {
      return this.units.some((u) => typeOf(u).id === o.unit && (u.strength > 0 || u.extracted));
    }
    if (o.type === 'burn') return (this.flags.burned || 0) >= (o.count || 3);
    if (o.type === 'occupy') {
      const { offsetToAxial } = axial();
      const { q, r } = offsetToAxial(o.col, o.row);
      const u = this.unitAt(q, r);
      return u && u.faction === this.playerFaction;
    }
    if (o.type === 'extract') {
      const n = this.extracted.length;
      return n >= (o.count || 6);
    }
    if (o.type === 'eagle') return !!this.flags.eagle;
    if (o.type === 'bury') return (this.flags.buried || 0) >= (o.count || 2);
    if (o.type === 'routArmy') {
      const live = this.units.filter((u) => u.faction === this.enemyFaction && u.strength > 0).length;
      const key = this.enemyFaction === 'germania' ? 'germanStart' : 'romeStart';
      const start = this.flags[key] || this.units.filter((u) => u.faction === this.enemyFaction).length;
      this.flags[key] = start;
      return live <= Math.floor(start * 0.35);
    }
    if (o.type === 'heroDown') return !!this.flags.arminiusDown;
    if (o.type === 'denyEagle') return !this.flags.eagle && this.turn >= this.maxTurns;
    return false;
  }

  checkEnd() {
    if (this.result) return;
    const hero = this.units.find((u) => u.faction === this.playerFaction && isHero(u) && !u.extracted);
    if (hero && hero.strength <= 0 && !hero.extracted) {
      this.result = { kind: 'defeat', title: 'The commander has fallen', text: 'Without a voice to hold them, the line breaks.' };
      return;
    }
    if (this.playerFaction === 'rome' && this.scenario.failIf && this.evalObjective(this.scenario.failIf) === false && this.scenario.failIf.type === 'hold') {
      const { offsetToAxial } = axial();
      const { q, r } = offsetToAxial(this.scenario.failIf.col, this.scenario.failIf.row);
      const u = this.unitAt(q, r);
      if (u && u.faction === this.enemyFaction) {
        this.result = { kind: 'defeat', title: 'The principia is taken', text: 'Barbarians stand where the eagles slept.' };
        return;
      }
    }
    const required = this.objectives.filter((o) => o.required);
    const optional = this.objectives.filter((o) => !o.required);
    const enemiesLive = this.units.some((u) => u.faction === this.enemyFaction && u.strength > 0);
    const reqNonTimer = required.filter((o) => o.type !== 'holdUntil');
    const reqOk = required.length && required.every((o) => o.done);
    const anyAlt = this.scenario.winAny && this.playerFaction === 'rome'
      ? this.scenario.winAny.some((id) => this.objectives.find((o) => o.id === id)?.done)
      : true;
    const wiped = !enemiesLive && reqNonTimer.every((o) => o.done);

    if ((reqOk && anyAlt) || wiped) {
      const bonus = optional.filter((o) => o.done).length;
      const kind = (bonus === optional.length && optional.length) || wiped ? 'decisive' : 'marginal';
      this.finish(kind);
      return;
    }
    if (this.turn >= this.maxTurns) {
      if (this.scenario.winAny) {
        if (anyAlt && reqNonTimer.every((o) => o.done)) this.finish('marginal');
        else this.result = { kind: 'defeat', title: 'The season turns', text: 'The Chatti still hold their hearths. The column must recross the Rhine empty-handed.' };
      } else if (required.every((o) => o.done || o.soft)) this.finish('marginal');
      else this.result = { kind: 'defeat', title: 'Night and rain', text: 'The season closes. The Rhine must be held — but the work is unfinished.' };
    }
  }

  finish(kind) {
    const honors = this.honorsEarned + (kind === 'decisive' ? 50 : 25);
    this.honorsEarned = honors;
    const title = kind === 'decisive' ? 'Decisive victory' : 'Victory';
    this.result = {
      kind,
      title,
      text: this.scenario.victoryText || 'The field is yours.',
      honors,
    };
  }

  survivingCore() {
    return this.units
      .filter((u) => u.core && (u.strength > 0 || u.extracted))
      .map((u) => ({
        typeId: u.typeId,
        name: u.name,
        strength: u.extracted ? u.maxStrength : u.strength,
        maxStrength: u.maxStrength,
        experience: u.experience,
        id: u.id,
      }));
  }

  preview(attacker, defender, missile) {
    return previewCombat(this, attacker, defender, { missile });
  }

  idleCount() {
    return this.units.filter((u) => u.faction === this.playerFaction && u.strength > 0 && !u.acted && !u.extracted).length;
  }

  toJSON() {
    return {
      scenarioId: this.scenario.id,
      playerFaction: this.playerFaction,
      difficulty: this.difficulty,
      mode: this.mode,
      turn: this.turn,
      phase: this.phase,
      weather: this.weather,
      flags: this.flags,
      honorsEarned: this.honorsEarned,
      treasury: this.treasury,
      startingTreasury: this.startingTreasury,
      pendingBuy: this.pendingBuy,
      deployKeys: [...this.deployKeys],
      casualties: this.casualties,
      extracted: this.extracted,
      selectedId: this.selectedId,
      seed: this.seed,
      rngState: typeof this.rng.state === 'function' ? this.rng.state() : undefined,
      log: this.log.slice(0, 24),
      units: this.units.map((u) => ({
        id: u.id,
        typeId: u.typeId,
        name: u.name,
        q: u.q,
        r: u.r,
        strength: u.strength,
        maxStrength: u.maxStrength,
        disorder: u.disorder,
        entrench: u.entrench,
        experience: u.experience,
        ammo: u.ammo,
        moved: u.moved,
        acted: u.acted,
        mpRemaining: u.mpRemaining,
        hidden: u.hidden,
        core: u.core,
        extracted: !!u.extracted,
        testudo: !!u.testudo,
        inSupply: !!u.inSupply,
        forcedMarch: !!u.forcedMarch,
        hiredThisBattle: !!u.hiredThisBattle,
      })),
      cells: [...this.cells.values()].map((c) => ({
        q: c.q,
        r: c.r,
        terrain: c.terrain,
        burned: !!c.burned,
        buried: !!c.buried,
        eagle: !!c.eagle,
        extract: !!c.extract,
        principia: !!c.principia,
        supplySource: !!c.supplySource,
      })),
    };
  }

  restore(data) {
    this.turn = data.turn;
    this.phase = data.phase;
    this.weather = data.weather;
    this.flags = data.flags || {};
    this.honorsEarned = data.honorsEarned || 0;
    this.treasury = data.treasury ?? this.treasury;
    this.startingTreasury = data.startingTreasury ?? this.treasury;
    this.pendingBuy = data.pendingBuy || null;
    this.deployKeys = new Set(data.deployKeys || []);
    if (!this.deployKeys.size) this.buildDeployZone();
    this.casualties = data.casualties || { rome: 0, germania: 0 };
    this.extracted = data.extracted || [];
    this.selectedId = data.selectedId || null;
    this.log = data.log || [];
    this.units = (data.units || []).map((u) => ({
      ...makeUnit(u.typeId, u),
      ...u,
    }));
    let nextId = 1;
    for (const u of this.units) {
      const m = String(u.id || '').match(/(\d+)$/);
      if (m) nextId = Math.max(nextId, Number(m[1]) + 1);
    }
    resetUnitIds(nextId);
    if (typeof data.rngState === 'number' && this.rng.setState) this.rng.setState(data.rngState);
    for (const c of data.cells || []) {
      const cell = this.cell(c.q, c.r);
      if (!cell) continue;
      cell.terrain = c.terrain;
      cell.burned = c.burned;
      cell.buried = c.buried;
      cell.eagle = c.eagle;
      cell.extract = c.extract;
      cell.principia = c.principia;
      cell.supplySource = c.supplySource;
    }
    this.updateObjectives();
  }
}

function weatherName(w) {
  if (w === 'rain') return 'Rain';
  if (w === 'fog') return 'Fog and night';
  return 'Fair';
}

function axial() {
  return {
    offsetToAxial(col, row) {
      const q = col - ((row - (row & 1)) >> 1);
      return { q, r: row };
    },
  };
}

export function loadScenario(id) {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`No scenario ${id}`);
  return s;
}

export function restoreBattle(data) {
  const s = loadScenario(data.scenarioId);
  return new Battle(s, {
    core: [],
    playerFaction: data.playerFaction || 'rome',
    difficulty: data.difficulty || 'seasoned',
    mode: data.mode || 'campaign',
    seed: data.seed,
    restore: data,
  });
}
