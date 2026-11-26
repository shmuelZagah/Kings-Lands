import * as THREE from 'three';
import { CommandTypes } from '../../core/commandBus.js';
import { OPTION_SVG_ICONS, buildOrbDecorationsSvg } from './hudIcons.js';
import { dataRegistry } from '../../data/dataRegistry.js';
import { findCustomIconById } from './unitIconsCatalog.js';
import { getOrRenderHeroPortraitUrl } from '../../tools/heroes/heroStateManager.js';

export class BuildingRadialMenu {
  constructor({ camera, domElement, simBridge, commandBus, synthAudio }) {
    this.camera = camera;
    this.domElement = domElement;
    this.simBridge = simBridge;
    this.commandBus = commandBus;
    this.synthAudio = synthAudio;

    this.unitStatsFull = dataRegistry.getUnitStats();
    this.buildingDefs = dataRegistry.getBuildings().buildings;
    this.unitStatsDefs = this.unitStatsFull?.units || {};
    this.selectedBuildingIds = new Set();
    this.isHeroSubmenuOpen = false;
    this._projVec = new THREE.Vector3();
    this._lastRenderedKey = '';
    this._animateNextRender = false;

    this._injectSpiralAnimationStyles();
    this._buildDomOverlay();
    this._buildBottomRightBuildingOrb();
    this._bindVisibilityRecovery();
  }

  get selectedBuildingId() {
    if (this.selectedBuildingIds.size === 0) return null;
    return this.selectedBuildingIds.values().next().value ?? null;
  }

  set selectedBuildingId(val) {
    this.selectedBuildingIds.clear();
    if (val !== null && val !== undefined) {
      this.selectedBuildingIds.add(val | 0);
    }
  }

  _bindVisibilityRecovery() {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this._lastRenderedKey = '';
        this._animateNextRender = false;
      }
    });
    window.addEventListener('focus', () => {
      this._lastRenderedKey = '';
      this._animateNextRender = false;
    });
    // The registry is the only source: every lab/Studio/Hero save notifies it, so one subscription covers all data.
    dataRegistry.subscribe(() => {
      this.unitStatsFull = dataRegistry.getUnitStats();
      this.buildingDefs = dataRegistry.getBuildings().buildings;
      this.unitStatsDefs = this.unitStatsFull?.units || {};
      this._lastRenderedKey = '';
    });
  }

  _injectSpiralAnimationStyles() {
    if (document.getElementById('bfme-radial-spiral-styles')) return;
    const styleEl = document.createElement('style');
    styleEl.id = 'bfme-radial-spiral-styles';
    styleEl.textContent = `
      @keyframes bfmeSpiralPopIn {
        0% {
          opacity: 0;
          transform: translate(var(--spiral-dx, 0px), var(--spiral-dy, 0px)) scale(0.18) rotate(-55deg);
        }
        75% {
          opacity: 1;
          transform: translate(0px, 0px) scale(1.08) rotate(4deg);
        }
        100% {
          opacity: 1;
          transform: translate(0px, 0px) scale(1) rotate(0deg);
        }
      }
      .bfme-radial-pop {
        animation: bfmeSpiralPopIn 140ms cubic-bezier(0.22, 1.28, 0.36, 1) backwards;
      }
    `;
    document.head.appendChild(styleEl);
  }

  _buildDomOverlay() {
    const oldContextPanel = document.getElementById('phase5-building-context-panel');
    if (oldContextPanel) oldContextPanel.remove();

    const existing = document.getElementById('phase5-building-radial-menu');
    if (existing) existing.remove();

    this.rootEl = document.createElement('div');
    this.rootEl.id = 'phase5-building-radial-menu';
    this.rootEl.className = 'pointer-events-none fixed left-0 top-0 z-30 hidden select-none';

    this.nodesContainerEl = document.createElement('div');
    this.nodesContainerEl.className = 'relative w-0 h-0';
    this.rootEl.appendChild(this.nodesContainerEl);

    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className =
      'pointer-events-none absolute left-1/2 -translate-x-1/2 top-12 hidden w-52 rounded-xl border border-amber-400/60 bg-slate-950/95 px-3 py-1.5 text-center shadow-2xl backdrop-blur-md';
    this.rootEl.appendChild(this.tooltipEl);

    document.body.appendChild(this.rootEl);
  }

  _buildBottomRightBuildingOrb() {
    const existingOrb = document.getElementById('phase5-building-orb-panel');
    if (existingOrb) existingOrb.remove();

    this.orbPanelEl = document.createElement('aside');
    this.orbPanelEl.id = 'phase5-building-orb-panel';
    this.orbPanelEl.className =
      'fixed -bottom-4 -right-4 z-30 hidden w-[258px] h-[238px] rounded-[50%] border-2 border-amber-400/65 select-none origin-bottom-right overflow-hidden pointer-events-auto';
    this.orbPanelEl.style.backgroundImage =
      "radial-gradient(circle at center, rgba(6,10,18,0.68) 0%, rgba(6,10,18,0.45) 65%, rgba(2,4,8,0.8) 100%), url('/assets/hud_orb_frame.jpg')";
    this.orbPanelEl.style.backgroundSize = 'cover';
    this.orbPanelEl.style.backgroundPosition = 'center';
    this.orbPanelEl.style.boxShadow =
      '0 14px 36px rgba(0, 0, 0, 0.92), inset 0 0 22px rgba(251, 191, 36, 0.25)';

    this.orbPanelEl.addEventListener('mousedown', (e) => e.stopPropagation());
    this.orbPanelEl.addEventListener('mouseup', (e) => e.stopPropagation());
    this.orbPanelEl.addEventListener('dblclick', (e) => e.stopPropagation());
    this.orbPanelEl.addEventListener('contextmenu', (e) => e.preventDefault());

    document.body.appendChild(this.orbPanelEl);
  }

  isBuildingSelected(buildingId) {
    return this.selectedBuildingIds.has(buildingId | 0);
  }

  openForBuilding(buildingId, additiveShift = false) {
    const nextId = buildingId | 0;
    if (additiveShift) {
      if (this.selectedBuildingIds.has(nextId)) {
        this.selectedBuildingIds.delete(nextId);
      } else {
        this.selectedBuildingIds.add(nextId);
        this._animateNextRender = true;
      }
      if (this.selectedBuildingIds.size === 0) {
        this.close();
        return;
      }
    } else {
      if (this.selectedBuildingIds.size !== 1 || !this.selectedBuildingIds.has(nextId)) {
        this._animateNextRender = true;
      }
      this.selectedBuildingIds.clear();
      this.selectedBuildingIds.add(nextId);
    }
    this._lastRenderedKey = '';
  }

  selectBuildingsOfSameTypeNear(buildingId, additiveShift = false, radiusMeters = 75) {
    const buildings = this.simBridge.getInterpolatedBuildings?.() || [];
    const targetBld = buildings.find(
      (b) => b.id === (buildingId | 0) && b.team === 1 && (b.type === 'citadel_slot' || b.hp > 0)
    );
    if (!targetBld) return false;

    if (!additiveShift) {
      this.selectedBuildingIds.clear();
    }

    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (b.team !== 1 || (b.type !== 'citadel_slot' && b.hp <= 0)) continue;
      if (b.type !== targetBld.type) continue;
      const d = Math.hypot(b.x - targetBld.x, b.z - targetBld.z);
      if (d <= radiusMeters) {
        this.selectedBuildingIds.add(b.id | 0);
      }
    }

    this._animateNextRender = true;
    this._lastRenderedKey = '';
    return this.selectedBuildingIds.size > 0;
  }

  close() {
    this.selectedBuildingIds.clear();
    this.isHeroSubmenuOpen = false;
    this._animateNextRender = false;
    this._lastRenderedKey = '';
    this.rootEl.classList.add('hidden');
    this.tooltipEl.classList.add('hidden');
    this.orbPanelEl.classList.add('hidden');
  }

  getSelectedBuildings() {
    if (this.selectedBuildingIds.size === 0) return [];
    const buildings = this.simBridge.getInterpolatedBuildings?.() || [];
    const result = [];
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (
        this.selectedBuildingIds.has(b.id) &&
        (b.type === 'citadel_slot' || b.hp > 0)
      ) {
        result.push(b);
      }
    }
    return result;
  }

  getSelectedBuildingIds() {
    return this.getSelectedBuildings().map((b) => b.id);
  }

  getSelectedBuilding() {
    const list = this.getSelectedBuildings();
    return list.length > 0 ? list[0] : null;
  }

  _getTotalQueueCount(bld) {
    if (!bld || !bld.queueCounts) return 0;
    let sum = 0;
    for (const k in bld.queueCounts) {
      sum += bld.queueCounts[k] || 0;
    }
    return sum;
  }

  _pickBestBuildingForProduction(selectedBlds, optionId, isUpgrade = false) {
    const completed = selectedBlds.filter((b) => {
      if (!b.isCompleted) return false;
      if (isUpgrade) return Boolean(this.buildingDefs[b.type]?.canAutoLevel);
      if (typeof optionId === 'string' && optionId.startsWith('hero:')) {
        return b.type === 'citadel';
      }
      const opts = this.buildingDefs[b.type]?.options || [];
      return opts.some((o) => o.id === optionId);
    });
    if (completed.length === 0) return null;

    if (isUpgrade) {
      const candidates = completed.filter(
        (b) => (b.queueCounts?.['__instant_upgrade__'] || 0) === 0
      );
      if (candidates.length === 0) return null;
      candidates.sort((a, b) => a.level - b.level || a.id - b.id);
      return candidates[0];
    }

    let bestBld = completed[0];
    let bestScore = Infinity;
    for (let i = 0; i < completed.length; i++) {
      const b = completed[i];
      const qCount = this._getTotalQueueCount(b);
      const score = qCount * 1000 - (b.progressPermille || 0);
      if (score < bestScore) {
        bestScore = score;
        bestBld = b;
      }
    }
    return bestBld;
  }

  _pickBestBuildingForCancel(selectedBlds, optionId) {
    let bestBld = null;
    let maxCount = 0;
    for (let i = 0; i < selectedBlds.length; i++) {
      const b = selectedBlds[i];
      const count = b.queueCounts?.[optionId] || 0;
      if (count > maxCount) {
        maxCount = count;
        bestBld = b;
      }
    }
    return bestBld;
  }

  _getIconSvgForItem(item) {
    if (item.isBackBtn) return OPTION_SVG_ICONS.back_arrow || OPTION_SVG_ICONS.ungarrison;
    if (item.isHeroesMenuBtn) return OPTION_SVG_ICONS.heroes_menu || OPTION_SVG_ICONS.wizard;
    if (item.isHeroOption) {
      if (item.portraitUrl) {
        return `
          <div class="pointer-events-none w-[36px] h-[36px] rounded-full overflow-hidden flex items-center justify-center">
            <img src="${item.portraitUrl}" alt="" class="pointer-events-none w-[44px] h-[44px] max-w-none object-cover translate-y-0.5" />
          </div>
        `;
      }
      return OPTION_SVG_ICONS[item.heroId] || OPTION_SVG_ICONS.wizard || OPTION_SVG_ICONS.heroes_menu;
    }
    if (item.recruitPortraitUrl) {
      return `
        <div class="pointer-events-none w-[36px] h-[36px] rounded-full overflow-hidden flex items-center justify-center">
          <img src="${item.recruitPortraitUrl}" alt="" class="pointer-events-none w-[44px] h-[44px] max-w-none object-cover" />
        </div>
      `;
    }
    if (item.recruitIconKey && OPTION_SVG_ICONS[item.recruitIconKey]) {
      return OPTION_SVG_ICONS[item.recruitIconKey];
    }
    if (item.isDemolish) return OPTION_SVG_ICONS.demolish;
    if (item.isUngarrison) return OPTION_SVG_ICONS.ungarrison;
    if (item.isUpgrade) return OPTION_SVG_ICONS.upgrade;
    if (OPTION_SVG_ICONS[item.id]) return OPTION_SVG_ICONS[item.id];
    if (item.unitRoleIcon && OPTION_SVG_ICONS[item.unitRoleIcon]) return OPTION_SVG_ICONS[item.unitRoleIcon];
    return OPTION_SVG_ICONS.swordsman || OPTION_SVG_ICONS.research;
  }

  _canAffordCost(cost, eco) {
    if (!cost || !eco) return true;
    return (
      eco.coins >= (cost.coins || 0) &&
      eco.wood >= (cost.wood || 0) &&
      eco.stone >= (cost.stone || 0) &&
      eco.iron >= (cost.iron || 0)
    );
  }

  _computeTightClusterOffsets(count) {
    if (count <= 0) return [];
    if (count === 1) return [{ x: 0, y: 0 }];
    if (count === 2) {
      return [
        { x: -24, y: 0 },
        { x: 24, y: 0 }
      ];
    }
    if (count === 3) {
      return [
        { x: 0, y: -22 },
        { x: -25, y: 20 },
        { x: 25, y: 20 }
      ];
    }

    const radius = count === 4 ? 32 : 38;
    const offsets = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 - Math.PI * 0.5;
      offsets.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius
      });
    }
    return offsets;
  }

  _applySpiralPopAnimation(btn, x, y, index) {
    if (!this._animateNextRender) return;
    btn.classList.add('bfme-radial-pop');
    btn.style.setProperty('--spiral-dx', `${Math.round(-x * 0.65)}px`);
    btn.style.setProperty('--spiral-dy', `${Math.round(-y * 0.65)}px`);
    btn.style.animationDelay = `${index * 22}ms`;
  }

  _formatCostText(cost) {
    if (!cost) return 'Free';
    const parts = [];
    if (cost.coins > 0) parts.push(`${cost.coins} Coins`);
    if (cost.wood > 0) parts.push(`${cost.wood} Wood`);
    if (cost.stone > 0) parts.push(`${cost.stone} Stone`);
    if (cost.iron > 0) parts.push(`${cost.iron} Iron`);
    return parts.join(', ') || 'Free';
  }

  _formatRefundText(cost) {
    if (!cost) return '45% Refund';
    const parts = [];
    const c = Math.floor((cost.coins || 0) * 0.45);
    const w = Math.floor((cost.wood || 0) * 0.45);
    const s = Math.floor((cost.stone || 0) * 0.45);
    const ir = Math.floor((cost.iron || 0) * 0.45);
    if (c > 0) parts.push(`+${c} Coins`);
    if (w > 0) parts.push(`+${w} Wood`);
    if (s > 0) parts.push(`+${s} Stone`);
    if (ir > 0) parts.push(`+${ir} Iron`);
    return parts.join(', ') || '45% Refund';
  }

  _buildOrbHpSectionHtml(selectedBlds) {
    const list = Array.isArray(selectedBlds) ? selectedBlds : [selectedBlds];
    let totalHp = 0;
    let totalMaxHp = 0;
    for (let i = 0; i < list.length; i++) {
      if (list[i].type !== 'citadel_slot' && (list[i].maxHp || 0) > 0) {
        totalHp += list[i].hp | 0;
        totalMaxHp += list[i].maxHp | 0;
      }
    }

    if (totalMaxHp <= 0) {
      return `<div class="mono text-[9px] text-slate-400 mt-0.5">Defensive Bastion Foundation</div>`;
    }
    const hpPct = Math.max(2, Math.min(100, Math.round((totalHp / Math.max(1, totalMaxHp)) * 100)));
    const barColor =
      hpPct > 55 ? 'bg-emerald-400' : hpPct > 25 ? 'bg-amber-400' : 'bg-rose-500';
    const textColor = hpPct < 100 ? 'text-amber-200' : 'text-emerald-300';

    return `
      <div class="flex items-center justify-center gap-1.5 mt-0.5">
        <span id="orb-bld-hp-text" class="mono text-[9.5px] font-extrabold ${textColor}">HP: ${totalHp} / ${totalMaxHp}</span>
      </div>
      <div class="w-32 h-1.5 rounded-full bg-slate-900 border border-slate-700 overflow-hidden mt-0.5">
        <div id="orb-bld-hp-bar" class="h-full ${barColor} transition-all" style="width: ${hpPct}%;"></div>
      </div>
    `;
  }

  _updateLiveHpAndProgressWithoutDomRebuild(selectedBlds, items = null) {
    let totalHp = 0;
    let totalMaxHp = 0;
    for (let i = 0; i < selectedBlds.length; i++) {
      if (selectedBlds[i].type !== 'citadel_slot' && (selectedBlds[i].maxHp || 0) > 0) {
        totalHp += selectedBlds[i].hp | 0;
        totalMaxHp += selectedBlds[i].maxHp | 0;
      }
    }

    if (totalMaxHp > 0) {
      const hpPct = Math.max(2, Math.min(100, Math.round((totalHp / Math.max(1, totalMaxHp)) * 100)));
      const hpTextEl = this.orbPanelEl.querySelector('#orb-bld-hp-text');
      const hpBarEl = this.orbPanelEl.querySelector('#orb-bld-hp-bar');
      if (hpTextEl) {
        const nextTxt = `HP: ${totalHp} / ${totalMaxHp}`;
        if (hpTextEl.textContent !== nextTxt) hpTextEl.textContent = nextTxt;
      }
      if (hpBarEl) {
        hpBarEl.style.width = `${hpPct}%`;
      }
    }

    if (items) {
      const circumference = 2 * Math.PI * 19;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.isActiveProduction || it.count <= 0) continue;
        const strokeOffset = (circumference * (1 - (it.progressPermille || 0) / 1000)).toFixed(1);
        const circles = document.querySelectorAll(`circle[data-prog-opt="${it.id}"]`);
        for (let c = 0; c < circles.length; c++) {
          circles[c].setAttribute('stroke-dashoffset', strokeOffset);
        }
      }
    }
  }

  update() {
    if (this.selectedBuildingIds.size === 0) return;

    const selectedBlds = this.getSelectedBuildings();
    if (selectedBlds.length === 0) {
      this.close();
      return;
    }

    const completedBlds = selectedBlds.filter((b) => b.isCompleted);
    const primaryBld = completedBlds[0] || selectedBlds[0];
    const def = this.buildingDefs[primaryBld.type];
    if (!def) {
      this.close();
      return;
    }

    const allSameType = selectedBlds.every((b) => b.type === primaryBld.type);
    const sharedOptionIds = new Set(
      (this.buildingDefs[selectedBlds[0].type]?.options || []).map((o) => o.id)
    );
    for (let i = 1; i < selectedBlds.length; i++) {
      const bOpts = new Set((this.buildingDefs[selectedBlds[i].type]?.options || []).map((o) => o.id));
      for (const id of Array.from(sharedOptionIds)) {
        if (!bOpts.has(id)) sharedOptionIds.delete(id);
      }
    }
    const hasSharedRecruitOptions = allSameType || sharedOptionIds.size > 0;

    // Mixed building types with NO shared recruitable options: show multi-building rally summary
    if (!hasSharedRecruitOptions) {
      this.rootEl.classList.add('hidden');
      this.tooltipEl.classList.add('hidden');
      this.orbPanelEl.classList.remove('hidden');

      const stateKey = `multi_mixed:${selectedBlds.map((b) => `${b.id}:${b.isCompleted ? 1 : 0}`).join(',')}`;
      if (this._lastRenderedKey !== stateKey) {
        this._lastRenderedKey = stateKey;
        this._renderMixedMultiBuildingState(selectedBlds);
        this._animateNextRender = false;
      }
      this._updateLiveHpAndProgressWithoutDomRebuild(selectedBlds);
      return;
    }

    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    if (selectedBlds.length === 1) {
      const clusterWorldY = primaryBld.type === 'citadel_slot' ? primaryBld.y + 1.2 : primaryBld.y + 3.1;
      this._projVec.set(primaryBld.x, clusterWorldY, primaryBld.z).project(this.camera);
      if (
        this._projVec.z <= 1 &&
        Number.isFinite(this._projVec.x) &&
        Number.isFinite(this._projVec.y)
      ) {
        this.rootEl.classList.remove('hidden');
        const screenX = (this._projVec.x + 1) * 0.5 * rect.width + rect.left;
        const screenY = (-this._projVec.y + 1) * 0.5 * rect.height + rect.top;
        this.rootEl.style.transform = `translate3d(${Math.round(screenX)}px, ${Math.round(screenY)}px, 0)`;
      } else {
        this.rootEl.classList.add('hidden');
      }
    } else {
      this.rootEl.classList.add('hidden');
      this.tooltipEl.classList.add('hidden');
    }

    this.orbPanelEl.classList.remove('hidden');

    if (!primaryBld.isCompleted) {
      const pct = Math.max(0, Math.min(100, Math.round((primaryBld.buildProgressPermille || 0) / 10)));
      const stateKey = `under_construction:${primaryBld.id}:${pct}`;
      if (this._lastRenderedKey !== stateKey) {
        this._lastRenderedKey = stateKey;
        this._renderUnderConstructionState(primaryBld, def, pct);
        this._animateNextRender = false;
      }
      this._updateLiveHpAndProgressWithoutDomRebuild(selectedBlds);
      return;
    }

    if (def.isPassiveAoE) {
      const stateKey = `passive:${selectedBlds.map((b) => `${b.id}:${b.level}:${b.xp}`).join(',')}`;
      if (this._lastRenderedKey !== stateKey) {
        this._lastRenderedKey = stateKey;
        this._renderPassiveBuildingState(primaryBld, selectedBlds);
        this._animateNextRender = false;
      }
      this._updateLiveHpAndProgressWithoutDomRebuild(selectedBlds);
      return;
    }

    if ((primaryBld.maxGarrison || 0) > 0 && selectedBlds.length === 1) {
      const slots = primaryBld.garrisonSlots || [];
      const slotSig = slots.map((s) => `${s.companyId}:${s.unitType}`).join(',');
      const stateKey = `tower_garrison:${primaryBld.id}:${slotSig}`;
      if (this._lastRenderedKey !== stateKey) {
        this._lastRenderedKey = stateKey;
        this._renderWatchtowerGarrisonState(primaryBld);
        this._animateNextRender = false;
      }
      this._updateLiveHpAndProgressWithoutDomRebuild(selectedBlds);
      return;
    }

    const eco = this.simBridge.getEconomyState?.() || {
      coins: 0,
      wood: 0,
      stone: 0,
      iron: 0
    };
    if (primaryBld.type !== 'citadel') {
      this.isHeroSubmenuOpen = false;
    }

    const items = [];
    if (primaryBld.type === 'citadel' && this.isHeroSubmenuOpen) {
      // Heroes recruitment bar inside Main Base (בית ההתחלה)
      const heroesData = dataRegistry.getHeroesData();
      const heroesList = Object.values(heroesData.heroes || {});
      const compStates = eco.companyStates || {};
      const fallenHeroes = eco.fallenHeroes || {};

      for (let hIdx = 0; hIdx < heroesList.length; hIdx++) {
        const h = heroesList[hIdx];
        const optId = `hero:${h.id}`;
        const p = h.parameters || {};
        const fallenInfo = fallenHeroes[h.id] || null;
        const isAliveOnField = Object.values(compStates).some(
          (cs) => cs && cs.isHero && cs.heroId === h.id && (cs.heroHp === undefined || cs.heroHp > 0)
        );

        const simHeroOpt = eco.heroRecruitmentOptions?.[h.id] || null;
        let costObj = simHeroOpt?.cost || {
          coins: Math.max(0, Number(p.cost?.coins ?? 400) | 0),
          wood: Math.max(0, Number(p.cost?.wood ?? 80) | 0),
          stone: Math.max(0, Number(p.cost?.stone ?? 0) | 0),
          iron: Math.max(0, Number(p.cost?.iron ?? 60) | 0)
        };
        let labelName = simHeroOpt?.name || h.displayName || h.name || h.id;
        if (fallenInfo && !simHeroOpt?.isRevive) {
          const flv = Math.max(1, fallenInfo.level || 1);
          const revCoins =
            ((p.reviveBaseCostCoins ?? 250) | 0) +
            Math.max(0, flv - 1) * ((p.reviveCostPerLevelCoins ?? 50) | 0);
          costObj = { coins: revCoins, wood: 0, stone: 0, iron: 0 };
          labelName = `Revive ${h.displayName || h.name || h.id} (Lv.${flv})`;
        }

        let totalCount = 0;
        let maxProg = 0;
        let anyActive = false;
        let anyPopHold = false;
        for (let bIdx = 0; bIdx < selectedBlds.length; bIdx++) {
          const sb = selectedBlds[bIdx];
          totalCount += sb.queueCounts?.[optId] || 0;
          if (sb.activeOptionId === optId) {
            anyActive = true;
            if (sb.isPopHold) anyPopHold = true;
            if ((sb.progressPermille || 0) > maxProg) {
              maxProg = sb.progressPermille || 0;
            }
          }
        }

        const canRecruit = !isAliveOnField && totalCount === 0 && this._canAffordCost(costObj, eco);
        const portraitUrl = getOrRenderHeroPortraitUrl(h.id, heroesData);
        items.push({
          id: optId,
          heroId: h.id,
          portraitUrl,
          name: isAliveOnField ? `${labelName} (Active)` : labelName,
          costText: isAliveOnField
            ? 'Alive on Battlefield'
            : `${this._formatCostText(costObj)} • ⏱️ ${
                fallenInfo
                  ? Math.max(
                      1,
                      ((p.reviveBaseTimeSec ?? 8) | 0) +
                        Math.max(0, (fallenInfo.level || 1) - 1) * ((p.reviveTimePerLevelSec ?? 2) | 0)
                    )
                  : Math.max(1, Number(p.trainTimeSec ?? 10))
              }s`,
          desc: 'Recruits Hero at the Main Base.',
          isHeroOption: true,
          isUpgrade: false,
          canAfford: canRecruit,
          count: totalCount,
          isActiveProduction: anyActive,
          isPopHold: anyPopHold,
          progressPermille: maxProg
        });
      }

      items.push({
        id: '__heroes_back__',
        name: 'Back to Citadel (חזרה)',
        costText: 'Return to Main Base Options',
        desc: 'Returns to standard Citadel options.',
        isBackBtn: true,
        isUpgrade: false,
        canAfford: true,
        count: 0,
        isActiveProduction: false,
        progressPermille: 0
      });
    } else {
      const rawOptions = allSameType
        ? (def.options || [])
        : (def.options || []).filter((o) => sharedOptionIds.has(o.id));

      for (let i = 0; i < rawOptions.length; i++) {
        const opt = rawOptions[i];
        if (opt.kind === 'heroes_menu') {
          // Count if any Hero is currently in the Citadel production queue
          let heroQueuedCount = 0;
          let heroAnyActive = false;
          let heroMaxProg = 0;
          for (let bIdx = 0; bIdx < selectedBlds.length; bIdx++) {
            const sb = selectedBlds[bIdx];
            for (const [qk, qv] of Object.entries(sb.queueCounts || {})) {
              if (qk.startsWith('hero:')) heroQueuedCount += qv || 0;
            }
            if (typeof sb.activeOptionId === 'string' && sb.activeOptionId.startsWith('hero:')) {
              heroAnyActive = true;
              if ((sb.progressPermille || 0) > heroMaxProg) {
                heroMaxProg = sb.progressPermille || 0;
              }
            }
          }
          items.push({
            id: 'heroes_menu',
            name: 'Heroes (גיבורים)',
            costText: 'Click to view & recruit Heroes',
            desc: 'Opens the Hero recruitment bar.',
            isHeroesMenuBtn: true,
            isUpgrade: false,
            canAfford: true,
            count: heroQueuedCount,
            isActiveProduction: heroAnyActive,
            progressPermille: heroMaxProg
          });
          continue;
        }

        let totalCount = 0;
        let maxProg = 0;
        let anyActive = false;
        let anyPopHold = false;

        for (let bIdx = 0; bIdx < selectedBlds.length; bIdx++) {
          const sb = selectedBlds[bIdx];
          totalCount += sb.queueCounts?.[opt.id] || 0;
          if (sb.activeOptionId === opt.id) {
            anyActive = true;
            if (sb.isPopHold) anyPopHold = true;
            if ((sb.progressPermille || 0) > maxProg) {
              maxProg = sb.progressPermille || 0;
            }
          }
        }

        const reqLv = (opt.unlockLevel | 0) || 1;
        const isLockedByLevel = (primaryBld.level || 1) < reqLv;
        const unitKey = opt.kind === 'unit' ? (opt.unitType || opt.id) : null;
        const uStat = unitKey ? this.unitStatsDefs?.[unitKey] : null;
        const effectiveCost = (opt.kind === 'unit' && uStat?.cost) ? uStat.cost : opt.cost;
        const effectiveName = (opt.kind === 'unit' && uStat?.name) ? uStat.name : opt.name;
        const unitRoleIcon = uStat
          ? (uStat.isWorker ? 'worker' : uStat.isSiege ? 'ballista' : uStat.isMounted ? 'cavalry' : uStat.isRanged ? 'archer' : 'swordsman')
          : null;
        items.push({
          id: opt.id,
          name: isLockedByLevel ? `${effectiveName} (Lv.${reqLv})` : effectiveName,
          costText: isLockedByLevel ? `Requires Building Lv.${reqLv}` : this._formatCostText(effectiveCost),
          recruitPortraitUrl:
            uStat?.recruitPortraitUrl ||
            findCustomIconById(this.unitStatsFull?.customPlaceholderIcons, uStat?.recruitIconKey)?.dataUrl ||
            null,
          recruitIconKey: uStat?.recruitIconKey || null,
          unitRoleIcon,
          desc:
            opt.kind === 'slot_upgrade'
              ? 'Constructs defensive tower on this bastion slot.'
              : opt.kind === 'unit'
                ? 'Recruits company at this structure.'
                : 'Researches realm technology.',
          isUpgrade: false,
          canAfford: !isLockedByLevel && this._canAffordCost(effectiveCost, eco),
          count: totalCount,
          isActiveProduction: anyActive,
          isPopHold: anyPopHold,
          progressPermille: maxProg
        });
      }
    }

    const maxBldLv = (def.maxLevel | 0) || 3;
    if (def.canAutoLevel && (primaryBld.level || 1) < maxBldLv) {
      const targetUpgBld =
        this._pickBestBuildingForProduction(selectedBlds, '__instant_upgrade__', true) ||
        primaryBld;
      const upgCost = { coins: targetUpgBld.upgradeCostCoins, wood: 0, stone: 0, iron: 0 };
      let upgQueuedCount = 0;
      let anyUpgActive = false;
      let maxUpgProg = 0;

      for (let bIdx = 0; bIdx < selectedBlds.length; bIdx++) {
        const sb = selectedBlds[bIdx];
        upgQueuedCount += sb.queueCounts?.['__instant_upgrade__'] || 0;
        if (sb.activeOptionId === '__instant_upgrade__') {
          anyUpgActive = true;
          if ((sb.progressPermille || 0) > maxUpgProg) {
            maxUpgProg = sb.progressPermille || 0;
          }
        }
      }

      const canQueueMoreUpgrades = upgQueuedCount < completedBlds.length;
      items.push({
        id: '__instant_upgrade__',
        name: `Upgrade (Lv.${targetUpgBld.level + 1})`,
        costText: `${targetUpgBld.upgradeCostCoins} Coins`,
        desc: `XP: ${targetUpgBld.xp}/${targetUpgBld.xpToNextLevel}`,
        isUpgrade: true,
        canAfford: this._canAffordCost(upgCost, eco) && canQueueMoreUpgrades,
        count: upgQueuedCount,
        isActiveProduction: anyUpgActive,
        progressPermille: maxUpgProg
      });
    }

    // Notice: `progressPermille` and `hp` are NOT in `stateKey` so DOM is never rebuilt 20x/sec during production!
    const stateKey =
      `completed:${this.isHeroSubmenuOpen ? 'H' : 'M'}:${selectedBlds.map((b) => `${b.id}:${b.isCompleted ? 1 : 0}`).join(',')}:` +
      items
        .map(
          (it) =>
            `${it.id}:${it.count}:${it.canAfford ? 1 : 0}:${it.isActiveProduction ? 1 : 0}:${it.isPopHold ? 1 : 0}:${it.costText}:${it.name}`
        )
        .join('|') +
      `|lv:${primaryBld.level}|xp:${primaryBld.xp}`;

    if (this._lastRenderedKey !== stateKey) {
      this._lastRenderedKey = stateKey;
      this._renderCompletedBuildingState(primaryBld, selectedBlds, def, items);
      this._animateNextRender = false;
    } else {
      this._updateLiveHpAndProgressWithoutDomRebuild(selectedBlds, items);
    }
  }
}

import { buildingRadialRendererMethods } from './buildingRadialRenderers.js';
Object.assign(BuildingRadialMenu.prototype, buildingRadialRendererMethods);
