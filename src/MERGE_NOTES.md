Merge of the lab + bridge onto the clean project (3-way, base = the src.zip I first received).
No conflicts. The only manual edit: the ranged windup is a shared helper _stepRangedShot used by both attacks on units and on buildings (the new code attacks buildings with a second ranged path).

changed: data/visuals/units.json
changed: render/animator3d.js
changed: render/modelFactory.js
changed: render/unitRenderer.js
changed: sim/gameState.js
changed: sim/simBridge.js
changed: sim/systems/productionAndRallySystem.js
changed: sim/systems/unitCombatSystem.js
new: tools/studio/DATA_CONTRACT.md
new: tools/studio/clipEditing.js
new: tools/studio/clipResolver.js
changed: tools/studio/gizmoController.js
new: tools/studio/healthCheck.js
changed: tools/studio/inspectorPanel.js
new: tools/studio/keyTracks.js
new: tools/studio/portraitRenderer.js
changed: tools/studio/sandboxArena.js
new: tools/studio/skinUtils.js
changed: tools/studio/studioApp.js
changed: tools/studio/studioStateManager.js
changed: tools/studio/timelineEditor.js
new: tools/studio/weaponRules.js
