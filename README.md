# Aquila — Germanicus and the Lost Eagles

A browser hex wargame: Panzer Corps–style operational combat set in Germania, 14–16 AD.

## Modes

- **Campaign** — six linked missions on a theater map of Germania. Core cohorts persist. Spend Honors in winter camp to refill, drill, and arm them.
- **Skirmish** — any field, as Rome or as the tribes.
- **Difficulty** — Recruit, Seasoned, Veteran.
- Mid-battle **Save** / **Resume** for campaign fights.

## Run

Python 3 is enough. In this folder:

```
py -3 -m http.server 8765
```

Then open http://localhost:8765

ES modules will not load from `file://`. Use the local server.

## Play

- Left click: select / move / attack (a preview appears before you commit)
- Right click: deselect or cancel a levy
- Shift-drag or middle-mouse: pan
- WASD / arrows: pan
- Scroll: zoom
- F: fit the whole map
- N or Tab: next idle unit
- Space: hold / skip a unit
- U: undo last move
- R: replacements (reinforce)
- V: veteran drafts (elite replacements)
- I: draw ammunition
- X: forced march
- G: throw up works
- T: form / break testudo
- Y: rally (commander)
- C: scout (exploratores)
- L: lie in wait (ambushers)
- Enter: begin battle (deployment) or end turn

Terrain, weather, supply, entrenchment, and flanking all show up in the combat preview. Romans suffer in deep woods and marsh; Germans suffer in the open.

## Deployment

After the briefing the army dresses on the green hexes. Reposition cohorts by selecting and clicking an empty deploy hex. Spend **Honors** in the Levy panel to raise a unit, then click an empty gold hex to place it. Campaign hires join the core if a slot remains; otherwise they fight this field only. Enter begins the day.

## Orders

Selected units show the actions they can take.

- **Replacements** — Panzer Corps–style reinforce. In supply, not in contact with the enemy. Spend honors to refill strength. Regular drafts dilute experience.
- **Veteran drafts** — twice the cost, keeps the stars.
- **Draw ammunition** — missile troops refill from the wagons if in supply.
- **Forced march** — +2 movement, +1 disorder. Cannot attack that day.
- **Throw up works** — spend the turn to entrench now.
- **Form testudo** — formed cohorts lock shields against shot.
- **Absorb** — fold an adjacent cohort of the same type into this one.
- **Rally** — a commander steadies shaken men beside him.
- **Scout** — exploratores reveal hidden warbands.
- **Lie in wait** — ambushers hide in timber.
- **Repair / Fortify** — immunes rebuild a causeway or raise a marching camp.
- **Torch** — burn a Chatti village.

Core units persist between the six missions (14 slots). Between battles the **campaign map** is the camp: click the current node to march, and spend **Honors** on replacements, drill (+1 experience), arm (once, a lasting stat), and new cohorts.

## Campaign

Between missions you stand on a map of Germania. The gold node is the next field. Click it — or March — for the briefing. Select a cohort in the camp dock to refill, drill, arm, hire, or dismiss.

1. Castra Vetera, 14 AD — hold the Rhine fortress
2. Land of the Chatti, 15 AD — burn villages or take the hillfort
3. Pontes Longi, 15 AD — extract the army along the causeway
4. Teutoburg, 15 AD — recover the eagle of Legio XIX
5. Idistaviso, 16 AD — break Arminius on open ground
6. The Angrivarian Wall, 16 AD — storm the turf bank

Formed cohorts can lock **testudo** against missiles. Legionaries suffer in deep woods; warbands suffer in the open.
