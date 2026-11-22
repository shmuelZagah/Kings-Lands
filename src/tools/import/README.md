# GLB import + automatic polygon reduction

```
.glb ──readGlb──▶ scene ──buildUnitFromScene──▶ unit (units.json record, with lods)
        glbReader.js        glbToUnit.js  ── meshSimplify.js (quadric decimation, seam-aware)
```
* Studio → **Import GLB** (top bar). Asks for an id and the triangle budget of LOD0 (default 3500); LOD1 ≈ 28 %, LOD2 ≈ 8 %.
* Rig mapping: by bone names (Mixamo, Blender/Rigify, VRM, CC4…) → `pelvis torso head arm/forearm/hand leg/shin/foot (_R/_L)`.
  Side is decided by geometry (+x = `_R`, the game's convention), not by the "Left/Right" in the name.
  No skeleton (or not a humanoid) → automatic rig from body proportions; fix pivots afterwards in Studio → Rig mode.
* Skin is cut into rigid parts (triangle → joint that owns most of its weight). Same structure the game already renders.
* Limits: Draco/meshopt compressed GLBs (re-export without compression), humanoids only (animals / horses = next step),
  GLB animations are not imported (build them in the Studio timeline), textures become per-vertex colours.

Tests: `node tests/glb_import_test.mjs` · preview image: `python3 tests/render_unit_preview.py unit.json out.png`
