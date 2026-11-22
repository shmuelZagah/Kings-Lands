/**
 * Kings Lands — Phase 8: In-Game Hero Recruitment, Cumulative Runtime XP/Leveling (1–10),
 * 10-Circle Timeline Auto-Unlock, Weapon Switching, Stance-Adaptive Spells,
 * Walk-Into-Range Spell Execution, Delayed Impact Delivery & Airborne Knockback Physics
 * (src/sim/systems/heroSystem.js)
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
import defaultHeroesJson from '../../data/heroes.json';
import { getSpellCastTimingProfile } from '../../render/heroSpellAnimations.js';

const LEGACY_SPELL_ID_ALIASES = Object.freeze({
  iron_skin: 'iron_blood',
  cleave_strike: 'shockwave_slam',
  berserk: 'wind_stride',
  arcane_shield: 'self_heal',
  revive_fallen: 'royal_sanctuary'
});

export function normalizeSpellId(spellId) {
  if (!spellId) return null;
  return LEGACY_SPELL_ID_ALIASES[spellId] || spellId;
}

function lookupSpellInCatalog(heroesData, rawSpellId) {
  const spellId = normalizeSpellId(rawSpellId);
  if (!spellId) return null;
  const trees = heroesData?.spellTrees || defaultHeroesJson.spellTrees || {};
  for (const tree of Object.values(trees)) {
    if (tree?.spells?.[spellId]) return tree.spells[spellId];
  }
  const hybrids = heroesData?.hybridSpells || defaultHeroesJson.hybridSpells || {};
  if (hybrids[spellId]) return hybrids[spellId];
  if (defaultHeroesJson.hybridSpells?.[spellId]) return defaultHeroesJson.hybridSpells[spellId];
  for (const tree of Object.values(defaultHeroesJson.spellTrees || {})) {
    if (tree?.spells?.[spellId]) return tree.spells[spellId];
  }
  return null;
}

function heroHasSecondaryLoadout(heroDef) {
  const lds = heroDef?.loadouts;
  if (!lds || typeof lds !== 'object') return false;
  for (const [k, ld] of Object.entries(lds)) {
    if (k === 'main') continue;
    const eq = ld?.equipment;
    if (eq && (eq.weapon_socket_R?.prefab || eq.weapon_socket_L?.prefab)) return true;
  }
  return false;
}

function getEquipmentWeaponMode(equipment) {
  if (!equipment) return 'melee';
  const r = String(equipment.weapon_socket_R?.prefab || '');
  const l = String(equipment.weapon_socket_L?.prefab || '');
  if (/bow|crossbow/i.test(r) || /bow|crossbow/i.test(l)) return 'ranged';
  return 'melee';
}

// Cumulative XP thresholds per level (starts at 0 XP at Level 1; at Level 6 it is 1000/1500xp)
export const CUMULATIVE_HERO_XP_THRESHOLDS = Object.freeze([
  0,    // Level 1 start (0 / 100xp)
  100,  // Level 2 start (100 / 250xp)
  250,  // Level 3 start (250 / 450xp)
  450,  // Level 4 start (450 / 700xp)
  700,  // Level 5 start (700 / 1000xp)
  1000, // Level 6 start (1000 / 1500xp)
  1500, // Level 7 start (1500 / 2100xp)
  2100, // Level 8 start (2100 / 2800xp)
  2800, // Level 9 start (2800 / 3600xp)
  3600  // Level 10 start (3600 / 3600xp MAX)
]);

export function getCumulativeXpForLevel(level, baseXp = 100) {
  const idx = Math.max(0, Math.min(9, (level | 0) - 1));
  const scale = Math.max(20, baseXp | 0) / 100;
  return Math.round(CUMULATIVE_HERO_XP_THRESHOLDS[idx] * scale);
}

export function getNextCumulativeXpForLevel(level, baseXp = 100) {
  const lvl = Math.max(1, Math.min(10, level | 0));
  if (lvl >= 10) return getCumulativeXpForLevel(10, baseXp);
  return getCumulativeXpForLevel(lvl + 1, baseXp);
}

function safeFaceTarget(ent, targetXFx, targetZFx) {
  if (!ent) return;
  const dx = (targetXFx - ent.x) | 0;
  const dz = (targetZFx - ent.z) | 0;
  if (Math.abs(dx) + Math.abs(dz) > 64) {
    ent.dir = fxAtan2(dz, dx) & ANGLE_MASK;
  }
}

export class HeroSystem {
  constructor(config = {}) {
    this.heroesData = config?.heroesData
      ? JSON.parse(JSON.stringify(config.heroesData))
      : JSON.parse(JSON.stringify(defaultHeroesJson));

    // Track fallen heroes per team so revive cost/time scales with their achieved level
    this.fallenHeroesByTeam = {};
    for (let t = 1; t <= 8; t++) this.fallenHeroesByTeam[t] = new Map();
    this._processedDeadEntityIds = new Set();
    // Active spell deliveries (fireball flight, ranged arrows/bolts, chain lightning sequential bounces)
    this.activeSpellDeliveries = [];
    this.placedBanners = [];
  }

  /**
   * Synchronizes updated Heroes JSON configuration and immediately updates any living Heroes on the battlefield!
   */
  syncHeroesConfig(newHeroesData, gameState = null) {
    if (!newHeroesData || typeof newHeroesData !== 'object' || !newHeroesData.heroes) return;
    this.heroesData = JSON.parse(JSON.stringify(newHeroesData));

    if (!gameState || !gameState.companies) return;
    for (const comp of gameState.companies.values()) {
      if (!comp || !comp.isHero) continue;
      const heroDef = this.getHeroDef(comp.heroId);
      const ent = gameState.entities.get(comp.memberIds[0]);
      if (!heroDef || !ent || ent.hp <= 0) continue;

      const p = heroDef.parameters || {};
      comp.name = heroDef.displayName || heroDef.name || comp.name;
      comp.heroClass = heroDef.heroClass || comp.heroClass || 'warrior';
      comp.hasSecondaryLoadout = heroHasSecondaryLoadout(heroDef);

      const isRangedNow = comp.activeWeaponMode === 'ranged';
      const visionRange = Math.max(30, Number(p.visionRange) || (isRangedNow ? 120 : 96));
      const rawRange = Number(p.range) || (isRangedNow ? 28.0 : 2.6);
      const visionBonusRange = Math.max(0, (visionRange - 90) * 0.45);
      const meleeRangeMeters = isRangedNow
        ? Number(p.meleeRange || 2.5)
        : Math.min(4.5, Math.max(2.2, rawRange > 10 ? 2.6 : rawRange));
      const rangedRangeMeters = isRangedNow
        ? Math.max(14.0, rawRange + visionBonusRange)
        : Math.max(14.0, Number(p.rangedRange || 26.0) + visionBonusRange);
      const effRangeMeters = isRangedNow ? rangedRangeMeters : meleeRangeMeters;
      const attackRangeFx = Math.round(effRangeMeters * FX_ONE) | 0;
      const atkSpeed = Math.max(0.25, Number(p.attackSpeed) || 1.2);
      const reloadTicks = Math.max(6, Math.round(TICKS_PER_SEC / atkSpeed));
      const accuracy = Math.max(10, Math.min(100, Number(p.accuracy ?? (comp.heroClass === 'archer' ? 90 : 88))));

      comp.heroBaseStats = {
        ...(comp.heroBaseStats || {}),
        maxHp: Math.max(50, (p.maxHp | 0) || 680),
        hpRegenPerSec: Number(p.hpRegenPerSec ?? 4),
        attackDamage: Math.max(1, (p.attackDamage | 0) || 48),
        attackSpeed: atkSpeed,
        moveSpeed: Math.max(1.5, Number(p.moveSpeed) || 4.4),
        runSpeed: Math.max(2.0, Number(p.runSpeed) || Number(p.moveSpeed || 4.4) * 1.45),
        visionRange,
        accuracy,
        rangeMeters: effRangeMeters,
        meleeRangeMeters,
        rangedRangeMeters,
        isRanged: isRangedNow,
        attackRangeFx,
        reloadTicks,
        armor: (p.armor | 0) ?? 15,
        weight: Number(p.weight) || 2.4,
        hpPerLevel: Number(p.hpPerLevel ?? 45),
        damagePerLevel: Number(p.damagePerLevel ?? 6),
        armorPerLevel: Number(p.armorPerLevel ?? 2),
        attackSpeedPctPerLevel: Number(p.attackSpeedPctPerLevel ?? 4),
        moveSpeedPctPerLevel: Number(p.moveSpeedPctPerLevel ?? 2)
      };

      ent.accuracy = accuracy;
      this._syncHeroSpellsToWeaponMode(comp);
      this._recomputeHeroPassiveAndLevelStats(comp, ent, false);
    }
  }

  getHeroDef(heroId) {
    return this.heroesData?.heroes?.[heroId] || defaultHeroesJson.heroes?.[heroId] || null;
  }

  getHeroVisualOrder() {
    return Object.keys(this.heroesData?.heroes || defaultHeroesJson.heroes || {});
  }

  getHeroVisualIndex(heroId) {
    const order = this.getHeroVisualOrder();
    const idx = order.indexOf(heroId);
    return idx >= 0 ? idx & 0x07 : 0;
  }

  findSpellDef(rawSpellId) {
    return lookupSpellInCatalog(this.heroesData, rawSpellId);
  }

  /**
   * Computes recruitment or revive cost & train ticks for a Hero on `team`.
   */
  getHeroRecruitmentOption(heroId, team = 1) {
    const h = this.getHeroDef(heroId);
    if (!h) return null;
    const p = h.parameters || {};
    const fallen = this.fallenHeroesByTeam[team]?.get(heroId) || null;

    if (fallen) {
      const lvl = Math.max(1, fallen.level | 0);
      const revCoins =
        ((p.reviveBaseCostCoins ?? 250) | 0) +
        Math.max(0, lvl - 1) * ((p.reviveCostPerLevelCoins ?? 50) | 0);
      const revSec =
        ((p.reviveBaseTimeSec ?? 8) | 0) +
        Math.max(0, lvl - 1) * ((p.reviveTimePerLevelSec ?? 2) | 0);
      return {
        id: `hero:${heroId}`,
        heroId,
        name: `Revive ${h.displayName || h.name} (Lv.${lvl})`,
        kind: 'hero',
        unitType: 'hero',
        cost: { coins: revCoins, wood: 0, stone: 0, iron: 0 },
        trainTicks: Math.max(40, revSec * TICKS_PER_SEC),
        xpReward: 50,
        isRevive: true,
        reviveLevel: lvl
      };
    }

    const c = p.cost || { coins: 400, wood: 80, stone: 0, iron: 60 };
    const trainSec = Math.max(1, Number(p.trainTimeSec ?? 10));
    return {
      id: `hero:${heroId}`,
      heroId,
      name: h.displayName || h.name || heroId,
      kind: 'hero',
      unitType: 'hero',
      cost: {
        coins: Math.max(0, Number(c.coins ?? 400) | 0),
        wood: Math.max(0, Number(c.wood ?? 80) | 0),
        stone: Math.max(0, Number(c.stone ?? 0) | 0),
        iron: Math.max(0, Number(c.iron ?? 60) | 0)
      },
      trainTicks: Math.round(trainSec * TICKS_PER_SEC),
      xpReward: 65,
      isRevive: false,
      reviveLevel: 1
    };
  }

  isHeroActiveOrQueued(gameState, team, heroId) {
    const tid = team | 0;
    for (const comp of gameState.companies.values()) {
      if (comp && comp.team === tid && comp.isHero && comp.heroId === heroId) {
        for (let i = 0; i < comp.memberIds.length; i++) {
          const ent = gameState.entities.get(comp.memberIds[i]);
          if (ent && ent.hp > 0) return { active: true, queued: false };
        }
      }
    }
    if (gameState.entities) {
      for (const ent of gameState.entities.values()) {
        if (ent && ent.team === tid && ent.hp > 0 && ent.isHero && ent.heroId === heroId) {
          return { active: true, queued: false };
        }
      }
    }
    const blds = gameState.constructionSystem?.buildings;
    if (blds) {
      for (const b of blds.values()) {
        if (!b || b.team !== tid || b.isDestroyed || b.hp <= 0) continue;
        if (
          Array.isArray(b.productionQueue) &&
          b.productionQueue.some((q) => q.heroId === heroId || q.optionId === `hero:${heroId}`)
        ) {
          return { active: false, queued: true };
        }
      }
    }
    return { active: false, queued: false };
  }

  _resolveLoadoutWeaponMode(heroDef, loadoutIdx = 0) {
    if (!heroDef) return 'melee';
    if (loadoutIdx === 1) {
      const secondKey = Object.keys(heroDef.loadouts || {}).find((k) => k !== 'main');
      const eq2 = secondKey ? heroDef.loadouts[secondKey]?.equipment : null;
      if (eq2) return getEquipmentWeaponMode(eq2);
    }
    return getEquipmentWeaponMode(heroDef.equipment);
  }

  /**
   * Synchronizes all unlocked spells on `comp.heroSpells` to the Hero's current weapon stance (`comp.activeWeaponMode`),
   * swapping ranged/melee variant names, icons, ranges, targetModes, rank stats, and setting `disabledByWeapon` for stance-restricted spells.
   */
  _initHeroSpellsFromSchedule(comp) {
    if (!comp || !Array.isArray(comp.heroSpellSchedule)) return;
    comp.heroSpells = [];
    for (let lvIdx = 0; lvIdx < comp.heroSpellSchedule.length; lvIdx++) {
      const slot = comp.heroSpellSchedule[lvIdx];
      const normSpellId = normalizeSpellId(slot?.spellId);
      if (!slot || slot.type === 'skip' || !normSpellId) continue;
      const spellDef = this.findSpellDef(normSpellId);
      if (!spellDef) continue;
      const existing = comp.heroSpells.find((s) => s.spellId === spellDef.id);
      if (!existing && comp.heroSpells.length < 5) {
        const rankStats = spellDef.ranks?.[0] || {};
        comp.heroSpells.push({
          slotIndex: comp.heroSpells.length,
          spellId: spellDef.id,
          name: spellDef.name,
          nameEn: spellDef.nameEn || spellDef.name,
          type: spellDef.type || 'active',
          targetMode: spellDef.targetMode || 'self',
          targetShape: spellDef.targetShape || 'circle',
          lineWidthMeters: spellDef.lineWidthMeters || 5.5,
          vfxStyle: spellDef.vfxStyle || 'shockwave_ring',
          rangeMeters: spellDef.rangeMeters || 0,
          radiusMeters: spellDef.radiusMeters || 0,
          maxKnockbackWeight: spellDef.maxKnockbackWeight ?? 4.5,
          requiredWeaponMode: spellDef.requiredWeaponMode || null,
          disabledByWeapon: false,
          unlocked: false,
          unlockAtHeroLevel: lvIdx + 1,
          level: 0,
          maxLevel: spellDef.maxLevel || 3,
          cooldownTicks: 0,
          maxCooldownTicks: Math.round(
            ((rankStats.cooldownSec ?? spellDef.cooldownSec ?? 12) * TICKS_PER_SEC) | 0
          ),
          icon: spellDef.icon || spellDef.id,
          description: spellDef.description || '',
          stats: { ...rankStats }
        });
      }
    }
  }

  _syncHeroSpellsToWeaponMode(comp) {
    if (!comp || !Array.isArray(comp.heroSpells)) return;
    const mode = comp.activeWeaponMode || 'melee';

    for (let i = 0; i < comp.heroSpells.length; i++) {
      const sp = comp.heroSpells[i];
      const spellDef = this.findSpellDef(sp.spellId);
      if (!spellDef) continue;

      const variant = spellDef.weaponVariants?.[mode] || null;
      const effRankIdx = Math.max(0, (sp.level || 1) - 1);
      const rankStats =
        spellDef.ranks?.[effRankIdx] ||
        spellDef.ranks?.[spellDef.ranks.length - 1] ||
        {};
      sp.name = variant?.name || spellDef.name;
      sp.nameEn = variant?.nameEn || spellDef.nameEn || spellDef.name;
      sp.icon = variant?.icon || spellDef.icon || spellDef.id;
      sp.targetMode = variant?.targetMode || spellDef.targetMode || 'self';
      sp.targetShape = variant?.targetShape || spellDef.targetShape || 'circle';
      sp.lineWidthMeters = variant?.lineWidthMeters || spellDef.lineWidthMeters || 5.5;
      sp.vfxStyle = variant?.vfxStyle || spellDef.vfxStyle || 'shockwave_ring';
      sp.rangeMeters = variant?.rangeMeters ?? spellDef.rangeMeters ?? 0;
      let computedRadius = variant?.radiusMeters ?? rankStats.radiusMeters ?? spellDef.radiusMeters ?? 0;
      if (sp.spellId === "summon_royal_guard") {
        const totalSq =
          (Number(rankStats.swordsmanSquads) || 0) +
          (Number(rankStats.spearmanSquads) || 0) +
          (Number(rankStats.archerSquads) || 0) +
          (Number(rankStats.cavalrySquads) || 0);
        if (totalSq > 0) {
          computedRadius = totalSq <= 2 ? 9.5 : totalSq <= 4 ? 13.5 : totalSq === 5 ? 15.5 : 19.5;
        }
      }
      sp.radiusMeters = computedRadius;
      sp.castTimeSec = Number(spellDef.castTimeSec) || 0.85;
      sp.maxKnockbackWeight = spellDef.maxKnockbackWeight ?? 4.5;
      sp.description = variant?.description || spellDef.description || '';
      sp.requiredWeaponMode = spellDef.requiredWeaponMode || null;
      sp.disabledByWeapon = Boolean(
        spellDef.requiredWeaponMode && spellDef.requiredWeaponMode !== mode
      );
      sp.stats = { ...rankStats };
      sp.maxCooldownTicks = Math.round(
        ((rankStats.cooldownSec ?? spellDef.cooldownSec ?? 12) * TICKS_PER_SEC) | 0
      );
    }
  }

  /**
   * Toggles a Hero between Gear Set 1 (`activeLoadoutIdx = 0`) and Gear Set 2 (`activeLoadoutIdx = 1`),
   * updating combat range, ranged/melee attack behavior, 3D visual loadout, and stance-adaptive spells!
   */
  switchHeroWeapon(gameState, companyId, team = 1) {
    const comp = gameState.companies.get(companyId | 0);
    if (!comp || !comp.isHero || comp.team !== (team | 0) || !comp.hasSecondaryLoadout) {
      return false;
    }
    const ent = gameState.entities.get(comp.memberIds[0]);
    if (!ent || ent.hp <= 0) return false;

    const heroDef = this.getHeroDef(comp.heroId);
    const nextIdx = comp.activeLoadoutIdx === 1 ? 0 : 1;
    const nextMode = this._resolveLoadoutWeaponMode(heroDef, nextIdx);

    comp.activeLoadoutIdx = nextIdx;
    comp.activeWeaponMode = nextMode;
    comp.pendingSpellCast = null;

    const isRangedNow = nextMode === 'ranged';
    const base = comp.heroBaseStats || {};
    const visionRange = Number(base.visionRange) || (isRangedNow ? 120 : 96);
    const visionBonusRange = Math.max(0, (visionRange - 90) * 0.45);
    const effRangeMeters = isRangedNow
      ? Math.max(18.0, (Number(base.rangedRangeMeters) || 26.0) + visionBonusRange * 0.25)
      : Math.min(4.5, Math.max(2.2, Number(base.meleeRangeMeters) || 2.6));
    const effRangeFx = Math.round(effRangeMeters * FX_ONE) | 0;

    ent.isRanged = isRangedNow;
    ent.attackRangeFx = effRangeFx;
    ent.meleeAttackRangeFx = isRangedNow ? 2200 : effRangeFx;
    ent.ammo = isRangedNow ? 9999 : 0;
    ent.windupTicks = 0;
    ent.shotWindupTicks = 0;

    this._syncHeroSpellsToWeaponMode(comp);
    this._recomputeHeroPassiveAndLevelStats(comp, ent, false);

    if (gameState.pendingEvents) {
      gameState.pendingEvents.push({
        tick: gameState.tick,
        kind: 'HERO_SPELL_CAST',
        spellId: 'switch_weapon',
        vfxStyle: 'shockwave_ring',
        companyId: comp.id,
        heroEntityId: ent.id,
        fromXFx: ent.x,
        fromYFx: (ent.y + FX_ONE) | 0,
        fromZFx: ent.z,
        xFx: ent.x,
        yFx: (ent.y + FX_ONE) | 0,
        zFx: ent.z,
        label: isRangedNow ? `${comp.name}: Bow Stance 🏹` : `${comp.name}: Melee Stance ⚔️`
      });
    }
    return true;
  }

  /**
   * Spawns a recruited Hero from the Main Base (`citadel`) when production completes.
   */
  spawnHeroFromBuilding(gameState, building, item, UnitTypeIndex, AnimState) {
    const heroId = item.heroId || String(item.optionId || '').replace(/^hero:/, '') || 'wizard';
    const heroDef = this.getHeroDef(heroId) || this.getHeroDef('wizard');
    if (!heroDef) return null;

    const cs = gameState.constructionSystem;
    const p = heroDef.parameters || {};
    const doorRadiusMeters = (Number(building.footprintRadiusMeters) || 5) * (building.type === 'watchtower' ? 0.68 : 0.78);
    const doorVec = cs._getBuildingDoorVectorFx(building, doorRadiusMeters);
    building.doorOpenTicks = Math.max(building.doorOpenTicks | 0, 18);
    const musterVec = cs._getBuildingDoorVectorFx(building, building.footprintRadiusMeters + 10.5);

    const doorXFx = (building.xFx + doorVec.dxFx) | 0;
    const doorZFx = (building.zFx + doorVec.dzFx) | 0;
    const doorYFx = cs.navGrid.sampleHeightAtWorldFx(doorXFx, doorZFx);

    const rawMusterX = (building.xFx + musterVec.dxFx) | 0;
    const rawMusterZ = (building.zFx + musterVec.dzFx) | 0;
    const walkable = cs.navGrid.findNearestWalkableTile(
      cs.navGrid.worldFxToTileX(rawMusterX),
      cs.navGrid.worldFxToTileZ(rawMusterZ),
      16
    );
    const musterXFx = cs.navGrid.tileToWorldCenterFxX(walkable.tx);
    const musterZFx = cs.navGrid.tileToWorldCenterFxZ(walkable.tz);

    const moveSpeedMps = Math.max(1.5, Number(p.moveSpeed) || 4.4);
    const runSpeedMps = Math.max(moveSpeedMps * 1.15, Number(p.runSpeed) || moveSpeedMps * 1.45);
    const speedFx = Math.max(100, Math.round((toFx(moveSpeedMps) / TICKS_PER_SEC) | 0));
    const baseMaxHp = Math.max(50, (p.maxHp | 0) || 680);
    const baseDamage = Math.max(1, (p.attackDamage | 0) || 48);

    const initialWeaponMode = this._resolveLoadoutWeaponMode(heroDef, 0);
    const isRangedHero = initialWeaponMode === 'ranged';
    const visionRange = Math.max(30, Number(p.visionRange) || (isRangedHero ? 120 : 96));
    const visionBonusRange = Math.max(0, (visionRange - 90) * 0.45);
    const rawRange = Number(p.range) || (isRangedHero ? 28.0 : 2.6);
    const meleeRangeMeters = isRangedHero
      ? Number(p.meleeRange || 2.5)
      : Math.min(4.5, Math.max(2.2, rawRange > 10 ? 2.6 : rawRange));
    const rangedRangeMeters = isRangedHero
      ? Math.max(14.0, rawRange + visionBonusRange)
      : Math.max(14.0, Number(p.rangedRange || 26.0) + visionBonusRange);
    const rangeMeters = isRangedHero ? rangedRangeMeters : meleeRangeMeters;
    const attackRangeFx = Math.round(rangeMeters * FX_ONE) | 0;
    const atkSpeed = Math.max(0.25, Number(p.attackSpeed) || 1.2);
    const reloadTicks = Math.max(6, Math.round(TICKS_PER_SEC / atkSpeed));
    const accuracy = Math.max(
      10,
      Math.min(100, Number(p.accuracy ?? (heroDef.heroClass === 'archer' ? 90 : 88)))
    );

    const nextCompId = typeof gameState.allocateCompanyId === 'function' ? gameState.allocateCompanyId() : gameState.companies.size;

    const unitTypeIdx = UnitTypeIndex.hero ?? 5;
    const company = new Company({
      id: nextCompId,
      name: heroDef.displayName || heroDef.name || 'Hero',
      team: building.team,
      unitType: 'hero',
      unitTypeIdx,
      spawnXFx: musterXFx,
      spawnZFx: musterZFx,
      facingDir: doorVec.dir,
      speedFx,
      formation: resolveDefaultFormation('swordsman'),
      maxMemberCount: 1
    });

    company.isHero = true;
    company.heroId = heroDef.id;
    if (heroDef.id === "sisnat") {
      company.isCavalry = true;
      company.isMountedHero = true;
    }
    company.heroClass = heroDef.heroClass || 'wizard';
    company.hasSecondaryLoadout = heroHasSecondaryLoadout(heroDef);
    company.activeLoadoutIdx = 0;
    company.activeWeaponMode = initialWeaponMode;
    company.pendingSpellCast = null;
    company.heroLevel = 0;
    company.heroXp = 0;
    company.heroXpBase = Math.max(40, (p.xpPerLevelBase | 0) || 100);
    company.heroXpFloor = 0;
    company.heroXpToNext = getNextCumulativeXpForLevel(1, company.heroXpBase);
    company.heroSpells = [];
    company.heroSpellSchedule = Array.isArray(heroDef.spellSchedule)
      ? JSON.parse(JSON.stringify(heroDef.spellSchedule))
      : [];
    this._initHeroSpellsFromSchedule(company);
    company.heroBaseStats = {
      maxHp: baseMaxHp,
      hpRegenPerSec: Number(p.hpRegenPerSec) || 4,
      attackDamage: baseDamage,
      attackSpeed: atkSpeed,
      moveSpeed: moveSpeedMps,
      runSpeed: runSpeedMps,
      visionRange,
      accuracy,
      rangeMeters,
      meleeRangeMeters,
      rangedRangeMeters,
      isRanged: isRangedHero,
      attackRangeFx,
      reloadTicks,
      armor: (p.armor | 0) ?? 15,
      weight: Number(p.weight) || 2.4,
      hpPerLevel: Number(p.hpPerLevel ?? 45),
      damagePerLevel: Number(p.damagePerLevel ?? 6),
      armorPerLevel: Number(p.armorPerLevel ?? 2),
      attackSpeedPctPerLevel: Number(p.attackSpeedPctPerLevel ?? 4),
      moveSpeedPctPerLevel: Number(p.moveSpeedPctPerLevel ?? 2)
    };
    company.heroPassiveBonuses = {
      armorBonus: 0,
      maxHpBonus: 0,
      cooldownReductionPct: 0,
      attackDamageBonus: 0,
      allyDamageBonusPct: 0,
      allyHpRegen: 0,
      auraRadiusMeters: 20
    };
    company.heroActiveBuffs = {
      warCryTicks: 0,
      warCryDmgPct: 0,
      berserkTicks: 0,
      berserkDmgPct: 0,
      berserkAtkSpdPct: 0,
      berserkMoveSpdPct: 0,
      arcaneShieldTicks: 0,
      arcaneShieldArmor: 0,
      immortalTicks: 0
    };

    const entId = gameState.nextEntityId++;
    const visualIdx = this.getHeroVisualIndex(heroDef.id);
    const ent = {
      id: entId,
      squadIndex: nextCompId,
      unitTypeIdx,
      team: building.team,
      role: 0,
      carryType: visualIdx,
      isHero: true,
      heroId: heroDef.id,
      isMountedHero: heroDef.id === "sisnat",
      isRanged: isRangedHero,
      accuracy,
      visionRangeMeters: Math.round(visionRange),
      isGarrisoned: false,
      isBuffed: false,
      isHealing: false,
      isRouting: false,
      isFlying: false,
      altitudeFx: 0,
      x: doorXFx,
      y: doorYFx,
      z: doorZFx,
      doorExitBuildingId: building.id,
      doorExitTicks: 18,
      targetX: musterXFx,
      targetZ: musterZFx,
      slotTargetXFx: musterXFx,
      slotTargetZFx: musterZFx,
      slotIndex: 0,
      isFrontRow: true,
      isMoving: true,
      flowFieldKey: null,
      pathWaypoints: null,
      pathIndex: 0,
      dir: doorVec.dir,
      desiredFacingDir: doorVec.dir,
      speedFx,
      hp: baseMaxHp,
      maxHp: baseMaxHp,
      damage: baseDamage,
      meleeDamage: baseDamage,
      attackRangeFx,
      meleeAttackRangeFx: isRangedHero ? 2200 : attackRangeFx,
      reloadMinTicks: reloadTicks,
      reloadMaxTicks: reloadTicks + 4,
      armor: (p.armor | 0) ?? 15,
      mass: Math.round((Number(p.weight) || 2.4) * 100),
      ammo: isRangedHero ? 9999 : 0,
      maxAmmo: 0,
      animState: AnimState.WALK,
      actionCooldown: 0,
      windupTicks: 0,
      shotWindupTicks: 0,
      nextShotTicks: 0,
      windupTargetId: -1,
      windupWillBeBlocked: false,
      blockVisualTicks: 0,
      knockdownTicks: 0,
      burningTicks: 0,
      poisonTicks: 0,
      poisonDmgPerSec: 0,
      slowTicks: 0,
      reservedTargetId: -1,
      reservedSlotIdx: -1,
      inCombatStandby: false,
      ticksSinceLastHit: 999,
      waitTicks: 0,
      deadTicks: 0,
      activeSpellSlotIdx: 0,
      activeSpellTimerTicks: 0
    };

    gameState.entities.set(entId, ent);
    company.memberIds.push(entId);
    company.lastKnownAliveCount = 1;
    gameState.sortedEntityIds.push(entId);
    gameState.companies.set(nextCompId, company);

    const targetStartLevel = Math.max(1, Math.min(10, (item.reviveLevel | 0) || 1));
    this.fallenHeroesByTeam[building.team]?.delete(heroDef.id);

    for (let lv = 1; lv <= targetStartLevel; lv++) {
      this.advanceHeroToLevel(gameState, company, ent, lv, lv > 1);
    }

    cs.productionSystem?.executeSmartRallyActionForCompany?.(gameState, building, company);

    gameState.pendingEvents.push({
      tick: gameState.tick,
      kind: 'HERO_SPAWNED',
      heroId: heroDef.id,
      companyId: company.id,
      xFx: doorXFx,
      yFx: (doorYFx + 2 * FX_ONE) | 0,
      zFx: doorZFx,
      label: `${company.name} Entered the Battlefield!`
    });

    return company;
  }

  /**
   * Advances a Hero to `newLevel` (1..10) with cumulative XP (`comp.heroXp` never resets to 0).
   */
  advanceHeroToLevel(gameState, comp, ent, newLevel, emitEvent = true) {
    if (!comp || !comp.isHero || newLevel < 1 || newLevel > 10) return;
    comp.heroLevel = newLevel | 0;
    const floorXp = getCumulativeXpForLevel(newLevel, comp.heroXpBase || 100);
    const nextXp = getNextCumulativeXpForLevel(newLevel, comp.heroXpBase || 100);
    comp.heroXpFloor = floorXp;
    comp.heroXpToNext = nextXp;
    if ((comp.heroXp | 0) < floorXp) {
      comp.heroXp = floorXp;
    }

    const slot = comp.heroSpellSchedule?.[newLevel - 1] || null;
    const normSpellId = normalizeSpellId(slot?.spellId);
    if (slot && slot.type !== 'skip' && normSpellId) {
      const spellDef = this.findSpellDef(normSpellId);
      if (spellDef) {
        const existing = comp.heroSpells.find((s) => s.spellId === spellDef.id);
        if (existing) {
          const maxLv = spellDef.maxLevel || 3;
          existing.level = Math.min(maxLv, (existing.level | 0) + 1);
          existing.unlocked = existing.level > 0;
          const rankStats =
            spellDef.ranks?.[existing.level - 1] ||
            spellDef.ranks?.[spellDef.ranks.length - 1] ||
            {};
          existing.stats = { ...rankStats };
          existing.maxCooldownTicks = Math.round(
            ((rankStats.cooldownSec ?? spellDef.cooldownSec ?? 12) * TICKS_PER_SEC) | 0
          );
        } else if (comp.heroSpells.length < 5) {
          const rankStats = spellDef.ranks?.[0] || {};
          comp.heroSpells.push({
            slotIndex: comp.heroSpells.length,
            spellId: spellDef.id,
            name: spellDef.name,
            nameEn: spellDef.nameEn || spellDef.name,
            type: spellDef.type || 'active',
            targetMode: spellDef.targetMode || 'self',
            targetShape: spellDef.targetShape || 'circle',
            lineWidthMeters: spellDef.lineWidthMeters || 5.5,
            vfxStyle: spellDef.vfxStyle || 'shockwave_ring',
            rangeMeters: spellDef.rangeMeters || 0,
            radiusMeters: spellDef.radiusMeters || 0,
            maxKnockbackWeight: spellDef.maxKnockbackWeight ?? 4.5,
            requiredWeaponMode: spellDef.requiredWeaponMode || null,
            disabledByWeapon: false,
            level: 1,
            maxLevel: spellDef.maxLevel || 3,
            cooldownTicks: 0,
            maxCooldownTicks: Math.round(
              ((rankStats.cooldownSec ?? spellDef.cooldownSec ?? 12) * TICKS_PER_SEC) | 0
            ),
            icon: spellDef.icon || spellDef.id,
            description: spellDef.description || '',
            stats: { ...rankStats }
          });
        }
      }
    }

    this._syncHeroSpellsToWeaponMode(comp);
    this._recomputeHeroPassiveAndLevelStats(comp, ent, newLevel > 1);

    if (emitEvent && ent && gameState?.pendingEvents) {
      gameState.pendingEvents.push({
        tick: gameState.tick,
        kind: 'HERO_LEVEL_UP',
        companyId: comp.id,
        heroId: comp.heroId,
        level: comp.heroLevel,
        xFx: ent.x,
        yFx: (ent.y + 3 * FX_ONE) | 0,
        zFx: ent.z,
        label: `${comp.name} Reached Level ${comp.heroLevel}!`
      });
    }
  }

  _recomputeHeroPassiveAndLevelStats(comp, ent, healLevelBonus = false) {
    if (!comp || !ent) return;
    const base = comp.heroBaseStats || {};
    const passives = {
      armorBonus: 0,
      maxHpBonus: 0,
      cooldownReductionPct: 0,
      attackDamageBonus: 0,
      allyDamageBonusPct: 0,
      allyHpRegen: 0,
      auraRadiusMeters: 22
    };

    for (let i = 0; i < comp.heroSpells.length; i++) {
      const sp = comp.heroSpells[i];
      if (!sp || (sp.level | 0) <= 0) continue;
      const st = sp.stats || {};
      if (sp.spellId === 'iron_blood' || sp.spellId === 'iron_skin') {
        passives.armorBonus += st.armorBonus || 16;
        passives.maxHpBonus += st.maxHpBonus || 160;
        passives.attackDamageBonus += st.attackDamageBonus || 10;
      } else if (sp.spellId === 'mana_flow') {
        passives.cooldownReductionPct = Math.min(60, passives.cooldownReductionPct + (st.cooldownReductionPct || 18));
        passives.attackDamageBonus += st.attackDamageBonus || 14;
      } else if (sp.spellId === 'aura_of_valor') {
        passives.allyDamageBonusPct = Math.max(passives.allyDamageBonusPct, st.allyDamageBonusPct || 16);
        passives.allyArmorBonus = Math.max(passives.allyArmorBonus || 0, st.allyArmorBonus || 8);
        passives.allyHpRegen = Math.max(passives.allyHpRegen, st.allyHpRegen || 3);
        passives.auraRadiusMeters = Math.max(passives.auraRadiusMeters, st.radiusMeters || 18);
      }
    }

    comp.heroPassiveBonuses = passives;

    const levelsGained = Math.max(0, (comp.heroLevel | 0) - 1);
    const lvlBonusHp = Math.round(levelsGained * (Number(base.hpPerLevel) || 45));
    const lvlBonusDmg = Math.round(levelsGained * (Number(base.damagePerLevel) || 6));
    const lvlBonusArmor = Math.round(levelsGained * (Number(base.armorPerLevel) || 2));
    const lvlBonusAtkSpdPermille = Math.round(levelsGained * (Number(base.attackSpeedPctPerLevel) || 4) * 10);
    const lvlBonusMoveSpdPermille = Math.round(levelsGained * (Number(base.moveSpeedPctPerLevel) || 2) * 10);

    const newMaxHp = Math.max(50, ((base.maxHp | 0) || 680) + lvlBonusHp + passives.maxHpBonus);
    const hpDiff = Math.max(0, newMaxHp - (ent.maxHp | 0));
    ent.maxHp = newMaxHp;
    if (healLevelBonus && ent.hp > 0) {
      ent.hp = Math.min(ent.maxHp, ((ent.hp | 0) + hpDiff + 45) | 0);
    } else if (ent.hp > ent.maxHp) {
      ent.hp = ent.maxHp;
    }

    const buffs = comp.heroActiveBuffs || {};
    let dmgMultPermille = 1000;
    if ((buffs.warCryTicks | 0) > 0) dmgMultPermille += (buffs.warCryDmgPct || 25) * 10;
    if ((buffs.berserkTicks | 0) > 0) dmgMultPermille += (buffs.berserkDmgPct || 45) * 10;
    if ((buffs.azureFuryTicks | 0) > 0) dmgMultPermille += (buffs.azureFuryDmgPct || 38) * 10;
    if ((buffs.bloodlustTicks | 0) > 0 && (buffs.bloodlustStacks | 0) > 0) {
      dmgMultPermille += (buffs.bloodlustStacks | 0) * (buffs.bloodlustDmgPctPerKill || 12) * 10;
    }

    const rawDmg = ((base.attackDamage | 0) || 48) + lvlBonusDmg + passives.attackDamageBonus;
    ent.damage = Math.max(1, mulDiv(rawDmg, dmgMultPermille, 1000));
    ent.meleeDamage = ent.damage;

    let effArmor = ((base.armor | 0) ?? 15) + lvlBonusArmor + passives.armorBonus;
    if ((buffs.arcaneShieldTicks | 0) > 0) {
      effArmor += buffs.arcaneShieldArmor || 35;
    }
    if (comp.isWarhorseMounted) {
      effArmor += comp.warhorseArmorBonus || 12;
    }
    ent.armor = Math.max(0, Math.min(85, effArmor));

    let speedMultPermille = 1000 + lvlBonusMoveSpdPermille;
    let atkSpdMultPermille = 1000 + lvlBonusAtkSpdPermille;
    if ((buffs.berserkTicks | 0) > 0) {
      speedMultPermille += (buffs.berserkMoveSpdPct || 35) * 10;
      atkSpdMultPermille += (buffs.berserkAtkSpdPct || 40) * 10;
    }
    if ((buffs.azureFuryTicks | 0) > 0) {
      speedMultPermille += (buffs.azureFuryMoveSpdPct || 28) * 10;
      atkSpdMultPermille += (buffs.azureFuryAtkSpdPct || 45) * 10;
    }
    if ((buffs.bloodlustTicks | 0) > 0 && (buffs.bloodlustStacks | 0) > 0) {
      atkSpdMultPermille += (buffs.bloodlustStacks | 0) * (buffs.bloodlustAtkSpdPctPerKill || 10) * 10;
    }
    if (comp.isWarhorseMounted) {
      speedMultPermille += (comp.warhorseMoveSpdPct || 40) * 10;
    }

    const walkMps = Math.max(1.5, Number(base.moveSpeed) || 4.4);
    const runMps = Math.max(walkMps * 1.15, Number(base.runSpeed) || walkMps * 1.45);
    comp.runSpeedMultPermille = Math.max(1150, Math.round((runMps / walkMps) * 1000));
    const baseSpeedFx = Math.max(100, Math.round((toFx(walkMps) / TICKS_PER_SEC) | 0));
    ent.speedFx = mulDiv(baseSpeedFx, speedMultPermille, 1000);
    comp.speedFx = ent.speedFx;

    const visionRange = Math.max(30, Number(base.visionRange) || (ent.isRanged ? 120 : 96));
    ent.visionRangeMeters = Math.round(visionRange + levelsGained * 2);
    ent.accuracy = Math.max(10, Math.min(100, Number(base.accuracy ?? 88)));

    const isRangedNow = comp.activeWeaponMode === 'ranged';
    const visionBonusRange = Math.max(0, (ent.visionRangeMeters - 90) * 0.45);
    const effRangeMeters = isRangedNow
      ? Math.max(14.0, (Number(base.rangedRangeMeters) || 26.0) + visionBonusRange * 0.25)
      : Math.min(4.5, Math.max(2.2, Number(base.meleeRangeMeters) || 2.6));
    const effRangeFx = Math.round(effRangeMeters * FX_ONE) | 0;
    ent.attackRangeFx = effRangeFx;
    ent.meleeAttackRangeFx = isRangedNow ? 2200 : effRangeFx;

    const baseReload = base.reloadTicks || 16;
    const effReload = Math.max(4, Math.round((baseReload * 1000) / atkSpdMultPermille));
    ent.reloadMinTicks = effReload;
    ent.reloadMaxTicks = effReload + 3;
  }

  /**
   * Grants cumulative XP (`comp.heroXp` increases continuously and never resets on level up).
   */
  grantHeroXp(gameState, comp, ent, xpAmount) {
    if (!comp || !comp.isHero || !ent || ent.hp <= 0) return;
    if (comp.heroLevel >= 10) return;

    comp.heroXp = ((comp.heroXp | 0) + Math.max(1, xpAmount | 0)) | 0;
    while (comp.heroXp >= comp.heroXpToNext && comp.heroLevel < 10) {
      this.advanceHeroToLevel(gameState, comp, ent, comp.heroLevel + 1, true);
    }
    if (comp.heroLevel >= 10) {
      comp.heroXp = comp.heroXpToNext;
    }
  }
}

import { heroSpellCasterMethods } from './heroSpellCaster.js';
import { heroSpellDeliveryMethods } from './heroSpellDeliveries.js';
import { heroRuntimeStepperMethods } from './heroRuntimeStepper.js';
import { heroMountedCombatMethods } from './heroMountedCombat.js';

Object.assign(
  HeroSystem.prototype,
  heroSpellCasterMethods,
  heroSpellDeliveryMethods,
  heroRuntimeStepperMethods,
  heroMountedCombatMethods
);
