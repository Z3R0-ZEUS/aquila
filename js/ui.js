import { typeOf, effectiveStrength, UNIT_TYPES } from './data/units.js';
import { TERRAIN } from './data/terrain.js';
import { hexDistance } from './hex.js';
import { shopCatalog, slotsUsed, refillCost, MAX_SLOTS } from './campaign.js';
import { SCENARIOS } from './data/scenarios.js';

export class UI {
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers;
    this.pendingAttack = null;
  }

  show(id) {
    for (const el of this.root.querySelectorAll('.screen')) el.classList.toggle('show', el.id === id);
  }

  renderTitle(hasSave) {
    this.show('screen-title');
    const cont = this.root.querySelector('#btn-continue');
    cont.hidden = !hasSave;
  }

  renderBriefing(scenario, campaign) {
    this.show('screen-briefing');
    const art = this.root.querySelector('#briefing-art');
    art.style.backgroundImage = `url(assets/briefings/${scenario.briefingArt})`;
    this.root.querySelector('#briefing-year').textContent = scenario.year;
    this.root.querySelector('#briefing-title').textContent = scenario.title;
    this.root.querySelector('#briefing-sub').textContent = scenario.subtitle;
    this.root.querySelector('#briefing-text').textContent = scenario.briefing;
    this.root.querySelector('#briefing-honors').textContent = campaign.honors;
    const objs = this.root.querySelector('#briefing-objs');
    objs.innerHTML = scenario.objectives.map((o) => `<li>${o.required ? 'Required' : 'Optional'} — ${o.text}</li>`).join('');
    const hints = this.root.querySelector('#briefing-hints');
    hints.innerHTML = (scenario.hints || []).map((h) => `<li>${h}</li>`).join('');
  }

  renderBattle(battle) {
    this.show('screen-battle');
    this.root.querySelector('#hud-turn').textContent = `Turn ${battle.turn} / ${battle.maxTurns}`;
    this.root.querySelector('#hud-weather').textContent = weatherLabel(battle.weather);
    this.root.querySelector('#hud-phase').textContent = battle.phase === 'player' ? 'Your move' : 'Enemy move';
    this.root.querySelector('#hud-phase').dataset.phase = battle.phase;
    const objs = this.root.querySelector('#hud-objs');
    objs.innerHTML = battle.objectives
      .map((o) => `<li class="${o.done ? 'done' : ''} ${o.required ? 'req' : ''}">${o.done ? '✓' : '○'} ${o.text}</li>`)
      .join('');
    const log = this.root.querySelector('#hud-log');
    log.innerHTML = battle.log.slice(0, 8).map((l) => `<div><span>T${l.turn}</span>${l.msg}</div>`).join('');
    this.renderPortrait(battle.selected, battle);
    this.root.querySelector('#btn-end').disabled = battle.phase !== 'player' || !!battle.result;
  }

  renderPortrait(unit, battle) {
    const card = this.root.querySelector('#portrait-card');
    if (!unit) {
      card.classList.add('empty');
      card.innerHTML = `<div class="empty-hint">Select a cohort.<br>Blue hexes move · red hexes attack.<br>WASD pan · scroll zoom · F fit · Enter end turn.</div>`;
      return;
    }
    card.classList.remove('empty');
    const t = typeOf(unit);
    const terr = TERRAIN[battle.cell(unit.q, unit.r)?.terrain] || TERRAIN.clear;
    const stars = '★'.repeat(unit.experience) + '☆'.repeat(Math.max(0, 5 - unit.experience));
    const actions = [];
    if (t.traits.includes('engineer') && !unit.acted) {
      actions.push(`<button data-act="engineer">Repair / Fortify</button>`);
    }
    if (terr.burnable && !battle.cell(unit.q, unit.r).burned && unit.faction === 'rome' && !unit.acted) {
      actions.push(`<button data-act="burn">Put village to the torch</button>`);
    }
    card.innerHTML = `
      <img class="pcard-art" src="assets/portraits/${t.portrait}" alt="" />
      <div class="pcard-body">
        <div class="pcard-kicker">${unit.core ? 'Core' : 'Auxilia'} · ${t.class}</div>
        <h3>${unit.name}</h3>
        <div class="stars">${stars}</div>
        <dl>
          <div><dt>Strength</dt><dd>${effectiveStrength(unit)} / ${unit.strength}${unit.disorder ? ` <em>(${unit.disorder} disordered)</em>` : ''}</dd></div>
          <div><dt>Move</dt><dd>${unit.mpRemaining} / ${t.move}</dd></div>
          <div><dt>Init / Melee</dt><dd>${t.initiative} · ${t.meleeAtk}/${t.meleeDef}</dd></div>
          <div><dt>Missile</dt><dd>${t.range ? `${t.missileAtk} rng ${t.range} · ammo ${unit.ammo}` : '—'}</dd></div>
          <div><dt>Ground</dt><dd>${terr.name}${unit.entrench ? ` · works ${unit.entrench}` : ''}${unit.inSupply ? '' : ' · OUT OF SUPPLY'}</dd></div>
        </dl>
        <div class="pcard-acts">${actions.join('')}</div>
      </div>`;
    card.querySelectorAll('button[data-act]').forEach((b) => {
      b.addEventListener('click', () => this.h.onSpecial(b.dataset.act, unit));
    });
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
    const hideUnit = u && u.hidden && u.faction !== 'rome';
    el.classList.add('show');
    el.innerHTML = `<b>${terr.name}</b> · move ${terr.move} · def +${terr.meleeDef}
      ${c.eagle ? '<div>The lost eagle is here.</div>' : ''}
      ${c.grave && !c.buried ? '<div>Unburied dead of Varus.</div>' : ''}
      ${!hideUnit && u ? `<div>${u.name} · ${effectiveStrength(u)} strength</div>` : ''}`;
  }

  renderAar(battle, follow) {
    this.show('screen-aar');
    const r = battle.result;
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
