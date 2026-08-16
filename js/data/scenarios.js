/** Five Germanicus campaign missions. Maps are odd-r offset, row-major. */

const CORE_10 = (sx, sy, cols = 2) => {
  const slots = [];
  for (let i = 0; i < 10; i++) {
    slots.push({ col: sx + (i % cols), row: sy + Math.floor(i / cols) });
  }
  return slots;
};

export const SCENARIOS = [
  {
    id: 'vetera',
    index: 0,
    year: '14 AD',
    title: 'The Rhine Holds',
    subtitle: 'Castra Vetera',
    briefing:
      'Night on the lower Rhine. The mutiny is barely cooled and already the forests answer with horns. Hold the principia. Do not let them take a gate. A sortie at dawn will teach the Chatti that Rome still wakes.',
    victoryText: 'Dawn finds the palisade standing and the dead counted. The Rhine still speaks Latin.',
    briefingArt: 'briefing-vetera.png',
    weather: 'fog',
    maxTurns: 12,
    cols: 16,
    rows: 11,
    map: `
wwwwccccccccccll
wfffccccccccclll
wfffccccccccclld
wfffcccccccccldd
wffhcccccccccldd
wfffccccccccclld
wfffccccccccclll
wfffccccccccclll
wwwwccccccccclll
wwwwccccccclllld
wwwwcccccccllldd
`,
    markers: [
      { col: 2, row: 4, props: { principia: true, supplySource: true } },
      { col: 4, row: 3, props: { gate: true } },
      { col: 4, row: 5, props: { gate: true } },
    ],
    failIf: { type: 'hold', col: 2, row: 4 },
    coreSlots: CORE_10(1, 2, 3),
    units: [
      { typeId: 'germanicus', col: 2, row: 4, name: 'Germanicus', entrench: 3 },
      { typeId: 'scorpio', col: 3, row: 3, entrench: 2 },
      { typeId: 'slingers', col: 3, row: 5, entrench: 1 },
      { typeId: 'raiders', col: 12, row: 2, hidden: true },
      { typeId: 'raiders', col: 13, row: 4, hidden: true },
      { typeId: 'raiders', col: 12, row: 6, hidden: true },
      { typeId: 'warband', col: 14, row: 3 },
      { typeId: 'warband', col: 14, row: 5 },
      { typeId: 'skirmishers', col: 13, row: 1, hidden: true },
      { typeId: 'skirmishers', col: 13, row: 7, hidden: true },
    ],
    scripts: [
      { turn: 5, weather: 'fair' },
      {
        turn: 6,
        spawn: [
          { typeId: 'warband', col: 15, row: 4 },
          { typeId: 'raiders', col: 15, row: 6, hidden: true },
        ],
      },
    ],
    objectives: [
      { id: 'principia', type: 'hold', col: 2, row: 4, required: true, text: 'Hold the principia' },
      { id: 'hero', type: 'survive', unit: 'germanicus', required: true, text: 'Germanicus must live' },
      { id: 'last', type: 'holdUntil', col: 2, row: 4, required: true, soft: true, text: 'Stand until dawn (turn 12)' },
    ],
    hints: ['Fortified hexes hit back harder.', 'Missile troops shoot two hexes if they have ammunition.', 'End turn to let unmoved units entrench.'],
  },

  {
    id: 'chatti',
    index: 1,
    year: '15 AD',
    title: 'Fire and Iron',
    subtitle: 'Land of the Chatti',
    briefing:
      'Germanicus crosses the Rhine in force. The Chatti keep no cities worthy of the name — only villages and one timber hillfort. Burn their hearths or take the oppidum. Auxilia first. The eagles last.',
    victoryText: 'Smoke stands over the Chatti. The road into the interior is open.',
    briefingArt: 'briefing-chatti.png',
    weather: 'fair',
    maxTurns: 14,
    cols: 18,
    rows: 13,
    map: `
llllllllllllllhhho
llcccccccccccchhho
lccccvcccccccchhhl
lccccccccccccccccc
ccccvccccccccccccl
cccccccccccccccccl
ccccccccccccccccdl
hhccccccccccccccdd
hhcccvccccccccccdd
lccccccccccccccccd
lccccccclllllllccl
llcccccclllllllcll
llllllllllllllllll
`,
    markers: [
      { col: 17, row: 0, props: { } },
      { col: 17, row: 1, terrain: 'oppidum' },
    ],
    coreSlots: CORE_10(1, 5, 3),
    units: [
      { typeId: 'germanicus', col: 2, row: 6, name: 'Germanicus' },
      { typeId: 'scorpio', col: 3, row: 7 },
      { typeId: 'engineers', col: 1, row: 7 },
      { typeId: 'warband', col: 6, row: 2 },
      { typeId: 'warband', col: 5, row: 8 },
      { typeId: 'skirmishers', col: 8, row: 3 },
      { typeId: 'warband', col: 14, row: 4 },
      { typeId: 'nobles', col: 16, row: 1, entrench: 3 },
      { typeId: 'hunters', col: 15, row: 2, hidden: true },
      { typeId: 'warband', col: 16, row: 3, entrench: 2 },
      { typeId: 'ambushers', col: 12, row: 10, hidden: true },
      { typeId: 'ambushers', col: 10, row: 11, hidden: true },
      { typeId: 'lightHorse', col: 11, row: 6 },
    ],
    scripts: [
      { turn: 7, weather: 'rain' },
      {
        turn: 8,
        spawn: [
          { typeId: 'warband', col: 17, row: 6 },
          { typeId: 'skirmishers', col: 16, row: 8 },
        ],
      },
    ],
    objectives: [
      { id: 'burn', type: 'burn', count: 3, required: false, text: 'Burn 3 villages' },
      { id: 'fort', type: 'occupy', col: 17, row: 1, required: false, text: 'Take the hillfort' },
      { id: 'hero', type: 'survive', unit: 'germanicus', required: true, text: 'Germanicus must live' },
    ],
    // Special: win if burn OR occupy. Handled as required survive + either optional as required-or
    winAny: ['burn', 'fort'],
    hints: ['Occupy a village and use Burn.', 'Scorpiones chew entrenchment.', 'Do not send legionaries into deep woods first.'],
  },

  {
    id: 'pontes',
    index: 2,
    year: '15 AD',
    title: 'The Long Bridges',
    subtitle: 'Pontes Longi',
    briefing:
      'Caecina leads four legions home by the long bridges — a timber causeway through bottomless marsh. Arminius has already been here. The planks are cut. Hold the column together. Get the eagles off the western edge. Do not let the marsh eat the army.',
    victoryText: 'The last cohort comes off the boards into decent ground. Caecina still has an army.',
    briefingArt: 'briefing-pontes.png',
    weather: 'rain',
    maxTurns: 16,
    cols: 20,
    rows: 12,
    map: `
ddddlllllmmmlllllddd
dddlllllmmmmmllllddd
ddllllxmmmmmmmxllldd
dllllxxmmmmmmmxxllld
clllxcccccccccccccccc
xxxxbbbbxxxxxxbbbbxxx
xxxxbbbbxxxxxxbbbbxxx
clllxcccccccccccccccc
dllllxxmmmmmmmxxllldd
ddllllxmmmmmmmxlllddd
dddlllllmmmmmlllllddd
ddddlllllmmmllllllddd
`,
    markers: [
      { col: 0, row: 5, props: { extract: true, supplySource: true } },
      { col: 0, row: 6, props: { extract: true, supplySource: true } },
      { col: 1, row: 5, props: { extract: true } },
      { col: 1, row: 6, props: { extract: true } },
    ],
    coreSlots: [
      { col: 14, row: 5 }, { col: 15, row: 5 }, { col: 16, row: 5 }, { col: 17, row: 5 },
      { col: 14, row: 6 }, { col: 15, row: 6 }, { col: 16, row: 6 }, { col: 17, row: 6 },
      { col: 13, row: 5 }, { col: 13, row: 6 },
    ],
    units: [
      { typeId: 'caecina', col: 16, row: 5, name: 'Caecina' },
      { typeId: 'engineers', col: 12, row: 5 },
      { typeId: 'engineers', col: 8, row: 6 },
      { typeId: 'scorpio', col: 15, row: 6 },
      { typeId: 'warband', col: 10, row: 2 },
      { typeId: 'warband', col: 11, row: 9 },
      { typeId: 'nobles', col: 7, row: 1 },
      { typeId: 'ambushers', col: 9, row: 3, hidden: true },
      { typeId: 'ambushers', col: 9, row: 8, hidden: true },
      { typeId: 'hunters', col: 6, row: 2, hidden: true },
      { typeId: 'hunters', col: 6, row: 9, hidden: true },
      { typeId: 'warband', col: 4, row: 1 },
      { typeId: 'warband', col: 4, row: 10 },
      { typeId: 'skirmishers', col: 3, row: 3 },
      { typeId: 'skirmishers', col: 3, row: 8 },
      { typeId: 'arminius', col: 8, row: 0, name: 'Arminius', hidden: true },
    ],
    scripts: [
      { turn: 4, breakCauseway: true },
      {
        turn: 7,
        spawn: [
          { typeId: 'warband', col: 10, row: 0 },
          { typeId: 'warband', col: 10, row: 11 },
        ],
      },
    ],
    objectives: [
      { id: 'extract', type: 'extract', count: 6, required: true, text: 'Extract 6 units off the west edge' },
      { id: 'hero', type: 'survive', unit: 'caecina', required: true, text: 'Caecina must live (or extract)' },
    ],
    hints: ['Immunes repair broken causeway hexes they stand on.', 'Cavalry cannot enter marsh.', 'A cut column dies. Keep a corridor.'],
  },

  {
    id: 'teutoburg',
    index: 3,
    year: '15 AD',
    title: 'The Bones of Varus',
    subtitle: 'Saltus Teutoburgiensis',
    briefing:
      'The forest where three eagles went into the mud. Germanicus will walk that ground, bury what can be buried, and bring one standard home. Send the exploratores first. The trees are full of the living as well as the dead.',
    victoryText: 'An eagle comes out of the trees. The dead have names again.',
    briefingArt: 'briefing-teutoburg.png',
    weather: 'fog',
    maxTurns: 16,
    cols: 18,
    rows: 14,
    map: `
dddddddddddddddddd
ddlllllddddclldddd
dlllcccdddcclllddd
dllcccccddccccclld
dlccccccddccccccll
dlcccchcddccvccccl
llccccccddcccccccl
llccccccddcccccccl
dlccccccdddccccccl
dllccccddddcccccld
ddllccdddddccccldd
dddllldddddllllldd
dddddddddddddddddd
ddddddddhddddddddd
`,
    markers: [
      { col: 10, row: 5, props: { eagle: true } },
      { col: 6, row: 4, props: { grave: true } },
      { col: 8, row: 8, props: { grave: true } },
      { col: 12, row: 7, props: { grave: true } },
    ],
    coreSlots: CORE_10(2, 5, 2),
    units: [
      { typeId: 'germanicus', col: 2, row: 6, name: 'Germanicus' },
      { typeId: 'exploratores', col: 4, row: 6 },
      { typeId: 'ambushers', col: 8, row: 3, hidden: true },
      { typeId: 'ambushers', col: 9, row: 9, hidden: true },
      { typeId: 'ambushers', col: 13, row: 4, hidden: true },
      { typeId: 'warband', col: 11, row: 5 },
      { typeId: 'warband', col: 10, row: 8 },
      { typeId: 'hunters', col: 14, row: 6, hidden: true },
      { typeId: 'hunters', col: 7, row: 11, hidden: true },
      { typeId: 'nobles', col: 10, row: 13 },
      { typeId: 'skirmishers', col: 15, row: 10, hidden: true },
      { typeId: 'arminius', col: 16, row: 7, name: 'Arminius', hidden: true },
    ],
    scripts: [
      { turn: 8, weather: 'rain' },
      {
        turn: 9,
        spawn: [
          { typeId: 'warband', col: 17, row: 5 },
          { typeId: 'ambushers', col: 5, row: 1, hidden: true },
        ],
      },
    ],
    objectives: [
      { id: 'eagle', type: 'eagle', required: true, text: 'Recover the eagle of Legio XIX' },
      { id: 'bury', type: 'bury', count: 2, required: false, text: 'Bury the dead (2 sites)' },
      { id: 'hero', type: 'survive', unit: 'germanicus', required: true, text: 'Germanicus must live' },
    ],
    hints: ['Exploratores reveal hidden units.', 'The eagle is marked on the map once you are close.', 'Do not march the whole army down one path.'],
  },

  {
    id: 'idistaviso',
    index: 4,
    year: '16 AD',
    title: 'The Plain of Idistaviso',
    subtitle: 'Campus Idistaviso',
    briefing:
      'Arminius offers battle on open ground between the Weser and the hills — the one gift a German should never give a Roman. Form the line. Let the cavalry have the flanks. If the Cherusci break here, the eagles are avenged.',
    victoryText: 'The plain is Roman. Arminius flees into the timber. Tiberius will recall you before the next season — but this field is enough.',
    briefingArt: 'briefing-idistaviso.png',
    weather: 'fair',
    maxTurns: 14,
    cols: 20,
    rows: 13,
    map: `
hhhhhhhhhhhhhhhhhhhh
hhlllllllllllllllhhh
hllccccccccccccccccc
llcccccccccccccccccc
wrrccccccccccccccccc
wwwccccccccccccccccc
wrrccccccccccccccccc
llcccccccccccccccccc
hllccccccccccccccccc
hhlllllllllllllllhhh
hhhhhhhhhhhhhhhhhhhh
wwwwwwwwwwwwwwwwwwww
wwwwwwwwwwwwwwwwwwww
`,
    markers: [
      { col: 2, row: 4, props: { supplySource: true } },
      { col: 2, row: 6, props: { supplySource: true } },
    ],
    coreSlots: CORE_10(3, 4, 2),
    units: [
      { typeId: 'germanicus', col: 4, row: 5, name: 'Germanicus' },
      { typeId: 'scorpio', col: 5, row: 4 },
      { typeId: 'scorpio', col: 5, row: 6 },
      { typeId: 'batavi', col: 6, row: 3 },
      { typeId: 'warband', col: 13, row: 3 },
      { typeId: 'warband', col: 14, row: 4 },
      { typeId: 'warband', col: 14, row: 5 },
      { typeId: 'warband', col: 14, row: 6 },
      { typeId: 'warband', col: 13, row: 7 },
      { typeId: 'nobles', col: 15, row: 4 },
      { typeId: 'nobles', col: 15, row: 6 },
      { typeId: 'skirmishers', col: 12, row: 2 },
      { typeId: 'skirmishers', col: 12, row: 8 },
      { typeId: 'hunters', col: 16, row: 3 },
      { typeId: 'hunters', col: 16, row: 7 },
      { typeId: 'lightHorse', col: 17, row: 2 },
      { typeId: 'lightHorse', col: 17, row: 8 },
      { typeId: 'arminius', col: 16, row: 5, name: 'Arminius' },
    ],
    scripts: [
      {
        turn: 5,
        spawn: [
          { typeId: 'warband', col: 18, row: 4 },
          { typeId: 'warband', col: 18, row: 6 },
        ],
      },
    ],
    objectives: [
      { id: 'rout', type: 'routArmy', required: true, text: 'Break the German host (≤35% remaining)' },
      { id: 'hero', type: 'survive', unit: 'germanicus', required: true, text: 'Germanicus must live' },
      { id: 'arm', type: 'heroDown', required: false, text: 'Kill or rout Arminius' },
    ],
    hints: ['This is the open field Rome was built for.', 'Flank with cavalry. Hold the center with steel.', 'Arminius falling is glory, not the requirement.'],
  },
];

export const CAMPAIGN_INTRO = {
  title: 'Aquila',
  subtitle: 'Germanicus and the Lost Eagles',
  text:
    'Nine years after the Teutoburg, three eagles still sleep in German earth. Tiberius sends his nephew Germanicus across the Rhine — not to make a province, but to make a memory. Recover what was lost. Come home with the standards.',
};

export const CAMPAIGN_ENDING = {
  decisive:
    'The Senate will vote you a triumph. The eagles are home. Germania is not a province — Tiberius forbids the cost — but no man will say the dead of Varus were left without an answer.',
  marginal:
    'The Rhine is quiet enough. One eagle, perhaps two, comes home. Germanicus is recalled before the work is finished. Rome calls it victory. The forests do not.',
  defeat:
    'The river takes the story back. Another generation will have to walk into those trees.',
};
