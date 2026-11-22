import { resolveUnitActiveCapabilities } from '../../sim/combatCapabilitiesRegistry.js';
/**
 * Kings Lands — Phase 8: Bottom-Right Hero & Unit Tactical Control Orb + 5 Perimeter Spell Buttons
 * + Hero Weapon Switch Button & Stance-Adaptive Spells
 * (src/ui/hud/unitTacticalOrb.js)
 *
 * Refined Hero Orb Layout:
 * - Hero Name floats on the top rim/border of the circle (`#rp-hero-floating-name`).
 * - Inside the upper arch (compact, well within circle borders):
 *   1. `Level X` centered at the top.
 *   2. Row below: compact XP progress bar on the left + cumulative `cur/nextxp` on the right.
 *   3. Row below: compact Stamina progress bar.
 * - The 5 Perimeter Spell Circles sit along the left circular border rail:
 *   - Automatically swap icons/names/descriptions when the Hero switches between Bow (`ranged`) and Sword (`melee`).
 *   - Dimmed with a lock indicator when `disabledByWeapon === true` (e.g. melee-only slam while holding a Bow).
 *   - Highlighted with a glowing targeting ring when awaiting a ground/unit target click!
 * - `#rp-btn-hero-weapon-switch` sits right beside the Walk/Run button (`#rp-btn-gait`) whenever a Hero has a 2nd gear set!
 * - Hovering over any spell on the orb for 0.5s (500ms) opens a styled floating bubble showing only the
 *   spell's Name and what it does (`description`).
 */

import { FormationTypes } from '../../sim/formations/formations.js';
import { FORMATION_SVG_ICONS, HERO_SPELL_SVG_ICONS, OPTION_SVG_ICONS, buildOrbDecorationsSvg } from './hudIcons.js';

// 5 Perimeter Spell Circles along the left circular rim rail (cx=129, cy=119, rx=121, ry=109, angles 228°..136°)
const PERIMETER_SPELL_COORDS = Object.freeze([
  { left: 28, top: 18 },
  { left: -1, top: 53 },
  { left: -12, top: 95 },
  { left: -4, top: 138 },
  { left: 22, top: 175 }
]);

const ORB_MEDALLION_IDLE =
  'rounded-full border-2 border-amber-600/80 bg-[radial-gradient(circle_at_35%_30%,#2a2219_0%,#14100c_68%,#090705_100%)] hover:border-amber-400 hover:brightness-110 flex items-center justify-center transition shadow-[0_4px_12px_rgba(0,0,0,0.92),inset_0_1px_2px_rgba(251,191,36,0.28),inset_0_-2px_4px_rgba(0,0,0,0.85)] cursor-pointer';
const ORB_MEDALLION_ACTIVE_GOLD =
  'rounded-full border-2 border-amber-300 bg-[radial-gradient(circle_at_35%_30%,#523915_0%,#291c0a_72%,#140d04_100%)] text-amber-200 flex items-center justify-center transition shadow-[0_0_14px_rgba(251,191,36,0.55),inset_0_1px_2px_rgba(255,235,175,0.45)] scale-105 cursor-pointer';
const ORB_MEDALLION_ACTIVE_CRIMSON =
  'rounded-full border-2 border-rose-400 bg-[radial-gradient(circle_at_35%_30%,#581c22_0%,#2b0d10_72%,#160608_100%)] text-rose-200 flex items-center justify-center transition shadow-[0_0_14px_rgba(244,63,94,0.6),inset_0_1px_2px_rgba(254,205,211,0.4)] scale-105 cursor-pointer';
const ORB_MEDALLION_DISABLED =
  'rounded-full border border-stone-700/80 bg-[radial-gradient(circle_at_35%_30%,#1b1714_0%,#0d0b09_100%)] flex items-center justify-center opacity-40 cursor-not-allowed';

export class UnitTacticalOrb {
  constructor({
    onToggleGait,
    onCycleFormation,
    onToggleFireMode,
    onClickAttackMove,
    onClickPatrol,
    onCastHeroSpell,
    onHoverHeroSpell,
    onSwitchHeroWeapon,
    onLevelUpHeroCheat
  }) {
    this.onToggleGait = onToggleGait;
    this.onCycleFormation = onCycleFormation;
    this.onToggleFireMode = onToggleFireMode;
    this.onClickAttackMove = onClickAttackMove;
    this.onClickPatrol = onClickPatrol;
    this.onCastHeroSpell = onCastHeroSpell || null;
    this.onHoverHeroSpell = onHoverHeroSpell || null;
    this.onSwitchHeroWeapon = onSwitchHeroWeapon || null;
    this.onLevelUpHeroCheat = onLevelUpHeroCheat || null;

    this._lastRenderSignature = '';
    this._currentHeroCompanyId = null;
    this._currentHeroSpells = [];
    this._spellHoverTimer = null;
    this._hoveredSpellSlotIdx = -1;
    this._buildDom();
  }

  _buildDom() {
    const existingOrb = document.getElementById('phase4-orb-dial-panel');
    if (existingOrb) existingOrb.remove();

    this.rootEl = document.createElement('aside');
    this.rootEl.id = 'phase4-orb-dial-panel';

    const perimeterButtonsHtml = PERIMETER_SPELL_COORDS.map(
      (pos, idx) => `
      <button
        id="hero-spell-slot-${idx}"
        type="button"
        data-spell-slot="${idx}"
        style="left: ${pos.left}px; top: ${pos.top}px; background-color: #090d16; display: none;"
        class="pointer-events-auto group absolute z-30 w-10 h-10 rounded-full border-2 border-slate-700 bg-slate-950 flex items-center justify-center shadow-[0_6px_16px_rgba(0,0,0,0.95)] transition-transform select-none"
      ></button>
    `
    ).join('');

    this.rootEl.innerHTML = `
      <!-- Inner clipped orb surface -->
      <div
        class="pointer-events-none absolute inset-0 rounded-[50%] border-2 border-amber-400/65 overflow-hidden"
        style="background-image: radial-gradient(circle at center, rgba(6,10,18,0.68) 0%, rgba(6,10,18,0.45) 65%, rgba(2,4,8,0.8) 100%), url('/assets/hud_orb_frame.jpg'); background-size: cover; background-position: center; box-shadow: 0 14px 36px rgba(0, 0, 0, 0.92), inset 0 0 22px rgba(251, 191, 36, 0.25);"
      >
        ${buildOrbDecorationsSvg('M 38 78 Q 129 66 220 78')}
      </div>

      <!-- Floating Hero Name on the Top Border Rim of the Circle -->
      <div
        id="rp-hero-floating-name"
        class="pointer-events-none hidden absolute -top-3.5 left-1/2 -translate-x-1/2 z-30 rounded-full border border-amber-400/85 bg-slate-950/95 px-3.5 py-0.5 text-[11px] font-black uppercase tracking-wider text-amber-300 shadow-[0_4px_12px_rgba(0,0,0,0.95)] whitespace-nowrap"
      >
        WIZARD
      </div>

      <!-- 5 Perimeter Spell Circles (pointer-events-none wrapper so inner orb buttons remain 100% clickable!) -->
      <div id="rp-hero-perimeter-wrap" class="pointer-events-none absolute inset-0 z-30 hidden">
        ${perimeterButtonsHtml}
      </div>

      <!-- 0.5s Delayed Floating Spell Description Bubble -->
      <div
        id="rp-spell-hover-bubble"
        class="pointer-events-none hidden absolute z-40 w-52 rounded-2xl border border-amber-400/80 bg-slate-950/95 px-3 py-2 text-left shadow-[0_10px_28px_rgba(0,0,0,0.95)] backdrop-blur-md"
      >
        <div id="rp-spell-bubble-title" class="text-[11px] font-black text-amber-300 leading-tight mb-0.5"></div>
        <div id="rp-spell-bubble-desc" class="text-[10px] font-medium text-slate-200 leading-snug"></div>
      </div>

      <!-- Upper Arch Info Section (Compact & Centered Inside Orb) -->
      <div class="pointer-events-none absolute top-[12px] inset-x-0 z-10 flex flex-col items-center justify-center px-8">
        <!-- Standard Company Title (Hidden when a single Hero is selected) -->
        <div
          id="rp-company-title"
          class="text-[11px] font-extrabold uppercase tracking-wider text-amber-300 drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]"
          style="width: 82%; max-width: 150px; margin: 0 auto; white-space: normal; word-wrap: break-word; overflow-wrap: break-word; text-align: center; line-height: 1.15;"
        >
          Royal Builders Guild
        </div>

        <!-- Hero Centered Level + Wider XP Bar + Dedicated HP Bar (with HP/MaxHP on right) -->
        <div id="rp-hero-xp-wrap" class="pointer-events-none hidden w-[132px] flex-col items-center gap-1">
          <span id="rp-hero-level-badge" class="mono text-[10px] font-black text-amber-300 leading-none text-center">
            Level 1
          </span>
          <!-- XP Bar Row (thicker bar + XP numbers on the right) -->
          <div class="w-full flex items-center gap-1.5">
            <div class="flex-1 h-[6px] rounded-full bg-slate-950 border border-sky-500/60 overflow-hidden">
              <div id="rp-hero-xp-bar" class="h-full bg-sky-400 transition-all" style="width: 10%;"></div>
            </div>
            <span id="rp-hero-xp-text" class="mono text-[8.5px] font-bold text-sky-200 leading-none shrink-0">
              0/100xp
            </span>
          </div>
          <!-- Dedicated Hero HP Bar Row (between XP and Stamina, with HP/MaxHP numbers on the right!) -->
          <div class="w-full flex items-center gap-1.5">
            <div class="flex-1 h-[6px] rounded-full bg-slate-950 border border-emerald-500/60 overflow-hidden">
              <div id="rp-hero-hp-bar" class="h-full bg-emerald-400 transition-all" style="width: 100%;"></div>
            </div>
            <span id="rp-hero-hp-text" class="mono text-[8.5px] font-bold text-emerald-300 leading-none shrink-0">
              680/680hp
            </span>
          </div>
        </div>

        <!-- Stamina Bar (pushed slightly down, slightly shorter in length w-[94px], and thicker h-[6px]) -->
        <div class="w-[94px] flex flex-col items-center gap-1 mt-1.5">
          <div class="w-full h-[6px] rounded-full bg-slate-950 border border-amber-500/50 overflow-hidden">
            <div id="rp-stamina-bar" class="h-full bg-amber-400 transition-all" style="width: 100%;"></div>
          </div>
          <div id="rp-ammo-bar-wrap" class="hidden w-full h-1.5 rounded-full bg-slate-950 border border-slate-700 overflow-hidden">
            <div id="rp-ammo-bar" class="h-full bg-sky-400 transition-all" style="width: 100%;"></div>
          </div>
        </div>
      </div>

      <div class="pointer-events-auto absolute top-1/2 -translate-y-[38%] inset-x-0 z-20 flex flex-col items-center justify-center">
        <div class="w-full flex items-center justify-center gap-3.5">
          <button id="rp-btn-patrol" type="button" title="Patrol (P)" class="w-11 h-11 ${ORB_MEDALLION_IDLE}">
            <svg class="pointer-events-none w-6 h-6 text-amber-300" viewBox="0 0 64 64" fill="none">
              <path d="M 32 10 A 22 22 0 1 1 12.5 22" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/>
              <polyline points="24,5 33,10 26,18" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
              <text x="32" y="39" text-anchor="middle" fill="#fef3c7" font-family="Georgia, serif" font-weight="800" font-size="22">P</text>
            </svg>
          </button>

          <button id="rp-btn-attack-move" type="button" title="Attack-Move (Shift + A)" class="w-11 h-11 ${ORB_MEDALLION_IDLE}">
            <svg class="pointer-events-none w-6 h-6 text-rose-400" viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="22" stroke="currentColor" stroke-width="3.5"/>
              <circle cx="32" cy="32" r="14" stroke="#d97706" stroke-width="1.5" stroke-dasharray="3 3"/>
              <line x1="32" y1="3" x2="32" y2="14" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
              <line x1="32" y1="50" x2="32" y2="61" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
              <line x1="3" y1="32" x2="14" y2="32" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
              <line x1="50" y1="32" x2="61" y2="32" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
              <rect x="6" y="24" width="52" height="16" rx="8" fill="#140f0a" fill-opacity="0.92" stroke="#b45309" stroke-width="1.2"/>
              <text x="32" y="35" text-anchor="middle" fill="#fde68a" font-family="JetBrains Mono, monospace" font-weight="800" font-size="9.5">Shift+A</text>
            </svg>
          </button>
        </div>

        <div class="w-full flex items-center justify-center gap-2.5 mt-2.5">
          <button id="rp-btn-formation-toggle" type="button" title="Toggle Formation" class="hidden w-9 h-9 ${ORB_MEDALLION_IDLE}">
          </button>

          <button id="rp-btn-fire-mode" type="button" title="Fire at Will / Fire by Order" class="hidden w-9 h-9 ${ORB_MEDALLION_IDLE}">
            <svg id="rp-fire-mode-icon" class="pointer-events-none w-4 h-4 text-amber-200 transition" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 4c7 3.5 9 8.5 9 8s-2 4.5-9 8" />
              <line x1="6" y1="4" x2="6" y2="20" stroke-linecap="round" />
              <line x1="3" y1="12" x2="20" y2="12" stroke-linecap="round" />
              <polyline points="16,8 20,12 16,16" stroke-linecap="round" stroke-linejoin="round" />
              <line id="rp-fire-mode-slash" class="hidden" x1="4" y1="4" x2="20" y2="20" stroke="#f43f5e" stroke-width="2.6" stroke-linecap="round" />
            </svg>
          </button>

          <button id="rp-btn-gait" type="button" title="Walk / Run" class="w-9 h-9 ${ORB_MEDALLION_IDLE}">
            <svg id="rp-gait-icon" class="pointer-events-none w-4 h-4 text-amber-200 transition" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path id="rp-gait-trail" class="hidden" stroke-linecap="round" d="M2 10h4M1 14h5M3 6h3" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5c1.5 0 2.5 1.2 2.5 2.8 0 1.8-1.2 3.4-1.5 5.2-.2 1.2.5 2.5 1.8 3 1.2.4 2.2 1.2 2.2 2.5 0 1.2-1 2-2.5 2H10c-1.8 0-3-1.2-3-3 0-2.2 1.5-4.5 2.2-6.8.7-2.5 2.1-5.7 4.3-5.7z" />
            </svg>
          </button>

          <!-- Hero Switch Weapon Button (right next to Walk/Run, shown when a single Hero with 2 gear sets is selected!) -->
          <button
            id="rp-btn-hero-weapon-switch"
            type="button"
            title="Switch Weapon Set"
            class="hidden w-9 h-9 ${ORB_MEDALLION_IDLE} text-amber-300"
          ></button>
        </div>
      </div>
    `;

    document.body.appendChild(this.rootEl);

    this._els = {
      title: this.rootEl.querySelector('#rp-company-title'),
      heroFloatingName: this.rootEl.querySelector('#rp-hero-floating-name'),
      heroPerimeterWrap: this.rootEl.querySelector('#rp-hero-perimeter-wrap'),
      spellHoverBubble: this.rootEl.querySelector('#rp-spell-hover-bubble'),
      spellBubbleTitle: this.rootEl.querySelector('#rp-spell-bubble-title'),
      spellBubbleDesc: this.rootEl.querySelector('#rp-spell-bubble-desc'),
      heroXpWrap: this.rootEl.querySelector('#rp-hero-xp-wrap'),
      heroLevelBadge: this.rootEl.querySelector('#rp-hero-level-badge'),
      heroXpText: this.rootEl.querySelector('#rp-hero-xp-text'),
      heroXpBar: this.rootEl.querySelector('#rp-hero-xp-bar'),
      heroHpText: this.rootEl.querySelector('#rp-hero-hp-text'),
      heroHpBar: this.rootEl.querySelector('#rp-hero-hp-bar'),
      spellSlots: PERIMETER_SPELL_COORDS.map((_, i) =>
        this.rootEl.querySelector(`#hero-spell-slot-${i}`)
      ),
      staminaBar: this.rootEl.querySelector('#rp-stamina-bar'),
      ammoWrap: this.rootEl.querySelector('#rp-ammo-bar-wrap'),
      ammoBar: this.rootEl.querySelector('#rp-ammo-bar'),
      formBtn: this.rootEl.querySelector('#rp-btn-formation-toggle'),
      fireBtn: this.rootEl.querySelector('#rp-btn-fire-mode'),
      fireIcon: this.rootEl.querySelector('#rp-fire-mode-icon'),
      fireSlash: this.rootEl.querySelector('#rp-fire-mode-slash'),
      gaitBtn: this.rootEl.querySelector('#rp-btn-gait'),
      gaitIcon: this.rootEl.querySelector('#rp-gait-icon'),
      gaitTrail: this.rootEl.querySelector('#rp-gait-trail'),
      heroWeaponSwitchBtn: this.rootEl.querySelector('#rp-btn-hero-weapon-switch'),
      atkBtn: this.rootEl.querySelector('#rp-btn-attack-move'),
      patBtn: this.rootEl.querySelector('#rp-btn-patrol')
    };

    this.rootEl.addEventListener('mousedown', (e) => e.stopPropagation());
    this.rootEl.addEventListener('mouseup', (e) => e.stopPropagation());
    this.rootEl.addEventListener('dblclick', (e) => e.stopPropagation());

    this._els.gaitBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.blur?.();
      if (this.onToggleGait) this.onToggleGait();
    });

    this._els.heroWeaponSwitchBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.blur?.();
      if (this.onSwitchHeroWeapon) {
        this.onSwitchHeroWeapon(this._currentHeroCompanyId);
      }
    });

    this._els.fireBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.blur?.();
      if (this.onToggleFireMode) this.onToggleFireMode();
    });

    this._els.formBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.blur?.();
      if (this.onCycleFormation) this.onCycleFormation();
    });

    this._els.atkBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.blur?.();
      if (this.onClickAttackMove) this.onClickAttackMove(Boolean(e.shiftKey));
    });

    this._els.patBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.blur?.();
      if (this.onClickPatrol) this.onClickPatrol(Boolean(e.shiftKey));
    });

    const hideSpellBubble = () => {
      clearTimeout(this._spellHoverTimer);
      this._spellHoverTimer = null;
      this._hoveredSpellSlotIdx = -1;
      this._els.spellHoverBubble?.classList.add('hidden');
      if (this.onHoverHeroSpell) {
        this.onHoverHeroSpell(this._currentHeroCompanyId, null, -1);
      }
    };

    for (let i = 0; i < this._els.spellSlots.length; i++) {
      const slotBtn = this._els.spellSlots[i];
      if (!slotBtn) continue;

      slotBtn.addEventListener('pointerenter', () => {
        clearTimeout(this._spellHoverTimer);
        this._hoveredSpellSlotIdx = i;
        const sp = this._currentHeroSpells?.[i];
        if (!sp) {
          this._els.spellHoverBubble?.classList.add('hidden');
          if (this.onHoverHeroSpell) this.onHoverHeroSpell(this._currentHeroCompanyId, null, -1);
          return;
        }
        if (this.onHoverHeroSpell) {
          this.onHoverHeroSpell(this._currentHeroCompanyId, sp, i);
        }
        // Wait 0.5 seconds (500ms) before opening the floating spell description bubble
        this._spellHoverTimer = setTimeout(() => {
          const activeSp = this._currentHeroSpells?.[i];
          if (!activeSp || this._hoveredSpellSlotIdx !== i) return;
          const bubble = this._els.spellHoverBubble;
          const titleNode = this._els.spellBubbleTitle;
          const descNode = this._els.spellBubbleDesc;
          if (!bubble || !titleNode || !descNode) return;

          const baseTitle = activeSp.nameEn || activeSp.name || activeSp.spellId;
          const isLockedSpell = (activeSp.level | 0) <= 0;
          titleNode.textContent = isLockedSpell
            ? `${baseTitle} (Unlocks Lv.${activeSp.unlockAtHeroLevel || '?'})`
            : baseTitle;
          descNode.textContent = activeSp.disabledByWeapon
            ? `Requires ${String(activeSp.requiredWeaponMode || 'other').toUpperCase()} weapon stance. ${activeSp.description || ''}`
            : activeSp.description || '';
          const pos = PERIMETER_SPELL_COORDS[i] || { left: 0, top: 60 };
          bubble.style.left = `${pos.left - 216}px`;
          // Clamp vertical position so lower spell slots (slots 2, 3, 4) shift upward and NEVER overflow below the screen!
          const clampedTop = Math.max(-16, Math.min(110, pos.top - (i >= 3 ? 58 : i === 2 ? 26 : 6)));
          bubble.style.top = `${clampedTop}px`;
          bubble.classList.remove('hidden');
        }, 500);
      });

      slotBtn.addEventListener('pointerleave', hideSpellBubble);
      slotBtn.addEventListener('pointerdown', hideSpellBubble);
    }

    this._els.heroPerimeterWrap?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-spell-slot]');
      if (!btn || this._currentHeroCompanyId === null) return;
      e.preventDefault();
      e.stopPropagation();
      const slotIdx = Number(btn.dataset.spellSlot) | 0;
      const spell = this._currentHeroSpells?.[slotIdx];
      if (
        !spell ||
        (spell.level | 0) <= 0 ||
        spell.type === 'passive' ||
        (spell.cooldownTicks | 0) > 0 ||
        spell.disabledByWeapon
      ) {
        return;
      }
      if (this.onCastHeroSpell) {
        this.onCastHeroSpell(this._currentHeroCompanyId, spell, slotIdx);
      }
    });
  }

  _renderHeroPerimeterSpells(heroSimState, fallbackName = 'Hero', targetingSpellSlotIdx = -1) {
    const wrap = this._els?.heroPerimeterWrap;
    const xpWrap = this._els?.heroXpWrap;
    const titleEl = this._els?.title;
    const floatingNameEl = this._els?.heroFloatingName;
    const weaponSwitchBtn = this._els?.heroWeaponSwitchBtn;
    if (!wrap || !xpWrap) return;

    if (!heroSimState || !heroSimState.isHero) {
      wrap.classList.add('hidden');
      xpWrap.classList.add('hidden');
      xpWrap.classList.remove('flex');
      floatingNameEl?.classList.add('hidden');
      weaponSwitchBtn?.classList.add('hidden');
      this._els?.spellHoverBubble?.classList.add('hidden');
      clearTimeout(this._spellHoverTimer);
      titleEl?.classList.remove('hidden');
      if (this._hoveredSpellSlotIdx !== -1 && this.onHoverHeroSpell) {
        this.onHoverHeroSpell(null, null, -1);
      }
      this._currentHeroCompanyId = null;
      this._currentHeroSpells = [];
      return;
    }

    titleEl?.classList.add('hidden');
    if (floatingNameEl) {
      floatingNameEl.textContent = (heroSimState.name || fallbackName || 'HERO').toUpperCase();
      floatingNameEl.classList.remove('hidden');
    }
    wrap.classList.remove('hidden');
    xpWrap.classList.remove('hidden');
    xpWrap.classList.add('flex');

    if (weaponSwitchBtn) {
      if (heroSimState.hasSecondaryLoadout) {
        const isRangedNow = heroSimState.activeWeaponMode === 'ranged';
        weaponSwitchBtn.classList.remove('hidden');
        weaponSwitchBtn.innerHTML = isRangedNow ? OPTION_SVG_ICONS.archer : OPTION_SVG_ICONS.swordsman;
        weaponSwitchBtn.title = isRangedNow
          ? 'Current: Bow Stance (Click to switch to Melee Sword)'
          : 'Current: Melee Stance (Click to switch to Ranged Bow)';
      } else {
        weaponSwitchBtn.classList.add('hidden');
      }
    }

    const lvl = heroSimState.heroLevel || 1;
    const xp = heroSimState.heroXp || 0;
    const xpFloor = heroSimState.heroXpFloor || 0;
    const xpNext = Math.max(xpFloor + 1, heroSimState.heroXpToNext || 100);
    const span = Math.max(1, xpNext - xpFloor);
    const xpPct =
      lvl >= 10
        ? 100
        : Math.max(4, Math.min(100, Math.round(((xp - xpFloor) / span) * 100)));

    if (this._els.heroLevelBadge) {
      this._els.heroLevelBadge.textContent = `Level ${lvl}`;
    }
    if (this._els.heroXpText) {
      this._els.heroXpText.textContent = `${xp}/${xpNext}xp`;
    }
    if (this._els.heroXpBar) {
      this._els.heroXpBar.style.width = `${xpPct}%`;
    }
    const curHp = Math.max(0, heroSimState.heroHp ?? 680);
    const maxHp = Math.max(1, heroSimState.heroMaxHp ?? 680);
    const hpPct = Math.max(0, Math.min(100, Math.round((curHp / maxHp) * 100)));
    if (this._els.heroHpText) {
      this._els.heroHpText.textContent = `${curHp}/${maxHp}hp`;
    }
    if (this._els.heroHpBar) {
      this._els.heroHpBar.style.width = `${hpPct}%`;
      this._els.heroHpBar.className =
        hpPct <= 25
          ? 'h-full bg-rose-500 transition-all'
          : hpPct <= 55
            ? 'h-full bg-amber-400 transition-all'
            : 'h-full bg-emerald-400 transition-all';
    }

    const spells = Array.isArray(heroSimState.heroSpells) ? heroSimState.heroSpells : [];
    this._currentHeroSpells = spells;

    for (let i = 0; i < 5; i++) {
      const btn = this._els.spellSlots[i];
      if (!btn) continue;
      btn.style.display = 'flex';
      btn.removeAttribute('title');
      const sp = spells[i] || null;

      btn.style.backgroundColor = '#090d16';
      if (!sp) {
        btn.setAttribute('data-no-pointer', '1');
        btn.className =
          'pointer-events-auto group absolute z-30 w-10 h-10 rounded-full border-2 border-dashed border-slate-700 bg-slate-950 flex items-center justify-center shadow-inner cursor-default';
        btn.innerHTML = '';
        continue;
      }

      const iconSvg =
        HERO_SPELL_SVG_ICONS[sp.icon] ||
        HERO_SPELL_SVG_ICONS[sp.spellId] ||
        HERO_SPELL_SVG_ICONS.fireball;
      const isPassive = sp.type === 'passive';
      const isDisabledByWeapon = Boolean(sp.disabledByWeapon);
      const isTargetingThis = targetingSpellSlotIdx === i;
      const cdTicks = sp.cooldownTicks | 0;
      const maxCdTicks = Math.max(1, sp.maxCooldownTicks | 0);
      const cdSec = Math.ceil(cdTicks / 20);

      // Color-code spell slots by category: Defense = Grey, Attack/Attack+Defense = Brown-Orange, Healing = Blue-Green
      const sid = sp.spellId || '';
      const isHealSpell = sid === 'self_heal' || sid === 'heal';
      const isDefenseSpell = sid === 'iron_blood' || sid === 'iron_skin';
      const isBrownOrangeBuff =
        sid === 'aura_of_valor' || sid === 'war_cry' || sid === 'aegis_banner' || sid === 'kings_decree';

      const isLocked = (sp.level | 0) <= 0;
      if (isLocked) {
        btn.setAttribute('data-no-pointer', '1');
        btn.className =
          'pointer-events-auto group absolute z-30 w-10 h-10 rounded-full border-2 border-slate-700 bg-slate-950 flex items-center justify-center shadow-[0_6px_16px_rgba(0,0,0,0.95)] cursor-default';
        btn.innerHTML = `
          <div class="pointer-events-none relative z-10 grayscale opacity-45 flex items-center justify-center">${iconSvg}</div>
          <span class="pointer-events-none absolute -bottom-1 -right-1 px-1 rounded-full bg-slate-800 text-slate-300 font-black text-[7.5px] border border-slate-600 mono">L${sp.unlockAtHeroLevel || '?'}</span>
        `;
      } else if (isPassive) {
        btn.setAttribute('data-no-pointer', '1');
        const passiveTheme = isDefenseSpell
          ? {
              cls: 'border-slate-400 bg-slate-900 ring-slate-400/55 shadow-[inset_0_0_12px_rgba(148,163,184,0.75),0_4px_12px_rgba(0,0,0,0.95)]',
              badge: 'bg-slate-300 text-slate-950'
            }
          : isBrownOrangeBuff
            ? {
                cls: 'border-amber-600 bg-amber-950 ring-amber-600/60 shadow-[inset_0_0_12px_rgba(217,119,6,0.85),0_4px_12px_rgba(0,0,0,0.95)]',
                badge: 'bg-amber-600 text-white'
              }
            : {
                cls: 'border-sky-400 bg-sky-950 ring-sky-400/50 shadow-[inset_0_0_12px_rgba(56,189,248,0.75),0_4px_12px_rgba(0,0,0,0.95)]',
                badge: 'bg-sky-400 text-slate-950'
              };
        btn.className = `pointer-events-auto group absolute z-30 w-10 h-10 rounded-full border-2 ring-2 scale-95 flex items-center justify-center cursor-default ${passiveTheme.cls}`;
        btn.innerHTML = `
          <div class="pointer-events-none relative z-10 flex items-center justify-center">${iconSvg}</div>
          <span class="pointer-events-none absolute -top-1 -right-1 px-1 rounded-full ${passiveTheme.badge} font-black text-[8px] border border-slate-950 mono">R${sp.level}</span>
        `;
      } else if (isDisabledByWeapon) {
        btn.setAttribute('data-no-pointer', '1');
        btn.className =
          'pointer-events-auto group absolute z-30 w-10 h-10 rounded-full border-2 border-slate-700 bg-slate-950 flex items-center justify-center shadow-[0_6px_16px_rgba(0,0,0,0.95)] cursor-not-allowed';
        btn.innerHTML = `
          <div class="pointer-events-none relative z-10 grayscale opacity-40 flex items-center justify-center">${iconSvg}</div>
          <span class="pointer-events-none absolute -bottom-1 -right-1 px-1 rounded-full bg-rose-900 text-rose-200 font-black text-[7.5px] border border-rose-500 mono">⚔</span>
        `;
      } else if (cdTicks > 0) {
        const cdPct = Math.max(5, Math.min(100, Math.round((cdTicks / maxCdTicks) * 100)));
        btn.setAttribute('data-no-pointer', '1');
        btn.className =
          'pointer-events-auto group absolute z-30 w-10 h-10 rounded-full border-2 border-slate-600 bg-slate-950 flex items-center justify-center shadow-[0_6px_16px_rgba(0,0,0,0.95)] cursor-default overflow-hidden';
        btn.innerHTML = `
          <div class="pointer-events-none relative z-10 opacity-35 flex items-center justify-center">${iconSvg}</div>
          <div class="pointer-events-none absolute inset-x-0 bottom-0 bg-slate-900/90 transition-all" style="height: ${cdPct}%;"></div>
          <span class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center mono text-[10.5px] font-black text-amber-300 drop-shadow">${cdSec}s</span>
        `;
      } else {
        btn.removeAttribute('data-no-pointer');
        const activeBorderCls = isHealSpell
          ? 'border-teal-400 bg-teal-950 hover:border-teal-300'
          : isBrownOrangeBuff
            ? 'border-amber-600 bg-amber-950 hover:border-amber-400'
            : 'border-amber-400 bg-slate-950 hover:border-sky-300';
        const activeBadgeCls = isHealSpell
          ? 'bg-teal-400 text-slate-950'
          : isBrownOrangeBuff
            ? 'bg-amber-600 text-white'
            : 'bg-sky-400 text-slate-950';
        btn.className = isTargetingThis
          ? 'pointer-events-auto group absolute z-30 w-10 h-10 rounded-full border-2 border-sky-300 bg-sky-900/95 ring-4 ring-sky-400/50 scale-110 flex items-center justify-center shadow-[0_0_18px_rgba(56,189,248,0.85)] cursor-pointer transition-transform'
          : `pointer-events-auto group absolute z-30 w-10 h-10 rounded-full border-2 ${activeBorderCls} hover:scale-105 active:scale-95 flex items-center justify-center shadow-[0_6px_16px_rgba(0,0,0,0.92)] cursor-pointer transition-transform`;
        btn.innerHTML = `
          <div class="pointer-events-none relative z-10 flex items-center justify-center">${iconSvg}</div>
          <span class="pointer-events-none absolute -top-1 -right-1 px-1 rounded-full ${activeBadgeCls} font-black text-[8px] border border-slate-950 mono">R${sp.level}</span>
        `;
      }
    }
  }

  refreshFormationButtonOnly(selectedList, companyFormations, ecoStates = null) {
    const formToggleBtn = this._els?.formBtn;
    if (!formToggleBtn) return;

    if (!selectedList || selectedList.length === 0) {
      if (formToggleBtn.className !== 'hidden') formToggleBtn.className = 'hidden';
      return;
    }

    const getSecFormFor = (c) => {
      const st = ecoStates?.[c.companyId];
      if (st?.isHero || c.unitType === 'hero') return null;
      if (st?.secondaryFormation !== undefined) return st.secondaryFormation;
      return resolveUnitActiveCapabilities(c.unitType, st?.activeLoadoutIdx || 0).secondaryFormation;
    };

    const firstSecForm = getSecFormFor(selectedList[0]);
    const allSameSecForm = Boolean(
      firstSecForm && selectedList.every((c) => getSecFormFor(c) === firstSecForm)
    );

    if (allSameSecForm) {
      const firstComp = selectedList[0];
      const authoritativeForm =
        ecoStates?.[firstComp.companyId]?.formation ||
        companyFormations.get(firstComp.companyId) ||
        firstComp.formation ||
        FormationTypes.SQUARE;
      const isSecActive = authoritativeForm === firstSecForm;
      const iconMap = {
        wedge: isSecActive ? 'wedge' : 'square',
        spearWall: 'spearWall',
        shieldWall: 'spearWall',
        pikePhalanx: 'spearWall',
        skirmishCircle: 'square'
      };
      const iconKey = iconMap[firstSecForm] || 'square';
      if (formToggleBtn.dataset.iconKey !== iconKey) {
        formToggleBtn.innerHTML = FORMATION_SVG_ICONS[iconKey] || FORMATION_SVG_ICONS.square;
        formToggleBtn.dataset.iconKey = iconKey;
      }
      const labelMap = {
        wedge: 'Wedge',
        spearWall: 'Spear Wall',
        shieldWall: 'Shield Wall',
        pikePhalanx: 'Pike Phalanx',
        skirmishCircle: 'Skirmish Circle'
      };
      const secLabel = labelMap[firstSecForm] || firstSecForm;
      formToggleBtn.title = isSecActive
        ? `Formation: ${secLabel} (Click for Square)`
        : `Formation: Square (Click for ${secLabel})`;
      formToggleBtn.className = isSecActive
        ? `w-9 h-9 ${ORB_MEDALLION_ACTIVE_GOLD}`
        : `w-9 h-9 ${ORB_MEDALLION_IDLE} text-amber-200`;
    } else {
      formToggleBtn.className = 'hidden';
    }
  }

  refresh({
    selectedList,
    ecoStates,
    companyFormations,
    targetingMode,
    targetingSpellSlotIdx = -1,
    isMovingNow,
    wantsToRunNow,
    isActuallyRunningNow
  }) {
    if (!this.rootEl || !this._els) return;

    const baseOrbClasses =
      'fixed -bottom-4 -right-4 z-20 w-[258px] h-[238px] rounded-[50%] select-none origin-bottom-right overflow-visible';

    if (!selectedList || selectedList.length === 0) {
      if (this._lastRenderSignature !== '__hidden__') {
        this._lastRenderSignature = '__hidden__';
        clearTimeout(this._spellHoverTimer);
        this._els?.spellHoverBubble?.classList.add('hidden');
        const hiddenCls = `${baseOrbClasses} transition-all duration-200 ease-in translate-x-full translate-y-full scale-75 opacity-0 pointer-events-none`;
        if (this.rootEl.className !== hiddenCls) this.rootEl.className = hiddenCls;
      }
      return;
    }

    // When selecting an army that includes Heroes, pick one of the Heroes and display his personal Hero Orb on the right side!
    // Only fall back to the multi-squad common denominator (עמק השווה) when no Hero is in the selection.
    const heroInSelection = selectedList.find((c) =>
      Boolean(ecoStates?.[c.companyId]?.isHero || c.unitType === 'hero')
    );
    const primary = heroInSelection || selectedList[0];
    const primarySimState = ecoStates?.[primary.companyId];
    const isHeroSelected = Boolean(heroInSelection);
    this._currentHeroCompanyId = isHeroSelected ? primary.companyId : null;

    // Average stamina across selected units
    let sumStam = 0;
    for (let i = 0; i < selectedList.length; i++) {
      sumStam += ecoStates?.[selectedList[i].companyId]?.staminaPermille ?? 1000;
    }
    const staminaPermille = Math.round(sumStam / Math.max(1, selectedList.length));
    const stamPct = Math.max(5, Math.min(100, Math.round((staminaPermille / 1000) * 100)));

    let totalAmmo = 0;
    let totalMaxAmmo = 0;
    let allHaveAmmo = selectedList.length > 0;
    for (let i = 0; i < selectedList.length; i++) {
      const st = ecoStates?.[selectedList[i].companyId];
      if (st && (st.maxAmmo | 0) > 0) {
        totalAmmo += st.ammo | 0;
        totalMaxAmmo += st.maxAmmo | 0;
      } else {
        allHaveAmmo = false;
      }
    }

    const allArchers =
      selectedList.length > 0 &&
      selectedList.every((c) => {
        const st = ecoStates?.[c.companyId];
        if (st?.isHero || c.unitType === 'hero') return false;
        if (st?.canFireAtWill !== undefined) return Boolean(st.canFireAtWill);
        return Boolean(resolveUnitActiveCapabilities(c.unitType, st?.activeLoadoutIdx || 0).canFireAtWill);
      });
    const allHaveSecondaryLoadout =
      !isHeroSelected &&
      selectedList.length > 0 &&
      selectedList.every((c) => {
        const st = ecoStates?.[c.companyId];
        if (st?.hasSecondaryLoadout !== undefined) return Boolean(st.hasSecondaryLoadout);
        return Boolean(resolveUnitActiveCapabilities(c.unitType, 0).hasSecondaryLoadout);
      });
    const fireAtWillSig =
      allArchers &&
      selectedList.some((c) => (ecoStates?.[c.companyId]?.fireAtWill ?? true) !== false)
        ? 1
        : 0;

    // Check if ANY selected unit has Run locked due to its stance (Spear Wall / Shield Wall / Pike Phalanx / Broken) or 0 stamina
    const anyRunLockedStance =
      selectedList.length > 0 &&
      selectedList.some((c) => {
        const f =
          ecoStates?.[c.companyId]?.formation ||
          companyFormations.get(c.companyId) ||
          c.formation;
        return (
          f === FormationTypes.SPEAR_WALL ||
          f === FormationTypes.SHIELD_WALL ||
          f === FormationTypes.PIKE_PHALANX ||
          Boolean(ecoStates?.[c.companyId]?.isBroken)
        );
      });
    const anyExhausted =
      selectedList.length > 0 &&
      selectedList.some((c) => (ecoStates?.[c.companyId]?.staminaPermille ?? 1000) <= 0);

    const formSig = selectedList
      .map(
        (c) =>
          `${c.unitType}:${ecoStates?.[c.companyId]?.formation || companyFormations.get(c.companyId) || c.formation || ''}`
      )
      .join(',');

    const heroSig = isHeroSelected
      ? `H:${primarySimState?.name || ''}:${primarySimState?.heroLevel || 1}:${primarySimState?.heroXp || 0}:${primarySimState?.heroHp || 0}/${primarySimState?.heroMaxHp || 0}:${primarySimState?.activeLoadoutIdx || 0}:${primarySimState?.activeWeaponMode || 'melee'}:${targetingSpellSlotIdx}:${(primarySimState?.heroSpells || [])
          .map((s) => `${s.spellId}:${s.icon}:${s.level}:${s.disabledByWeapon ? 1 : 0}:${Math.ceil((s.cooldownTicks || 0) / 10)}`)
          .join(',')}`
      : 'U';

    const activeLdSig = selectedList.map((c) => ecoStates?.[c.companyId]?.activeLoadoutIdx || 0).join(',');
    const sig = `${selectedList.length}:${primary.companyId}:${heroSig}:${activeLdSig}:${allHaveSecondaryLoadout ? 1 : 0}:${primarySimState?.isBroken ? 1 : 0}:${stamPct}:${totalAmmo}/${totalMaxAmmo}:${allHaveAmmo ? 1 : 0}:${formSig}:${allArchers ? 1 : 0}:${fireAtWillSig}:${anyRunLockedStance ? 1 : 0}:${anyExhausted ? 1 : 0}:${targetingMode}:${isMovingNow ? 1 : 0}:${wantsToRunNow ? 1 : 0}:${isActuallyRunningNow ? 1 : 0}`;
    if (sig === this._lastRenderSignature) return;
    this._lastRenderSignature = sig;

    const visibleCls = `${baseOrbClasses} transition-all duration-300 ease-out translate-x-0 translate-y-0 scale-100 opacity-100 pointer-events-auto`;
    if (this.rootEl.className !== visibleCls) this.rootEl.className = visibleCls;

    this._renderHeroPerimeterSpells(
      isHeroSelected ? primarySimState || { isHero: true, name: primary.name } : null,
      primary.name,
      targetingSpellSlotIdx
    );

    const {
      title: titleEl,
      staminaBar: staminaBarEl,
      ammoWrap: ammoWrapEl,
      ammoBar: ammoBarEl,
      fireBtn: fireModeBtn,
      fireIcon: fireModeIcon,
      fireSlash: fireModeSlash,
      gaitBtn,
      gaitIcon,
      gaitTrail,
      atkBtn,
      patBtn
    } = this._els;

    if (titleEl && !isHeroSelected) {
      let baseName =
        selectedList.length === 1
          ? primarySimState?.name || primary.name
          : `${selectedList.length} Units Selected`;
      if (selectedList.length === 1 && primarySimState?.isBroken) {
        baseName =
          primarySimState.breakBehavior === 'RAMPAGE'
            ? `🔥 RAMPAGING! (${baseName})`
            : `🏳️ ROUTING! (${baseName})`;
      }
      if (titleEl.textContent !== baseName) {
        titleEl.textContent = baseName;
      }
    }

    if (staminaBarEl) {
      staminaBarEl.style.width = `${stamPct}%`;
      staminaBarEl.className =
        staminaPermille < 300
          ? 'h-full bg-rose-500 transition-all'
          : staminaPermille < 700
            ? 'h-full bg-amber-500 transition-all'
            : 'h-full bg-amber-400 transition-all';
    }

    if (ammoWrapEl && ammoBarEl) {
      if (allHaveAmmo && totalMaxAmmo > 0 && !isHeroSelected) {
        ammoWrapEl.classList.remove('hidden');
        const ammoPct = Math.max(0, Math.min(100, Math.round((totalAmmo / totalMaxAmmo) * 100)));
        ammoBarEl.style.width = `${ammoPct}%`;
        ammoBarEl.className =
          ammoPct <= 15
            ? 'h-full bg-rose-500 transition-all'
            : ammoPct <= 45
              ? 'h-full bg-amber-300 transition-all'
              : 'h-full bg-sky-400 transition-all';
        ammoWrapEl.title = `Arrows / Ammo: ${totalAmmo} / ${totalMaxAmmo}`;
      } else {
        ammoWrapEl.classList.add('hidden');
      }
    }

    this.refreshFormationButtonOnly(selectedList, companyFormations, ecoStates);

    const weaponSwitchBtn = this._els?.heroWeaponSwitchBtn;
    if (!isHeroSelected && weaponSwitchBtn) {
      if (allHaveSecondaryLoadout) {
        const st0 = ecoStates?.[primary.companyId];
        const ldIdx = st0?.activeLoadoutIdx || 0;
        const isRangedNow =
          st0?.activeWeaponMode === 'ranged' ||
          resolveUnitActiveCapabilities(primary.unitType, ldIdx).isRangedLoadout;
        this._currentHeroCompanyId = primary.companyId;
        weaponSwitchBtn.classList.remove('hidden');
        weaponSwitchBtn.innerHTML = isRangedNow ? OPTION_SVG_ICONS.archer : OPTION_SVG_ICONS.swordsman;
        weaponSwitchBtn.title = `Weapon Set ${ldIdx + 1} Active (Click to Switch to Set ${ldIdx === 0 ? 2 : 1})`;
      } else {
        weaponSwitchBtn.classList.add('hidden');
      }
    }

    if (fireModeBtn) {
      if (allArchers) {
        const isFireAtWill = fireAtWillSig === 1;
        fireModeBtn.title = isFireAtWill
          ? 'Fire at Will: ON (Click to hold fire until ordered)'
          : 'Fire by Order Only: ON (Click for Fire at Will)';
        fireModeBtn.className = isFireAtWill
          ? `w-9 h-9 ${ORB_MEDALLION_ACTIVE_GOLD}`
          : `w-9 h-9 ${ORB_MEDALLION_ACTIVE_CRIMSON}`;
        if (fireModeIcon) {
          fireModeIcon.className.baseVal = isFireAtWill
            ? 'pointer-events-none w-4 h-4 text-amber-200 transition'
            : 'pointer-events-none w-4 h-4 text-rose-300 opacity-85 transition';
        }
        if (fireModeSlash) {
          if (isFireAtWill) fireModeSlash.classList.add('hidden');
          else fireModeSlash.classList.remove('hidden');
        }
      } else {
        fireModeBtn.className = 'hidden';
      }
    }

    if (gaitBtn) {
      // Walk / Run is shared by all unit types (including Cavalry and Heroes!).
      // If ANY squad in the selection is in a run-locked stance (Spear Wall / Shield Wall / Pike Phalanx) or out of stamina,
      // the Run button is locked and unclickable for the entire group.
      if (anyRunLockedStance || anyExhausted) {
        gaitBtn.disabled = true;
        gaitBtn.title = anyRunLockedStance
          ? 'Run Locked by Formation Stance (Cannot Run)'
          : 'Exhausted (No Stamina to Run)';
        gaitBtn.className = `w-9 h-9 ${ORB_MEDALLION_DISABLED}`;
        if (gaitIcon) gaitIcon.className.baseVal = 'pointer-events-none w-4 h-4 text-stone-500 transition';
        gaitTrail?.classList.add('hidden');
      } else {
        gaitBtn.disabled = false;
        if (wantsToRunNow || isActuallyRunningNow) {
          gaitBtn.title = 'Running (Click to Walk)';
          gaitBtn.className = `w-9 h-9 ${ORB_MEDALLION_ACTIVE_GOLD}`;
          if (gaitIcon) gaitIcon.className.baseVal = 'pointer-events-none w-4 h-4 text-amber-200 transition';
          gaitTrail?.classList.remove('hidden');
        } else {
          gaitBtn.title = 'Walking (Click to Run)';
          gaitBtn.className = `w-9 h-9 ${ORB_MEDALLION_IDLE}`;
          if (gaitIcon) gaitIcon.className.baseVal = 'pointer-events-none w-4 h-4 text-amber-200/85 transition';
          gaitTrail?.classList.add('hidden');
        }
      }
    }

    if (atkBtn) {
      atkBtn.className =
        targetingMode === 'ATTACK_MOVE'
          ? `w-11 h-11 ${ORB_MEDALLION_ACTIVE_CRIMSON}`
          : `w-11 h-11 ${ORB_MEDALLION_IDLE}`;
    }

    if (patBtn) {
      patBtn.className =
        targetingMode === 'PATROL'
          ? `w-11 h-11 ${ORB_MEDALLION_ACTIVE_GOLD}`
          : `w-11 h-11 ${ORB_MEDALLION_IDLE}`;
    }
  }
}
