/** Theater map of Germanicus's campaigns, 14–16 AD. Positions are % of the painting. */

export const CAMPAIGN_NODES = [
  {
    id: 'vetera',
    scenarioId: 'vetera',
    year: '14 AD',
    title: 'The Rhine Holds',
    subtitle: 'Castra Vetera',
    x: 18,
    y: 62,
    blurb: 'The lower Rhine fortress. Hold the principia against the night horns.',
  },
  {
    id: 'chatti',
    scenarioId: 'chatti',
    year: '15 AD',
    title: 'Fire and Iron',
    subtitle: 'Land of the Chatti',
    x: 42,
    y: 72,
    blurb: 'Burn the hearths or take the hillfort. Teach the Chatti that Rome still wakes.',
  },
  {
    id: 'pontes',
    scenarioId: 'pontes',
    year: '15 AD',
    title: 'The Long Bridges',
    subtitle: 'Pontes Longi',
    x: 30,
    y: 44,
    blurb: "Caecina's column on the bog roads. Extract the army west, off the causeway.",
  },
  {
    id: 'teutoburg',
    scenarioId: 'teutoburg',
    year: '15 AD',
    title: 'The Bones of Varus',
    subtitle: 'Saltus Teutoburgiensis',
    x: 48,
    y: 36,
    blurb: 'The forest where three eagles slept. Recover the standard of Legio XIX.',
  },
  {
    id: 'idistaviso',
    scenarioId: 'idistaviso',
    year: '16 AD',
    title: 'The Plain of Idistaviso',
    subtitle: 'Campus Idistaviso',
    x: 64,
    y: 46,
    blurb: 'Open ground on the Weser. Break Arminius where formed steel is strongest.',
  },
  {
    id: 'angrivarian',
    scenarioId: 'angrivarian',
    year: '16 AD',
    title: 'The Angrivarian Wall',
    subtitle: 'Agger Angrivarorum',
    x: 76,
    y: 18,
    blurb: 'A turf bank in the north. Storm it before the season closes.',
  },
];

export const DRILL_COST = 20;
export const DRILL_CAP = 5;
export const ARM_COST = 25;

export function nodeState(campaign, node, index) {
  const mission = campaign?.mission ?? 0;
  if (index < mission) return 'done';
  if (index === mission) return 'current';
  return 'locked';
}

export function historyFor(campaign, scenarioId) {
  return (campaign?.history || []).find((h) => h.mission === scenarioId) || null;
}
