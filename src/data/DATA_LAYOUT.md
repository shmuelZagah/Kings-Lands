# Kings Lands — data layout (per race)

The game data no longer lives in five big JSON files. It lives in many small files under `src/data/`,
one **identity card per race**. `dataRegistry.js` is still the only reader/writer; the labs and the game
call the same registry API as before.

```
src/data/
  races/<race>.json            identity card: id, name, teamColors, bases[], units[], heroes[], gear[], animations[], file paths
  races/<race>/units.json      { visuals: {id: unitVisual}, stats: {id: unitStat} }   non-base units of the race
  races/<race>/gear.json       { prefabs: {...} }                                      armour / weapons of the race
  races/<race>/animations.json { keyframes, procedural }                               clips named after the race's units
  races/<race>/heroes.json     { heroes, prefabs }                                     (only races that have heroes)
  bases/<baseId>.json          ONE base character / mount (the heavy meshes)
  shared/                      engineConfig, unitsMeta (palettes, factions, rules), unitStatsMeta (formationRules),
                               buildings, buildingVisuals, heroesMeta (spell trees...), gear + animations without a race,
                               order.json (original key order, so UI lists keep their order)
  dataLayout.js                splitBundle() / assembleBundle(): pure, tested, used by the build script, the app and the tests
  dataFiles.generated.js       GENERATED static imports of every file above (Vite and node load the same files)
  defaults.js                  assembles the shipped bundle: defaultUnitsVisuals, defaultUnitStats, defaultBuildingsData, ...
```

Rules
* `mirukenkay` is a **base unit only**. Its bases are in `bases/`, its gear in `shared/gear.json`, it is never in `getRaceCards()`.
* Buildings have no race today, so they are `shared/buildings.json`; race cards say `buildings: "shared"`.
* Overrides (lab edits, drafts) are stored per entry in the registry (`unit:<id>`, `skin:<id>`...) and merged on save;
  saving never rewrites these files. The files are the *shipped defaults*.
* Never mutate big mesh arrays in place (see `dataRegistry.js`).

## Registry API for races
`getRaces()` / `getRace(id)` (unchanged: faction definitions), and new: `getRaceCards()`, `getRaceCard(id)`,
`getUnitsForRace(id)`, `getBasesForRace(id)`, `getGearForRace(id)`, `getHeroesForRace(id)`, `getBuildingsForRace(id)`.
All return copies.

## Changing the shipped data (the old "replace units.json" step)
A lab's **Export JSON** still produces the old monolithic files. To ship them:
1. put the exported files in a folder with the old names (`visuals/units.json`, `unitStats.json`, `buildings.json`,
   `buildingVisuals.json`, `heroes.json`, `engineConfig.json`),
2. `node scripts/data/build.mjs split <that folder>`  (rewrites `races/`, `bases/`, `shared/` and the generated index),
3. run the tests, commit.
`node scripts/data/build.mjs index` only regenerates `dataFiles.generated.js` (after adding a file by hand);
`node scripts/data/build.mjs check` prints what the files assemble to.

## How to add a race (checklist)
1. Add the race to `factions` in `shared/unitsMeta.json` (`displayName`, `teamColors`).
2. Create `races/<race>.json` (copy another card, set `id`, `name`; lists may start empty) and the files it points to
   (`units.json`, `gear.json`, `animations.json` as `{}`-shaped like the others).
3. Add its base character(s) as `bases/<baseId>.json` (a unit visual with `"race": "<race>"`) and its unit stats in
   `races/<race>/units.json` → `stats` (with `"race": "<race>"`).
4. `node scripts/data/build.mjs index`, then `node --test tests/regression/data_split_equality.test.mjs`.
   Nothing else: no code changes.
(Faster: create the race in the labs, Export JSON, and use the `split` command above.)

## The simulation
The sim never reads the registry or localStorage for game data. `dataRegistry.getSimSnapshot()` produces a frozen,
versioned snapshot (`src/sim/simConfig.js`); `SimBridge` sends it with the INIT of a NEW match and the worker's
`GameState` applies it with `applySimSnapshot` (the only place that changes sim data). Lab edits reach the next
match; a running match keeps the snapshot it started with (the live `SYNC_*` commands were removed).
Tests: `tests/regression/sim_snapshot.test.mjs`, `data_split_equality.test.mjs`, `races_registry.test.mjs`.
