import { typeOf, effectiveStrength, UNIT_TYPES } from './data/units.js';
import { TERRAIN } from './data/terrain.js';
import { hexDistance } from './hex.js';
import { shopCatalog, slotsUsed, refillCost, MAX_SLOTS, DIFFICULTIES } from './campaign.js';
import { SCENARIOS } from './data/scenarios.js';
import {
  shopCatalogFor,
  canReinforce,
  canResupply,
  canForcedMarch,
  canDig,
  mergeDonors,
  canRally,
  canAmbush,
  canScout,
  canTestudo,
} from './actions.js';

export class UI {
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers;
    this.pendingAttack = null;
  }

  show(id) {
    for (const el of this.root.querySelectorAll('.screen')) el.classList.toggle('show', el.id === id);
  }

  renderIntro(intro) {
    this.show('screen-intro');
    const title = this.root.querySelector('#intro-title');
    const text = this.root.querySelector('#intro-text');
    if (title) title.textContent = intro.subtitle;
    if (text) text.textContent = intro.text;
  }

  renderPrologue(intro) {
    this.show('screen-prologue');
    this.root.querySelector('#prologue-title').textContent = intro.title;
    this.root.querySelector('#prologue-sub').textContent = intro.subtitle;
    this.root.querySelector('#prologue-text').textContent = intro.text;
  }

  renderTitle(hasSave, hasBattle) {
    this.show('screen-title');
    this.root.querySelector('#btn-continue').hidden = !hasSave;
    const resume = this.root.querySelector('#btn-resume');
    if (resume) resume.hidden = !hasBattle;
  }

  renderSetup(opts) {
    this.show('screen-setup');
    this.root.querySelector('#setup-title').textContent = opts.title;
    this.root.querySelector('#setup-lede').textContent = opts.lede;
    const diffs = this.root.querySelector('#setup-diffs');
    diffs.innerHTML = Object.entries(DIFFICULTIES)
      .map(
        ([id, d]) =>
          `<button class="choice ${opts.difficulty === id ? 'on' : ''}" data-diff="${id}"><b>${d.label}</b><small>${d.blurb}</small></button>`
      )
      .join('');
    diffs.querySelectorAll('[data-diff]').forEach((b) => {
      b.onclick = () => this.h.onSetup('difficulty', b.dataset.diff);
    });
    const fac = this.root.querySelector('#setup-factions');
    fac.hidden = !opts.showFaction;
    if (opts.showFaction) {
      fac.innerHTML = `
        <button class="choice ${opts.faction === 'rome' ? 'on' : ''}" data-fac="rome"><b>Rome</b><small>Legions and auxilia</small></button>
        <button class="choice ${opts.faction === 'germania' ? 'on' : ''}" data-fac="germania"><b>The tribes</b><small>Warbands under Arminius</small></button>`;
      fac.querySelectorAll('[data-fac]').forEach((b) => {
        b.onclick = () => this.h.onSetup('faction', b.dataset.fac);
      });
    }
  }

  renderSkirmish() {
    this.show('screen-skirmish');
    const list = this.root.querySelector('#skirmish-list');
    list.innerHTML = SCENARIOS.map(
      (s) => `<article>
        <div class="skirmish-art" style="background-image:url(assets/briefings/${s.briefingArt})"></div>
        <h4>${s.title}</h4>
        <p>${s.year} · ${s.subtitle}</p>
        <div class="row-btns">
          <button data-sk="${s.id}" data-fac="rome">As Rome</button>
          <button data-sk="${s.id}" data-fac="germania">As the tribes</button>
        </div>
      </article>`
    ).join('');
    list.querySelectorAll('[data-sk]').forEach((b) => {
      b.onclick = () => this.h.onSkirmish(b.dataset.sk, b.dataset.fac);
    });
  }

  renderBriefing(scenario, campaign) {
    this.show('screen-briefing');
    const art = this.root.querySelector('#briefing-art');
    art.style.backgroundImage = `url(assets/briefings/${scenario.briefingArt})`;
    this.root.querySelector('#briefing-year').textContent = scenario.year;
    this.root.querySelector('#briefing-title').textContent = scenario.title;
    this.root.querySelector('#briefing-sub').textContent = scenario.subtitle;
    this.root.querySelector('#briefing-text').textContent = scenario.briefing;
    this.root.querySelector('#briefing-honors').textContent = campaign.honors ?? '—';
    const subExtra = campaign.difficulty ? ` · ${campaign.difficulty}` : '';
    this.root.querySelector('#briefing-sub').textContent = scenario.subtitle + subExtra;
    const objs = this.root.querySelector('#briefing-objs');
    objs.innerHTML = scenario.objectives.map((o) => `<li>${o.required ? 'Required' : 'Optional'} — ${o.text}</li>`).join('');
    const hints = this.root.querySelector('#briefing-hints');
    hints.innerHTML = (scenario.hints || []).map((h) => `<li>${h}</li>`).join('');
  }

  renderBattle(battle) {
    this.show('screen-battle');
    this.root.querySelector('#hud-turn').textContent =
      battle.phase === 'deploy' ? 'Deployment' : `Turn ${battle.turn} / ${battle.maxTurns}`;
    this.root.querySelector('#hud-weather').textContent = weatherLabel(battle.weather);
    const honors = this.root.querySelector('#hud-honors');
    if (honors) honors.textContent = battle.treasury ?? 0;
    const phaseEl = this.root.querySelector('#hud-phase');
    phaseEl.textContent =
      battle.phase === 'deploy' ? 'Dress the line' : battle.phase === 'player' ? 'Your move' : 'Enemy move';
    phaseEl.dataset.phase = battle.phase;
    const objs = this.root.querySelector('#hud-objs');
    objs.innerHTML = battle.objectives
      .map((o) => `<li class="${o.done ? 'done' : ''} ${o.required ? 'req' : ''}">${o.done ? '✓' : '○'} ${o.text}</li>`)
      .join('');
    const log = this.root.querySelector('#hud-log');
    log.innerHTML = battle.log.slice(0, 8).map((l) => `<div><span>T${l.turn}</span>${l.msg}</div>`).join('');
    this.renderPortrait(battle.selected, battle);
    this.renderDeploy(battle);
    const end = this.root.querySelector('#btn-end');
    end.disabled = (battle.phase !== 'player' && battle.phase !== 'deploy') || !!battle.result;
    end.textContent = battle.phase === 'deploy' ? 'Begin battle' : 'End turn';
    const save = this.root.querySelector('#btn-save');
    if (save) save.disabled = battle.mode !== 'campaign' || !!battle.result;
    const undo = this.root.querySelector('#btn-undo');
    if (undo) undo.disabled = !battle.lastMove || battle.phase !== 'player';
    const wait = this.root.querySelector('#btn-wait');
    if (wait) wait.disabled = battle.phase !== 'player';
  }

  renderDeploy(battle) {
    const panel = this.root.querySelector('#deploy-panel');
    if (!panel) return;
    const show = battle.phase === 'deploy';
    panel.hidden = !show;
    if (!show) return;
    const hint = this.root.querySelector('#deploy-hint');
    if (hint) {
      hint.textContent = battle.pendingBuy
        ? `Placing ${UNIT_TYPES[battle.pendingBuy].name}. Click an empty gold hex, or right-click to cancel.`
        : 'Green hexes are your deployment. Raise a cohort, then click an empty hex. Select a unit and click another green hex to dress the line.';
    }
    const cat = this.root.querySelector('#deploy-cat');
    cat.innerHTML = shopCatalogFor(battle.playerFaction)
      .map((t) => {
        const empty = battle.emptyDeployHexes().length;
        const disabled = battle.treasury < t.cost || empty === 0;
        const on = battle.pendingBuy === t.id ? 'on' : '';
        return `<article class="${on}">
          <img class="sart" src="assets/portraits/${t.portrait}" alt="" />
          <div>
            <h4>${t.name}</h4>
            <p>melee ${t.meleeAtk}/${t.meleeDef} · mv ${t.move}</p>
            <button data-buy="${t.id}" ${disabled ? 'disabled' : ''}>Raise ${t.cost}</button>
          </div>
        </article>`;
      })
      .join('');
    cat.querySelectorAll('[data-buy]').forEach((b) => {
      b.onclick = () => this.h.onDeployBuy(b.dataset.buy);
    });
  }

  renderPortrait(unit, battle) {
    const card = this.root.querySelector('#portrait-card');
    if (!unit) {
      card.classList.add('empty');
      card.innerHTML = `<div class="empty-hint">Select a cohort.<br>Blue hexes move · red hexes attack.<br>R replacements · V veteran drafts · I resupply.<br>N next · Space hold · U undo · Enter end.</div>`;
      return;
    }
    card.classList.remove('empty');
    const t = typeOf(unit);
    const terr = TERRAIN[battle.cell(unit.q, unit.r)?.terrain] || TERRAIN.clear;
    const stars = '★'.repeat(unit.experience) + '☆'.repeat(Math.max(0, 5 - unit.experience));
    const actions = this.actionButtons(unit, battle);
    const tags = [];
    if (unit.core) tags.push('Core');
    else if (unit.hiredThisBattle) tags.push('Levy');
    else tags.push('Auxilia');
    tags.push(t.class);
    if (unit.testudo) tags.push('Testudo');
    if (unit.forcedMarch) tags.push('Forced march');
    if (unit.hidden) tags.push('Hidden');
    card.innerHTML = `
      <img class="pcard-art" src="assets/portraits/${t.portrait}" alt="" />
      <div class="pcard-body">
        <div class="pcard-kicker">${tags.join(' · ')}</div>
        <h3>${unit.name}</h3>
        <div class="stars">${stars}</div>
        <dl>
          <div><dt>Strength</dt><dd>${effectiveStrength(unit)} / ${unit.strength}${unit.disorder ? ` <em>(${unit.disorder} disordered)</em>` : ''} <em>max ${unit.maxStrength}</em></dd></div>
          <div><dt>Move</dt><dd>${unit.mpRemaining} / ${t.move}${unit.forcedMarch ? ' <em>+march</em>' : ''}</dd></div>
          <div><dt>Init / Melee</dt><dd>${t.initiative} · ${t.meleeAtk}/${t.meleeDef}</dd></div>
          <div><dt>Missile</dt><dd>${t.range ? `${t.missileAtk} rng ${t.range} · ammo ${unit.ammo}` : '—'}</dd></div>
          <div><dt>Ground</dt><dd>${terr.name}${unit.entrench ? ` · works ${unit.entrench}` : ''}${unit.inSupply ? '' : ' · OUT OF SUPPLY'}</dd></div>
        </dl>
        <div class="pcard-acts">${actions.join('')}</div>
      </div>`;
    card.querySelectorAll('button[data-act]').forEach((b) => {
      b.addEventListener('click', () => {
        const donor = b.dataset.donor ? battle.unitById(b.dataset.donor) : null;
        this.h.onSpecial(b.dataset.act, unit, donor);
      });
    });
  }

  actionButtons(unit, battle) {
    const actions = [];
    const t = typeOf(unit);
    const terr = TERRAIN[battle.cell(unit.q, unit.r)?.terrain] || TERRAIN.clear;
    const deploy = battle.phase === 'deploy';
    const play = battle.phase === 'player';

    const ref = canReinforce(battle, unit, false);
    if (ref.ok) {
      actions.push(`<button data-act="reinforce">Replacements ${ref.cost} · +${ref.points} (R)</button>`);
    }
    const elite = canReinforce(battle, unit, true);
    if (elite.ok) {
      actions.push(`<button data-act="elite">Veteran drafts ${elite.cost} · +${elite.points} (V)</button>`);
    }
    if (canResupply(battle, unit).ok) {
      actions.push(`<button data-act="resupply">Draw ammunition (I)</button>`);
    }
    if (canForcedMarch(battle, unit).ok) {
      actions.push(`<button data-act="march">Forced march +2 mp (X)</button>`);
    }
    if (canDig(battle, unit).ok) {
      actions.push(`<button data-act="dig">Throw up works (G)</button>`);
    }
    if (canTestudo(battle, unit).ok) {
      actions.push(`<button data-act="testudo">${unit.testudo ? 'Break testudo' : 'Form testudo'}</button>`);
    }
    if (t.traits.includes('engineer') && play && !unit.acted) {
      actions.push(`<button data-act="engineer">Repair / Fortify</button>`);
    }
    if (terr.burnable && !battle.cell(unit.q, unit.r).burned && unit.faction === 'rome' && play && !unit.acted) {
      actions.push(`<button data-act="burn">Put village to the torch</button>`);
    }
    if (canRally(battle, unit).ok) {
      actions.push(`<button data-act="rally">Rally the line (Y)</button>`);
    }
    if (canScout(battle, unit).ok) {
      actions.push(`<button data-act="scout">Scout the timber (C)</button>`);
    }
    if (canAmbush(battle, unit).ok) {
      actions.push(`<button data-act="ambush">Lie in wait (L)</button>`);
    }
    for (const d of mergeDonors(battle, unit)) {
      actions.push(`<button data-act="merge" data-donor="${d.id}">Absorb ${d.name}</button>`);
    }
    if (deploy && unit.hiredThisBattle) {
      actions.push(`<button data-act="dismiss" class="ghost">Send back (+${t.cost})</button>`);
    }
    if (play && !unit.acted) {
      actions.push(`<button data-act="wait" class="ghost">Hold (Space)</button>`);
    }
    return actions;
  }

  showPreview(prev, attacker, defender, missile, onConfirm, onCancel) {
    this.pendingAttack = { attacker, defender, missile };
    const el = this.root.querySelector('#combat-preview');
    el.classList.add('show');
    const ctx = prev.ctx;
    const mods = ctx.mods
      .map((m) => `<li>${m.label} <b>${m.val > 0 ? '+' : ''}${m.val}</b></li>`)
      .join('');
    el.innerHTML = `
      <div class="cp-head">${missile ? 'Volley' : 'Melee'}</div>
      <div class="cp-row">
        <div class="cp-side">
          <img class="cp-art" src="assets/portraits/${typeOf(attacker).portrait}" alt="" />
          <div>${attacker.name}</div>
          <div class="exp">deal ~${prev.toDefender.kills.toFixed(1)} slain / ${prev.toDefender.disorder.toFixed(1)} disorder</div>
        </div>
        <div class="cp-vs">⚔</div>
        <div class="cp-side">
          <img class="cp-art" src="assets/portraits/${typeOf(defender).portrait}" alt="" />
          <div>${defender.name}</div>
          <div class="exp">return ~${prev.toAttacker.kills.toFixed(1)} slain / ${prev.toAttacker.disorder.toFixed(1)} disorder</div>
        </div>
      </div>
      <div class="cp-meta">ATK ${ctx.atk} vs DEF ${ctx.def} · Init ${ctx.aInit} / ${ctx.dInit}${prev.firstStrike ? ' · first strike' : ''}${prev.defenderFirst ? ' · they strike first' : ''}</div>
      <ul class="cp-mods">${mods || '<li>No modifiers</li>'}</ul>
      <div class="cp-acts">
        <button class="ghost" id="cp-cancel">Hold</button>
        <button class="gold" id="cp-go">Commit</button>
      </div>`;
    el.querySelector('#cp-go').onclick = () => {
      el.classList.remove('show');
      onConfirm();
    };
    el.querySelector('#cp-cancel').onclick = () => {
      el.classList.remove('show');
      onCancel();
    };
  }

  hidePreview() {
    this.root.querySelector('#combat-preview').classList.remove('show');
  }

  hexTip(battle, hex) {
    const el = this.root.querySelector('#hextip');
    if (!hex) {
      el.classList.remove('show');
      return;
    }
    const c = battle.cell(hex.q, hex.r);
    if (!c) {
      el.classList.remove('show');
      return;
    }
    const terr = TERRAIN[c.terrain];
    const u = battle.unitAt(hex.q, hex.r);
    const hideUnit = u && u.hidden && u.faction !== battle.playerFaction;
    el.classList.add('show');
    const deploy = battle.phase === 'deploy' && battle.inDeploy(c.q, c.r);
    el.innerHTML = `<b>${terr.name}</b> · move ${terr.move} · def +${terr.meleeDef}
      ${deploy ? '<div>Deployment hex.</div>' : ''}
      ${c.eagle ? '<div>The lost eagle is here.</div>' : ''}
      ${c.grave && !c.buried ? '<div>Unburied dead of Varus.</div>' : ''}
      ${!hideUnit && u ? `<div>${u.name} · ${effectiveStrength(u)} strength</div>` : ''}`;
  }

  renderAar(battle, follow) {
    this.show('screen-aar');
    const r = battle.result;
    const art = this.root.querySelector('#aar-art');
    if (art) {
      const file = battle.scenario?.briefingArt || 'title.png';
      art.style.backgroundImage = `url(assets/briefings/${file})`;
    }
    this.root.querySelector('#aar-kind').textContent = r.title;
    this.root.querySelector('#aar-kind').dataset.kind = r.kind;
    this.root.querySelector('#aar-text').textContent = r.text;
    this.root.querySelector('#aar-honors').textContent = `+${battle.honorsEarned} Honors`;
    this.root.querySelector('#aar-cas').innerHTML = `
      <div><span>Roman dead</span><b>${battle.casualties.rome}</b></div>
      <div><span>German dead</span><b>${battle.casualties.germania}</b></div>`;
    const btn = this.root.querySelector('#aar-next');
    btn.textContent = follow === 'retry' ? 'Try the field again' : follow === 'ending' ? 'The recall' : 'Return to camp';
  }

  renderShop(campaign) {
    this.show('screen-shop');
    this.root.querySelector('#shop-honors').textContent = campaign.honors;
    this.root.querySelector('#shop-slots').textContent = `${slotsUsed(campaign)} / ${MAX_SLOTS}`;
    const next = SCENARIOS[campaign.mission];
    this.root.querySelector('#shop-next').textContent = next ? `Next: ${next.title}` : 'Campaign complete';
    const roster = this.root.querySelector('#shop-roster');
    roster.innerHTML = campaign.core
      .map((u) => {
        const t = UNIT_TYPES[u.typeId];
        const refill = refillCost(u);
        return `<article data-id="${u.id}">
          <img class="sart" src="assets/portraits/${t.portrait}" alt="" />
          <div>
            <h4>${u.name}</h4>
            <p>${t.name} · ${u.strength}/${t.maxStrength} · ${'★'.repeat(u.experience)}</p>
            <div class="sacts">
              <button data-refill="${u.id}" ${refill === 0 || campaign.honors < refill ? 'disabled' : ''}>Replacements ${refill || '—'}</button>
              <button data-over="${u.id}" ${u.strength >= (t.overstrength || t.maxStrength) || campaign.honors < 15 ? 'disabled' : ''}>Overstrength 15</button>
              <button data-dismiss="${u.id}" class="ghost">Dismiss</button>
            </div>
          </div>
        </article>`;
      })
      .join('');
    const cat = this.root.querySelector('#shop-cat');
    cat.innerHTML = shopCatalog()
      .map(
        (t) => `<article>
          <img class="sart" src="assets/portraits/${t.portrait}" alt="" />
          <div>
            <h4>${t.name}</h4>
            <p>${t.slots} slot · melee ${t.meleeAtk}/${t.meleeDef}</p>
            <button data-buy="${t.id}" ${campaign.honors < t.cost || slotsUsed(campaign) + t.slots > MAX_SLOTS ? 'disabled' : ''}>Hire ${t.cost}</button>
          </div>
        </article>`
      )
      .join('');
    roster.querySelectorAll('[data-refill]').forEach((b) => (b.onclick = () => this.h.onShop('refill', b.dataset.refill)));
    roster.querySelectorAll('[data-over]').forEach((b) => (b.onclick = () => this.h.onShop('over', b.dataset.over)));
    roster.querySelectorAll('[data-dismiss]').forEach((b) => (b.onclick = () => this.h.onShop('dismiss', b.dataset.dismiss)));
    cat.querySelectorAll('[data-buy]').forEach((b) => (b.onclick = () => this.h.onShop('buy', b.dataset.buy)));
  }

  renderEnding(text) {
    this.show('screen-ending');
    this.root.querySelector('#ending-text').textContent = text;
  }
}

function weatherLabel(w) {
  if (w === 'rain') return 'Rain';
  if (w === 'fog') return 'Fog';
  return 'Fair skies';
}
