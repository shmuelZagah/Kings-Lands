/**
 * Kings Lands — Vertical Worker Building Chain Menu & Tooltip HUD
 * (src/ui/hud/workerBuildChainMenu.js)
 *
 * Extracted from `WorkerPlacementController` in Stage 2.
 */

import { BUILDING_SVG_ICONS } from './hudIcons.js';

export class WorkerBuildChainMenu {
  constructor({ buildingDefs, canAffordBuildingFn, onSelectBuildingType }) {
    this.buildingDefs = buildingDefs;
    this.canAffordBuilding = canAffordBuildingFn;
    this.onSelectBuildingType = onSelectBuildingType;

    this.chainButtons = new Map();
    this._buildDom();
  }

  _buildDom() {
    const existingChain = document.getElementById('phase5-worker-building-chain');
    if (existingChain) existingChain.remove();
    const existingTip = document.getElementById('phase5-worker-building-tooltip');
    if (existingTip) existingTip.remove();

    this.chainRootEl = document.createElement('div');
    this.chainRootEl.id = 'phase5-worker-building-chain';
    this.chainRootEl.className =
      'pointer-events-auto fixed right-3 top-3 bottom-[236px] z-30 flex flex-col items-center justify-center select-none';

    this.tooltipEl = document.createElement('div');
    this.tooltipEl.id = 'phase5-worker-building-tooltip';
    this.tooltipEl.className =
      'pointer-events-none fixed right-[70px] top-1/3 -translate-y-1/2 z-40 hidden w-60 rounded-xl border border-amber-400/70 bg-slate-950/95 p-3 text-left shadow-2xl backdrop-blur-md';
    document.body.appendChild(this.tooltipEl);

    const buildableKeys = Object.keys(this.buildingDefs).filter(
      (k) => this.buildingDefs[k].buildableByWorker !== false
    );

    const chainWrapper = document.createElement('div');
    chainWrapper.className =
      'pointer-events-auto relative flex flex-col items-center justify-between gap-1 rounded-full border border-amber-500/40 bg-slate-950/85 py-2 px-1.5 shadow-2xl backdrop-blur-md';

    const connectorLine = document.createElement('div');
    connectorLine.className =
      'pointer-events-none absolute top-4 bottom-4 left-1/2 -translate-x-1/2 w-[2px] bg-gradient-to-b from-amber-500/80 via-teal-400/90 to-amber-400/90 shadow-[0_0_8px_rgba(45,212,191,0.75)]';
    chainWrapper.appendChild(connectorLine);

    for (let i = 0; i < buildableKeys.length; i++) {
      const key = buildableKeys[i];
      const def = this.buildingDefs[key];
      const svgIcon = BUILDING_SVG_ICONS[key] || BUILDING_SVG_ICONS.house;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.buildingType = key;
      btn.className =
        'relative z-10 w-9 h-9 rounded-full border-2 border-amber-400/85 bg-slate-900/95 hover:border-teal-300 hover:scale-110 flex items-center justify-center shadow-lg transition cursor-pointer';
      btn.innerHTML = svgIcon;

      btn.addEventListener('mouseenter', () => {
        const rect = btn.getBoundingClientRect();
        this.tooltipEl.style.top = `${Math.round(rect.top + rect.height * 0.5)}px`;
        this._showBuildingTooltip(def);
      });
      btn.addEventListener('mouseleave', () => {
        this.tooltipEl.classList.add('hidden');
      });
      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.canAffordBuilding(def)) return;
        if (this.onSelectBuildingType) {
          this.onSelectBuildingType(key);
        }
      });

      chainWrapper.appendChild(btn);
      this.chainButtons.set(key, btn);
    }

    this.chainRootEl.appendChild(chainWrapper);
    document.body.appendChild(this.chainRootEl);
  }

  _showBuildingTooltip(def) {
    const c = def.cost || {};
    const costParts = [];
    if (c.coins > 0) costParts.push(`${c.coins} Coins`);
    if (c.wood > 0) costParts.push(`${c.wood} Wood`);
    if (c.stone > 0) costParts.push(`${c.stone} Stone`);
    if (c.iron > 0) costParts.push(`${c.iron} Iron`);
    const affordable = this.canAffordBuilding(def);
    const buildSec = Math.round((def.buildTimeTicks || 900) / 20);

    this.tooltipEl.innerHTML = `
      <div class="text-xs font-extrabold uppercase tracking-wider text-amber-300">${def.name}</div>
      <div class="text-[10.5px] font-semibold ${affordable ? 'text-teal-300' : 'text-rose-400'} mono mt-0.5">Cost: ${costParts.join(', ') || 'Free'} • ⏱ ${buildSec}s</div>
      <div class="text-[10.5px] text-slate-200 mt-1 leading-snug">${def.description}</div>
    `;
    this.tooltipEl.classList.remove('hidden');
  }

  setVisible(visible) {
    if (visible) {
      this.chainRootEl.classList.remove('hidden');
    } else {
      this.chainRootEl.classList.add('hidden');
      this.tooltipEl.classList.add('hidden');
    }
  }

  refreshStyles(activePlacementType) {
    for (const [key, btn] of this.chainButtons.entries()) {
      const def = this.buildingDefs[key];
      const affordable = this.canAffordBuilding(def);
      const isSelected = key === activePlacementType;

      if (!affordable) {
        btn.className =
          'relative z-10 w-9 h-9 rounded-full border-2 border-slate-700 bg-slate-900/75 opacity-40 grayscale flex items-center justify-center shadow-inner cursor-not-allowed';
      } else if (isSelected) {
        btn.className =
          'relative z-10 w-9 h-9 rounded-full border-2 border-teal-300 bg-teal-500/30 scale-110 flex items-center justify-center shadow-[0_0_14px_rgba(45,212,191,0.65)] transition cursor-pointer';
      } else {
        btn.className =
          'relative z-10 w-9 h-9 rounded-full border-2 border-amber-400/85 bg-slate-900/95 hover:border-teal-300 hover:scale-110 flex items-center justify-center shadow-lg transition cursor-pointer';
      }
    }
  }
}