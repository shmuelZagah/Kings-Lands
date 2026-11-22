/**
 * Kings Lands — Building Radial Menu & Bottom-Right Building Orb State Renderers
 * (src/ui/hud/buildingRadialRenderers.js)
 */
import * as THREE from 'three';
import { CommandTypes } from '../../core/commandBus.js';
import { OPTION_SVG_ICONS, buildOrbDecorationsSvg } from './hudIcons.js';
import buildingsData from '../../data/buildings.json';
import { loadHeroesDataFromStorage, getOrRenderHeroPortraitUrl } from '../../tools/heroes/heroStateManager.js';


export const buildingRadialRendererMethods = {
  _renderMixedMultiBuildingState(selectedBlds) {
    this.nodesContainerEl.innerHTML = '';
    this.orbPanelEl.innerHTML = `
      ${buildOrbDecorationsSvg()}
      <div class="pointer-events-none absolute top-[14px] inset-x-0 z-10 flex flex-col items-center justify-center">
        <div class="text-xs font-extrabold uppercase tracking-wider text-amber-300 text-center px-6">
          ${selectedBlds.length} Buildings Selected
        </div>
        ${this._buildOrbHpSectionHtml(selectedBlds)}
      </div>

      <div class="pointer-events-none absolute top-[92px] inset-x-7 z-20 rounded-2xl border border-teal-500/40 bg-slate-900/85 px-3 py-2.5 text-center shadow-inner">
        <div class="text-[11px] font-bold text-teal-300 leading-snug">
          Shared Rally Point Ready
        </div>
        <div class="text-[9.5px] text-slate-300 mt-1">
          Right-Click anywhere on the map to set a unified Rally Flag for all selected buildings.
        </div>
      </div>
    `;
  },

  _renderUnderConstructionState(bld, def, pct) {
    this.nodesContainerEl.innerHTML = '';
    const refundText = this._formatRefundText(def.cost);

    const floatBtn = document.createElement('button');
    floatBtn.type = 'button';
    floatBtn.style.left = '-23px';
    floatBtn.style.top = '-23px';
    floatBtn.className =
      'pointer-events-auto absolute w-[46px] h-[46px] rounded-full border-2 border-rose-500/90 bg-slate-950/95 hover:bg-rose-950 hover:border-rose-300 hover:scale-110 flex items-center justify-center shadow-xl transition cursor-pointer';
    floatBtn.innerHTML = OPTION_SVG_ICONS.demolish;
    this._applySpiralPopAnimation(floatBtn, 0, 0, 0);

    floatBtn.addEventListener('mouseenter', () => {
      this.tooltipEl.innerHTML = `
        <div class="text-[11px] font-extrabold text-rose-400 uppercase">Demolish (${pct}%)</div>
        <div class="text-[10px] font-semibold text-emerald-300 mono mt-0.5">${refundText}</div>
      `;
      this.tooltipEl.classList.remove('hidden');
    });
    floatBtn.addEventListener('mouseleave', () => this.tooltipEl.classList.add('hidden'));
    floatBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.button === 0) {
        this.commandBus.issue(CommandTypes.DEMOLISH_BUILDING, {
          team: 1,
          buildingId: bld.id
        });
        if (this.synthAudio) this.synthAudio.playHornAlert();
        this.close();
      }
    });
    this.nodesContainerEl.appendChild(floatBtn);

    const circumference = 2 * Math.PI * 28;
    const strokeOffset = circumference * (1 - pct / 100);

    this.orbPanelEl.innerHTML = `
      ${buildOrbDecorationsSvg()}
      <div class="pointer-events-none absolute top-[14px] inset-x-0 z-10 flex flex-col items-center justify-center">
        <div class="text-[11px] font-extrabold uppercase tracking-wider text-amber-300 text-center px-6 truncate max-w-[195px]">
          ${bld.name}
        </div>
        ${this._buildOrbHpSectionHtml(bld)}
      </div>

      <div class="absolute top-[78px] inset-x-0 z-20 flex items-center justify-center gap-4">
        <div class="relative w-16 h-16 rounded-full bg-slate-950/90 border border-emerald-500/40 flex items-center justify-center shadow-inner">
          <svg class="pointer-events-none absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(30,41,59,0.85)" stroke-width="5"/>
            <circle cx="32" cy="32" r="28" fill="none" stroke="#22c55e" stroke-width="5" stroke-linecap="round" stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${strokeOffset.toFixed(1)}"/>
          </svg>
          <span class="mono text-xs font-extrabold text-emerald-300">${pct}%</span>
        </div>

        <button id="orb-btn-demolish" type="button" title="Demolish & Refund 45% (${refundText})" class="w-12 h-12 rounded-full border-2 border-rose-500/90 bg-slate-900/95 hover:bg-rose-950 hover:border-rose-300 hover:scale-110 flex items-center justify-center shadow-xl transition cursor-pointer">
          ${OPTION_SVG_ICONS.demolish}
        </button>
      </div>

      <div class="pointer-events-none absolute bottom-[24px] inset-x-8 text-center text-[9.5px] text-slate-300 mono">
        Refunds 45% (${refundText})
      </div>
    `;

    this.orbPanelEl.querySelector('#orb-btn-demolish')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.commandBus.issue(CommandTypes.DEMOLISH_BUILDING, {
        team: 1,
        buildingId: bld.id
      });
      if (this.synthAudio) this.synthAudio.playHornAlert();
      this.close();
    });
  },

  _renderPassiveBuildingState(bld, selectedBlds) {
    this.nodesContainerEl.innerHTML = '';
    this.tooltipEl.classList.add('hidden');

    const passiveSummary =
      bld.type === 'infirmary'
        ? 'Heals nearby units by 10%'
        : 'Boosts nearby unit damage & armor by 25%';

    const titleText =
      selectedBlds.length > 1 ? `${selectedBlds.length}x ${bld.name}` : bld.name;

    this.orbPanelEl.innerHTML = `
      ${buildOrbDecorationsSvg()}
      <div class="pointer-events-none absolute top-[14px] inset-x-0 z-10 flex flex-col items-center justify-center">
        <div class="text-xs font-extrabold uppercase tracking-wider text-amber-300 text-center px-6">
          ${titleText}
        </div>
        <div class="mono text-[9.5px] font-bold text-sky-300 mt-0.5">
          Level ${bld.level} • XP ${bld.xp}/${bld.xpToNextLevel}
        </div>
        ${this._buildOrbHpSectionHtml(selectedBlds)}
      </div>

      <div class="pointer-events-none absolute top-[98px] inset-x-7 z-20 rounded-2xl border border-teal-500/40 bg-slate-900/85 px-3 py-2 text-center shadow-inner">
        <div class="text-[11px] font-bold text-teal-300 leading-snug">
          ${passiveSummary}
        </div>
        <div class="text-[9.5px] text-slate-400 mt-1">
          Passive Aura Radius: ${bld.auraRadiusMeters || 22}m
        </div>
      </div>
    `;
  },

  _renderWatchtowerGarrisonState(bld) {
    this.nodesContainerEl.innerHTML = '';
    const slots = bld.garrisonSlots || [];
    const maxSlots = bld.maxGarrison || 2;
    const hasAnyGarrison = slots.length > 0;

    const clusterTriangle = this._computeTightClusterOffsets(3);

    for (let s = 0; s < maxSlots; s++) {
      const occ = slots[s] || null;
      const pos = clusterTriangle[s + 1] || { x: 0, y: 0 };
      const btn = this._createGarrisonSlotCircleButton(bld, s, occ, pos.x, pos.y, false);
      this._applySpiralPopAnimation(btn, pos.x, pos.y, s);
      this.nodesContainerEl.appendChild(btn);
    }

    const topPos = clusterTriangle[0] || { x: 0, y: -22 };
    const floatEjectBtn = this._createEjectAllCircleButton(
      bld,
      hasAnyGarrison,
      topPos.x,
      topPos.y,
      false
    );
    this._applySpiralPopAnimation(floatEjectBtn, topPos.x, topPos.y, 2);
    this.nodesContainerEl.appendChild(floatEjectBtn);

    this.orbPanelEl.innerHTML = `
      ${buildOrbDecorationsSvg()}
      <div class="pointer-events-none absolute top-[14px] inset-x-0 z-10 flex flex-col items-center justify-center">
        <div class="text-xs font-extrabold uppercase tracking-wider text-amber-300">${bld.name}</div>
        <div class="mono text-[9.5px] font-bold text-teal-300">
          Garrison: ${slots.length} / ${maxSlots}
        </div>
        ${this._buildOrbHpSectionHtml(bld)}
      </div>
      <div id="orb-garrison-nodes" class="absolute inset-0 z-20"></div>
    `;

    const orbNodes = this.orbPanelEl.querySelector('#orb-garrison-nodes');
    if (orbNodes) {
      const orbSlotCoords = [
        { x: 90, y: 112 },
        { x: 168, y: 112 }
      ];
      for (let s = 0; s < maxSlots; s++) {
        const occ = slots[s] || null;
        const c = orbSlotCoords[s];
        const btn = this._createGarrisonSlotCircleButton(bld, s, occ, c.x, c.y, true);
        orbNodes.appendChild(btn);
      }
      const orbEjectBtn = this._createEjectAllCircleButton(
        bld,
        hasAnyGarrison,
        129,
        170,
        true
      );
      orbNodes.appendChild(orbEjectBtn);
    }
  },

  _createGarrisonSlotCircleButton(bld, slotIdx, occ, centerX, centerY, isInsideOrb = false) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.left = `${Math.round(centerX - 23)}px`;
    btn.style.top = `${Math.round(centerY - 23)}px`;

    if (occ) {
      const unitIcon = OPTION_SVG_ICONS[occ.unitType] || OPTION_SVG_ICONS.swordsman;
      btn.className =
        'pointer-events-auto absolute w-[46px] h-[46px] rounded-full border-2 border-teal-400 bg-slate-900/95 hover:border-amber-300 hover:scale-110 flex items-center justify-center shadow-[0_0_12px_rgba(45,212,191,0.5)] transition cursor-pointer';
      btn.innerHTML = `
        <div class="pointer-events-none relative z-10 flex items-center justify-center">${unitIcon}</div>
        <span class="pointer-events-none absolute -top-1 -right-1 z-20 px-1 rounded-full bg-teal-500 text-slate-950 font-extrabold text-[9px] border border-slate-950">#${slotIdx + 1}</span>
      `;
      btn.title = `Slot ${slotIdx + 1}: ${occ.name} (Click to Eject)`;

      if (!isInsideOrb) {
        btn.addEventListener('mouseenter', () => {
          this.tooltipEl.innerHTML = `
            <div class="text-[11px] font-extrabold text-teal-300 uppercase">${occ.name}</div>
            <div class="text-[9.5px] text-slate-300 mt-0.5">Click to eject company to rally flag</div>
          `;
          this.tooltipEl.classList.remove('hidden');
        });
        btn.addEventListener('mouseleave', () => this.tooltipEl.classList.add('hidden'));
      }

      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (e.button === 0) {
          this.commandBus.issue(CommandTypes.UNGARRISON_BUILDING, {
            team: 1,
            buildingId: bld.id,
            companyId: occ.companyId
          });
          if (this.synthAudio) this.synthAudio.playFocusWhoosh();
        }
      });
    } else {
      btn.className =
        'pointer-events-auto absolute w-[46px] h-[46px] rounded-full border-2 border-dashed border-slate-600 bg-slate-950/75 flex items-center justify-center shadow-inner cursor-default';
      btn.innerHTML = OPTION_SVG_ICONS.empty_slot;
      btn.title = `Empty Garrison Slot ${slotIdx + 1}`;

      if (!isInsideOrb) {
        btn.addEventListener('mouseenter', () => {
          this.tooltipEl.innerHTML = `
            <div class="text-[11px] font-extrabold text-slate-300 uppercase">Empty Slot #${slotIdx + 1}</div>
            <div class="text-[9.5px] text-slate-400 mt-0.5">Right-Click tower with infantry/archers</div>
          `;
          this.tooltipEl.classList.remove('hidden');
        });
        btn.addEventListener('mouseleave', () => this.tooltipEl.classList.add('hidden'));
      }
    }

    return btn;
  },

  _createEjectAllCircleButton(bld, hasAnyGarrison, centerX, centerY, isInsideOrb = false) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.left = `${Math.round(centerX - 23)}px`;
    btn.style.top = `${Math.round(centerY - 23)}px`;
    btn.className = hasAnyGarrison
      ? 'pointer-events-auto absolute w-[46px] h-[46px] rounded-full border-2 border-amber-400/90 bg-slate-900/95 hover:border-rose-400 hover:scale-110 flex items-center justify-center shadow-xl transition cursor-pointer'
      : 'pointer-events-auto absolute w-[46px] h-[46px] rounded-full border-2 border-slate-700 bg-slate-900/60 opacity-40 grayscale flex items-center justify-center cursor-not-allowed';
    btn.innerHTML = OPTION_SVG_ICONS.ungarrison;
    btn.title = 'Eject All Garrisoned Companies';

    if (!isInsideOrb) {
      btn.addEventListener('mouseenter', () => {
        this.tooltipEl.innerHTML = `
          <div class="text-[11px] font-extrabold text-amber-300 uppercase">Eject All</div>
          <div class="text-[9.5px] text-slate-300 mt-0.5">Evacuates all companies to the rally flag</div>
        `;
        this.tooltipEl.classList.remove('hidden');
      });
      btn.addEventListener('mouseleave', () => this.tooltipEl.classList.add('hidden'));
    }

    btn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.button === 0 && hasAnyGarrison) {
        this.commandBus.issue(CommandTypes.UNGARRISON_BUILDING, {
          team: 1,
          buildingId: bld.id,
          companyId: null
        });
        if (this.synthAudio) this.synthAudio.playFocusWhoosh();
      }
    });
    return btn;
  },

  _renderCompletedBuildingState(primaryBld, selectedBlds, def, items) {
    this.nodesContainerEl.innerHTML = '';
    const offsets = this._computeTightClusterOffsets(items.length);
    const circumference = 2 * Math.PI * 19;

    if (selectedBlds.length === 1) {
      for (let i = 0; i < items.length; i++) {
        const strokeOffset = circumference * (1 - (items[i].progressPermille || 0) / 1000);
        const btn = this._createOptionCircleButton(
          items[i],
          offsets[i].x,
          offsets[i].y,
          circumference,
          strokeOffset,
          false
        );
        this._applySpiralPopAnimation(btn, offsets[i].x, offsets[i].y, i);
        this.nodesContainerEl.appendChild(btn);
      }
    }

    const titleText =
      selectedBlds.length > 1 ? `${selectedBlds.length}x ${primaryBld.name}` : primaryBld.name;

    this.orbPanelEl.innerHTML = `
      ${buildOrbDecorationsSvg()}
      <div class="pointer-events-none absolute top-[12px] inset-x-0 z-10 flex flex-col items-center justify-center">
        <div class="text-[11px] font-extrabold uppercase tracking-wider text-amber-300 text-center px-6 truncate max-w-[195px]">
          ${titleText}
        </div>
        <div class="mono text-[9px] font-bold text-sky-300">
          ${def.canAutoLevel ? `Lv.${primaryBld.level} • XP ${primaryBld.xp}/${primaryBld.xpToNextLevel}` : `Level ${primaryBld.level}`}
        </div>
        ${this._buildOrbHpSectionHtml(selectedBlds)}
      </div>
      <div id="orb-action-nodes" class="absolute top-[84px] inset-x-4 bottom-[20px] z-20 flex flex-wrap items-center justify-center gap-2.5 px-3"></div>
    `;

    const orbNodes = this.orbPanelEl.querySelector('#orb-action-nodes');
    if (orbNodes) {
      for (let i = 0; i < items.length; i++) {
        const strokeOffset = circumference * (1 - (items[i].progressPermille || 0) / 1000);
        const btn = this._createOptionCircleButton(
          items[i],
          0,
          0,
          circumference,
          strokeOffset,
          true
        );
        orbNodes.appendChild(btn);
      }
    }
  },

  _createOptionCircleButton(
    item,
    x,
    y,
    circumference,
    strokeOffset,
    isRelativeInOrb = false
  ) {
    const btn = document.createElement('button');
    btn.type = 'button';
    if (!isRelativeInOrb) {
      btn.style.left = `${Math.round(x - 23)}px`;
      btn.style.top = `${Math.round(y - 23)}px`;
    }

    const posCls = isRelativeInOrb ? 'relative' : 'absolute';
    const isDisabled = !item.canAfford && item.count === 0;
    btn.className = isDisabled
      ? `pointer-events-auto ${posCls} w-[46px] h-[46px] rounded-full border-2 border-slate-700 bg-slate-900/85 opacity-45 grayscale flex items-center justify-center shadow-inner cursor-not-allowed`
      : `pointer-events-auto ${posCls} w-[46px] h-[46px] rounded-full border-2 border-amber-400/90 bg-slate-950/95 hover:border-teal-300 hover:scale-110 flex items-center justify-center shadow-[0_4px_14px_rgba(0,0,0,0.85)] transition cursor-pointer`;

    const showProgress = Boolean(item.isActiveProduction && item.count > 0);
    const iconSvg = this._getIconSvgForItem(item);
    btn.title = `${item.name} (${item.costText})`;

    btn.innerHTML = `
      <svg class="pointer-events-none absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 46 46">
        <circle cx="23" cy="23" r="19" fill="none" stroke="rgba(30,41,59,0.75)" stroke-width="3"/>
        ${
          showProgress
            ? `<circle data-prog-opt="${item.id}" cx="23" cy="23" r="19" fill="none" stroke="${item.isPopHold ? '#f59e0b' : '#2dd4bf'}" stroke-width="3.2" stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${strokeOffset.toFixed(1)}"/>`
            : ''
        }
      </svg>
      <div class="pointer-events-none relative z-10 flex items-center justify-center">
        ${iconSvg}
      </div>
      ${
        item.count > 0
          ? `<span class="pointer-events-none absolute -top-1 -right-1 z-20 min-w-[18px] h-[18px] px-1 rounded-full ${item.isPopHold ? 'bg-amber-400' : 'bg-teal-500'} text-slate-950 font-extrabold text-[10px] flex items-center justify-center border border-slate-950 shadow">
              ${item.isPopHold ? 'HOLD' : item.count}
            </span>`
          : ''
      }
    `;

    if (!isRelativeInOrb) {
      btn.addEventListener('mouseenter', () => {
        this.tooltipEl.innerHTML = `
          <div class="text-[11px] font-extrabold text-amber-300 uppercase">${item.name}${item.isPopHold ? ' — HOLD (Full Pop)' : ''}</div>
          <div class="text-[10px] font-semibold ${item.isPopHold ? 'text-amber-300' : item.canAfford ? 'text-teal-300' : 'text-rose-400'} mono mt-0.5">${item.isPopHold ? 'Waiting for House / Population Space (99%)' : item.costText}</div>
        `;
        this.tooltipEl.classList.remove('hidden');
      });
      btn.addEventListener('mouseleave', () => this.tooltipEl.classList.add('hidden'));
    }

    btn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();

      const currentSelectedBlds = this.getSelectedBuildings();
      if (currentSelectedBlds.length === 0) return;

      if (e.button === 0) {
        if (item.isHeroesMenuBtn) {
          this.isHeroSubmenuOpen = true;
          this._animateNextRender = true;
          this._lastRenderedKey = '';
          this.update();
          if (this.synthAudio) this.synthAudio.playFocusWhoosh();
          return;
        }
        if (item.isBackBtn) {
          this.isHeroSubmenuOpen = false;
          this._animateNextRender = true;
          this._lastRenderedKey = '';
          this.update();
          if (this.synthAudio) this.synthAudio.playFocusWhoosh();
          return;
        }
        if (!item.canAfford) return;
        const targetBld = this._pickBestBuildingForProduction(
          currentSelectedBlds,
          item.id,
          item.isUpgrade
        );
        if (!targetBld) return;

        if (item.isUpgrade) {
          this.commandBus.issue(CommandTypes.INSTANT_UPGRADE_BUILDING, {
            team: 1,
            buildingId: targetBld.id
          });
        } else {
          this.commandBus.issue(CommandTypes.QUEUE_PRODUCTION, {
            team: 1,
            buildingId: targetBld.id,
            optionId: item.id
          });
        }
        if (this.synthAudio) this.synthAudio.playFocusWhoosh();
      } else if (e.button === 2) {
        const cancelBld =
          this._pickBestBuildingForCancel(currentSelectedBlds, item.id) ||
          currentSelectedBlds[0];
        if (cancelBld) {
          this.commandBus.issue(CommandTypes.CANCEL_PRODUCTION, {
            team: 1,
            buildingId: cancelBld.id,
            optionId: item.id
          });
        }
      }
    });

    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    return btn;
  },
};
