# Building parts (stage 1)

A building has a list of **parts** (`buildings.<id>.parts` in `src/data/shared/buildings.json`). Schema, defaults, level
filtering, legacy conversion and validation: `src/data/buildingParts.js` (the only place that knows the schema).

| kind | what | extra fields |
|---|---|---|
| `model` | something you see | `model:{type:'glb'|'prefab'|'primitive', ref}` |
| `fire_point` | where arrows are shot from (no tower needed) | `range, damage, reloadMinTicks, reloadMaxTicks, volleyCount, elevationRangeBonus, levelStats?` |
| `exit_point` | where units come out (facing = the building facing (rot not used yet)) | - |

Common: `id, kind, name, parent (group id | null), enabled, pos[3] (metres from the building centre, y up), rot[3] (rad), scale[3], minLevel, maxLevel|null`.

## Reading / writing
- Read: `effectiveParts(bDef, sharedBuildingWatchtower)` - stored parts, or the old tower fields converted (so nothing changes until a building is edited).
- Write: `dataRegistry.saveBuilding(id, { ...bDef, parts })` (validated: broken parts are rejected with a message). Never write another way.
- Create: `newPart(kind, overrides, existingParts)`. Level filter: `partsActiveAtLevel(parts, level)`. Stats at a level: `fireStatsAtLevel(part, level)`.
- Part animation: keyframe tracks use the part id as joint name (`tracks.<partId>`), like `tracks.torso`.

## Studio
`buildBuildingsStudioViewData` (buildingStudioAdapter.js) makes every part a joint under `torso` named by the part id and sets
`unit.parts`, `unit.hiddenJoints` (head, turret_socket, cape_back, quiver_back: never show), `unit.jointLabels`. Rig mode edits of such a joint must be written back
to the matching `parts[i]` (pos/rot/scale) and saved via `saveBuilding`; torso/pelvis edits keep going to `studioRig`.

## Simulation (stage 2)
Only buildings with STORED `parts` use them (buildings without are untouched, so nothing changes until edited):
- `fire_point` (active at the building's level, stats via `fireStatsAtLevel`) shoots on its own cooldown; **no tower / `hasWatchtower` needed**. A stored-parts building with no fire point never shoots.
- `exit_point`: the first active one is where recruited units appear (building-local offset: +Z = facing, +X = right); the muster spot is in front of it.
- `model` parts: drawn on the building body in the game: primitives and imported **glb with textures** (the file is stored inside the part: `model:{type:'glb', glbBase64, fitSize}`; prefab parts are not drawn yet).
- `enabled:false` switches a part off everywhere in the game (no model, no shooting, no exit); the Studio shows it dimmed.
- Not yet parts-driven: garrison exits, hero spawn, vision, the HUD tower icon and the AI still use the old tower fields.
