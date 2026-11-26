/**
 * Kings Lands — Building 3D Studio View Adapter
 * (src/tools/units_buildings/buildingStudioAdapter.js)
 *
 * Exposes every Building in `buildings.json` as an articulated 3D Studio entity inside `StudioApp`
 * (when editing a Building in the Animation Lab), allowing:
 * - Full 3D inspection and part selection (`pelvis` = foundation, `torso` = main hall/walls,
 *   `head` = roof/spire/turret, `turret_socket` = muzzle/ballista socket, `arm_L` = left door leaf, `arm_R` = right door leaf).
 * - Dedicated Building Animation Session clips on the Studio Timeline (no unit movement or unit combat clips):
 *   - `build_construct` (Construction)
 *   - `idle` (Idle / Standing)
 *   - `level_up` (Level Up / Upgrade)
 *   - `recruit_spawn` (Recruiting Units — Gate Opens & Closes)
 *   - `damage_stage_1`, `damage_stage_2` (Damage Stages by HP loss)
 *   - `collapse_destroy` (Destruction / Collapse)
 */

import { dataRegistry } from '../../data/dataRegistry.js';
import { getFactions, getFactionColors, FACTION_TEAM_COLORS } from '../studio/skinUtils.js';

export const BUILDING_STUDIO_CLIPS = Object.freeze([
  'build_construct',
  'idle',
  'level_up',
  'recruit_spawn',
  'damage_stage_1',
  'damage_stage_2',
  'collapse_destroy',
  'victory_cheer'
]);

export const BUILDING_LEVEL_UPGRADE_FEATURES = Object.freeze([
  { id: 'trim', label: '👑 Gilded Roof & Crest Trim', defaultAtLevel: 3 },
  { id: 'braziers', label: '🔥 Entrance War Braziers', defaultAtLevel: 3 },
  { id: 'buttresses', label: '🛡️ Reinforced Stone Buttresses', defaultAtLevel: 4 }
]);

export function ensureBuildingLevelUpgradesConfig(bDef) {
  if (!bDef) return {};
  const maxLv = Math.max(1, (bDef.maxLevel | 0) || (bDef.canAutoLevel ? 3 : 1));
  if (!bDef.levelUpgrades || typeof bDef.levelUpgrades !== 'object') {
    bDef.levelUpgrades = {};
  }
  for (let lv = 2; lv <= maxLv; lv++) {
    const key = String(lv);
    if (!bDef.levelUpgrades[key]) {
      bDef.levelUpgrades[key] = {
        banners: lv === 2,
        trim: lv === 3,
        braziers: lv === 3,
        buttresses: lv === 4
      };
    }
  }
  return bDef.levelUpgrades;
}

/**
 * Computes which visual upgrade features are active at `targetLevel` by accumulating
 * all features unlocked at any level `2 <= lv <= targetLevel` (so Level 2 banners stay at Level 3+).
 */
export function getCumulativeBuildingUpgradesAtLevel(bDef, targetLevel = 1) {
  const lv = Math.max(1, targetLevel | 0);
  const upgMap = ensureBuildingLevelUpgradesConfig(bDef);
  const cumulative = {
    level: lv,
    banners: false,
    trim: false,
    braziers: false,
    buttresses: false,
    unlockedAt: {}
  };
  for (let k = 2; k <= lv; k++) {
    const stepCfg = upgMap[String(k)] || {};
    for (const feat of BUILDING_LEVEL_UPGRADE_FEATURES) {
      if (stepCfg[feat.id]) {
        cumulative[feat.id] = true;
        if (!cumulative.unlockedAt[feat.id]) {
          cumulative.unlockedAt[feat.id] = k;
        }
      }
    }
  }
  return cumulative;
}

export function canBuildingRecruitUnits(bDef) {
  if (!bDef || !Array.isArray(bDef.options)) return false;
  return bDef.options.some((o) => o && (o.kind === 'unit' || o.kind === 'heroes_menu'));
}

export function getBuildingStudioClipsForBuilding(bDef) {
  const canRecruit = canBuildingRecruitUnits(bDef);
  return BUILDING_STUDIO_CLIPS.filter((c) => canRecruit || c !== 'recruit_spawn');
}

export const BUILDING_CLIP_LABELS = Object.freeze({
  build_construct: 'Construction (build_construct)',
  idle: 'Standing Idle (idle)',
  level_up: 'Level Up / Upgrade (level_up)',
  recruit_spawn: 'Recruiting / Gate Open (recruit_spawn)',
  damage_stage_1: 'Damaged Stage 1 (damage_stage_1)',
  damage_stage_2: 'Damaged Stage 2 (damage_stage_2)',
  collapse_destroy: 'Collapse / Destroyed (collapse_destroy)',
  victory_cheer: 'Victory Cheer! 🎉 (victory_cheer)'
});

/**
 * Rig-mode edits of a building (rotation/scale/position of its joints) are stored on the building definition as
 * `studioRig: { <joint>: { pos, rot, scale } }`. The Studio skeleton is generated, so they are re-applied here.
 */
export function applyStudioRig(unit, rig) {
  unit.studioRig = rig && typeof rig === 'object' ? JSON.parse(JSON.stringify(rig)) : undefined;
  if (!unit.studioRig) return;
  const walk = (nodes) => {
    for (const [name, def] of Object.entries(nodes || {})) {
      const r = unit.studioRig[name];
      if (r) {
        if (Array.isArray(r.pos)) def.pos = [...r.pos];
        if (Array.isArray(r.rot)) def.rot = [...r.rot];
        if (Array.isArray(r.scale)) def.scale = [...r.scale]; else delete def.scale;
        unit.restPoses[name] = { ...(unit.restPoses[name] || {}), pos: [...(def.pos || [0, 0, 0])], rot: [...(def.rot || [0, 0, 0])] };
      }
      walk(def.children);
    }
  };
  walk(unit.hierarchy);
}

/**
 * Builds a Studio-compatible `unitsData` object where each building in `buildingsData.buildings`
 * (excluding `citadel_slot`) is represented as an articulated 3D hierarchy for `ModelFactory` & `Animator3D`.
 */
export function buildBuildingsStudioViewData(
  buildingsData = null,
  buildingVisuals = null,
  baseUnitsData = null
) {
  const effBuildingsData = buildingsData || dataRegistry.getBuildings();
  const units = {};
  const bMap = effBuildingsData?.buildings || {};

  for (const [bId, bDef] of Object.entries(bMap)) {
    if (bId === 'citadel_slot') continue;
    const r = Math.min(3.2, Math.max(1.6, (Number(bDef.footprintRadiusMeters) || 5) * 0.35));
    const isTower = bId === 'watchtower' || bId === 'ballista_tower';
    const isBallistaTower = bId === 'ballista_tower';
    const maxGarrison = bDef.maxGarrison | 0;
    const h = bId === 'citadel' ? 2.4 : isTower ? 2.6 : 1.55;
    const hasWt =
      bDef.hasWatchtowerSupport !== false &&
      ((bDef.watchtowerLevel | 0) > 0 || Boolean(bDef.hasBuiltInTurret));

    const torsoMeshes = [
      {
        name: 'main_hall',
        shape: isTower ? 'cylinder' : 'box',
        size: isTower ? [r * 0.55, r * 0.68, h] : [r * 1.15, h, r * 0.95],
        pos: [0, h * 0.5, 0],
        color: '#94a3b8'
      }
    ];

    // Arrow slits: appear on towers ONLY when maxGarrison > 0!
    if (isTower && maxGarrison > 0) {
      for (let s = 0; s < Math.min(4, maxGarrison * 2); s++) {
        const ang = (s * Math.PI) / 2;
        torsoMeshes.push({
          name: `arrow_slit_${s + 1}`,
          shape: 'box',
          size: [0.1, 0.42, 0.12],
          pos: [Math.sin(ang) * (r * 0.58), h * 0.62, Math.cos(ang) * (r * 0.58)],
          color: '#090d16'
        });
      }
    }

    const headMeshes = [
      {
        name: 'roof_main',
        shape: 'cone',
        size: [r * 0.82, 0.95, 4],
        pos: [0, 0.48, 0],
        rot: [0, 0.785, 0],
        color: '#2563eb'
      }
    ];

    if (isBallistaTower) {
      headMeshes.push({
        name: 'mounted_ballista_arms',
        shape: 'box',
        size: [1.35, 0.14, 0.18],
        pos: [0, 0.28, r * 0.45],
        color: '#fbbf24'
      });
    } else if (hasWt && !isTower) {
      headMeshes.push({
        name: 'building_watchtower_turret',
        shape: 'cylinder',
        size: [0.28, 0.34, 1.15],
        pos: [r * 0.42, 0.35, -r * 0.36],
        color: '#64748b'
      });
    }

    const tOff = Array.isArray(bDef.turretOffset) ? bDef.turretOffset : [0, h + 0.8, 0];
    const turretSocketPos = [
      Number(tOff[0]) * 0.35 || 0,
      0.55,
      Number(tOff[2]) * 0.35 || 0
    ];

    const bSkinPalette = {};
    const dynamicFactions = getFactions(baseUnitsData);
    for (const fId of dynamicFactions) {
      const tc = getFactionColors(baseUnitsData, fId) || FACTION_TEAM_COLORS[fId];
      bSkinPalette[fId] = {
        primary: tc?.primary || '#2563eb',
        secondary: tc?.secondary || '#94a3b8'
      };
    }

    units[bId] = {
      displayName: bDef.name || bId,
      buildingId: bId,
      race: bDef.race || undefined,
      isBuildingEntity: true,
      canRecruitUnits: canBuildingRecruitUnits(bDef),
      allowedBuildingClips: getBuildingStudioClipsForBuilding(bDef),
      locomotionAnim: 'idle',
      combatAnim: 'idle',
      restPoses: {
        pelvis: { pos: [0, 0.12, 0], rot: [0, 0, 0] },
        torso: { pos: [0, 0.12, 0], rot: [0, 0, 0] },
        head: { pos: [0, h + 0.12, 0], rot: [0, 0, 0] },
        turret_socket: { pos: turretSocketPos, rot: [0, 0, 0] },
        arm_L: { pos: [-0.32, 0.48, r * 0.48], rot: [0, 0, 0] },
        arm_R: { pos: [0.32, 0.48, r * 0.48], rot: [0, 0, 0] }
      },
      hierarchy: {
        pelvis: {
          pos: [0, 0.12, 0],
          meshes: [
            {
              name: 'foundation_slab',
              shape: 'box',
              size: [r * 1.38, 0.24, r * 1.38],
              pos: [0, 0, 0],
              color: '#475569'
            }
          ],
          children: {
            torso: {
              pos: [0, 0.12, 0],
              meshes: torsoMeshes,
              children: {
                head: {
                  pos: [0, h + 0.12, 0],
                  meshes: headMeshes,
                  children: {
                    turret_socket: {
                      pos: turretSocketPos,
                      meshes: hasWt
                        ? [
                            {
                              name: 'turret_muzzle_marker',
                              shape: 'sphere',
                              size: [0.14, 8, 8],
                              pos: [0, 0, 0],
                              color: '#f59e0b'
                            }
                          ]
                        : []
                    }
                  }
                },
                arm_L: {
                  pos: [-0.32, 0.48, r * 0.48],
                  meshes: [
                    {
                      name: 'door_leaf_L',
                      shape: 'box',
                      size: [0.3, 0.72, 0.08],
                      pos: [0.14, 0, 0],
                      color: '#5c2808'
                    }
                  ]
                },
                arm_R: {
                  pos: [0.32, 0.48, r * 0.48],
                  meshes: [
                    {
                      name: 'door_leaf_R',
                      shape: 'box',
                      size: [0.3, 0.72, 0.08],
                      pos: [-0.14, 0, 0],
                      color: '#5c2808'
                    }
                  ]
                }
              }
            }
          }
        }
      },
      skins: bSkinPalette
    };
    applyStudioRig(units[bId], bDef.studioRig);
  }

  const registryBuildingVisuals = dataRegistry.getBuildingVisuals();
  const rawBldKf = buildingVisuals
    ? {
        ...(registryBuildingVisuals?.animations?.keyframes || {}),
        ...(buildingVisuals?.animations?.keyframes || {})
      }
    : {
        ...(registryBuildingVisuals?.animations?.keyframes || {})
      };
  const keyframes = {};
  for (const [k, v] of Object.entries(rawBldKf)) {
    if (!v) continue;
    const isBldClip =
      k.startsWith('building_') ||
      BUILDING_STUDIO_CLIPS.some((bc) => k === bc || k.endsWith(`_${bc}`) || k.includes(`_${bc}__v`));
    if (isBldClip) {
      keyframes[k] = JSON.parse(JSON.stringify(v));
    }
  }

  for (const clipBase of BUILDING_STUDIO_CLIPS) {
    const srcClip = keyframes[`building_${clipBase}`];
    if (srcClip && !keyframes[clipBase]) {
      keyframes[clipBase] = JSON.parse(JSON.stringify(srcClip));
    }
  }

  return {
    version: 3,
    factions: baseUnitsData?.factions || {
      human: { displayName: 'Human', sharedUnits: true },
      katiler: { displayName: 'Katiler', sharedUnits: false },
      mirukenkay: { displayName: 'Mirukenkay', sharedUnits: false }
    },
    prefabs: baseUnitsData?.prefabs || {},
    units,
    animations: {
      procedural: {
        idle: { breatheSpeed: 1, breatheAmp: 0 }
      },
      keyframes
    }
  };
}
