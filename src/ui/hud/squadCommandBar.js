import { dataRegistry } from '../../data/dataRegistry.js';
import { UNIT_ICON_SVGS, findCustomIconById } from './unitIconsCatalog.js';
/**
 * Kings Lands — Bottom-Center Squad Command Bar & Top-Right Heroes Bar
 * (src/ui/hud/squadCommandBar.js)
 */

import { EventTypes } from '../../core/eventBus.js';
import { getOrRenderHeroPortraitUrl } from '../../tools/heroes/heroStateManager.js';

const SQUAD_CLASS_SVG = Object.freeze({
  swordsman: `
    <svg class="w-6 h-6 text-sky-300 drop-shadow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14.5 17.5L3 6V3h3l11.5 11.5"/>
      <path d="M13 19l6-6"/>
      <path d="M16 16l4 4"/>
      <path d="M19 21l2-2"/>
    </svg>
  `,
  spearman: `
    <svg class="w-6 h-6 text-teal-300 drop-shadow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      <line x1="5" y1="19" x2="19" y2="5"/>
      <polygon points="19,5 14,6 18,10" fill="currentColor"/>
      <path d="M7 11c0 4 2.5 6.5 5 7.5 2.5-1 5-3.5 5-7.5V7l-5-1.5L7 7v4z" stroke-opacity="0.65"/>
    </svg>
  `,
  archer: `
    <svg class="w-6 h-6 text-emerald-300 drop-shadow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 4c7 3.5 9 8.5 9 8s-2 4.5-9 8"/>
      <line x1="6" y1="4" x2="6" y2="20"/>
      <line x1="4" y1="12" x2="20" y2="12"/>
      <polyline points="16,8 20,12 16,16"/>
    </svg>
  `,
  cavalry: `
    <svg class="w-6 h-6 text-amber-300 drop-shadow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <!-- Elongated Inverted Horseshoe (פרסה מוארכת והפוכה - קשת למעלה ורגליים ארוכות למטה) -->
      <path d="M7.5 20.5 C 5.2 15.5, 5.2 8.5, 6.2 6.5 A 5.8 5.2 0 0 1 17.8 6.5 C 18.8 8.5, 18.8 15.5, 16.5 20.5" stroke-width="2.7"/>
      <path d="M5.5 19.5 L 8.8 21.2" stroke-width="2.8"/>
      <path d="M18.5 19.5 L 15.2 21.2" stroke-width="2.8"/>
      <circle cx="6.1" cy="9.5" r="0.6" fill="#0f172a" stroke="none"/>
      <circle cx="6.0" cy="13.0" r="0.6" fill="#0f172a" stroke="none"/>
      <circle cx="6.4" cy="16.5" r="0.6" fill="#0f172a" stroke="none"/>
      <circle cx="17.9" cy="9.5" r="0.6" fill="#0f172a" stroke="none"/>
      <circle cx="18.0" cy="13.0" r="0.6" fill="#0f172a" stroke="none"/>
      <circle cx="17.6" cy="16.5" r="0.6" fill="#0f172a" stroke="none"/>
    </svg>
  `,
  worker: `
    <svg class="w-6 h-6 text-amber-200 drop-shadow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 6l4 4L7 21H3v-4L14 6z"/>
      <path d="M11 3l6 2 4 4-2 2-4-4-6-2 2-2z"/>
    </svg>
  `,
  hero: `
    <svg class="w-6 h-6 text-amber-300 drop-shadow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 18h18l-2-10-5 4-4-6-4 6-5-4-2 10z" fill="rgba(251,191,36,0.28)"/>
      <line x1="3" y1="21" x2="21" y2="21"/>
    </svg>
  `,
  ballista: `
    <svg class="w-6 h-6 text-orange-300 drop-shadow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 10c6-5 12-5 18 0"/>
      <line x1="12" y1="3" x2="12" y2="19"/>
      <polygon points="12,2 9.5,6 14.5,6" fill="currentColor"/>
      <circle cx="7" cy="19" r="2.2"/>
      <circle cx="17" cy="19" r="2.2"/>
    </svg>
  `
});

const CARDS_PER_ROW = 10;
const MAX_ROWS_PER_PAGE = 3;
const CARDS_PER_PAGE = CARDS_PER_ROW * MAX_ROWS_PER_PAGE; // 30

export class SquadCommandBar {
  constructor({ simBridge, formationPreview, buildingRadialMenu, eventBus, synthAudio }) {
    this.simBridge = simBridge;
    this.formationPreview = formationPreview;
    this.buildingRadialMenu = buildingRadialMenu;
    this.eventBus = eventBus;
    this.synthAudio = synthAudio;

    this.currentPage = 0;
    this._lastRenderSignature = '';
    this._cachedCompanies = new Map();
    this._unitStatsData = dataRegistry.getUnitStats();
    this._unsubRegistry = dataRegistry.subscribe(() => {
      this._unitStatsData = dataRegistry.getUnitStats();
      this._lastRenderSignature = '';
    });
    this._buildDom();
  }

  _buildDom() {
    const existing = document.getElementById('phase7-squad-command-bar');
    if (existing) existing.remove();
    const existingTopHeroes = document.getElementById('phase8-top-right-heroes-bar');
    if (existingTopHeroes) existingTopHeroes.remove();

    this.topRightHeroesEl = document.createElement('aside');
    this.topRightHeroesEl.id = 'phase8-top-right-heroes-bar';
    this.topRightHeroesEl.className =
      'fixed top-3 left-3 z-40 flex flex-col flex-wrap items-start content-start gap-x-4 gap-y-2.5 max-h-[calc(100vh-260px)] select-none pointer-events-auto';
    this.topRightHeroesEl.addEventListener('mousedown', (e) => e.stopPropagation());
    this.topRightHeroesEl.addEventListener('mouseup', (e) => e.stopPropagation());
    this.topRightHeroesEl.addEventListener('dblclick', (e) => e.stopPropagation());
    this.topRightHeroesEl.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.appendChild(this.topRightHeroesEl);

    this.rootEl = document.createElement('section');
    this.rootEl.id = 'phase7-squad-command-bar';
    this.rootEl.className =
      'fixed bottom-2.5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 select-none pointer-events-auto hidden';
    this.rootEl.style.display = 'none';

    this.rootEl.innerHTML = `
      <button
        id="scb-page-prev"
        type="button"
        title="Previous Page"
        style="display: none;"
        class="w-8 h-12 rounded-lg border-2 border-amber-600/80 bg-[radial-gradient(circle_at_35%_30%,#2a2219_0%,#120f0c_85%)] hover:border-amber-400 text-amber-200 font-black text-xs flex items-center justify-center shadow-[0_6px_16px_rgba(0,0,0,0.9),inset_0_1px_2px_rgba(251,191,36,0.25)] cursor-pointer transition"
      >
        ◀
      </button>

      <div
        id="scb-cards-strip"
        class="grid gap-1.5 px-3.5 py-2.5 rounded-lg border-2 border-amber-600/75 shadow-[0_12px_34px_rgba(0,0,0,0.92),inset_0_0_20px_rgba(0,0,0,0.75)] backdrop-blur-md"
        style="background-image: linear-gradient(rgba(10,8,6,0.52), rgba(8,6,5,0.68)), url('/assets/squad_bar_bg.jpg'); background-size: cover; background-position: center;"
      ></div>

      <button
        id="scb-page-next"
        type="button"
        title="Next Page"
        style="display: none;"
        class="w-8 h-12 rounded-lg border-2 border-amber-600/80 bg-[radial-gradient(circle_at_35%_30%,#2a2219_0%,#120f0c_85%)] hover:border-amber-400 text-amber-200 font-black text-xs flex items-center justify-center shadow-[0_6px_16px_rgba(0,0,0,0.9),inset_0_1px_2px_rgba(251,191,36,0.25)] cursor-pointer transition"
      >
        ▶
      </button>
    `;

    document.body.appendChild(this.rootEl);
    this.cardsStripEl = this.rootEl.querySelector('#scb-cards-strip');
    this.prevPageBtn = this.rootEl.querySelector('#scb-page-prev');
    this.nextPageBtn = this.rootEl.querySelector('#scb-page-next');

    this.rootEl.addEventListener('mousedown', (e) => e.stopPropagation());
    this.rootEl.addEventListener('mouseup', (e) => e.stopPropagation());
    this.rootEl.addEventListener('dblclick', (e) => e.stopPropagation());
    this.rootEl.addEventListener('contextmenu', (e) => e.preventDefault());

    this.prevPageBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.currentPage > 0) {
        this.currentPage--;
        this.update(true);
      }
    });

    this.nextPageBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.currentPage++;
      this.update(true);
    });

    this._lastClickedCompanyId = -1;
    this._lastClickTimeMs = 0;
    this._selectionBeforeLastClick = null;

    const handleHeroOrSquadCardClick = (e) => {
      const btn = e.target.closest('[data-company-id]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();

      const cid = Number(btn.getAttribute('data-company-id')) | 0;
      const sel = this.formationPreview?.selection;
      if (!sel) return;

      this.buildingRadialMenu?.close?.();

      const now = performance.now();
      const isDoubleTap =
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        cid === this._lastClickedCompanyId &&
        now - this._lastClickTimeMs <= 380;

      if (isDoubleTap) {
        this._lastClickedCompanyId = -1;
        this._lastClickTimeMs = 0;
        const c = this._cachedCompanies.get(cid) || sel.gatherFriendlyCompanies?.()?.get(cid);
        if (this._selectionBeforeLastClick && this._selectionBeforeLastClick.size > 1 && c) {
          sel.selectedCompanyIds.clear();
          sel.selectedCompanyIds.add(cid);
          for (const prevCid of this._selectionBeforeLastClick) {
            const peerComp = this._cachedCompanies.get(prevCid);
            if (peerComp && peerComp.unitType === c.unitType) {
              sel.selectedCompanyIds.add(prevCid);
            }
          }
          sel.emitSelectionChanged(this._cachedCompanies);
          this.formationPreview?._refreshRadialPanelUI?.();
          this.update(true);
        }
        if (c && this.eventBus) {
          this.eventBus.emit(EventTypes.CAMERA_FOCUS_EVENT, {
            x: c.centerX,
            z: c.centerZ
          });
          if (this.synthAudio) this.synthAudio.playFocusWhoosh?.();
        }
        return;
      }

      this._lastClickedCompanyId = cid;
      this._lastClickTimeMs = now;
      this._selectionBeforeLastClick = new Set(sel.selectedCompanyIds);

      if (e.ctrlKey || e.metaKey) {
        const targetComp = this._cachedCompanies.get(cid);
        if (targetComp) {
          const prevSelected = new Set(sel.selectedCompanyIds);
          if (!e.shiftKey) sel.selectedCompanyIds.clear();
          for (const c of this._cachedCompanies.values()) {
            if (c.unitType === targetComp.unitType && (prevSelected.size <= 1 || prevSelected.has(c.companyId))) {
              sel.selectedCompanyIds.add(c.companyId);
            }
          }
        }
      } else if (e.shiftKey) {
        if (sel.selectedCompanyIds.has(cid)) {
          sel.selectedCompanyIds.delete(cid);
        } else {
          sel.selectedCompanyIds.add(cid);
        }
      } else {
        sel.selectedCompanyIds.clear();
        sel.selectedCompanyIds.add(cid);
      }

      sel.emitSelectionChanged(this._cachedCompanies);
      this.formationPreview?._refreshRadialPanelUI?.();
      this.update(true);
    };
    this.cardsStripEl.addEventListener('click', handleHeroOrSquadCardClick);
    this.topRightHeroesEl.addEventListener('click', handleHeroOrSquadCardClick);
  }

  _updateTopRightHeroesBar(friendlyMap, ecoStates, selectedSet) {
    if (!this.topRightHeroesEl) return;
    const defaultHeroOrder = ['wizard', 'ravan', 'the_king', 'sisnat'];
    const seenHeroIds = new Set();
    const heroItems = [];
    for (const [cid, c] of friendlyMap.entries()) {
      const st = ecoStates[cid];
      if (c && c.unitCount > 0 && (st?.isHero || c.unitType === 'hero')) {
        const resolvedHeroId = st?.heroId || defaultHeroOrder[c.heroVisualIdx | 0] || 'wizard';
        if (seenHeroIds.has(resolvedHeroId)) continue;
        seenHeroIds.add(resolvedHeroId);
        heroItems.push({ c, st: { ...(st || {}), heroId: resolvedHeroId } });
      }
    }

    if (heroItems.length === 0) {
      if (this._lastTopHeroesSig !== '__none__') {
        this._lastTopHeroesSig = '__none__';
        this.topRightHeroesEl.innerHTML = '';
      }
      return;
    }

    const sig = heroItems
      .map(({ c, st }) => {
        const isSel = selectedSet.has(c.companyId) ? 1 : 0;
        const hpPct = st.heroMaxHp > 0 ? Math.round((st.heroHp * 25) / st.heroMaxHp) : 25;
        return `${c.companyId}:${st.heroId || 'wizard'}:${st.heroLevel || 1}:${hpPct}:${st.heroXp || 0}:${isSel}`;
      })
      .join('|');

    if (sig === this._lastTopHeroesSig) return;
    this._lastTopHeroesSig = sig;

    this.topRightHeroesEl.innerHTML = heroItems
      .map(({ c, st }) => {
        const isSel = selectedSet.has(c.companyId);
        const heroId = st.heroId || 'wizard';
        const portraitUrl = getOrRenderHeroPortraitUrl(heroId);
        const hp = st.heroHp ?? 680;
        const maxHp = Math.max(1, st.heroMaxHp ?? 680);
        const hpPct = Math.max(4, Math.min(100, Math.round((hp / maxHp) * 100)));
        const hpCol = hpPct > 55 ? 'bg-emerald-400' : hpPct > 25 ? 'bg-amber-400' : 'bg-rose-500';
        const lvl = st.heroLevel || 1;

        const portraitHtml = portraitUrl
          ? `<img src="${portraitUrl}" alt="" class="w-14 h-14 object-contain pointer-events-none ${
              isSel
                ? 'scale-115 brightness-125 drop-shadow-[0_0_14px_rgba(251,191,36,0.95)]'
                : 'brightness-95 drop-shadow-[0_4px_10px_rgba(0,0,0,0.92)] group-hover:scale-105 group-hover:brightness-110'
            } transition-all duration-150" />`
          : `<div class="w-14 h-14 flex items-center justify-center">${SQUAD_CLASS_SVG.hero}</div>`;

        return `
          <button
            type="button"
            data-company-id="${c.companyId}"
            title="${st.name || c.name}"
            class="group flex items-center gap-2.5 bg-transparent border-0 p-0 transition-all duration-150 cursor-pointer ${
              isSel ? 'scale-[1.12] translate-x-1' : 'opacity-90 hover:opacity-100'
            }"
          >
            <div class="flex flex-col items-center gap-1 w-14">
              <div class="w-14 h-14 flex items-center justify-center overflow-hidden rounded-xl transition-all duration-150 ${
                isSel
                  ? 'ring-2 ring-amber-300 bg-amber-400/20 shadow-[0_0_18px_rgba(251,191,36,0.75)]'
                  : ''
              }">
                ${portraitHtml}
              </div>
              <div class="pointer-events-none w-14 h-1.5 rounded-full bg-slate-950/95 border ${
                isSel ? 'border-amber-300/90 shadow-[0_0_8px_rgba(251,191,36,0.65)]' : 'border-slate-800'
              } overflow-hidden shadow">
                <div class="h-full ${hpCol}" style="width: ${hpPct}%;"></div>
              </div>
            </div>
            <div class="pointer-events-none flex flex-col items-start text-left leading-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]">
              <span class="text-xs font-black tracking-wide ${
                isSel ? 'text-amber-200 drop-shadow-[0_0_8px_rgba(251,191,36,0.85)]' : 'text-slate-100'
              }">${st.name || c.name}</span>
              <span class="mono text-[10.5px] font-extrabold ${
                isSel ? 'text-amber-300 brightness-125' : 'text-amber-300/90'
              }">Level ${lvl}</span>
            </div>
          </button>
        `;
      })
      .join('');
  }

  update(force = false) {
    const sel = this.formationPreview?.selection;
    if (!sel) return;

    const friendlyMap = sel.gatherFriendlyCompanies();
    this._cachedCompanies = friendlyMap;
    const ecoStates = this.simBridge.getEconomyState?.()?.companyStates || {};
    const selectedSet = sel.selectedCompanyIds;
    this._updateTopRightHeroesBar(friendlyMap, ecoStates, selectedSet);

    const selectedList = [];
    for (const cid of selectedSet) {
      const c = friendlyMap.get(cid);
      if (c && c.unitCount > 0) {
        selectedList.push(c);
      }
    }
    selectedList.sort((a, b) => a.companyId - b.companyId);

    if (selectedList.length === 0) {
      this.currentPage = 0;
      if (this._lastRenderSignature !== '__empty__') {
        this._lastRenderSignature = '__empty__';
        this.rootEl.classList.add('hidden');
        this.rootEl.style.display = 'none';
      }
      return;
    }

    this.rootEl.classList.remove('hidden');
    this.rootEl.style.display = 'flex';

    const totalPages = Math.max(1, Math.ceil(selectedList.length / CARDS_PER_PAGE));
    if (this.currentPage >= totalPages) {
      this.currentPage = totalPages - 1;
    }

    const sigParts = [`p${this.currentPage}/${totalPages}`];
    for (let i = 0; i < selectedList.length; i++) {
      const c = selectedList[i];
      const st = ecoStates[c.companyId] || {};
      const maxAmmo = st.maxAmmo | 0;
      const ammoBucket = maxAmmo > 0 ? Math.round(((st.ammo | 0) * 20) / maxAmmo) : -1;
      const broken = st.isBroken ? 1 : 0;
      const heroHpBucket = st.isHero && st.heroMaxHp > 0 ? Math.round(((st.heroHp | 0) * 25) / st.heroMaxHp) : -1;
      sigParts.push(`${c.companyId}:${c.unitType}:${c.unitCount}:${ammoBucket}:${heroHpBucket}:${broken}`);
    }
    const sig = sigParts.join('|');
    if (!force && sig === this._lastRenderSignature) return;
    this._lastRenderSignature = sig;

    const pageStart = this.currentPage * CARDS_PER_PAGE;
    const pageItems = selectedList.slice(pageStart, pageStart + CARDS_PER_PAGE);
    const cols = Math.min(CARDS_PER_ROW, Math.max(1, pageItems.length));
    this.cardsStripEl.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;

    if (this.prevPageBtn && this.nextPageBtn) {
      if (totalPages > 1) {
        this.prevPageBtn.style.display = 'flex';
        this.nextPageBtn.style.display = 'flex';
        this.prevPageBtn.disabled = this.currentPage <= 0;
        this.nextPageBtn.disabled = this.currentPage >= totalPages - 1;
        this.prevPageBtn.style.opacity = this.currentPage <= 0 ? '0.35' : '1';
        this.nextPageBtn.style.opacity = this.currentPage >= totalPages - 1 ? '0.35' : '1';
      } else {
        this.prevPageBtn.style.display = 'none';
        this.nextPageBtn.style.display = 'none';
      }
    }

    this.cardsStripEl.innerHTML = pageItems
      .map((c, idx) => {
        const globalIdx = pageStart + idx + 1;
        const st = ecoStates[c.companyId] || {};
        const isBroken = Boolean(st.isBroken);
        const maxAmmo = st.maxAmmo | 0;
        const hasAmmo = maxAmmo > 0;
        const ammoPct = hasAmmo
          ? Math.max(0, Math.min(100, Math.round(((st.ammo | 0) * 100) / maxAmmo)))
          : 0;
        const displayName = st.name || c.name || c.unitType;
        const isHeroCard = Boolean(st.isHero || c.unitType === 'hero');

        if (isHeroCard) {
          const heroPortrait = getOrRenderHeroPortraitUrl(st.heroId || 'wizard');
          const hp = st.heroHp ?? 680;
          const maxHp = Math.max(1, st.heroMaxHp ?? 680);
          const hpPct = Math.max(4, Math.min(100, Math.round((hp / maxHp) * 100)));
          const hpCol = hpPct > 55 ? 'bg-emerald-400' : hpPct > 25 ? 'bg-amber-400' : 'bg-rose-500';
          return `
            <button
              type="button"
              data-company-id="${c.companyId}"
              title="${displayName}"
              class="relative w-[54px] h-[54px] rounded-lg border-2 border-amber-500/85 bg-[#120e0a]/90 shadow-[0_4px_14px_rgba(0,0,0,0.9),inset_0_1px_2px_rgba(251,191,36,0.35)] hover:border-amber-300 overflow-hidden p-0 transition-all cursor-pointer shrink-0"
            >
              ${
                heroPortrait
                  ? `<img src="${heroPortrait}" alt="" class="w-full h-full object-cover pointer-events-none" />`
                  : `<div class="w-full h-full flex items-center justify-center">${SQUAD_CLASS_SVG.hero}</div>`
              }
              <div class="pointer-events-none absolute inset-x-1 bottom-1 h-1.5 rounded-full bg-slate-950/95 border border-slate-800 overflow-hidden">
                <div class="h-full ${hpCol}" style="width: ${hpPct}%;"></div>
              </div>
            </button>
          `;
        }

        const unitStatsData = this._unitStatsData || dataRegistry.getUnitStats();
        const uStat = unitStatsData?.units?.[c.unitType];
        const customFromLib = uStat?.squadCardIconKey
          ? findCustomIconById(unitStatsData?.customPlaceholderIcons, uStat.squadCardIconKey)?.dataUrl
          : null;
        const customIconUrl = uStat?.squadCardIconUrl || customFromLib || null;
        const chosenIconKey = uStat?.squadCardIconKey || null;
        const fallbackRoleKey = uStat
          ? (uStat.isWorker ? 'worker' : uStat.isSiege ? 'ballista' : uStat.isMounted ? 'cavalry' : uStat.isRanged ? 'archer' : 'swordsman')
          : c.unitType;
        const TACTICAL_IMG_ROLES = new Set(['swordsman', 'spearman', 'archer', 'cavalry', 'worker', 'hero', 'ballista']);
        const imgRole = TACTICAL_IMG_ROLES.has(c.unitType)
          ? c.unitType
          : TACTICAL_IMG_ROLES.has(fallbackRoleKey)
            ? fallbackRoleKey
            : 'swordsman';
        const fullCardImgUrl = customIconUrl || `/assets/tactical_icon_${imgRole}.jpg`;

        const borderCls = isBroken
          ? 'border-rose-500 bg-[radial-gradient(circle_at_35%_30%,#4a161c_0%,#1c080a_85%)] shadow-[0_0_12px_rgba(244,63,94,0.5)] animate-pulse'
          : 'border-amber-600/85 bg-[#120e0a]/90 shadow-[0_4px_12px_rgba(0,0,0,0.88),inset_0_1px_2px_rgba(251,191,36,0.28)] hover:border-amber-400 hover:brightness-110';

        const ammoColor =
          ammoPct > 50 ? 'bg-amber-300' : ammoPct > 20 ? 'bg-orange-400' : 'bg-rose-500';

        return `
          <button
            type="button"
            data-company-id="${c.companyId}"
            title="${displayName} (${c.unitCount} units)${hasAmmo ? ` — Ammo: ${ammoPct}%` : ''} — Click to Select, Shift+Click to Deselect, Double-Click to Focus"
            class="relative w-[54px] h-[54px] rounded-lg border-2 ${borderCls} overflow-hidden p-0 transition-all cursor-pointer shrink-0"
          >
            <img src="${fullCardImgUrl}" alt="${displayName}" class="w-full h-full object-cover pointer-events-none" />

            <span class="pointer-events-none absolute top-0.5 right-0.5 px-1 py-0.5 rounded bg-black/80 border border-amber-500/60 text-[10px] font-black text-amber-200 mono leading-none shadow">
              ${c.unitCount}
            </span>

            ${
              hasAmmo
                ? `<div class="pointer-events-none absolute inset-x-1 bottom-1 h-1 rounded-full bg-black/90 overflow-hidden" title="Ammo: ${ammoPct}%">
                     <div class="h-full ${ammoColor}" style="width: ${ammoPct}%;"></div>
                   </div>`
                : ''
            }
          </button>
        `;
      })
      .join('');
  }
}

