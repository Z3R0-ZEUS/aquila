import { typeOf, upgradeKindOf } from './data/units.js';
export { upgradeKindOf };

const ARCH_FALLBACK = {
  'rome-heavy-vet': 'rome-heavy',
  'rome-aux': 'rome-heavy',
  'rome-batavi': 'rome-horse',
  'rome-hero-ger': 'rome-heavy',
  'rome-hero-cae': 'rome-heavy',
  'rome-scout': 'rome-aux',
  'rome-engineer': 'rome-heavy',
  'ger-raider': 'ger-warband',
  'ger-ambush': 'ger-warband',
  'ger-noble': 'ger-warband',
  'ger-hero': 'ger-warband',
  'ger-hunter': 'ger-skirmish',
};

export const ARCHETYPE_OF = {
  legion: 'rome-heavy',
  veteran: 'rome-heavy-vet',
  auxilia: 'rome-aux',
  sagittarii: 'rome-bow',
  slingers: 'rome-sling',
  equites: 'rome-horse',
  batavi: 'rome-batavi',
  exploratores: 'rome-scout',
  scorpio: 'rome-scorpio',
  engineers: 'rome-engineer',
  germanicus: 'rome-hero-ger',
  caecina: 'rome-hero-cae',
  warband: 'ger-warband',
  nobles: 'ger-noble',
  skirmishers: 'ger-skirmish',
  hunters: 'ger-hunter',
  lightHorse: 'ger-horse',
  ambushers: 'ger-ambush',
  raiders: 'ger-raider',
  arminius: 'ger-hero',
};

export function archetypeOf(unit) {
  const t = typeof unit === 'string' ? { id: unit } : typeOf(unit);
  const id = t.id || unit.typeId;
  return t.sprite || ARCHETYPE_OF[id] || null;
}

export function loadSpriteBank(images, manifest) {
  return new SpriteBank(images, manifest || {});
}

export class SpriteBank {
  constructor(images, manifest) {
    this.images = images || {};
    this.manifest = manifest || {};
  }

  clipInfo(arch, clip) {
    return this.manifest[arch]?.[clip] || null;
  }

  count(arch, clip) {
    const info = this.clipInfo(arch, clip);
    if (info) return info.count;
    let n = 0;
    while (this.images[`sprite-${arch}-${clip}-${n}`]) n += 1;
    return n;
  }

  frame(arch, clip, t, fallbackClip = 'idle') {
    const arches = [arch, ARCH_FALLBACK[arch]].filter(Boolean);
    const clips = clip === fallbackClip ? [clip] : [clip, fallbackClip];
    let use = arch;
    let c = clip;
    let n = 0;
    for (const a of arches) {
      for (const cl of clips) {
        const cnt = this.count(a, cl);
        if (cnt) {
          use = a;
          c = cl;
          n = cnt;
          break;
        }
      }
      if (n) break;
    }
    if (!n) return null;
    const info = this.clipInfo(use, c) || { fps: 10, loop: c === 'idle' };
    const fps = info.fps || 10;
    const idx = info.loop || c === 'idle'
      ? Math.floor(Math.max(0, t) * fps) % n
      : Math.min(n - 1, Math.max(0, Math.floor(t * fps)));
    return this.images[`sprite-${use}-${c}-${idx}`] || this.images[`sprite-${use}-${c}-0`] || null;
  }

  has(arch) {
    return this.count(arch, 'idle') > 0;
  }
}

export async function fetchManifest() {
  try {
    const res = await fetch('assets/sprites/manifest.json');
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

export function spriteJobs(manifest) {
  const jobs = [];
  for (const [arch, clips] of Object.entries(manifest || {})) {
    for (const [clip, info] of Object.entries(clips)) {
      const n = info.count || 1;
      for (let i = 0; i < n; i++) {
        const file = `assets/sprites/${arch}/${clip}/f${String(i).padStart(2, '0')}.png`;
        jobs.push([`sprite-${arch}-${clip}-${i}`, file]);
      }
    }
  }
  return jobs;
}

export const FX_LIST = [
  ['fx-pilum', 'assets/fx/pilum.png'],
  ['fx-arrow', 'assets/fx/arrow.png'],
  ['fx-clash', 'assets/fx/clash.png'],
  ['fx-bolt', 'assets/fx/bolt.png'],
  ['fx-stone', 'assets/fx/stone.png'],
  ['fx-dust', 'assets/fx/dust.png'],
];
