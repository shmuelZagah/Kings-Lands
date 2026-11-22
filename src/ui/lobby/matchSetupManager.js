/**
 * Kings Lands — AAA Main Menu, Campaign/Skirmish Setup, Load/Save, Settings & ESC Pause Menu
 * (src/ui/lobby/matchSetupManager.js)
 *
 * Aesthetic: Serious PC RTS (Total War / Lord of the Rings: Battle for Middle-earth / StarCraft)
 * - Hierarchical topic-based navigation:
 *   1. Main Menu (`home`): PLAY, LABS (admin/dev only), SETTINGS, EXIT
 *   2. Play Submenu (`play_menu`): Play (Standard Player), Play as Dev (Dev Console + Labs), Load Game
 *   3. Load Screen (`load_menu`): Dual labeled lists (Player Saves vs Developer Saves)
 *   4. Labs Hub (`labs_menu`): Map Editor, Units & Buildings Lab, Hall of Heroes, Animation Studio
 *   5. Settings Screen (`settings`): Graphics/Camera, Audio, Gameplay, Controls Reference
 *   6. Skirmish Setup (`skirmish_setup`): Map, Teams/Alliances, AI Difficulty (Easy/Mid/Hard/Learning), AI vs AI
 * - Strict Mode Separation:
 *   - Standard Player (`isDevMode = false`): NO DevConsole, NO cheats, NO Labs in ESC menu.
 *   - Developer (`isDevMode = true`): Full DevConsole, cheats, and Labs in ESC menu.
 */

import {
  MAP_WORLD_SIZE,
  getActiveCustomMapState,
  setActiveCustomMapState,
  getSavedMapsList,
  createDefaultMapState,
  hydrateMapState
} from '../../tools/map_editor/mapStateManager.js';
import { generateDeterministicTreesFx, generateDeterministicMinesFx } from '../../sim/world/worldGen.js';
import {
  isCurrentUserAdmin,
  loadGameSettings,
  saveGameSettings,
  listSavedGames,
  deleteSavedGame
} from '../../core/gameSettingsAndSaves.js';

export const MATCH_SETUP_STORAGE_KEY = 'kings_lands_match_setup_v1';

let _activeMatchSetup = null;

export function getAvailableMapsCatalog() {
  const saved = getSavedMapsList();
  const activeCustom = getActiveCustomMapState();

  const prevCustom = getActiveCustomMapState();
  setActiveCustomMapState(null);
  const baseTrees = generateDeterministicTreesFx({}, MAP_WORLD_SIZE);
  const baseMines = generateDeterministicMinesFx(MAP_WORLD_SIZE);
  const defaultMap = createDefaultMapState(baseTrees, baseMines);
  if (prevCustom) setActiveCustomMapState(prevCustom);

  const list = [defaultMap, ...saved.map((m) => hydrateMapState(m))];
  if (activeCustom && activeCustom.isCustomMapActive) {
    const idx = list.findIndex((m) => m.id === activeCustom.id || m.name === activeCustom.name);
    if (idx >= 0) {
      list[idx] = hydrateMapState(activeCustom);
    } else {
      list.push(hydrateMapState(activeCustom));
    }
  }
  return list;
}

export function normalizeParticipantTeams(participants) {
  if (!Array.isArray(participants) || participants.length === 0) return participants;
  const row0 = participants[0];
  const row0IsAi =
    row0.controller === 'ai' ||
    row0.role === 'ai_spectator' ||
    row0.role === 'ai_enemy' ||
    row0.role === 'ai_ally';
  const playerTeamNum = Math.max(1, Math.min(4, Number(row0.teamNumber ?? row0.team ?? 1)));

  let nextSimTeam = 1;
  for (let i = 0; i < participants.length; i++) {
    const p = participants[i];
    if (i === 0) {
      p.teamNumber = playerTeamNum;
      p.team = nextSimTeam++;
      if (row0IsAi) {
        p.controller = 'ai';
        p.role = 'ai_spectator';
      } else {
        p.controller = 'player';
        p.role = 'player';
      }
      continue;
    }
    if (p.role === 'closed' || p.controller === 'closed') {
      p.role = 'closed';
      p.controller = 'closed';
      p.teamNumber = Math.max(1, Math.min(4, Number(p.teamNumber ?? 2)));
      p.team = 0;
      continue;
    }
    p.controller = 'ai';
    p.teamNumber = Math.max(1, Math.min(4, Number(p.teamNumber ?? 2)));
    p.team = nextSimTeam++;
    p.role = row0IsAi ? 'ai_spectator' : p.teamNumber === playerTeamNum ? 'ai_ally' : 'ai_enemy';
  }
  return participants;
}

export function buildDefaultMatchSetupForMap(mapState) {
  const hydrated = hydrateMapState(mapState);
  const worldSizeMeters = hydrated.worldSizeMeters || 4096;
  const spawnPoints =
    Array.isArray(hydrated.spawnPoints) && hydrated.spawnPoints.length > 0
      ? hydrated.spawnPoints
      : [
          { id: 'spawn_1', name: 'Start Point 1', x: worldSizeMeters * 0.5, z: worldSizeMeters * 0.4, facingDir: 256 },
          { id: 'spawn_2', name: 'Start Point 2', x: worldSizeMeters * 0.5, z: worldSizeMeters * 0.6, facingDir: 768 }
        ];

  const participants = spawnPoints.map((sp, idx) => {
    if (idx === 0) {
      return {
        slotIndex: idx,
        spawnPointIndex: idx,
        spawnPointId: sp.id || `spawn_${idx + 1}`,
        spawnName: sp.name || `נקודת הופעה #${idx + 1}`,
        x: Number(sp.x) || worldSizeMeters * 0.5,
        z: Number(sp.z) || worldSizeMeters * 0.4,
        facingDir: Number(sp.facingDir ?? 256),
        role: 'player',
        controller: 'player',
        teamNumber: 1,
        team: 1,
        aiDifficulty: 'mid'
      };
    }
    return {
      slotIndex: idx,
      spawnPointIndex: idx,
      spawnPointId: sp.id || `spawn_${idx + 1}`,
      spawnName: sp.name || `נקודת הופעה #${idx + 1}`,
      x: Number(sp.x) || worldSizeMeters * 0.5,
      z: Number(sp.z) || worldSizeMeters * 0.6,
      facingDir: Number(sp.facingDir ?? 768),
      role: 'ai_enemy',
      controller: 'ai',
      teamNumber: 2,
      team: 2,
      aiDifficulty: idx === 1 ? 'mid' : 'hard'
    };
  });

  normalizeParticipantTeams(participants);

  return {
    useMatchSetup: true,
    isDevMode: false,
    mapId: hydrated.id || 'default_royal_valley',
    mapName: hydrated.name || 'Royal Valley Crossroads',
    worldSizeMeters,
    playerTeam: 1,
    participants
  };
}

export function getActiveMatchSetup() {
  if (_activeMatchSetup) return _activeMatchSetup;
  try {
    const raw = globalThis.localStorage?.getItem(MATCH_SETUP_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.participants) && parsed.participants.length > 0) {
        normalizeParticipantTeams(parsed.participants);
        _activeMatchSetup = parsed;
        return _activeMatchSetup;
      }
    }
  } catch (_) {}

  const activeMap = getActiveCustomMapState();
  const maps = getAvailableMapsCatalog();
  const chosenMap = activeMap && activeMap.isCustomMapActive ? activeMap : maps[0];
  _activeMatchSetup = buildDefaultMatchSetupForMap(chosenMap);
  return _activeMatchSetup;
}

export function setActiveMatchSetup(setup) {
  if (setup && Array.isArray(setup.participants)) {
    normalizeParticipantTeams(setup.participants);
  }
  _activeMatchSetup = setup;
  try {
    if (setup) {
      globalThis.localStorage?.setItem(MATCH_SETUP_STORAGE_KEY, JSON.stringify(setup));
    } else {
      globalThis.localStorage?.removeItem(MATCH_SETUP_STORAGE_KEY);
    }
  } catch (_) {}
  return _activeMatchSetup;
}

function getParticipantMapBadgeText(p) {
  if (!p || p.role === 'closed') return 'סגור';
  const tNum = p.teamNumber ?? p.team ?? 1;
  if (p.role === 'player') return `אתה (ק' ${tNum})`;
  const diffLabel =
    p.aiDifficulty === 'easy'
      ? 'קל'
      : p.aiDifficulty === 'hard'
        ? 'קשה'
        : p.aiDifficulty === 'learning' || p.aiDifficulty === 'adaptive'
          ? 'לומד'
          : 'בינוני';
  return `AI ${diffLabel} (ק' ${tNum})`;
}

const TEAM_COLORS = Object.freeze({
  1: '#38bdf8',
  2: '#f43f5e',
  3: '#22c55e',
  4: '#f59e0b'
});

const SKYRIM_TEXT_BTN =
  'kl-nav-btn w-full text-left px-5 py-3 bg-transparent border-0 text-zinc-300/90 hover:text-amber-100 hover:pl-7 hover:bg-gradient-to-r hover:from-amber-400/20 hover:via-zinc-400/10 hover:to-transparent transition-all duration-200 cursor-pointer tracking-[0.2em] uppercase text-2xl md:text-[27px] font-semibold drop-shadow-[0_3px_10px_rgba(0,0,0,0.98)]';
const SKYRIM_SUB_BTN =
  'kl-nav-btn w-full text-left px-5 py-2.5 bg-transparent border-0 text-zinc-400 hover:text-amber-100 hover:pl-7 hover:bg-gradient-to-r hover:from-amber-400/15 hover:via-zinc-400/10 hover:to-transparent transition-all duration-200 cursor-pointer tracking-[0.16em] uppercase text-lg md:text-xl font-semibold drop-shadow-[0_2px_8px_rgba(0,0,0,0.98)]';

function ensureLobbyAnimStyles() {
  if (typeof document === 'undefined' || document.getElementById('kl-lobby-anim-styles')) return;
  const style = document.createElement('style');
  style.id = 'kl-lobby-anim-styles';
  style.textContent = `
    @keyframes klCloudDriftA {
      0%   { transform: translateX(-18px) translateY(0px) scale(1); opacity: 0.72; }
      50%  { transform: translateX(22px) translateY(3px) scale(1.06); opacity: 0.92; }
      100% { transform: translateX(-18px) translateY(0px) scale(1); opacity: 0.72; }
    }
    @keyframes klCloudDriftB {
      0%   { transform: translateX(20px) translateY(2px) scale(1.04); opacity: 0.68; }
      50%  { transform: translateX(-22px) translateY(-3px) scale(0.98); opacity: 0.88; }
      100% { transform: translateX(20px) translateY(2px) scale(1.04); opacity: 0.68; }
    }
    @keyframes klNavExit {
      0%   { opacity: 1; transform: translateX(0) scale(1); filter: blur(0px); }
      100% { opacity: 0; transform: translateX(-28px) scale(0.98); filter: blur(5px); }
    }
    @keyframes klNavItemEnter {
      0%   { opacity: 0; transform: translateX(-24px) scale(0.97); filter: blur(4px); }
      100% { opacity: 1; transform: translateX(0) scale(1); filter: blur(0px); }
    }
    @keyframes klPanelEnter {
      0%   { opacity: 0; transform: translateY(10px) scale(0.985); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    .kl-cloud-a { animation: klCloudDriftA 18s ease-in-out infinite; }
    .kl-cloud-b { animation: klCloudDriftB 24s ease-in-out infinite; }
    .kl-nav-exiting .kl-nav-btn {
      animation: klNavExit 170ms cubic-bezier(0.4, 0, 1, 1) forwards;
    }
    .kl-nav-btn-enter {
      opacity: 0;
      animation: klNavItemEnter 290ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
      animation-delay: calc(var(--kl-idx, 0) * 55ms);
    }
    .kl-panel-enter {
      animation: klPanelEnter 240ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
  `;
  document.head.appendChild(style);
}

export class PreGameLobbyModal {
  constructor({ onStartGame, onOpenMapEditor, onOpenLab, initialView = 'home' }) {
    this.onStartGame = onStartGame;
    this.onOpenMapEditor = onOpenMapEditor;
    this.onOpenLab = onOpenLab;
    this.rootEl = null;
    this.view = initialView; // 'home' | 'play_menu' | 'load_menu' | 'labs_menu' | 'settings' | 'skirmish_setup' | 'exit_screen'
    this.isDevMode = false;
    this._emberRaf = null;

    this.mapsCatalog = getAvailableMapsCatalog();
    const currentSetup = getActiveMatchSetup();
    const activeCustom = getActiveCustomMapState();
    this.selectedMap =
      (activeCustom && activeCustom.isCustomMapActive
        ? this.mapsCatalog.find((m) => m.id === activeCustom.id || m.name === activeCustom.name)
        : null) ||
      this.mapsCatalog.find((m) => m.id === currentSetup?.mapId) ||
      this.mapsCatalog[0];

    this.matchSetup = this._syncSetupWithMap(currentSetup, this.selectedMap);
  }

  _syncSetupWithMap(existingSetup, mapState) {
    const fresh = buildDefaultMatchSetupForMap(mapState);
    if (!existingSetup || existingSetup.mapId !== fresh.mapId) {
      return fresh;
    }
    const spawnPoints = mapState?.spawnPoints || [];
    if (
      Array.isArray(existingSetup.participants) &&
      existingSetup.participants.length === fresh.participants.length
    ) {
      const merged = fresh.participants.map((fp, i) => {
        const ep = existingSetup.participants[i] || fp;
        const spIdx = Math.max(
          0,
          Math.min(Math.max(0, spawnPoints.length - 1), Number(ep.spawnPointIndex ?? i))
        );
        const targetSp = spawnPoints[spIdx];
        return {
          ...fp,
          spawnPointIndex: spIdx,
          spawnPointId: targetSp?.id || fp.spawnPointId,
          spawnName: targetSp?.name || `נקודת הופעה #${spIdx + 1}`,
          x: targetSp ? Number(targetSp.x) : fp.x,
          z: targetSp ? Number(targetSp.z) : fp.z,
          facingDir: targetSp ? Number(targetSp.facingDir ?? fp.facingDir) : fp.facingDir,
          role: i === 0 ? (ep.controller === 'ai' ? 'ai_spectator' : 'player') : ep.role === 'closed' ? 'closed' : 'ai_enemy',
          controller: i === 0 ? (ep.controller === 'ai' ? 'ai' : 'player') : ep.role === 'closed' ? 'closed' : 'ai',
          teamNumber: Number(ep.teamNumber ?? ep.team ?? fp.teamNumber),
          aiDifficulty: ep.aiDifficulty || fp.aiDifficulty
        };
      });
      normalizeParticipantTeams(merged);
      return { ...fresh, isDevMode: Boolean(this.isDevMode), participants: merged };
    }
    return fresh;
  }

  show() {
    this.destroy();
    this.mapsCatalog = getAvailableMapsCatalog();
    const activeCustom = getActiveCustomMapState();
    if (activeCustom && activeCustom.isCustomMapActive) {
      const matched = this.mapsCatalog.find(
        (m) => m.id === activeCustom.id || m.name === activeCustom.name
      );
      if (matched) this.selectedMap = matched;
    } else {
      const matched = this.mapsCatalog.find((m) => m.id === this.selectedMap?.id);
      if (matched) this.selectedMap = matched;
    }
    this.matchSetup = this._syncSetupWithMap(this.matchSetup, this.selectedMap);

    ensureLobbyAnimStyles();
    const el = document.createElement('div');
    el.id = 'kings-lands-pregame-lobby';
    el.className = 'fixed inset-0 z-50 w-screen h-screen overflow-hidden select-none text-slate-100';
    document.body.appendChild(el);
    this.rootEl = el;
    this._render();
  }

  _startAtmosphericEmbers() {
    if (this._emberRaf) cancelAnimationFrame(this._emberRaf);
    const canvas = this.rootEl?.querySelector('#kl-menu-embers');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth || 1280;
      canvas.height = window.innerHeight || 720;
    };
    resize();

    const particles = Array.from({ length: 42 }, (_, i) => ({
      x: ((i * 97) % 100) / 100,
      y: ((i * 53) % 100) / 100,
      r: 1.0 + (i % 3) * 0.8,
      vx: -0.00018 + (i % 5) * 0.00009,
      vy: -0.00035 - (i % 4) * 0.00012,
      alpha: 0.25 + (i % 5) * 0.12
    }));

    const tick = () => {
      if (!this.rootEl) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < -0.02) { p.y = 1.02; p.x = (p.x + 0.37) % 1.0; }
        if (p.x < 0) p.x = 1;
        if (p.x > 1) p.x = 0;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(251, 191, 36, ${p.alpha})`;
        ctx.fill();
      }
      this._emberRaf = requestAnimationFrame(tick);
    };
    this._emberRaf = requestAnimationFrame(tick);
  }

  _getInnerViewHtml(admin, animateButtons = false) {
    if (this.view === 'home') return this._renderHomeView(admin, animateButtons);
    if (this.view === 'play_menu') return this._renderPlayMenuView(admin, animateButtons);
    if (this.view === 'load_menu') return this._renderLoadMenuView();
    if (this.view === 'labs_menu') return this._renderLabsMenuView(animateButtons);
    if (this.view === 'settings') return this._renderSettingsView();
    if (this.view === 'exit_screen') return this._renderExitView();
    return this._renderSkirmishSetupView();
  }

  _transitionToView(nextView) {
    if (!this.rootEl || this._isTransitioning) {
      this.view = nextView;
      this._render(true);
      return;
    }
    const nav = this.rootEl.querySelector('#kl-menu-nav');
    if (nav) {
      this._isTransitioning = true;
      nav.classList.add('kl-nav-exiting');
      setTimeout(() => {
        this._isTransitioning = false;
        this.view = nextView;
        this._renderStageOnly(true);
      }, 175);
    } else {
      this.view = nextView;
      this._renderStageOnly(true);
    }
  }

  _renderStageOnly(animateEnter = false) {
    if (!this.rootEl) return;
    const stage = this.rootEl.querySelector('#kl-menu-content-stage');
    if (!stage) {
      this._render(animateEnter);
      return;
    }
    const admin = isCurrentUserAdmin();
    const isLeftMenu = this.view === 'home' || this.view === 'play_menu' || this.view === 'labs_menu';
    stage.setAttribute('dir', isLeftMenu ? 'ltr' : 'rtl');
    stage.innerHTML = this._getInnerViewHtml(admin, animateEnter);
    if (!isLeftMenu) {
      stage.firstElementChild?.classList.add('kl-panel-enter');
    }
    if (this.view === 'skirmish_setup') {
      this._drawMapPreviewCanvas();
    }
    this._wireEvents();
  }

  _render(animateEnter = false) {
    if (!this.rootEl) return;
    const admin = isCurrentUserAdmin();
    const innerContent = this._getInnerViewHtml(admin, animateEnter);
    const isLeftMenu = this.view === 'home' || this.view === 'play_menu' || this.view === 'labs_menu';

    this.rootEl.innerHTML = `
      <div class="absolute inset-0 bg-cover bg-center scale-[1.01]" style="background-image: url('/assets/main_menu_bg.jpg'), radial-gradient(circle at 30% 40%, #1e293b 0%, #020617 100%);"></div>
      <div class="absolute inset-0 bg-gradient-to-r from-[#04070d]/92 via-[#070b14]/45 to-[#04070d]/60"></div>
      <div class="absolute inset-0 bg-gradient-to-t from-[#020408]/95 via-transparent to-[#020408]/70"></div>
      <canvas id="kl-menu-embers" class="pointer-events-none fixed inset-0 z-[1]"></canvas>
      <div id="kl-menu-content-stage" class="relative z-10 w-full h-full flex flex-col" dir="${isLeftMenu ? 'ltr' : 'rtl'}">
        ${innerContent}
      </div>
    `;

    this._startAtmosphericEmbers();
    if (this.view === 'skirmish_setup') {
      this._drawMapPreviewCanvas();
    }
    this._wireEvents();
  }

  _renderBrandHeader() {
    return `
      <div class="pointer-events-none fixed top-12 md:top-[56px] left-[34%] right-8 z-20 flex justify-center select-none">
        <div class="relative inline-flex items-center justify-center px-10 py-2">
          <h1
            class="text-4xl md:text-6xl font-bold tracking-[0.34em] uppercase text-zinc-300/60 whitespace-nowrap drop-shadow-[0_6px_26px_rgba(0,0,0,0.98)]"
            style="font-family: Georgia, 'Times New Roman', serif; -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,0.95) 28%, rgba(0,0,0,0.42) 100%); mask-image: linear-gradient(to bottom, rgba(0,0,0,0.95) 28%, rgba(0,0,0,0.42) 100%);"
          >
            KINGS LANDS
          </h1>
          <!-- Drifting storm-cloud wisps overlapping and blending the title into the sky -->
          <div
            class="kl-cloud-a pointer-events-none absolute -inset-x-10 -top-2 -bottom-4 rounded-full blur-[10px]"
            style="background: radial-gradient(ellipse 60% 55% at 28% 72%, rgba(16,20,28,0.78) 0%, rgba(18,24,34,0.38) 55%, transparent 80%), radial-gradient(ellipse 55% 50% at 72% 65%, rgba(15,19,27,0.75) 0%, rgba(22,28,38,0.34) 52%, transparent 78%);"
          ></div>
          <div
            class="kl-cloud-b pointer-events-none absolute -inset-x-6 top-2 -bottom-5 rounded-full blur-[14px]"
            style="background: radial-gradient(ellipse 52% 60% at 48% 78%, rgba(28,34,46,0.52) 0%, rgba(12,16,24,0.48) 50%, transparent 82%), radial-gradient(ellipse 40% 45% at 85% 55%, rgba(14,18,26,0.68) 0%, transparent 76%);"
          ></div>
        </div>
      </div>
    `;
  }

  _renderHomeView(admin, animateButtons = false) {
    const enterCls = animateButtons ? 'kl-nav-btn-enter' : '';
    let idx = 0;
    return `
      <div class="flex-1 flex items-start justify-start px-12 md:px-20 pt-[25vh] md:pt-[26vh] pb-10">
        <div class="w-full max-w-[400px] flex flex-col items-start">
          ${this._renderBrandHeader()}
          <nav id="kl-menu-nav" class="w-full flex flex-col gap-2" style="font-family: Georgia, 'Times New Roman', serif;">
            <button id="menu-btn-play" type="button" style="--kl-idx: ${idx++}" class="${SKYRIM_TEXT_BTN} ${enterCls}">
              Play
            </button>
            ${
              admin
                ? `<button id="menu-btn-labs" type="button" style="--kl-idx: ${idx++}" class="${SKYRIM_TEXT_BTN} ${enterCls}">
                     Labs
                   </button>`
                : ''
            }
            <button id="menu-btn-settings" type="button" style="--kl-idx: ${idx++}" class="${SKYRIM_TEXT_BTN} ${enterCls}">
              Settings
            </button>
            <button id="menu-btn-exit" type="button" style="--kl-idx: ${idx++}" class="${SKYRIM_TEXT_BTN} ${enterCls} mt-3 text-zinc-500 hover:text-zinc-200">
              Exit
            </button>
          </nav>
        </div>
      </div>
    `;
  }

  _renderPlayMenuView(admin, animateButtons = false) {
    const enterCls = animateButtons ? 'kl-nav-btn-enter' : '';
    let idx = 0;
    return `
      <div class="flex-1 flex items-start justify-start px-12 md:px-20 pt-[25vh] md:pt-[26vh] pb-10">
        <div class="w-full max-w-[420px] flex flex-col items-start">
          ${this._renderBrandHeader()}
          <nav id="kl-menu-nav" class="w-full flex flex-col gap-2" style="font-family: Georgia, 'Times New Roman', serif;">
            <button id="play-btn-standard" type="button" style="--kl-idx: ${idx++}" class="${SKYRIM_TEXT_BTN} ${enterCls}">
              Play
            </button>
            ${
              admin
                ? `<button id="play-btn-dev" type="button" style="--kl-idx: ${idx++}" class="${SKYRIM_TEXT_BTN} ${enterCls}">
                     Play as Dev
                   </button>`
                : ''
            }
            <button id="play-btn-load" type="button" style="--kl-idx: ${idx++}" class="${SKYRIM_TEXT_BTN} ${enterCls}">
              Load
            </button>
            <button id="menu-btn-back-home" type="button" style="--kl-idx: ${idx++}" class="${SKYRIM_SUB_BTN} ${enterCls} mt-4 text-zinc-500 hover:text-zinc-200">
              Back
            </button>
          </nav>
        </div>
      </div>
    `;
  }

  _renderLoadMenuView() {
    const playerSaves = listSavedGames('player');
    const devSaves = listSavedGames('dev');

    const renderList = (saves, mode, emptyMsg) => {
      if (!saves || saves.length === 0) {
        return `<div class="rounded-sm border border-slate-800 bg-slate-950/70 p-6 text-center text-xs text-slate-500">${emptyMsg}</div>`;
      }
      return saves
        .map(
          (s) => `
        <div class="rounded-sm border border-slate-700/80 bg-[#0c121e]/95 p-3.5 flex items-center justify-between gap-3 hover:border-amber-500/60 transition">
          <div>
            <div class="text-sm font-black text-amber-100">${s.name || 'שמירה'}</div>
            <div class="text-[11px] text-slate-400 mt-0.5">🗺️ ${s.mapName || 'Royal Valley'} • ⏱️ Tick ${s.tick || 0} • ${s.savedAtLabel || ''}</div>
          </div>
          <div class="flex items-center gap-2">
            <button data-load-save-id="${s.id}" data-load-save-mode="${mode}" type="button" class="px-3.5 py-1.5 rounded-sm border border-emerald-500/70 bg-emerald-700/40 hover:bg-emerald-600/60 text-xs font-black text-emerald-100 cursor-pointer">טען</button>
            <button data-del-save-id="${s.id}" data-del-save-mode="${mode}" type="button" class="px-2.5 py-1.5 rounded-sm border border-rose-700/60 bg-rose-950/50 hover:bg-rose-900/70 text-xs font-bold text-rose-200 cursor-pointer">מחק</button>
          </div>
        </div>
      `
        )
        .join('');
    };

    return `
      <div class="flex-1 flex flex-col px-10 py-8 overflow-y-auto">
        <div class="max-w-5xl w-full mx-auto bg-[#080c14]/92 border border-amber-600/40 rounded-sm p-6 shadow-2xl backdrop-blur-md">
          <div class="flex items-center justify-between border-b border-slate-800 pb-4 mb-5">
            <div>
              <h2 class="text-2xl font-black text-amber-200">📂 טעינת משחק שמור (Load Game)</h2>
              <p class="text-xs text-slate-400 mt-0.5">שמירות מופרדות בין מצב שחקן רגיל למצב מפתח</p>
            </div>
            <button id="load-btn-back" type="button" class="px-4 py-2 rounded-sm border border-slate-600 bg-slate-900 hover:bg-slate-800 text-xs font-bold text-slate-200 cursor-pointer">→ חזרה</button>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="flex flex-col gap-3">
              <div class="px-3 py-2 rounded-sm border-r-4 border-sky-400 bg-sky-950/40 text-sm font-black text-sky-200">
                🛡️ שמירות שחקן רגיל (Player Saves)
              </div>
              <div class="flex flex-col gap-2 max-h-[380px] overflow-y-auto pr-1">
                ${renderList(playerSaves, 'player', 'אין עדיין שמירות במצב שחקן רגיל')}
              </div>
            </div>

            <div class="flex flex-col gap-3">
              <div class="px-3 py-2 rounded-sm border-r-4 border-indigo-400 bg-indigo-950/40 text-sm font-black text-indigo-200">
                🛠️ שמירות מצב מפתח (Developer Saves)
              </div>
              <div class="flex flex-col gap-2 max-h-[380px] overflow-y-auto pr-1">
                ${renderList(devSaves, 'dev', 'אין עדיין שמירות במצב מפתח')}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _renderLabsMenuView(animateButtons = false) {
    const enterCls = animateButtons ? 'kl-nav-btn-enter' : '';
    return `
      <div class="flex-1 flex items-start justify-start px-12 md:px-20 pt-[25vh] md:pt-[26vh] pb-10">
        <div class="w-full max-w-[540px] flex flex-col items-start">
          ${this._renderBrandHeader()}
          <nav id="kl-menu-nav" class="w-full flex flex-col gap-2 whitespace-nowrap" style="font-family: Georgia, 'Times New Roman', serif;">
            <button id="btn-lobby-open-map-editor" type="button" style="--kl-idx: 0" class="${SKYRIM_TEXT_BTN} ${enterCls} whitespace-nowrap">
              Map Editor
            </button>
            <button id="btn-lobby-open-units-lab" type="button" style="--kl-idx: 1" class="${SKYRIM_TEXT_BTN} ${enterCls} whitespace-nowrap">
              Units &amp; Buildings
            </button>
            <button id="btn-lobby-open-heroes" type="button" style="--kl-idx: 2" class="${SKYRIM_TEXT_BTN} ${enterCls}">
              Hall of Heroes
            </button>
            <button id="btn-lobby-open-studio" type="button" style="--kl-idx: 3" class="${SKYRIM_TEXT_BTN} ${enterCls}">
              Animation Studio
            </button>
            <button id="menu-btn-back-home" type="button" style="--kl-idx: 4" class="${SKYRIM_SUB_BTN} ${enterCls} mt-4 text-zinc-500 hover:text-zinc-200">
              Back
            </button>
          </nav>
        </div>
      </div>
    `;
  }

  _renderSettingsView() {
    const s = loadGameSettings();
    return `
      <div class="flex-1 flex items-center justify-center px-8 py-8 overflow-y-auto">
        <div class="w-full max-w-3xl rounded-sm border border-amber-600/50 bg-[#080c14]/95 p-6 shadow-2xl backdrop-blur-md">
          <div class="flex items-center justify-between border-b border-slate-800 pb-4 mb-5">
            <h2 class="text-2xl font-black text-amber-200">⚙️ הגדרות משחק (Settings)</h2>
            <button id="menu-btn-back-home" type="button" class="px-4 py-2 rounded-sm border border-slate-600 bg-slate-900 hover:bg-slate-800 text-xs font-bold text-slate-200 cursor-pointer">→ חזרה</button>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
            <div class="space-y-4">
              <div class="text-xs font-black uppercase tracking-wider text-amber-400 border-b border-slate-800 pb-1">שמע ומצלמה</div>
              <label class="flex items-center justify-between gap-4">
                <span>עוצמת שמע כללית (<b id="set-vol-val">${s.masterVolume}%</b>)</span>
                <input id="set-vol" type="range" min="0" max="100" value="${s.masterVolume}" class="w-36 accent-amber-500" />
              </label>
              <label class="flex items-center justify-between gap-4 cursor-pointer">
                <span>השתק שמע (Mute)</span>
                <input id="set-muted" type="checkbox" ${s.muted ? 'checked' : ''} class="w-4 h-4 accent-amber-500" />
              </label>
              <label class="flex items-center justify-between gap-4">
                <span>מהירות גלילת קצוות מסך (<b id="set-pan-val">${s.edgePanSpeed}%</b>)</span>
                <input id="set-pan" type="range" min="40" max="200" value="${s.edgePanSpeed}" class="w-36 accent-amber-500" />
              </label>
              <label class="flex items-center justify-between gap-4">
                <span>רגישות סיבוב מצלמה (<b id="set-orbit-val">${s.cameraOrbitSens}%</b>)</span>
                <input id="set-orbit" type="range" min="40" max="200" value="${s.cameraOrbitSens}" class="w-36 accent-amber-500" />
              </label>
            </div>

            <div class="space-y-4">
              <div class="text-xs font-black uppercase tracking-wider text-sky-400 border-b border-slate-800 pb-1">גרפיקה ומשחקיות</div>
              <label class="flex items-center justify-between gap-4 cursor-pointer">
                <span>צללים בזמן אמת (3D Shadows)</span>
                <input id="set-shadows" type="checkbox" ${s.shadows ? 'checked' : ''} class="w-4 h-4 accent-amber-500" />
              </label>
              <label class="flex items-center justify-between gap-4 cursor-pointer">
                <span>הצג מדי חיים מעל יחידות ומבנים</span>
                <input id="set-hp" type="checkbox" ${s.showHealthBars ? 'checked' : ''} class="w-4 h-4 accent-amber-500" />
              </label>
              <div class="rounded-sm border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300 space-y-1">
                <div class="font-bold text-amber-300 mb-1">קיצורי מקשים עיקריים:</div>
                <div><b class="mono text-slate-100">WASD / חצים</b> — הזזת מצלמה | <b class="mono text-slate-100">Space</b> — מוקד אירוע</div>
                <div><b class="mono text-slate-100">F1</b> — פועל פנוי | <b class="mono text-slate-100">F12</b> — כל הצבא</div>
                <div><b class="mono text-slate-100">Shift + קליק ימני</b> — תור פקודות | <b class="mono text-slate-100">Alt + גרירה</b> — שמירת מבנה</div>
              </div>
            </div>
          </div>

          <div class="mt-6 pt-4 border-t border-slate-800 flex justify-end gap-3">
            <button id="set-btn-save" type="button" class="px-6 py-2.5 rounded-sm border border-amber-500 bg-amber-600/80 hover:bg-amber-500 text-xs font-black text-slate-950 cursor-pointer">
              💾 שמור הגדרות וחזור
            </button>
          </div>
        </div>
      </div>
    `;
  }

  _renderExitView() {
    return `
      <div class="flex-1 flex items-center justify-center p-8">
        <div class="max-w-md w-full rounded-sm border border-amber-600/50 bg-[#080c14]/95 p-8 text-center space-y-4 shadow-2xl">
          <h2 class="text-2xl font-black text-amber-200">Kings Lands</h2>
          <p class="text-sm text-slate-300">היציאה הושלמה. ניתן לסגור את לשונית הדפדפן בבטחה.</p>
          <button id="menu-btn-back-home" type="button" class="px-6 py-2.5 rounded-sm border border-amber-500/70 bg-slate-900 hover:bg-slate-800 text-xs font-bold text-amber-200 cursor-pointer">
            חזרה לתפריט הראשי
          </button>
        </div>
      </div>
    `;
  }

  _renderSkirmishSetupView() {
    const participants = this.matchSetup.participants || [];
    const spawnPoints = this.selectedMap.spawnPoints || [];
    const worldSize = this.selectedMap.worldSizeMeters || 4096;

    return `
      <header class="flex flex-wrap items-center justify-between gap-4 border-b border-amber-500/30 bg-[#060911]/90 px-8 py-3.5 shadow-2xl">
        <div class="flex items-center gap-4">
          <button id="skirmish-btn-back" type="button" class="px-3.5 py-2 rounded-sm border border-slate-600 bg-slate-900 hover:bg-slate-800 text-xs font-bold text-slate-200 cursor-pointer">→ חזרה</button>
          <div>
            <h1 class="text-lg font-black tracking-wider uppercase text-amber-300">הגדרת מערכה (Skirmish Setup)</h1>
            <p class="text-[11px] text-slate-400">בחר מפה, קבוצות/בריתות ורמות AI</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="px-3 py-1 rounded-sm border ${
            this.isDevMode
              ? 'border-indigo-400/70 bg-indigo-950/60 text-indigo-200'
              : 'border-emerald-400/70 bg-emerald-950/60 text-emerald-200'
          } text-xs font-black">
            ${this.isDevMode ? '🛠️ מצב מפתח (Dev Mode)' : '🛡️ מצב שחקן רגיל'}
          </span>
        </div>
      </header>

      <div class="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5 px-8 py-5 overflow-y-auto">
        <div class="lg:col-span-5 flex flex-col gap-3 rounded-sm border border-amber-600/35 bg-[#080c14]/90 p-4 shadow-2xl backdrop-blur-md">
          <div class="flex items-center justify-between gap-3">
            <label class="text-sm font-extrabold text-amber-300">🗺️ בחר מפה לקרב:</label>
            <span class="mono text-xs text-sky-300 rounded-sm border border-sky-500/40 bg-sky-950/50 px-2.5 py-1">גודל: ${worldSize}m × ${worldSize}m</span>
          </div>

          <select id="lobby-select-map" class="w-full rounded-sm border border-amber-500/60 bg-slate-950 px-3.5 py-2.5 text-sm font-bold text-slate-100 shadow cursor-pointer">
            ${this.mapsCatalog
              .map(
                (m) =>
                  `<option value="${m.id}" ${m.id === this.selectedMap.id ? 'selected' : ''}>${m.name} (${(m.spawnPoints || []).length} נקודות הופעה • ${m.worldSizeMeters || 4096}m)</option>`
              )
              .join('')}
          </select>

          <div class="relative flex-1 min-h-[320px] flex items-center justify-center rounded-sm border border-slate-700 bg-slate-950 overflow-hidden shadow-inner">
            <canvas id="lobby-minimap-canvas" width="480" height="480" class="w-full h-full max-h-[420px] object-contain block"></canvas>
            <div class="pointer-events-none absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between rounded-sm bg-slate-950/90 border border-slate-800 px-3 py-1 text-[11px] text-slate-300">
              <span>🌲 עצים: <b>${this.selectedMap.trees?.length || 0}</b></span>
              <span>⛏️ מכרות: <b>${this.selectedMap.mines?.length || 0}</b></span>
              <span>🌉 גשרים: <b>${this.selectedMap.bridges?.length || 0}</b></span>
              <span>🚩 נקודות: <b>${spawnPoints.length}</b></span>
            </div>
          </div>
        </div>

        <div class="lg:col-span-7 flex flex-col justify-between gap-4 rounded-sm border border-amber-600/35 bg-[#080c14]/90 p-5 shadow-2xl backdrop-blur-md">
          <div class="flex flex-col gap-2.5 flex-1 overflow-hidden">
            <div class="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div>
                <h2 class="text-sm font-extrabold text-amber-200">⚔️ הגדרת משתתפים, קבוצות ומיקום התחלה</h2>
                <p class="text-[11px] text-slate-400 mt-0.5">בחר מספר קבוצה זהה כדי לשתף ראייה ולהילחם יחד</p>
              </div>
            </div>

            <div class="space-y-2 overflow-y-auto pr-1 flex-1">
              ${participants
                .map((p, idx) => {
                  const isPlayer = idx === 0 && p.controller !== 'ai';
                  const isRow0Ai = idx === 0 && p.controller === 'ai';
                  const isClosed = idx > 0 && p.role === 'closed';
                  const tNum = p.teamNumber ?? 1;
                  const playerTNum = participants[0]?.teamNumber ?? 1;
                  const isAlly = idx > 0 && !isClosed && tNum === playerTNum;

                  const rowStyle = isPlayer
                    ? 'border-sky-500/70 bg-sky-950/35'
                    : isClosed
                      ? 'border-slate-800 bg-slate-950/50 opacity-65'
                      : isAlly
                        ? 'border-emerald-500/70 bg-emerald-950/25'
                        : 'border-rose-500/50 bg-rose-950/20';

                  return `
                  <div class="rounded-sm border ${rowStyle} px-3 py-2 flex flex-wrap items-center justify-between gap-2 transition">
                    <div class="flex items-center gap-2 min-w-[155px]">
                      ${
                        idx === 0
                          ? `<select data-slot-active="0" class="rounded-sm border border-sky-400/60 bg-sky-950/70 px-2.5 py-1 text-xs font-black text-sky-200 cursor-pointer">
                               <option value="player" ${isPlayer ? 'selected' : ''}>👤 אתה (שחקן)</option>
                               <option value="ai" ${isRow0Ai ? 'selected' : ''}>🤖 AI (אימון / צפייה)</option>
                             </select>`
                          : `<select data-slot-active="${idx}" class="rounded-sm border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-extrabold text-slate-100 cursor-pointer">
                               <option value="ai" ${!isClosed ? 'selected' : ''}>🤖 AI (${isAlly ? 'בעל ברית' : 'יריב'})</option>
                               <option value="closed" ${isClosed ? 'selected' : ''}>🚫 סגור</option>
                             </select>`
                      }
                    </div>

                    <div class="flex flex-wrap items-center gap-2">
                      ${
                        !isClosed
                          ? `<select data-slot-team="${idx}" class="rounded-sm border border-indigo-400/60 bg-slate-950 px-2.5 py-1 text-xs font-extrabold text-indigo-200 cursor-pointer">
                               <option value="1" ${tNum === 1 ? 'selected' : ''}>🔵 קבוצה 1</option>
                               <option value="2" ${tNum === 2 ? 'selected' : ''}>🔴 קבוצה 2</option>
                               <option value="3" ${tNum === 3 ? 'selected' : ''}>🟢 קבוצה 3</option>
                               <option value="4" ${tNum === 4 ? 'selected' : ''}>🟡 קבוצה 4</option>
                             </select>`
                          : ''
                      }
                      ${
                        !isClosed && spawnPoints.length > 0
                          ? `<select data-slot-spawn="${idx}" class="rounded-sm border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-bold text-amber-300 cursor-pointer">
                               ${spawnPoints
                                 .map(
                                   (_sp, spIdx) =>
                                     `<option value="${spIdx}" ${(p.spawnPointIndex ?? idx) === spIdx ? 'selected' : ''}>📍 מיקום #${spIdx + 1}</option>`
                                 )
                                 .join('')}
                             </select>`
                          : ''
                      }
                      ${
                        !isPlayer && !isClosed
                          ? `<select data-slot-diff="${idx}" class="rounded-sm border border-amber-500/50 bg-slate-950 px-2.5 py-1 text-xs font-bold text-amber-200 cursor-pointer">
                               <option value="easy" ${p.aiDifficulty === 'easy' ? 'selected' : ''}>קל (Easy)</option>
                               <option value="mid" ${(p.aiDifficulty === 'mid' || p.aiDifficulty === 'normal') ? 'selected' : ''}>בינוני (Mid)</option>
                               <option value="hard" ${p.aiDifficulty === 'hard' ? 'selected' : ''}>קשה (Hard)</option>
                               <option value="learning" ${(p.aiDifficulty === 'learning' || p.aiDifficulty === 'adaptive') ? 'selected' : ''}>🧠 למידה והתפתחות</option>
                             </select>`
                          : isClosed
                            ? `<span class="text-[11px] text-slate-500 px-2">ללא משתתף</span>`
                            : ''
                      }
                    </div>
                  </div>`;
                })
                .join('')}
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 pt-3">
            <div class="text-xs text-slate-400">
              בזמן המשחק לחץ על <kbd class="rounded-sm border border-amber-500/50 bg-slate-950 px-2 py-0.5 mono font-bold text-amber-300">ESC</kbd> לשמירה, הגדרות או חזרה.
            </div>
            <div class="flex items-center gap-2.5">
              <button id="btn-lobby-ai-vs-ai" type="button" class="rounded-sm border border-indigo-400/80 bg-indigo-900/50 hover:bg-indigo-800/70 px-4 py-3 text-xs font-black text-indigo-100 shadow-lg cursor-pointer transition">
                🤖 אימון AI מול AI
              </button>
              <button id="btn-lobby-start-match" type="button" class="rounded-sm border-2 border-amber-400 bg-gradient-to-r from-amber-700 to-amber-600 hover:from-amber-600 hover:to-amber-500 px-7 py-3 text-base font-black text-white shadow-2xl cursor-pointer transition">
                ⚔️ התחל קרב (Start Battle)
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _drawMapPreviewCanvas() {
    const canvas = this.rootEl?.querySelector('#lobby-minimap-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const m = this.selectedMap;
    const worldSize = m.worldSizeMeters || MAP_WORLD_SIZE;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    const grid = m.heightGrid;
    const res = m.vertexRes || 257;
    if (grid && grid.length >= res * res) {
      const img = ctx.createImageData(w, h);
      const d = img.data;
      for (let py = 0; py < h; py++) {
        const gz = Math.min(res - 1, Math.floor((py / h) * (res - 1)));
        for (let px = 0; px < w; px++) {
          const gx = Math.min(res - 1, Math.floor((px / w) * (res - 1)));
          const elev = grid[gz * res + gx];
          const idx = (py * w + px) * 4;
          if (elev < -0.4) {
            d[idx] = 28; d[idx + 1] = 88; d[idx + 2] = 128; d[idx + 3] = 255;
          } else if (elev < 0.25) {
            d[idx] = 138; d[idx + 1] = 126; d[idx + 2] = 92; d[idx + 3] = 255;
          } else if (elev < 4.5) {
            d[idx] = 58; d[idx + 1] = 104; d[idx + 2] = 52; d[idx + 3] = 255;
          } else if (elev < 8.5) {
            d[idx] = 88; d[idx + 1] = 114; d[idx + 2] = 64; d[idx + 3] = 255;
          } else {
            d[idx] = 126; d[idx + 1] = 120; d[idx + 2] = 110; d[idx + 3] = 255;
          }
        }
      }
      ctx.putImageData(img, 0, 0);
    } else {
      ctx.fillStyle = '#3a6834';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1c5880';
      ctx.fillRect(0, h * 0.46, w, h * 0.08);
    }

    ctx.fillStyle = '#164a1c';
    for (const t of m.trees || []) {
      const tx = (t.x / worldSize) * w;
      const tz = (t.z / worldSize) * h;
      ctx.fillRect(tx - 1, tz - 1, 2.5, 2.5);
    }

    for (const mine of m.mines || []) {
      ctx.fillStyle =
        mine.type === 'coins' ? '#facc15' : mine.type === 'iron' ? '#60a5fa' : '#cbd5e1';
      const mx = (mine.x / worldSize) * w;
      const mz = (mine.z / worldSize) * h;
      ctx.fillRect(mx - 2.5, mz - 2.5, 5, 5);
    }

    ctx.fillStyle = '#d6d3d1';
    for (const b of m.bridges || []) {
      const bx = (b.x / worldSize) * w;
      const bz = (b.z / worldSize) * h;
      ctx.fillRect(bx - 5, bz - 7, 10, 14);
    }

    const parts = this.matchSetup.participants || [];
    const spawnPoints = m.spawnPoints || [];
    for (let spIdx = 0; spIdx < spawnPoints.length; spIdx++) {
      const sp = spawnPoints[spIdx];
      const sx = (sp.x / worldSize) * w;
      const sz = (sp.z / worldSize) * h;
      const assigned = parts.filter((p) => p.role !== 'closed' && (p.spawnPointIndex ?? p.slotIndex) === spIdx);
      const primary = assigned[0];
      const fillCol = primary ? TEAM_COLORS[primary.teamNumber ?? 1] || '#38bdf8' : '#64748b';
      const badgeText = primary ? getParticipantMapBadgeText(primary) : `#${spIdx + 1}`;

      ctx.beginPath();
      ctx.arc(sx, sz, 11, 0, Math.PI * 2);
      ctx.fillStyle = fillCol;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#020617';
      ctx.stroke();

      ctx.font = 'bold 11px Inter, sans-serif';
      const tw = ctx.measureText(badgeText).width;
      const pillW = tw + 10;
      const pillX = Math.max(4, Math.min(w - pillW - 4, sx - pillW * 0.5));
      const pillY = sz - 24 > 4 ? sz - 24 : sz + 14;
      ctx.fillStyle = 'rgba(2, 6, 23, 0.88)';
      ctx.fillRect(pillX, pillY, pillW, 16);
      ctx.strokeStyle = fillCol;
      ctx.lineWidth = 1;
      ctx.strokeRect(pillX, pillY, pillW, 16);
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, pillX + pillW * 0.5, pillY + 8);
    }
  }

  _wireEvents() {
    const root = this.rootEl;
    if (!root) return;

    // Home navigation (smooth staggered transition)
    root.querySelector('#menu-btn-play')?.addEventListener('click', () => {
      this._transitionToView('play_menu');
    });
    root.querySelector('#menu-btn-labs')?.addEventListener('click', () => {
      this._transitionToView('labs_menu');
    });
    root.querySelector('#menu-btn-settings')?.addEventListener('click', () => {
      this._transitionToView('settings');
    });
    root.querySelector('#menu-btn-exit')?.addEventListener('click', () => {
      try { window.close(); } catch (_) {}
      this._transitionToView('exit_screen');
    });
    root.querySelector('#menu-btn-back-home')?.addEventListener('click', () => {
      this._transitionToView('home');
    });

    // Play submenu
    root.querySelector('#play-btn-standard')?.addEventListener('click', () => {
      this.isDevMode = false;
      this.matchSetup.isDevMode = false;
      this._transitionToView('skirmish_setup');
    });
    root.querySelector('#play-btn-dev')?.addEventListener('click', () => {
      this.isDevMode = true;
      this.matchSetup.isDevMode = true;
      this._transitionToView('skirmish_setup');
    });
    root.querySelector('#play-btn-load')?.addEventListener('click', () => {
      this._transitionToView('load_menu');
    });
    root.querySelector('#load-btn-back')?.addEventListener('click', () => {
      this._transitionToView('play_menu');
    });
    root.querySelector('#skirmish-btn-back')?.addEventListener('click', () => {
      this._transitionToView('play_menu');
    });

    // Load / Delete saved games
    root.querySelectorAll('[data-load-save-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-load-save-id');
        const mode = btn.getAttribute('data-load-save-mode');
        const entry = listSavedGames(mode).find((s) => s.id === id);
        if (!entry) return;
        const setup = {
          ...(entry.matchSetup || buildDefaultMatchSetupForMap(this.selectedMap)),
          isDevMode: mode === 'dev',
          loadedSaveState: entry.simSnapshot
        };
        if (entry.customMapState) {
          setActiveCustomMapState({ ...entry.customMapState, isCustomMapActive: true });
        } else {
          setActiveCustomMapState(null);
        }
        setActiveMatchSetup(setup);
        this.destroy();
        this.onStartGame?.(setup);
      });
    });

    root.querySelectorAll('[data-del-save-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-del-save-id');
        const mode = btn.getAttribute('data-del-save-mode');
        deleteSavedGame(mode, id);
        this._render();
      });
    });

    // Settings
    const volSlider = root.querySelector('#set-vol');
    const panSlider = root.querySelector('#set-pan');
    const orbitSlider = root.querySelector('#set-orbit');
    volSlider?.addEventListener('input', () => {
      const el = root.querySelector('#set-vol-val');
      if (el) el.textContent = `${volSlider.value}%`;
    });
    panSlider?.addEventListener('input', () => {
      const el = root.querySelector('#set-pan-val');
      if (el) el.textContent = `${panSlider.value}%`;
    });
    orbitSlider?.addEventListener('input', () => {
      const el = root.querySelector('#set-orbit-val');
      if (el) el.textContent = `${orbitSlider.value}%`;
    });
    root.querySelector('#set-btn-save')?.addEventListener('click', () => {
      saveGameSettings({
        masterVolume: Number(volSlider?.value ?? 80),
        muted: Boolean(root.querySelector('#set-muted')?.checked),
        edgePanSpeed: Number(panSlider?.value ?? 100),
        cameraOrbitSens: Number(orbitSlider?.value ?? 100),
        shadows: Boolean(root.querySelector('#set-shadows')?.checked),
        showHealthBars: Boolean(root.querySelector('#set-hp')?.checked)
      });
      this.view = 'home';
      this._render();
    });

    // Labs Hub
    root.querySelector('#btn-lobby-open-map-editor')?.addEventListener('click', () => {
      this._activateSelectedMapInState();
      this.destroy();
      this.onOpenMapEditor?.();
    });
    root.querySelector('#btn-lobby-open-units-lab')?.addEventListener('click', () => {
      this.destroy();
      this.onOpenLab?.('units');
    });
    root.querySelector('#btn-lobby-open-heroes')?.addEventListener('click', () => {
      this.destroy();
      this.onOpenLab?.('heroes');
    });
    root.querySelector('#btn-lobby-open-studio')?.addEventListener('click', () => {
      this.destroy();
      this.onOpenLab?.('studio');
    });

    // Skirmish Setup
    const mapSel = root.querySelector('#lobby-select-map');
    mapSel?.addEventListener('change', () => {
      const chosen = this.mapsCatalog.find((m) => m.id === mapSel.value);
      if (chosen) {
        this.selectedMap = chosen;
        this.matchSetup = buildDefaultMatchSetupForMap(chosen);
        this.matchSetup.isDevMode = this.isDevMode;
        this._render();
      }
    });

    root.querySelectorAll('[data-slot-active]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const idx = Number(sel.getAttribute('data-slot-active'));
        const parts = this.matchSetup.participants;
        if (!parts[idx]) return;
        if (idx === 0) {
          if (sel.value === 'ai') {
            parts[0].controller = 'ai';
            parts[0].role = 'ai_spectator';
            parts[0].aiDifficulty = parts[0].aiDifficulty || 'learning';
          } else {
            parts[0].controller = 'player';
            parts[0].role = 'player';
          }
          this.matchSetup.isSpectator = parts[0].controller === 'ai';
          this.matchSetup.playerTeam = this.matchSetup.isSpectator ? 0 : 1;
          normalizeParticipantTeams(parts);
          this._render();
          return;
        }
        if (sel.value === 'closed') {
          parts[idx].role = 'closed';
          parts[idx].controller = 'closed';
          parts[idx].team = 0;
        } else {
          parts[idx].controller = 'ai';
          parts[idx].role = 'ai_enemy';
        }
        normalizeParticipantTeams(parts);
        this._render();
      });
    });

    root.querySelectorAll('[data-slot-team]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const idx = Number(sel.getAttribute('data-slot-team'));
        const parts = this.matchSetup.participants;
        if (!parts[idx]) return;
        parts[idx].teamNumber = Number(sel.value) || 1;
        normalizeParticipantTeams(parts);
        this._render();
      });
    });

    root.querySelectorAll('[data-slot-spawn]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const idx = Number(sel.getAttribute('data-slot-spawn'));
        const spIdx = Number(sel.value);
        const parts = this.matchSetup.participants;
        const spawnPoints = this.selectedMap.spawnPoints || [];
        const sp = spawnPoints[spIdx];
        if (!parts[idx] || !sp) return;
        parts[idx].spawnPointIndex = spIdx;
        parts[idx].spawnPointId = sp.id || `spawn_${spIdx + 1}`;
        parts[idx].spawnName = sp.name || `נקודת הופעה #${spIdx + 1}`;
        parts[idx].x = Number(sp.x);
        parts[idx].z = Number(sp.z);
        parts[idx].facingDir = Number(sp.facingDir ?? parts[idx].facingDir ?? 256);
        this._drawMapPreviewCanvas();
      });
    });

    root.querySelectorAll('[data-slot-diff]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const idx = Number(sel.getAttribute('data-slot-diff'));
        if (this.matchSetup.participants[idx]) {
          this.matchSetup.participants[idx].aiDifficulty = sel.value;
          this._drawMapPreviewCanvas();
        }
      });
    });

    root.querySelector('#btn-lobby-ai-vs-ai')?.addEventListener('click', () => {
      const parts = this.matchSetup.participants || [];
      for (let i = 0; i < parts.length; i++) {
        parts[i].controller = 'ai';
        parts[i].role = 'ai_spectator';
        parts[i].teamNumber = i % 2 === 0 ? 1 : 2;
        parts[i].aiDifficulty = 'learning';
      }
      this.matchSetup.isSpectator = true;
      this.matchSetup.playerTeam = 0;
      normalizeParticipantTeams(parts);
      this._render();
    });

    root.querySelector('#btn-lobby-start-match')?.addEventListener('click', () => {
      this.mapsCatalog = getAvailableMapsCatalog();
      const freshestMap = this.mapsCatalog.find((m) => m.id === this.selectedMap.id);
      if (freshestMap) this.selectedMap = freshestMap;

      const parts = this.matchSetup.participants || [];
      this.matchSetup.isSpectator = parts[0]?.controller === 'ai';
      this.matchSetup.playerTeam = this.matchSetup.isSpectator ? 0 : 1;
      this.matchSetup.isDevMode = Boolean(this.isDevMode);
      delete this.matchSetup.loadedSaveState;
      normalizeParticipantTeams(parts);
      this._activateSelectedMapInState();
      setActiveMatchSetup(this.matchSetup);
      this.destroy();
      this.onStartGame?.(this.matchSetup);
    });
  }

  _activateSelectedMapInState() {
    if (this.selectedMap.id === 'default_royal_valley' && !this.selectedMap.isCustomMapActive) {
      setActiveCustomMapState(null);
    } else {
      setActiveCustomMapState({ ...this.selectedMap, isCustomMapActive: true });
    }
  }

  destroy() {
    if (this._emberRaf) {
      cancelAnimationFrame(this._emberRaf);
      this._emberRaf = null;
    }
    if (this.rootEl) {
      this.rootEl.remove();
      this.rootEl = null;
    }
    const existing = typeof document !== 'undefined' ? document.getElementById('kings-lands-pregame-lobby') : null;
    if (existing) existing.remove();
  }
}

/**
 * In-Game `ESC` Pause Menu Modal:
 * - Resume, Save Game, Load Game, Settings, Exit to Main Menu
 * - Labs section ONLY visible when `isDevMode === true`
 */
export class EscPauseMenuModal {
  constructor({ isDevMode = false, onResume, onSaveGame, onLoadGame, onExitToLobby, onOpenLab }) {
    this.isDevMode = Boolean(isDevMode);
    this.onResume = onResume;
    this.onSaveGame = onSaveGame;
    this.onLoadGame = onLoadGame;
    this.onExitToLobby = onExitToLobby;
    this.onOpenLab = onOpenLab;
    this.isOpen = false;
    this.rootEl = null;
  }

  toggle() {
    if (this.isOpen) {
      this.close();
      this.onResume?.();
    } else {
      this.open();
    }
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    const setup = getActiveMatchSetup();
    const el = document.createElement('div');
    el.id = 'kings-lands-esc-pause-modal';
    el.className =
      'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/82 backdrop-blur-sm select-none';
    el.innerHTML = `
      <div
        class="relative w-full max-w-[440px] rounded-sm px-11 py-12 shadow-[0_24px_64px_rgba(0,0,0,0.95)] text-center space-y-4 overflow-hidden"
        style="background-image: linear-gradient(rgba(6,8,12,0.34), rgba(6,8,12,0.48)), url('/assets/pause_panel_bg.jpg'); background-size: 100% 100%; background-position: center;"
        dir="rtl"
      >
        <div>
          <div class="text-[10px] font-bold tracking-[0.3em] uppercase text-amber-400/90 drop-shadow">${this.isDevMode ? 'DEVELOPER MODE' : 'TACTICAL PAUSE'}</div>
          <h2 class="text-2xl font-black text-amber-200 mt-0.5 drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)]" style="font-family: Georgia, 'Times New Roman', serif;">המשחק מושהה (Paused)</h2>
          <p class="text-xs text-stone-300 mt-1">מפה פעילה: <span class="text-amber-200 font-semibold">${setup?.mapName || 'Royal Valley Crossroads'}</span></p>
        </div>

        <div class="flex flex-col items-center gap-1.5 pt-2" style="font-family: Georgia, 'Times New Roman', serif;">
          <button id="btn-esc-resume" type="button" class="w-full text-center px-4 py-2 bg-transparent border-0 text-amber-100 hover:text-amber-300 hover:bg-gradient-to-r hover:from-transparent hover:via-amber-400/15 hover:to-transparent transition-all duration-200 cursor-pointer tracking-[0.14em] text-xl font-bold drop-shadow-[0_2px_8px_rgba(0,0,0,0.98)]">
            המשך משחק
          </button>

          <button id="btn-esc-save-game" type="button" class="w-full text-center px-4 py-1.5 bg-transparent border-0 text-zinc-300 hover:text-amber-200 hover:bg-gradient-to-r hover:from-transparent hover:via-amber-400/15 hover:to-transparent transition-all duration-200 cursor-pointer tracking-[0.12em] text-lg font-semibold drop-shadow-[0_2px_8px_rgba(0,0,0,0.98)]">
            שמור משחק
          </button>

          <button id="btn-esc-load-game" type="button" class="w-full text-center px-4 py-1.5 bg-transparent border-0 text-zinc-300 hover:text-amber-200 hover:bg-gradient-to-r hover:from-transparent hover:via-amber-400/15 hover:to-transparent transition-all duration-200 cursor-pointer tracking-[0.12em] text-lg font-semibold drop-shadow-[0_2px_8px_rgba(0,0,0,0.98)]">
            טען שמירה
          </button>

          ${
            this.isDevMode
              ? `<div class="w-2/3 border-t border-amber-700/35 my-1 pt-2 text-[11px] font-bold text-amber-300/80 tracking-wider">מעבדות ופיתוח</div>
                 <button id="btn-esc-units-lab" type="button" class="w-full text-center px-4 py-1 bg-transparent border-0 text-zinc-300 hover:text-amber-200 hover:bg-gradient-to-r hover:from-transparent hover:via-amber-400/15 hover:to-transparent transition-all duration-200 cursor-pointer text-base font-semibold drop-shadow-[0_2px_8px_rgba(0,0,0,0.98)]">
                   יחידות ומבנים
                 </button>
                 <button id="btn-esc-heroes" type="button" class="w-full text-center px-4 py-1 bg-transparent border-0 text-zinc-300 hover:text-amber-200 hover:bg-gradient-to-r hover:from-transparent hover:via-amber-400/15 hover:to-transparent transition-all duration-200 cursor-pointer text-base font-semibold drop-shadow-[0_2px_8px_rgba(0,0,0,0.98)]">
                   היכל הגיבורים
                 </button>
                 <button id="btn-esc-studio" type="button" class="w-full text-center px-4 py-1 bg-transparent border-0 text-zinc-300 hover:text-amber-200 hover:bg-gradient-to-r hover:from-transparent hover:via-amber-400/15 hover:to-transparent transition-all duration-200 cursor-pointer text-base font-semibold drop-shadow-[0_2px_8px_rgba(0,0,0,0.98)]">
                   מעבדת אנימציות
                 </button>`
              : ''
          }

          <div id="esc-save-toast" class="hidden text-xs font-bold text-emerald-300 py-1"></div>

          <div class="w-2/3 border-t border-amber-700/35 my-1 pt-1"></div>
          <button id="btn-esc-exit-lobby" type="button" class="w-full text-center px-4 py-1.5 bg-transparent border-0 text-zinc-400 hover:text-rose-300 hover:bg-gradient-to-r hover:from-transparent hover:via-rose-500/15 hover:to-transparent transition-all duration-200 cursor-pointer tracking-[0.12em] text-base font-semibold drop-shadow-[0_2px_8px_rgba(0,0,0,0.98)]">
            יציאה לעמוד הראשי
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(el);
    this.rootEl = el;

    el.querySelector('#btn-esc-resume')?.addEventListener('click', () => {
      this.close();
      this.onResume?.();
    });

    el.querySelector('#btn-esc-save-game')?.addEventListener('click', async () => {
      const ok = await this.onSaveGame?.();
      const toast = el.querySelector('#esc-save-toast');
      if (toast) {
        toast.textContent = ok ? '✅ המשחק נשמר בהצלחה!' : '⚠️ לא ניתן היה לשמור כרגע';
        toast.classList.remove('hidden');
      }
    });

    el.querySelector('#btn-esc-load-game')?.addEventListener('click', () => {
      this.close();
      this.onLoadGame?.();
    });

    el.querySelector('#btn-esc-units-lab')?.addEventListener('click', () => {
      this.close();
      this.onOpenLab?.('units');
    });
    el.querySelector('#btn-esc-heroes')?.addEventListener('click', () => {
      this.close();
      this.onOpenLab?.('heroes');
    });
    el.querySelector('#btn-esc-studio')?.addEventListener('click', () => {
      this.close();
      this.onOpenLab?.('studio');
    });
    el.querySelector('#btn-esc-exit-lobby')?.addEventListener('click', () => {
      this.close();
      this.onExitToLobby?.();
    });
  }

  close() {
    this.isOpen = false;
    if (this.rootEl) {
      this.rootEl.remove();
      this.rootEl = null;
    }
    const existing = typeof document !== 'undefined' ? document.getElementById('kings-lands-esc-pause-modal') : null;
    if (existing) existing.remove();
  }
}
