# Kings Lands

Browser RTS / 3D engine (Vite + Three.js, deterministic simulation in a Web Worker).

```
npm install
npm run dev            # http://localhost:3000   (labs: /units-lab, /studio, /heroes, /map-editor)
npm run build
npm test               # unit + regression tests (npm run test:all = the older full runner)
npm run data:check     # validate the shipped data (cross references); exit code 1 on errors
```

Where to read next: `ARCHITECTURE_RULES.md` (invariants), `PROJECT_MAP.md` (code map),
`src/tools/studio/DATA_CONTRACT.md` (who owns / writes which data), `src/data/DATA_LAYOUT.md` (file layout).

## How to add things (data only, no code edits)

All game data is a set of small JSON files under `src/data/`. `dataRegistry` assembles them; the labs, the Studio, the
Hall of Heroes, the previews and the match all read them through it, so a new entry shows up everywhere.
After adding or removing a file run **`npm run data:index`** (regenerates `dataFiles.generated.js` and adds the new ids
to `shared/order.json`), then **`npm run data:check`** (validation) and the tests.
Easiest way to get a valid entry: copy an existing one of the same kind and change the id and the fields.

**A unit** (e.g. a new human unit)
1. In `src/data/races/<race>/units.json` add `visuals.<id>` (copy a unit's visual: `id`, `displayName`, `hierarchy`, `equipment`, ...) and `stats.<id>` (copy its stats: `id`, `name`, `baseCharId`, `hp`, `cost`, ...). The `id` must equal the key.
2. In `src/data/races/<race>.json` add the id to `units`.
3. To make it recruitable add an option `{ "id": "<id>", "kind": "unit", "unitType": "<id>", "unlockLevel": 1, "cost": {...}, "trainTicks": N, "xpReward": N }` to a building's `options` in `src/data/shared/buildings.json`.
   (A unit with its own model sets `baseCharId` to its own id, like the ballista; otherwise it points at a base, see below.)

**A base character / mount**
1. Add `src/data/bases/<id>.json` (copy another base; the id should end in `_base`, `_base_2`, ... or be referenced by a unit's `baseCharId` / `mountType`). Set `race`.
2. Add the id to `bases` in `src/data/races/<race>.json`.

**A building**
1. Add the building to `src/data/shared/buildings.json` (`buildings.<id>`, copy a similar one) and its look to `src/data/shared/buildingVisuals.json`.
2. Skins are made in the Studio (they are saved as overrides, not files); to ship a skin as a default, export from the lab and run `node scripts/data/build.mjs split <folder>`.

**A hero**
1. In `src/data/races/<race>/heroes.json` add `heroes.<id>` (copy a hero; set `race`, `baseCharId`, spells...). Create the file for a race that has none.
2. Add the id to `heroes` in `src/data/races/<race>.json` and add `"heroes": "races/<race>/heroes.json"` to its `files`.

**A race**
1. Add `src/data/races/<race>.json` (identity card: `id`, `name`, `teamColors`, `bases`, `units`, `heroes`, `gear`, `animations`, `buildings: "shared"`, `files`).
2. Add `src/data/races/<race>/units.json` (`{"visuals":{},"stats":{}}`), `gear.json` (`{"prefabs":{}}`), `animations.json` (`{"keyframes":{},"procedural":{}}`) and list them in the card's `files`.
3. Add the race to `factions` in `src/data/shared/unitsMeta.json` (`displayName`, `teamColors`, `sharedUnits`).
4. Then add its bases and units as above.

Edits made in the labs are **not** written to these files: they are saved in the browser as overrides
(`kings_lands_data_registry_draft_v1`). To make lab edits the new shipped defaults use the lab's **Export JSON** and
`node scripts/data/build.mjs split <folder>` (see `src/data/DATA_LAYOUT.md`). Edits made while a match is running apply from the next match.
