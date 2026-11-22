/**
 * Kings Lands — Hall of Heroes Spell Trees DAG & 10-Level Timeline Builder
 * (src/tools/heroes/hallOfHeroesSpellsWorkspace.js)
 */
/**
 * Kings Lands — Phase 8: Hall of Heroes (היכל הגיבורים) — Clean Visual UI + Graph Spell Trees & Hybrid Nodes
 * (src/tools/heroes/hallOfHeroesApp.js)
 *
 * Refined UX:
 * - Left Panel: Clean list of Hero names + `+ Create New Hero` with Base Archetype picker (`Warrior`, `Archer`, `Wizard`).
 * - Center 3D Viewport: Interactive 3D Hero preview, Gear Set 1 / Set 2 preview toggle (when Hero has 2 gear sets),
 *   bottom animation bar (`Idle`, `Walk`, `Attack`, spells) with `Edit` button right beside animations,
 *   and `Spells` button on the right side of the viewport.
 * - Right Panel: Clean parameter inputs + Per-Level stat growth (`+HP/Lv`, `+Damage/Lv`, etc.).
 * - Spells View:
 *   - Minimal top bar with the 10 numbered circles, compact `0/5` spells badge, compact `1 PT` / `2 PT` badge,
 *     and minimal `Skip`, `Undo`, `Clear` buttons.
 *   - 4 Visual Graph-Based Spell Trees (`Self Support`, `Offense`, `Area Support`, `Tactical Magic`) with
 *     branching and converging prerequisite lines (`requires: [a, b]`), plus Cross-Tree Hybrid Bridge Spells
 *     sitting between adjacent trees!
 */

import * as THREE from 'three';
import { ModelFactory } from '../../render/modelFactory.js';
import { spawn3DSpellEffect, inferDefaultVfxStyle } from '../../render/worldEffectsRenderer.js';
import { Animator3D } from '../../render/animator3d.js';
import { applySkinColors, disposeVisual, getFactionColors } from '../studio/skinUtils.js';
import { createPortraitStudio } from '../studio/portraitRenderer.js';
import { resolveClip, getCombatBase, getLocomotionBase } from '../studio/clipResolver.js';
import {
  HeroStateManager,
  buildCombinedVisualsData,
  getHeroSpellClipBases,
  findSpellDef,
  getSpellTreesForClass,
  getOrRenderHeroPortraitUrl,
  heroHasSecondaryLoadout,
  normalizeSpellId
} from './heroStateManager.js';
import { HERO_SPELL_SVG_ICONS } from '../../ui/hud/hudIcons.js';
import defaultUnitsJson from '../../data/visuals/units.json';


export const hallOfHeroesSpellsMethods = {
  // ============================================================================
  // SPELL TREES & 10-LEVEL TIMELINE BUILDER (Visual DAG Skill Trees + Hybrid Nodes)
  // ============================================================================

  _ensureSchedule10(hero) {
    if (!Array.isArray(hero.spellSchedule)) {
      hero.spellSchedule = Array.from({ length: 10 }, () => null);
    }
    while (hero.spellSchedule.length < 10) hero.spellSchedule.push(null);
    if (hero.spellSchedule.length > 10) hero.spellSchedule.length = 10;
    return hero.spellSchedule;
  },

  _computeTimelineState(hero) {
    const schedule = this._ensureSchedule10(hero);
    let nextLevelIdx = 10;
    for (let i = 0; i < 10; i++) {
      if (!schedule[i]) {
        nextLevelIdx = i;
        break;
      }
    }

    let spentPoints = 0;
    const spellRanks = new Map();
    for (let i = 0; i < nextLevelIdx; i++) {
      const slot = schedule[i];
      if (!slot) continue;
      spentPoints += Number(slot.cost) || 0;
      const sid = normalizeSpellId(slot.spellId);
      if (sid && slot.type !== 'skip') {
        slot.spellId = sid;
        spellRanks.set(sid, (spellRanks.get(sid) || 0) + 1);
      }
    }

    const availablePoints = nextLevelIdx < 10 ? Math.max(0, nextLevelIdx + 1 - spentPoints) : 0;

    return {
      schedule,
      nextLevelIdx,
      availablePoints,
      spentPoints,
      spellRanks,
      distinctCount: spellRanks.size
    };
  },

  _arePrerequisitesMet(spellDef, spellRanks, hero) {
    if (!spellDef) return false;
    if (spellDef.onlyForClass && hero?.heroClass !== spellDef.onlyForClass) {
      return false;
    }
    if (spellDef.onlyForHeroId && hero?.id !== spellDef.onlyForHeroId) {
      return false;
    }
    if (Array.isArray(spellDef.requiresAnyOf) && spellDef.requiresAnyOf.length > 0) {
      for (let g = 0; g < spellDef.requiresAnyOf.length; g++) {
        const group = spellDef.requiresAnyOf[g];
        if (Array.isArray(group) && !group.some((sid) => (spellRanks.get(sid) || 0) > 0)) {
          return false;
        }
      }
      return true;
    }
    const reqs = Array.isArray(spellDef.requires) ? spellDef.requires : [];
    if (reqs.length === 0) return true;
    // A child spell in a tree is unlocked once AT LEAST ONE of its incoming parent branch spells is unlocked
    return reqs.some((rid) => (spellRanks.get(rid) || 0) > 0);
  },

  _handleSkipLevel() {
    const hero = this.currentHero;
    if (!hero) return;
    const st = this._computeTimelineState(hero);
    if (st.nextLevelIdx >= 10) {
      this._toast('All 10 circles are filled.');
      return;
    }
    if (st.nextLevelIdx === 9) {
      this._toast('Cannot skip Circle 10.');
      return;
    }

    st.schedule[st.nextLevelIdx] = {
      level: st.nextLevelIdx + 1,
      type: 'skip',
      spellId: null,
      treeId: null,
      cost: 0,
      spellLevel: 0
    };

    this.heroStateManager.scheduleSave();
    this._renderSpellsWorkspace();
  },

  _handleChooseSpell(spellId, treeId) {
    const hero = this.currentHero;
    if (!hero) return;
    const st = this._computeTimelineState(hero);
    if (st.nextLevelIdx >= 10) {
      this._toast('10/10 circles full');
      return;
    }

    const spellDef = findSpellDef(this.heroesData, spellId);
    if (!spellDef) return;

    if (spellDef.onlyForClass && hero.heroClass !== spellDef.onlyForClass) {
      this._toast(`Only available for ${spellDef.onlyForClass.toUpperCase()}`);
      return;
    }

    if (!this._arePrerequisitesMet(spellDef, st.spellRanks, hero)) {
      const reqNames = (spellDef.requires || [])
        .map((rid) => findSpellDef(this.heroesData, rid)?.nameEn || rid)
        .join(' + ');
      this._toast(`Requires: ${reqNames}`);
      return;
    }

    const currentRank = st.spellRanks.get(spellId) || 0;
    const maxRank = spellDef.maxLevel || 3;
    if (currentRank >= maxRank) {
      this._toast('Max rank reached');
      return;
    }

    const isNewUnlock = currentRank === 0;
    if (isNewUnlock && st.distinctCount >= 5) {
      this._toast('5/5 spells reached');
      return;
    }

    const requiredPts = isNewUnlock ? (spellDef.cost || 1) : (spellDef.upgradeCost || 1);
    if (st.availablePoints < requiredPts) {
      this._toast(`Needs ${requiredPts} PT (click Skip first)`);
      return;
    }

    const nextRank = currentRank + 1;
    st.schedule[st.nextLevelIdx] = {
      level: st.nextLevelIdx + 1,
      type: isNewUnlock ? 'unlock' : 'upgrade',
      spellId,
      treeId: treeId || spellDef.treeId,
      cost: requiredPts,
      spellLevel: nextRank
    };

    this.heroStateManager.ensureSpellAnimationSlotsForHero(hero);
    this.heroStateManager.scheduleSave();

    this._renderSpellsWorkspace();
    this._renderAnimButtons();
  },

  _formatRankStatsLine(rankObj) {
    if (!rankObj) return '';
    const parts = [];
    for (const [k, v] of Object.entries(rankObj)) {
      if (k === 'level') continue;
      const cleanK = k
        .replace(/([A-Z])/g, ' $1')
        .replace(/Pct$/, '%')
        .replace(/Sec$/, 's')
        .replace(/Meters$/, 'm')
        .trim();
      parts.push(`${cleanK}: ${v}`);
    }
    return parts.join(' • ');
  },

  _buildSpellTooltipHtml(sp, currentRank) {
    const maxRank = sp.maxLevel || 3;
    const reqs = Array.isArray(sp.requires) ? sp.requires : [];
    const reqText = reqs.length
      ? reqs.map((r) => findSpellDef(this.heroesData, r)?.nameEn || r).join(' + ')
      : '';

    const variantHtml = sp.weaponVariants
      ? `<div class="mb-1.5 rounded-lg border border-amber-400/40 bg-amber-950/30 px-2 py-1 text-[10px] text-amber-200">
          <div>🏹 <b>Bow:</b> ${sp.weaponVariants.ranged?.name}</div>
          <div>⚔️ <b>Melee:</b> ${sp.weaponVariants.melee?.name}</div>
        </div>`
      : sp.requiredWeaponMode
        ? `<div class="mb-1.5 rounded-lg border border-rose-400/40 bg-rose-950/30 px-2 py-0.5 text-[10px] font-bold text-rose-200">
            Requires ${sp.requiredWeaponMode.toUpperCase()} weapon stance
          </div>`
        : '';

    const ranksHtml = (sp.ranks || [])
      .map((r) => {
        const isCur = r.level === currentRank;
        const isNext = r.level === currentRank + 1;
        return `
          <div class="rounded px-2 py-1 text-[10.5px] mono ${
            isCur
              ? 'bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 font-bold'
              : isNext
                ? 'bg-amber-500/15 border border-amber-400/50 text-amber-200'
                : 'bg-slate-900/80 text-slate-400'
          }">
            Lv.${r.level}: ${this._formatRankStatsLine(r)}
          </div>
        `;
      })
      .join('');

    return `
      <div class="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5 mb-1.5">
        <span class="font-extrabold text-amber-300 text-xs">${sp.name}</span>
        <span class="rounded px-1.5 py-0.5 text-[9.5px] font-black uppercase ${
          sp.type === 'passive'
            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
            : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
        }">${sp.type}</span>
      </div>
      <div class="flex flex-wrap items-center gap-1.5 text-[10.5px] mono text-slate-300 mb-1.5">
        <span class="text-amber-300 font-bold">Cost: ${sp.cost || 1} PT</span>
        <span>•</span>
        <span class="text-emerald-300 font-bold">Rank: ${currentRank}/${maxRank}</span>
        ${sp.cooldownSec ? `<span>• CD: ${sp.cooldownSec}s</span>` : ''}
        ${sp.rangeMeters && sp.rangeMeters < 500 ? `<span>• Range: ${sp.rangeMeters}m</span>` : ''}
        ${sp.radiusMeters ? `<span>• Radius: ${sp.radiusMeters}m</span>` : ''}
      </div>
      ${reqText ? `<div class="text-[10px] font-bold text-sky-300 mb-1">Requires: ${reqText}</div>` : ''}
      ${variantHtml}
      <p class="text-[11px] text-slate-300 leading-snug mb-2">${sp.description}</p>
      <div class="flex flex-col gap-1">
        ${ranksHtml}
      </div>
    `;
  },

  _renderSpellsWorkspace() {
    const circlesHost = this.rootContainer?.querySelector('#hh-timeline-circles');
    const treesHost = this.rootContainer?.querySelector('#hh-spell-trees-grid');
    const ptsBadge = this.rootContainer?.querySelector('#hh-spell-points-badge');
    const distinctBadge = this.rootContainer?.querySelector('#hh-distinct-spells-badge');
    const skipBtn = this.rootContainer?.querySelector('#hh-btn-skip-level');
    if (!circlesHost || !treesHost || !this.currentHero) return;

    const hero = this.currentHero;
    const st = this._computeTimelineState(hero);

    if (ptsBadge) {
      ptsBadge.textContent = `${st.availablePoints} PT`;
    }
    if (distinctBadge) {
      distinctBadge.textContent = `${st.distinctCount}/5`;
    }
    if (skipBtn) {
      skipBtn.disabled = st.nextLevelIdx >= 9;
      skipBtn.classList.toggle('opacity-40', st.nextLevelIdx >= 9);
    }

    circlesHost.innerHTML = st.schedule
      .map((slot, idx) => {
        const lvl = idx + 1;
        const isCurrentTarget = idx === st.nextLevelIdx;
        if (!slot) {
          return `
            <div
              data-tip="Level ${lvl} (Empty)"
              class="hh-has-tip relative w-10 h-10 rounded-full border-2 ${
                isCurrentTarget
                  ? 'border-amber-400 bg-amber-500/15 text-amber-300 ring-2 ring-amber-400/40'
                  : 'border-dashed border-slate-700 bg-slate-950 text-slate-500 opacity-65'
              } flex items-center justify-center font-black text-xs mono"
            >
              ${lvl}
            </div>
          `;
        }

        if (slot.type === 'skip') {
          return `
            <button
              type="button"
              data-timeline-idx="${idx}"
              data-tip="Level ${lvl}: Skipped (+1 PT saved). Click to clear from here."
              class="hh-circle-slot hh-has-tip relative w-10 h-10 rounded-full border-2 border-amber-400 bg-amber-950/50 hover:bg-rose-950/60 text-amber-300 flex items-center justify-center font-black text-xs mono transition cursor-pointer"
            >
              ⏭
              <span class="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-slate-950 border border-amber-400 text-[9px] font-black text-amber-300 flex items-center justify-center">${lvl}</span>
            </button>
          `;
        }

        const spDef = findSpellDef(this.heroesData, slot.spellId);
        const iconSvg = HERO_SPELL_SVG_ICONS[slot.spellId] || HERO_SPELL_SVG_ICONS.fireball;
        const isUpgrade = slot.type === 'upgrade';

        return `
          <button
            type="button"
            data-timeline-idx="${idx}"
            data-tip="Level ${lvl}: ${spDef?.name || slot.spellId} (Lv.${slot.spellLevel}). Click to undo from here."
            class="hh-circle-slot hh-has-tip relative w-10 h-10 rounded-full border-2 ${
              isUpgrade
                ? 'border-sky-400 bg-slate-900 hover:bg-rose-950/60'
                : 'border-emerald-400 bg-slate-900 hover:bg-rose-950/60'
            } flex items-center justify-center shadow transition cursor-pointer"
          >
            ${iconSvg}
            <span class="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-slate-950 border border-slate-600 text-[9px] font-black text-amber-300 mono flex items-center justify-center">${lvl}</span>
            <span class="absolute -bottom-1 -right-1 px-1 rounded-full ${
              isUpgrade ? 'bg-sky-500 text-slate-950' : 'bg-emerald-500 text-slate-950'
            } text-[8.5px] font-black mono">${slot.spellLevel}</span>
          </button>
        `;
      })
      .join('');

    const renderNodeAt = (sp, treeId, xPct, yPct, isHybrid = false) => {
      if (!sp) return '';
      const rank = st.spellRanks.get(sp.id) || 0;
      const maxRank = sp.maxLevel || 3;
      const isMax = rank >= maxRank;
      const isNew = rank === 0;
      const costPts = isNew ? (sp.cost || 1) : (sp.upgradeCost || 1);
      const prereqMet = this._arePrerequisitesMet(sp, st.spellRanks, hero);
      const blockedByDistinctCap = isNew && st.distinctCount >= 5;
      const notEnoughPts = st.availablePoints < costPts;
      const canPick = st.nextLevelIdx < 10 && !isMax && prereqMet && !blockedByDistinctCap && !notEnoughPts;
      const iconSvg = HERO_SPELL_SVG_ICONS[sp.id] || HERO_SPELL_SVG_ICONS.fireball;
      const isAdaptive = Boolean(sp.weaponVariants);

      const ringCls = isMax
        ? 'border-amber-400 bg-amber-500/20 shadow-[0_0_18px_rgba(251,191,36,0.45)]'
        : rank > 0
          ? 'border-emerald-400 bg-emerald-950/65 shadow-[0_0_16px_rgba(16,185,129,0.4)] hover:scale-105'
          : canPick
            ? isHybrid
              ? 'border-purple-400 bg-slate-900 hover:border-amber-300 hover:scale-105 shadow-[0_0_14px_rgba(168,85,247,0.35)]'
              : 'border-sky-400/90 bg-slate-900 hover:border-amber-300 hover:scale-105 shadow-lg'
            : prereqMet
              ? 'border-slate-600 bg-slate-900/80 opacity-75'
              : 'border-slate-800 bg-slate-950/90 opacity-45';

      return `
        <div
          style="left: ${xPct.toFixed(2)}%; top: ${yPct.toFixed(2)}%;"
          class="absolute -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center"
        >
          <button
            type="button"
            data-choose-spell="${sp.id}"
            data-tree-id="${treeId}"
            data-spell-hover="${sp.id}"
            class="hh-spell-node relative w-13 h-13 rounded-2xl border-2 ${ringCls} flex items-center justify-center transition ${canPick ? 'cursor-pointer' : 'cursor-default'}"
          >
            <div class="scale-105 pointer-events-none">${iconSvg}</div>

            <!-- Rank Badge (bottom-right) -->
            <span class="pointer-events-none absolute -bottom-1.5 -right-1.5 px-1.5 rounded-full border border-slate-950 text-[9px] font-black mono ${
              rank > 0 ? 'bg-emerald-400 text-slate-950' : 'bg-slate-800 text-slate-300'
            }">
              ${rank}/${maxRank}
            </span>

            <!-- 2-Point Cost Badge (top-left, only if 2 pts) -->
            ${
              (sp.cost || 1) > 1 && rank === 0
                ? `<span class="pointer-events-none absolute -top-1.5 -left-1.5 px-1 rounded-full bg-amber-400 text-slate-950 text-[8px] font-black mono shadow">2P</span>`
                : ''
            }

            <!-- Adaptive Bow/Sword Badge or Passive Badge (top-right) -->
            ${
              sp.type === 'passive'
                ? `<span class="pointer-events-none absolute -top-1.5 -right-1.5 px-1 rounded bg-emerald-950 border border-emerald-400 text-[8px] font-black text-emerald-300 mono">P</span>`
                : isAdaptive
                  ? `<span class="pointer-events-none absolute -top-1.5 -right-1.5 px-1 rounded bg-amber-950 border border-amber-400 text-[8px] font-black text-amber-300 mono" title="Adapts to Bow / Melee">⇄</span>`
                  : ''
            }
          </button>
          <span class="mt-1 px-1 rounded bg-slate-950/80 text-[10px] font-bold ${isHybrid ? 'text-purple-200' : 'text-slate-200'} text-center leading-tight max-w-[96px] truncate">
            ${sp.nameEn || sp.name}
          </span>
        </div>
      `;
    };

    // Unified Spell Tree Map coordinate space: 1000 x 390
    const MAP_W = 1000;
    const MAP_H = 390;
    const trees = getSpellTreesForClass(this.heroesData, hero.heroClass || 'warrior');
    const nodeCoords = new Map(); // spellId -> { x, y, color, treeId, sp }
    const nodesHtmlList = [];
    const headersHtmlList = [];
    const svgPathsList = [];

    const treeCount = Math.max(1, trees.length);
    const colWidth = MAP_W / treeCount;

    trees.forEach((tree, tIdx) => {
      const centerX = (tIdx + 0.5) * colWidth;
      const color = tree.color || '#38bdf8';

      headersHtmlList.push(`
        <div
          style="left: ${((centerX / MAP_W) * 100).toFixed(2)}%; top: 14px;"
          class="absolute -translate-x-1/2 z-10 px-3 py-0.5 rounded-full border border-slate-800 bg-slate-950/90 text-[10.5px] font-black uppercase tracking-wider shadow"
        >
          <span style="color: ${color}">${tree.nameEn || tree.name}</span>
        </div>
      `);

      const spells = Object.values(tree.spells || {}).filter(
        (s) => !s.onlyForHeroId || s.onlyForHeroId === hero.id || st.spellRanks.has(s.id)
      );
      const tier1 = spells.filter((s) => (s.tier || 1) === 1);
      const tier2 = spells.filter((s) => s.tier === 2);
      const tier3 = spells.filter((s) => s.tier === 3);

      const placeTierRow = (list, yCoord) => {
        if (list.length === 1) {
          const sp = list[0];
          nodeCoords.set(sp.id, { x: centerX, y: yCoord, color, treeId: tree.id, sp });
        } else if (list.length >= 2) {
          const maxSpan = colWidth * 0.68;
          const stepX = Math.min(108, maxSpan / (list.length - 1));
          list.forEach((sp, i) => {
            const offset = (i - (list.length - 1) * 0.5) * stepX;
            nodeCoords.set(sp.id, { x: centerX + offset, y: yCoord, color, treeId: tree.id, sp });
          });
        }
      };

      placeTierRow(tier1, 66);
      placeTierRow(tier2, 156);
      placeTierRow(tier3, 246);
    });

    // Position Cross-Tree Hybrid Spells along the bottom row (y = 338) directly between the trees they bridge!
    const hybrids = Object.values(this.heroesData.hybridSpells || {});
    const hybridDefaultX = {
      vampiric_cleave: 250,
      inspiring_onslaught: 500,
      explosive_mark: 750
    };
    hybrids.forEach((hsp, hIdx) => {
      const hx = hybridDefaultX[hsp.id] ?? ((hIdx + 1) * (MAP_W / (hybrids.length + 1)));
      const hy = 338;
      nodeCoords.set(hsp.id, { x: hx, y: hy, color: '#c084fc', treeId: 'hybrid', sp: hsp, isHybrid: true });
    });

    // Build clean, deduplicated Y-branch / Y-merge SVG connectors so parallel lines never overlap!
    const drawnEdges = new Set();

    for (const [sid, targetNode] of nodeCoords.entries()) {
      const sp = targetNode.sp;
      const targetRank = st.spellRanks.get(sid) || 0;

      // Resolve the exact list of parent node IDs for `targetNode` (at most 1 per `requiresAnyOf` tree group)
      const parentIds = [];
      if (Array.isArray(sp.requiresAnyOf) && sp.requiresAnyOf.length > 0) {
        for (const group of sp.requiresAnyOf) {
          if (!Array.isArray(group)) continue;
          const visibleParents = group.filter((gid) => nodeCoords.has(gid));
          if (visibleParents.length === 0) continue;
          const chosenParentId =
            visibleParents.find((gid) => (st.spellRanks.get(gid) || 0) > 0) || visibleParents[0];
          if (chosenParentId && !parentIds.includes(chosenParentId)) {
            parentIds.push(chosenParentId);
          }
        }
      } else if (Array.isArray(sp.requires)) {
        for (const reqId of sp.requires) {
          if (nodeCoords.has(reqId) && !parentIds.includes(reqId)) {
            parentIds.push(reqId);
          }
        }
      }

      if (parentIds.length === 1) {
        const pid = parentIds[0];
        const edgeKey = `${pid}->${sid}`;
        if (!drawnEdges.has(edgeKey)) {
          drawnEdges.add(edgeKey);
          const srcNode = nodeCoords.get(pid);
          const activeLink = (st.spellRanks.get(pid) || 0) > 0;
          const x1 = srcNode.x;
          const y1 = srcNode.y + 24;
          const x2 = targetNode.x;
          const y2 = targetNode.y - 24;
          const midY = (y1 + y2) * 0.5;
          svgPathsList.push(`
            <path
              d="M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}"
              stroke="${activeLink ? targetNode.color : '#64748b'}"
              stroke-width="${activeLink ? '2.6' : '2.0'}"
              stroke-opacity="${activeLink ? '0.92' : '0.45'}"
              stroke-linejoin="round"
              ${activeLink ? '' : 'stroke-dasharray="5 3"'}
              fill="none"
            />
          `);
        }
      } else if (parentIds.length >= 2) {
        // Multiple parents merging into one child (or Cross-Tree Hybrid):
        // Draw each parent arm to a single shared merge junction `(x2, mergeY)` and ONE single stem into `(x2, y2)`!
        const x2 = targetNode.x;
        const y2 = targetNode.y - 24;
        const mergeY = y2 - 18;
        let anyParentActive = false;

        for (const pid of parentIds) {
          const edgeKey = `${pid}->${sid}`;
          if (drawnEdges.has(edgeKey)) continue;
          drawnEdges.add(edgeKey);
          const srcNode = nodeCoords.get(pid);
          const activeLink = (st.spellRanks.get(pid) || 0) > 0;
          if (activeLink) anyParentActive = true;
          const x1 = srcNode.x;
          const y1 = srcNode.y + 24;
          const strokeCol = activeLink
            ? targetNode.isHybrid
              ? '#c084fc'
              : targetNode.color
            : targetNode.isHybrid
              ? srcNode.color
              : '#64748b';
          svgPathsList.push(`
            <path
              d="M ${x1} ${y1} L ${x1} ${mergeY} L ${x2} ${mergeY}"
              stroke="${strokeCol}"
              stroke-width="${activeLink ? '2.6' : '1.9'}"
              stroke-opacity="${activeLink ? '0.92' : '0.45'}"
              stroke-linejoin="round"
              ${activeLink ? '' : 'stroke-dasharray="5 3"'}
              fill="none"
            />
          `);
        }

        // Single merged vertical stem into the target node!
        const stemCol = anyParentActive || targetRank > 0
          ? targetNode.isHybrid
            ? '#c084fc'
            : targetNode.color
          : '#64748b';
        svgPathsList.push(`
          <line
            x1="${x2}"
            y1="${mergeY}"
            x2="${x2}"
            y2="${y2}"
            stroke="${stemCol}"
            stroke-width="${anyParentActive || targetRank > 0 ? '2.8' : '2.0'}"
            stroke-opacity="${anyParentActive || targetRank > 0 ? '0.95' : '0.48'}"
            ${anyParentActive || targetRank > 0 ? '' : 'stroke-dasharray="5 3"'}
          />
        `);
      }

      nodesHtmlList.push(
        renderNodeAt(
          sp,
          targetNode.treeId,
          (targetNode.x / MAP_W) * 100,
          (targetNode.y / MAP_H) * 100,
          Boolean(targetNode.isHybrid)
        )
      );
    }

    treesHost.innerHTML = `
      <div class="relative w-full h-full min-h-[370px] rounded-2xl border border-slate-800 bg-slate-900/65 shadow-inner overflow-hidden select-none">
        <!-- Subtle vertical tree lane dividers -->
        <div class="pointer-events-none absolute inset-0 grid grid-cols-4">
          <div class="border-r border-slate-800/50"></div>
          <div class="border-r border-slate-800/50"></div>
          <div class="border-r border-slate-800/50"></div>
          <div></div>
        </div>

        <!-- Unified Master SVG Connector Layer (Intra-Tree + Cross-Tree Hybrid Lines) -->
        <svg
          class="pointer-events-none absolute inset-0 w-full h-full"
          viewBox="0 0 ${MAP_W} ${MAP_H}"
          preserveAspectRatio="none"
          fill="none"
        >
          ${svgPathsList.join('')}
        </svg>

        <!-- Tree Column Headers -->
        ${headersHtmlList.join('')}

        <!-- All Spell & Hybrid Nodes in Unified Coordinate Space -->
        ${nodesHtmlList.join('')}
      </div>
    `;

    this._renderSpellVfxBar();
  },

  _renderSpellVfxBar() {
    const barEl = this.rootContainer?.querySelector('#hh-spell-vfx-bar');
    if (!barEl) return;
    const sp = findSpellDef(this.heroesData, this.inspectedSpellId) || findSpellDef(this.heroesData, 'fireball');
    if (!sp) {
      barEl.innerHTML = '';
      return;
    }
    const curStyle = inferDefaultVfxStyle(sp.id, sp.vfxStyle);
    const vfxOptions = [
      ['sword_trail_slash', '⚔️ Melee Sword Slash Trail'],
      ['venom_blade_slash', '🐍 Venom Blade Slash Trail'],
      ['projectile_fireball', '🔥 Straight Fireball + 3D Blast'],
      ['projectile_poison_arrow', '🏹 Poison Arrow Projectile'],
      ['projectile_piercing_bolt', '⚡ Piercing Bolt Projectile'],
      ['projectile_dagger', '🗡️ Spinning Throwing Knife'],
      ['projectile_arcane', '🔮 Arcane Orb Projectile'],
      ['healing_aura', '💚 Healing Rising Rings'],
      ['sanctuary_pillar', '✨ Sanctuary Light Pillar'],
      ['shockwave_ring', '💥 Shockwave Ring'],
      ['war_cry_roar', '📣 War Cry Shockwave'],
      ['lightning_arc', '🌩️ Chain Lightning Bolt'],
      ['meteor_rain', '☄️ Meteor Storm Rain'],
      ['arrow_volley', '🌧️ Rain of Arrows Volley']
    ];
    barEl.innerHTML = `
      <span class="font-black text-amber-300">${sp.nameEn || sp.name}:</span>
      <label class="flex items-center gap-1 text-slate-300">
        <span>Cast Range (m)</span>
        <input type="number" id="hh-sp-range-in" value="${sp.rangeMeters ?? 0}" min="0" max="9999" step="1" class="w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-right font-bold text-sky-300 mono" />
      </label>
      <label class="flex items-center gap-1 text-slate-300">
        <span>Area Radius (m)</span>
        <input type="number" id="hh-sp-radius-in" value="${sp.radiusMeters ?? 0}" min="0" max="120" step="0.5" class="w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-right font-bold text-emerald-300 mono" />
      </label>
      <label class="flex items-center gap-1 text-slate-300">
        <span>Spell VFX</span>
        <select id="hh-sp-vfx-sel" class="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 font-bold text-amber-200">
          ${vfxOptions.map(([val, label]) => `<option value="${val}" ${val === curStyle ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </label>
    `;
  },

  _positionTooltip(e, tipEl) {
    const pad = 14;
    const w = 320;
    const h = tipEl.offsetHeight || 180;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + w > window.innerWidth - 12) x = e.clientX - w - pad;
    if (y + h > window.innerHeight - 12) y = Math.max(12, window.innerHeight - h - 12);
    tipEl.style.left = `${Math.round(x)}px`;
    tipEl.style.top = `${Math.round(y)}px`;
  },

  _openSpellEditModal(spellId) {
    const sp = findSpellDef(this.heroesData, spellId);
    const modal = this.rootContainer?.querySelector('#hh-spell-edit-modal');
    const bodyEl = this.rootContainer?.querySelector('#hh-modal-spell-body');
    const titleEl = this.rootContainer?.querySelector('#hh-modal-spell-title');
    const subEl = this.rootContainer?.querySelector('#hh-modal-spell-sub');
    const iconEl = this.rootContainer?.querySelector('#hh-modal-spell-icon');
    if (!sp || !modal || !bodyEl) return;

    this._editingModalSpellId = sp.id;
    this.inspectedSpellId = sp.id;
    if (titleEl) titleEl.textContent = sp.name || sp.nameEn || sp.id;
    if (subEl) subEl.textContent = `${sp.id} • ${(sp.type || 'active').toUpperCase()} • Target: ${sp.targetMode || 'self'}`;
    if (iconEl) iconEl.innerHTML = HERO_SPELL_SVG_ICONS[sp.id] || HERO_SPELL_SVG_ICONS.fireball;

    const curStyle = inferDefaultVfxStyle(sp.id, sp.vfxStyle);
    const vfxOptions = [
      ['sword_trail_slash', '⚔️ Melee Sword Slash Trail'],
      ['venom_blade_slash', '🐍 Venom Blade Slash Trail'],
      ['projectile_fireball', '🔥 Straight Fireball + 3D Blast'],
      ['projectile_poison_arrow', '🏹 Poison Arrow Projectile'],
      ['projectile_piercing_bolt', '⚡ Piercing Bolt Projectile'],
      ['projectile_dagger', '🗡️ Spinning Throwing Knife'],
      ['projectile_arcane', '🔮 Arcane Orb Projectile'],
      ['healing_aura', '💚 Twin Rising Serpents (Heal)'],
      ['sanctuary_pillar', '✨ Sanctuary Light Pillar'],
      ['shockwave_ring', '💥 Shockwave Ring'],
      ['war_cry_roar', '📣 War Cry Shockwave'],
      ['lightning_arc', '🌩️ Chain Lightning Bounce'],
      ['meteor_rain', '☄️ Meteor Storm Rain'],
      ['arrow_volley', '🌧️ Rain of Sculpted Arrows'],
      ['chameleon_roar_freeze', '🦎 Chameleon Sonic Roar Waves'],
      ['chameleon_bite_fangs', '🦷 Chameleon Venom Bite Fangs'],
      ['unstoppable_charge_trail', '💨 Unstoppable Charge Trail'],
      ['royal_banner_drop', '🛡️ Summon Royal Army Rejuvenation'],
      ['placed_royal_banner', '🚩 Planted Royal War Banner'],
      ['far_sight_circle', '👁️ Far Sight Illumination Circle'],
      ['kings_decree_wind', '👑 King Decree Expanding Wind Gust'],
      ['azure_blade_slash', '⚡ Azure Blade Fury Slash']
    ];

    const paramLabelMap = {
      damage: 'Damage (נזק)',
      healAmount: 'Heal Amount (ריפוי)',
      heroHealAmount: 'Hero Heal (ריפוי גיבור)',
      poisonDamage: 'Poison Total Damage (נזק רעל)',
      poisonSec: 'Poison Duration Sec (משך רעל)',
      burnTicks: 'Burn Ticks (בעירה)',
      knockbackMeters: 'Knockback Distance m (מרחק הדף)',
      durationSec: 'Duration Sec (משך בשניות)',
      maxTargets: 'Max Chain Targets (מספר מטרות)',
      radiusMeters: 'Radius m (רדיוס אזור)',
      revealRadiusMeters: 'Reveal Radius m (רדיוס חשיפה)',
      cooldownSec: 'Cooldown Sec (זמן טעינה)',
      armorBonus: 'Armor Bonus % (בונוס שריון)',
      maxHpBonus: 'Max HP Bonus (בונוס חיים)',
      attackDamageBonus: 'Attack Damage Bonus (בונוס התקפה)',
      moveSpeedPct: 'Move Speed Bonus % (מהירות תנועה)',
      attackSpeedPct: 'Attack Speed Bonus % (מהירות תקיפה)',
      damageBonusPct: 'Damage Bonus % (אחוז נזק)',
      allyDamageBonusPct: 'Ally Aura Damage % (בונוס התקפה לחיילים)',
      allyHpRegen: 'Ally HP Regen/s (ריפוי לחיילים)',
      moraleHeal: 'Morale Restore (שיקום מורל)',
      staminaHeal: 'Stamina Restore (שיקום אנרגיה)',
      cooldownReductionPct: 'Cooldown Reduction % (קיצור טעינה)',
      swordsmanSquads: 'Swordsman Squads (פלוגות חרבות)',
      spearmanSquads: 'Spearman Squads (פלוגות חניתות)',
      archerSquads: 'Archer Squads (פלוגות קשתים)',
      cavalrySquads: 'Cavalry Squads (פלוגות פרשים)',
      freezeSec: 'Freeze Duration Sec (משך הקפאה)',
      bannerHp: 'Banner HP (חיי הדגל)',
      healPct: 'Heal % (אחוז ריפוי)',
      dmgPctPerKill: 'Damage % Per Kill (נזק להריגה)',
      atkSpdPctPerKill: 'Attack Speed % Per Kill (מהירות להריגה)',
      maxStacks: 'Max Stacks (מקס׳ צבירות)',
      allyArmorBonus: 'Ally Aura Armor (בונוס הגנה לחיילים)'
    };

    const ranksHtml = (sp.ranks || [])
      .map((r, rIdx) => {
        const fields = Object.entries(r)
          .filter(([k]) => k !== 'level')
          .map(([k, v]) => {
            const label = paramLabelMap[k] || k;
            const step = k.includes('Meters') || k.includes('Sec') ? '0.5' : '1';
            return `
              <label class="flex items-center justify-between gap-2 rounded-lg bg-slate-900/90 border border-slate-800 px-2.5 py-1.5">
                <span class="text-slate-300 font-semibold">${label}</span>
                <input
                  type="number"
                  data-rank-idx="${rIdx}"
                  data-rank-key="${k}"
                  value="${v}"
                  step="${step}"
                  class="w-20 rounded border border-amber-400/70 bg-slate-950 px-2 py-0.5 text-right font-bold text-amber-200 mono"
                />
              </label>
            `;
          })
          .join('');

        return `
          <div class="rounded-xl border border-slate-800 bg-slate-950/75 p-3 flex flex-col gap-2">
            <div class="text-[11px] font-black uppercase tracking-wider text-emerald-300">
              Rank ${r.level || rIdx + 1} Parameters
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              ${fields}
            </div>
          </div>
        `;
      })
      .join('');

    bodyEl.innerHTML = `
      <!-- Top Explanation / Description Box so the user sees what each parameter affects -->
      <div class="rounded-xl border border-amber-400/50 bg-amber-950/25 p-3.5 flex flex-col gap-1.5">
        <div class="text-[10.5px] font-black uppercase tracking-wider text-amber-300">
          📖 Spell Description &amp; Effect Guide (הסבר על הקסם והשפעת הפרמטרים)
        </div>
        <p class="text-xs text-amber-100/95 leading-relaxed font-semibold">${sp.description || ''}</p>
        ${
          sp.weaponVariants
            ? `<div class="mt-1 pt-1.5 border-t border-amber-400/20 flex flex-wrap gap-3 text-[10.5px] text-amber-200">
                <span>🏹 <b>Bow Stance:</b> ${sp.weaponVariants.ranged?.name || ''} (${sp.weaponVariants.ranged?.rangeMeters ?? sp.rangeMeters ?? 28}m)</span>
                <span>⚔️ <b>Melee Stance:</b> ${sp.weaponVariants.melee?.name || ''} (${sp.weaponVariants.melee?.rangeMeters ?? 2.8}m)</span>
              </div>`
            : ''
        }
      </div>

      <!-- General Spell Parameters -->
      <div class="rounded-xl border border-slate-800 bg-slate-950/75 p-3.5 flex flex-col gap-2.5">
        <div class="text-[11px] font-black uppercase tracking-wider text-sky-300">
          General Spell Settings
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label class="flex items-center justify-between gap-2 rounded-lg bg-slate-900/90 border border-slate-800 px-2.5 py-1.5">
            <span class="text-slate-300 font-semibold">Cast Range m (טווח הטלה)</span>
            <input type="number" id="hh-modal-sp-range" value="${sp.rangeMeters ?? 0}" min="0" max="9999" step="0.5" class="w-20 rounded border border-amber-400/70 bg-slate-950 px-2 py-0.5 text-right font-bold text-sky-300 mono" />
          </label>
          <label class="flex items-center justify-between gap-2 rounded-lg bg-slate-900/90 border border-slate-800 px-2.5 py-1.5">
            <span class="text-slate-300 font-semibold">Area Radius m (רדיוס פגיעה)</span>
            <input type="number" id="hh-modal-sp-radius" value="${sp.radiusMeters ?? 0}" min="0" max="120" step="0.5" class="w-20 rounded border border-amber-400/70 bg-slate-950 px-2 py-0.5 text-right font-bold text-emerald-300 mono" />
          </label>
          <label class="flex items-center justify-between gap-2 rounded-lg bg-slate-900/90 border border-slate-800 px-2.5 py-1.5">
            <span class="text-slate-300 font-semibold">Base Cooldown s (טעינה)</span>
            <input type="number" id="hh-modal-sp-cd" value="${sp.cooldownSec ?? 12}" min="0.5" max="300" step="0.5" class="w-20 rounded border border-amber-400/70 bg-slate-950 px-2 py-0.5 text-right font-bold text-amber-200 mono" />
          </label>
          <label class="flex items-center justify-between gap-2 rounded-lg bg-slate-900/90 border border-slate-800 px-2.5 py-1.5">
            <span class="text-slate-300 font-semibold">Cast / Anim Time s (אורך אנימציה)</span>
            <input type="number" id="hh-modal-sp-casttime" value="${sp.castTimeSec ?? 0.85}" min="0.2" max="10" step="0.05" class="w-20 rounded border border-amber-400/70 bg-slate-950 px-2 py-0.5 text-right font-bold text-cyan-300 mono" />
          </label>
          <label class="flex items-center justify-between gap-2 rounded-lg bg-slate-900/90 border border-slate-800 px-2.5 py-1.5">
            <span class="text-slate-300 font-semibold">Unlock Cost PT (מחיר נקודות)</span>
            <input type="number" id="hh-modal-sp-cost" value="${sp.cost ?? 1}" min="1" max="5" step="1" class="w-20 rounded border border-amber-400/70 bg-slate-950 px-2 py-0.5 text-right font-bold text-amber-200 mono" />
          </label>
          <label class="flex items-center justify-between gap-2 rounded-lg bg-slate-900/90 border border-slate-800 px-2.5 py-1.5">
            <span class="text-slate-300 font-semibold">Max Knockback Weight (משקל מקס׳ להדף)</span>
            <input type="number" id="hh-modal-sp-kbweight" value="${sp.maxKnockbackWeight ?? 4.5}" min="0" max="50" step="0.2" class="w-20 rounded border border-amber-400/70 bg-slate-950 px-2 py-0.5 text-right font-bold text-purple-300 mono" />
          </label>
          <label class="flex items-center justify-between gap-2 rounded-lg bg-slate-900/90 border border-slate-800 px-2.5 py-1.5">
            <span class="text-slate-300 font-semibold">3D Spell VFX</span>
            <select id="hh-modal-sp-vfx" class="w-36 rounded border border-amber-400/70 bg-slate-950 px-1.5 py-0.5 font-bold text-amber-200 text-[10.5px]">
              ${vfxOptions.map(([val, label]) => `<option value="${val}" ${val === curStyle ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
        </div>
      </div>

      <!-- Per-Rank Parameters -->
      ${ranksHtml}
    `;

    modal.classList.remove('hidden');
  },

  _closeSpellEditModal() {
    const modal = this.rootContainer?.querySelector('#hh-spell-edit-modal');
    modal?.classList.add('hidden');
    this._editingModalSpellId = null;
  },

  _saveSpellEditModal() {
    const sp = findSpellDef(this.heroesData, this._editingModalSpellId);
    const bodyEl = this.rootContainer?.querySelector('#hh-modal-spell-body');
    if (!sp || !bodyEl) {
      this._closeSpellEditModal();
      return;
    }

    const rangeVal = parseFloat(bodyEl.querySelector('#hh-modal-sp-range')?.value);
    if (!Number.isNaN(rangeVal)) {
      sp.rangeMeters = Math.max(0, rangeVal);
      sp.userModifiedRange = true;
    }
    const radiusVal = parseFloat(bodyEl.querySelector('#hh-modal-sp-radius')?.value);
    if (!Number.isNaN(radiusVal)) {
      sp.radiusMeters = Math.max(0, radiusVal);
      sp.userModifiedRadius = true;
    }
    const cdVal = parseFloat(bodyEl.querySelector('#hh-modal-sp-cd')?.value);
    if (!Number.isNaN(cdVal)) {
      sp.cooldownSec = Math.max(0.5, cdVal);
    }
    const castTimeVal = parseFloat(bodyEl.querySelector('#hh-modal-sp-casttime')?.value);
    if (!Number.isNaN(castTimeVal)) {
      sp.castTimeSec = Math.max(0.2, Math.min(10, castTimeVal));
      const kf = this.heroesData?.animations?.keyframes;
      if (kf) {
        const baseKey = `spell_${sp.id}`;
        if (kf[baseKey]) kf[baseKey].duration = sp.castTimeSec;
        for (const k of Object.keys(kf)) {
          if (k.endsWith(`_spell_${sp.id}`)) {
            kf[k].duration = sp.castTimeSec;
          }
        }
      }
    }
    const costVal = parseInt(bodyEl.querySelector('#hh-modal-sp-cost')?.value, 10);
    if (!Number.isNaN(costVal)) {
      sp.cost = Math.max(1, Math.min(5, costVal));
    }
    const kbWVal = parseFloat(bodyEl.querySelector('#hh-modal-sp-kbweight')?.value);
    if (!Number.isNaN(kbWVal)) {
      sp.maxKnockbackWeight = Math.max(0, kbWVal);
    }
    const vfxVal = bodyEl.querySelector('#hh-modal-sp-vfx')?.value;
    if (vfxVal) {
      sp.vfxStyle = vfxVal;
      sp.userModifiedVfx = true;
    }

    bodyEl.querySelectorAll('[data-rank-idx]').forEach((inputEl) => {
      const rIdx = Number(inputEl.dataset.rankIdx);
      const rKey = inputEl.dataset.rankKey;
      const num = parseFloat(inputEl.value);
      if (sp.ranks?.[rIdx] && rKey && !Number.isNaN(num)) {
        sp.ranks[rIdx][rKey] = num;
      }
    });

    sp.userModifiedParams = true;
    this.heroStateManager.saveDraft();
    this._closeSpellEditModal();
    this._renderSpellsWorkspace();
    this._toast(`Saved parameters for ${sp.nameEn || sp.name}`);
  },
};
