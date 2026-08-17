import { hexToPixel, hexCorners, pixelToHex, hexDistance, DIRS, add } from './hex.js';
import { TERRAIN } from './data/terrain.js';
import { typeOf, effectiveStrength } from './data/units.js';
import { reachable } from './pathfind.js';
import { inMissileRange, canMelee } from './combat.js';
import { artOf, visualHeight, FLOOR } from './terrainArt.js';

const SIZE0 = 40;
const TAU = Math.PI * 2;

export class MapView {
  constructor(canvas, images) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.images = images || {};
    this.cam = { x: 80, y: 80, scale: 1 };
    this.hover = null;
    this.drag = null;
    this.shake = 0;
    this.fx = [];
    this.anims = [];
    this.corpses = [];
    this.pulse = 0;
    this.time = 0;
    this._battle = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, r.width * dpr);
    this.canvas.height = Math.max(1, r.height * dpr);
    this.dpr = dpr;
    this.w = r.width;
    this.h = r.height;
  }

  size() {
    return SIZE0 * this.cam.scale;
  }

  screenToWorld(sx, sy) {
    return { x: sx - this.cam.x, y: sy - this.cam.y };
  }

  hexAtScreen(sx, sy) {
    const w = this.screenToWorld(sx, sy);
    const size = this.size();
    const guess = pixelToHex(w.x, w.y, size);
    if (!this._battle) return guess;
    let best = guess;
    let bestD = Infinity;
    const ring = [guess, ...DIRS.map((d) => add(guess, d))];
    for (const h of ring) {
      const c = this._battle.cell(h.q, h.r);
      if (!c) continue;
      const p = this.topOf(c, size);
      const d = (p.x - w.x) ** 2 + (p.y - w.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }

  pan(dx, dy) {
    this.cam.x += dx;
    this.cam.y += dy;
  }

  fitMap(battle) {
    if (!this.w || !this.h) this.resize();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of battle.cells.values()) {
      const p = hexToPixel(c.q, c.r, SIZE0);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    if (!isFinite(minX)) return;
    const padX = 360;
    const padY = 100;
    const bw = maxX - minX + SIZE0 * 2.4;
    const bh = maxY - minY + SIZE0 * 2.4;
    this.cam.scale = Math.max(0.55, Math.min(1.35, Math.min((this.w - padX) / bw, (this.h - padY) / bh)));
    const size = SIZE0 * this.cam.scale;
    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;
    for (const c of battle.cells.values()) {
      const p = hexToPixel(c.q, c.r, size);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    this.cam.x = this.w / 2 - (minX + maxX) / 2 + 50;
    this.cam.y = this.h / 2 - (minY + maxY) / 2 + 8;
  }

  playMove(from, to) {
    this.anims.push({
      kind: 'move',
      q0: from.q,
      r0: from.r,
      q1: to.q,
      r1: to.r,
      t: 0,
      life: 0.28,
    });
    this.burst(to.q, to.r, 6, 'dust');
  }

  playCombat(attacker, defender, result, missile) {
    this.anims.push({
      kind: missile ? 'missile' : 'lunge',
      q0: attacker.q,
      r0: attacker.r,
      q1: defender.q,
      r1: defender.r,
      t: 0,
      life: missile ? 0.38 : 0.32,
    });
    this.addFlash(defender.q, defender.r);
    this.burst(defender.q, defender.r, missile ? 10 : 16, missile ? 'spark' : 'clash');
    if (result?.aKills) this.addFloat(defender.q, defender.r, `−${result.aKills}`, '#ffd4a0');
    if (result?.dKills) this.addFloat(attacker.q, attacker.r, `−${result.dKills}`, '#ff8a70');
    if (result?.defenderDead) this.addDeath(defender);
    if (result?.attackerDead) this.addDeath(attacker);
    this.shake = missile ? 5 : 10;
  }

  addDeath(unit) {
    this.corpses.push({
      q: unit.q,
      r: unit.r,
      faction: unit.faction,
      portrait: typeOf(unit).portrait,
      t: 0,
      life: 0.85,
    });
    this.burst(unit.q, unit.r, 22, 'death');
    this.addFloat(unit.q, unit.r, 'DESTROYED', '#ffb070');
  }

  addFloat(q, r, text, color) {
    const p = hexToPixel(q, r, this.size());
    this.fx.push({ kind: 'float', x: p.x, y: p.y, text, color, t: 0, life: 1.05 });
  }

  addFlash(q, r) {
    this.fx.push({ kind: 'flash', q, r, t: 0, life: 0.32 });
  }

  burst(q, r, n, style) {
    const p = hexToPixel(q, r, this.size());
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const sp = 18 + Math.random() * 46;
      this.fx.push({
        kind: 'part',
        style,
        x: p.x,
        y: p.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        t: 0,
        life: 0.35 + Math.random() * 0.35,
      });
    }
  }

  visualHex(q, r) {
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      if (a.kind === 'move' && a.q1 === q && a.r1 === r) {
        const k = easeOut(a.t / a.life);
        return { q: a.q0 + (a.q1 - a.q0) * k, r: a.r0 + (a.r1 - a.r0) * k, moving: true };
      }
      if (a.kind === 'lunge' && a.q0 === q && a.r0 === r) {
        const u = a.t / a.life;
        const k = u < 0.45 ? u / 0.45 : 1 - (u - 0.45) / 0.55;
        return { q: a.q0 + (a.q1 - a.q0) * k * 0.45, r: a.r0 + (a.r1 - a.r0) * k * 0.45, lunging: true };
      }
    }
    return { q, r };
  }

  topOf(c, size) {
    const p = hexToPixel(c.q, c.r, size);
    return { x: p.x, y: p.y - visualHeight(c.terrain) * size };
  }

  bottomOf(c, size) {
    const p = hexToPixel(c.q, c.r, size);
    return { x: p.x, y: p.y + FLOOR * size };
  }

  draw(battle) {
    const ctx = this.ctx;
    const dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = this.w;
    const h = this.h;
    this._battle = battle;
    this.pulse += 0.03;
    this.time += 0.016;
    if (this.shake > 0) this.shake *= 0.82;
    this.tickAnims();

    const sky = battle.weather === 'fog' ? '#121410' : battle.weather === 'rain' ? '#101614' : '#152016';
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    const wash = ctx.createRadialGradient(w * 0.45, h * 0.35, 40, w * 0.5, h * 0.55, Math.max(w, h) * 0.75);
    wash.addColorStop(0, battle.weather === 'fog' ? 'rgba(40,46,34,0.35)' : 'rgba(28,38,26,0.28)');
    wash.addColorStop(1, 'rgba(6,8,6,0)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.cam.x + (Math.random() - 0.5) * this.shake, this.cam.y + (Math.random() - 0.5) * this.shake);

    const size = this.size();
    const moveSet = new Set();
    const atkSet = new Map();
    const sel = battle.selected;
    if (sel && battle.phase === 'player' && !sel.acted) {
      for (const hx of reachable(battle, sel).hexes) moveSet.add(`${hx.q},${hx.r}`);
      for (const e of battle.units) {
        if (e.strength <= 0 || e.faction === sel.faction || (e.hidden && hexDistance(sel, e) > 1)) continue;
        if (canMelee(sel, e)) atkSet.set(`${e.q},${e.r}`, 'melee');
        else if (inMissileRange(battle, sel, e) || (typeOf(sel).range > 0 && sel.ammo > 0 && hexDistance(sel, e) <= typeOf(sel).range)) {
          atkSet.set(`${e.q},${e.r}`, 'missile');
        }
      }
    }

    const cells = [...battle.cells.values()].sort((a, b) => a.r - b.r || a.q - b.q);
    for (const c of cells) this.drawShadow(c, size);
    for (const c of cells) this.drawPuck(c, size, battle);

    for (const c of cells) {
      const k = `${c.q},${c.r}`;
      if (moveSet.has(k)) this.tintHex(c, size, 'rgba(80,160,220,0.20)', 'rgba(150,210,255,0.78)');
      if (atkSet.has(k)) this.tintHex(c, size, 'rgba(180,40,30,0.24)', 'rgba(255,100,80,0.9)');
    }

    if (this.hover && battle.cell(this.hover.q, this.hover.r)) {
      this.tintHex(this.hover, size, 'rgba(255,230,160,0.08)', 'rgba(255,220,140,0.95)');
    }
    if (sel) this.tintHex(sel, size, 'rgba(212,175,55,0.12)', 'rgba(240,215,140,1)');

    for (const c of cells) this.drawProps(c, size, battle);
    for (const c of cells) this.drawMarkers(c, size);
    this.drawMissiles(size);
    for (const corpse of this.corpses) this.drawCorpse(corpse, size);
    for (const u of battle.units) {
      if (u.strength <= 0) continue;
      if (u.hidden && u.faction !== 'rome') continue;
      this.drawUnit(u, size, sel && sel.id === u.id);
    }
    this.drawFx(size);
    ctx.restore();

    if (battle.weather === 'fog') {
      ctx.fillStyle = 'rgba(18,22,16,0.22)';
      ctx.fillRect(0, 0, w, h);
    }
    if (battle.weather === 'rain') this.drawRain();

    const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.18, w / 2, h / 2, w * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.50)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  tickAnims() {
    const dt = 0.016;
    this.anims = this.anims.filter((a) => {
      a.t += dt;
      return a.t < a.life;
    });
    this.corpses = this.corpses.filter((c) => {
      c.t += dt;
      return c.t < c.life;
    });
  }

  hexPath(ctx, p, size) {
    const pts = hexCorners(p.x, p.y, size - 0.4);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    return pts;
  }

  pickAlbedo(c) {
    const keys = artOf(c.terrain).albedos || [];
    const ready = keys.map((k) => this.images[k]).filter((img) => img && img.complete && img.naturalWidth);
    if (!ready.length) return null;
    return ready[Math.floor(hash2(c.q, c.r) * ready.length) % ready.length];
  }

  drawShadow(c, size) {
    const ctx = this.ctx;
    const ground = hexToPixel(c.q, c.r, size);
    const h = visualHeight(c.terrain);
    const lift = Math.max(0, h);
    ctx.beginPath();
    ctx.ellipse(
      ground.x + size * 0.05,
      ground.y + FLOOR * size + size * 0.02,
      size * (0.78 + lift * 0.15),
      size * (0.38 + lift * 0.08),
      0,
      0,
      TAU
    );
    ctx.fillStyle = `rgba(0,0,0,${0.22 + lift * 0.18})`;
    ctx.fill();
  }

  drawPuck(c, size, battle) {
    const ctx = this.ctx;
    const art = artOf(c.terrain);
    const top = this.topOf(c, size);
    const bot = this.bottomOf(c, size);
    const tPts = hexCorners(top.x, top.y, size - 0.35);
    const bPts = hexCorners(bot.x, bot.y, size - 0.35);

    const faces = [];
    for (let i = 0; i < 6; i++) {
      const a = tPts[i];
      const b = tPts[(i + 1) % 6];
      const p1 = bPts[(i + 1) % 6];
      const p0 = bPts[i];
      faces.push({
        i,
        a,
        b,
        p1,
        p0,
        midY: (a.y + b.y + p1.y + p0.y) / 4,
      });
    }
    faces.sort((a, b) => a.midY - b.midY);

    for (const f of faces) {
      const out = (Math.PI / 180) * (60 * f.i);
      const nx = Math.cos(out);
      const ny = Math.sin(out);
      const lit = nx * -0.62 + ny * -0.78;
      const k = 0.40 + 0.50 * Math.max(0, (lit + 1) * 0.5);
      ctx.beginPath();
      ctx.moveTo(f.a.x, f.a.y);
      ctx.lineTo(f.b.x, f.b.y);
      ctx.lineTo(f.p1.x, f.p1.y);
      ctx.lineTo(f.p0.x, f.p0.y);
      ctx.closePath();
      ctx.fillStyle = shadeHex(art.side, k);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }

    this.hexPath(ctx, top, size);
    const img = this.pickAlbedo(c);
    if (img) {
      ctx.save();
      ctx.clip();
      const s = size * 2.18;
      const ox = (hash2(c.q, c.r) - 0.5) * size * 0.4;
      const oy = (hash2(c.r, c.q) - 0.5) * size * 0.4;
      ctx.drawImage(img, top.x - s / 2 + ox, top.y - s / 2 + oy, s, s);
      ctx.restore();
    } else {
      const terr = TERRAIN[c.terrain] || TERRAIN.clear;
      const grd = ctx.createLinearGradient(top.x, top.y - size, top.x, top.y + size);
      grd.addColorStop(0, terr.color);
      grd.addColorStop(1, terr.color2);
      ctx.fillStyle = grd;
      ctx.fill();
    }

    this.hexPath(ctx, top, size);
    const bevel = ctx.createLinearGradient(top.x - size, top.y - size, top.x + size, top.y + size);
    bevel.addColorStop(0, 'rgba(255,248,220,0.16)');
    bevel.addColorStop(0.42, 'rgba(255,255,255,0)');
    bevel.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = bevel;
    ctx.fill();

    if (battle.weather === 'rain') {
      this.hexPath(ctx, top, size);
      ctx.fillStyle = 'rgba(8,16,18,0.16)';
      ctx.fill();
    } else if (battle.weather === 'fog') {
      this.hexPath(ctx, top, size);
      ctx.fillStyle = 'rgba(36,40,32,0.12)';
      ctx.fill();
    }

    if (art.water) this.drawWater(c, top, size);

    if (c.burned) {
      this.hexPath(ctx, top, size);
      ctx.fillStyle = 'rgba(22,10,6,0.52)';
      ctx.fill();
    }

    this.drawTerrainEdges(c, top, size, battle);

    ctx.strokeStyle = 'rgba(8,10,6,0.38)';
    ctx.lineWidth = 1.05;
    this.hexPath(ctx, top, size);
    ctx.stroke();
  }

  drawWater(c, p, size) {
    const ctx = this.ctx;
    ctx.save();
    this.hexPath(ctx, p, size);
    ctx.clip();
    const t = this.time;
    ctx.strokeStyle = 'rgba(200,220,230,0.14)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const y = p.y - size * 0.65 + ((t * 10 + i * 16 + hash2(c.q, i) * 22) % (size * 1.35));
      ctx.beginPath();
      ctx.moveTo(p.x - size, y);
      ctx.quadraticCurveTo(p.x, y + Math.sin(t * 1.6 + i + c.q) * 3.2, p.x + size, y);
      ctx.stroke();
    }
    const glint = ctx.createRadialGradient(p.x - size * 0.2, p.y - size * 0.15, 2, p.x, p.y, size);
    glint.addColorStop(0, 'rgba(210,230,235,0.10)');
    glint.addColorStop(1, 'rgba(210,230,235,0)');
    ctx.fillStyle = glint;
    ctx.fillRect(p.x - size, p.y - size, size * 2, size * 2);
    ctx.restore();
  }

  drawTerrainEdges(c, p, size, battle) {
    const ctx = this.ctx;
    const pts = hexCorners(p.x, p.y, size - 0.4);
    const h0 = visualHeight(c.terrain);
    for (let i = 0; i < 6; i++) {
      const npos = add(c, DIRS[i]);
      const n = battle.cell(npos.q, npos.r);
      const a = pts[i];
      const b = pts[(i + 1) % 6];
      if (!n) {
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        continue;
      }
      const hn = visualHeight(n.terrain);
      if (hn > h0 + 0.06) {
        ctx.strokeStyle = 'rgba(0,0,0,0.34)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      const waterEdge = !artOf(c.terrain).water && artOf(n.terrain).water;
      if (waterEdge) {
        ctx.strokeStyle = 'rgba(190,214,220,0.42)';
        ctx.lineWidth = 2.1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else if (n.terrain !== c.terrain) {
        ctx.strokeStyle = 'rgba(0,0,0,0.20)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }

  drawProps(c, size, battle) {
    const art = artOf(c.terrain);
    const spec = art.props;
    if (!spec) return;
    const top = this.topOf(c, size);
    if (spec.kind === 'scatter') this.drawScatter(c, top, size, spec);
    else if (spec.kind === 'center') this.drawCenterProp(c, top, size, spec);
    else if (spec.kind === 'castra') this.drawCastraField(c, top, size, battle, spec);
    else if (spec.kind === 'causeway') this.drawCauseway(c, top, size, battle, spec);
  }

  drawScatter(c, p, size, spec) {
    const nMin = spec.count[0];
    const nMax = spec.count[1];
    const n = nMin + Math.floor(hash2(c.q, c.r) * (nMax - nMin + 1));
    const items = [];
    for (let i = 0; i < n; i++) {
      const ang = hash2(c.q + i * 3, c.r) * TAU;
      const d = size * (0.06 + hash2(c.r, c.q + i * 5) * 0.40);
      const key = spec.keys[Math.floor(hash2(i + 1, c.q) * spec.keys.length) % spec.keys.length];
      const sc = spec.scale[0] + hash2(c.r + i, c.q) * (spec.scale[1] - spec.scale[0]);
      items.push({
        x: p.x + Math.cos(ang) * d,
        y: p.y + Math.sin(ang) * d * 0.68,
        key,
        sc,
      });
    }
    items.sort((a, b) => a.y - b.y);
    const burn = c.burned ? 0.35 : 1;
    for (const it of items) {
      this.drawProp(it.key, it.x, it.y, size * it.sc, burn);
    }
  }

  drawCenterProp(c, p, size, spec) {
    const key = spec.keys[0];
    this.drawProp(key, p.x, p.y + size * 0.08, size * spec.scale, c.burned ? 0.35 : 1);
  }

  drawCastraField(c, p, size, battle, spec) {
    const ctx = this.ctx;
    const pts = hexCorners(p.x, p.y, size * 0.78);
    let nCastra = 0;
    for (let i = 0; i < 6; i++) {
      const npos = add(c, DIRS[i]);
      const n = battle.cell(npos.q, npos.r);
      const a = pts[i];
      const b = pts[(i + 1) % 6];
      if (n && n.terrain === 'castra') {
        nCastra += 1;
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = 'rgba(62, 44, 28, 0.88)';
      ctx.lineWidth = Math.max(2.2, size * 0.07);
      ctx.lineCap = 'square';
      ctx.stroke();
      ctx.strokeStyle = 'rgba(120, 92, 58, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    const showCamp = c.principia || nCastra <= 2 || (nCastra <= 3 && hash2(c.q, c.r) > 0.72);
    if (showCamp) {
      const sc = c.principia ? spec.scale : spec.scale * 0.82;
      this.drawProp(spec.keys[0], p.x, p.y + size * 0.06, size * sc, c.burned ? 0.35 : 1);
    }
  }

  drawProp(key, x, y, h, alpha = 1) {
    const img = this.images[key];
    if (!img || !img.complete || !img.naturalWidth) return;
    const ctx = this.ctx;
    const aspect = img.naturalWidth / img.naturalHeight;
    const w = h * aspect;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.ellipse(x, y + h * 0.04, w * 0.28, h * 0.08, 0, 0, TAU);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();
    ctx.drawImage(img, x - w / 2, y - h * 0.90, w, h);
    ctx.restore();
  }

  drawCauseway(c, p, size, battle, spec) {
    const ctx = this.ctx;
    const isBoard = (cell) => cell && (cell.terrain === 'causeway' || cell.terrain === 'brokenCauseway');
    const pairs = [[0, 3], [1, 4], [2, 5]];
    let best = pairs[0];
    let bestScore = -1;
    for (const pair of pairs) {
      let s = 0;
      for (const i of pair) {
        const d = DIRS[i];
        if (isBoard(battle.cell(c.q + d.q, c.r + d.r))) s += 1;
      }
      if (s > bestScore) {
        bestScore = s;
        best = pair;
      }
    }
    const d0 = DIRS[best[0]];
    const d1 = DIRS[best[1]];
    const p0 = hexToPixel(c.q + d0.q, c.r + d0.r, size);
    const p1 = hexToPixel(c.q + d1.q, c.r + d1.r, size);
    const a = { x: (p.x + p0.x) / 2, y: (p.y + p0.y) / 2 };
    const b = { x: (p.x + p1.x) / 2, y: (p.y + p1.y) / 2 };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ang = Math.atan2(dy, dx);
    const img = this.images[spec.key];
    const width = Math.max(5, size * 0.34);
    ctx.save();
    ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(-len / 2, width * 0.22, len, width * 0.28);
    if (img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, -len / 2, -width / 2, len, width);
    } else {
      ctx.fillStyle = c.terrain === 'brokenCauseway' ? 'rgba(90,62,36,0.7)' : 'rgba(176,142,88,0.92)';
      ctx.fillRect(-len / 2, -width / 2, len, width);
    }
    ctx.restore();
  }

  tintHex(c, size, fill, stroke) {
    const ctx = this.ctx;
    const p = this.topOf(c, size);
    this.hexPath(ctx, p, size - 0.2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  drawMarkers(c, size) {
    const p = this.topOf(c, size);
    if (c.principia) this.badge(p.x, p.y - size * 0.52, 'SPQR', '#d4af37');
    if (c.eagle) this.badge(p.x, p.y - size * 0.52, 'AQUILA', '#e8c56b');
    if (c.grave && !c.buried) this.badge(p.x, p.y - size * 0.48, '†', '#c8c0b0');
    if (c.extract) this.badge(p.x, p.y - size * 0.48, 'EXIT', '#8ec8ff');
    if (c.burned) this.badge(p.x, p.y - size * 0.48, 'FIRE', '#ff6a2a');
  }

  badge(x, y, text, color) {
    const ctx = this.ctx;
    ctx.font = '700 9px Cinzel, serif';
    ctx.textAlign = 'center';
    const w = Math.max(36, ctx.measureText(text).width + 10);
    ctx.fillStyle = 'rgba(0,0,0,0.58)';
    ctx.fillRect(x - w / 2, y - 8, w, 13);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y + 2);
  }

  drawMissiles(size) {
    const ctx = this.ctx;
    for (const a of this.anims) {
      if (a.kind !== 'missile') continue;
      const k = a.t / a.life;
      const p0 = hexToPixel(a.q0, a.r0, size);
      const p1 = hexToPixel(a.q1, a.r1, size);
      const x = p0.x + (p1.x - p0.x) * k;
      const y = p0.y + (p1.y - p0.y) * k - Math.sin(k * Math.PI) * size * 0.55;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(p1.y - p0.y, p1.x - p0.x));
      ctx.fillStyle = '#e8d2a0';
      ctx.fillRect(-size * 0.18, -1.2, size * 0.36, 2.4);
      ctx.fillStyle = '#8a3030';
      ctx.beginPath();
      ctx.moveTo(size * 0.18, 0);
      ctx.lineTo(size * 0.08, -3);
      ctx.lineTo(size * 0.08, 3);
      ctx.fill();
      ctx.restore();
    }
  }

  drawCorpse(c, size) {
    const ctx = this.ctx;
    const p = hexToPixel(c.q, c.r, size);
    const k = 1 - c.t / c.life;
    ctx.save();
    ctx.globalAlpha = k * 0.7;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = c.faction === 'rome' ? '#5a1818' : '#2a3a18';
    ctx.fill();
    ctx.restore();
  }

  drawUnit(u, size, selected) {
    const ctx = this.ctx;
    const vis = this.visualHex(u.q, u.r);
    const cell = this._battle?.cell(u.q, u.r);
    const base = hexToPixel(vis.q, vis.r, size);
    const lift = cell ? visualHeight(cell.terrain) * size : 0;
    const p = { x: base.x, y: base.y - lift };
    const t = typeOf(u);
    const r = size * 0.44;
    const bob = selected ? Math.sin(this.pulse * 4) * 1.3 : Math.sin(this.time * 2 + u.q) * 0.4;
    const cx = p.x;
    const cy = p.y + bob;

    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.92, r * 0.78, r * 0.24, 0, 0, TAU);
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.62, r * 0.70, r * 0.22, 0, 0, TAU);
    ctx.fillStyle = '#2a2116';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.52, r * 0.66, r * 0.18, 0, 0, TAU);
    ctx.fillStyle = '#5a4630';
    ctx.fill();

    const img = this.images[t.portrait] || this.images[`portrait-${t.id}`];
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.closePath();
    ctx.clip();
    if (img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, cx - r, cy - r * 1.05, r * 2, r * 2.15);
    } else {
      ctx.fillStyle = t.color;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${Math.floor(size * 0.3)}px Cinzel, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.short, cx, cy);
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.lineWidth = selected ? 3.4 : 2.2;
    ctx.strokeStyle = selected ? '#f0d78c' : u.faction === 'rome' ? '#c43c2c' : '#6a8a3a';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, r - 1.4, 0, TAU);
    ctx.strokeStyle = 'rgba(40,28,14,0.55)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    if (selected) {
      ctx.beginPath();
      ctx.arc(cx, cy, r + 4 + Math.sin(this.pulse * 5), 0, TAU);
      ctx.strokeStyle = 'rgba(240,215,140,0.45)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    if (!u.inSupply) {
      ctx.beginPath();
      ctx.arc(cx, cy, r + 3, 0, TAU);
      ctx.strokeStyle = 'rgba(220,80,40,0.7)';
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const pip = `${effectiveStrength(u)}`;
    ctx.font = `700 ${Math.max(10, Math.floor(size * 0.28))}px "Source Serif 4", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const bx = cx + r * 0.58;
    const by = cy + r * 0.55;
    ctx.beginPath();
    ctx.arc(bx, by, size * 0.2, 0, TAU);
    ctx.fillStyle = 'rgba(10,8,4,0.86)';
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#c4a56a';
    ctx.stroke();
    ctx.fillStyle = u.disorder ? '#e8b86a' : '#f4efe4';
    ctx.fillText(pip, bx, by + 0.5);

    if (u.entrench > 0) {
      ctx.fillStyle = '#c4b08a';
      ctx.font = '700 10px serif';
      ctx.fillText('▴'.repeat(Math.min(3, u.entrench)), cx, cy - r - 4);
    }
    if (u.experience > 0) {
      ctx.fillStyle = '#e8c56b';
      ctx.font = '900 9px serif';
      ctx.fillText('★'.repeat(Math.min(5, u.experience)), cx, cy + r + 8);
    }
  }

  drawFx(size) {
    const ctx = this.ctx;
    const next = [];
    for (const f of this.fx) {
      f.t += 0.016;
      if (f.t > f.life) continue;
      next.push(f);
      const k = 1 - f.t / f.life;
      if (f.kind === 'flash') {
        const p = hexToPixel(f.q, f.r, size);
        ctx.beginPath();
        ctx.arc(p.x, p.y, size * (0.35 + (1 - k) * 0.9), 0, TAU);
        ctx.fillStyle = `rgba(255,210,130,${0.38 * k})`;
        ctx.fill();
      } else if (f.kind === 'part') {
        f.x += f.vx * 0.016;
        f.y += f.vy * 0.016;
        f.vy += 40 * 0.016;
        const col = f.style === 'death' ? `rgba(180,60,40,${k})`
          : f.style === 'spark' ? `rgba(255,220,140,${k})`
          : f.style === 'clash' ? `rgba(230,200,150,${k})`
          : `rgba(160,140,100,${k})`;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.style === 'clash' ? 2.6 : 1.8, 0, TAU);
        ctx.fill();
      } else {
        ctx.font = `700 ${13 + (1 - k) * 7}px Cinzel, serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = f.color || '#fff';
        ctx.globalAlpha = k;
        ctx.fillText(f.text, f.x, f.y - (1 - k) * 32);
        ctx.globalAlpha = 1;
      }
    }
    this.fx = next;
  }

  drawRain() {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(180,200,210,0.16)';
    ctx.lineWidth = 1.1;
    const t = this.time * 60;
    for (let i = 0; i < 90; i++) {
      const x = ((i * 97 + t * 8) % (this.w + 40)) - 20;
      const y = ((i * 53 + t * 16) % (this.h + 40)) - 20;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 5, y + 16);
      ctx.stroke();
    }
  }
}

function shadeHex(hex, k) {
  const n = parseInt((hex || '#4a3d28').slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

function hash2(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function easeOut(t) {
  return 1 - (1 - t) * (1 - t);
}
