/**
 * Kings Lands — Hero Delayed Spell Projectiles & Sequential Chain Lightning Bounces
 * (src/sim/systems/heroSpellDeliveries.js)
 */
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

function safeFaceTarget(ent, targetXFx, targetZFx) {
  if (!ent) return;
  const dx = (targetXFx - ent.x) | 0;
  const dz = (targetZFx - ent.z) | 0;
  if (Math.abs(dx) + Math.abs(dz) > 64) {
    ent.dir = fxAtan2(dz, dx) & ANGLE_MASK;
  }
}


export const heroSpellDeliveryMethods = {
  /**
   * Steps all active delayed spell deliveries (projectiles and sequential chain lightning bounces).
   */
  _stepActiveSpellDeliveries(gameState) {
    if (!this.activeSpellDeliveries || this.activeSpellDeliveries.length === 0) return;

    for (let i = this.activeSpellDeliveries.length - 1; i >= 0; i--) {
      const d = this.activeSpellDeliveries[i];
      d.ticksRemaining = (d.ticksRemaining - 1) | 0;
      if (d.ticksRemaining > 0) continue;

      if (d.kind === 'WAIT_RELEASE') {
        this.activeSpellDeliveries.splice(i, 1);
        d.onRelease?.(gameState);
        continue;
      }

      if (d.kind === 'PROJECTILE_CALLBACK') {
        let impactXFx = d.targetXFx | 0;
        let impactZFx = d.targetZFx | 0;
        if ((d.targetEntityId | 0) > 0) {
          const tEnt = gameState.entities.get(d.targetEntityId | 0);
          if (tEnt && tEnt.hp > 0 && !tEnt.isGarrisoned) {
            impactXFx = tEnt.x;
            impactZFx = tEnt.z;
          }
        }
        d.onImpact?.(gameState, impactXFx, impactZFx);
        this.activeSpellDeliveries.splice(i, 1);
        continue;
      }

      if (d.kind === 'CHAIN_LIGHTNING') {
        const comp = gameState.companies.get(d.companyId);
        const heroEnt = gameState.entities.get(d.heroEntityId);

        // Refresh staff-tip source on the very first hop if the Wizard moved/turned slightly
        if (d.struckCount === 0 && heroEnt && heroEnt.hp > 0) {
          d.lastSourceXFx = (heroEnt.x + mulDiv(Math.round(1.1 * FX_ONE), fxCos(heroEnt.dir), FX_ONE)) | 0;
          d.lastSourceZFx = (heroEnt.z + mulDiv(Math.round(1.1 * FX_ONE), fxSin(heroEnt.dir), FX_ONE)) | 0;
          d.lastSourceYFx = (heroEnt.y + Math.round(2.15 * FX_ONE)) | 0;
        }

        let victim = null;
        if ((d.nextTargetEntityId | 0) > 0 && !d.struckIds.has(d.nextTargetEntityId | 0)) {
          const cand = gameState.entities.get(d.nextTargetEntityId | 0);
          if (cand && cand.hp > 0 && !cand.isGarrisoned && (gameState.areTeamsEnemy ? gameState.areTeamsEnemy(cand.team, d.team) : cand.team !== d.team)) {
            victim = cand;
          }
        }

        if (!victim) {
          const bounceRadFx = Math.round((d.struckCount === 0 ? 28 : 16.5) * FX_ONE);
          const nearIds = gameState.spatialHash.queryRadiusIds(
            d.searchOriginXFx,
            d.searchOriginZFx,
            bounceRadFx,
            gameState.entities
          );
          let bestDist = 0x7fffffff;
          for (let k = 0; k < nearIds.length; k++) {
            const cand = gameState.entities.get(nearIds[k]);
            if (
              !cand ||
              cand.hp <= 0 ||
              (gameState.areTeamsAllied ? gameState.areTeamsAllied(cand.team, d.team) : cand.team === d.team) ||
              cand.isGarrisoned ||
              d.struckIds.has(cand.id)
            ) {
              continue;
            }
            const dist = fxHypot((cand.x - d.searchOriginXFx) | 0, (cand.z - d.searchOriginZFx) | 0);
            if (dist < bestDist) {
              bestDist = dist;
              victim = cand;
            }
          }
        }

        if (!victim) {
          this.activeSpellDeliveries.splice(i, 1);
          continue;
        }

        // Deal damage on the exact tick the bolt jumps to this enemy!
        d.struckIds.add(victim.id);
        d.struckCount++;
        const hopDmg = Math.max(40, Math.round(d.damage * Math.pow(0.92, d.struckCount - 1)));
        victim.hp = Math.max(0, (victim.hp - hopDmg) | 0);
        victim.ticksSinceLastHit = 0;
        victim.hurtVisualTicks = 9;
        if (victim.hp <= 0 && comp && heroEnt) {
          this.grantHeroXp(gameState, comp, heroEnt, 18);
        }

        // Emit 3D jagged lightning arc jump from previous source to this victim
        gameState.pendingEvents.push({
          tick: gameState.tick,
          kind: 'HERO_SPELL_CAST',
          spellId: 'chain_lightning',
          vfxStyle: 'lightning_arc_jump',
          companyId: d.companyId,
          heroEntityId: d.heroEntityId,
          fromXFx: d.lastSourceXFx,
          fromYFx: d.lastSourceYFx,
          fromZFx: d.lastSourceZFx,
          xFx: victim.x,
          yFx: (victim.y + Math.round(1.15 * FX_ONE)) | 0,
          zFx: victim.z,
          radiusMeters: 3.2,
          hopIndex: d.struckCount
        });

        if (d.struckCount >= d.maxTargets) {
          this.activeSpellDeliveries.splice(i, 1);
        } else {
          d.lastSourceXFx = victim.x;
          d.lastSourceYFx = (victim.y + Math.round(1.15 * FX_ONE)) | 0;
          d.lastSourceZFx = victim.z;
          d.searchOriginXFx = victim.x;
          d.searchOriginZFx = victim.z;
          d.nextTargetEntityId = -1;
          d.ticksRemaining = d.hopIntervalTicks || 7;
        }
      }
    }
  },
};
