import { key, neighbors, hexDistance } from './hex.js';
import { mulberry32, hashSeed } from './rng.js';
import { TERRAIN, CHAR_TERRAIN, moveCost } from './data/terrain.js';
import { typeOf, makeUnit, resetUnitIds, isHero, effectiveStrength } from './data/units.js';
import { reachable, reconstructPath, attackTargets } from './pathfind.js';
import { previewCombat, resolveCombat, inMissileRange, canMelee } from './combat.js';
import { markSupply, applyAttrition } from './supply.js';
import { SCENARIOS } from './data/scenarios.js';

export class Battle {
  constructor(scenario, opts = {}) {
    this.scenario = scenario;
    this.cols = scenario.cols;
    this.rows = scenario.rows;
    this.weather = scenario.weather || 'fair';
    this.turn = 1;
    this.maxTurns = scenario.maxTurns || 16;
    this.phase = 'player';
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
    this.objectives = this.buildObjectives(scenario);
    this._idSeq = 1;
    this.buildMap(scenario);
    if (opts.restore) this.restore(opts.restore);
    else {
      this.placeUnits(scenario, opts);
      this.applyDifficulty();
    }
    markSupply(this);
    if (!opts.restore) this.pushLog(`Turn 1 — ${scenario.title}. Weather: ${this.weather}.`);
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
    let ci = 0;
    for (const cu of core) {
      const slot = corePlacements[ci++];
      if (!slot) break;
      const { offsetToAxial } = axial();
      const { q, r } = offsetToAxial(slot.col, slot.row);
      const spot = this.findEmpty(q, r);
      if (!spot) continue;
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
  }

  moveRange(unit) {
    if (!unit || unit.acted || unit.faction !== this.phaseToFaction()) return { hexes: [], cameFrom: new Map() };
    return reachable(this, unit);
  }

  phaseToFaction() {
    return this.phase === 'player' ? this.playerFaction : this.enemyFaction;
  }

  tryMove(unit, q, r) {
    if (this.phase !== 'player' || unit.faction !== this.playerFaction || unit.acted) return null;
    const { hexes, cameFrom } = reachable(this, unit);
    const dest = hexes.find((h) => h.q === q && h.r === r);
    if (!dest) return null;
    const path = reconstructPath(cameFrom, unit, { q, r });
    const from = { q: unit.q, r: unit.r };
    this.lastMove = {
      id: unit.id,
      q: unit.q,
      r: unit.r,
      mp: unit.mpRemaining,
      entrench: unit.entrench,
      testudo: !!unit.testudo,
    };
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
    if (c.extract && unit.faction === this.playerFaction) {
      this.extracted.push(unit.id);
      unit.strength = 0;
      unit.extracted = true;
      this.pushLog(`${unit.name} marches off the causeway toward the Rhine.`);
      if (this.selectedId === unit.id) this.selectedId = null;
    }
  }

  tryAttack(attacker, defender, opts = {}) {
    if (this.phase !== 'player' && !opts.ai) return null;
    if (attacker.acted || attacker.strength <= 0 || defender.strength <= 0) return null;
    const missile = opts.missile ?? (inMissileRange(this, attacker, defender) && !canMelee(attacker, defender));
    if (!missile && !canMelee(attacker, defender)) return null;
    if (missile && !inMissileRange(this, attacker, defender) && hexDistance(attacker, defender) > typeOf(attacker).range) return null;
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
    if (c.terrain !== 'castra' && !this.flags.castraBuilt) {
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
        for (const p of s.spawn) {
          const { offsetToAxial } = axial();
          const { q, r } = offsetToAxial(p.col, p.row);
          if (this.unitAt(q, r)) continue;
          this.units.push(makeUnit(p.typeId, { q, r, hidden: p.hidden, name: p.name }));
        }
        this.pushLog('Warhorns in the trees. Fresh warbands come on.');
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
    const anyAlt = this.scenario.winAny
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
      casualties: this.casualties,
      extracted: this.extracted,
      selectedId: this.selectedId,
      seed: this.seed,
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
    this.casualties = data.casualties || { rome: 0, germania: 0 };
    this.extracted = data.extracted || [];
    this.selectedId = data.selectedId || null;
    this.log = data.log || [];
    this.units = (data.units || []).map((u) => ({
      ...makeUnit(u.typeId, u),
      ...u,
    }));
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
