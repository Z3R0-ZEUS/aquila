import { SCENARIOS, CAMPAIGN_ENDING } from './data/scenarios.js';
import { UNIT_TYPES, SHOP_TYPES, GERMAN_SHOP_TYPES, makeUnit } from './data/units.js';
import { skirmishTreasury, shopCatalogFor } from './actions.js';

const SAVE_KEY = 'aquila-save-v2';
const MAX_SLOTS = 14;

export const DIFFICULTIES = {
  recruit: { label: 'Recruit', honors: 110, blurb: 'Softer enemies. Room to learn the woods.' },
  seasoned: { label: 'Seasoned', honors: 80, blurb: 'The Rhine as Germanicus found it.' },
  veteran: { label: 'Veteran', honors: 50, blurb: 'Harder warbands. The forest does not forgive.' },
};

export function defaultCore() {
  const list = [
    { typeId: 'legion', name: 'Cohors I', experience: 1 },
    { typeId: 'legion', name: 'Cohors II', experience: 0 },
    { typeId: 'veteran', name: 'Cohors Veterana', experience: 2 },
    { typeId: 'auxilia', name: 'Cohors Batavorum', experience: 1 },
    { typeId: 'auxilia', name: 'Cohors Gallorum', experience: 0 },
    { typeId: 'sagittarii', name: 'Sagittarii Syrorum', experience: 0 },
    { typeId: 'exploratores', name: 'Exploratores', experience: 1 },
    { typeId: 'equites', name: 'Ala Petriana', experience: 0 },
  ];
  return list.map((u, i) => ({
    id: `core-${i + 1}`,
    typeId: u.typeId,
    name: u.name,
    strength: UNIT_TYPES[u.typeId].maxStrength,
    maxStrength: UNIT_TYPES[u.typeId].overstrength || UNIT_TYPES[u.typeId].maxStrength,
    experience: u.experience,
  }));
}

export function newCampaign(difficulty = 'seasoned') {
  const d = DIFFICULTIES[difficulty] || DIFFICULTIES.seasoned;
  return {
    honors: d.honors,
    mission: 0,
    core: defaultCore(),
    eagle: false,
    extractedLast: 0,
    history: [],
    difficulty,
    battleSave: null,
    created: Date.now(),
  };
}

export function saveCampaign(c) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(c));
}

export function loadCampaign() {
  try {
    const raw = localStorage.getItem(SAVE_KEY) || localStorage.getItem('aquila-save-v1');
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c.difficulty) c.difficulty = 'seasoned';
    if (!('battleSave' in c)) c.battleSave = null;
    return c;
  } catch {
    return null;
  }
}

export function saveBattle(c, battle) {
  if (!c || !battle || battle.mode !== 'campaign') return;
  c.battleSave = battle.toJSON();
  saveCampaign(c);
}

export function clearBattleSave(c) {
  if (!c) return;
  c.battleSave = null;
  saveCampaign(c);
}

export function clearCampaign() {
  localStorage.removeItem(SAVE_KEY);
}

export function currentScenario(c) {
  return SCENARIOS[c.mission];
}

export function slotsUsed(c) {
  return c.core.reduce((n, u) => n + (UNIT_TYPES[u.typeId]?.slots || 1), 0);
}

export function refillCost(unit) {
  const t = UNIT_TYPES[unit.typeId];
  const missing = (t.maxStrength - unit.strength);
  return Math.max(0, missing * 4);
}

export function applyRefill(c, unitId) {
  const u = c.core.find((x) => x.id === unitId);
  if (!u) return false;
  const t = UNIT_TYPES[u.typeId];
  const cost = refillCost(u);
  if (cost <= 0 || c.honors < cost) return false;
  c.honors -= cost;
  u.strength = t.maxStrength;
  return true;
}

export function applyOverstrength(c, unitId) {
  const u = c.core.find((x) => x.id === unitId);
  if (!u) return false;
  const t = UNIT_TYPES[u.typeId];
  const cap = t.overstrength || t.maxStrength;
  if (u.strength >= cap || c.honors < 15) return false;
  c.honors -= 15;
  u.strength += 1;
  u.maxStrength = Math.max(u.maxStrength, u.strength);
  return true;
}

export function buyUnit(c, typeId) {
  const t = UNIT_TYPES[typeId];
  if (!t || !SHOP_TYPES.includes(typeId)) return false;
  if (c.honors < t.cost) return false;
  if (slotsUsed(c) + t.slots > MAX_SLOTS) return false;
  c.honors -= t.cost;
  c.core.push({
    id: `core-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    typeId,
    name: t.name,
    strength: t.maxStrength,
    maxStrength: t.overstrength || t.maxStrength,
    experience: 0,
  });
  return true;
}

export function dismissUnit(c, unitId) {
  const i = c.core.findIndex((x) => x.id === unitId);
  if (i < 0) return false;
  const t = UNIT_TYPES[c.core[i].typeId];
  c.honors += Math.floor((t.cost || 20) / 4);
  c.core.splice(i, 1);
  return true;
}

export function applyBattleResult(c, battle) {
  const sc = SCENARIOS[c.mission];
  const surviving = battle.survivingCore();
  const nextCore = [];
  for (const old of c.core) {
    const live = surviving.find((s) => s.id === old.id);
    if (live) {
      nextCore.push({
        ...old,
        strength: live.strength,
        experience: live.experience,
        maxStrength: live.maxStrength,
      });
    }
  }
  c.battleSave = null;
  if (battle.mode === 'skirmish') {
    return { next: battle.result.kind === 'defeat' ? 'retry' : 'title', ending: null, skirmish: true };
  }
  if (battle.result.kind === 'defeat') {
    c.history.push({
      mission: sc.id,
      kind: 'defeat',
      honors: 0,
      casualties: battle.casualties,
    });
    return { next: 'retry', ending: null };
  }

  const hired = surviving.filter((s) => !c.core.some((old) => old.id === s.id));
  for (const live of hired) {
    nextCore.push({
      id: live.id,
      typeId: live.typeId,
      name: live.name,
      strength: live.strength,
      maxStrength: live.maxStrength,
      experience: live.experience,
    });
  }
  c.core = nextCore;
  if (typeof battle.treasury === 'number') c.honors = battle.treasury + battle.honorsEarned;
  else c.honors += battle.honorsEarned;
  if (battle.flags.eagle) c.eagle = true;
  c.extractedLast = battle.extracted.length;
  c.history.push({
    mission: sc.id,
    kind: battle.result.kind,
    honors: battle.honorsEarned,
    casualties: battle.casualties,
  });

  if (c.eagle && c.mission + 1 === 4) {
    // bonus veteran if eagle recovered before Idistaviso
  }
  if (c.eagle && c.mission === 3) {
    c.honors += 30;
    const vet = {
      id: `core-xix-${Date.now()}`,
      typeId: 'veteran',
      name: 'Cohors XIX Redux',
      strength: 10,
      maxStrength: 12,
      experience: 2,
    };
    if (slotsUsed({ core: [...c.core, vet] }) <= MAX_SLOTS) c.core.push(vet);
  }

  c.mission += 1;
  if (c.mission >= SCENARIOS.length) {
    const kinds = c.history.map((h) => h.kind);
    const ending = kinds.every((k) => k === 'decisive')
      ? CAMPAIGN_ENDING.decisive
      : CAMPAIGN_ENDING.marginal;
    return { next: 'ending', ending };
  }
  return { next: 'shop', ending: null };
}

export function shopCatalog(faction = 'rome') {
  return shopCatalogFor(faction);
}

export { MAX_SLOTS, UNIT_TYPES, GERMAN_SHOP_TYPES, skirmishTreasury };
