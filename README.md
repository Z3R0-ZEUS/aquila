# Aquila — Germanicus and the Lost Eagles

A browser hex wargame: Panzer Corps–style operational combat set in Germania, 14–16 AD.

## Run

Python 3 is enough. In this folder:

```
py -3 -m http.server 8765
```

Then open http://localhost:8765

ES modules will not load from `file://`. Use the local server.

## Play

- Left click: select / move / attack (a preview appears before you commit)
- Right click: deselect
- Shift-drag or middle-mouse: pan
- WASD / arrows: pan
- Scroll: zoom
- F: fit the whole map
- Enter: end turn

Terrain, weather, supply, entrenchment, and flanking all show up in the combat preview. Romans suffer in deep woods and marsh; Germans suffer in the open.

Core units persist between the five missions. Spend **Honors** in winter quarters on replacements and new cohorts.

## Campaign

1. Castra Vetera, 14 AD — hold the Rhine fortress
2. Land of the Chatti, 15 AD — burn villages or take the hillfort
3. Pontes Longi, 15 AD — extract the army along the causeway
4. Teutoburg, 15 AD — recover the eagle of Legio XIX
5. Idistaviso, 16 AD — break Arminius on open ground
