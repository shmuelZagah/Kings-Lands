/**
 * Kings Lands — Hero Spell Casting, Delayed Projectiles, Chain Lightning & Summon Reinforcements
 * (src/sim/systems/heroSpellCaster.js)
 */
import {
  FX_ONE,
  TICKS_PER_SEC,
  ANGLE_MASK,
  mulDiv,
  fxCos,
  fxSin,
  fxAtan2,
  fxHypot,
  fxClamp,
  toFx
} from '../../core/fx.js';
import { Company, CompanyOrderType, resolveDefaultFormation } from '../formations/company.js';
import { defaultHeroesData as defaultHeroesJson } from '../../data/defaults.js';
import { getSpellCastTimingProfile } from '../../render/heroSpellAnimations.js';
const LEGACY_SPELL_ID_ALIASES = Object.freeze({
  iron_skin: 'iron_blood',
  cleave_strike: 'shockwave_slam',
  berserk: 'wind_stride',
  arcane_shield: 'self_heal',
  revive_fallen: 'royal_sanctuary'
});

function normalizeSpellId(spellId) {
  if (!spellId) return null;
  return LEGACY_SPELL_ID_ALIASES[spellId] || spellId;
}

function safeFaceTarget(ent, targetXFx, targetZFx) {
  if (!ent) return;
  const dx = (targetXFx - ent.x) | 0;
  const dz = (targetZFx - ent.z) | 0;
  if (Math.abs(dx) + Math.abs(dz) > 64) {
    ent.dir = fxAtan2(dz, dx) & ANGLE_MASK;
  }
}

export const heroSpellCasterMethods = {
  /**
   * Launches an enemy entity backward away from `(centerXFx, centerZFx)` in a 3D parabolic airborne trajectory
   * if its weight is `<= maxWeight` (default `4.5`, covering infantry/archers/cavalry), landing on its back
   * (`knockdownTicks`) and standing back up / remounting before returning to combat!
   */
  _applyRadialKnockback(
    gameState,
    centerXFx,
    centerZFx,
    victim,
    knockbackMeters = 5.5,
    knockdownTicks = 36,
    maxWeight = 4.5
  ) {
    if (!victim || victim.hp <= 0 || victim.isGarrisoned) return;
    const victimComp = gameState.companies.get(victim.squadIndex);
    if (victimComp?.heroActiveBuffs?.immortalTicks > 0) return;

    const victimMass = victim.mass || (victim.unitTypeIdx === 4 ? 340 : victim.unitTypeIdx === 5 ? 240 : 120);
    const victimWeight = victimMass / 100;
    if (victimWeight > (maxWeight || 4.5)) {
      // Heavy colossus / siege units above maxWeight only flinch briefly without being thrown airborne
      victim.hurtVisualTicks = 10;
      return;
    }

    let dx = (victim.x - centerXFx) | 0;
    let dz = (victim.z - centerZFx) | 0;
    if (Math.abs(dx) + Math.abs(dz) < 64) {
      dx = FX_ONE;
      dz = 0;
    }
    const dist = Math.max(256, fxHypot(dx, dz));
    const weightScale = Math.max(0.55, Math.min(1.2, 1.32 - victimWeight * 0.18));
    const totalPushFx = Math.round((knockbackMeters || 5.2) * weightScale * FX_ONE);

    // Snappy 8-tick (0.40s) constant-horizontal-velocity ballistic flight so units never hang in mid-air!
    const slideTicks = 8;
    const stepSpeedFx = Math.max(180, Math.round(totalPushFx / slideTicks));
    victim.knockbackVxFx = mulDiv(dx, stepSpeedFx, dist);
    victim.knockbackVzFx = mulDiv(dz, stepSpeedFx, dist);
    victim.knockbackSlideTicks = slideTicks;
    victim.knockbackTotalSlideTicks = slideTicks;
    victim.knockbackPeakHeightFx = Math.round((victim.unitTypeIdx === 4 ? 0.82 : 1.05) * FX_ONE);
    victim.altitudeFx = Math.round(0.24 * FX_ONE);
    victim.knockdownTicks = Math.max(victim.knockdownTicks | 0, Math.max(26, knockdownTicks | 0));
    victim.windupTicks = 0;
    victim.shotWindupTicks = 0;
    victim.isMoving = false;
    victim.dir = fxAtan2(-dz, -dx) & ANGLE_MASK;
  },

  /**
   * Spawns a full friendly reinforcement company (`swordsman`, `spearman`, `archer`, or `cavalry`)
   * near the Hero (`summon_royal_guard`).
   */
  _spawnReinforcementCompany(gameState, heroComp, heroEnt, unitType = 'swordsman', angleRad = 0, distMeters = 4.5, centerXFx = null, centerZFx = null, durationTicks = 700, waveOriginXFx = null, waveOriginZFx = null, maxWaveRadMeters = 15.0) {
    const unitTypeIdxMap = { worker: 0, swordsman: 1, spearman: 2, archer: 3, cavalry: 4 };
    const unitTypeIdx = unitTypeIdxMap[unitType] ?? 1;
    const totalUnits = unitType === 'cavalry' ? 16 : 20;
    const speedFx = unitType === 'cavalry' ? 360 : 215;
    const maxHp = unitType === 'cavalry' ? 190 : unitType === 'archer' ? 95 : unitType === 'spearman' ? 145 : 135;
    const maxAmmo = unitType === 'archer' ? 48 : 0;

    const baseX = typeof centerXFx === "number" ? centerXFx : heroEnt.x;
    const baseZ = typeof centerZFx === "number" ? centerZFx : heroEnt.z;
    const rawXFx = (baseX + Math.round(Math.cos(angleRad) * distMeters * FX_ONE)) | 0;
    const rawZFx = (baseZ + Math.round(Math.sin(angleRad) * distMeters * FX_ONE)) | 0;
    const nav = gameState.navGrid;
    const walkable = nav.findNearestWalkableTile(
      nav.worldFxToTileX(rawXFx),
      nav.worldFxToTileZ(rawZFx),
      16
    );
    const anchorXFx = nav.tileToWorldCenterFxX(walkable.tx);
    const anchorZFx = nav.tileToWorldCenterFxZ(walkable.tz);

    const companyId = typeof gameState.allocateCompanyId === 'function' ? gameState.allocateCompanyId() : gameState.companies.size;

    const company = new Company({
      id: companyId,
      name: `ROYAL ${unitType.toUpperCase()} CO.`,
      team: heroComp.team,
      unitType,
      unitTypeIdx,
      spawnXFx: anchorXFx,
      spawnZFx: anchorZFx,
      facingDir: heroEnt.dir,
      speedFx,
      formation: resolveDefaultFormation(unitType),
      maxMemberCount: totalUnits
    });
    company.isCavalry = unitType === 'cavalry';
    company.isTemporarySummon = true;
    company.summonedByHeroCompanyId = heroComp.id;
    company.summonExpireTick = (gameState.tick | 0) + Math.max(200, durationTicks | 0);
    gameState.companies.set(companyId, company);

    const cols = unitType === 'cavalry' ? 4 : 5;
    const spacingFx = Math.round((unitType === 'cavalry' ? 2.65 : 1.85) * FX_ONE);

    for (let u = 0; u < totalUnits; u++) {
      const col = (u % cols) - (cols - 1) * 0.5;
      const row = Math.floor(u / cols);
      const ux = fxClamp((anchorXFx + Math.round(col * spacingFx)) | 0, 16 * FX_ONE, gameState.worldSizeFx - 16 * FX_ONE);
      const uz = fxClamp((anchorZFx - Math.round(row * spacingFx)) | 0, 16 * FX_ONE, gameState.worldSizeFx - 16 * FX_ONE);
      const uy = nav.sampleHeightAtWorldFx(ux, uz);
      const id = gameState.nextEntityId++;

      let summonHiddenTicks = 0;
      if (typeof waveOriginXFx === "number" && typeof waveOriginZFx === "number") {
        const distFromWaveM = fxHypot((ux - waveOriginXFx) | 0, (uz - waveOriginZFx) | 0) / FX_ONE;
        // 5 ticks for the center point charge + 1..15 ticks as the flying points travel across maxWaveRadMeters!
        summonHiddenTicks = 5 + Math.max(1, Math.min(15, Math.round((distFromWaveM / Math.max(6.0, maxWaveRadMeters)) * 15)));
      }
      const ent = {
        id,
        squadIndex: companyId,
        unitTypeIdx,
        team: heroComp.team,
        role: u === 0 ? 1 : 0, // Banner carrier on slot 0!
        carryType: 0,
        isGarrisoned: summonHiddenTicks > 0,
        summonHiddenTicks,
        isBuffed: true,
        isHealing: false,
        isRouting: false,
        isFlying: false,
        altitudeFx: 0,
        x: ux,
        y: uy,
        z: uz,
        targetX: ux,
        targetZ: uz,
        slotTargetXFx: ux,
        slotTargetZFx: uz,
        slotIndex: u,
        isFrontRow: row === 0,
        isMoving: false,
        flowFieldKey: null,
        pathWaypoints: null,
        pathIndex: 0,
        dir: heroEnt.dir,
        desiredFacingDir: heroEnt.dir,
        speedFx,
        hp: maxHp,
        maxHp,
        ammo: maxAmmo,
        maxAmmo,
        animState: 0,
        actionCooldown: 0,
        windupTicks: 0,
        shotWindupTicks: 0,
        nextShotTicks: 0,
        windupTargetId: -1,
        windupWillBeBlocked: false,
        blockVisualTicks: 0,
        knockdownTicks: 0,
        burningTicks: 0,
        reservedTargetId: -1,
        reservedSlotIdx: -1,
        inCombatStandby: false,
        ticksSinceLastHit: 999,
        waitTicks: 0,
        deadTicks: 0
      };
      gameState.entities.set(id, ent);
      company.memberIds.push(id);
      gameState.sortedEntityIds.push(id);
    }
    company.lastKnownAliveCount = totalUnits;
    company.updateSlotTargets(nav, gameState.entities);
    return company;
  },

  _resolveTargetUnitOrNearest(gameState, ent, comp, targetOpts, maxRangeMeters = 28) {
    const tId = targetOpts?.targetEntityId ?? -1;
    if (tId > 0) {
      const explicitEnt = gameState.entities.get(tId | 0);
      if (explicitEnt && explicitEnt.hp > 0 && explicitEnt.team !== comp.team && !explicitEnt.isGarrisoned) {
        return explicitEnt;
      }
    }
    if (typeof targetOpts?.targetXFx === 'number' && typeof targetOpts?.targetZFx === 'number') {
      const nearPt = gameState.movementSystem?.combatSystem?.findNearestEnemyEntity?.(
        targetOpts.targetXFx | 0,
        targetOpts.targetZFx | 0,
        Math.round(12 * FX_ONE),
        comp.team,
        gameState.entities
      );
      if (nearPt?.enemy && nearPt.enemy.team !== comp.team) return nearPt.enemy;
    }
    const nearest = gameState.movementSystem?.combatSystem?.findNearestEnemyEntity?.(
      ent.x,
      ent.z,
      Math.round((maxRangeMeters || 28) * FX_ONE),
      comp.team,
      gameState.entities
    );
    return nearest?.enemy && nearest.enemy.team !== comp.team ? nearest.enemy : null;
  },

  _resolveTargetBuilding(gameState, comp, targetOpts) {
    const bId = targetOpts?.targetBuildingId ?? -1;
    if (bId > 0) {
      const b = gameState.constructionSystem?.buildings?.get(bId | 0);
      if (b && !b.isDestroyed && b.hp > 0 && b.team !== comp.team && b.type !== 'citadel_slot') {
        return b;
      }
    }
    return null;
  },

  /**
   * Casts an Active Spell on the Hero (`slotIndex` 0..4 or `spellId`), supporting `targetOpts`:
   * `{ targetXFx, targetZFx, targetEntityId, targetBuildingId, _bypassRangeCheck }`.
   * If the target is beyond `spell.rangeMeters`, the Hero automatically walks into range first and then casts!
   */
  /**
   * Schedules a synchronized 2-stage spell delivery:
   * - Stage 1 (WAIT_RELEASE): Waits `releaseDelayTicks` while the Hero draws the bow / swings the sword / raises the staff.
   *   At release, emits `HERO_SPELL_CAST` from the Hero's weapon socket with exact `flightDurationSec`.
   * - Stage 2 (IN_FLIGHT): If `flightTicks > 0` (bow arrows/bolts, fireball, throwing knife, volley, meteors),
   *   waits `flightTicks` and executes `onImpact` on the exact frame the 3D projectile arrives!
   */
  _enqueueSynchronizedSpellDelivery({
    gameState,
    comp,
    ent,
    spell,
    spellId,
    targetXFx,
    targetZFx,
    targetEntityId = -1,
    targetBuildingId = -1,
    instantImpact = false,
    onImpact
  }) {
    const mode = comp.activeWeaponMode || 'melee';
    const initDistMeters = Math.max(0, fxHypot((targetXFx - ent.x) | 0, (targetZFx - ent.z) | 0) / FX_ONE);
    const timing = getSpellCastTimingProfile(spellId, mode, initDistMeters);
    const releaseTicks = instantImpact ? 0 : timing.releaseDelayTicks;

    const triggerRelease = (gs) => {
      let txFx = targetXFx | 0;
      let tzFx = targetZFx | 0;
      if ((targetEntityId | 0) > 0) {
        const tEnt = gs.entities.get(targetEntityId | 0);
        if (tEnt && tEnt.hp > 0 && !tEnt.isGarrisoned) {
          txFx = tEnt.x;
          tzFx = tEnt.z;
        }
      } else if ((targetBuildingId | 0) > 0) {
        const tBld = gs.constructionSystem?.buildings?.get(targetBuildingId | 0);
        if (tBld && !tBld.isDestroyed && tBld.hp > 0) {
          txFx = tBld.xFx;
          tzFx = tBld.zFx;
        }
      }

      if (ent && ent.hp > 0) {
        if (spell.targetMode !== 'self' && spell.targetMode !== 'self_aoe') {
          safeFaceTarget(ent, txFx, tzFx);
        }
      }

      const distMeters = ent
        ? Math.max(0, fxHypot((txFx - ent.x) | 0, (tzFx - ent.z) | 0) / FX_ONE)
        : initDistMeters;
      const liveTiming = getSpellCastTimingProfile(spellId, mode, distMeters);
      const flightTicks = instantImpact ? 0 : liveTiming.flightTicks;
      const flightDurationSec = liveTiming.flightDurationSec;

      const fwdFx = Math.round((liveTiming.spawnForwardMeters || 0) * FX_ONE);
      const hgtFx = Math.round((liveTiming.spawnHeightMeters || 1.25) * FX_ONE);
      const spawnXFx = ent ? (ent.x + mulDiv(fwdFx, fxCos(ent.dir), FX_ONE)) | 0 : txFx;
      const spawnZFx = ent ? (ent.z + mulDiv(fwdFx, fxSin(ent.dir), FX_ONE)) | 0 : tzFx;
      const spawnYFx = ent ? (ent.y + hgtFx) | 0 : (gs.navGrid.sampleHeightAtWorldFx(txFx, tzFx) + FX_ONE) | 0;
      const tyFx = gs.navGrid.sampleHeightAtWorldFx(txFx, tzFx);

      const st = spell.stats || {};
      gs.pendingEvents.push({
        tick: gs.tick,
        kind: 'HERO_SPELL_CAST',
        spellId,
        spellName: spell.name,
        vfxStyle: spell.vfxStyle || 'shockwave_ring',
        targetShape: spell.targetShape || 'circle',
        companyId: comp.id,
        heroEntityId: ent ? ent.id : -1,
        fromXFx: spawnXFx,
        fromYFx: spawnYFx,
        fromZFx: spawnZFx,
        xFx: txFx,
        yFx: (tyFx + FX_ONE) | 0,
        zFx: tzFx,
        radiusMeters: st.radiusMeters || spell.radiusMeters || 6,
        flightDurationSec,
        label: `${comp.name}: ${spell.nameEn || spell.name}!`
      });

      if (flightTicks <= 0) {
        onImpact?.(gs, txFx, tzFx);
      } else {
        this.activeSpellDeliveries.push({
          kind: 'PROJECTILE_CALLBACK',
          ticksRemaining: flightTicks,
          targetEntityId,
          targetXFx: txFx,
          targetZFx: tzFx,
          onImpact
        });
      }
    };

    if (releaseTicks <= 0) {
      triggerRelease(gameState);
    } else {
      this.activeSpellDeliveries.push({
        kind: 'WAIT_RELEASE',
        ticksRemaining: releaseTicks,
        onRelease: triggerRelease
      });
    }
  },

  castHeroSpell(gameState, companyId, spellIdOrSlot, team = 1, targetOpts = {}) {
    const comp = gameState.companies.get(companyId | 0);
    if (!comp || !comp.isHero || comp.team !== (team | 0)) return false;

    const ent = gameState.entities.get(comp.memberIds[0]);
    if (!ent || ent.hp <= 0) return false;

    const spell =
      typeof spellIdOrSlot === 'number'
        ? comp.heroSpells[spellIdOrSlot]
        : comp.heroSpells.find((s) => s.spellId === normalizeSpellId(spellIdOrSlot));

    if (
      !spell ||
      (spell.level | 0) <= 0 ||
      spell.type === 'passive' ||
      (spell.cooldownTicks | 0) > 0 ||
      spell.disabledByWeapon
    ) {
      return false;
    }

    const st = spell.stats || {};
    const spellId = normalizeSpellId(spell.spellId);
    const tMode = spell.targetMode || 'self';

    let fxTargetXFx = typeof targetOpts?.targetXFx === 'number' ? targetOpts.targetXFx | 0 : ent.x;
    let fxTargetZFx = typeof targetOpts?.targetZFx === 'number' ? targetOpts.targetZFx | 0 : ent.z;
    let explicitBuilding = this._resolveTargetBuilding(gameState, comp, targetOpts);
    let explicitVictim = null;

    if ((targetOpts?.targetEntityId | 0) > 0) {
      const cand = gameState.entities.get(targetOpts.targetEntityId | 0);
      if (cand && cand.hp > 0 && cand.team !== comp.team && !cand.isGarrisoned) {
        explicitVictim = cand;
        fxTargetXFx = cand.x;
        fxTargetZFx = cand.z;
      }
    } else if (explicitBuilding) {
      fxTargetXFx = explicitBuilding.xFx;
      fxTargetZFx = explicitBuilding.zFx;
    }

    // Casting any spell immediately cancels previous Move, Patrol, or Attack-Move orders!
    comp.clearPatrolIfActive();
    comp.commandQueue.length = 0;
    comp.patrolWaypoints.length = 0;
    comp.patrolWaypointIndex = 0;
    comp.targetEnemyCompanyId = -1;
    comp.targetEnemyBuildingId = -1;
    comp.engagedTargetEntityId = -1;
    comp.engagedTargetBuildingId = -1;
    comp._mountedPassState = null;
    comp._sisnatCyclePhase = null;

    // Walk-Into-Range Check for targeted ground / unit / building spells (unless global like Far Sight)
    const castRangeMeters =
      Number(st.rangeMeters || spell.rangeMeters) ||
      (tMode === 'ground' ? 28 : comp.activeWeaponMode === 'ranged' ? 28 : 2.8);

    if (
      !targetOpts?._bypassRangeCheck &&
      (tMode === 'ground' || tMode === 'unit' || tMode === 'unit_or_building') &&
      castRangeMeters > 0 &&
      castRangeMeters < 500
    ) {
      const footprintFx = explicitBuilding
        ? Math.round((explicitBuilding.footprintRadiusMeters || 4) * FX_ONE)
        : 0;
      const rawDistFx = fxHypot((fxTargetXFx - ent.x) | 0, (fxTargetZFx - ent.z) | 0);
      const effDistFx = Math.max(0, (rawDistFx - footprintFx) | 0);
      const maxCastDistFx = Math.round((castRangeMeters + 0.85) * FX_ONE);

      if (effDistFx > maxCastDistFx) {
        comp.pendingSpellCast = {
          spellId: spell.spellId,
          slotIndex: spell.slotIndex,
          targetXFx: fxTargetXFx,
          targetZFx: fxTargetZFx,
          targetEntityId: explicitVictim ? explicitVictim.id : (targetOpts?.targetEntityId ?? -1),
          targetBuildingId: explicitBuilding ? explicitBuilding.id : (targetOpts?.targetBuildingId ?? -1),
          maxCastDistFx
        };
        const dirToGoal = fxAtan2((fxTargetZFx - ent.z) | 0, (fxTargetXFx - ent.x) | 0);
        comp.enqueueOrSetOrder(
          {
            orderType: CompanyOrderType.MOVE,
            targetXFx: fxTargetXFx,
            targetZFx: fxTargetZFx,
            facingDir: dirToGoal,
            isRunning: Boolean(comp.wantsToRun)
          },
          false,
          gameState.astar,
          gameState.navGrid,
          gameState.entities
        );
        return true;
      }
    }

    comp.pendingSpellCast = null;

    const cdrPct = comp.heroPassiveBonuses?.cooldownReductionPct || 0;
    const rawCdTicks = spell.maxCooldownTicks || 200;
    spell.cooldownTicks = Math.max(
      20,
      Math.round((rawCdTicks * (100 - Math.min(60, cdrPct))) / 100)
    );

    const castSec =
      Number(spell.castTimeSec) ||
      (spellId === 'summon_royal_guard'
        ? 1.6
        : spellId === 'chameleon_roar'
          ? 1.35
          : spellId === 'chameleon_venom_bite'
            ? 1.15
            : spellId === 'summon_warhorse'
              ? 1.0
              : spellId === 'arrow_volley'
                ? 0.6
                : 0.85);
    if (spellId === 'unstoppable_charge') {
      // Keep activeSpellSlotIdx = 0 so the Chameleon's 4 legs continuously play sisnat_human_gallop without sliding!
      ent.activeSpellSlotIdx = 0;
      ent.activeSpellTimerTicks = 0;
    } else {
      ent.activeSpellSlotIdx = (spell.slotIndex + 1) & 0x07;
      ent.activeSpellTimerTicks = Math.max(11, Math.round(castSec * TICKS_PER_SEC));
      comp.stopInPlace(gameState.navGrid, gameState.entities);
      comp.anchorXFx = ent.x;
      comp.anchorZFx = ent.z;
      comp.targetXFx = ent.x;
      comp.targetZFx = ent.z;
      ent.slotTargetXFx = ent.x;
      ent.slotTargetZFx = ent.z;
      ent.isMoving = false;
      ent.targetX = ent.x;
      ent.targetZ = ent.z;
      ent.windupTicks = 0;
      ent.shotWindupTicks = 0;
      ent.actionCooldown = Math.max(ent.actionCooldown | 0, ent.activeSpellTimerTicks);
    }

    let fxTargetYFx = gameState.navGrid.sampleHeightAtWorldFx(fxTargetXFx, fxTargetZFx);
    const maxKbWeight = Number(spell.maxKnockbackWeight ?? 4.5);
    let suppressDefaultCastEvent = false;

    // ------------------------------------------------------------------------
    // TREE 1: SELF SUPPORT (self_heal, wind_stride, immortal_avatar)
    // ------------------------------------------------------------------------
    if (spellId === 'self_heal') {
      const heal = st.healAmount || 220;
      ent.hp = Math.min(ent.maxHp, (ent.hp + heal) | 0);
      ent.burningTicks = 0;
      ent.poisonTicks = 0;
      ent.isHealing = true;
      } else if (spellId === 'wind_stride') {
      comp.staminaPermille = 1000;
      comp.heroActiveBuffs.berserkTicks = ((st.durationSec || 9) * TICKS_PER_SEC) | 0;
      comp.heroActiveBuffs.berserkMoveSpdPct = st.moveSpeedPct || 35;
      comp.heroActiveBuffs.berserkAtkSpdPct = st.attackSpeedPct || 40;
      comp.heroActiveBuffs.berserkDmgPct = st.damageBonusPct || 15;
      this._recomputeHeroPassiveAndLevelStats(comp, ent, false);
      } else if (spellId === 'immortal_avatar') {
      const heal = st.healAmount || 260;
      ent.hp = Math.min(ent.maxHp, (ent.hp + heal) | 0);
      ent.knockdownTicks = 0;
      ent.burningTicks = 0;
      ent.poisonTicks = 0;
      ent.isHealing = true;
      const durTicks = ((st.durationSec || 10) * TICKS_PER_SEC) | 0;
      comp.heroActiveBuffs.immortalTicks = durTicks;
      comp.heroActiveBuffs.arcaneShieldTicks = durTicks;
      comp.heroActiveBuffs.arcaneShieldArmor = st.armorBonus || 35;
      comp.heroActiveBuffs.berserkTicks = durTicks;
      comp.heroActiveBuffs.berserkDmgPct = st.damageBonusPct || 45;
      comp.heroActiveBuffs.berserkAtkSpdPct = st.attackSpeedPct || 45;
      comp.heroActiveBuffs.berserkMoveSpdPct = 25;
      this._recomputeHeroPassiveAndLevelStats(comp, ent, false);
      } else if (spellId === 'summon_warhorse') {
      // Ravan Level 4: Permanent mount/dismount toggle via spell! 1s cooldown, 1s mount/dismount animation delay!
      spell.cooldownTicks = TICKS_PER_SEC; // 1.0 second cooldown
      const willMount = !comp.isWarhorseMounted;
      const delayTicks = Math.max(14, Math.round((Number(spell.castTimeSec) || 1.0) * TICKS_PER_SEC));
      ent.activeSpellTimerTicks = delayTicks;
      this.activeSpellDeliveries.push({
        kind: "WAIT_RELEASE",
        ticksRemaining: Math.max(8, Math.round(delayTicks * 0.65)),
        onRelease: (gs) => {
          if (!ent || ent.hp <= 0) return;
          comp.isWarhorseMounted = willMount;
          comp.isCavalry = willMount;
          comp.warhorseMoveSpdPct = st.moveSpeedPct || 45;
          comp.warhorseArmorBonus = st.armorBonus || 14;
          ent.isWarhorseMounted = willMount;
          ent.mass = willMount ? 380 : 250;
          if (willMount) {
            ent.hp = Math.min(ent.maxHp, (ent.hp + (st.healAmount || 140)) | 0);
            ent.isHealing = true;
          }
          comp.staminaPermille = 1000;
          this._recomputeHeroPassiveAndLevelStats(comp, ent, false);
          }
      });
    } else if (spellId === 'azure_blade_fury') {
      // Ravan Level 8: Enters Azure Blade Fury mode (glowing blue aura on body/sword + blue slash on every hit!)
      const durTicks = Math.round((st.durationSec || 11) * TICKS_PER_SEC);
      comp.heroActiveBuffs.azureFuryTicks = durTicks;
      comp.heroActiveBuffs.azureFuryDmgPct = st.damageBonusPct || 38;
      comp.heroActiveBuffs.azureFuryAtkSpdPct = st.attackSpeedPct || 45;
      comp.heroActiveBuffs.azureFuryMoveSpdPct = st.moveSpeedPct || 28;
      comp.staminaPermille = 1000;
      ent.heroBuffVisual = 2;
      this._recomputeHeroPassiveAndLevelStats(comp, ent, false);
      } else if (spellId === 'bloodlust_frenzy') {
      // Sisnat Level 6: Stacking kill frenzy (+dmg% and +atkSpd% per enemy killed) & glowing crimson body!
      const durTicks = Math.round((st.durationSec || 14) * TICKS_PER_SEC);
      comp.heroActiveBuffs.bloodlustTicks = durTicks;
      comp.heroActiveBuffs.bloodlustStacks = Math.max(1, comp.heroActiveBuffs.bloodlustStacks || 1);
      comp.heroActiveBuffs.bloodlustMaxStacks = st.maxStacks || 5;
      comp.heroActiveBuffs.bloodlustDmgPctPerKill = st.dmgPctPerKill || 14;
      comp.heroActiveBuffs.bloodlustAtkSpdPctPerKill = st.atkSpdPctPerKill || 12;
      ent.heroBuffVisual = 1;
      this._recomputeHeroPassiveAndLevelStats(comp, ent, false);
      }

    // ------------------------------------------------------------------------
    // TREE 2: OFFENSE (venom_strike, mighty_strike, throwing_knife, shockwave_slam, whirlwind_rampage)
    // ------------------------------------------------------------------------
    else if (spellId === 'venom_strike' || spellId === 'poison_arrow' || spellId === 'soul_burn') {
      const maxR = castRangeMeters || 28;
      const victim = explicitVictim || this._resolveTargetUnitOrNearest(gameState, ent, comp, targetOpts, maxR);
      const isMeleeStrike = comp.activeWeaponMode === 'melee' && spellId === 'venom_strike';

      if (victim && victim.team !== comp.team && victim.id !== ent.id) {
        fxTargetXFx = victim.x;
        fxTargetYFx = victim.y;
        fxTargetZFx = victim.z;
        safeFaceTarget(ent, victim.x, victim.z);

        const dmg = st.damage || 110;
        const pSec = st.poisonSec || 6;
        const pTotal = st.poisonDamage || 75;
        const pDps = Math.max(8, Math.round(pTotal / pSec));

        suppressDefaultCastEvent = true;
        this._enqueueSynchronizedSpellDelivery({
          gameState,
          comp,
          ent,
          spell,
          spellId,
          targetXFx: victim.x,
          targetZFx: victim.z,
          targetEntityId: victim.id,
          instantImpact: Boolean(targetOpts?._instantImpact),
          onImpact: (gs, impactXFx, impactZFx) => {
            const splashRadFx = isMeleeStrike ? Math.round(4.0 * FX_ONE) : Math.round(2.8 * FX_ONE);
            const hitIds = gs.spatialHash.queryRadiusIds(impactXFx, impactZFx, splashRadFx, gs.entities);
            for (let i = 0; i < hitIds.length; i++) {
              const v = gs.entities.get(hitIds[i]);
              if (!v || v.hp <= 0 || v.id === ent.id || v.team === comp.team || v.isGarrisoned) continue;
              const mult = v.id === victim.id ? 1.0 : 0.55;
              v.hp = Math.max(0, (v.hp - Math.round(dmg * mult)) | 0);
              v.poisonTicks = Math.max(v.poisonTicks | 0, pSec * TICKS_PER_SEC);
              v.poisonDmgPerSec = Math.max(v.poisonDmgPerSec | 0, pDps);
              v.slowTicks = Math.max(v.slowTicks | 0, pSec * TICKS_PER_SEC);
              v.ticksSinceLastHit = 0;
              }
          }
        });
      }
      } else if (
      spellId === 'mighty_strike' ||
      spellId === 'piercing_shot' ||
      spellId === 'arcane_bolt' ||
      spellId === 'repelling_shot'
    ) {
      const maxR = castRangeMeters || 28;
      const dmg = st.damage || 155;
      const kbMeters = st.knockbackMeters || 5.2;

      if (explicitBuilding) {
        fxTargetXFx = explicitBuilding.xFx;
        fxTargetYFx = explicitBuilding.yFx;
        fxTargetZFx = explicitBuilding.zFx;
        safeFaceTarget(ent, explicitBuilding.xFx, explicitBuilding.zFx);
        suppressDefaultCastEvent = true;
        this._enqueueSynchronizedSpellDelivery({
          gameState,
          comp,
          ent,
          spell,
          spellId,
          targetXFx: explicitBuilding.xFx,
          targetZFx: explicitBuilding.zFx,
          targetBuildingId: explicitBuilding.id,
          instantImpact: Boolean(targetOpts?._instantImpact),
          onImpact: (gs) => {
            if (explicitBuilding.isDestroyed || explicitBuilding.hp <= 0) return;
            explicitBuilding.hp = Math.max(0, (explicitBuilding.hp - dmg) | 0);
            if (explicitBuilding.hp <= 0) {
              gs.constructionSystem?.handleBuildingDestroyedInCombat?.(explicitBuilding, gs);
              }
          }
        });
      } else {
        const victim = explicitVictim || this._resolveTargetUnitOrNearest(gameState, ent, comp, targetOpts, maxR);
        if (victim && victim.team !== comp.team && victim.id !== ent.id) {
          fxTargetXFx = victim.x;
          fxTargetYFx = victim.y;
          fxTargetZFx = victim.z;
          safeFaceTarget(ent, victim.x, victim.z);

          suppressDefaultCastEvent = true;
          this._enqueueSynchronizedSpellDelivery({
            gameState,
            comp,
            ent,
            spell,
            spellId,
            targetXFx: victim.x,
            targetZFx: victim.z,
            targetEntityId: victim.id,
            instantImpact: Boolean(targetOpts?._instantImpact),
            onImpact: (gs, impactXFx, impactZFx) => {
              const splashRadFx = Math.round(3.8 * FX_ONE);
              const hitIds = gs.spatialHash.queryRadiusIds(impactXFx, impactZFx, splashRadFx, gs.entities);
              for (let i = 0; i < hitIds.length; i++) {
                const v = gs.entities.get(hitIds[i]);
                if (!v || v.hp <= 0 || v.id === ent.id || v.team === comp.team || v.isGarrisoned) continue;
                const mult = v.id === victim.id ? 1.0 : 0.6;
                v.hp = Math.max(0, (v.hp - Math.round(dmg * mult)) | 0);
                v.ticksSinceLastHit = 0;
                this._applyRadialKnockback(gs, ent.x, ent.z, v, kbMeters, 36, maxKbWeight);
                }
            }
          });
        }
      }
      } else if (spellId === 'throwing_knife') {
      const maxR = castRangeMeters || 20;
      const victim = explicitVictim || this._resolveTargetUnitOrNearest(gameState, ent, comp, targetOpts, maxR);
      if (victim && victim.team !== comp.team && victim.id !== ent.id) {
        fxTargetXFx = victim.x;
        fxTargetYFx = victim.y;
        fxTargetZFx = victim.z;
        safeFaceTarget(ent, victim.x, victim.z);
        const dmg = st.damage || 230;
        const splashMeters = Number(st.radiusMeters) || 0;
        suppressDefaultCastEvent = true;
        this._enqueueSynchronizedSpellDelivery({
          gameState,
          comp,
          ent,
          spell,
          spellId,
          targetXFx: victim.x,
          targetZFx: victim.z,
          targetEntityId: victim.id,
          instantImpact: Boolean(targetOpts?._instantImpact),
          onImpact: (gs, impactXFx, impactZFx) => {
            if (splashMeters <= 0.1) {
              if (victim.hp <= 0 || victim.isGarrisoned) return;
              victim.hp = Math.max(0, (victim.hp - dmg) | 0);
              victim.slowTicks = Math.max(victim.slowTicks | 0, 5 * TICKS_PER_SEC);
              victim.ticksSinceLastHit = 0;
              } else {
              // Rank 2+: Splashes across adjacent enemy units!
              const splashFx = Math.round(splashMeters * FX_ONE);
              const hitIds = gs.spatialHash.queryRadiusIds(impactXFx, impactZFx, splashFx, gs.entities);
              for (let i = 0; i < hitIds.length; i++) {
                const v = gs.entities.get(hitIds[i]);
                if (!v || v.hp <= 0 || v.id === ent.id || v.team === comp.team || v.isGarrisoned) continue;
                const mult = v.id === victim.id ? 1.0 : 0.72;
                v.hp = Math.max(0, (v.hp - Math.round(dmg * mult)) | 0);
                v.slowTicks = Math.max(v.slowTicks | 0, 5 * TICKS_PER_SEC);
                v.ticksSinceLastHit = 0;
                }
            }
          }
        });
      }
      } else if (spellId === 'unstoppable_charge') {
      // Sisnat Level 1/5/9: 2.0-second (40 ticks) relentless line charge anchored at Sisnat!
      // Both Sisnat and the Chameleon face the exact direction of the run and advance strictly along ent.dir!
      let dx = (fxTargetXFx - ent.x) | 0;
      let dz = (fxTargetZFx - ent.z) | 0;
      if (Math.abs(dx) + Math.abs(dz) < 128) {
        dx = fxCos(ent.dir);
        dz = fxSin(ent.dir);
      }
      const chargeDir = fxAtan2(dz, dx) & ANGLE_MASK;
      ent.dir = chargeDir;
      ent.desiredFacingDir = chargeDir;
      comp.facingDir = chargeDir;
      comp.desiredFacingDir = chargeDir;

      const totalChargeTicks = 40; // Exact 2.0 seconds at 20 TPS!
      const runLengthMeters = Number(st.rangeMeters || spell.rangeMeters) || 22;
      const totalDistFx = Math.round(runLengthMeters * FX_ONE);
      const stepSpeedFx = Math.round(totalDistFx / totalChargeTicks);
      const stepVxFx = mulDiv(stepSpeedFx, fxCos(chargeDir), FX_ONE);
      const stepVzFx = mulDiv(stepSpeedFx, fxSin(chargeDir), FX_ONE);

      fxTargetXFx = (ent.x + stepVxFx * totalChargeTicks) | 0;
      fxTargetZFx = (ent.z + stepVzFx * totalChargeTicks) | 0;
      fxTargetYFx = gameState.navGrid.sampleHeightAtWorldFx(fxTargetXFx, fxTargetZFx);

      const spellLvl = spell.level || 1;
      const calDamage = spellLvl >= 3 ? (st.damage || 145) : spellLvl === 2 ? Math.min(68, st.damage || 62) : Math.min(44, st.damage || 38);
      const calBurnTicks = spellLvl >= 3 ? (st.burnTicks || 160) : 0;

      comp.activeChargeRush = {
        ticksRemaining: totalChargeTicks,
        chargeDir,
        stepSpeedFx,
        stepVxFx,
        stepVzFx,
        damage: calDamage,
        knockbackMeters: st.knockbackMeters || 6.6,
        burnTicks: calBurnTicks,
        lineHalfWidthFx: Math.round(((Number(spell.lineWidthMeters) || 4.4) * 0.5 + 1.4) * FX_ONE),
        maxKnockbackWeight: Number(spell.maxKnockbackWeight ?? 5.8),
        hitEntityIds: new Set()
      };
      if (calBurnTicks > 0) {
        ent.burningWeaponTicks = totalChargeTicks + 20;
      }
      } else if (spellId === 'chameleon_venom_bite') {
      // Sisnat Level 10: Giant Chameleon bites an enemy for massive poison damage over time!
      const maxR = castRangeMeters || 4.0;
      const victim = explicitVictim || this._resolveTargetUnitOrNearest(gameState, ent, comp, targetOpts, maxR);
      if (victim && victim.team !== comp.team && victim.id !== ent.id) {
        fxTargetXFx = victim.x;
        fxTargetYFx = victim.y;
        fxTargetZFx = victim.z;
        safeFaceTarget(ent, victim.x, victim.z);
        const dmg = st.damage || 190;
        const pSec = st.poisonSec || 7;
        const pTotal = st.poisonDamage || 420;
        const pDps = Math.max(25, Math.round(pTotal / pSec));
        suppressDefaultCastEvent = true;
        this._enqueueSynchronizedSpellDelivery({
          gameState,
          comp,
          ent,
          spell,
          spellId,
          targetXFx: victim.x,
          targetZFx: victim.z,
          targetEntityId: victim.id,
          instantImpact: Boolean(targetOpts?._instantImpact),
          onImpact: (gs) => {
            if (victim.hp <= 0 || victim.isGarrisoned) return;
            victim.hp = Math.max(0, (victim.hp - dmg) | 0);
            victim.poisonTicks = Math.max(victim.poisonTicks | 0, pSec * TICKS_PER_SEC);
            victim.poisonDmgPerSec = Math.max(victim.poisonDmgPerSec | 0, pDps);
            victim.slowTicks = Math.max(victim.slowTicks | 0, pSec * TICKS_PER_SEC);
            victim.ticksSinceLastHit = 0;
            }
        });
      }
      } else if (spellId === 'shockwave_slam' || spellId === 'repulse_wave') {
      fxTargetXFx = ent.x;
      fxTargetYFx = ent.y;
      fxTargetZFx = ent.z;
      const radFx = Math.round((st.radiusMeters || spell.radiusMeters || 8.5) * FX_ONE);
      const dmg = st.damage || 115;
      const kbMeters = st.knockbackMeters || 6.5;
      suppressDefaultCastEvent = true;
      this._enqueueSynchronizedSpellDelivery({
        gameState,
        comp,
        ent,
        spell,
        spellId,
        targetXFx: ent.x,
        targetZFx: ent.z,
        instantImpact: Boolean(targetOpts?._instantImpact),
        onImpact: (gs) => {
          const nearby = gs.spatialHash.queryRadiusIds(ent.x, ent.z, radFx, gs.entities);
          for (let i = 0; i < nearby.length; i++) {
            const victim = gs.entities.get(nearby[i]);
            if (!victim || victim.hp <= 0 || victim.id === ent.id || victim.team === comp.team || victim.isGarrisoned) continue;
            victim.hp = Math.max(0, (victim.hp - dmg) | 0);
            victim.ticksSinceLastHit = 0;
            this._applyRadialKnockback(gs, ent.x, ent.z, victim, kbMeters, 38, maxKbWeight);
            }
        }
      });
      } else if (spellId === 'whirlwind_rampage' || spellId === 'arrow_volley' || spellId === 'arcane_nova') {
      const isRangedVolley = tMode === 'ground' || comp.activeWeaponMode === 'ranged' || spellId === 'arcane_nova';
      if (!isRangedVolley) {
        fxTargetXFx = ent.x;
        fxTargetYFx = ent.y;
        fxTargetZFx = ent.z;
      } else {
        safeFaceTarget(ent, fxTargetXFx, fxTargetZFx);
      }
      const radFx = Math.round((st.radiusMeters || spell.radiusMeters || 9.5) * FX_ONE);
      const dmg = st.damage || 185;
      const kbMeters = st.knockbackMeters || 6.5;
      suppressDefaultCastEvent = true;
      this._enqueueSynchronizedSpellDelivery({
        gameState,
        comp,
        ent,
        spell,
        spellId,
        targetXFx: fxTargetXFx,
        targetZFx: fxTargetZFx,
        instantImpact: Boolean(targetOpts?._instantImpact),
        onImpact: (gs, impactXFx, impactZFx) => {
          const centerX = isRangedVolley ? impactXFx : ent.x;
          const centerZ = isRangedVolley ? impactZFx : ent.z;
          const hitIds = gs.spatialHash.queryRadiusIds(centerX, centerZ, radFx, gs.entities);
          for (let i = 0; i < hitIds.length; i++) {
            const victim = gs.entities.get(hitIds[i]);
            if (!victim || victim.hp <= 0 || victim.id === ent.id || victim.team === comp.team || victim.isGarrisoned) continue;
            victim.hp = Math.max(0, (victim.hp - dmg) | 0);
            victim.ticksSinceLastHit = 0;
            if (isRangedVolley && spellId !== 'arcane_nova') {
              victim.slowTicks = Math.max(victim.slowTicks | 0, 5 * TICKS_PER_SEC);
              this._applyRadialKnockback(gs, centerX, centerZ, victim, 3.6, 28, maxKbWeight);
            } else {
              this._applyRadialKnockback(gs, centerX, centerZ, victim, kbMeters, 38, maxKbWeight);
            }
            }
        }
      });
      }

    // ------------------------------------------------------------------------
    // TREE 3: AREA SUPPORT (war_cry, heal, aegis_banner, royal_sanctuary)
    // ------------------------------------------------------------------------
    else if (spellId === 'war_cry') {
      fxTargetXFx = ent.x;
      fxTargetYFx = ent.y;
      fxTargetZFx = ent.z;
      comp.heroActiveBuffs.warCryTicks = ((st.durationSec || 9) * TICKS_PER_SEC) | 0;
      comp.heroActiveBuffs.warCryDmgPct = st.damageBonusPct || 25;
      this._recomputeHeroPassiveAndLevelStats(comp, ent, false);

      const radFx = Math.round((st.radiusMeters || spell.radiusMeters || 20) * FX_ONE);
      for (const allyComp of gameState.companies.values()) {
        if (!allyComp || allyComp.team !== comp.team) continue;
        const d = fxHypot((allyComp.anchorXFx - ent.x) | 0, (allyComp.anchorZFx - ent.z) | 0);
        if (d <= radFx) {
          allyComp.isBroken = false;
          allyComp.moralePermille = Math.min(1000, (allyComp.moralePermille || 800) + (st.moraleHeal || 300));
          allyComp.hasBannerBuff = true;
          for (let m = 0; m < allyComp.memberIds.length; m++) {
            const mEnt = gameState.entities.get(allyComp.memberIds[m]);
            if (mEnt && mEnt.hp > 0) {
              mEnt.isRouting = false;
              mEnt.isBuffed = true;
            }
          }
        }
      }
      } else if (spellId === 'heal') {
      fxTargetXFx = ent.x;
      fxTargetYFx = ent.y;
      fxTargetZFx = ent.z;
      const heroHeal = st.heroHealAmount || 180;
      const allyHeal = st.healAmount || 95;
      const radFx = Math.round((st.radiusMeters || spell.radiusMeters || 18) * FX_ONE);
      ent.hp = Math.min(ent.maxHp, (ent.hp + heroHeal) | 0);
      ent.isHealing = true;

      const nearby = gameState.spatialHash.queryRadiusIds(ent.x, ent.z, radFx, gameState.entities);
      for (let i = 0; i < nearby.length; i++) {
        const ally = gameState.entities.get(nearby[i]);
        if (!ally || ally.hp <= 0 || ally.team !== comp.team) continue;
        ally.hp = Math.min(ally.maxHp, (ally.hp + allyHeal) | 0);
        ally.isHealing = true;
      }
      } else if (spellId === 'summon_royal_guard') {
      // Ravan Level 2 / 7 / 10:
      // 1. First, Ravan performs a short cast animation (0.50s = 10 ticks) with nothing on the ground yet.
      // 2. Then the center point appears at (summonCenterXFx, summonCenterZFx) and bursts outward in all directions.
      // 3. As the flying points pass over each soldier's coordinates, that soldier materializes into view!
      safeFaceTarget(ent, fxTargetXFx, fxTargetZFx);
      suppressDefaultCastEvent = true;
      ent.activeSpellTimerTicks = 12;
      const summonCenterXFx = fxTargetXFx;
      const summonCenterZFx = fxTargetZFx;
      const summonCenterYFx = fxTargetYFx;
      const effRadMeters = Number(st.radiusMeters || spell.radiusMeters) || 14.0;

      this.activeSpellDeliveries.push({
        kind: "WAIT_RELEASE",
        ticksRemaining: 10, // 0.50s Hero cast animation finishes first!
        onRelease: (gs) => {
          // Now spawn the center point + outward-flying points VFX at the target zone!
          gs.pendingEvents.push({
            tick: gs.tick,
            kind: "HERO_SPELL_CAST",
            spellId,
            spellName: spell.name,
            vfxStyle: "summon_portal_ring",
            targetShape: "circle",
            companyId: comp.id,
            heroEntityId: ent.id,
            fromXFx: ent.x,
            fromYFx: (ent.y + FX_ONE) | 0,
            fromZFx: ent.z,
            xFx: summonCenterXFx,
            yFx: (summonCenterYFx + FX_ONE) | 0,
            zFx: summonCenterZFx,
            radiusMeters: effRadMeters,
            label: `${comp.name}: ${spell.nameEn || spell.name}!`
          });

          if (Array.isArray(comp.summonedCompanyIds) && comp.summonedCompanyIds.length > 0) {
            for (const oldCid of comp.summonedCompanyIds) {
              this._despawnTemporaryCompany(gs, oldCid);
            }
          }
          comp.summonedCompanyIds = [];
          const toSpawn = [];
          for (let k = 0; k < (st.swordsmanSquads || 0); k++) toSpawn.push("swordsman");
          for (let k = 0; k < (st.spearmanSquads || 0); k++) toSpawn.push("spearman");
          for (let k = 0; k < (st.archerSquads || 0); k++) toSpawn.push("archer");
          for (let k = 0; k < (st.cavalrySquads || 0); k++) toSpawn.push("cavalry");
          if (toSpawn.length === 0) {
            toSpawn.push("swordsman", "swordsman");
          }
          const durTicks = Math.round((st.durationSec || 40) * TICKS_PER_SEC);
          const fwdCos = fxCos(ent.dir);
          const fwdSin = fxSin(ent.dir);
          const rightX = fwdSin;
          const rightZ = -fwdCos;
          const maxCols = Math.min(3, toSpawn.length);
          const colSpacingMeters = 13.5;
          const rowSpacingMeters = 11.5;
          const numRows = Math.ceil(toSpawn.length / maxCols);
          const maxWaveRadM = Math.max(9.5, effRadMeters * 1.15);

          for (let i = 0; i < toSpawn.length; i++) {
            const colIdx = i % maxCols;
            const rowIdx = Math.floor(i / maxCols);
            const colsInThisRow = Math.min(maxCols, toSpawn.length - rowIdx * maxCols);
            const lateralOffsetM = (colIdx - (colsInThisRow - 1) * 0.5) * colSpacingMeters;
            const depthOffsetM = ((numRows - 1) * 0.5 - rowIdx) * rowSpacingMeters;
            const sqXFx = (summonCenterXFx + mulDiv(Math.round(lateralOffsetM * FX_ONE), rightX, FX_ONE) + mulDiv(Math.round(depthOffsetM * FX_ONE), fwdCos, FX_ONE)) | 0;
            const sqZFx = (summonCenterZFx + mulDiv(Math.round(lateralOffsetM * FX_ONE), rightZ, FX_ONE) + mulDiv(Math.round(depthOffsetM * FX_ONE), fwdSin, FX_ONE)) | 0;
            const spawnedComp = this._spawnReinforcementCompany(
              gs,
              comp,
              ent,
              toSpawn[i],
              0,
              0,
              sqXFx,
              sqZFx,
              durTicks,
              summonCenterXFx,
              summonCenterZFx,
              maxWaveRadM
            );
            if (spawnedComp) {
              comp.summonedCompanyIds.push(spawnedComp.id);
            }
          }
        }
      });
    } else if (spellId === 'aegis_banner') {
      // The King Level 2 / 4 / 9: Plants a 3D Royal War Banner at (fxTargetXFx, fxTargetZFx) without spawning a worker entity!
      safeFaceTarget(ent, fxTargetXFx, fxTargetZFx);
      const durSec = st.durationSec || 20;
      const durTicks = Math.round(durSec * TICKS_PER_SEC);
      const radMeters = Math.max(22, Number(st.radiusMeters || spell.radiusMeters) || 22);
      const radFx = Math.round(radMeters * FX_ONE);
      const bannerHp = st.bannerHp || 320;

      this.placedBanners.push({
        team: comp.team,
        xFx: fxTargetXFx,
        yFx: fxTargetYFx,
        zFx: fxTargetZFx,
        hp: bannerHp,
        maxHp: bannerHp,
        radiusFx: radFx,
        radiusMeters: radMeters,
        damageBonusPct: st.damageBonusPct || 24,
        armorBonus: st.armorBonus || 12,
        moraleHeal: st.moraleHeal || 350,
        expireTick: gameState.tick + durTicks
      });

      } else if (spellId === 'kings_decree' || spellId === 'royal_sanctuary') {
      // The King Level 10: Huge 38m-48m radius! Wind gust sweeps from center to edge, then heals all allies to 100% HP + buffs them!
      safeFaceTarget(ent, fxTargetXFx, fxTargetZFx);
      const radMeters = spellId === 'kings_decree' ? Math.max(38, Number(st.radiusMeters || spell.radiusMeters) || 38) : (Number(st.radiusMeters || spell.radiusMeters) || 14);
      const radFx = Math.round(radMeters * FX_ONE);
      const durTicks = Math.round((st.durationSec || 14) * TICKS_PER_SEC);
      const decreeCenterXFx = fxTargetXFx;
      const decreeCenterZFx = fxTargetZFx;
      this.activeSpellDeliveries.push({
        kind: "WAIT_RELEASE",
        ticksRemaining: spellId === 'kings_decree' ? 11 : 6,
        onRelease: (gs) => {
          const nearby = gs.spatialHash.queryRadiusIds(decreeCenterXFx, decreeCenterZFx, radFx, gs.entities);
          for (let i = 0; i < nearby.length; i++) {
            const ally = gs.entities.get(nearby[i]);
            if (!ally || ally.hp <= 0 || ally.team !== comp.team) continue;
            ally.hp = ally.maxHp; // Heal 100% full HP!
            ally.burningTicks = 0;
            ally.poisonTicks = 0;
            ally.frozenTicks = 0;
            ally.isHealing = true;
            ally.isBuffed = true;
            ally.isRouting = false;
            ally.kingsDecreeTicks = durTicks;
            if (!ally._baseDamageBeforeDecree) ally._baseDamageBeforeDecree = ally.damage || 8;
            if (!ally._baseSpeedBeforeDecree) ally._baseSpeedBeforeDecree = ally.speedFx || 215;
            ally.damage = Math.round(ally._baseDamageBeforeDecree * (1 + (st.damageBonusPct || 40) / 100));
            ally.meleeDamage = ally.damage;
            ally.speedFx = Math.round(ally._baseSpeedBeforeDecree * (1 + (st.moveSpeedPct || 35) / 100));
          }
          for (const allyComp of gs.companies.values()) {
            if (!allyComp || allyComp.team !== comp.team) continue;
            const d = fxHypot((allyComp.anchorXFx - decreeCenterXFx) | 0, (allyComp.anchorZFx - decreeCenterZFx) | 0);
            if (d <= radFx + 6 * FX_ONE) {
              allyComp.isBroken = false;
              allyComp.moralePermille = 1000;
              allyComp.staminaPermille = 1000;
              allyComp.hasBannerBuff = true;
            }
          }
        }
      });
      if (false) {
      const nearby = [];
      for (let i = 0; i < nearby.length; i++) {
        const ally = gameState.entities.get(nearby[i]);
        if (!ally || ally.hp <= 0 || ally.team !== comp.team) continue;
        ally.hp = ally.maxHp; // Heal 100% full HP!
        ally.burningTicks = 0;
        ally.poisonTicks = 0;
        ally.frozenTicks = 0;
        ally.isHealing = true;
        ally.isBuffed = true;
        ally.isRouting = false;
        ally.kingsDecreeTicks = durTicks;
        if (!ally._baseDamageBeforeDecree) ally._baseDamageBeforeDecree = ally.damage || 8;
        if (!ally._baseSpeedBeforeDecree) ally._baseSpeedBeforeDecree = ally.speedFx || 215;
        ally.damage = Math.round(ally._baseDamageBeforeDecree * (1 + (st.damageBonusPct || 40) / 100));
        ally.meleeDamage = ally.damage;
        ally.speedFx = Math.round(ally._baseSpeedBeforeDecree * (1 + (st.moveSpeedPct || 35) / 100));
      }
      for (const allyComp of gameState.companies.values()) {
        if (!allyComp || allyComp.team !== comp.team) continue;
        const d = fxHypot((allyComp.anchorXFx - fxTargetXFx) | 0, (allyComp.anchorZFx - fxTargetZFx) | 0);
        if (d <= radFx + 6 * FX_ONE) {
          allyComp.isBroken = false;
          allyComp.moralePermille = 1000;
          allyComp.staminaPermille = 1000;
          allyComp.hasBannerBuff = true;
        }
      }
      }
      } else if (spellId === 'chameleon_roar') {
      // Sisnat Level 3 / 8: Giant Chameleon roars, freezing all non-immune enemies in radius for 5.0s / 7.5s with ZERO damage!
      fxTargetXFx = ent.x;
      fxTargetYFx = ent.y;
      fxTargetZFx = ent.z;
      const radFx = Math.round((st.radiusMeters || spell.radiusMeters || 13) * FX_ONE);
      const freezeTicks = Math.round((st.freezeSec || 5.0) * TICKS_PER_SEC);
      const hitIds = gameState.spatialHash.queryRadiusIds(ent.x, ent.z, radFx, gameState.entities);
      for (let i = 0; i < hitIds.length; i++) {
        const victim = gameState.entities.get(hitIds[i]);
        if (!victim || victim.hp <= 0 || victim.id === ent.id || victim.team === comp.team || victim.isGarrisoned) continue;
        const vComp = gameState.companies.get(victim.squadIndex);
        if (vComp?.heroActiveBuffs?.immortalTicks > 0) continue; // Immune!
        victim.frozenTicks = Math.max(victim.frozenTicks | 0, freezeTicks);
        victim.windupTicks = 0;
        victim.shotWindupTicks = 0;
        victim.isMoving = false;
      }
      }

    // ------------------------------------------------------------------------
    // TREE 4: TACTICAL MAGIC (far_sight, fireball, chain_lightning, meteor_storm)
    // ------------------------------------------------------------------------
    else if (spellId === 'far_sight') {
      const radMeters = st.radiusMeters || spell.radiusMeters || 30;
      const durTicks = Math.round((st.durationSec || 14) * TICKS_PER_SEC);
      // Start the reveal immediately at tick 0 so the circle of light grows outward from the center in 1:1 sync with the wind animation!
      if (gameState.visionSystem) {
        gameState.visionSystem.addTemporaryReveal(
          fxTargetXFx,
          fxTargetZFx,
          radMeters,
          durTicks,
          gameState.tick
        );
        gameState.visionSystem.update(gameState, true);
      }
    } else if (spellId === 'fireball') {
      if (typeof targetOpts?.targetXFx !== 'number') {
        const nearest = this._resolveTargetUnitOrNearest(gameState, ent, comp, targetOpts, 30);
        if (nearest) {
          fxTargetXFx = nearest.x;
          fxTargetZFx = nearest.z;
          fxTargetYFx = nearest.y;
        }
      }
      safeFaceTarget(ent, fxTargetXFx, fxTargetZFx);

      const blastRadMeters = st.radiusMeters || spell.radiusMeters || 7.5;
      const blastRadFx = Math.round(blastRadMeters * FX_ONE);
      const dmg = st.damage || 120;
      const burnTicks = st.burnTicks || 90;
      const kbMeters = st.knockbackMeters || 5.8;

      suppressDefaultCastEvent = true;
      this._enqueueSynchronizedSpellDelivery({
        gameState,
        comp,
        ent,
        spell,
        spellId,
        targetXFx: fxTargetXFx,
        targetZFx: fxTargetZFx,
        instantImpact: Boolean(targetOpts?._instantImpact),
        onImpact: (gs, impactXFx, impactZFx) => {
          const hitIds = gs.spatialHash.queryRadiusIds(impactXFx, impactZFx, blastRadFx, gs.entities);
          for (let i = 0; i < hitIds.length; i++) {
            const victim = gs.entities.get(hitIds[i]);
            if (!victim || victim.hp <= 0 || victim.id === ent.id || victim.team === comp.team || victim.isGarrisoned) continue;
            victim.hp = Math.max(0, (victim.hp - dmg) | 0);
            victim.burningTicks = Math.max(victim.burningTicks | 0, burnTicks);
            victim.ticksSinceLastHit = 0;
            this._applyRadialKnockback(gs, impactXFx, impactZFx, victim, kbMeters, 38, maxKbWeight);
            }
        }
      });
      } else if (spellId === 'chain_lightning') {
      const primary = explicitVictim || this._resolveTargetUnitOrNearest(gameState, ent, comp, targetOpts, 30);
      if (primary) {
        fxTargetXFx = primary.x;
        fxTargetYFx = primary.y;
        fxTargetZFx = primary.z;
        safeFaceTarget(ent, primary.x, primary.z);
      } else {
        safeFaceTarget(ent, fxTargetXFx, fxTargetZFx);
      }

      const maxTargets = st.maxTargets || 6;
      const dmg = st.damage || 140;
      const timing = getSpellCastTimingProfile('chain_lightning', comp.activeWeaponMode, 0);

      const staffTipXFx = (ent.x + mulDiv(Math.round(timing.spawnForwardMeters * FX_ONE), fxCos(ent.dir), FX_ONE)) | 0;
      const staffTipZFx = (ent.z + mulDiv(Math.round(timing.spawnForwardMeters * FX_ONE), fxSin(ent.dir), FX_ONE)) | 0;
      const staffTipYFx = (ent.y + Math.round(timing.spawnHeightMeters * FX_ONE)) | 0;

      suppressDefaultCastEvent = true;
      gameState.pendingEvents.push({
        tick: gameState.tick,
        kind: 'HERO_SPELL_CAST',
        spellId: 'chain_lightning',
        spellName: spell.name,
        vfxStyle: 'lightning_staff_charge',
        companyId: comp.id,
        heroEntityId: ent.id,
        fromXFx: staffTipXFx,
        fromYFx: staffTipYFx,
        fromZFx: staffTipZFx,
        xFx: staffTipXFx,
        yFx: staffTipYFx,
        zFx: staffTipZFx,
        radiusMeters: 3.5,
        label: `${comp.name}: ${spell.nameEn || spell.name}!`
      });

      this.activeSpellDeliveries.push({
        kind: 'CHAIN_LIGHTNING',
        ticksRemaining: targetOpts?._instantImpact ? 1 : timing.releaseDelayTicks,
        hopIntervalTicks: timing.hopIntervalTicks || 7,
        companyId: comp.id,
        heroEntityId: ent.id,
        team: comp.team,
        damage: dmg,
        maxTargets,
        struckCount: 0,
        struckIds: new Set(),
        lastSourceXFx: staffTipXFx,
        lastSourceYFx: staffTipYFx,
        lastSourceZFx: staffTipZFx,
        nextTargetEntityId: primary ? primary.id : -1,
        searchOriginXFx: primary ? primary.x : fxTargetXFx,
        searchOriginZFx: primary ? primary.z : fxTargetZFx
      });

      } else if (spellId === 'meteor_storm') {
      safeFaceTarget(ent, fxTargetXFx, fxTargetZFx);
      const blastRadFx = Math.round((st.radiusMeters || spell.radiusMeters || 11.0) * FX_ONE);
      const dmg = st.damage || 220;
      const burnTicks = st.burnTicks || 140;
      const kbMeters = st.knockbackMeters || 6.5;

      suppressDefaultCastEvent = true;
      this._enqueueSynchronizedSpellDelivery({
        gameState,
        comp,
        ent,
        spell,
        spellId,
        targetXFx: fxTargetXFx,
        targetZFx: fxTargetZFx,
        instantImpact: Boolean(targetOpts?._instantImpact),
        onImpact: (gs, impactXFx, impactZFx) => {
          const hitIds = gs.spatialHash.queryRadiusIds(impactXFx, impactZFx, blastRadFx, gs.entities);
          for (let i = 0; i < hitIds.length; i++) {
            const victim = gs.entities.get(hitIds[i]);
            if (!victim || victim.hp <= 0 || victim.id === ent.id || victim.team === comp.team || victim.isGarrisoned) continue;
            victim.hp = Math.max(0, (victim.hp - dmg) | 0);
            victim.burningTicks = Math.max(victim.burningTicks | 0, burnTicks);
            victim.ticksSinceLastHit = 0;
            this._applyRadialKnockback(gs, impactXFx, impactZFx, victim, kbMeters, 40, maxKbWeight);
            }

          const blds = gs.constructionSystem?.buildings;
          if (blds) {
            for (const b of blds.values()) {
              if (!b || b.team === comp.team || b.isDestroyed || b.hp <= 0 || b.type === 'citadel_slot') continue;
              const d = fxHypot((b.xFx - impactXFx) | 0, (b.zFx - impactZFx) | 0);
              if (d <= blastRadFx + Math.round((b.footprintRadiusMeters || 4) * FX_ONE)) {
                b.hp = Math.max(0, (b.hp - Math.round(dmg * 1.4)) | 0);
                if (b.hp <= 0) {
                  gs.constructionSystem?.handleBuildingDestroyedInCombat?.(b, gs);
                }
              }
            }
          }
        }
      });
      }

    // ------------------------------------------------------------------------
    // CROSS-TREE HYBRID SPELLS (vampiric_cleave, inspiring_onslaught, explosive_mark)
    // ------------------------------------------------------------------------
    else if (spellId === 'vampiric_cleave') {
      const maxR = castRangeMeters || 26;
      const victim = explicitVictim || this._resolveTargetUnitOrNearest(gameState, ent, comp, targetOpts, maxR);
      if (victim && victim.team !== comp.team && victim.id !== ent.id) {
        fxTargetXFx = victim.x;
        fxTargetYFx = victim.y;
        fxTargetZFx = victim.z;
        safeFaceTarget(ent, victim.x, victim.z);

        const dmg = st.damage || 175;
        const healAmt = st.healAmount || 135;
        suppressDefaultCastEvent = true;
        this._enqueueSynchronizedSpellDelivery({
          gameState,
          comp,
          ent,
          spell,
          spellId,
          targetXFx: victim.x,
          targetZFx: victim.z,
          targetEntityId: victim.id,
          instantImpact: Boolean(targetOpts?._instantImpact),
          onImpact: (gs, impactXFx, impactZFx) => {
            const splashRadFx = Math.round(4.2 * FX_ONE);
            const hitIds = gs.spatialHash.queryRadiusIds(impactXFx, impactZFx, splashRadFx, gs.entities);
            for (let i = 0; i < hitIds.length; i++) {
              const v = gs.entities.get(hitIds[i]);
              if (!v || v.hp <= 0 || v.id === ent.id || v.team === comp.team || v.isGarrisoned) continue;
              const mult = v.id === victim.id ? 1.0 : 0.6;
              v.hp = Math.max(0, (v.hp - Math.round(dmg * mult)) | 0);
              v.ticksSinceLastHit = 0;
              this._applyRadialKnockback(gs, ent.x, ent.z, v, 4.2, 32, maxKbWeight);
              }
            if (ent.hp > 0) {
              ent.hp = Math.min(ent.maxHp, (ent.hp + healAmt) | 0);
              ent.isHealing = true;
            }
          }
        });
      }
      } else if (spellId === 'inspiring_onslaught') {
      safeFaceTarget(ent, fxTargetXFx, fxTargetZFx);
      const radFx = Math.round((st.radiusMeters || spell.radiusMeters || 9.0) * FX_ONE);
      const dmg = st.damage || 150;
      suppressDefaultCastEvent = true;
      this._enqueueSynchronizedSpellDelivery({
        gameState,
        comp,
        ent,
        spell,
        spellId,
        targetXFx: fxTargetXFx,
        targetZFx: fxTargetZFx,
        instantImpact: Boolean(targetOpts?._instantImpact),
        onImpact: (gs, impactXFx, impactZFx) => {
          const hitIds = gs.spatialHash.queryRadiusIds(impactXFx, impactZFx, radFx, gs.entities);
          for (let i = 0; i < hitIds.length; i++) {
            const unit = gs.entities.get(hitIds[i]);
            if (!unit || unit.hp <= 0 || unit.isGarrisoned) continue;
            if (unit.team !== comp.team && unit.id !== ent.id) {
              unit.hp = Math.max(0, (unit.hp - dmg) | 0);
              unit.ticksSinceLastHit = 0;
              this._applyRadialKnockback(gs, impactXFx, impactZFx, unit, 5.5, 36, maxKbWeight);
              } else if (unit.team === comp.team) {
              unit.isBuffed = true;
            }
          }
          comp.heroActiveBuffs.warCryTicks = (8 * TICKS_PER_SEC) | 0;
          comp.heroActiveBuffs.warCryDmgPct = st.damageBonusPct || 35;
          comp.heroActiveBuffs.berserkTicks = (8 * TICKS_PER_SEC) | 0;
          comp.heroActiveBuffs.berserkMoveSpdPct = st.moveSpeedPct || 35;
          this._recomputeHeroPassiveAndLevelStats(comp, ent, false);
        }
      });
      } else if (spellId === 'explosive_mark') {
      const maxR = castRangeMeters || 28;
      let targetEntId = -1;
      let targetBldId = -1;
      if (explicitBuilding) {
        fxTargetXFx = explicitBuilding.xFx;
        fxTargetYFx = explicitBuilding.yFx;
        fxTargetZFx = explicitBuilding.zFx;
        targetBldId = explicitBuilding.id;
        safeFaceTarget(ent, explicitBuilding.xFx, explicitBuilding.zFx);
      } else {
        const victim = explicitVictim || this._resolveTargetUnitOrNearest(gameState, ent, comp, targetOpts, maxR);
        if (victim && victim.team !== comp.team && victim.id !== ent.id) {
          fxTargetXFx = victim.x;
          fxTargetYFx = victim.y;
          fxTargetZFx = victim.z;
          targetEntId = victim.id;
          safeFaceTarget(ent, victim.x, victim.z);
        }
      }
      const radFx = Math.round((st.radiusMeters || spell.radiusMeters || 8.0) * FX_ONE);
      const dmg = st.damage || 165;
      const healAmt = st.healAmount || 95;
      suppressDefaultCastEvent = true;
      this._enqueueSynchronizedSpellDelivery({
        gameState,
        comp,
        ent,
        spell,
        spellId,
        targetXFx: fxTargetXFx,
        targetZFx: fxTargetZFx,
        targetEntityId: targetEntId,
        targetBuildingId: targetBldId,
        instantImpact: Boolean(targetOpts?._instantImpact),
        onImpact: (gs, impactXFx, impactZFx) => {
          if (explicitBuilding && !explicitBuilding.isDestroyed && explicitBuilding.hp > 0) {
            explicitBuilding.hp = Math.max(0, (explicitBuilding.hp - dmg) | 0);
            if (explicitBuilding.hp <= 0) {
              gs.constructionSystem?.handleBuildingDestroyedInCombat?.(explicitBuilding, gs);
            }
          }
          const hitIds = gs.spatialHash.queryRadiusIds(impactXFx, impactZFx, radFx, gs.entities);
          for (let i = 0; i < hitIds.length; i++) {
            const unit = gs.entities.get(hitIds[i]);
            if (!unit || unit.hp <= 0 || unit.isGarrisoned) continue;
            if (unit.team !== comp.team && unit.id !== ent.id) {
              unit.hp = Math.max(0, (unit.hp - dmg) | 0);
              unit.burningTicks = Math.max(unit.burningTicks | 0, 80);
              unit.ticksSinceLastHit = 0;
              this._applyRadialKnockback(gs, impactXFx, impactZFx, unit, 4.5, 32, maxKbWeight);
              } else if (unit.team === comp.team) {
              unit.hp = Math.min(unit.maxHp, (unit.hp + healAmt) | 0);
              unit.isHealing = true;
            }
          }
          if (gs.visionSystem) {
            gs.visionSystem.addTemporaryReveal(
              impactXFx,
              impactZFx,
              st.revealRadiusMeters || 24,
              12 * TICKS_PER_SEC,
              gs.tick
            );
            gs.visionSystem.update(gs, true);
          }
        }
      });
      }

    if (!suppressDefaultCastEvent) {
      gameState.pendingEvents.push({
        tick: gameState.tick,
        kind: 'HERO_SPELL_CAST',
        spellId,
        spellName: spell.name,
        vfxStyle: spell.vfxStyle || 'shockwave_ring',
        targetShape: spell.targetShape || 'circle',
        companyId: comp.id,
        heroEntityId: ent.id,
        fromXFx: ent.x,
        fromYFx: (ent.y + FX_ONE) | 0,
        fromZFx: ent.z,
        xFx: fxTargetXFx,
        yFx: (fxTargetYFx + FX_ONE) | 0,
        zFx: fxTargetZFx,
        radiusMeters: st.radiusMeters || spell.radiusMeters || 6,
        label: `${comp.name}: ${spell.nameEn || spell.name}!`
      });
    }

    return true;
  },
};
