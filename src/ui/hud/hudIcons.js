/**
 * Kings Lands — Shared HUD SVG Icon Registry
 * (src/ui/hud/hudIcons.js)
 *
 * Centralizes all SVG icons for buildings, unit production options,
 * tactical formations, and radial actions.
 */

export const FORMATION_SVG_ICONS = Object.freeze({
  square: `
    <svg class="pointer-events-none w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <rect x="5" y="5" width="14" height="14" rx="2"/>
    </svg>
  `,
  wedge: `
    <svg class="pointer-events-none w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="12,3 21,19 3,19"/>
    </svg>
  `,
  spearWall: `
    <svg class="pointer-events-none w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M6 20V5m0 0L4 8m2-3l2 3M12 20V3m0 0l-2 3m2-3l2 3M18 20V5m0 0l-2 3m2-3l2 3"/>
    </svg>
  `
});

export const BUILDING_SVG_ICONS = Object.freeze({
  citadel: `
    <svg class="pointer-events-none w-5 h-5 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round">
      <path d="M3 20h18v-9l-4 3-5-6-5 6-4-3v9z"/>
      <rect x="10" y="15" width="4" height="5"/>
    </svg>
  `,
  gathering_camp: `
    <svg class="pointer-events-none w-5 h-5 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="7" cy="17" r="3"/>
      <circle cx="15" cy="17" r="3"/>
      <circle cx="11" cy="12" r="3"/>
      <path d="M4 7l6-4 4 4"/>
    </svg>
  `,
  house: `
    <svg class="pointer-events-none w-5 h-5 text-amber-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round">
      <polygon points="12,3 3,11 21,11"/>
      <rect x="5" y="11" width="14" height="9"/>
      <rect x="10" y="15" width="4" height="5"/>
    </svg>
  `,
  barracks: `
    <svg class="pointer-events-none w-5 h-5 text-sky-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <line x1="4" y1="20" x2="20" y2="4"/>
      <line x1="20" y1="20" x2="4" y2="4"/>
      <line x1="5" y1="15" x2="9" y2="19"/>
      <line x1="15" y1="19" x2="19" y2="15"/>
    </svg>
  `,
  archery_range: `
    <svg class="pointer-events-none w-5 h-5 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round">
      <circle cx="12" cy="12" r="8"/>
      <circle cx="12" cy="12" r="4"/>
      <circle cx="12" cy="12" r="1" fill="currentColor"/>
    </svg>
  `,
  stables: `
    <svg class="pointer-events-none w-5 h-5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <path d="M7 20V10a5 5 0 0 1 10 0v10"/>
      <line x1="5" y1="20" x2="9" y2="20"/>
      <line x1="15" y1="20" x2="19" y2="20"/>
    </svg>
  `,
  siege_works: `
    <svg class="pointer-events-none w-5 h-5 text-orange-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="3" x2="12" y2="6"/>
      <line x1="12" y1="18" x2="12" y2="21"/>
      <line x1="3" y1="12" x2="6" y2="12"/>
      <line x1="18" y1="12" x2="21" y2="12"/>
    </svg>
  `,
  blacksmith: `
    <svg class="pointer-events-none w-5 h-5 text-slate-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round">
      <path d="M4 14h16l-2 6H6l-2-6z"/>
      <path d="M7 14V9h10v5"/>
      <line x1="12" y1="4" x2="12" y2="9"/>
    </svg>
  `,
  watchtower: `
    <svg class="pointer-events-none w-5 h-5 text-teal-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round">
      <polygon points="12,2 7,7 17,7"/>
      <rect x="8" y="7" width="8" height="14"/>
      <line x1="6" y1="21" x2="18" y2="21"/>
    </svg>
  `,
  ballista_tower: `
    <svg class="pointer-events-none w-5 h-5 text-rose-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round">
      <path d="M4 9c5-4 11-4 16 0"/>
      <line x1="12" y1="3" x2="12" y2="14"/>
      <rect x="8" y="14" width="8" height="7"/>
    </svg>
  `,
  infirmary: `
    <svg class="pointer-events-none w-5 h-5 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round">
      <polygon points="12,3 5,9 19,9"/>
      <line x1="7" y1="9" x2="7" y2="15"/>
      <line x1="17" y1="9" x2="17" y2="15"/>
      <ellipse cx="12" cy="17" rx="6" ry="3"/>
    </svg>
  `,
  banner_house: `
    <svg class="pointer-events-none w-5 h-5 text-cyan-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round">
      <circle cx="12" cy="6" r="3.2" fill="currentColor"/>
      <path d="M9 11h6l1 9H8l1-9z"/>
      <line x1="6" y1="20" x2="18" y2="20"/>
    </svg>
  `
});

export const OPTION_SVG_ICONS = Object.freeze({
  worker: `
    <svg class="pointer-events-none w-5 h-5 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 4l6 6-3 3-6-6 3-3z"/>
      <path d="M4 20l8.5-8.5"/>
    </svg>
  `,
  gatherer: `
    <svg class="pointer-events-none w-5 h-5 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 3l7 7-4 4-7-7 4-4z"/>
      <path d="M3 21l9-9"/>
    </svg>
  `,
  swordsman: `
    <svg class="pointer-events-none w-5 h-5 text-sky-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 3l2 2-11 11-3-3L19 3z"/>
      <path d="M5 13l6 6"/>
      <path d="M3 21l4-4"/>
    </svg>
  `,
  spearman: `
    <svg class="pointer-events-none w-5 h-5 text-teal-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 20L20 4"/>
      <polygon points="20,4 15,5 19,9" fill="currentColor"/>
      <circle cx="9" cy="14" r="4"/>
    </svg>
  `,
  archer: `
    <svg class="pointer-events-none w-5 h-5 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 4c8 4 8 12 0 16"/>
      <line x1="5" y1="4" x2="5" y2="20"/>
      <line x1="3" y1="12" x2="20" y2="12"/>
    </svg>
  `,
  crossbowman: `
    <svg class="pointer-events-none w-5 h-5 text-cyan-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 9c5-4 11-4 16 0"/>
      <line x1="12" y1="4" x2="12" y2="20"/>
    </svg>
  `,
  light_cavalry: `
    <svg class="pointer-events-none w-5 h-5 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 20V10a5 5 0 0 1 10 0v10"/>
      <line x1="5" y1="20" x2="9" y2="20"/>
      <line x1="15" y1="20" x2="19" y2="20"/>
    </svg>
  `,
  heavy_cavalry: `
    <svg class="pointer-events-none w-5 h-5 text-amber-400" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="12,2 20,19 12,15 4,19"/>
    </svg>
  `,
  ballista: `
    <svg class="pointer-events-none w-5 h-5 text-orange-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <path d="M3 10c6-5 12-5 18 0"/>
      <line x1="12" y1="3" x2="12" y2="21"/>
    </svg>
  `,
  battering_ram: `
    <svg class="pointer-events-none w-5 h-5 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
      <rect x="3" y="9" width="16" height="5" rx="2"/>
      <circle cx="7" cy="17" r="2.2"/>
      <circle cx="15" cy="17" r="2.2"/>
    </svg>
  `,
  catapult: `
    <svg class="pointer-events-none w-5 h-5 text-rose-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <line x1="4" y1="18" x2="20" y2="18"/>
      <line x1="14" y1="18" x2="6" y2="6"/>
      <circle cx="5" cy="5" r="2.5" fill="currentColor"/>
    </svg>
  `,
  watchtower: `
    <svg class="pointer-events-none w-5 h-5 text-teal-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round">
      <polygon points="12,2 7,7 17,7"/>
      <rect x="8" y="7" width="8" height="14"/>
    </svg>
  `,
  ballista_tower: `
    <svg class="pointer-events-none w-5 h-5 text-rose-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round">
      <path d="M4 9c5-4 11-4 16 0"/>
      <line x1="12" y1="3" x2="12" y2="14"/>
      <rect x="8" y="14" width="8" height="7"/>
    </svg>
  `,
  research: `
    <svg class="pointer-events-none w-5 h-5 text-sky-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 15h16l-2 5H6l-2-5z"/>
      <path d="M7 15V9h10v6"/>
      <line x1="12" y1="4" x2="12" y2="9"/>
    </svg>
  `,
  upgrade: `
    <svg class="pointer-events-none w-5 h-5 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6,13 12,7 18,13"/>
      <polyline points="6,19 12,13 18,19"/>
    </svg>
  `,
  demolish: `
    <svg class="pointer-events-none w-5 h-5 text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <line x1="10" y1="11" x2="10" y2="17"/>
      <line x1="14" y1="11" x2="14" y2="17"/>
    </svg>
  `,
  ungarrison: `
    <svg class="pointer-events-none w-5 h-5 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  `,
  empty_slot: `
    <svg class="pointer-events-none w-5 h-5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3">
      <circle cx="12" cy="12" r="8"/>
    </svg>
  `,
  heroes_menu: `
    <svg class="pointer-events-none w-5 h-5 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 18h18l-2-10-5 4-4-6-4 6-5-4-2 10z" fill="rgba(251,191,36,0.22)"/>
      <line x1="3" y1="21" x2="21" y2="21"/>
    </svg>
  `,
  wizard: `
    <svg class="pointer-events-none w-5 h-5 text-sky-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2l4 9h5l-18 0 5-9z" fill="rgba(56,189,248,0.25)"/>
      <circle cx="18" cy="6" r="2.2" fill="#38bdf8"/>
      <line x1="18" y1="8.2" x2="14" y2="22"/>
    </svg>
  `,
  back_arrow: `
    <svg class="pointer-events-none w-5 h-5 text-slate-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <line x1="19" y1="12" x2="5" y2="12"/>
      <polyline points="12 19 5 12 12 5"/>
    </svg>
  `
});

export const HERO_SPELL_SVG_ICONS = Object.freeze({
  crimson_axe: `
    <svg class="pointer-events-none w-5 h-5 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="2" x2="12" y2="22" stroke="#fca5a5" stroke-width="2.4"/>
      <path d="M12 5C8 4 4.5 6 3.5 9.5c2.2 1.2 4.8 1.5 8.5.8" fill="rgba(239,68,68,0.52)" stroke="#ef4444"/>
      <path d="M12 10.3C8.3 9.6 5.7 9.9 3.5 11.1 4.5 14.6 8 16.6 12 15.6" fill="rgba(220,38,38,0.52)" stroke="#ef4444"/>
      <path d="M12 5c4-1 7.5 1 8.5 4.5-2.2 1.2-4.8 1.5-8.5.8" fill="rgba(239,68,68,0.52)" stroke="#ef4444"/>
      <path d="M12 10.3c3.7-.7 6.3-.4 8.5.8-1 3.5-4.5 5.5-8.5 4.5" fill="rgba(220,38,38,0.52)" stroke="#ef4444"/>
      <circle cx="12" cy="10.3" r="1.6" fill="#fef08a" stroke="#dc2626" stroke-width="1.2"/>
    </svg>
  `,
  bloodlust_frenzy: `
    <svg class="pointer-events-none w-5 h-5 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="2" x2="12" y2="22" stroke="#fca5a5" stroke-width="2.4"/>
      <path d="M12 5C8 4 4.5 6 3.5 9.5c2.2 1.2 4.8 1.5 8.5.8" fill="rgba(239,68,68,0.52)" stroke="#ef4444"/>
      <path d="M12 10.3C8.3 9.6 5.7 9.9 3.5 11.1 4.5 14.6 8 16.6 12 15.6" fill="rgba(220,38,38,0.52)" stroke="#ef4444"/>
      <path d="M12 5c4-1 7.5 1 8.5 4.5-2.2 1.2-4.8 1.5-8.5.8" fill="rgba(239,68,68,0.52)" stroke="#ef4444"/>
      <path d="M12 10.3c3.7-.7 6.3-.4 8.5.8-1 3.5-4.5 5.5-8.5 4.5" fill="rgba(220,38,38,0.52)" stroke="#ef4444"/>
      <circle cx="12" cy="10.3" r="1.6" fill="#fef08a" stroke="#dc2626" stroke-width="1.2"/>
    </svg>
  `,
  chameleon_roar_head: `
    <svg class="pointer-events-none w-5 h-5 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 17v-5c0-3.5 2.5-6.8 6.5-7.8l1.2 2.6 3.8.6-4.5 3.6 3.8 2.2-5.2 1.8L3 17z" fill="rgba(16,185,129,0.38)" stroke="#34d399"/>
      <circle cx="8.2" cy="9.2" r="1.2" fill="#fef08a" stroke="none"/>
      <path d="M16.2 6.8a5 5 0 0 1 1.6 6.4" stroke="#38bdf8" stroke-width="2.1"/>
      <path d="M18.8 4.6a8.5 8.5 0 0 1 2.4 10.2" stroke="#7dd3fc" stroke-width="2.0"/>
    </svg>
  `,
  chameleon_roar: `
    <svg class="pointer-events-none w-5 h-5 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 17v-5c0-3.5 2.5-6.8 6.5-7.8l1.2 2.6 3.8.6-4.5 3.6 3.8 2.2-5.2 1.8L3 17z" fill="rgba(16,185,129,0.38)" stroke="#34d399"/>
      <circle cx="8.2" cy="9.2" r="1.2" fill="#fef08a" stroke="none"/>
      <path d="M16.2 6.8a5 5 0 0 1 1.6 6.4" stroke="#38bdf8" stroke-width="2.1"/>
      <path d="M18.8 4.6a8.5 8.5 0 0 1 2.4 10.2" stroke="#7dd3fc" stroke-width="2.0"/>
    </svg>
  `,
  horseshoe: `
    <svg class="pointer-events-none w-5 h-5 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 4c-2.5 2.5-3.5 6-3.5 9.5C3.5 18.2 7.3 21 12 21s8.5-2.8 8.5-7.5C20.5 10 19.5 6.5 17 4" fill="rgba(245,158,11,0.22)"/>
      <path d="M9.5 6c-1.5 2-2.2 4.5-2.2 7.2 0 2.6 2.1 4.6 4.7 4.6s4.7-2 4.7-4.6c0-2.7-.7-5.2-2.2-7.2"/>
      <line x1="5.5" y1="4" x2="9.5" y2="4" stroke-width="2.6"/>
      <line x1="14.5" y1="4" x2="18.5" y2="4" stroke-width="2.6"/>
    </svg>
  `,
  summon_warhorse: `
    <svg class="pointer-events-none w-5 h-5 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 4c-2.5 2.5-3.5 6-3.5 9.5C3.5 18.2 7.3 21 12 21s8.5-2.8 8.5-7.5C20.5 10 19.5 6.5 17 4" fill="rgba(245,158,11,0.22)"/>
      <path d="M9.5 6c-1.5 2-2.2 4.5-2.2 7.2 0 2.6 2.1 4.6 4.7 4.6s4.7-2 4.7-4.6c0-2.7-.7-5.2-2.2-7.2"/>
      <line x1="5.5" y1="4" x2="9.5" y2="4" stroke-width="2.6"/>
      <line x1="14.5" y1="4" x2="18.5" y2="4" stroke-width="2.6"/>
    </svg>
  `,
  self_heal: `
    <svg class="pointer-events-none w-5 h-5 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 11c0 5.5-7 10-7 10z" fill="rgba(16,185,129,0.28)"/>
      <path d="M12 8v6M9 11h6"/>
    </svg>
  `,
  iron_blood: `
    <svg class="pointer-events-none w-5 h-5 text-slate-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2l8 4v6c0 5.5-3.5 9.5-8 11-4.5-1.5-8-5.5-8-11V6l8-4z" fill="rgba(148,163,184,0.3)"/>
      <path d="M12 6v12"/>
      <path d="M8 10h8"/>
    </svg>
  `,
  iron_skin: `
    <svg class="pointer-events-none w-5 h-5 text-slate-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2l8 4v6c0 5.5-3.5 9.5-8 11-4.5-1.5-8-5.5-8-11V6l8-4z" fill="rgba(148,163,184,0.3)"/>
      <path d="M12 6v12"/>
      <path d="M8 10h8"/>
    </svg>
  `,
  wind_stride: `
    <svg class="pointer-events-none w-5 h-5 text-sky-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 8h11a3 3 0 1 0-3-3"/>
      <path d="M2 12h15a3 3 0 1 1-3 3"/>
      <path d="M4 16h9"/>
    </svg>
  `,
  immortal_avatar: `
    <svg class="pointer-events-none w-5 h-5 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 18h18l-2-10-5 4-4-6-4 6-5-4-2 10z" fill="rgba(251,191,36,0.32)"/>
      <circle cx="12" cy="4" r="1.5" fill="currentColor"/>
    </svg>
  `,
  venom_strike: `
    <svg class="pointer-events-none w-5 h-5 text-lime-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 3l2 2-11 11-3-3L19 3z" fill="rgba(132,204,22,0.28)"/>
      <path d="M12 18c0 1.7-1.3 3-3 3s-3-1.3-3-3c0-2 3-5 3-5s3 3 3 5z" fill="rgba(34,197,94,0.35)"/>
    </svg>
  `,
  poison_arrow: `
    <svg class="pointer-events-none w-5 h-5 text-lime-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="4" y1="20" x2="20" y2="4"/>
      <polyline points="13,4 20,4 20,11"/>
      <circle cx="17" cy="17" r="3" fill="rgba(132,204,22,0.38)"/>
    </svg>
  `,
  mighty_strike: `
    <svg class="pointer-events-none w-5 h-5 text-rose-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 19c5-9 11-12 16-14-2 5-5 11-14 16" fill="rgba(244,63,94,0.28)"/>
      <path d="M3 21l5-5"/>
    </svg>
  `,
  piercing_shot: `
    <svg class="pointer-events-none w-5 h-5 text-rose-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 4c8 4 8 12 0 16"/>
      <line x1="3" y1="12" x2="21" y2="12"/>
      <polyline points="16,7 21,12 16,17"/>
    </svg>
  `,
  throwing_knife: `
    <svg class="pointer-events-none w-5 h-5 text-slate-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="20,4 14,14 10,10 20,4" fill="rgba(226,232,240,0.35)"/>
      <line x1="10" y1="14" x2="4" y2="20"/>
    </svg>
  `,
  shockwave_slam: `
    <svg class="pointer-events-none w-5 h-5 text-orange-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="14" r="4" fill="rgba(249,115,22,0.35)"/>
      <path d="M4 14a8 5 0 0 0 16 0"/>
      <line x1="12" y1="3" x2="12" y2="10"/>
    </svg>
  `,
  cleave_strike: `
    <svg class="pointer-events-none w-5 h-5 text-orange-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 19c5-9 11-12 16-14-2 5-5 11-14 16" fill="rgba(249,115,22,0.28)"/>
      <path d="M3 21l5-5"/>
    </svg>
  `,
  whirlwind_rampage: `
    <svg class="pointer-events-none w-5 h-5 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12a9 9 0 1 1-6.2-8.5"/>
      <path d="M17 12a5 5 0 1 1-3.5-4.7"/>
      <circle cx="12" cy="12" r="2" fill="currentColor"/>
    </svg>
  `,
  arrow_volley: `
    <svg class="pointer-events-none w-5 h-5 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      <line x1="6" y1="3" x2="6" y2="16"/><polyline points="3,13 6,16 9,13"/>
      <line x1="12" y1="5" x2="12" y2="19"/><polyline points="9,16 12,19 15,16"/>
      <line x1="18" y1="3" x2="18" y2="16"/><polyline points="15,13 18,16 21,13"/>
    </svg>
  `,
  war_cry: `
    <svg class="pointer-events-none w-5 h-5 text-rose-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      <path d="M11 5L6 9H2v6h4l5 4V5z" fill="rgba(244,63,94,0.25)"/>
      <path d="M15.5 8.5a5 5 0 0 1 0 7"/>
      <path d="M18.5 5.5a9 9 0 0 1 0 13"/>
    </svg>
  `,
  heal: `
    <svg class="pointer-events-none w-5 h-5 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="3" width="6" height="18" rx="1.5" fill="rgba(16,185,129,0.28)"/>
      <rect x="3" y="9" width="18" height="6" rx="1.5" fill="rgba(16,185,129,0.28)"/>
    </svg>
  `,
  aura_of_valor: `
    <svg class="pointer-events-none w-5 h-5 text-teal-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="4" fill="rgba(45,212,191,0.35)"/>
      <circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/>
      <line x1="12" y1="1" x2="12" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="1" y1="12" x2="3" y2="12"/>
      <line x1="21" y1="12" x2="23" y2="12"/>
    </svg>
  `,
  aegis_banner: `
    <svg class="pointer-events-none w-5 h-5 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2l7 3.5v6c0 5-3 8.8-7 10.5-4-1.7-7-5.5-7-10.5v-6L12 2z" fill="rgba(251,191,36,0.28)"/>
      <circle cx="12" cy="11" r="2.5"/>
    </svg>
  `,
  royal_sanctuary: `
    <svg class="pointer-events-none w-5 h-5 text-amber-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2v20"/>
      <path d="M7 7h10"/>
      <path d="M5 19c3-3 11-3 14 0"/>
      <circle cx="12" cy="7" r="3" fill="rgba(253,230,138,0.3)"/>
    </svg>
  `,
  far_sight: `
    <svg class="pointer-events-none w-5 h-5 text-sky-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" fill="rgba(56,189,248,0.22)"/>
      <circle cx="12" cy="12" r="3" fill="#38bdf8"/>
    </svg>
  `,
  fireball: `
    <svg class="pointer-events-none w-5 h-5 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="10" cy="14" r="6" fill="rgba(245,158,11,0.38)"/>
      <path d="M14 9l7-6-3 8 4-1-6 6"/>
    </svg>
  `,
  mana_flow: `
    <svg class="pointer-events-none w-5 h-5 text-indigo-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3c-4 5-6 8.5-6 12a6 6 0 0 0 12 0c0-3.5-2-7-6-12z" fill="rgba(129,140,248,0.3)"/>
      <path d="M9 15a3 3 0 0 0 6 0"/>
    </svg>
  `,
  chain_lightning: `
    <svg class="pointer-events-none w-5 h-5 text-cyan-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="13,2 4,14 11,14 9,22 20,10 13,10" fill="rgba(34,211,238,0.3)"/>
    </svg>
  `,
  meteor_storm: `
    <svg class="pointer-events-none w-5 h-5 text-orange-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="8" cy="16" r="5" fill="rgba(239,68,68,0.4)"/>
      <line x1="12" y1="12" x2="21" y2="3"/>
      <line x1="15" y1="6" x2="19" y2="2"/>
      <line x1="17" y1="11" x2="22" y2="6"/>
    </svg>
  `,
  vampiric_cleave: `
    <svg class="pointer-events-none w-5 h-5 text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 3l2 2-11 11-3-3L19 3z" fill="rgba(225,29,72,0.35)"/>
      <path d="M14 16c0 2-2 4-2 4s-2-2-2-4a2 2 0 0 1 4 0z" fill="#f43f5e"/>
    </svg>
  `,
  inspiring_onslaught: `
    <svg class="pointer-events-none w-5 h-5 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="12,2 19,14 13,14 13,22 5,10 11,10" fill="rgba(245,158,11,0.32)"/>
    </svg>
  `,
  explosive_mark: `
    <svg class="pointer-events-none w-5 h-5 text-purple-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="6" fill="rgba(168,85,247,0.3)"/>
      <line x1="12" y1="2" x2="12" y2="6"/>
      <line x1="12" y1="18" x2="12" y2="22"/>
      <line x1="2" y1="12" x2="6" y2="12"/>
      <line x1="18" y1="12" x2="22" y2="12"/>
    </svg>
  `
});

export function buildOrbDecorationsSvg(archPath = 'M 38 72 Q 129 60 220 72') {
  return `
    <svg class="pointer-events-none absolute inset-0 w-full h-full opacity-45" viewBox="0 0 258 238" fill="none">
      <ellipse cx="129" cy="119" rx="121" ry="109" stroke="#fbbf24" stroke-opacity="0.45" stroke-width="1.5" stroke-dasharray="6 4"/>
      <ellipse cx="129" cy="119" rx="111" ry="99" stroke="#2dd4bf" stroke-opacity="0.35" stroke-width="1"/>
      <path d="${archPath}" stroke="#fbbf24" stroke-opacity="0.35" stroke-width="1.2"/>
    </svg>
  `;
}

// ============================================================================

export {
  RtsCursorTypes,
  CURSOR_RAW_SVGS,
  RtsCursorManager
} from './cursorSystem.js';
