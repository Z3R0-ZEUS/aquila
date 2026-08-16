import { Battle } from './game.js';
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
} from './campaign.js';
import { typeOf } from './data/units.js';
import { canMelee, inMissileRange } from './combat.js';
import { hexDistance } from './hex.js';
import { reachable } from './pathfind.js';
import { CAMPAIGN_INTRO } from './data/scenarios.js';
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
  ['tile-forest', 'assets/tiles/forest.png'],
  ['tile-lightForest', 'assets/tiles/forest.png'],
  ['tile-denseForest', 'assets/tiles/dense.png'],
  ['tile-dense', 'assets/tiles/dense.png'],
  ['tile-marsh', 'assets/tiles/marsh.png'],
  ['tile-hill', 'assets/tiles/hill.png'],
  ['tile-water', 'assets/tiles/water.png'],
  ['tile-ford', 'assets/tiles/water.png'],
  ['tile-village', 'assets/tiles/village.png'],
  ['tile-oppidum', 'assets/tiles/village.png'],
  ['tile-castra', 'assets/tiles/castra.png'],
  ['tile-causeway', 'assets/tiles/causeway.png'],
  ['tile-brokenCauseway', 'assets/tiles/causeway.png'],
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

const ui = new UI(app, {
  onSpecial(act, unit) {
    if (!battle || battle.phase !== 'player') return;
    if (act === 'engineer') battle.engineerAction(unit);
    if (act === 'burn') battle.burnVillage(unit);
    ui.renderBattle(battle);
    maybeEnd();
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
});

function syncMute() {
  const btn = document.getElementById('btn-mute');
  if (btn) btn.textContent = isMuted() ? 'Sound off' : 'Sound on';
}

function openTitle() {
  ui.renderTitle(!!loadCampaign());
}

function startNew() {
  unlock();
  sfx.ui();
  campaign = newCampaign();
  saveCampaign(campaign);
  ui.renderBriefing(currentScenario(campaign), campaign);
}

function continueCamp() {
  unlock();
  sfx.ui();
  campaign = loadCampaign() || newCampaign();
  if (campaign.mission >= 5) {
    ui.renderEnding(CAMPAIGN_INTRO.text);
    return;
  }
  ui.renderShop(campaign);
}

function deploy() {
  unlock();
  sfx.click();
  const sc = currentScenario(campaign);
  battle = new Battle(sc, { core: campaign.core });
  ui.renderBattle(battle);
  requestAnimationFrame(() => {
    view.resize();
    view.fitMap(battle);
  });
}

function maybeEnd() {
  if (battle && battle.result) {
    setTimeout(() => {
      const follow = applyBattleResult(campaign, battle);
      aarFollow = follow.next;
      saveCampaign(campaign);
      if (battle.result.kind === 'defeat') sfx.defeat();
      else sfx.victory();
      ui.renderAar(battle, aarFollow);
      ui._endingText = follow.ending;
    }, 450);
  }
}

async function endTurn() {
  if (!battle || battle.phase !== 'player' || battle.result) return;
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
  ui.renderBattle(battle);
  maybeEnd();
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function onMapClick(sx, sy, button) {
  if (!battle || battle.phase !== 'player' || battle.result) return;
  if (button === 2) {
    battle.selectedId = null;
    ui.hidePreview();
    ui.renderBattle(battle);
    return;
  }
  const hex = view.hexAtScreen(sx, sy);
  const unit = battle.unitAt(hex.q, hex.r);

  if (unit && unit.faction === 'rome') {
    battle.select(unit.id);
    sfx.select();
    ui.hidePreview();
    ui.renderBattle(battle);
    return;
  }

  const sel = battle.selected;
  if (!sel || sel.acted) return;

  if (unit && unit.faction === 'germania' && !unit.hidden) {
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
        }
      }
    }
    const missile = !canMelee(sel, unit) && (inMissileRange(battle, sel, unit) || (typeOf(sel).range > 0 && sel.ammo > 0 && hexDistance(sel, unit) <= typeOf(sel).range));
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
  if (e.key === 'Enter' && document.getElementById('screen-battle').classList.contains('show')) endTurn();
  if (e.key === 'Escape') {
    if (battle) battle.selectedId = null;
    ui.hidePreview();
    if (battle) ui.renderBattle(battle);
  }
  if ((e.key === 'f' || e.key === 'F') && battle) view.fitMap(battle);
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

document.addEventListener('pointerdown', () => unlock(), { once: true });
document.getElementById('btn-mute').onclick = () => {
  toggleMute();
  syncMute();
};
document.getElementById('btn-new').onclick = startNew;
document.getElementById('btn-continue').onclick = continueCamp;
document.getElementById('btn-deploy').onclick = deploy;
document.getElementById('btn-brief-back').onclick = () => ui.renderShop(campaign);
document.getElementById('btn-end').onclick = endTurn;
document.getElementById('aar-next').onclick = () => {
  if (aarFollow === 'retry') ui.renderBriefing(currentScenario(campaign), campaign);
  else if (aarFollow === 'ending') ui.renderEnding(ui._endingText || '');
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

loadAssets().then(() => {
  const params = new URLSearchParams(location.search);
  const scene = params.get('scene');
  if (scene === 'briefing' || scene === 'battle' || scene === 'shop') {
    campaign = newCampaign();
    const m = Number(params.get('mission') || 0);
    if (Number.isFinite(m) && m >= 0 && m < 5) campaign.mission = m;
    if (scene === 'shop') ui.renderShop(campaign);
    else if (scene === 'battle') deploy();
    else ui.renderBriefing(currentScenario(campaign), campaign);
  } else {
    openTitle();
  }
  syncMute();
  loop();
});
