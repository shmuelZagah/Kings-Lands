/**
 * Kings Lands — Hall of Heroes DOM Events, Parameter Sync & Render Loop
 * (src/tools/heroes/hallOfHeroesEvents.js)
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
import { modelProvider } from '../../render/modelProvider.js';
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
import { dataRegistry } from '../../data/dataRegistry.js';


export const hallOfHeroesEventsMethods = {
  _bindEvents() {
    const qs = (s) => this.rootContainer.querySelector(s);
    const tipEl = qs('#hh-floating-tooltip');

    this.rootContainer.addEventListener('pointermove', (e) => {
      if (!tipEl) return;
      const spellNode = e.target.closest('[data-spell-hover]');
      if (spellNode && this.currentHero) {
        const spellId = spellNode.dataset.spellHover;
        if (this.inspectedSpellId !== spellId) {
          this.inspectedSpellId = spellId;
          this._renderSpellVfxBar();
        }
        const sp = findSpellDef(this.heroesData, spellId);
        if (sp) {
          const st = this._computeTimelineState(this.currentHero);
          const rank = st.spellRanks.get(spellId) || 0;
          tipEl.innerHTML = this._buildSpellTooltipHtml(sp, rank);
          tipEl.classList.remove('hidden');
          this._positionTooltip(e, tipEl);
          return;
        }
      }
      const tipTarget = e.target.closest('.hh-has-tip');
      if (tipTarget && tipTarget.dataset.tip) {
        tipEl.innerHTML = `<div class="font-semibold text-slate-200">${tipTarget.dataset.tip}</div>`;
        tipEl.classList.remove('hidden');
        this._positionTooltip(e, tipEl);
        return;
      }
      tipEl.classList.add('hidden');
    });

    qs('#hh-btn-exit')?.addEventListener('click', () => {
      this._syncAllInputsFromDom();
      this.heroStateManager.saveDraft();
      if (this.onExitHall) this.onExitHall();
    });

    qs('#hh-btn-export')?.addEventListener('click', () => {
      this.heroStateManager.exportHeroesJson('heroes.json');
      this._toast('Exported heroes.json');
    });

    const impInput = qs('#hh-import-input');
    qs('#hh-btn-import')?.addEventListener('click', () => impInput?.click());
    impInput?.addEventListener('change', async () => {
      const f = impInput.files?.[0];
      impInput.value = '';
      if (!f) return;
      const res = this.heroStateManager.importHeroesJsonText(await f.text());
      if (!res.ok) {
        this._toast(res.error, 4000);
        return;
      }
      this.selectedHeroId = Object.keys(this.heroesMap)[0] || 'wizard';
      this._spawnHeroPreviewModel();
      this._renderAllPanels();
      this._toast('Imported heroes.json');
    });

    qs('#hh-btn-reset')?.addEventListener('click', () => {
      if (!confirm('Reset all Heroes data to defaults?')) return;
      this.heroStateManager.resetToDefault();
      this.selectedHeroId = 'wizard';
      this._spawnHeroPreviewModel();
      this._renderAllPanels();
      this._toast('Defaults restored');
    });

    // Base Archetype selector for + Create New Hero
    qs('#hh-new-archetype-bar')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-new-arch]');
      if (!btn) return;
      this._selectedNewArchetype = btn.dataset.newArch;
      this.rootContainer.querySelectorAll('.hh-arch-btn').forEach((b) => {
        const active = b.dataset.newArch === this._selectedNewArchetype;
        b.className = active
          ? 'hh-arch-btn rounded-lg border border-amber-400 bg-amber-500/20 py-1 text-[10px] font-black text-amber-300 cursor-pointer'
          : 'hh-arch-btn rounded-lg border border-slate-700 bg-slate-900 py-1 text-[10px] font-bold text-slate-300 hover:bg-slate-800 cursor-pointer';
      });
    });

    qs('#hh-btn-create-hero')?.addEventListener('click', () => {
      const arch = this._selectedNewArchetype || 'warrior';
      const created = this.heroStateManager.createNewHero({
        heroClass: arch,
        faction: 'human',
        templateId: arch
      });
      this.selectedHeroId = created.id;
      this.previewLoadoutIdx = 0;
      this.isEditing = true;
      this.activeEditSubmode = 'parameters';
      this._editSnapshot = this.heroStateManager.snapshot();
      this._spawnHeroPreviewModel();
      this._renderAllPanels();
      this._toast(`Created ${created.displayName}`);
    });

    qs('#hh-hero-list')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-hero-id]');
      if (!btn) return;
      this.selectedHeroId = btn.dataset.heroId;
      this.previewLoadoutIdx = 0;
      this.activePreviewAnim = 'idle';
      if (this.isEditing) {
        this._editSnapshot = this.heroStateManager.snapshot();
      }
      this._spawnHeroPreviewModel();
      this._renderAllPanels();
    });

    qs('#hh-btn-preview-loadout')?.addEventListener('click', () => {
      this.previewLoadoutIdx = this.previewLoadoutIdx === 0 ? 1 : 0;
      this._spawnHeroPreviewModel();
      this._renderPreviewHeader();
    });

    qs('#hh-anim-buttons')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-anim]');
      if (!btn) return;
      this._playPreviewAnim(btn.dataset.anim);
    });

    qs('#hh-btn-capture-portrait')?.addEventListener('click', () => {
      if (!this.currentHero || !this.camera) return;
      const hero = this.currentHero;
      const faction = hero.race || 'human';
      const combinedVisuals = buildCombinedVisualsData(
        this._getBaseUnitsData?.() || dataRegistry.getUnitsVisuals(),
        this.heroesData
      );
      const factory = modelProvider.getModelFactory();
      const prevVisuals = factory.visualsData;
      factory.visualsData = combinedVisuals;
      const studio = createPortraitStudio(factory, combinedVisuals);
      let dataUrl = '';
      try {
        const canvas = studio.render(this.selectedHeroId, faction, {
          size: 256,
          background: 'transparent',
          customCamera: {
            position: this.camera.position.clone(),
            target: this.camTarget.clone(),
            fov: this.camera.fov
          }
        });
        dataUrl = canvas.toDataURL('image/png');
      } finally {
        studio.dispose();
        factory.visualsData = prevVisuals;
      }

      this.heroStateManager.setHeroPortrait(this.selectedHeroId, dataUrl);
      this._renderPreviewHeader();
      this._renderHeroList();
      this._toast('Captured');
    });

    qs('#hh-btn-anim-edit')?.addEventListener('click', () => {
      this.heroStateManager.flush();
      if (this.onOpenAnimationLabForHero) {
        this.onOpenAnimationLabForHero(this.selectedHeroId, this.activePreviewAnim, this.previewLoadoutIdx);
      }
    });

    qs('#hh-btn-open-spells-overlay')?.addEventListener('click', () => {
      if (!this.isEditing) {
        this.isEditing = true;
        this._editSnapshot = this.heroStateManager.snapshot();
      }
      this.activeEditSubmode = 'spells';
      this._renderAllPanels();
    });

    qs('#hh-btn-delete-hero')?.addEventListener('click', () => {
      const hero = this.currentHero;
      if (!hero) return;
      if (Object.keys(this.heroesMap).length <= 1) {
        this._toast('Cannot delete the last Hero');
        return;
      }
      if (!confirm(`Delete "${hero.displayName || hero.id}"?`)) return;
      const res = this.heroStateManager.deleteHero(hero.id);
      if (!res.ok) {
        this._toast(res.reason || 'Delete failed');
        return;
      }
      this.selectedHeroId = Object.keys(this.heroesMap)[0] || 'wizard';
      this._spawnHeroPreviewModel();
      this._renderAllPanels();
      this._toast('Deleted');
    });

    qs('#hh-btn-cancel-edit')?.addEventListener('click', () => {
      if (this._editSnapshot) {
        this.heroStateManager.restoreSnapshot(this._editSnapshot);
        this.heroStateManager.saveDraft();
      }
      this.isEditing = false;
      this.activeEditSubmode = 'parameters';
      this._editSnapshot = null;
      if (!this.heroesMap[this.selectedHeroId]) {
        this.selectedHeroId = Object.keys(this.heroesMap)[0] || 'wizard';
      }
      this._spawnHeroPreviewModel();
      this._renderAllPanels();
      this._toast('Canceled changes');
    });

    qs('#hh-btn-edit-toggle')?.addEventListener('click', () => {
      if (!this.isEditing) {
        this.isEditing = true;
        this.activeEditSubmode = 'parameters';
        this._editSnapshot = this.heroStateManager.snapshot();
      } else {
        this._syncAllInputsFromDom();
        this.isEditing = false;
        this.activeEditSubmode = 'parameters';
        this._editSnapshot = null;
        this.heroStateManager.saveDraft();
        this._toast('Saved');
      }
      this._renderAllPanels();
    });

    const paramsScroll = qs('#hh-params-scroll');
    paramsScroll?.addEventListener('input', (e) => {
      const hero = this.currentHero;
      if (!hero || !this.isEditing) return;

      if (e.target.id === 'hh-input-name') {
        hero.displayName = e.target.value;
        hero.name = e.target.value;
        this._renderHeroList();
        this._renderPreviewHeader();
        this.heroStateManager.scheduleSave();
        return;
      }

      const costKey = e.target.dataset.cost;
      if (costKey) {
        if (!hero.parameters.cost) hero.parameters.cost = { coins: 400, wood: 80, stone: 0, iron: 60 };
        hero.parameters.cost[costKey] = Math.max(0, Number(e.target.value) || 0);
        this.heroStateManager.scheduleSave();
        return;
      }

      const paramKey = e.target.dataset.param;
      if (paramKey) {
        const val = parseFloat(e.target.value);
        if (!Number.isNaN(val)) {
          hero.parameters[paramKey] = val;
          if (paramKey === 'visionRange' && hero.heroClass === 'archer') {
            const syncedRange = Math.max(14, Math.round(val * 0.25 * 10) / 10);
            hero.parameters.range = syncedRange;
            const rangeInput = paramsScroll.querySelector('[data-param="range"]');
            if (rangeInput) rangeInput.value = String(syncedRange);
          }
          this.heroStateManager.scheduleSave();
        }
      }
    });

    paramsScroll?.addEventListener('change', (e) => {
      const hero = this.currentHero;
      if (!hero || !this.isEditing) return;
      if (e.target.id === 'hh-input-class') {
        const nextClass = e.target.value;
        this.heroStateManager.applyHeroClassTemplate(hero.id, nextClass);
        this.previewLoadoutIdx = 0;
        this._spawnHeroPreviewModel();
        this._renderAllPanels();
        this._toast(`Switched to ${nextClass.toUpperCase()} base template`);
        return;
      }
      this._syncAllInputsFromDom();
      this.heroStateManager.scheduleSave();
    });

    qs('#hh-btn-skip-level')?.addEventListener('click', () => this._handleSkipLevel());

    qs('#hh-btn-undo-slot')?.addEventListener('click', () => {
      const hero = this.currentHero;
      if (!hero) return;
      const st = this._computeTimelineState(hero);
      const lastFilled = st.nextLevelIdx - 1;
      if (lastFilled < 0) return;
      st.schedule[lastFilled] = null;
      this.heroStateManager.scheduleSave();
      this._renderSpellsWorkspace();
      this._renderAnimButtons();
    });

    qs('#hh-btn-clear-slots')?.addEventListener('click', () => {
      const hero = this.currentHero;
      if (!hero) return;
      hero.spellSchedule = Array.from({ length: 10 }, () => null);
      this.heroStateManager.scheduleSave();
      this._renderSpellsWorkspace();
      this._renderAnimButtons();
    });

    qs('#hh-timeline-circles')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-timeline-idx]');
      if (!btn || !this.currentHero) return;
      const idx = Number(btn.dataset.timelineIdx);
      const schedule = this._ensureSchedule10(this.currentHero);
      for (let i = idx; i < 10; i++) schedule[i] = null;
      this.heroStateManager.scheduleSave();
      this._renderSpellsWorkspace();
      this._renderAnimButtons();
    });

    const ctxMenu = qs('#hh-spell-context-menu');
    const ctxTitle = qs('#hh-spell-ctx-title');
    const hideCtxMenu = () => ctxMenu?.classList.add('hidden');

    this.rootContainer.addEventListener('click', (e) => {
      if (ctxMenu && !ctxMenu.classList.contains('hidden') && !e.target.closest('#hh-spell-context-menu')) {
        hideCtxMenu();
      }
    });

    this.rootContainer.addEventListener('contextmenu', (e) => {
      const spellBtn = e.target.closest('[data-choose-spell]');
      if (!spellBtn) return;
      e.preventDefault();
      const spellId = spellBtn.dataset.chooseSpell;
      const sp = findSpellDef(this.heroesData, spellId);
      if (!sp || !ctxMenu) return;

      this._contextMenuSpellId = spellId;
      tipEl?.classList.add('hidden');
      if (ctxTitle) ctxTitle.textContent = sp.nameEn || sp.name || spellId;
      ctxMenu.classList.remove('hidden');
      const x = Math.min(window.innerWidth - 160, Math.max(8, e.clientX));
      const y = Math.min(window.innerHeight - 90, Math.max(8, e.clientY));
      ctxMenu.style.left = `${Math.round(x)}px`;
      ctxMenu.style.top = `${Math.round(y)}px`;
    });

    qs('#hh-btn-ctx-edit-spell')?.addEventListener('click', () => {
      const sid = this._contextMenuSpellId;
      hideCtxMenu();
      if (sid) this._openSpellEditModal(sid);
    });

    qs('#hh-modal-btn-close')?.addEventListener('click', () => this._closeSpellEditModal());
    qs('#hh-modal-btn-cancel')?.addEventListener('click', () => this._closeSpellEditModal());
    qs('#hh-modal-btn-save')?.addEventListener('click', () => this._saveSpellEditModal());

    qs('#hh-spell-trees-grid')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-choose-spell]');
      if (!btn) return;
      this._handleChooseSpell(btn.dataset.chooseSpell, btn.dataset.treeId);
    });

    qs('#hh-spell-vfx-bar')?.addEventListener('change', (e) => {
      const sp = findSpellDef(this.heroesData, this.inspectedSpellId);
      if (!sp) return;
      if (e.target.id === 'hh-sp-range-in') {
        sp.rangeMeters = Math.max(0, Number(e.target.value) || 0);
        sp.userModifiedRange = true;
      } else if (e.target.id === 'hh-sp-radius-in') {
        sp.radiusMeters = Math.max(0, Number(e.target.value) || 0);
        sp.userModifiedRadius = true;
      } else if (e.target.id === 'hh-sp-vfx-sel') {
        sp.vfxStyle = e.target.value;
        sp.userModifiedVfx = true;
      }
      this.heroStateManager.scheduleSave();
    });

    qs('#hh-btn-spells-to-anim')?.addEventListener('click', () => {
      this.heroStateManager.flush();
      const targetAnim = this.inspectedSpellId ? `spell_${this.inspectedSpellId}` : this.activePreviewAnim;
      if (this.onOpenAnimationLabForHero) {
        this.onOpenAnimationLabForHero(this.selectedHeroId, targetAnim, this.previewLoadoutIdx);
      }
    });

    qs('#hh-btn-spells-done')?.addEventListener('click', () => {
      this.activeEditSubmode = 'parameters';
      this._renderAllPanels();
    });
  },

  _syncAllInputsFromDom() {
    const hero = this.currentHero;
    const paramsScroll = this.rootContainer?.querySelector('#hh-params-scroll');
    if (!hero || !paramsScroll) return;
    if (!hero.parameters) hero.parameters = {};
    if (!hero.parameters.cost) hero.parameters.cost = { coins: 400, wood: 80, stone: 0, iron: 60 };

    const nameIn = paramsScroll.querySelector('#hh-input-name');
    if (nameIn && !nameIn.disabled && nameIn.value.trim()) {
      hero.displayName = nameIn.value.trim();
      hero.name = nameIn.value.trim();
    }

    paramsScroll.querySelectorAll('[data-cost]').forEach((el) => {
      if (el.disabled) return;
      const ck = el.dataset.cost;
      const num = Number(el.value);
      if (ck && !Number.isNaN(num)) {
        hero.parameters.cost[ck] = Math.max(0, Math.round(num));
      }
    });

    paramsScroll.querySelectorAll('[data-param]').forEach((el) => {
      if (el.disabled) return;
      const pk = el.dataset.param;
      const num = parseFloat(el.value);
      if (pk && !Number.isNaN(num)) {
        hero.parameters[pk] = num;
      }
    });
  },

  _startLoop() {
    this._running = true;
    this._lastTime = performance.now();
    const frame = (now) => {
      if (!this._running) return;
      this._raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - this._lastTime) / 1000);
      this._lastTime = now;

      if (this.heroAnimator) {
        this.heroAnimator.update(dt);
      }
      if (this.previewProjectiles && this.previewProjectiles.length > 0) {
        for (let i = this.previewProjectiles.length - 1; i >= 0; i--) {
          const p = this.previewProjectiles[i];
          p.age += dt;
          if (p.age < 0) continue;
          const u = Math.min(1, p.age / p.duration);
          p.mesh.position.lerpVectors(p.start, p.end, u);
          p.mesh.position.y += Math.sin(u * Math.PI) * p.arcHeight;
          if (u >= 1) {
            if (typeof p.onArrival === 'function') p.onArrival();
            this.previewSpellFxGroup?.remove(p.mesh);
            this.previewProjectiles.splice(i, 1);
          }
        }
      }
      if (this.previewFxPulses && this.previewFxPulses.length > 0) {
        for (let i = this.previewFxPulses.length - 1; i >= 0; i--) {
          const fx = this.previewFxPulses[i];
          fx.age += dt;
          if (fx.age < 0) continue;
          if (fx.age >= fx.maxAge) {
            this.previewSpellFxGroup?.remove(fx.mesh);
            this.previewFxPulses.splice(i, 1);
          } else {
            const u = fx.age / fx.maxAge;
            if (typeof fx.customUpdate === 'function') {
              fx.customUpdate(fx, dt, u);
            } else if (fx.isRisingHealRing) {
              fx.mesh.position.y += dt * (fx.riseSpeed || 1.35);
              if (fx.mat) fx.mat.opacity = (1 - u) * 0.88;
            } else {
              const s = 1 + u * 1.6;
              fx.mesh.scale.set(s, s, s);
              if (fx.mat) fx.mat.opacity = (1 - u) * 0.88;
            }
          }
        }
      }
      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
    };
    this._raf = requestAnimationFrame(frame);
  },

  destroy() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    clearTimeout(this._toastTimer);
    window.removeEventListener('resize', this._resizeHandler);
    this._resizeObserver?.disconnect();
    if (this._ownsHeroStateManager) {
      this.heroStateManager?.destroy();
    } else {
      this.heroStateManager?.flush();
    }
    if (this.heroMeshGroup) disposeVisual(this.heroMeshGroup);
    this.renderer?.dispose();
    this.renderer?.domElement?.remove();
    this.rootContainer.innerHTML = '';
  },
};
