/**
 * Kings Lands — Phase 6: Building Turrets, Garrisoned Archers, Infirmary & Banner House Auras
 * (src/sim/systems/buildingCombatSystem.js)
 *
 * Implements:
 * 1. Tower Turret & Garrisoned Archers with +6m elevation bonus (`TOWER_HEIGHT_RANGE_BONUS_FX`).
 * 2. Banner House AoE Aura (`26m`): grants `isBuffed = true` / `hasBannerBuff = true` (+20% damage, +20% defense, morale regen).
 * 3. Infirmary AoE Healing & Squad Reinforcement (`22m`):
 *    - Requires company/units to be out of combat (`ticksSinceLastHit >= 60` / `ticksSinceLastCombat >= 60`, i.e., 3 seconds).
 *    - Step A (Heal Living): Restores HP to all living injured members of the company (`isHealing = true`).
 *    - Step B (Reinforce Dead Units at 50% Cost): Once all living members are at 100% HP, if `memberIds.length < maxMemberCount`,
 *      every 35 ticks (1.75s) deducts 50% of a single unit's resource cost and spawns 1 reinforced unit from the Infirmary door
 *      to rejoin the company's formation slots.
 * 4. Ammo Resupply: Archers out of combat near completed military/supply buildings replenish arrows.
 */

import { FX_ONE, mulDiv, fxHypot, xorshift32, fxRandomRange } from '../../core/fx.js';
import { defaultBuildingsData as buildingsData } from '../../data/defaults.js';
import { defaultUnitStats as unitStatsData } from '../../data/defaults.js';

const TOWER_HEIGHT_RANGE_BONUS_FX = 6 * FX_ONE; // +6m range bonus from tower elevation
const TURRET_RELOAD_MIN_TICKS = 44;
const TURRET_RELOAD_MAX_TICKS = 58;
const OUT_OF_COMBAT_TICKS_REQUIRED = 60; // 3.0 seconds at 20 TPS
const INFIRMARY_REINFORCE_INTERVAL_TICKS = 70; // 3.5 seconds at 20 TPS (Phase 6.1 doubled interval)

const UNIT_SINGLE_HALF_COST_TABLE = Object.freeze({
  worker: { coins: 15, wood: 0, stone: 0, iron: 0 },
  swordsman: { coins: 4, wood: 0, stone: 0, iron: 1 },
  spearman: { coins: 4, wood: 0, stone: 0, iron: 1 },
  archer: { coins: 4, wood: 2, stone: 0, iron: 0 },
  cavalry: { coins: 10, wood: 0, stone: 0, iron: 3 },
  ballista: { coins: 46, wood: 23, stone: 0, iron: 20 }
});

export class BuildingCombatSystem {
  constructor(constructionSystem) {
    this.cs = constructionSystem;
  }

  setTowerManualTarget(buildingId, targetEntityId, team = 1) {
    const b = this.cs.buildings.get(buildingId | 0);
    if (!b || b.team !== (team | 0) || !b.hasWatchtower) return false;
    b.manualTargetEntityId = targetEntityId | 0;
    return true;
  }

  _resolveActiveManualSquadMembers(gameState, b, maxRangeFx) {
    if (!b.manualTargetEntityId || b.manualTargetEntityId <= 0) return null;

    const entitiesMap = gameState.entities;
    const manualCand = entitiesMap.get(b.manualTargetEntityId);
    const manAllied = manualCand ? (gameState.areTeamsAllied ? gameState.areTeamsAllied(manualCand.team, b.team) : manualCand.team === b.team) : true;
    if (!manualCand || manAllied) {
      b.manualTargetEntityId = -1;
      return null;
    }

    const targetSquadIdx = manualCand.squadIndex | 0;
    const company = gameState.companies?.get(targetSquadIdx);
    const livingInRange = [];

    if (company && Array.isArray(company.memberIds)) {
      for (let i = 0; i < company.memberIds.length; i++) {
        const ent = entitiesMap.get(company.memberIds[i]);
        if (!ent || ent.hp <= 0 || ent.isGarrisoned) continue;
        const entAllied = gameState.areTeamsAllied ? gameState.areTeamsAllied(ent.team, b.team) : ent.team === b.team;
        if (entAllied) continue;
        const d = fxHypot((ent.x - b.xFx) | 0, (ent.z - b.zFx) | 0);
        if (d <= maxRangeFx) {
          livingInRange.push(ent);
        }
      }
    } else if (manualCand.hp > 0 && !manualCand.isGarrisoned) {
      const d = fxHypot((manualCand.x - b.xFx) | 0, (manualCand.z - b.zFx) | 0);
      if (d <= maxRangeFx) {
        livingInRange.push(manualCand);
      }
    }

    if (livingInRange.length === 0) {
      b.manualTargetEntityId = -1;
      return null;
    }

    if (manualCand.hp <= 0 || manualCand.isGarrisoned) {
      b.manualTargetEntityId = livingInRange[0].id;
    }

    return livingInRange;
  }

  _findClosestEnemyForTurret(gameState, b, rangeFx, maxLockRangeFx) {
    const entitiesMap = gameState.entities;

    const manualSquadMembers = this._resolveActiveManualSquadMembers(
      gameState,
      b,
      maxLockRangeFx
    );
    if (manualSquadMembers && manualSquadMembers.length > 0) {
      const pickIdx = xorshift32(gameState) % manualSquadMembers.length;
      return manualSquadMembers[pickIdx];
    }

    const nearbyIds = gameState.spatialHash.queryRadiusIds(b.xFx, b.zFx, rangeFx, entitiesMap);
    let targetEnemy = null;
    let bestDist = 0x7fffffff;

    for (let n = 0; n < nearbyIds.length; n++) {
      const enemy = entitiesMap.get(nearbyIds[n]);
      if (enemy && enemy.hp > 0 && !enemy.isGarrisoned && (gameState.areTeamsEnemy ? gameState.areTeamsEnemy(enemy.team, b.team) : enemy.team !== b.team)) {
        const d = fxHypot((enemy.x - b.xFx) | 0, (enemy.z - b.zFx) | 0);
        if (d < bestDist) {
          bestDist = d;
          targetEnemy = enemy;
        }
      }
    }

    return targetEnemy;
  }

  _pickDistributedTargetForGarrisonUnit(gameState, b, archerEnt, unitEffectiveRangeFx) {
    const entitiesMap = gameState.entities;

    const manualSquadMembers = this._resolveActiveManualSquadMembers(
      gameState,
      b,
      unitEffectiveRangeFx
    );
    if (manualSquadMembers && manualSquadMembers.length > 0) {
      if (archerEnt.targetEntityId > 0) {
        const kept = manualSquadMembers.find((m) => m.id === archerEnt.targetEntityId);
        if (kept) return kept;
      }
      manualSquadMembers.sort((a, bEnt) => a.id - bEnt.id);
      const chosen = manualSquadMembers[xorshift32(gameState) % manualSquadMembers.length];
      archerEnt.targetEntityId = chosen.id;
      return chosen;
    }

    if (archerEnt.targetEntityId > 0) {
      const personalTarget = entitiesMap.get(archerEnt.targetEntityId);
      if (
        personalTarget &&
        personalTarget.hp > 0 &&
        (gameState.areTeamsEnemy ? gameState.areTeamsEnemy(personalTarget.team, b.team) : personalTarget.team !== b.team) &&
        !personalTarget.isGarrisoned
      ) {
        const dPersonal = fxHypot(
          (personalTarget.x - b.xFx) | 0,
          (personalTarget.z - b.zFx) | 0
        );
        if (dPersonal <= unitEffectiveRangeFx) {
          return personalTarget;
        }
      }
      archerEnt.targetEntityId = -1;
    }

    const nearbyIds = gameState.spatialHash.queryRadiusIds(
      b.xFx,
      b.zFx,
      unitEffectiveRangeFx,
      entitiesMap
    );
    if (nearbyIds.length === 0) return null;

    const squadsInRange = new Map();
    const closestDistBySquad = new Map();

    for (let i = 0; i < nearbyIds.length; i++) {
      const enemy = entitiesMap.get(nearbyIds[i]);
      if (!enemy || enemy.hp <= 0 || enemy.isGarrisoned) continue;
      if (gameState.areTeamsAllied ? gameState.areTeamsAllied(enemy.team, b.team) : enemy.team === b.team) continue;

      const d = fxHypot((enemy.x - b.xFx) | 0, (enemy.z - b.zFx) | 0);
      if (d > unitEffectiveRangeFx) continue;

      const sqIdx = enemy.squadIndex | 0;
      let list = squadsInRange.get(sqIdx);
      if (!list) {
        list = [];
        squadsInRange.set(sqIdx, list);
        closestDistBySquad.set(sqIdx, d);
      } else if (d < closestDistBySquad.get(sqIdx)) {
        closestDistBySquad.set(sqIdx, d);
      }
      list.push(enemy);
    }

    if (squadsInRange.size === 0) return null;

    let bestSqIdx = -1;
    let bestSquadDist = 0x7fffffff;
    for (const [sqIdx, distFx] of closestDistBySquad.entries()) {
      if (distFx < bestSquadDist || (distFx === bestSquadDist && sqIdx < bestSqIdx)) {
        bestSquadDist = distFx;
        bestSqIdx = sqIdx;
      }
    }

    const targetMembers = squadsInRange.get(bestSqIdx);
    if (!targetMembers || targetMembers.length === 0) return null;

    targetMembers.sort((a, bEnt) => a.id - bEnt.id);
    const chosen = targetMembers[xorshift32(gameState) % targetMembers.length];
    archerEnt.targetEntityId = chosen.id;
    return chosen;
  }

  _stepGarrisonedArchers(gameState, b, AnimState, UnitTypeIndex) {
    if (!Array.isArray(b.garrisonCompanyIds) || b.garrisonCompanyIds.length === 0) return;

    const entitiesMap = gameState.entities;
    const companiesMap = gameState.companies;

    for (let g = 0; g < b.garrisonCompanyIds.length; g++) {
      const gComp = companiesMap.get(b.garrisonCompanyIds[g]);
      if (!gComp || gComp.unitTypeIdx !== UnitTypeIndex.archer) continue;

      const prof = this.cs.movementSystem.getPhysicsProfile(gComp.unitTypeIdx);

      for (let m = 0; m < gComp.memberIds.length; m++) {
        const archerEnt = entitiesMap.get(gComp.memberIds[m]);
        if (!archerEnt || archerEnt.hp <= 0 || !archerEnt.isGarrisoned) continue;

        const baseUnitRangeFx = (archerEnt.attackRangeFx || prof.attackRangeFx || 18432) | 0;
        const effectiveRangeFx = (baseUnitRangeFx + TOWER_HEIGHT_RANGE_BONUS_FX) | 0;
        const baseUnitDamage = (archerEnt.damage || prof.damage || 5) | 0;
        const reloadMinTicks = (archerEnt.reloadMinTicks || prof.reloadMinTicks || 54) | 0;
        const reloadMaxTicks = (archerEnt.reloadMaxTicks || prof.reloadMaxTicks || 80) | 0;

        if (!archerEnt._garrisonTimerSynced) {
          archerEnt._garrisonTimerSynced = true;
          if ((archerEnt.actionCooldown | 0) <= 0) {
            archerEnt.actionCooldown = fxRandomRange(gameState, 12, reloadMaxTicks);
          }
        }

        if (archerEnt.actionCooldown > 0) {
          archerEnt.actionCooldown = (archerEnt.actionCooldown - 1) | 0;
          continue;
        }

        const targetEnemy = this._pickDistributedTargetForGarrisonUnit(
          gameState,
          b,
          archerEnt,
          effectiveRangeFx
        );
        if (!targetEnemy) {
          archerEnt.actionCooldown = fxRandomRange(gameState, 14, 34);
          continue;
        }

        const finalDamage = archerEnt.isBuffed
          ? ((baseUnitDamage * 120) / 100) | 0
          : baseUnitDamage;
        targetEnemy.hp = Math.max(0, (targetEnemy.hp - finalDamage) | 0);
        targetEnemy.ticksSinceLastHit = 0;
        if (targetEnemy.hp <= 0) {
          targetEnemy.animState = AnimState.DIE;
          archerEnt.targetEntityId = -1;
        }

        archerEnt.actionCooldown = fxRandomRange(gameState, reloadMinTicks, reloadMaxTicks);

        const offsetSlot = ((archerEnt.id % 5) - 2) * 320;
        const offsetDepth = (((archerEnt.id >> 2) % 3) - 1) * 280;

        gameState.pendingEvents.push({
          tick: gameState.tick,
          kind: 'TOWER_SHOT',
          fromXFx: (b.xFx + offsetSlot) | 0,
          fromYFx: (b.yFx + 7 * FX_ONE + 512) | 0,
          fromZFx: (b.zFx + offsetDepth) | 0,
          toXFx: targetEnemy.x,
          toYFx: (targetEnemy.y + FX_ONE) | 0,
          toZFx: targetEnemy.z,
          isBallista: false,
          isFireArrow: gComp.ammoType === 'FIRE_ARROW',
          extraArrows: 0
        });
      }
    }
  }

  _getSingleUnitReinforceCost(unitType) {
    return UNIT_SINGLE_HALF_COST_TABLE[unitType] || UNIT_SINGLE_HALF_COST_TABLE.swordsman;
  }

  _stepInfirmaryAuraAndReinforcement(gameState, b, def, AnimState, UnitTypeIndex) {
    const entitiesMap = gameState.entities;
    const companiesMap = gameState.companies;
    const healRadiusMeters = (def?.auraRadiusMeters | 0) || 22;
    const healRadiusFx = (healRadiusMeters * FX_ONE) | 0;
    const healStep = (def?.healPerTick | 0) || 3;
    const isHealPulseTick = gameState.tick % 10 === 0;

    const nearbyIds = gameState.spatialHash.queryRadiusIds(
      b.xFx,
      b.zFx,
      healRadiusFx,
      entitiesMap
    );

    const companiesInAura = new Set();

    for (let n = 0; n < nearbyIds.length; n++) {
      const ally = entitiesMap.get(nearbyIds[n]);
      if (!ally || ally.hp <= 0 || ally.team !== b.team || ally.isGarrisoned) continue;

      const comp = companiesMap?.get(ally.squadIndex);
      const isOutOfCombat =
        (ally.ticksSinceLastHit ?? 999) >= OUT_OF_COMBAT_TICKS_REQUIRED &&
        (!comp || (comp.ticksSinceLastCombat ?? 999) >= OUT_OF_COMBAT_TICKS_REQUIRED);

      if (!isOutOfCombat) continue;

      if (comp) {
        companiesInAura.add(comp.id);
      }

      if (ally.hp < ally.maxHp) {
        ally.isHealing = true;
        if (comp) comp.isHealing = true;
        if (isHealPulseTick) {
          ally.hp = Math.min(ally.maxHp, (ally.hp + healStep) | 0);
        }
      }
    }

    // Step B: Reinforce fallen soldiers at 50% single-unit cost once all living members are at 100% HP
    for (const cid of companiesInAura) {
      const comp = companiesMap.get(cid);
      if (
        !comp ||
        comp.unitType === 'worker' ||
        comp.isBroken ||
        comp.garrisonedBuildingId > 0
      ) {
        continue;
      }

      comp.syncCasualtiesAndPromoteRear(entitiesMap);
      const currentCount = comp.memberIds.length;
      const maxCount = comp.maxMemberCount | 0;
      if (currentCount <= 0 || currentCount >= maxCount) {
        comp.reinforceTickTimer = 0;
        continue;
      }

      let allLivingFullHp = true;
      for (let m = 0; m < comp.memberIds.length; m++) {
        const member = entitiesMap.get(comp.memberIds[m]);
        if (member && member.hp > 0 && member.hp < member.maxHp) {
          allLivingFullHp = false;
          break;
        }
      }

      if (!allLivingFullHp) {
        comp.reinforceTickTimer = 0;
        continue;
      }

      comp.isHealing = true;
      for (let m = 0; m < comp.memberIds.length; m++) {
        const member = entitiesMap.get(comp.memberIds[m]);
        if (member && member.hp > 0) {
          member.isHealing = true;
        }
      }

      comp.reinforceTickTimer = ((comp.reinforceTickTimer | 0) + 1) | 0;
      const reinfInterval = Math.max(10, (def?.reinforceIntervalTicks | 0) || INFIRMARY_REINFORCE_INTERVAL_TICKS);
      if (comp.reinforceTickTimer >= reinfInterval) {
        if (!this.cs.productionSystem.hasPopulationRoomFor(gameState, b.team, 1)) {
          comp.reinforceTickTimer = (INFIRMARY_REINFORCE_INTERVAL_TICKS - 1) | 0;
          continue;
        }
        comp.reinforceTickTimer = 0;
        const halfUnitCost = this._getSingleUnitReinforceCost(comp.unitType);
        const category = comp.unitType === 'archer' ? 'unit' : 'unit';
        if (
          this.cs.economySystem.spendResources(
            b.team,
            halfUnitCost,
            category,
            comp.unitType
          )
        ) {
          this.cs.productionSystem.spawnSingleReinforcedUnitFromBuilding(
            gameState,
            b,
            comp,
            UnitTypeIndex,
            AnimState
          );
        }
      }
    }
  }

  _stepBannerHouseAura(gameState, b, def) {
    const entitiesMap = gameState.entities;
    const companiesMap = gameState.companies;
    const buffRadiusMeters = (def?.auraRadiusMeters | 0) || 26;
    const buffRadiusFx = (buffRadiusMeters * FX_ONE) | 0;

    const nearbyIds = gameState.spatialHash.queryRadiusIds(
      b.xFx,
      b.zFx,
      buffRadiusFx,
      entitiesMap
    );
    for (let n = 0; n < nearbyIds.length; n++) {
      const ally = entitiesMap.get(nearbyIds[n]);
      if (ally && ally.hp > 0 && ally.team === b.team && !ally.isGarrisoned) {
        ally.isBuffed = true;
        const comp = companiesMap?.get(ally.squadIndex);
        if (comp) {
          comp.hasBannerBuff = true;
        }
      }
    }
  }

  _stepSupplyAmmoResupply(gameState, b) {
    const isAmmoSupplyBuilding =
      b.type === 'citadel' ||
      b.type === 'archery_range' ||
      b.type === 'watchtower' ||
      b.type === 'ballista_tower' ||
      Boolean(b.hasWatchtower);

    if (!isAmmoSupplyBuilding) {
      return;
    }
    if (gameState.tick % 20 !== 0) return;

    const entitiesMap = gameState.entities;
    const companiesMap = gameState.companies;

    // 1. Replenish ammo for archers garrisoned inside this watchtower/building
    if (Array.isArray(b.garrisonedCompanyIds) && companiesMap) {
      for (let g = 0; g < b.garrisonedCompanyIds.length; g++) {
        const comp = companiesMap.get(b.garrisonedCompanyIds[g]);
        if (!comp) continue;
        for (let m = 0; m < comp.memberIds.length; m++) {
          const ent = entitiesMap.get(comp.memberIds[m]);
          if (ent && ent.hp > 0 && (ent.maxAmmo | 0) > 0 && (ent.ammo | 0) < (ent.maxAmmo | 0)) {
            ent.ammo = Math.min(ent.maxAmmo | 0, ((ent.ammo | 0) + 3) | 0);
          }
        }
      }
    }

    // 2. Replenish ammo for friendly archers standing within 22m of Citadel, Archery Range, or Watchtower
    const resupplyRadiusFx = 22 * FX_ONE;
    const nearbyIds = gameState.spatialHash.queryRadiusIds(
      b.xFx,
      b.zFx,
      resupplyRadiusFx,
      entitiesMap
    );

    for (let n = 0; n < nearbyIds.length; n++) {
      const ally = entitiesMap.get(nearbyIds[n]);
      if (
        ally &&
        ally.hp > 0 &&
        ally.team === b.team &&
        (ally.maxAmmo | 0) > 0 &&
        (ally.ammo | 0) < (ally.maxAmmo | 0) &&
        (ally.ticksSinceLastHit ?? 999) >= 30
      ) {
        ally.ammo = Math.min(ally.maxAmmo | 0, ((ally.ammo | 0) + 2) | 0);
      }
    }
  }

  stepBuildingTurretAndAuras(gameState, b, AnimState, UnitTypeIndex = { archer: 3 }) {
    const def = this.cs.buildingDefs[b.type];
    const isSharedBuildingTurret = b.type !== "citadel" && b.type !== "watchtower" && b.type !== "ballista_tower";
    const sharedWt = buildingsData?.sharedBuildingWatchtower || {};
    const mountedBallistaStat =
      b.type === "ballista_tower" && def?.mountedBallistaUnitId
        ? unitStatsData?.units?.[def.mountedBallistaUnitId]
        : null;
    const baseRangeMeters = isSharedBuildingTurret
      ? (sharedWt.rangeMeters | 0) || 28
      : (def?.turretRangeMeters | 0) || (mountedBallistaStat?.attackRangeMeters | 0) || 28;
    const elevBonusFx = ((def?.garrisonElevationRangeBonusMeters ?? sharedWt.elevationRangeBonusMeters ?? 6) * FX_ONE) | 0;
    const maxLockRangeFx = (baseRangeMeters * FX_ONE + elevBonusFx) | 0;

    // 1. Base Tower / Citadel Stronghold / Shared Upgraded Building Turret Shot
    if (b.hasWatchtower) {
      if (b.turretCooldownTicks > 0) {
        b.turretCooldownTicks = (b.turretCooldownTicks - 1) | 0;
      } else {
        const baseDamage = isSharedBuildingTurret
          ? (sharedWt.damage | 0) || (6 + b.level * 2)
          : (def?.turretDamage | 0) || (mountedBallistaStat?.rangedDamage | 0) || (6 + b.level * 2);
        const reloadMin = isSharedBuildingTurret
          ? (sharedWt.reloadMinTicks | 0) || TURRET_RELOAD_MIN_TICKS
          : (def?.turretReloadMinTicks | 0) || (mountedBallistaStat?.reloadMinTicks | 0) || TURRET_RELOAD_MIN_TICKS;
        const reloadMax = isSharedBuildingTurret
          ? (sharedWt.reloadMaxTicks | 0) || TURRET_RELOAD_MAX_TICKS
          : (def?.turretReloadMaxTicks | 0) || (mountedBallistaStat?.reloadMaxTicks | 0) || TURRET_RELOAD_MAX_TICKS;
        const volleyCount = Math.max(
          1,
          isSharedBuildingTurret
            ? (sharedWt.volleyCount | 0) || 1
            : (def?.turretVolleyCount | 0) || 1
        );
        const rangeFx = (baseRangeMeters * FX_ONE) | 0;

        const targetEnemy = this._findClosestEnemyForTurret(
          gameState,
          b,
          rangeFx,
          maxLockRangeFx
        );

        if (targetEnemy) {
          const entitiesMap = gameState.entities;
          const targetComp = gameState.companies?.get(targetEnemy.squadIndex);

          // Apply volley shots across distinct members of the attacking squad (a single-unit Hero takes at most 1 hit per volley, reduced by Hero armor %)
          const maxHitsThisVolley =
            targetEnemy.isHero || targetEnemy.unitTypeIdx === 5 || (targetComp && targetComp.memberIds.length <= 1)
              ? 1
              : volleyCount;
          for (let v = 0; v < maxHitsThisVolley; v++) {
            let victim = targetEnemy;
            if (v > 0 && targetComp && targetComp.memberIds.length > 0) {
              const candId =
                targetComp.memberIds[(gameState.tick + v * 3) % targetComp.memberIds.length];
              const candEnt = entitiesMap.get(candId);
              if (candEnt && candEnt.hp > 0 && !candEnt.isGarrisoned) {
                const dCand = fxHypot((candEnt.x - b.xFx) | 0, (candEnt.z - b.zFx) | 0);
                if (dCand <= maxLockRangeFx) {
                  victim = candEnt;
                }
              }
            }

            if (victim && victim.hp > 0) {
              const isHeroVictim = Boolean(victim.isHero || victim.unitTypeIdx === 5);
              const armorPct = isHeroVictim ? Math.max(0, Math.min(80, (victim.armor ?? 15) | 0)) : 0;
              const resolvedTurretDmg = isHeroVictim
                ? Math.max(4, Math.round((baseDamage * 0.55 * (100 - armorPct)) / 100))
                : baseDamage;
              victim.hp = Math.max(0, (victim.hp - resolvedTurretDmg) | 0);
              victim.ticksSinceLastHit = 0;
              if (targetComp) {
                targetComp.ticksSinceLastCombat = 0;
              }
              if (victim.hp <= 0) {
                victim.animState = AnimState.DIE;
              }
            }
          }

          b.turretCooldownTicks = fxRandomRange(gameState, reloadMin, reloadMax);

          const tOff = Array.isArray(def?.turretOffset) ? def.turretOffset : [0, b.type === 'citadel' ? 11 : 8, 0];
          const offXFx = Math.round((Number(tOff[0]) || 0) * FX_ONE) | 0;
          const offYFx = Math.round((Number(tOff[1]) || (b.type === 'citadel' ? 11 : 8)) * FX_ONE) | 0;
          const offZFx = Math.round((Number(tOff[2]) || 0) * FX_ONE) | 0;
          gameState.pendingEvents.push({
            tick: gameState.tick,
            kind: 'TOWER_SHOT',
            fromXFx: (b.xFx + offXFx) | 0,
            fromYFx: (b.yFx + offYFx) | 0,
            fromZFx: (b.zFx + offZFx) | 0,
            toXFx: targetEnemy.x,
            toYFx: (targetEnemy.y + FX_ONE) | 0,
            toZFx: targetEnemy.z,
            isBallista: b.type === 'ballista_tower',
            extraArrows: Math.max(0, volleyCount - 1)
          });
        }
      }
    }

    // 2. Individual Garrisoned Archers
    this._stepGarrisonedArchers(gameState, b, AnimState, UnitTypeIndex);

    // 3. Infirmary Passive Healing & Squad Reinforcement
    if (b.type === 'infirmary') {
      this._stepInfirmaryAuraAndReinforcement(gameState, b, def, AnimState, UnitTypeIndex);
    }

    // 4. Banner House Passive AoE Damage/Defense/Morale Buff
    if (b.type === 'banner_house') {
      this._stepBannerHouseAura(gameState, b, def);
    }

    // 5. Ammo Resupply at Military/Supply Buildings
    this._stepSupplyAmmoResupply(gameState, b);
  }
}
