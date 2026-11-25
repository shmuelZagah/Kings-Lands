/**
 * Kings Lands — Hero Tick Update, Auras, Buffs, Planted Banners & Temporary Summons
 * (src/sim/systems/heroRuntimeStepper.js)
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
import { getSpellCastTimingProfile } from '../../render/heroSpellAnimations.js';

function safeFaceTarget(ent, targetXFx, targetZFx) {
  if (!ent) return;
  const dx = (targetXFx - ent.x) | 0;
  const dz = (targetZFx - ent.z) | 0;
  if (Math.abs(dx) + Math.abs(dz) > 64) {
    ent.dir = fxAtan2(dz, dx) & ANGLE_MASK;
  }
}

export const heroRuntimeStepperMethods = {
  /**
   * Steps all living Heroes each simulation tick (walk-to-cast pending spells, delayed spell deliveries,
   * cooldowns, poison ticks, out-of-combat passive regen, auras, and XP from nearby enemy kills).
   */
  update(gameState, { AnimState, UnitTypeIndex }) {
    this._stepActiveSpellDeliveries(gameState);

    // Step temporary summoned companies (Ravan Summon Royal Army) so they expire cleanly after 35s
    for (const [cid, c] of gameState.companies.entries()) {
      if (c && c.isTemporarySummon && c.summonExpireTick && gameState.tick >= c.summonExpireTick) {
        this._despawnTemporaryCompany(gameState, cid);
      }
    }

    if (this.placedBanners && this.placedBanners.length > 0) {
      for (let bIdx = this.placedBanners.length - 1; bIdx >= 0; bIdx--) {
        const pb = this.placedBanners[bIdx];
        if ((pb.hp | 0) <= 0 || gameState.tick >= pb.expireTick) {
          this.placedBanners.splice(bIdx, 1);
          continue;
        }
        // Enemies within 3.5m of the planted banner attack & damage it each second
        if (gameState.tick % 10 === 0) {
          const atkIds = gameState.spatialHash.queryRadiusIds(pb.xFx, pb.zFx, Math.round(3.5 * FX_ONE), gameState.entities);
          for (let a = 0; a < atkIds.length; a++) {
            const foe = gameState.entities.get(atkIds[a]);
            if (foe && foe.hp > 0 && !foe.isGarrisoned && (gameState.areTeamsEnemy ? gameState.areTeamsEnemy(foe.team, pb.team) : foe.team !== pb.team)) {
              pb.hp = Math.max(0, (pb.hp - Math.max(8, foe.damage || 12)) | 0);
            }
          }
          if (pb.hp <= 0) {
            this.placedBanners.splice(bIdx, 1);
            continue;
          }
        }
        // Continuous buff to all friendly units inside the banner radius every tick!
        const nearIds = gameState.spatialHash.queryRadiusIds(pb.xFx, pb.zFx, pb.radiusFx, gameState.entities);
        for (let k = 0; k < nearIds.length; k++) {
          const ally = gameState.entities.get(nearIds[k]);
          if (!ally || ally.hp <= 0 || !(gameState.areTeamsAllied ? gameState.areTeamsAllied(ally.team, pb.team) : ally.team === pb.team)) continue;
          ally.isBuffed = true;
        }
        if (gameState.tick % 10 === 0) {
          for (const allyComp of gameState.companies.values()) {
            if (!allyComp || allyComp.team !== pb.team) continue;
            const d = fxHypot((allyComp.anchorXFx - pb.xFx) | 0, (allyComp.anchorZFx - pb.zFx) | 0);
            if (d <= pb.radiusFx + 4 * FX_ONE) {
              allyComp.isBroken = false;
              allyComp.moralePermille = Math.min(1000, (allyComp.moralePermille || 800) + 45);
              allyComp.hasBannerBuff = true;
            }
          }
        }
      }
    }

    const heroComps = [];
    for (const comp of gameState.companies.values()) {
      if (!comp || !comp.isHero) continue;
      const ent = gameState.entities.get(comp.memberIds[0]);
      if (!ent || ent.hp <= 0) {
        if (!comp._recordedFallen) {
          comp._recordedFallen = true;
          this.fallenHeroesByTeam[comp.team]?.set(comp.heroId, {
            level: Math.max(1, comp.heroLevel || 1)
          });
        }
        continue;
      }
      heroComps.push({ comp, ent });
    }

    const isSecondTick = gameState.tick % TICKS_PER_SEC === 0;
    const xpScanRadiusFx = 36 * FX_ONE;

    for (let i = 0; i < gameState.sortedEntityIds.length; i++) {
      const e = gameState.entities.get(gameState.sortedEntityIds[i]);
      if (!e) continue;

      if (e.hp > 0) {
        if ((e.summonHiddenTicks | 0) > 0) {
          e.summonHiddenTicks = (e.summonHiddenTicks - 1) | 0;
          if (e.summonHiddenTicks <= 0) {
            e.isGarrisoned = false;
          } else {
            continue;
          }
        }
        if ((e.poisonTicks | 0) > 0) {
          e.poisonTicks = (e.poisonTicks - 1) | 0;
          if (isSecondTick && (e.poisonDmgPerSec | 0) > 0) {
            e.hp = Math.max(0, (e.hp - (e.poisonDmgPerSec | 0)) | 0);
            e.ticksSinceLastHit = 0;
          }
        }
        if ((e.slowTicks | 0) > 0) {
          e.slowTicks = (e.slowTicks - 1) | 0;
        }
        if ((e.kingsDecreeTicks | 0) > 0) {
          e.kingsDecreeTicks = (e.kingsDecreeTicks - 1) | 0;
          e.isBuffed = true;
          if (e.kingsDecreeTicks === 0) {
            if (e._baseDamageBeforeDecree) {
              e.damage = e._baseDamageBeforeDecree;
              e.meleeDamage = e._baseDamageBeforeDecree;
            }
            if (e._baseSpeedBeforeDecree) {
              e.speedFx = e._baseSpeedBeforeDecree;
            }
          }
        }
        continue;
      }

      if (this._processedDeadEntityIds.has(e.id)) continue;
      this._processedDeadEntityIds.add(e.id);

      for (let h = 0; h < heroComps.length; h++) {
        const { comp, ent } = heroComps[h];
        if (comp.team === e.team) continue;
        const d = fxHypot((e.x - ent.x) | 0, (e.z - ent.z) | 0);
        if (d <= xpScanRadiusFx) {
          this.grantHeroXp(gameState, comp, ent, e.isHero ? 160 : 42);
          if ((comp.heroActiveBuffs?.bloodlustTicks | 0) > 0) {
            const maxSt = comp.heroActiveBuffs.bloodlustMaxStacks || 5;
            if ((comp.heroActiveBuffs.bloodlustStacks | 0) < maxSt) {
              comp.heroActiveBuffs.bloodlustStacks = ((comp.heroActiveBuffs.bloodlustStacks | 0) + 1) | 0;
              this._recomputeHeroPassiveAndLevelStats(comp, ent, false);
            }
          }
        }
      }
    }

    if (heroComps.length === 0) return;

    for (let h = 0; h < heroComps.length; h++) {
      const { comp, ent } = heroComps[h];

      if (ent.isRanged) {
        ent.ammo = 9999;
      }

      // Check Pending Walk-Into-Range Spell Cast (`comp.pendingSpellCast`)
      if (comp.pendingSpellCast) {
        const pend = comp.pendingSpellCast;
        let txFx = pend.targetXFx | 0;
        let tzFx = pend.targetZFx | 0;
        let footprintFx = 0;
        let validTarget = true;

        if ((pend.targetEntityId | 0) > 0) {
          const tEnt = gameState.entities.get(pend.targetEntityId | 0);
          if (!tEnt || tEnt.hp <= 0 || tEnt.isGarrisoned) {
            validTarget = false;
          } else {
            txFx = tEnt.x;
            tzFx = tEnt.z;
            pend.targetXFx = txFx;
            pend.targetZFx = tzFx;
          }
        } else if ((pend.targetBuildingId | 0) > 0) {
          const tBld = gameState.constructionSystem?.buildings?.get(pend.targetBuildingId | 0);
          if (!tBld || tBld.isDestroyed || tBld.hp <= 0) {
            validTarget = false;
          } else {
            txFx = tBld.xFx;
            tzFx = tBld.zFx;
            footprintFx = Math.round((tBld.footprintRadiusMeters || 4) * FX_ONE);
          }
        }

        if (!validTarget) {
          comp.pendingSpellCast = null;
        } else {
          const rawDistFx = fxHypot((txFx - ent.x) | 0, (tzFx - ent.z) | 0);
          const effDistFx = Math.max(0, (rawDistFx - footprintFx) | 0);
          if (effDistFx <= (pend.maxCastDistFx || 3 * FX_ONE)) {
            comp.pendingSpellCast = null;
            comp.stopInPlace(gameState.navGrid, gameState.entities);
            ent.isMoving = false;
            ent.targetX = ent.x;
            ent.targetZ = ent.z;
            this.castHeroSpell(gameState, comp.id, pend.slotIndex, comp.team, {
              targetXFx: txFx,
              targetZFx: tzFx,
              targetEntityId: pend.targetEntityId,
              targetBuildingId: pend.targetBuildingId,
              _bypassRangeCheck: true
            });
          } else if (gameState.tick % 6 === 0 && (pend.targetEntityId | 0) > 0) {
            // Keep chasing moving target unit while walking into melee/spell range
            const dirToGoal = fxAtan2((tzFx - ent.z) | 0, (txFx - ent.x) | 0);
            comp.enqueueOrSetOrder(
              {
                orderType: CompanyOrderType.MOVE,
                targetXFx: txFx,
                targetZFx: tzFx,
                facingDir: dirToGoal,
                isRunning: true
              },
              false,
              gameState.astar,
              gameState.navGrid,
              gameState.entities
            );
          }
        }
      }

      // Step Sisnat's Unstoppable Charge (`comp.activeChargeRush`)
      if (comp.activeChargeRush) {
        const rush = comp.activeChargeRush;
        rush.ticksRemaining = (rush.ticksRemaining - 1) | 0;

        // Lock both Sisnat and the Chameleon to face the exact direction of the run and advance strictly along ent.dir!
        if (typeof rush.chargeDir === "number") {
          ent.dir = rush.chargeDir & ANGLE_MASK;
          ent.desiredFacingDir = ent.dir;
          comp.facingDir = ent.dir;
          comp.desiredFacingDir = ent.dir;
        }
        const stepSpd = rush.stepSpeedFx || fxHypot(rush.stepVxFx, rush.stepVzFx);
        const stepX = mulDiv(stepSpd, fxCos(ent.dir), FX_ONE);
        const stepZ = mulDiv(stepSpd, fxSin(ent.dir), FX_ONE);
        const candX = fxClamp((ent.x + stepX) | 0, 16 * FX_ONE, gameState.worldSizeFx - 16 * FX_ONE);
        const candZ = fxClamp((ent.z + stepZ) | 0, 16 * FX_ONE, gameState.worldSizeFx - 16 * FX_ONE);

        // Stop if blocked by unwalkable terrain or an enemy building
        let blockedByObstacle = !gameState.navGrid.isWalkableWorldFx(candX, candZ);
        const blds = gameState.constructionSystem?.buildings;
        if (!blockedByObstacle && blds) {
          for (const b of blds.values()) {
            if (!b || b.isDestroyed || b.hp <= 0 || b.type === 'citadel_slot') continue;
            const dBld = fxHypot((b.xFx - candX) | 0, (b.zFx - candZ) | 0);
            if (dBld <= Math.round(((b.footprintRadiusMeters || 4) + 1.4) * FX_ONE)) {
              blockedByObstacle = true;
              break;
            }
          }
        }

        if (blockedByObstacle) {
          comp.activeChargeRush = null;
        } else {
          ent.x = candX;
          ent.z = candZ;
          ent.y = gameState.navGrid.sampleHeightAtWorldFx(candX, candZ);
          comp.anchorXFx = candX;
          comp.anchorZFx = candZ;
          comp.targetXFx = candX;
          comp.targetZFx = candZ;
          ent.slotTargetXFx = candX;
          ent.slotTargetZFx = candZ;
          ent.targetX = candX;
          ent.targetZ = candZ;
          ent.isMoving = true;
          ent.animState = AnimState.CHARGE ?? AnimState.RUN;

          const hitRadFx = rush.lineHalfWidthFx || Math.round(3.8 * FX_ONE);
          const nearIds = gameState.spatialHash.queryRadiusIds(ent.x, ent.z, hitRadFx, gameState.entities);
          let swungThisTick = false;
          for (let k = 0; k < nearIds.length; k++) {
            const v = gameState.entities.get(nearIds[k]);
            if (!v || v.hp <= 0 || v.id === ent.id || v.isGarrisoned || rush.hitEntityIds.has(v.id) || (gameState.areTeamsAllied ? gameState.areTeamsAllied(v.team, comp.team) : v.team === comp.team)) {
              continue;
            }
            // Universal Spear Wall / Pike Phalanx Anti-Charge Counter Strike (converts Sisnat's charge attack into counter-damage on him and halts him!)
            if (this._checkAndApplySpearWallAntiCharge(gameState, comp, ent, v)) {
              break;
            }
            const vWeight = (v.mass || (v.unitTypeIdx === 4 ? 340 : 120)) / 100;
            if (vWeight > (rush.maxKnockbackWeight || 5.8)) {
              comp.activeChargeRush = null;
              break;
            }
            rush.hitEntityIds.add(v.id);
            if (!swungThisTick && (ent.windupTicks | 0) <= 0) {
              ent.windupTicks = 6;
              swungThisTick = true;
            }
            v.hp = Math.max(0, (v.hp - rush.damage) | 0);
            v.ticksSinceLastHit = 0;
            if ((rush.burnTicks | 0) > 0) {
              v.burningTicks = Math.max(v.burningTicks | 0, rush.burnTicks | 0);
            }
            this._applyRadialKnockback(gameState, ent.x - stepX, ent.z - stepZ, v, rush.knockbackMeters, 34, rush.maxKnockbackWeight);
            if (v.hp <= 0) this.grantHeroXp(gameState, comp, ent, 42);
          }

          if (comp.activeChargeRush && rush.ticksRemaining <= 0) {
            comp.activeChargeRush = null;
          }
        }
      }

      // Sisnat & Mounted Ravan Continuous Trample & Sisnat Hit-and-Run Cycle-Charge Combat
      this._stepMountedHeroTrampleAndCycleCombat(gameState, comp, ent, AnimState);

      if (ent.windupTicks === 1 || ent.shotWindupTicks === 1) {
        this.grantHeroXp(gameState, comp, ent, 16);
        if ((comp.heroActiveBuffs?.immortalTicks | 0) > 0 && ent.hp < ent.maxHp) {
          ent.hp = Math.min(ent.maxHp, (ent.hp + 18) | 0);
        }
        // Ravan's Azure Blade Fury: Every melee attack swing spawns a glowing blue sword slash trail!
        if (ent.windupTicks === 1 && (comp.heroActiveBuffs?.azureFuryTicks | 0) > 0) {
          const slashXFx = (ent.x + mulDiv(Math.round(1.6 * FX_ONE), fxCos(ent.dir), FX_ONE)) | 0;
          const slashZFx = (ent.z + mulDiv(Math.round(1.6 * FX_ONE), fxSin(ent.dir), FX_ONE)) | 0;
          gameState.pendingEvents.push({
            tick: gameState.tick,
            kind: 'HERO_SPELL_CAST',
            spellId: 'azure_blade_fury',
            vfxStyle: 'azure_blade_slash',
            companyId: comp.id,
            heroEntityId: ent.id,
            fromXFx: ent.x,
            fromYFx: (ent.y + FX_ONE) | 0,
            fromZFx: ent.z,
            xFx: slashXFx,
            yFx: (ent.y + FX_ONE) | 0,
            zFx: slashZFx,
            radiusMeters: 2.5
          });
        }
      }

      if ((ent.activeSpellTimerTicks | 0) > 0) {
        ent.activeSpellTimerTicks = (ent.activeSpellTimerTicks - 1) | 0;
        if (ent.activeSpellTimerTicks <= 0) {
          ent.activeSpellSlotIdx = 0;
        }
      }

      for (let s = 0; s < comp.heroSpells.length; s++) {
        const sp = comp.heroSpells[s];
        if ((sp.cooldownTicks | 0) > 0) {
          sp.cooldownTicks = (sp.cooldownTicks - 1) | 0;
        }
      }

      const buffs = comp.heroActiveBuffs;
      let buffExpired = false;
      for (const k of ['warCryTicks', 'berserkTicks', 'arcaneShieldTicks', 'immortalTicks', 'azureFuryTicks', 'bloodlustTicks']) {
        if ((buffs[k] | 0) > 0) {
          buffs[k] = (buffs[k] - 1) | 0;
          if (buffs[k] === 0) buffExpired = true;
        }
      }
      if ((ent.burningWeaponTicks | 0) > 0) {
        ent.burningWeaponTicks = (ent.burningWeaponTicks - 1) | 0;
      }
      if (buffExpired) {
        this._recomputeHeroPassiveAndLevelStats(comp, ent, false);
      }

      ent.heroBuffVisual =
        (buffs.bloodlustTicks | 0) > 0 ? 1 : (buffs.azureFuryTicks | 0) > 0 ? 2 : 0;
      ent.isWarhorseMounted = Boolean(comp.isWarhorseMounted);

      // Never set ent.isBuffed on the Hero from passive Aura of Valor or Ravan's Azure Blade Fury (only his sword glows blue, no ground ring)!
      ent.isBuffed =
        (buffs.warCryTicks | 0) > 0 ||
        (buffs.berserkTicks | 0) > 0 ||
        (buffs.arcaneShieldTicks | 0) > 0 ||
        (buffs.immortalTicks | 0) > 0 ||
        (buffs.bloodlustTicks | 0) > 0;

      // Apply Ravan's Passive Aura of Valor (`ally.isBuffed = true`) EVERY tick to nearby friendly units (excluding Ravan himself) so it never blinks!
      const auraDmgPctNow = comp.heroPassiveBonuses?.allyDamageBonusPct || 0;
      const auraArmorNow = comp.heroPassiveBonuses?.allyArmorBonus || 0;
      if (auraDmgPctNow > 0 || auraArmorNow > 0) {
        const auraRadFx = Math.round((comp.heroPassiveBonuses?.auraRadiusMeters || 18) * FX_ONE);
        const nearbyIds = gameState.spatialHash.queryRadiusIds(ent.x, ent.z, auraRadFx, gameState.entities);
        for (let n = 0; n < nearbyIds.length; n++) {
          const ally = gameState.entities.get(nearbyIds[n]);
          if (!ally || ally.hp <= 0 || ally.team !== comp.team || ally.id === ent.id) continue;
          ally.isBuffed = true;
        }
      }

      if (isSecondTick) {
        // Award XP to the Hero when nearby friendly soldiers are actively fighting enemies around them!
        const combatRadFx = Math.round(32 * FX_ONE);
        const aroundHeroIds = gameState.spatialHash.queryRadiusIds(ent.x, ent.z, combatRadFx, gameState.entities);
        let fightingAlliesCount = 0;
        for (let a = 0; a < aroundHeroIds.length; a++) {
          const unit = gameState.entities.get(aroundHeroIds[a]);
          if (!unit || unit.hp <= 0 || unit.id === ent.id) continue;
          if (unit.team === comp.team) {
            if ((unit.windupTicks | 0) > 0 || (unit.shotWindupTicks | 0) > 0 || (unit.ticksSinceLastHit ?? 999) < 35) {
              fightingAlliesCount++;
            }
          } else if ((unit.ticksSinceLastHit ?? 999) < 25) {
            fightingAlliesCount++;
          }
        }
        if (fightingAlliesCount > 0) {
          this.grantHeroXp(gameState, comp, ent, Math.min(75, fightingAlliesCount * 10));
        }
        const regen = comp.heroBaseStats?.hpRegenPerSec || 4;
        const isOutOfCombat = (ent.ticksSinceLastHit ?? 999) >= 80 && (comp.ticksSinceLastCombat ?? 999) >= 60;
        if (isOutOfCombat && ent.hp < ent.maxHp) {
          ent.hp = Math.min(ent.maxHp, (ent.hp + regen) | 0);
        }

        const auraDmgPct = comp.heroPassiveBonuses?.allyDamageBonusPct || 0;
        const auraHeal = comp.heroPassiveBonuses?.allyHpRegen || 0;
        if (auraDmgPct > 0 || auraHeal > 0) {
          const auraRadFx = Math.round(
            (comp.heroPassiveBonuses?.auraRadiusMeters || 22) * FX_ONE
          );
          const nearbyIds = gameState.spatialHash.queryRadiusIds(
            ent.x,
            ent.z,
            auraRadFx,
            gameState.entities
          );
          for (let n = 0; n < nearbyIds.length; n++) {
            const ally = gameState.entities.get(nearbyIds[n]);
            if (!ally || ally.hp <= 0 || ally.team !== comp.team || ally.id === ent.id) continue;
            ally.isBuffed = true;
            if (auraHeal > 0 && ally.hp < ally.maxHp && (ally.ticksSinceLastHit ?? 999) >= 60) {
              ally.hp = Math.min(ally.maxHp, (ally.hp + auraHeal) | 0);
              ally.isHealing = true;
            }
          }
        }
      }
    }
  },
  _despawnTemporaryCompany(gameState, companyId) {
    const comp = gameState.companies.get(companyId | 0);
    if (!comp) return;
    for (let m = 0; m < comp.memberIds.length; m++) {
      const mId = comp.memberIds[m];
      const mEnt = gameState.entities.get(mId);
      if (mEnt) {
        mEnt.hp = 0;
        gameState.entities.delete(mId);
      }
      const sIdx = gameState.sortedEntityIds.indexOf(mId);
      if (sIdx !== -1) {
        gameState.sortedEntityIds.splice(sIdx, 1);
      }
    }
    gameState.companies.delete(companyId | 0);
  },

};
