/**
 * Kings Lands — Dedicated Hero Body Spell Animations & Cast-to-VFX Timing Profiles
 * (src/render/heroSpellAnimations.js)
 *
 * This file connects each Hero's 3D body animation (`spell_<spellId>`) to the 3D spell visual effects
 * in `src/render/spellEffects.js` and the simulation impact timing in `src/sim/systems/heroSystem.js`.
 *
 * Easy to edit in one place:
 * 1. `SPELL_CAST_TIMING_PROFILES`:
 *    - `releaseDelayTicks`: How many simulation ticks (20 ticks = 1.0s) after starting the spell cast
 *      before the bow releases the arrow, the staff launches the projectile, or the sword cleaves the enemy.
 *    - `projectileSpeedMps`: Travel speed in meters/second for ranged projectiles. Used identically by BOTH
 *      `HeroSystem` (to compute `flightTicks`) and `spellEffects.js` (`flightDurationSec`) so damage &
 *      airborne knockback occur on the exact frame the projectile reaches the enemy!
 *    - `spawnForwardMeters` / `spawnHeightMeters`: Where the 3D spell effect spawns relative to the Hero
 *      (e.g., bow tip, raised staff tip, or front sword slash arc).
 * 2. `HERO_SPELL_KEYFRAME_ANIMATIONS`:
 *    - Default 3D skeletal keyframe clips (`spell_<spellId>`) for Heroes when casting each spell.
 */

import { TICKS_PER_SEC } from '../core/fx.js';
import { dataRegistry } from '../data/dataRegistry.js';

export const SPELL_CAST_TIMING_PROFILES = Object.freeze({
  // ---------------------------------------------------------------------------
  // TREE 1: SELF SUPPORT
  // ---------------------------------------------------------------------------
  self_heal: {
    melee: { releaseDelayTicks: 2, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 1.15, animTimerTicks: 24 },
    ranged: { releaseDelayTicks: 2, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 1.15, animTimerTicks: 24 }
  },
  wind_stride: {
    melee: { releaseDelayTicks: 1, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 1.0, animTimerTicks: 18 },
    ranged: { releaseDelayTicks: 1, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 1.0, animTimerTicks: 18 }
  },
  immortal_avatar: {
    melee: { releaseDelayTicks: 3, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 1.2, animTimerTicks: 26 },
    ranged: { releaseDelayTicks: 3, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 1.2, animTimerTicks: 26 }
  },

  // ---------------------------------------------------------------------------
  // TREE 2: OFFENSE (Bow / Melee Adaptive + Slam + Whirlwind/Volley)
  // ---------------------------------------------------------------------------
  venom_strike: {
    // Melee: 4 ticks (0.20s) sword slash windup; Ranged (Poison Arrow): 6 ticks (0.30s) bow draw + 46 m/s arrow flight!
    melee: { releaseDelayTicks: 4, projectileSpeedMps: 0, spawnForwardMeters: 0.65, spawnHeightMeters: 1.15, animTimerTicks: 18 },
    ranged: { releaseDelayTicks: 6, projectileSpeedMps: 46, spawnForwardMeters: 0.95, spawnHeightMeters: 1.35, animTimerTicks: 20 }
  },
  poison_arrow: {
    melee: { releaseDelayTicks: 4, projectileSpeedMps: 0, spawnForwardMeters: 0.65, spawnHeightMeters: 1.15, animTimerTicks: 18 },
    ranged: { releaseDelayTicks: 6, projectileSpeedMps: 46, spawnForwardMeters: 0.95, spawnHeightMeters: 1.35, animTimerTicks: 20 }
  },
  soul_burn: {
    melee: { releaseDelayTicks: 5, projectileSpeedMps: 42, spawnForwardMeters: 1.05, spawnHeightMeters: 1.65, animTimerTicks: 20 },
    ranged: { releaseDelayTicks: 5, projectileSpeedMps: 42, spawnForwardMeters: 1.05, spawnHeightMeters: 1.65, animTimerTicks: 20 }
  },
  mighty_strike: {
    // Melee: 4 ticks (0.20s) heavy sword swing before cleave + knockback; Ranged (Piercing Shot): 6 ticks bow draw + 48 m/s bolt flight!
    melee: { releaseDelayTicks: 4, projectileSpeedMps: 0, spawnForwardMeters: 0.75, spawnHeightMeters: 1.15, animTimerTicks: 20 },
    ranged: { releaseDelayTicks: 6, projectileSpeedMps: 48, spawnForwardMeters: 0.95, spawnHeightMeters: 1.35, animTimerTicks: 22 }
  },
  piercing_shot: {
    melee: { releaseDelayTicks: 4, projectileSpeedMps: 0, spawnForwardMeters: 0.75, spawnHeightMeters: 1.15, animTimerTicks: 20 },
    ranged: { releaseDelayTicks: 6, projectileSpeedMps: 48, spawnForwardMeters: 0.95, spawnHeightMeters: 1.35, animTimerTicks: 22 }
  },
  repelling_shot: {
    melee: { releaseDelayTicks: 5, projectileSpeedMps: 46, spawnForwardMeters: 0.95, spawnHeightMeters: 1.35, animTimerTicks: 20 },
    ranged: { releaseDelayTicks: 6, projectileSpeedMps: 48, spawnForwardMeters: 0.95, spawnHeightMeters: 1.35, animTimerTicks: 22 }
  },
  arcane_bolt: {
    melee: { releaseDelayTicks: 5, projectileSpeedMps: 44, spawnForwardMeters: 1.05, spawnHeightMeters: 1.65, animTimerTicks: 20 },
    ranged: { releaseDelayTicks: 5, projectileSpeedMps: 44, spawnForwardMeters: 1.05, spawnHeightMeters: 1.65, animTimerTicks: 20 }
  },
  throwing_knife: {
    melee: { releaseDelayTicks: 4, projectileSpeedMps: 50, spawnForwardMeters: 0.85, spawnHeightMeters: 1.3, animTimerTicks: 16 },
    ranged: { releaseDelayTicks: 4, projectileSpeedMps: 50, spawnForwardMeters: 0.85, spawnHeightMeters: 1.3, animTimerTicks: 16 }
  },
  shockwave_slam: {
    // 5 ticks (0.25s) leap/slam windup -> ground impact + radial knockback!
    melee: { releaseDelayTicks: 5, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 0.35, animTimerTicks: 20 },
    ranged: { releaseDelayTicks: 5, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 0.35, animTimerTicks: 20 }
  },
  repulse_wave: {
    melee: { releaseDelayTicks: 4, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 0.5, animTimerTicks: 20 },
    ranged: { releaseDelayTicks: 4, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 0.5, animTimerTicks: 20 }
  },
  whirlwind_rampage: {
    // Melee: 4 ticks spin windup; Ranged (Rain of Arrows): 6 ticks skyward bow release + 9 ticks (0.45s) arrow rain descent!
    melee: { releaseDelayTicks: 4, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 0.8, animTimerTicks: 24 },
    ranged: { releaseDelayTicks: 6, projectileSpeedMps: 0, fixedFlightTicks: 9, spawnForwardMeters: 0.6, spawnHeightMeters: 1.6, animTimerTicks: 24 }
  },
  arrow_volley: {
    melee: { releaseDelayTicks: 10, projectileSpeedMps: 0, fixedFlightTicks: 11, spawnForwardMeters: 0.6, spawnHeightMeters: 1.6, animTimerTicks: 22 },
    ranged: { releaseDelayTicks: 10, projectileSpeedMps: 0, fixedFlightTicks: 11, spawnForwardMeters: 0.6, spawnHeightMeters: 1.6, animTimerTicks: 22 }
  },
  arcane_nova: {
    melee: { releaseDelayTicks: 5, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 0.6, animTimerTicks: 22 },
    ranged: { releaseDelayTicks: 5, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 0.6, animTimerTicks: 22 }
  },

  // ---------------------------------------------------------------------------
  // TREE 3: AREA SUPPORT
  // ---------------------------------------------------------------------------
  war_cry: {
    melee: { releaseDelayTicks: 3, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 1.0, animTimerTicks: 20 },
    ranged: { releaseDelayTicks: 3, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 1.0, animTimerTicks: 20 }
  },
  heal: {
    melee: { releaseDelayTicks: 2, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 1.15, animTimerTicks: 22 },
    ranged: { releaseDelayTicks: 2, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 1.15, animTimerTicks: 22 }
  },
  aegis_banner: {
    melee: { releaseDelayTicks: 3, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 1.0, animTimerTicks: 22 },
    ranged: { releaseDelayTicks: 3, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 1.0, animTimerTicks: 22 }
  },
  royal_sanctuary: {
    melee: { releaseDelayTicks: 4, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 1.0, animTimerTicks: 24 },
    ranged: { releaseDelayTicks: 4, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 1.0, animTimerTicks: 24 }
  },

  // ---------------------------------------------------------------------------
  // TREE 4: TACTICAL MAGIC
  // ---------------------------------------------------------------------------
  far_sight: {
    melee: { releaseDelayTicks: 3, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 1.5, animTimerTicks: 20 },
    ranged: { releaseDelayTicks: 3, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 1.5, animTimerTicks: 20 }
  },
  fireball: {
    // 5 ticks (0.25s) staff thrust -> straight fireball flight at 44 m/s -> 3D explosion & knockback on arrival!
    melee: { releaseDelayTicks: 5, projectileSpeedMps: 44, spawnForwardMeters: 1.1, spawnHeightMeters: 1.55, animTimerTicks: 22 },
    ranged: { releaseDelayTicks: 5, projectileSpeedMps: 44, spawnForwardMeters: 1.1, spawnHeightMeters: 1.55, animTimerTicks: 22 }
  },
  chain_lightning: {
    // 8 ticks (0.40s) staff raise charge -> Bolt #1 -> 7 ticks (0.35s) per bounce across enemies!
    melee: { releaseDelayTicks: 8, projectileSpeedMps: 0, hopIntervalTicks: 7, spawnForwardMeters: 1.1, spawnHeightMeters: 2.15, animTimerTicks: 28 },
    ranged: { releaseDelayTicks: 8, projectileSpeedMps: 0, hopIntervalTicks: 7, spawnForwardMeters: 1.1, spawnHeightMeters: 2.15, animTimerTicks: 28 }
  },
  meteor_storm: {
    // 5 ticks staff sky-call -> 9 ticks (0.45s) meteor descent from sky -> 3D blast & knockback on impact!
    melee: { releaseDelayTicks: 5, projectileSpeedMps: 0, fixedFlightTicks: 9, spawnForwardMeters: 0.8, spawnHeightMeters: 1.8, animTimerTicks: 26 },
    ranged: { releaseDelayTicks: 5, projectileSpeedMps: 0, fixedFlightTicks: 9, spawnForwardMeters: 0.8, spawnHeightMeters: 1.8, animTimerTicks: 26 }
  },

  // ---------------------------------------------------------------------------
  // CROSS-TREE HYBRID SPELLS
  // ---------------------------------------------------------------------------
  vampiric_cleave: {
    melee: { releaseDelayTicks: 4, projectileSpeedMps: 0, spawnForwardMeters: 0.75, spawnHeightMeters: 1.15, animTimerTicks: 20 },
    ranged: { releaseDelayTicks: 6, projectileSpeedMps: 46, spawnForwardMeters: 0.95, spawnHeightMeters: 1.35, animTimerTicks: 22 }
  },
  inspiring_onslaught: {
    melee: { releaseDelayTicks: 5, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 0.5, animTimerTicks: 22 },
    ranged: { releaseDelayTicks: 5, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 0.5, animTimerTicks: 22 }
  },
  explosive_mark: {
    melee: { releaseDelayTicks: 5, projectileSpeedMps: 44, spawnForwardMeters: 0.95, spawnHeightMeters: 1.4, animTimerTicks: 22 },
    ranged: { releaseDelayTicks: 6, projectileSpeedMps: 46, spawnForwardMeters: 0.95, spawnHeightMeters: 1.4, animTimerTicks: 22 }
  },
  summon_warhorse: {
    melee: { releaseDelayTicks: 2, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 1.0, animTimerTicks: 20 },
    ranged: { releaseDelayTicks: 2, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 1.0, animTimerTicks: 20 }
  },
  azure_blade_fury: {
    melee: { releaseDelayTicks: 2, projectileSpeedMps: 0, spawnForwardMeters: 0.7, spawnHeightMeters: 1.15, animTimerTicks: 22 },
    ranged: { releaseDelayTicks: 2, projectileSpeedMps: 0, spawnForwardMeters: 0.7, spawnHeightMeters: 1.15, animTimerTicks: 22 }
  },
  bloodlust_frenzy: {
    melee: { releaseDelayTicks: 2, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 1.1, animTimerTicks: 20 },
    ranged: { releaseDelayTicks: 2, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 1.1, animTimerTicks: 20 }
  },
  summon_royal_guard: {
    melee: { releaseDelayTicks: 4, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 0.5, animTimerTicks: 24 },
    ranged: { releaseDelayTicks: 4, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 0.5, animTimerTicks: 24 }
  },
  kings_decree: {
    melee: { releaseDelayTicks: 4, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 0.5, animTimerTicks: 24 },
    ranged: { releaseDelayTicks: 4, projectileSpeedMps: 0, spawnForwardMeters: 0.0, spawnHeightMeters: 0.5, animTimerTicks: 24 }
  },
  unstoppable_charge: {
    melee: { releaseDelayTicks: 2, projectileSpeedMps: 0, spawnForwardMeters: 0.5, spawnHeightMeters: 0.9, animTimerTicks: 26 },
    ranged: { releaseDelayTicks: 2, projectileSpeedMps: 0, spawnForwardMeters: 0.5, spawnHeightMeters: 0.9, animTimerTicks: 26 }
  },
  chameleon_roar: {
    melee: { releaseDelayTicks: 4, projectileSpeedMps: 0, spawnForwardMeters: 0.85, spawnHeightMeters: 1.1, animTimerTicks: 22 },
    ranged: { releaseDelayTicks: 4, projectileSpeedMps: 0, spawnForwardMeters: 0.85, spawnHeightMeters: 1.1, animTimerTicks: 22 }
  },
  chameleon_venom_bite: {
    melee: { releaseDelayTicks: 4, projectileSpeedMps: 0, spawnForwardMeters: 1.15, spawnHeightMeters: 1.05, animTimerTicks: 22 },
    ranged: { releaseDelayTicks: 4, projectileSpeedMps: 0, spawnForwardMeters: 1.15, spawnHeightMeters: 1.05, animTimerTicks: 22 }
  }
});

/**
 * Returns the synchronized cast timing profile for `spellId` in the Hero's current weapon stance (`'melee'` | `'ranged'`),
 * including exact `releaseDelayTicks`, `flightTicks`, and `flightDurationSec` for a given `distanceMeters`.
 */
export function getSpellCastTimingProfile(spellId, weaponMode = 'melee', distanceMeters = 0) {
  const mode = weaponMode === 'ranged' ? 'ranged' : 'melee';
  const entry = SPELL_CAST_TIMING_PROFILES[spellId]?.[mode] ||
    SPELL_CAST_TIMING_PROFILES[spellId]?.melee || {
      releaseDelayTicks: 3,
      projectileSpeedMps: 0,
      spawnForwardMeters: 0.6,
      spawnHeightMeters: 1.25,
      animTimerTicks: 18
    };

  let flightTicks = 0;
  if (typeof entry.fixedFlightTicks === 'number' && entry.fixedFlightTicks > 0) {
    flightTicks = entry.fixedFlightTicks | 0;
  } else if (entry.projectileSpeedMps > 0 && distanceMeters > 0.5) {
    const rawSec = distanceMeters / entry.projectileSpeedMps;
    flightTicks = Math.max(3, Math.min(24, Math.round(rawSec * TICKS_PER_SEC)));
  }

  return {
    releaseDelayTicks: Math.max(0, entry.releaseDelayTicks | 0),
    flightTicks,
    flightDurationSec: flightTicks > 0 ? flightTicks / TICKS_PER_SEC : 0,
    hopIntervalTicks: entry.hopIntervalTicks || 7,
    spawnForwardMeters: entry.spawnForwardMeters ?? 0.6,
    spawnHeightMeters: entry.spawnHeightMeters ?? 1.25,
    animTimerTicks: entry.animTimerTicks || 20
  };
}

/**
 * Default Hero body spell keyframe animations (`spell_<spellId>`).
 * Can be edited here in code or visually in the Animation Lab!
 */
export function getHeroSpellKeyframeAnimations() {
  return dataRegistry.getHeroesData()?.animations?.keyframes || {};
}

export const HERO_SPELL_KEYFRAME_ANIMATIONS = Object.freeze({
  ...(dataRegistry.getHeroesData()?.animations?.keyframes || {})
});
