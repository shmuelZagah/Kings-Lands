/**
 * Kings Lands — Phase 8: In-Game HUD Visibility & Selection State Manager
 * (src/ui/hud/hudVisibilityManager.js)
 *
 * Ensures that entering any Lab/Tool (Animation Lab / Studio or Hall of Heroes)
 * completely hides and clears the in-game Resources HUD, Minimap, Worker build chain,
 * Building Radial Menu, Tactical Orb, Squad Command Bar, and Dev Console,
 * and restores them cleanly when returning to the main game.
 */

const GAME_HUD_ELEMENT_IDS = Object.freeze([
  'phase5-resource-bar',
  'phase7-minimap-orb',
  'phase5-worker-building-chain',
  'phase5-worker-building-tooltip',
  'phase4-orb-dial-panel',
  'phase5-building-radial-menu',
  'phase5-building-orb-panel',
  'phase7-squad-command-bar',
  'phase7-victory-modal',
  'phase5-dev-console',
  'phase5-floating-text-layer',
  'phase8-top-right-heroes-bar',
  'phase8-top-tools-bar'
]);

export function clearAndHideGameHud(sceneManager = null) {
  // 1. Clear active selections & placement modes in SceneManager controllers if present
  if (sceneManager) {
    try {
      sceneManager.pausedForLab = true;
      sceneManager.workerPlacementController?.cancelPlacementMode?.();
      sceneManager.workerPlacementController?.buildChainMenu?.setVisible?.(false);
      sceneManager.buildingRadialMenu?.close?.();
      sceneManager.devConsole?.close?.();
      if (sceneManager.formationPreview?.selection) {
        sceneManager.formationPreview.selection.selectedCompanyIds?.clear?.();
        sceneManager.formationPreview.selection.hideMarquee?.();
        sceneManager.formationPreview.selection.emitSelectionChanged?.();
      }
      sceneManager.formationPreview?.cancelRightDrag?.();
      sceneManager.formationPreview?._refreshRadialPanelUI?.();
      sceneManager.squadCommandBar?.update?.(true);
    } catch (_) {
      // Ignore cleanup errors during lab transition
    }
  }

  // 2. Hide all fixed in-game HUD overlays and the #app battlefield container
  for (let i = 0; i < GAME_HUD_ELEMENT_IDS.length; i++) {
    const el = document.getElementById(GAME_HUD_ELEMENT_IDS[i]);
    if (el) {
      el.dataset.hiddenByLab = '1';
      el.classList.add('hidden');
      el.style.display = 'none';
    }
  }

  const appEl = document.getElementById('app');
  if (appEl) {
    appEl.classList.add('hidden');
    appEl.style.display = 'none';
  }

  // Also hide any top bar containing #btn-open-studio in index.html while inside a Lab
  const studioBtn = document.getElementById('btn-open-studio');
  if (studioBtn) {
    const parentBar = studioBtn.closest('header, nav, .top-bar') || studioBtn;
    if (parentBar && parentBar !== document.body && !parentBar.contains(document.getElementById('studio-root'))) {
      parentBar.dataset.hiddenByLab = '1';
      parentBar.style.display = 'none';
    }
  }
}

export function restoreGameHud(sceneManager = null) {
  const appEl = document.getElementById('app');
  if (appEl) {
    appEl.classList.remove('hidden');
    appEl.style.display = '';
  }

  // Restore any index.html top bar that was hidden when entering a Lab
  document.querySelectorAll('[data-hidden-by-lab="1"]').forEach((el) => {
    delete el.dataset.hiddenByLab;
    el.style.display = '';
  });

  // Always restore the persistent Top Resource Bar, Minimap, and Top Tools Bar
  for (const id of ['phase5-resource-bar', 'phase7-minimap-orb', 'phase5-floating-text-layer', 'phase8-top-right-heroes-bar', 'phase8-top-tools-bar']) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('hidden');
      el.style.display = '';
    }
  }

  // Contextual HUD bars remain hidden until a unit/worker/building is selected again
  for (const id of [
    'phase5-worker-building-chain',
    'phase5-worker-building-tooltip',
    'phase5-building-radial-menu',
    'phase5-building-orb-panel',
    'phase7-squad-command-bar',
    'phase7-victory-modal',
    'phase5-dev-console'
  ]) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('hidden');
      if (id === 'phase7-squad-command-bar') el.style.display = 'none';
      else el.style.display = '';
    }
  }

  if (sceneManager) {
    sceneManager.pausedForLab = false;
    sceneManager.formationPreview?._refreshRadialPanelUI?.();
    sceneManager.squadCommandBar?.update?.(true);
    sceneManager.minimapHud?.update?.(performance.now());
  }
}
