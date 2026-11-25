# Kings Lands — `units.json` data contract

> **Layout note (stage 2):** the shipped data is now split per race (`src/data/races/`, `bases/`, `shared/`, see
> `src/data/DATA_LAYOUT.md`). `assembleBundle()` rebuilds exactly the bundle described here, so everything below about
> the *shape* of units.json still holds. Where it says "replace `units.json`", use `node scripts/data/build.mjs split <folder>`.

**Status: basic (v1).** It describes what exists today. New units, new clips and heroes will extend it; when they
do, update this file *and* `src/tools/studio/healthCheck.js` (every rule below that says "checked" lives there).

Who reads this file: the game code (AI or human) that consumes `src/data/visuals/units.json`, and the Studio
(`src/tools/studio/*`) that edits it. If something here and the code disagree, the code in
`src/render/modelFactory.js` / `src/render/animator3d.js` wins — and this file has a bug to fix.

---

## 1. Who owns what

| Thing | Owner | Rule |
|---|---|---|
| `src/data/visuals/units.json` | the Studio (edited), the game (read only) | The game never writes it. Edit through the Studio (**Export JSON**), or by hand + run **Health** in the Studio. |
| `src/render/modelFactory.js` | "sacred" | Builds the 3D body from `hierarchy`. Do not change its output format. |
| `src/render/animator3d.js` | "sacred" | Plays clips. Only small, backward-compatible edits (see its header). |
| `src/tools/studio/clipResolver.js` | shared | The ONE place that decides which clip a unit plays. Game code should call it (or copy its rules exactly). |
| `src/tools/studio/healthCheck.js` | Studio | Pure function `runHealthCheck(data)`. Safe to run from tests / CI: `node` + `esbuild`, no DOM. |

The Studio keeps its working copy as a **draft in `localStorage`** (`kings_lands_studio_draft_v2`). The draft is *not*
the file. The file only changes when you replace `units.json` with the exported one.

---

## 2. Top-level shape

```jsonc
{
  "version": "1.0.0",
  "teamPalettes": { "1": { ... }, "2": { ... } },   // colours of team 1 / team 2
  "prefabs":      { "sword": { ... }, ... },        // things that can be held (weapons, shields)
  "animations": {
    "keyframes":  { "attack_slash": { ... }, "swordsman_orc_attack_slash": { ... }, ... },
    "procedural": { "idle": { ... }, "walk": { ... }, ... }
  },
  "units":        { "swordsman": { ... }, ... }
}
```

All four of `teamPalettes`, `prefabs`, `animations.keyframes`, `animations.procedural`, `units` are required (checked).

### 2.1 `teamPalettes["1" | "2"]`
`{ name, primary, secondary, cloth, metal, darkMetal }` — all colours are `#rrggbb` (checked).
A mesh colour written `"team.primary"` (etc.) is looked up here. Tokens: `primary secondary cloth metal darkMetal` (checked).
A faction can tint the team colours at runtime (`FACTION_TEAM_COLORS` in `skinUtils.js`: human = none, orc, elf). That is code, not data, today.

### 2.2 `prefabs[id]` (held items)
```jsonc
{ "id": "sword", "type": "procedural_3d", "gltfUrl": null,
  "defaultSocket": "weapon_socket_R",
  "gripOffset": [0, 0.02, 0.04], "gripRotation": [1.25, 0, 0],   // default grip, a unit can override
  "parts": [ { "name": "blade", "shape": "extrude", "points": [[x,y],...], "size": [...], "pos": [x,y,z], "color": "...", "metalness": 0.8, "roughness": 0.3 } ] }
```
`parts` use the same mesh format as unit meshes (section 3.2). A prefab with no parts is invisible (checked).

---

## 3. Units

```jsonc
"swordsman": {
  "id": "swordsman",               // must equal the key (checked)
  "displayName": "Citadel Heavy Swordsman",
  "type": "procedural_3d", "gltfUrl": null,      // gltf is reserved, unused today
  "scale": 1.05,                   // > 0 (checked)
  "selectionRingRadius": 0.76,
  "bannerStyle": "royal_standard",
  "locomotionAnim": "walk",        // BASE move clip name (or a full clip name that ends in one)
  "combatAnim": "swordsman_attack_slash",   // attack clip (see 5.4)
  "equipment": { "weapon_socket_R": { "prefab": "sword", "gripOffset": [..], "gripRotation": [..] }, "weapon_socket_L": { ... } },
  "hierarchy": { "torso": { "pos": [x,y,z], "meshes": [ ... ], "children": { "head": { ... }, "arm_R": { ... } } } },
  "colorOverrides": { "torso": "#2926b5" },      // optional, see 3.3
  "skins": { "human": { "colorOverrides": {...}, "combatAnim": "...", "locomotionAnim": "..." }, "orc": {...}, "elf": {...} },
  "isMounted": true, "mountHierarchy": { ... }    // cavalry only
}
```

### 3.1 Hierarchy and joints
- `hierarchy` is a tree: **joint name → `{ pos, meshes, children }`**. Every joint becomes a `THREE.Group`; its **rest pose** is `pos` (+ optional `rot`).
- A unit **must** have a `torso` joint (checked). Standard joint names: `torso, head, arm_R, arm_L, leg_R, leg_L, weapon_socket_R, weapon_socket_L`.
- `mountHierarchy` (cavalry): joints prefixed `mount_` (`mount_torso, mount_head, mount_tail, mount_leg_FL/FR/BL/BR`). `isMounted: true` requires it (checked).
- **Joint names are the join key between a unit and animations.** A keyframe track named `arm_R` drives the `arm_R` joint of whichever unit plays the clip. A unit without that joint simply ignores the track.
- All joints a clip mentions should exist on at least one unit (checked as a warning).

### 3.2 Meshes (inside a joint)
`{ name, shape, size, pos, rot?, color, metalness?, roughness? }`
- `shape`: `cylinder | box | sphere | cone | extrude` (checked).
  - `cylinder` size `[radiusTop, radiusBottom, height, segments]`, `box` `[w,h,d]`, `sphere` `[radius, wSeg, hSeg]`, `extrude` uses `points: [[x,y],...]` (>= 3) plus `size` (depth etc.).
- `color`: `"#rrggbb"` or `"team.<token>"` (checked).
- Every mesh gets its **own material** (so per-joint recolouring is safe).

### 3.3 Colours per unit / faction
`colorOverrides` is keyed by **joint name** and paints every mesh *directly under that joint*. Unit-level first, then `skins[faction].colorOverrides` on top. `applySkinColors()` in `skinUtils.js` is the implementation.

### 3.4 Equipment
`equipment[socket]` puts a prefab on a joint (`weapon_socket_R / _L` today). `gripOffset` / `gripRotation` override the prefab's default grip **for this unit**.
The socket must exist on the unit and the prefab in `prefabs` (checked). Held items are **not animatable on their own**: they follow their socket joint.

### 3.5 Factions
Factions today: `human, orc, elf` (`skins` keys + these three defaults). A unit does **not** need a skin for each faction: missing skin = the unit's default look + the faction's team-colour tint.

---

## 4. Joint poses, rest pose and "relative" keys

- A joint's **rest pose** is its `pos` / `rot` in `hierarchy` (stored by the model factory in `userData.restPoses`).
- **Keyframes are stored RELATIVE to the rest pose**: `rot: [0,0,0]` = "exactly the rest rotation". Moving a joint in the Studio's *Rig* mode changes the rest pose, so every clip of that unit shifts with it. That is intended.
- Angles are radians (Euler XYZ), positions are in the joint's local units.

---

## 5. Animations

### 5.1 Clip naming — the most important rule
A clip is stored under a name. A **base** name is one of:

| Kind | Bases |
|---|---|
| Attack clips | `attack_slash`, `attack_thrust`, `shoot_bow`, `throw_javelin` |
| Other action clips | `take_damage`, `die` |
| Move clips | `idle`, `walk`, `run`, `gallop` |

Which clip does `unit` / `faction` really play for a base? **First that exists wins** (`resolveClip`):
1. `${unit}_${faction}_${base}` &nbsp;(e.g. `swordsman_orc_attack_slash`)
2. `${unit}_${base}` &nbsp;(e.g. `swordsman_attack_slash`)
3. `${base}` &nbsp;(global, e.g. `attack_slash`)

Which *base* an attack/move uses comes from the unit: `skins[faction].combatAnim` → `combatAnim` → `attack_slash`; same for `locomotionAnim` → `walk`.
Only the **ending** of `combatAnim` matters for choosing the base; the full name is just a hint (`baseOfClip`).
A name that repeats the unit prefix (`swordsman_swordsman_x`) is a bug (the Studio's clean-up deletes it).

### 5.2 Keyframe clips (`animations.keyframes[name]`)
```jsonc
{
  "mode": "keyframes",
  "layer": "upperBody",          // upperBody | lowerBody | fullBody (checked)
  "duration": 0.85,              // seconds, > 0 (checked)
  "loop": false,
  "clampWhenFinished": false,    // die: true, otherwise the unit "stands up" at the end
  "tracks": { "arm_R": [ KEY, KEY, ... ], "torso": [ ... ] },
  "events": [ EVENT, ... ]
}
```
- `layer`: `upperBody` = arms/torso over whatever the legs do; `lowerBody` = legs layer (a keyframe **idle** uses it); `fullBody` = takes over everything (`die`, or any clip with this layer).
- Walk / run / gallop are **procedural only** (checked). An `idle` keyframe clip must use `layer: "lowerBody"` and is overlaid on the procedural idle.
- Action clips should not loop (checked, warning).

**KEY** (one track entry):
```jsonc
{ "t": 0.28,                 // NORMALISED time 0..1 (checked), sorted ascending (checked), no duplicates
  "rot": [rx, ry, rz],       // radians, relative to rest pose
  "pos": [x, y, z],          // relative to rest pose
  "easing": "smooth",        // "smooth" (default) | "ease-in-out" | "linear" — easing of the segment that STARTS at this key
  "rotKey": false,           // optional: true/absent = this key owns rotation; false = it does not
  "posKey": false }          // optional: same for position
```
**Independent properties (rotation vs position).** Rotation and Position animate separately:
- If at least one key has `rotKey !== false`, rotation is *animated*: it is interpolated only between the keys that own it.
- If **no** key owns a property, it is *static*: it is a constant for the whole clip, and every key carries that same value.
- Old files without the flags mean "every key owns both" and still work. The Studio converts constant properties to static on load.
- Consumers that ignore the flags still get approximately right results, because the Studio keeps unowned values on the curve.

### 5.3 Procedural clips (`animations.procedural[name]`)
```jsonc
{ "mode": "procedural", "layer": "lowerBody",
  "frequency": 3.4, "bobAmplitude": 0.075, "torsoSway": 0.08, "armSwing": 0.42, "legSwing": 0.58,
  "events": [ { "time": 0.25, "type": "footstep", "payload": { "foot": "left" } } ] }
```
Numbers only (checked). `frequency > 0` (checked, warning). Cycle length = `1 / frequency` s. Move clips should carry `footstep` events (info).

### 5.4 Events
`{ "time": <seconds from clip start, 0..duration>, "type": ..., "payload": {...} }` — **time is in SECONDS** (keys use 0..1!).

| type | payload | meaning |
|---|---|---|
| `hit` | `socket` (joint the damage comes from), `damageType` | apply melee damage now |
| `release` | `socket`, `projectile` | spawn a projectile now (bow, javelin) |
| `footstep` | `foot` | for audio / dust |
| `sound` | `cue` | play a named sound cue |
| `effect` | `fx` | spawn a named visual effect |

Rules (checked): a **melee attack must have a `hit`** (otherwise it never damages); a **ranged attack must have a `release`** and should not have a `hit`; `socket` must be a real joint; `hit` should have `damageType`, `release` `projectile`, `sound` `cue`, `effect` `fx`.
`take_damage` **interrupts** an attack — this is a design decision, not a bug.

---

## 6. What the health check verifies (Studio → **Health**)

`error` = the game/studio will misbehave. `warn` = probably a mistake. `info` = good to know.
Errors: missing top-level keys; a unit with no hierarchy / no `torso`; `isMounted` without `mountHierarchy`; equipment on a missing socket or missing prefab; `combatAnim` / `locomotionAnim` pointing at nothing; a unit/faction that resolves to **no attack / move / idle / die / take_damage clip**; walk/run/gallop as keyframes; bad `layer`, `duration <= 0`, key time outside 0..1, unsorted keys, non-numeric rot/pos; unknown event type or socket; melee without `hit`; ranged without `release`; non-numeric procedural parameters.
Warnings and info: see the file; each message says what to do.

Run it from code: `import { runHealthCheck } from './src/tools/studio/healthCheck.js'` → `{ issues, counts }`.

---

## 7. How to extend (checklist)

**New unit** — add `units.<id>` with a hierarchy that has `torso` (+ the standard joints if it uses standard clips), set `combatAnim` / `locomotionAnim`, equipment. Nothing else is required: it will play the global clips until you author its own. Run **Health**.

**New clip base** (e.g. `cast_spell`, `block`, `heal`) — add the name to `ACTION_CLIPS` (and `ATTACK_CLIPS` if it deals damage) in `clipResolver.js`; add its rules to `healthCheck.js`; the Studio's timeline lists it automatically. Add a global clip `animations.keyframes.<base>`.

**New faction** — add it to `FACTIONS` in `studioApp.js` and a tint in `skinUtils.js` (`FACTION_TEAM_COLORS`), optionally `skins.<faction>` per unit.

**New event type** — add to `AnimEventTypes` in the animator (small, backward-compatible edit), to `EVENT_TYPES` in the health check, and document its payload in 5.4.

**Hero (planned, not defined yet)** — expected to be a unit entry plus extra data (name, level, abilities). Keep gameplay stats OUT of `units.json`; this file is *looks and animation only*. Combat numbers live in game code (the Arena uses `unit.combatStats` if present, as a test override).

---

## 8. Do / don't for code that reads this file
- Do resolve clips with `resolveClip`; never build clip names by hand.
- Do treat keyframe `t` as 0..1 and event `time` as seconds.
- Do not assume every unit has every faction skin, or every joint (`mount_*`, extra joints on heroes).
- Do not write to `units.json` at runtime; do not depend on key order.
- Don't change the key format or joint names without updating this file and the health check.


## Actions come from gear (`actionRules`, `prefab.weaponType`)

A unit's available actions are derived from what it carries; a weapon only OPENS an action slot, the clip itself still belongs to the unit (`unit_faction_base` → `unit_base` → `base`).

- Every prefab that can be held has `weaponType`: `melee_short` (attack_slash), `melee_long` (attack_thrust), `bow` (shoot_bow + attack_bash), `thrown` (throw_javelin), `shield` (block).
- `twoHanded: true` on a prefab: also opens `block` and locks the other hand.
- Two one-handed weapons of the same melee type: no new action, the attack uses both hands.
- Everyone always has `take_damage` and `die`; `idle` / `walk` / `run` / `gallop` are movement and not gear dependent.
- The table is in `units.json → actionRules` (the game and the studio read the same table; defaults in `weaponRules.js`).
- New action clips: `attack_bash` (melee hit with a launcher, needs a `hit` event) and `block` (hold pose).
- Clip names must be `unit_faction_base` (or global `base`). The legacy unit-wide form `unit_base` is no longer created and Health flags it.

## Loadouts and carried weapons

- `unit.equipment` = the main loadout (unchanged). Extra sets: `unit.loadouts[id] = { label, equipment }` (same shape as `equipment`).
- Items not held in a hand are carried on body points that are plain joints of the unit: `stow_back` (child of `torso`), `stow_hip_R`, `stow_hip_L` (children of `pelvis`, or of `torso` for units without a pelvis). They have no meshes, so the existing factory attaches `equipment[stow_x]` to them with no change.
- To switch loadouts in the game: rebuild or re-attach the prefabs from the new loadout's `equipment` (hand items and carried items change places together).
- A unit with several loadouts opens the action `switch_weapon`. Its clip should carry a `swap` event (`payload: { loadout: 'next' | <id> }`) at the moment the weapon changes hands; the game performs the switch when it receives that event. Until a clip exists the switch can be instant.
- Rules for hands (two-handed locks the other hand) apply to each loadout separately.

---

## 9. Imported models (GLB) — `lods`, `importInfo`, per-vertex `colors`

Made by **Import GLB** in the Studio (`src/tools/import/*`). The result is an ordinary unit: a rigid joint hierarchy whose
joints carry `shape: "mesh"` parts, so poses, clips, Rig mode and the instancing batcher work exactly as for any other unit.

- `meshes[].vertices / faces` are in the **joint's local space** (pivot = origin), so rotating a joint rotates its part about the right point.
- `meshes[].colors` = one `[r,g,b]` (0-255, sRGB) per vertex, multiplied with the part `color` (`#ffffff` = as is). Textures of the GLB are baked into these.
- `lods` (optional) = `{ "1": { "<joint>": [meshDef] }, "2": { ... } }` — lighter geometry for the SAME joints. LOD0 is the `hierarchy` itself.
  `UnitRenderer` switches by on-screen height (`LOD_PIXEL_THRESHOLDS` in `unitRenderer.js`). Seam vertices between joints are reduced consistently, so no cracks open.
- `importInfo` = `{ source, rigMode: "skeleton" | "proportional", originalTriangles, lodTriangles: [..] }` — informational only.

### 9b. `buildingSkins` (top level of units.json) and imported gear

```
buildingSkins: { "<buildingId>": { active: "default" | "<skinId>", items: { "<skinId>": { name, fitRadius, mesh:{vertices,faces,colors}, importInfo } } } }
```
`BuildingModelFactory.getActiveSkin(type)` replaces the procedural architecture with the active skin (scaled by footprint / `fitRadius`; no door leaves).
Imported gear is a normal prefab (`parts:[{shape:"mesh",...}]`) with an extra `importInfo`. Buildings no longer have banners / flags.
