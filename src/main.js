import { CommandBus, CommandTypes } from './core/commandBus.js';
import { EventBus, EventTypes } from './core/eventBus.js';
import { SimBridge } from './sim/simBridge.js';
import { SceneManager } from './render/sceneManager.js';
import { SynthAudio } from './audio/synthAudio.js';
import { StudioApp } from './tools/studio/studioApp.js';
import { HallOfHeroesApp } from './tools/heroes/hallOfHeroesApp.js';
import { HeroStateManager } from './tools/heroes/heroStateManager.js';
import { UnitsBuildingsLabApp } from './tools/units_buildings/unitsBuildingsLabApp.js';
import { UnitsBuildingsStateManager } from './tools/units_buildings/unitsBuildingsStateManager.js';
import { MapEditorApp } from './tools/map_editor/mapEditorApp.js';
import {
  PreGameLobbyModal,
  EscPauseMenuModal,
  getActiveMatchSetup,
  setActiveMatchSetup,
  buildDefaultMatchSetupForMap
} from './ui/lobby/matchSetupManager.js';
import { getActiveCustomMapState } from './tools/map_editor/mapStateManager.js';
import { loadLearnedAiModel } from './sim/ai/aiLearningModel.js';
import { loadGameSettings, applySettingsToRuntime, saveGameSnapshot } from './core/gameSettingsAndSaves.js';

const sharedUbStateManager = new UnitsBuildingsStateManager();
const sharedHeroStateManager = new HeroStateManager();
import { clearAndHideGameHud, restoreGameHud } from './ui/hud/hudVisibilityManager.js';
import { dataRegistry } from './data/dataRegistry.js';
import { setSimDataSource } from './sim/simConfig.js';

const engineConfig = dataRegistry.getEngineConfig();
// HUD / formation helpers share sim code: on the main thread they read the live registry data (no copies).
setSimDataSource(() => dataRegistry.getSimView());

// Visible warning when the browser refuses to store the data (quota): the edit still works everywhere in this session,
// but it would be lost on reload - say so instead of failing silently.
if (typeof window !== 'undefined') {
  window.addEventListener('kings_lands_registry_persist_failed', (e) => {
    let el = document.getElementById('kl-persist-warning');
    if (!el) {
      el = document.createElement('div');
      el.id = 'kl-persist-warning';
      el.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:99999;background:#7f1d1d;color:#fff;padding:8px 14px;border-radius:10px;font:600 13px system-ui;box-shadow:0 4px 18px #000a;cursor:pointer;max-width:80vw';
      el.title = 'click to dismiss';
      el.addEventListener('click', () => el.remove());
      document.body.appendChild(el);
    }
    el.textContent = 'Not saved to browser storage (' + (e?.detail?.error || 'storage full') + '). Your edits work now but will be lost on reload - use Export JSON.';
  });
  // console helper for bug reports:  __klDiag()
  window.__klDiag = () => dataRegistry.diagnostics();
  window.__dataRegistry = dataRegistry;
}

let activeStudio = null;
let activeHallOfHeroes = null;
let activeUnitsBuildingsLab = null;
let activeMapEditor = null;
let activePreGameLobby = null;
let activeEscPauseMenu = null;
let activeSceneManager = null;
let activeSimBridge = null;

// A running match keeps the data snapshot it started with: say so when game data changes underneath it
// (the labs stop the match when they open, so this only shows for edits made by other means, e.g. an import).
dataRegistry.subscribe(() => {
  if (!activeSimBridge) return;
  let el = document.getElementById('kl-next-match-notice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'kl-next-match-notice';
    el.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:99998;background:#1e3a5f;color:#fff;padding:7px 14px;border-radius:10px;font:600 13px system-ui;box-shadow:0 4px 18px #000a;pointer-events:none;transition:opacity .4s';
    document.body.appendChild(el);
  }
  el.textContent = 'Game data changed - changes apply from the next match.';
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 4000);
});
let telemetryTimerId = null;

function isStudioRoute() {
  const path = window.location.pathname.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  return path.startsWith('/studio') || params.has('studio');
}

function isHeroesRoute() {
  const path = window.location.pathname.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  return path.startsWith('/heroes') || params.has('heroes');
}

function isUnitsBuildingsRoute() {
  const path = window.location.pathname.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  return path.startsWith('/units-lab') || params.has('units-lab') || params.has('units');
}

function isMapEditorRoute() {
  const path = window.location.pathname.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  return path.startsWith('/map-editor') || params.has('map-editor') || params.has('map');
}

function getOrCreateRootContainer(id) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }
  el.classList.remove('hidden');
  el.style.display = '';
  return el;
}

function destroyActiveLabs() {
  if (activeStudio) {
    activeStudio.destroy();
    activeStudio = null;
  }
  if (activeHallOfHeroes) {
    activeHallOfHeroes.destroy();
    activeHallOfHeroes = null;
  }
  if (activeUnitsBuildingsLab) {
    activeUnitsBuildingsLab.destroy();
    activeUnitsBuildingsLab = null;
  }
  if (activeMapEditor) {
    activeMapEditor.destroy();
    activeMapEditor = null;
  }
  if (activePreGameLobby) {
    activePreGameLobby.destroy();
    activePreGameLobby = null;
  }
  if (activeEscPauseMenu) {
    activeEscPauseMenu.close();
    activeEscPauseMenu = null;
  }

  for (const rootId of [
    'studio-root',
    'heroes-hall-root',
    'units-buildings-lab-root',
    'map-editor-root',
    'phase8-top-tools-bar'
  ]) {
    const el = document.getElementById(rootId);
    if (el) {
      el.className = 'hidden';
      el.style.display = 'none';
      el.innerHTML = '';
      el.remove();
    }
  }
}

/**
 * Launches the Full-Screen Main Menu & Match Setup Screen (`PreGameLobbyModal`).
 */
function launchPreGameLobby(initialView = 'home') {
  if (activeSimBridge) {
    activeSimBridge.stop();
  }
  clearAndHideGameHud(activeSceneManager);
  destroyActiveLabs();

  activePreGameLobby = new PreGameLobbyModal({
    onStartGame: (matchSetup) => {
      destroyActiveLabs();
      restoreGameHud(activeSceneManager);
      initBattlefieldApp(matchSetup);
    },
    onOpenMapEditor: () => {
      window.history.pushState({}, '', '/map-editor');
      launchMapEditor();
    },
    onOpenLab: (which) => {
      if (which === 'units') {
        window.history.pushState({}, '', '/units-lab');
        launchUnitsBuildingsLab({ returnToLobby: true });
      } else if (which === 'heroes') {
        window.history.pushState({}, '', '/heroes');
        launchHallOfHeroes({ returnToLobby: true });
      } else if (which === 'studio') {
        window.history.pushState({}, '', '/studio');
        launchStudio({ returnToLobby: true });
      }
    }
  });
  activePreGameLobby.show();
}

/**
 * Launches the Animation Lab (`StudioApp`).
 */
function launchStudio(options = {}) {
  if (activeSimBridge) {
    activeSimBridge.stop();
  }
  clearAndHideGameHud(activeSceneManager);
  destroyActiveLabs();

  const studioContainer = getOrCreateRootContainer('studio-root');
  const contextualHeroId = options.contextualHeroId || null;
  const contextualUnitId = options.contextualUnitId || null;
  const contextualBuildingId = options.contextualBuildingId || null;

  activeStudio = new StudioApp(studioContainer, {
    ubStateManager: sharedUbStateManager,
    heroStateManager: sharedHeroStateManager,
    contextualHeroId,
    contextualUnitId,
    contextualBuildingId,
    initialAnim: options.initialAnim || null,
    initialFaction: options.initialFaction || null,
    initialLoadoutIdx: options.initialLoadoutIdx || 0,
    initialInspectorTab: options.initialInspectorTab || null,
    initialCategory:
      options.initialCategory ||
      (contextualHeroId ? 'heroes' : contextualBuildingId ? 'buildings' : 'units'),
    initialUnitId: options.initialUnitId || contextualUnitId || contextualBuildingId || null,
    onOpenHallOfHeroes: () => {
      launchHallOfHeroes({ returnToLobby: Boolean(options.returnToLobby) });
    },
    onOpenUnitsBuildingsLab: (labOpts = {}) => {
      launchUnitsBuildingsLab({ returnToLobby: Boolean(options.returnToLobby), ...labOpts });
    },
    onExitStudio: (exitPayload = null) => {
      const lastBaseAnim = exitPayload?.anim || activeStudio?.timelineEditor?.activeBaseName || options.initialAnim || 'idle';
      const returnAnim =
        lastBaseAnim === 'idle' ||
        lastBaseAnim === 'walk' ||
        lastBaseAnim === 'gallop' ||
        lastBaseAnim === 'run' ||
        lastBaseAnim === 'charge' ||
        lastBaseAnim === 'switch_weapon' ||
        lastBaseAnim === 'block' ||
        lastBaseAnim === 'die' ||
        lastBaseAnim.startsWith('spell_')
          ? (lastBaseAnim === 'gallop' ? 'walk' : lastBaseAnim)
          : 'attack';
      const returnLoadoutIdx =
        typeof exitPayload?.loadoutIdx === 'number'
          ? exitPayload.loadoutIdx
          : (activeStudio?.currentLoadout && activeStudio.currentLoadout !== 'main' ? 1 : 0);
      destroyActiveLabs();
      if (contextualHeroId) {
        launchHallOfHeroes({
          initialHeroId: contextualHeroId,
          initialAnim: returnAnim,
          initialLoadoutIdx: returnLoadoutIdx,
          startInEditMode: true
        });
        return;
      }
      if (contextualUnitId) {
        const returnUnitId =
          exitPayload?.unitId && sharedUbStateManager.unitStatsData.units?.[exitPayload.unitId]
            ? exitPayload.unitId
            : contextualUnitId;
        launchUnitsBuildingsLab({
          returnToLobby: Boolean(options.returnToLobby),
          initialTab: 'units',
          initialUnitId: returnUnitId,
          initialAnim: returnAnim,
          initialLoadoutIdx: returnLoadoutIdx
        });
        return;
      }
      if (contextualBuildingId) {
        const returnBldId =
          exitPayload?.unitId && sharedUbStateManager.buildingsData.buildings?.[exitPayload.unitId]
            ? exitPayload.unitId
            : contextualBuildingId;
        launchUnitsBuildingsLab({
          returnToLobby: Boolean(options.returnToLobby),
          initialTab: 'buildings',
          initialBuildingId: returnBldId
        });
        return;
      }
      if (
        window.location.pathname.startsWith('/studio') ||
        window.location.search.includes('studio')
      ) {
        window.history.pushState({}, '', '/');
      }
      if (options.returnToLobby) {
        launchPreGameLobby();
        return;
      }
      restoreGameHud(activeSceneManager);
      initBattlefieldApp();
    }
  });
}

function launchHallOfHeroes(options = {}) {
  if (activeSimBridge) {
    activeSimBridge.stop();
  }
  clearAndHideGameHud(activeSceneManager);
  destroyActiveLabs();

  const hallContainer = getOrCreateRootContainer('heroes-hall-root');
  activeHallOfHeroes = new HallOfHeroesApp(hallContainer, {
    heroStateManager: sharedHeroStateManager,
    ubStateManager: sharedUbStateManager,
    initialHeroId: options.initialHeroId || 'wizard',
    initialAnim: options.initialAnim || 'idle',
    initialLoadoutIdx: options.initialLoadoutIdx || 0,
    startInEditMode: Boolean(options.startInEditMode),
    initialEditSubmode: options.initialEditSubmode || 'parameters',
    onOpenAnimationLabForHero: (heroId, activeAnim = 'idle', loadoutIdx = 0) => {
      launchStudio({
        contextualHeroId: heroId,
        initialAnim: activeAnim,
        initialLoadoutIdx: loadoutIdx
      });
    },
    onExitHall: () => {
      destroyActiveLabs();
      if (
        window.location.pathname.startsWith('/heroes') ||
        window.location.search.includes('heroes')
      ) {
        window.history.pushState({}, '', '/');
      }
      if (options.returnToLobby) {
        launchPreGameLobby();
        return;
      }
      restoreGameHud(activeSceneManager);
      initBattlefieldApp();
    }
  });
}

function launchUnitsBuildingsLab(options = {}) {
  if (activeSimBridge) {
    activeSimBridge.stop();
  }
  clearAndHideGameHud(activeSceneManager);
  destroyActiveLabs();

  const labContainer = getOrCreateRootContainer('units-buildings-lab-root');
  activeUnitsBuildingsLab = new UnitsBuildingsLabApp(labContainer, {
    stateManager: sharedUbStateManager,
    initialTab: options.initialTab || 'units',
    initialUnitId: options.initialUnitId || 'swordsman',
    initialBuildingId: options.initialBuildingId || null,
    initialAnim: options.initialAnim || 'idle',
    initialLoadoutIdx: options.initialLoadoutIdx || 0,
    onOpenAnimationLab: (studioOpts = {}) => {
      launchStudio({ returnToLobby: Boolean(options.returnToLobby), ...studioOpts });
    },
    onOpenHallOfHeroes: () => {
      launchHallOfHeroes({ returnToLobby: Boolean(options.returnToLobby) });
    },
    onExitLab: () => {
      destroyActiveLabs();
      if (
        window.location.pathname.startsWith('/units-lab') ||
        window.location.search.includes('units')
      ) {
        window.history.pushState({}, '', '/');
      }
      if (options.returnToLobby) {
        launchPreGameLobby();
        return;
      }
      restoreGameHud(activeSceneManager);
      initBattlefieldApp();
    }
  });
}

/**
 * Launches the Unity-Style 3D Map Editor (`MapEditorApp`).
 */
function launchMapEditor(options = {}) {
  if (activeSimBridge) {
    activeSimBridge.stop();
  }
  clearAndHideGameHud(activeSceneManager);
  destroyActiveLabs();

  const mapEditorContainer = getOrCreateRootContainer('map-editor-root');
  activeMapEditor = new MapEditorApp(mapEditorContainer, {
    ...options,
    onExitMapEditor: (exitPayload = {}) => {
      destroyActiveLabs();
      if (
        window.location.pathname.startsWith('/map-editor') ||
        window.location.search.includes('map')
      ) {
        window.history.pushState({}, '', '/');
      }
      if (exitPayload?.saved && exitPayload?.mapState) {
        const syncedSetup = buildDefaultMatchSetupForMap(exitPayload.mapState);
        setActiveMatchSetup(syncedSetup);
      }
      launchPreGameLobby();
    }
  });
}

function initBattlefieldApp(customMatchSetup = null) {
  destroyActiveLabs();
  const appContainer = document.getElementById('app');
  if (!appContainer) return;
  appContainer.innerHTML = '';
  appContainer.classList.remove('hidden');
  appContainer.style.display = 'block';

  if (activeSceneManager) {
    activeSceneManager.destroy?.();
    activeSceneManager = null;
  }
  if (activeSimBridge) {
    activeSimBridge.stop();
    activeSimBridge = null;
  }
  if (telemetryTimerId) {
    clearInterval(telemetryTimerId);
    telemetryTimerId = null;
  }

  let matchSetup = customMatchSetup || getActiveMatchSetup();
  const activeCustomMap = getActiveCustomMapState();
  if (activeCustomMap && activeCustomMap.isCustomMapActive && matchSetup.mapId !== activeCustomMap.id) {
    matchSetup = buildDefaultMatchSetupForMap(activeCustomMap);
    setActiveMatchSetup(matchSetup);
  }

  const worldSizeMeters = Number(matchSetup?.worldSizeMeters || activeCustomMap?.worldSizeMeters) || 4096;
  const tilesCount = Math.max(256, Math.round(worldSizeMeters / 4));

  const playerSlot =
    matchSetup?.participants?.find((p) => p.role === 'player') ||
    matchSetup?.participants?.[0] ||
    { x: Math.round(worldSizeMeters * 0.5), z: Math.round(worldSizeMeters * 0.4) };

  const runtimeConfig = {
    ...engineConfig,
    simulation: {
      ...(engineConfig.simulation || {}),
      initialSeed: (Date.now() & 0x7fffffff) || 133742069
    },
    learnedAiModel: loadLearnedAiModel(),
    loadedSaveState: matchSetup?.loadedSaveState || null,
    matchSetup,
    map: {
      ...(engineConfig.map || {}),
      tilesX: tilesCount,
      tilesZ: tilesCount,
      tileSizeMeters: 4
    },
    camera: {
      ...(engineConfig.camera || {}),
      initialTargetX: Number(playerSlot.x) || 2048,
      initialTargetZ: Number(playerSlot.z) || 1660
    }
  };

  const commandBus = new CommandBus();
  const eventBus = new EventBus();
  const synthAudio = new SynthAudio();

  const simBridge = new SimBridge({ config: runtimeConfig, commandBus, eventBus });
  const sceneManager = new SceneManager({
    container: appContainer,
    config: runtimeConfig,
    simBridge,
    commandBus,
    eventBus,
    synthAudio
  });

  if (sceneManager.cameraController?.target) {
    sceneManager.cameraController.target.set(
      Number(playerSlot.x) || 2048,
      0,
      Number(playerSlot.z) || 1660
    );
  }

  activeSimBridge = simBridge;
  activeSceneManager = sceneManager;
  applySettingsToRuntime(loadGameSettings(), { synthAudio, sceneManager });
  restoreGameHud(sceneManager);

  // Set up ESC Pause Menu Modal (with Labs inside ESC, and NO Map Editor button inside ESC!)
  const isDevMode = Boolean(matchSetup?.isDevMode);
  activeEscPauseMenu = new EscPauseMenuModal({
    isDevMode,
    onResume: () => {
      activeSimBridge?.setPaused?.(false);
    },
    onSaveGame: async () => {
      const snap = await activeSimBridge?.requestSaveState?.();
      if (!snap) return false;
      const mode = isDevMode ? 'dev' : 'player';
      const setupToSave = { ...matchSetup };
      delete setupToSave.loadedSaveState;
      const activeCustom = getActiveCustomMapState();
      saveGameSnapshot(mode, {
        name: `${matchSetup?.mapName || 'Royal Valley'} (${mode === 'dev' ? 'Dev' : 'Player'})`,
        mapName: matchSetup?.mapName || 'Royal Valley Crossroads',
        tick: snap.tick || 0,
        matchSetup: setupToSave,
        customMapState: activeCustom && activeCustom.isCustomMapActive ? activeCustom : null,
        simSnapshot: snap
      });
      return true;
    },
    onLoadGame: () => {
      activeSimBridge?.setPaused?.(false);
      launchPreGameLobby('load_menu');
    },
    onOpenLab: (which) => {
      activeSimBridge?.setPaused?.(false);
      if (which === 'units') {
        window.history.pushState({}, '', '/units-lab');
        launchUnitsBuildingsLab({ returnToLobby: false });
      } else if (which === 'heroes') {
        window.history.pushState({}, '', '/heroes');
        launchHallOfHeroes({ returnToLobby: false });
      } else if (which === 'studio') {
        window.history.pushState({}, '', '/studio');
        launchStudio({ returnToLobby: false });
      }
    },
    onExitToLobby: () => {
      activeSimBridge?.setPaused?.(false);
      launchPreGameLobby();
    }
  });

  const isTextInputFocused = () =>
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

  if (!window.__kingsLandsInputRouterBound) {
    window.__kingsLandsInputRouterBound = true;
    window.addEventListener(
      'keydown',
      (e) => {
        if (isTextInputFocused()) {
          activeSceneManager?.cameraController?.clearInputState?.();
          if (e.code !== 'Enter' && e.code !== 'Escape') {
            e.stopImmediatePropagation();
          }
          return;
        }
        if (e.code === 'Escape' && activeSceneManager && !activeSceneManager.pausedForLab) {
          const wpc = activeSceneManager.workerPlacementController;
          const fp = activeSceneManager.formationPreview;
          const brm = activeSceneManager.buildingRadialMenu;
          const dc = activeSceneManager.devConsole;
          if (dc?.isOpen) return;
          if (wpc?.activePlacementType) return;
          if (fp?.isRightDragging || (fp?.targetingMode && fp.targetingMode !== 'NONE')) return;
          if (brm?.isOpen) {
            brm.close();
            return;
          }
          if (activeEscPauseMenu) {
            e.preventDefault();
            if (activeEscPauseMenu.isOpen) {
              activeEscPauseMenu.close();
              activeSimBridge?.setPaused?.(false);
            } else {
              activeSimBridge?.setPaused?.(true);
              activeEscPauseMenu.open();
            }
          }
        }
      },
      true
    );

    window.addEventListener(
      'keyup',
      (e) => {
        if (isTextInputFocused()) {
          activeSceneManager?.cameraController?.clearInputState?.();
          e.stopImmediatePropagation();
        }
      },
      true
    );
  }

  simBridge.start();
  sceneManager.start();
}

function boot() {
  if (isHeroesRoute()) {
    launchHallOfHeroes({ returnToLobby: true });
  } else if (isUnitsBuildingsRoute()) {
    launchUnitsBuildingsLab({ returnToLobby: true });
  } else if (isMapEditorRoute()) {
    launchMapEditor();
  } else if (isStudioRoute()) {
    launchStudio({ returnToLobby: true });
  } else {
    launchPreGameLobby();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}