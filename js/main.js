import { Battle, restoreBattle } from './game.js';
import { MapView } from './render.js';
import { UI } from './ui.js';
import { runAiTurn } from './ai.js';
import {
  newCampaign,
  saveCampaign,
  loadCampaign,
  currentScenario,
  applyBattleResult,
  applyRefill,
  applyOverstrength,
  buyUnit,
  dismissUnit,
  saveBattle,
  clearBattleSave,
  DIFFICULTIES,
} from './campaign.js';
import { typeOf } from './data/units.js';
import { canMelee, inMissileRange } from './combat.js';
import { hexDistance } from './hex.js';
import { reachable } from './pathfind.js';
import { CAMPAIGN_INTRO, CAMPAIGN_ENDING, SCENARIOS } from './data/scenarios.js';
import { sfx, combatSound, toggleMute, isMuted, unlock } from './audio.js';

const app = document.getElementById('app');
const canvas = document.getElementById('map');

const images = {};
const IMAGE_LIST = [
  ['title', 'assets/briefings/title.png'],
  ['briefing-vetera.png', 'assets/briefings/briefing-vetera.png'],
  ['briefing-chatti.png', 'assets/briefings/briefing-chatti.png'],
  ['briefing-pontes.png', 'assets/briefings/briefing-pontes.png'],
  ['briefing-teutoburg.png', 'assets/briefings/briefing-teutoburg.png'],
  ['briefing-idistaviso.png', 'assets/briefings/briefing-idistaviso.png'],
  ['tile-clear', 'assets/tiles/clear.png'],
  ['tile-clear-b', 'assets/tiles/clear-b.png'],
  ['tile-clear-c', 'assets/tiles/clear-c.png'],
  ['tile-forest-floor', 'assets/tiles/forest-floor.png'],
  ['tile-dense-floor', 'assets/tiles/dense-floor.png'],
  ['tile-marsh', 'assets/tiles/marsh.png'],
  ['tile-hill', 'assets/tiles/hill.png'],
  ['tile-water', 'assets/tiles/water.png'],
  ['tile-ford', 'assets/tiles/ford.png'],
  ['tile-village-dirt', 'assets/tiles/village-dirt.png'],
  ['tile-castra-earth', 'assets/tiles/castra-earth.png'],
  ['tile-earth-side', 'assets/tiles/earth-side.png'],
  ['prop-oak-a', 'assets/tiles/props/oak-a.png'],
  ['prop-oak-b', 'assets/tiles/props/oak-b.png'],
  ['prop-oak-c', 'assets/tiles/props/oak-c.png'],
  ['prop-fir-a', 'assets/tiles/props/fir-a.png'],
  ['prop-fir-b', 'assets/tiles/props/fir-b.png'],
  ['prop-fir-c', 'assets/tiles/props/fir-c.png'],
  ['prop-reeds-a', 'assets/tiles/props/reeds-a.png'],
  ['prop-reeds-b', 'assets/tiles/props/reeds-b.png'],
  ['prop-rock', 'assets/tiles/props/rock.png'],
  ['prop-longhouse-a', 'assets/tiles/props/longhouse-a.png'],
  ['prop-longhouse-b', 'assets/tiles/props/longhouse-b.png'],
  ['prop-oppidum', 'assets/tiles/props/oppidum.png'],
  ['prop-castra', 'assets/tiles/props/castra.png'],
  ['prop-planks', 'assets/tiles/props/planks.png'],
  ['prop-planks-broken', 'assets/tiles/props/planks-broken.png'],
];

const PORTRAITS = [
  'legion', 'veteran', 'auxilia', 'sagittarii', 'slingers', 'equites', 'batavi',
  'exploratores', 'scorpio', 'engineers', 'germanicus', 'caecina',
  'warband', 'nobles', 'skirmishers', 'hunters', 'lighthorse', 'ambushers', 'raiders', 'arminius',
];

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function loadAssets() {
  const jobs = [];
  for (const [key, src] of IMAGE_LIST) {
    jobs.push(loadImage(src).then((img) => { if (img) images[key] = img; }));
  }
  for (const id of PORTRAITS) {
    const file = `${id}.png`;
    jobs.push(
      loadImage(`assets/portraits/${file}`).then((img) => {
        if (img) {
          images[file] = img;
          images[`portrait-${id}`] = img;
        }
      })
    );
  }
  await Promise.all(jobs);
}

const view = new MapView(canvas, images);
let campaign = loadCampaign();
let battle = null;
let aarFollow = 'shop';
let keys = new Set();
let setup = { kind: 'campaign', difficulty: 'seasoned', faction: 'rome', scenarioId: null };
let introOpen = false;
let introTimer = null;
const INTRO_MS = 9000;

const ui = new UI(app, {
  onSpecial(act, unit, extra) {
    if (!battle || !battle.playerCanOrder()) return;
    if (battle.doSpecial(act, unit, extra)) {
      sfx.ui();
      persistBattle();
    }
    ui.renderBattle(battle);
    maybeEnd();
  },
  onDeployBuy(typeId) {
    if (!battle || battle.phase !== 'deploy') return;
    if (battle.pendingBuy === typeId) battle.cancelPurchase();
    else if (battle.startPurchase(typeId)) sfx.click();
    ui.renderBattle(battle);
  },
  onShop(kind, id) {
    if (!campaign) return;
    if (kind === 'refill') applyRefill(campaign, id);
    if (kind === 'over') applyOverstrength(campaign, id);
    if (kind === 'buy') buyUnit(campaign, id);
    if (kind === 'dismiss') dismissUnit(campaign, id);
    saveCampaign(campaign);
    ui.renderShop(campaign);
  },
  onSetup(kind, value) {
    if (kind === 'difficulty') setup.difficulty = value;
    if (kind === 'faction') setup.faction = value;
    drawSetup();
  },
  onSkirmish(id, fac) {
    setup.kind = 'skirmish';
    setup.scenarioId = id;
    setup.faction = fac;
    startSkirmish();
  },
});

function syncMute() {
  const label = isMuted() ? 'Sound off' : 'Sound on';
  const battleMute = document.getElementById('btn-mute');
  const titleMute = document.getElementById('btn-mute-title');
  if (battleMute) battleMute.textContent = label;
  if (titleMute) titleMute.textContent = label;
}

function endingTextFor(c) {
  const kinds = (c?.history || []).map((h) => h.kind).filter(Boolean);
  if (kinds.length && kinds.every((k) => k === 'decisive')) return CAMPAIGN_ENDING.decisive;
  if (kinds.length && kinds.every((k) => k === 'defeat')) return CAMPAIGN_ENDING.defeat;
  return CAMPAIGN_ENDING.marginal;
}

function openTitle() {
  const c = loadCampaign();
  ui.renderTitle(!!c, !!(c && c.battleSave));
}

function finishIntro() {
  if (!introOpen) return;
  introOpen = false;
  if (introTimer) {
    clearTimeout(introTimer);
    introTimer = null;
  }
  try {
    sessionStorage.setItem('aquila-intro-seen', '1');
  } catch {
    /* private mode */
  }
  openTitle();
}

function playIntroThenTitle() {
  let seen = false;
  try {
    seen = sessionStorage.getItem('aquila-intro-seen') === '1';
  } catch {
    seen = false;
  }
  if (seen) {
    openTitle();
    return;
  }
  introOpen = true;
  ui.renderIntro(CAMPAIGN_INTRO);
  introTimer = setTimeout(finishIntro, INTRO_MS);
}

function drawSetup() {
  const campaignMode = setup.kind === 'campaign';
  ui.renderSetup({
    title: campaignMode ? 'New campaign' : 'Skirmish',
    lede: campaignMode
      ? 'Germanicus takes the Rhine army into the timber. Choose your season.'
      : 'A single field. No winter camp. Pick your people.',
    difficulty: setup.difficulty,
    showFaction: !campaignMode,
    faction: setup.faction,
  });
}

function startNew() {
  unlock();
  sfx.ui();
  setup.kind = 'campaign';
  setup.difficulty = campaign?.difficulty || 'seasoned';
  drawSetup();
}

function confirmSetup() {
  unlock();
  sfx.click();
  if (setup.kind === 'skirmish') {
    startSkirmish();
    return;
  }
  const existing = loadCampaign();
  if (existing && !window.confirm('A campaign is already marked. Begin a new one and lose it?')) {
    return;
  }
  campaign = newCampaign(setup.difficulty);
  saveCampaign(campaign);
  ui.renderPrologue(CAMPAIGN_INTRO);
}

function finishPrologue() {
  unlock();
  sfx.click();
  if (!campaign) campaign = loadCampaign() || newCampaign(setup.difficulty);
  ui.renderBriefing(currentScenario(campaign), campaign);
}

function continueCamp() {
  unlock();
  sfx.ui();
  campaign = loadCampaign() || newCampaign();
  if (campaign.mission >= SCENARIOS.length) {
    ui.renderEnding(endingTextFor(campaign));
    return;
  }
  ui.renderShop(campaign);
}

function resumeBattle() {
  unlock();
  sfx.ui();
  campaign = loadCampaign();
  if (!campaign?.battleSave) {
    openTitle();
    return;
  }
  battle = restoreBattle(campaign.battleSave);
  ui.renderBattle(battle);
  requestAnimationFrame(() => {
    view.resize();
    view.fitMap(battle);
  });
}

function startSkirmish() {
  const sc = SCENARIOS.find((s) => s.id === setup.scenarioId) || SCENARIOS[0];
  campaign = campaign || newCampaign(setup.difficulty);
  battle = new Battle(sc, {
    core: defaultCoreSafe(),
    playerFaction: setup.faction,
    difficulty: setup.difficulty,
    mode: 'skirmish',
  });
  const briefCamp = { honors: '—', difficulty: setup.difficulty };
  ui.renderBriefing(
    {
      ...sc,
      briefing: setup.faction === 'germania'
        ? `The tribes hold this ground. Drive the eagles off ${sc.subtitle}.`
        : sc.briefing,
      objectives: battle.objectives,
    },
    briefCamp
  );
}

function defaultCoreSafe() {
  return (campaign && campaign.core) ? campaign.core : newCampaign(setup.difficulty).core;
}

function deploy() {
  unlock();
  sfx.click();
  if (battle && battle.mode === 'skirmish' && battle.turn === 1 && !battle.result) {
    ui.renderBattle(battle);
    requestAnimationFrame(() => {
      view.resize();
      view.fitMap(battle);
    });
    return;
  }
  const sc = currentScenario(campaign);
  battle = new Battle(sc, {
    core: campaign.core,
    playerFaction: 'rome',
    difficulty: campaign.difficulty || 'seasoned',
    mode: 'campaign',
    honors: campaign.honors,
  });
  ui.renderBattle(battle);
  requestAnimationFrame(() => {
    view.resize();
    view.fitMap(battle);
  });
}

function persistBattle() {
  if (campaign && battle && battle.mode === 'campaign' && !battle.result) saveBattle(campaign, battle);
}

function maybeEnd() {
  if (battle && battle.result) {
    setTimeout(() => {
      if (campaign) clearBattleSave(campaign);
      const follow = applyBattleResult(campaign || newCampaign(), battle);
      aarFollow = follow.next;
      if (campaign && battle.mode === 'campaign') saveCampaign(campaign);
      if (battle.result.kind === 'defeat') sfx.defeat();
      else sfx.victory();
      ui.renderAar(battle, aarFollow);
      ui._endingText = follow.ending;
    }, 450);
  }
}

async function endTurn() {
  if (!battle || battle.result) return;
  if (battle.phase === 'deploy') {
    if (battle.beginBattle()) {
      sfx.endTurn();
      persistBattle();
      ui.renderBattle(battle);
    }
    return;
  }
  if (battle.phase !== 'player') return;
  sfx.endTurn();
  battle.endPlayerTurn();
  ui.renderBattle(battle);
  await wait(280);
  const acts = runAiTurn(battle);
  for (const a of acts) {
    if (a.type === 'attack' && a.result) {
      combatSound(!!a.missile, a.result);
      view.playCombat(a.unit, a.target, a.result, !!a.missile);
    }
  }
  ui.renderBattle(battle);
  if (battle.result) {
    maybeEnd();
    return;
  }
  await wait(400);
  battle.beginPlayerTurn();
  persistBattle();
  ui.renderBattle(battle);
  maybeEnd();
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function onMapClick(sx, sy, button) {
  if (!battle || !battle.playerCanOrder() || battle.result) return;
  ui.hidePreview();
  if (button === 2) {
    battle.selectedId = null;
    battle.cancelPurchase();
    ui.hidePreview();
    ui.renderBattle(battle);
    return;
  }
  const hex = view.hexAtScreen(sx, sy);
  if (!hex || !battle.cell(hex.q, hex.r)) return;
  const unit = battle.unitAt(hex.q, hex.r);

  if (battle.phase === 'deploy' && battle.pendingBuy) {
    const placed = battle.placePurchase(hex.q, hex.r);
    if (placed) {
      sfx.click();
      persistBattle();
    }
    ui.renderBattle(battle);
    return;
  }

  if (unit && unit.faction === battle.playerFaction) {
    battle.select(unit.id);
    sfx.select();
    ui.hidePreview();
    ui.renderBattle(battle);
    return;
  }

  const sel = battle.selected;
  if (!sel) return;
  if (battle.phase === 'deploy') {
    const moved = battle.tryDeployMove(sel, hex.q, hex.r);
    if (moved) {
      sfx.move();
      view.playMove(moved.from, moved.to);
      persistBattle();
      ui.renderBattle(battle);
    }
    return;
  }
  if (sel.acted) return;

  if (unit && unit.faction === battle.enemyFaction && !unit.hidden) {
    const needMove = hexDistance(sel, unit) > 1 && !(typeOf(sel).range > 0 && sel.ammo > 0 && hexDistance(sel, unit) <= typeOf(sel).range);
    if (needMove) {
      const { hexes } = reachable(battle, sel);
      let best = null;
      for (const h of hexes) {
        const d = hexDistance(h, unit);
        const melee = d === 1;
        const missile = typeOf(sel).range > 0 && sel.ammo > 0 && d <= typeOf(sel).range;
        if (!melee && !missile) continue;
        if (!best || h.cost < best.cost) best = { ...h, melee, missile: !melee && missile };
      }
      if (best) {
        const movedIn = battle.tryMove(sel, best.q, best.r);
        if (movedIn) {
          sfx.move();
          view.playMove(movedIn.from, movedIn.to);
          persistBattle();
        }
      }
    }
    const missile = !canMelee(sel, unit) && inMissileRange(battle, sel, unit);
    if (!canMelee(sel, unit) && !missile) {
      ui.renderBattle(battle);
      return;
    }
    const prev = battle.preview(sel, unit, missile);
    ui.showPreview(prev, sel, unit, missile, () => {
      const res = battle.tryAttack(sel, unit, { missile });
      if (res) {
        combatSound(missile, res);
        view.playCombat(sel, unit, res, missile);
        persistBattle();
      }
      ui.renderBattle(battle);
      maybeEnd();
    }, () => {});
    return;
  }

  const moved = battle.tryMove(sel, hex.q, hex.r);
  if (moved) {
    sfx.move();
    view.playMove(moved.from, moved.to);
    persistBattle();
    ui.renderBattle(battle);
  }
}

function orderSelected(act) {
  if (!battle || !battle.playerCanOrder() || !battle.selected) return;
  if (battle.doSpecial(act, battle.selected)) {
    sfx.ui();
    persistBattle();
    ui.renderBattle(battle);
    maybeEnd();
  }
}

function cycleUnit() {
  if (!battle || !battle.playerCanOrder()) return;
  const u = battle.nextIdle();
  if (u) {
    sfx.select();
    ui.renderBattle(battle);
  }
}

function holdUnit() {
  if (!battle || battle.phase !== 'player' || !battle.selected) return;
  if (battle.waitUnit(battle.selected)) {
    sfx.ui();
    persistBattle();
    ui.renderBattle(battle);
  }
}

function undoUnit() {
  if (!battle) return;
  const undone = battle.undoMove();
  if (undone) {
    sfx.ui();
    view.playMove(undone.from, undone.to);
    persistBattle();
    ui.renderBattle(battle);
  }
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 1 || e.shiftKey) {
    view.drag = { x: e.clientX, y: e.clientY };
    canvas.classList.add('drag');
    return;
  }
  if (e.button === 0 || e.button === 2) {
    const r = canvas.getBoundingClientRect();
    onMapClick(e.clientX - r.left, e.clientY - r.top, e.button);
  }
});
window.addEventListener('mousemove', (e) => {
  if (view.drag) {
    view.pan(e.clientX - view.drag.x, e.clientY - view.drag.y);
    view.drag = { x: e.clientX, y: e.clientY };
  }
  if (!battle) return;
  const r = canvas.getBoundingClientRect();
  const hex = view.hexAtScreen(e.clientX - r.left, e.clientY - r.top);
  view.hover = hex;
  ui.hexTip(battle, hex);
});
window.addEventListener('mouseup', () => {
  view.drag = null;
  canvas.classList.remove('drag');
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left;
  const sy = e.clientY - r.top;
  const before = view.screenToWorld(sx, sy);
  view.cam.scale = Math.max(0.55, Math.min(1.85, view.cam.scale * (e.deltaY < 0 ? 1.1 : 0.9)));
  const after = view.screenToWorld(sx, sy);
  view.cam.x += after.x - before.x;
  view.cam.y += after.y - before.y;
}, { passive: false });

window.addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  if (document.getElementById('screen-intro')?.classList.contains('show')) {
    if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
      e.preventDefault();
      finishIntro();
    }
    return;
  }
  if (document.getElementById('screen-prologue')?.classList.contains('show')) {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      finishPrologue();
    }
    return;
  }
  if (!document.getElementById('screen-battle').classList.contains('show')) return;
  if (e.key === 'Enter') endTurn();
  if (e.key === 'Escape') {
    if (battle) battle.selectedId = null;
    ui.hidePreview();
    if (battle) ui.renderBattle(battle);
  }
  if ((e.key === 'f' || e.key === 'F') && battle) view.fitMap(battle);
  if (e.key === 'n' || e.key === 'N' || e.key === 'Tab') {
    e.preventDefault();
    cycleUnit();
  }
  if (e.key === ' ') {
    e.preventDefault();
    holdUnit();
  }
  if (e.key === 'u' || e.key === 'U') undoUnit();
  if (e.key === 'r' || e.key === 'R') orderSelected('reinforce');
  if (e.key === 'v' || e.key === 'V') orderSelected('elite');
  if (e.key === 'i' || e.key === 'I') orderSelected('resupply');
  if (e.key === 'x' || e.key === 'X') orderSelected('march');
  if (e.key === 'g' || e.key === 'G') orderSelected('dig');
  if (e.key === 'y' || e.key === 'Y') orderSelected('rally');
  if (e.key === 'c' || e.key === 'C') orderSelected('scout');
  if (e.key === 'l' || e.key === 'L') orderSelected('ambush');
  if (e.key === 't' || e.key === 'T') orderSelected('testudo');
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

document.addEventListener('pointerdown', () => unlock(), { once: true });
function onMuteClick() {
  toggleMute();
  syncMute();
}
document.getElementById('btn-mute').onclick = onMuteClick;
const titleMute = document.getElementById('btn-mute-title');
if (titleMute) titleMute.onclick = onMuteClick;
document.getElementById('screen-intro').onclick = () => finishIntro();
document.getElementById('btn-prologue-go').onclick = finishPrologue;
document.getElementById('btn-new').onclick = startNew;
document.getElementById('btn-continue').onclick = continueCamp;
document.getElementById('btn-resume').onclick = resumeBattle;
document.getElementById('btn-skirmish').onclick = () => {
  unlock();
  sfx.ui();
  ui.renderSkirmish();
};
document.getElementById('btn-setup-go').onclick = confirmSetup;
document.getElementById('btn-setup-back').onclick = openTitle;
document.getElementById('btn-skirmish-back').onclick = openTitle;
document.getElementById('btn-deploy').onclick = deploy;
document.getElementById('btn-brief-back').onclick = () => {
  if (battle && battle.mode === 'skirmish') {
    battle = null;
    openTitle();
    return;
  }
  ui.renderShop(campaign);
};
document.getElementById('btn-next-unit').onclick = cycleUnit;
document.getElementById('btn-wait').onclick = holdUnit;
document.getElementById('btn-undo').onclick = undoUnit;
document.getElementById('btn-save').onclick = () => {
  persistBattle();
  sfx.click();
  if (battle) battle.pushLog('The field is marked. You may leave and return.');
  ui.renderBattle(battle);
};
document.getElementById('btn-end').onclick = endTurn;
document.getElementById('aar-next').onclick = () => {
  if (aarFollow === 'title') {
    battle = null;
    openTitle();
  } else if (aarFollow === 'retry') {
    if (battle && battle.mode === 'skirmish') startSkirmish();
    else ui.renderBriefing(currentScenario(campaign), campaign);
  } else if (aarFollow === 'ending') ui.renderEnding(ui._endingText || '');
  else ui.renderShop(campaign);
};
document.getElementById('btn-next-mission').onclick = () => ui.renderBriefing(currentScenario(campaign), campaign);
document.getElementById('btn-shop-title').onclick = openTitle;
document.getElementById('btn-end-title').onclick = openTitle;

function loop() {
  const speed = 7;
  if (keys.has('a') || keys.has('arrowleft')) view.pan(speed, 0);
  if (keys.has('d') || keys.has('arrowright')) view.pan(-speed, 0);
  if (keys.has('w') || keys.has('arrowup')) view.pan(0, speed);
  if (keys.has('s') || keys.has('arrowdown')) view.pan(0, -speed);
  if (battle && document.getElementById('screen-battle').classList.contains('show')) {
    view.draw(battle, ui);
  }
  requestAnimationFrame(loop);
}

const assetsReady = loadAssets();
loop();

function openDebugScene(scene) {
  campaign = newCampaign();
  const m = Number(new URLSearchParams(location.search).get('mission') || 0);
  if (Number.isFinite(m) && m >= 0 && m < SCENARIOS.length) campaign.mission = m;
  if (scene === 'shop') ui.renderShop(campaign);
  else if (scene === 'battle') deploy();
  else if (scene === 'prologue') ui.renderPrologue(CAMPAIGN_INTRO);
  else if (scene === 'title') openTitle();
  else if (scene === 'skirmish') ui.renderSkirmish();
  else if (scene === 'ending') ui.renderEnding(CAMPAIGN_ENDING.decisive);
  else if (scene === 'setup') drawSetup();
  else ui.renderBriefing(currentScenario(campaign), campaign);
}

const bootParams = new URLSearchParams(location.search);
const bootScene = bootParams.get('scene');
const debugScenes = new Set(['briefing', 'battle', 'shop', 'prologue', 'title', 'skirmish', 'ending', 'setup']);
if (debugScenes.has(bootScene)) {
  assetsReady.then(() => {
    openDebugScene(bootScene);
    syncMute();
  });
} else {
  playIntroThenTitle();
  syncMute();
}
