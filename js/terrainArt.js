/** Visual-only hex art. Combat elevation stays in game.js. */

export const FLOOR = 0.28;

export const TERRAIN_ART = {
  clear: {
    albedos: ['tile-clear', 'tile-clear-b', 'tile-clear-c'],
    height: 0,
    side: '#4a3d28',
    props: null,
  },
  lightForest: {
    albedos: ['tile-forest-floor'],
    height: 0,
    side: '#3a2e1c',
    props: {
      kind: 'scatter',
      keys: ['prop-oak-a', 'prop-oak-b', 'prop-oak-c'],
      count: [1, 2],
      scale: [1.35, 1.75],
    },
  },
  denseForest: {
    albedos: ['tile-dense-floor'],
    height: 0,
    side: '#2a2214',
    props: {
      kind: 'scatter',
      keys: ['prop-fir-a', 'prop-fir-b', 'prop-fir-c'],
      count: [2, 3],
      scale: [1.55, 2.05],
    },
  },
  marsh: {
    albedos: ['tile-marsh'],
    height: -0.04,
    side: '#2c3224',
    props: {
      kind: 'scatter',
      keys: ['prop-reeds-a', 'prop-reeds-b'],
      count: [1, 2],
      scale: [0.58, 0.82],
    },
  },
  hill: {
    albedos: ['tile-hill'],
    height: 0.24,
    side: '#5a4a32',
    props: {
      kind: 'scatter',
      keys: ['prop-rock'],
      count: [0, 1],
      scale: [0.42, 0.60],
    },
  },
  village: {
    albedos: ['tile-village-dirt'],
    height: 0.04,
    side: '#4a3828',
    props: {
      kind: 'scatter',
      keys: ['prop-longhouse-a', 'prop-longhouse-b'],
      count: [1, 2],
      scale: [0.72, 0.98],
    },
  },
  oppidum: {
    albedos: ['tile-hill'],
    height: 0.30,
    side: '#4a3a28',
    props: { kind: 'center', keys: ['prop-oppidum'], scale: 1.38 },
  },
  castra: {
    albedos: ['tile-castra-earth'],
    height: 0.08,
    side: '#5a4e3a',
    props: { kind: 'castra', keys: ['prop-castra'], scale: 1.22 },
  },
  water: {
    albedos: ['tile-water'],
    height: -0.16,
    side: '#1c2830',
    props: null,
    water: true,
  },
  ford: {
    albedos: ['tile-ford'],
    height: -0.10,
    side: '#2a3838',
    props: null,
    water: 'ford',
  },
  causeway: {
    albedos: ['tile-marsh'],
    height: 0.05,
    side: '#3a3224',
    props: { kind: 'causeway', key: 'prop-planks' },
  },
  brokenCauseway: {
    albedos: ['tile-marsh'],
    height: 0,
    side: '#2a261c',
    props: { kind: 'causeway', key: 'prop-planks-broken' },
  },
};

export function artOf(terrain) {
  return TERRAIN_ART[terrain] || TERRAIN_ART.clear;
}

export function visualHeight(terrain) {
  return artOf(terrain).height;
}
