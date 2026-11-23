# GLB import (Studio → inspector → **Import** tab)

Choose a .glb, then what it is:

| Import as | What happens |
|---|---|
| **New unit** | Cut into rigid joint parts (pelvis/torso/head/arms/legs…), LOD0-2, added as a NEW base unit of the current faction. Rename / delete from the same tab. |
| **Armor / gear** | One mesh, scaled to the slot (head, chest, shoulder, bracer, glove, thigh, greave, boots, cape), saved as a prefab, optionally mirrored for the left side, equipped on the current unit. Fine-tune with Gear → Fit. |
| **Building skin** | One static mesh fitted to the building's footprint (base on the ground). Shown in the building's **Skins** tab (scrollable grid, ✕ to delete, "Default" = procedural look). |

Detail kit = triangle budget (Low / Medium / High / custom). Units also get LOD1 (30 %) and LOD2 (8 %) automatically.

Modules: `glbReader.js` (GLB → data) · `glbToUnit.js` (`buildUnitFromScene`, `buildStaticMeshFromScene`) · `meshSimplify.js` (seam-aware quadric decimation).
Rig mapping is by bone names (Mixamo, Blender/Rigify, VRM, CC4…); side comes from geometry (+x = `_R`). No skeleton → automatic rig by proportions.
Limits: no Draco/meshopt compression, humanoids only for "New unit", GLB animations are not imported, textures are baked into vertex colours.

Tests: `node tests/glb_import_test.mjs` · `node tests/simplify_quality_test.mjs` · `node tests/studio_import_smoke.mjs`
