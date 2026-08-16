/** Axial hex math (pointy-top) and odd-r offset conversion. */

export const DIRS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function key(q, r) {
  return `${q},${r}`;
}

export function parseKey(k) {
  const [q, r] = k.split(',').map(Number);
  return { q, r };
}

export function add(a, b) {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function neighbors(pos) {
  return DIRS.map((d) => add(pos, d));
}

export function hexDistance(a, b) {
  const aq = a.q;
  const ar = a.r;
  const as = -aq - ar;
  const bq = b.q;
  const br = b.r;
  const bs = -bq - br;
  return Math.max(Math.abs(aq - bq), Math.abs(ar - br), Math.abs(as - bs));
}

/** odd-r offset (col,row) → axial */
export function offsetToAxial(col, row) {
  const q = col - ((row - (row & 1)) >> 1);
  return { q, r: row };
}

export function axialToOffset(q, r) {
  const col = q + ((r - (r & 1)) >> 1);
  return { col, row: r };
}

/** Pixel center of a pointy-top hex (odd-r). */
export function hexToPixel(q, r, size) {
  const { col, row } = axialToOffset(q, r);
  const x = size * Math.sqrt(3) * (col + 0.5 * (row & 1));
  const y = size * 1.5 * row;
  return { x, y };
}

export function pixelToHex(px, py, size) {
  const q = ((Math.sqrt(3) / 3) * px - (1 / 3) * py) / size;
  const r = ((2 / 3) * py) / size;
  return hexRound(q, r);
}

export function hexRound(qf, rf) {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  let s = Math.round(sf);
  const qDiff = Math.abs(q - qf);
  const rDiff = Math.abs(r - rf);
  const sDiff = Math.abs(s - sf);
  if (qDiff > rDiff && qDiff > sDiff) q = -r - s;
  else if (rDiff > sDiff) r = -q - s;
  return { q, r };
}

export function hexCorners(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push({ x: cx + size * Math.cos(angle), y: cy + size * Math.sin(angle) });
  }
  return pts;
}

export function lerpHex(a, b, t) {
  return {
    q: a.q + (b.q - a.q) * t,
    r: a.r + (b.r - a.r) * t,
  };
}

export function hexLine(a, b) {
  const n = hexDistance(a, b);
  if (n === 0) return [{ q: a.q, r: a.r }];
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const h = hexRound(a.q + (b.q - a.q) * t, a.r + (b.r - a.r) * t);
    out.push(h);
  }
  return out;
}
