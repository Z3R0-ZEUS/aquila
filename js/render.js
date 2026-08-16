import { hexToPixel, hexCorners, pixelToHex, hexDistance, DIRS, add } from './hex.js';
import { TERRAIN } from './data/terrain.js';
import { typeOf, effectiveStrength } from './data/units.js';
import { reachable } from './pathfind.js';
import { inMissileRange, canMelee } from './combat.js';

const SIZE0 = 40;

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
    return pixelToHex(w.x, w.y, this.size());
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

  draw(battle) {
    const ctx = this.ctx;
    const dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = this.w;
    const h = this.h;
    this.pulse += 0.03;
    this.time += 0.016;
    if (this.shake > 0) this.shake *= 0.82;
    this.tickAnims();

    const sky = battle.weather === 'fog' ? '#121610' : battle.weather === 'rain' ? '#161e1c' : '#182016';
    ctx.fillStyle = sky;
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
    for (const c of cells) this.drawHex(c, size, battle);
    for (const c of cells) this.drawHexDetail(c, size, battle);

    for (const c of cells) {
      const k = `${c.q},${c.r}`;
      if (moveSet.has(k)) this.tintHex(c, size, 'rgba(80,160,220,0.22)', 'rgba(150,210,255,0.75)');
      if (atkSet.has(k)) this.tintHex(c, size, 'rgba(180,40,30,0.26)', 'rgba(255,100,80,0.9)');
    }

    if (this.hover && battle.cell(this.hover.q, this.hover.r)) {
      this.tintHex(this.hover, size, 'rgba(255,230,160,0.08)', 'rgba(255,220,140,0.95)');
    }
    if (sel) this.tintHex(sel, size, 'rgba(212,175,55,0.10)', 'rgba(240,215,140,1)');

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
      ctx.fillStyle = 'rgba(18,22,16,0.2)';
      ctx.fillRect(0, 0, w, h);
    }
    if (battle.weather === 'rain') this.drawRain();

    const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.18, w / 2, h / 2, w * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.48)');
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

  drawHex(c, size, battle) {
    const ctx = this.ctx;
    const lift = (c.elevation || 0) * size * 0.16;
    const p = hexToPixel(c.q, c.r, size);
    p.y -= lift;
    const terr = TERRAIN[c.terrain] || TERRAIN.clear;

    if (lift) {
      ctx.save();
      const base = hexToPixel(c.q, c.r, size);
      this.hexPath(ctx, { x: base.x, y: base.y + size * 0.06 }, size);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fill();
      ctx.restore();
    }

    this.hexPath(ctx, p, size);
    const img = this.images[`tile-${c.terrain}`] || this.images[`tile-${alias(c.terrain)}`];
    if (img && img.complete && img.naturalWidth) {
      ctx.save();
      ctx.clip();
      const s = size * 2.15;
      const hsh = hash2(c.q, c.r);
      const ox = (hsh - 0.5) * size * 0.45;
      const oy = (hash2(c.r, c.q) - 0.5) * size * 0.45;
      ctx.drawImage(img, p.x - s / 2 + ox, p.y - s / 2 + oy, s, s);
      ctx.restore();
    } else {
      const grd = ctx.createLinearGradient(p.x, p.y - size, p.x, p.y + size);
      grd.addColorStop(0, terr.color);
      grd.addColorStop(1, terr.color2);
      ctx.fillStyle = grd;
      ctx.fill();
    }

    this.hexPath(ctx, p, size);
    const shade = ctx.createLinearGradient(p.x - size, p.y - size, p.x + size, p.y + size);
    shade.addColorStop(0, 'rgba(255,255,255,0.10)');
    shade.addColorStop(0.45, 'rgba(255,255,255,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = shade;
    ctx.fill();

    if (c.terrain === 'water' || c.terrain === 'ford') {
      this.drawWater(p, size, c);
    }

    if (c.burned) {
      this.hexPath(ctx, p, size);
      ctx.fillStyle = 'rgba(28,12,6,0.5)';
      ctx.fill();
    }

    this.drawTerrainEdges(c, p, size, battle);

    ctx.strokeStyle = 'rgba(8,10,6,0.42)';
    ctx.lineWidth = 1.15;
    this.hexPath(ctx, p, size);
    ctx.stroke();
  }

  drawWater(p, size, c) {
    const ctx = this.ctx;
    ctx.save();
    this.hexPath(ctx, p, size);
    ctx.clip();
    const t = this.time;
    ctx.strokeStyle = 'rgba(190,220,230,0.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const y = p.y - size * 0.6 + ((t * 14 + i * 18 + hash2(c.q, i) * 20) % (size * 1.3));
      ctx.beginPath();
      ctx.moveTo(p.x - size, y);
      ctx.quadraticCurveTo(p.x, y + Math.sin(t * 2 + i) * 3, p.x + size, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawTerrainEdges(c, p, size, battle) {
    const ctx = this.ctx;
    const pts = hexCorners(p.x, p.y, size - 0.4);
    for (let i = 0; i < 6; i++) {
      const npos = add(c, DIRS[i]);
      const n = battle.cell(npos.q, npos.r);
      const a = pts[i];
      const b = pts[(i + 1) % 6];
      if (!n) {
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        continue;
      }
      if (n.terrain === c.terrain) continue;
      const waterEdge = c.terrain !== 'water' && n.terrain === 'water';
      ctx.strokeStyle = waterEdge ? 'rgba(170,200,210,0.45)' : 'rgba(0,0,0,0.28)';
      ctx.lineWidth = waterEdge ? 2.2 : 1.6;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  drawHexDetail(c, size, battle) {
    const ctx = this.ctx;
    const lift = (c.elevation || 0) * size * 0.16;
    const p = hexToPixel(c.q, c.r, size);
    p.y -= lift;
    const h = hash2(c.q, c.r);

    if (c.terrain === 'lightForest' || c.terrain === 'denseForest') {
      const n = c.terrain === 'denseForest' ? 7 : 4;
      for (let i = 0; i < n; i++) {
        const ang = h * 6.2 + i * 2.2;
        const rad = size * (0.12 + (hash2(i, c.q) * 0.22));
        const d = size * (0.15 + hash2(c.r, i) * 0.38);
        const x = p.x + Math.cos(ang) * d;
        const y = p.y + Math.sin(ang) * d * 0.75;
        ctx.beginPath();
        ctx.ellipse(x, y, rad, rad * 0.72, ang, 0, Math.PI * 2);
        ctx.fillStyle = c.terrain === 'denseForest' ? `rgba(18,32,16,${0.35 + hash2(i, c.r) * 0.25})` : `rgba(30,56,28,${0.28 + hash2(i, c.r) * 0.22})`;
        ctx.fill();
      }
    }

    if (c.terrain === 'marsh') {
      ctx.strokeStyle = 'rgba(70,90,50,0.45)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const x = p.x + (hash2(i, c.q) - 0.5) * size;
        const y = p.y + (hash2(c.r, i) - 0.5) * size * 0.7;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 0.5, y - size * 0.16);
        ctx.stroke();
      }
    }

    if (c.terrain === 'village' || c.terrain === 'oppidum') {
      const roofs = c.terrain === 'oppidum' ? 4 : 3;
      for (let i = 0; i < roofs; i++) {
        const x = p.x + (hash2(i + 2, c.q) - 0.5) * size * 0.7;
        const y = p.y + (hash2(c.r, i + 4) - 0.5) * size * 0.5;
        ctx.fillStyle = c.burned ? '#2a1a10' : i % 2 ? '#8a6a3a' : '#6a4a28';
        ctx.fillRect(x - size * 0.12, y - size * 0.08, size * 0.24, size * 0.14);
      }
    }

    if (c.terrain === 'castra') {
      ctx.strokeStyle = 'rgba(70,52,36,0.7)';
      ctx.lineWidth = 2;
      const pts = hexCorners(p.x, p.y, size * 0.72);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.stroke();
    }

    if (c.terrain === 'causeway' || c.terrain === 'brokenCauseway') {
      this.drawCauseway(c, p, size, battle);
    }
  }

  drawCauseway(c, p, size, battle) {
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
    ctx.lineCap = 'butt';
    ctx.strokeStyle = c.terrain === 'brokenCauseway' ? 'rgba(90,62,36,0.55)' : 'rgba(176,142,88,0.88)';
    ctx.lineWidth = Math.max(4, size * 0.28);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (c.terrain === 'brokenCauseway') {
      ctx.strokeStyle = 'rgba(20,16,10,0.45)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo((a.x + b.x) / 2 - 4, (a.y + b.y) / 2 - 3);
      ctx.lineTo((a.x + b.x) / 2 + 5, (a.y + b.y) / 2 + 4);
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(60,40,20,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  tintHex(c, size, fill, stroke) {
    const ctx = this.ctx;
    const lift = (c.elevation || 0) * size * 0.16;
    const p = hexToPixel(c.q, c.r, size);
    p.y -= lift;
    this.hexPath(ctx, p, size - 0.2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  drawMarkers(c, size) {
    const p = hexToPixel(c.q, c.r, size);
    p.y -= (c.elevation || 0) * size * 0.16;
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
    const p = hexToPixel(vis.q, vis.r, size);
    const t = typeOf(u);
    const r = size * 0.46;
    const bob = selected ? Math.sin(this.pulse * 4) * 1.3 : Math.sin(this.time * 2 + u.q) * 0.4;

    ctx.beginPath();
    ctx.ellipse(p.x, p.y + r * 0.88, r * 0.72, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fill();

    const img = this.images[t.portrait] || this.images[`portrait-${t.id}`];
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y + bob, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, p.x - r, p.y + bob - r * 1.05, r * 2, r * 2.15);
    } else {
      ctx.fillStyle = t.color;
      ctx.fillRect(p.x - r, p.y + bob - r, r * 2, r * 2);
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${Math.floor(size * 0.3)}px Cinzel, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.short, p.x, p.y + bob);
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(p.x, p.y + bob, r, 0, Math.PI * 2);
    ctx.lineWidth = selected ? 3.3 : 2.1;
    ctx.strokeStyle = selected ? '#f0d78c' : u.faction === 'rome' ? '#c43c2c' : '#6a8a3a';
    ctx.stroke();

    if (selected) {
      ctx.beginPath();
      ctx.arc(p.x, p.y + bob, r + 4 + Math.sin(this.pulse * 5), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(240,215,140,0.45)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    if (!u.inSupply) {
      ctx.beginPath();
      ctx.arc(p.x, p.y + bob, r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(220,80,40,0.7)';
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const pip = `${effectiveStrength(u)}`;
    ctx.font = `700 ${Math.max(10, Math.floor(size * 0.28))}px "Source Serif 4", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const bx = p.x + r * 0.58;
    const by = p.y + bob + r * 0.55;
    ctx.fillStyle = 'rgba(10,8,4,0.82)';
    ctx.beginPath();
    ctx.arc(bx, by, size * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = u.disorder ? '#e8b86a' : '#f4efe4';
    ctx.fillText(pip, bx, by + 0.5);

    if (u.entrench > 0) {
      ctx.fillStyle = '#c4b08a';
      ctx.font = '700 10px serif';
      ctx.fillText('▴'.repeat(Math.min(3, u.entrench)), p.x, p.y + bob - r - 4);
    }
    if (u.experience > 0) {
      ctx.fillStyle = '#e8c56b';
      ctx.font = '900 9px serif';
      ctx.fillText('★'.repeat(Math.min(5, u.experience)), p.x, p.y + bob + r + 8);
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
        ctx.arc(p.x, p.y, size * (0.35 + (1 - k) * 0.9), 0, Math.PI * 2);
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
        ctx.arc(f.x, f.y, f.style === 'clash' ? 2.6 : 1.8, 0, Math.PI * 2);
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
    ctx.strokeStyle = 'rgba(180,200,210,0.18)';
    ctx.lineWidth = 1;
    const t = this.time * 60;
    for (let i = 0; i < 80; i++) {
      const x = ((i * 97 + t * 8) % (this.w + 40)) - 20;
      const y = ((i * 53 + t * 14) % (this.h + 40)) - 20;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 4, y + 14);
      ctx.stroke();
    }
  }
}

function alias(t) {
  if (t === 'lightForest') return 'forest';
  if (t === 'denseForest') return 'dense';
  if (t === 'brokenCauseway') return 'causeway';
  if (t === 'oppidum') return 'village';
  if (t === 'ford') return 'water';
  return t;
}

function hash2(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function easeOut(t) {
  return 1 - (1 - t) * (1 - t);
}
