/**
 * Kings Lands — 3D-Painted Custom RTS Mouse Cursor System
 * (src/ui/hud/cursorSystem.js)
 */

function buildSvgCursorUrl(svgBody, hotspotX = 4, hotspotY = 4) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${svgBody}</svg>`;
  const encoded = encodeURIComponent(svg)
    .replace(/\x27/g, "%27")
    .replace(/"/g, "%22");
  return `url("data:image/svg+xml;utf8,${encoded}") ${hotspotX} ${hotspotY}, auto`;
}

export const RtsCursorTypes = Object.freeze({
  DEFAULT: "default",
  DEFAULT_PRESSED: "default_pressed",
  HAND_POINTER: "hand_pointer",
  HAND_POINTER_PRESSED: "hand_pointer_pressed",
  SELECT_FRIENDLY: "select_friendly",
  SELECT_FRIENDLY_PRESSED: "select_friendly_pressed",
  ATTACK_ENEMY: "attack_enemy",
  ATTACK_ENEMY_STRIKE: "attack_enemy_strike",
  ATTACK_RANGED: "attack_ranged",
  ATTACK_RANGED_STRIKE: "attack_ranged_strike",
  CHOP_WOOD: "chop_wood",
  CHOP_WOOD_STRIKE: "chop_wood_strike",
  MINE_RESOURCE: "mine_resource",
  MINE_RESOURCE_STRIKE: "mine_resource_strike",
  BUILD_REPAIR: "build_repair",
  BUILD_REPAIR_STRIKE: "build_repair_strike",
  BUILD_INVALID: "build_invalid",
  DROPOFF_RESOURCE: "dropoff_resource",
  DROPOFF_RESOURCE_PRESSED: "dropoff_resource_pressed",
  GARRISON_RESUPPLY: "garrison_resupply",
  GARRISON_RESUPPLY_PRESSED: "garrison_resupply_pressed",
  ATTACK_MOVE: "attack_move",
  ATTACK_MOVE_PRESSED: "attack_move_pressed",
  PATROL: "patrol",
  PATROL_PRESSED: "patrol_pressed",
  FORMATION_DRAG: "formation_drag",
  CAMERA_ORBIT: "camera_orbit",
  SPELL_TARGET_NEUTRAL: "spell_target_neutral",
  SPELL_TARGET_VALID: "spell_target_valid",
  SPELL_TARGET_INVALID: "spell_target_invalid",
  HIDDEN: "hidden"
});

const SHARED_3D_DEFS = `
  <defs>
    <filter id="ds" x="-20%" y="-20%" width="150%" height="150%">
      <feDropShadow dx="1.2" dy="1.8" stdDeviation="1.1" flood-color="#020617" flood-opacity="0.85"/>
    </filter>
    <linearGradient id="steelLight" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="45%" stop-color="#e2e8f0"/>
      <stop offset="100%" stop-color="#94a3b8"/>
    </linearGradient>
    <linearGradient id="steelDark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#94a3b8"/>
      <stop offset="50%" stop-color="#475569"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="ironWork" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#e2e8f0"/>
      <stop offset="40%" stop-color="#94a3b8"/>
      <stop offset="100%" stop-color="#334155"/>
    </linearGradient>
    <linearGradient id="gold3d" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fef08a"/>
      <stop offset="45%" stop-color="#eab308"/>
      <stop offset="100%" stop-color="#854d0e"/>
    </linearGradient>
    <linearGradient id="wood3d" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#f59e0b"/>
      <stop offset="45%" stop-color="#b45309"/>
      <stop offset="100%" stop-color="#451a03"/>
    </linearGradient>
    <linearGradient id="crimsonLight" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffe4e6"/>
      <stop offset="35%" stop-color="#f87171"/>
      <stop offset="100%" stop-color="#dc2626"/>
    </linearGradient>
    <linearGradient id="crimsonDark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ef4444"/>
      <stop offset="55%" stop-color="#991b1b"/>
      <stop offset="100%" stop-color="#450a0a"/>
    </linearGradient>
    <linearGradient id="emeraldLight" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#bbf7d0"/>
      <stop offset="45%" stop-color="#22c55e"/>
      <stop offset="100%" stop-color="#15803d"/>
    </linearGradient>
    <linearGradient id="emeraldDark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#16a34a"/>
      <stop offset="100%" stop-color="#14532d"/>
    </linearGradient>
  </defs>
`;

export const CURSOR_RAW_SVGS = {
  // 1. Default 3D Faceted Steel & Gold Pointer
  [RtsCursorTypes.DEFAULT]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)">
      <path d="M3 2 L24 10.8 L15.2 14.8 L21.2 23.8 L17 26.2 L11 17.2 L6.2 23.2 Z" fill="#090d16" stroke="#090d16" stroke-width="1.8" stroke-linejoin="round"/>
      <polygon points="3.5,2.8 12.2,13.6 6.8,21.5" fill="url(#steelLight)"/>
      <polygon points="3.5,2.8 22.4,10.8 12.2,13.6" fill="url(#steelDark)"/>
      <polygon points="12.2,13.6 14.4,14.4 20.2,23.2 17.2,24.8 11.4,16" fill="url(#gold3d)"/>
      <path d="M3.5 2.8 L22.4 10.8 L14.4 14.4 L20.2 23.2 L17.2 24.8 L11.4 16 L6.8 21.5 Z" fill="none" stroke="url(#gold3d)" stroke-width="1.15" stroke-linejoin="round"/>
      <line x1="3.8" y1="3.2" x2="12.2" y2="13.6" stroke="#ffffff" stroke-width="0.9" opacity="0.85"/>
      <polygon points="12.2,11.2 14.2,13.5 12.2,15.8 10.2,13.5" fill="url(#gold3d)" stroke="#090d16" stroke-width="0.7"/>
      <circle cx="12.2" cy="13.5" r="1.1" fill="#fef08a"/>
    </g>
  `,

  [RtsCursorTypes.DEFAULT_PRESSED]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)" transform="translate(1.2, 1.2) scale(0.92)">
      <path d="M3 2 L24 10.8 L15.2 14.8 L21.2 23.8 L17 26.2 L11 17.2 L6.2 23.2 Z" fill="#090d16" stroke="#090d16" stroke-width="1.8" stroke-linejoin="round"/>
      <polygon points="3.5,2.8 12.2,13.6 6.8,21.5" fill="url(#steelLight)"/>
      <polygon points="3.5,2.8 22.4,10.8 12.2,13.6" fill="url(#steelDark)"/>
      <polygon points="12.2,13.6 14.4,14.4 20.2,23.2 17.2,24.8 11.4,16" fill="url(#gold3d)"/>
      <path d="M3.5 2.8 L22.4 10.8 L14.4 14.4 L20.2 23.2 L17.2 24.8 L11.4 16 L6.8 21.5 Z" fill="none" stroke="#fef08a" stroke-width="1.35" stroke-linejoin="round"/>
      <polygon points="12.2,10.8 14.6,13.5 12.2,16.2 9.8,13.5" fill="#fef08a" stroke="#090d16" stroke-width="0.7"/>
    </g>
  `,

  // 2. Custom Medieval Steel & Gold Gloved Pointing Hand (for Building UI & Production buttons)
  [RtsCursorTypes.HAND_POINTER]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)">
      <path d="M10 3 C11.8 3 13 4.3 13 6 L13 11.5 C14.2 11 15.6 11.4 16.3 12.4 C17.5 12 18.9 12.5 19.5 13.6 C20.7 13.4 22 14.3 22 15.8 L22 21.5 C22 24.5 19.5 27 16 27 L11 27 C8 27 6 24.8 5.2 22 L3.5 16.8 C3 15.2 4.2 13.6 5.8 13.8 C6.8 14 7.6 14.8 8 15.8 L8 6 C8 4.3 8.8 3 10 3 Z" fill="#090d16" stroke="#090d16" stroke-width="1.6" stroke-linejoin="round"/>
      <rect x="8.5" y="3.6" width="4" height="13" rx="1.8" fill="url(#steelLight)" stroke="#475569" stroke-width="0.7"/>
      <line x1="9.6" y1="4.5" x2="9.6" y2="15" stroke="#ffffff" stroke-width="0.9" opacity="0.8"/>
      <rect x="12.6" y="11.6" width="3.4" height="7.5" rx="1.5" fill="url(#steelLight)" stroke="#475569" stroke-width="0.7"/>
      <rect x="16.0" y="12.4" width="3.3" height="7.2" rx="1.5" fill="url(#steelDark)" stroke="#334155" stroke-width="0.7"/>
      <rect x="19.1" y="13.6" width="2.8" height="6.6" rx="1.3" fill="url(#steelDark)" stroke="#1e293b" stroke-width="0.7"/>
      <path d="M4.2 16.2 C3.9 15 4.8 14.2 5.9 14.5 L8.6 16.5 L8.6 21 L5.6 19.2 Z" fill="url(#steelLight)" stroke="#475569" stroke-width="0.7"/>
      <path d="M8.2 16.2 L21.5 16.8 L21.2 22.5 L6.2 22.5 Z" fill="url(#steelDark)" stroke="url(#gold3d)" stroke-width="1"/>
      <polygon points="8.6,16.5 16,16.7 13,22.2 6.8,22.2" fill="url(#steelLight)" opacity="0.65"/>
      <path d="M6.2 22.2 L21.4 22.2 L20.2 26.8 L7.4 26.8 Z" fill="url(#gold3d)" stroke="#451a03" stroke-width="0.9" stroke-linejoin="round"/>
      <circle cx="10.2" cy="24.5" r="1.1" fill="#fef08a"/>
      <circle cx="13.8" cy="24.5" r="1.1" fill="#fef08a"/>
      <circle cx="17.4" cy="24.5" r="1.1" fill="#fef08a"/>
    </g>
  `,

  // 2b. Gloved Hand Pressed (NO semi-circle above the hand!)
  [RtsCursorTypes.HAND_POINTER_PRESSED]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)" transform="translate(1.2, 2.0) scale(0.92)">
      <path d="M10 4.5 C11.8 4.5 13 5.8 13 7.5 L13 11.5 C14.2 11 15.6 11.4 16.3 12.4 C17.5 12 18.9 12.5 19.5 13.6 C20.7 13.4 22 14.3 22 15.8 L22 21.5 C22 24.5 19.5 27 16 27 L11 27 C8 27 6 24.8 5.2 22 L3.5 16.8 C3 15.2 4.2 13.6 5.8 13.8 C6.8 14 7.6 14.8 8 15.8 L8 7.5 C8 5.8 8.8 4.5 10 4.5 Z" fill="#090d16" stroke="#090d16" stroke-width="1.6" stroke-linejoin="round"/>
      <rect x="8.5" y="5.2" width="4" height="11.5" rx="1.8" fill="url(#steelLight)" stroke="#475569" stroke-width="0.7"/>
      <line x1="9.6" y1="6.0" x2="9.6" y2="15" stroke="#ffffff" stroke-width="0.9" opacity="0.85"/>
      <rect x="12.6" y="11.6" width="3.4" height="7.5" rx="1.5" fill="url(#steelLight)" stroke="#475569" stroke-width="0.7"/>
      <rect x="16.0" y="12.4" width="3.3" height="7.2" rx="1.5" fill="url(#steelDark)" stroke="#334155" stroke-width="0.7"/>
      <rect x="19.1" y="13.6" width="2.8" height="6.6" rx="1.3" fill="url(#steelDark)" stroke="#1e293b" stroke-width="0.7"/>
      <path d="M4.2 16.2 C3.9 15 4.8 14.2 5.9 14.5 L8.6 16.5 L8.6 21 L5.6 19.2 Z" fill="url(#steelLight)" stroke="#475569" stroke-width="0.7"/>
      <path d="M8.2 16.2 L21.5 16.8 L21.2 22.5 L6.2 22.5 Z" fill="url(#steelDark)" stroke="#fef08a" stroke-width="1.15"/>
      <polygon points="8.6,16.5 16,16.7 13,22.2 6.8,22.2" fill="url(#steelLight)" opacity="0.65"/>
      <path d="M6.2 22.2 L21.4 22.2 L20.2 26.8 L7.4 26.8 Z" fill="url(#gold3d)" stroke="#451a03" stroke-width="0.9" stroke-linejoin="round"/>
      <circle cx="10.2" cy="24.5" r="1.1" fill="#fef08a"/>
      <circle cx="13.8" cy="24.5" r="1.1" fill="#fef08a"/>
      <circle cx="17.4" cy="24.5" r="1.1" fill="#fef08a"/>
    </g>
  `,

  // 3. Hover Friendly Unit / Building
  [RtsCursorTypes.SELECT_FRIENDLY]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)">
      <path d="M3 2 L24 10.8 L15.2 14.8 L21.2 23.8 L17 26.2 L11 17.2 L6.2 23.2 Z" fill="#090d16" stroke="#090d16" stroke-width="1.8" stroke-linejoin="round"/>
      <polygon points="3.5,2.8 12.2,13.6 6.8,21.5" fill="#e0f2fe"/>
      <polygon points="3.5,2.8 22.4,10.8 12.2,13.6" fill="#38bdf8"/>
      <polygon points="12.2,13.6 14.4,14.4 20.2,23.2 17.2,24.8 11.4,16" fill="url(#emeraldLight)"/>
      <path d="M3.5 2.8 L22.4 10.8 L14.4 14.4 L20.2 23.2 L17.2 24.8 L11.4 16 L6.8 21.5 Z" fill="none" stroke="#4ade80" stroke-width="1.2" stroke-linejoin="round"/>
      <line x1="3.8" y1="3.2" x2="12.2" y2="13.6" stroke="#ffffff" stroke-width="1" opacity="0.9"/>
      <polygon points="12.2,10.8 14.6,13.5 12.2,16.2 9.8,13.5" fill="#22c55e" stroke="#052e16" stroke-width="0.8"/>
      <circle cx="12.2" cy="13.5" r="1.2" fill="#bbf7d0"/>
    </g>
  `,

  // 3b. Click Friendly Unit / Building -> Clean Press Animation (NO semi-circle!)
  [RtsCursorTypes.SELECT_FRIENDLY_PRESSED]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)" transform="translate(1.4, 1.4) scale(0.91)">
      <path d="M3 2 L24 10.8 L15.2 14.8 L21.2 23.8 L17 26.2 L11 17.2 L6.2 23.2 Z" fill="#090d16" stroke="#090d16" stroke-width="1.8" stroke-linejoin="round"/>
      <polygon points="3.5,2.8 12.2,13.6 6.8,21.5" fill="#e0f2fe"/>
      <polygon points="3.5,2.8 22.4,10.8 12.2,13.6" fill="#38bdf8"/>
      <polygon points="12.2,13.6 14.4,14.4 20.2,23.2 17.2,24.8 11.4,16" fill="url(#emeraldLight)"/>
      <path d="M3.5 2.8 L22.4 10.8 L14.4 14.4 L20.2 23.2 L17.2 24.8 L11.4 16 L6.8 21.5 Z" fill="none" stroke="#bbf7d0" stroke-width="1.4" stroke-linejoin="round"/>
      <polygon points="12.2,10.5 14.8,13.5 12.2,16.5 9.6,13.5" fill="#4ade80" stroke="#052e16" stroke-width="0.8"/>
      <circle cx="12.2" cy="13.5" r="1.3" fill="#ffffff"/>
    </g>
  `,

  // 4. Hover Enemy Unit / Building -> 3D Sculpted Crimson Broadsword
  [RtsCursorTypes.ATTACK_ENEMY]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)">
      <path d="M3 3 L12.5 5.8 L22.2 15.5 L25.5 12.2 L27.8 14.5 L23.5 18.8 L28.5 23.8 L23.8 28.5 L18.8 23.5 L14.5 27.8 L12.2 25.5 L15.5 22.2 L5.8 12.5 Z" fill="#090d16" stroke="#090d16" stroke-width="1.8" stroke-linejoin="round"/>
      <polygon points="3.5,3.5 12,6.2 21.4,15.6 17.5,17.5" fill="url(#crimsonLight)"/>
      <polygon points="3.5,3.5 17.5,17.5 15.6,21.4 6.2,12" fill="url(#crimsonDark)"/>
      <line x1="4" y1="4" x2="18.2" y2="18.2" stroke="#ffffff" stroke-width="1.3" stroke-linecap="round" opacity="0.9"/>
      <polygon points="12.8,25.2 25.2,12.8 27.2,14.8 14.8,27.2" fill="url(#gold3d)" stroke="#451a03" stroke-width="0.9"/>
      <polygon points="18.5,17.5 21.5,18.5 18.5,21.5 17.5,18.5" fill="#ef4444" stroke="#fef08a" stroke-width="0.7"/>
      <polygon points="19.2,22.4 22.4,19.2 26.8,23.6 23.6,26.8" fill="#7f1d1d" stroke="#facc15" stroke-width="0.8"/>
      <circle cx="26.2" cy="26.2" r="2.6" fill="url(#gold3d)" stroke="#090d16" stroke-width="1"/>
      <circle cx="25.6" cy="25.6" r="0.9" fill="#fef9c3"/>
    </g>
  `,

  // 4b. Enemy Sword Strike (Tilted/Lunging forward, keeping its natural 3D crimson color, NO semi-circle!)
  [RtsCursorTypes.ATTACK_ENEMY_STRIKE]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)" transform="translate(-1.2, -1.2) rotate(-15 16 16) scale(0.95)">
      <path d="M3 3 L12.5 5.8 L22.2 15.5 L25.5 12.2 L27.8 14.5 L23.5 18.8 L28.5 23.8 L23.8 28.5 L18.8 23.5 L14.5 27.8 L12.2 25.5 L15.5 22.2 L5.8 12.5 Z" fill="#090d16" stroke="#090d16" stroke-width="1.8" stroke-linejoin="round"/>
      <polygon points="3.5,3.5 12,6.2 21.4,15.6 17.5,17.5" fill="url(#crimsonLight)"/>
      <polygon points="3.5,3.5 17.5,17.5 15.6,21.4 6.2,12" fill="url(#crimsonDark)"/>
      <line x1="4" y1="4" x2="18.2" y2="18.2" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" opacity="0.95"/>
      <polygon points="12.8,25.2 25.2,12.8 27.2,14.8 14.8,27.2" fill="url(#gold3d)" stroke="#451a03" stroke-width="0.9"/>
      <polygon points="18.5,17.5 21.5,18.5 18.5,21.5 17.5,18.5" fill="#ef4444" stroke="#fef08a" stroke-width="0.7"/>
      <polygon points="19.2,22.4 22.4,19.2 26.8,23.6 23.6,26.8" fill="#7f1d1d" stroke="#facc15" stroke-width="0.8"/>
      <circle cx="26.2" cy="26.2" r="2.6" fill="url(#gold3d)" stroke="#090d16" stroke-width="1"/>
      <circle cx="25.6" cy="25.6" r="0.9" fill="#fef9c3"/>
    </g>
  `,

  // 5. Hover Enemy with Archers -> 3D Crimson Broadsword
  [RtsCursorTypes.ATTACK_RANGED]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)">
      <path d="M3 3 L12.5 5.8 L22.2 15.5 L25.5 12.2 L27.8 14.5 L23.5 18.8 L28.5 23.8 L23.8 28.5 L18.8 23.5 L14.5 27.8 L12.2 25.5 L15.5 22.2 L5.8 12.5 Z" fill="#090d16" stroke="#090d16" stroke-width="1.8" stroke-linejoin="round"/>
      <polygon points="3.5,3.5 12,6.2 21.4,15.6 17.5,17.5" fill="url(#crimsonLight)"/>
      <polygon points="3.5,3.5 17.5,17.5 15.6,21.4 6.2,12" fill="url(#crimsonDark)"/>
      <line x1="4" y1="4" x2="18.2" y2="18.2" stroke="#ffffff" stroke-width="1.3" stroke-linecap="round" opacity="0.9"/>
      <polygon points="12.8,25.2 25.2,12.8 27.2,14.8 14.8,27.2" fill="url(#gold3d)" stroke="#451a03" stroke-width="0.9"/>
      <polygon points="18.5,17.5 21.5,18.5 18.5,21.5 17.5,18.5" fill="#ef4444" stroke="#fef08a" stroke-width="0.7"/>
      <polygon points="19.2,22.4 22.4,19.2 26.8,23.6 23.6,26.8" fill="#7f1d1d" stroke="#facc15" stroke-width="0.8"/>
      <circle cx="26.2" cy="26.2" r="2.6" fill="url(#gold3d)" stroke="#090d16" stroke-width="1"/>
    </g>
  `,

  [RtsCursorTypes.ATTACK_RANGED_STRIKE]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)" transform="translate(-1.2, -1.2) rotate(-15 16 16) scale(0.95)">
      <path d="M3 3 L12.5 5.8 L22.2 15.5 L25.5 12.2 L27.8 14.5 L23.5 18.8 L28.5 23.8 L23.8 28.5 L18.8 23.5 L14.5 27.8 L12.2 25.5 L15.5 22.2 L5.8 12.5 Z" fill="#090d16" stroke="#090d16" stroke-width="1.8" stroke-linejoin="round"/>
      <polygon points="3.5,3.5 12,6.2 21.4,15.6 17.5,17.5" fill="url(#crimsonLight)"/>
      <polygon points="3.5,3.5 17.5,17.5 15.6,21.4 6.2,12" fill="url(#crimsonDark)"/>
      <line x1="4" y1="4" x2="18.2" y2="18.2" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" opacity="0.95"/>
      <polygon points="12.8,25.2 25.2,12.8 27.2,14.8 14.8,27.2" fill="url(#gold3d)" stroke="#451a03" stroke-width="0.9"/>
      <polygon points="18.5,17.5 21.5,18.5 18.5,21.5 17.5,18.5" fill="#ef4444" stroke="#fef08a" stroke-width="0.7"/>
      <polygon points="19.2,22.4 22.4,19.2 26.8,23.6 23.6,26.8" fill="#7f1d1d" stroke="#facc15" stroke-width="0.8"/>
      <circle cx="26.2" cy="26.2" r="2.6" fill="url(#gold3d)" stroke="#090d16" stroke-width="1"/>
    </g>
  `,

  // 6. Gather Wood -> Woodsman Axe Flipped Horizontally (Blade on the LEFT side of the stick, facing top-left!)
  [RtsCursorTypes.CHOP_WOOD]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)" transform="translate(32, 0) scale(-1, 1) translate(15, 16) rotate(-28)">
      <!-- Dark silhouette outline -->
      <rect x="-5.2" y="-13.2" width="4.4" height="26.4" rx="2" fill="#090d16" stroke="#090d16" stroke-width="1.8"/>
      <path d="M-5.6 -10.2 L-0.5 -10.2 C3.5 -10.2, 7.2 -11.5, 9.8 -12.6 C11.8 -8.2, 11.8 -2.4, 9.5 1.8 C6.8 -0.2, 3.2 -2.8, -0.5 -3.6 L-5.6 -3.6 Z" fill="#090d16" stroke="#090d16" stroke-width="1.8" stroke-linejoin="round"/>
      <!-- Wooden Stick -->
      <rect x="-4.6" y="-12.6" width="3.2" height="25.2" rx="1.5" fill="url(#wood3d)"/>
      <line x1="-3.5" y1="-11.8" x2="-3.5" y2="11.8" stroke="#fbbf24" stroke-width="0.8" opacity="0.75"/>
      <!-- Iron Socket & Side-Mounted Axe Blade -->
      <path d="M-5.2 -9.6 L-0.8 -9.6 C3.2 -9.6, 6.8 -10.8, 9.2 -11.8 C11.0 -7.8, 11.0 -2.6, 8.8 1.0 C6.4 -0.8, 3.0 -3.2, -0.8 -4.0 L-5.2 -4.0 Z" fill="url(#steelDark)" stroke="#1e293b" stroke-width="0.9" stroke-linejoin="round"/>
      <!-- Bright 3D Honed Side Cutting Edge -->
      <path d="M6.2 -10.6 L9.2 -11.8 C11.0 -7.8, 11.0 -2.6, 8.8 1.0 L6.0 -0.8 C7.8 -3.8, 7.8 -7.6, 6.2 -10.6 Z" fill="url(#steelLight)"/>
      <path d="M9.2 -11.8 C11.0 -7.8, 11.0 -2.6, 8.8 1.0" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round"/>
    </g>
  `,

  [RtsCursorTypes.CHOP_WOOD_STRIKE]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)" transform="translate(32, 0) scale(-1, 1) translate(16, 16) rotate(-8)">
      <rect x="-5.2" y="-13.2" width="4.4" height="26.4" rx="2" fill="#090d16" stroke="#090d16" stroke-width="1.8"/>
      <path d="M-5.6 -10.2 L-0.5 -10.2 C3.5 -10.2, 7.2 -11.5, 9.8 -12.6 C11.8 -8.2, 11.8 -2.4, 9.5 1.8 C6.8 -0.2, 3.2 -2.8, -0.5 -3.6 L-5.6 -3.6 Z" fill="#090d16" stroke="#090d16" stroke-width="1.8" stroke-linejoin="round"/>
      <rect x="-4.6" y="-12.6" width="3.2" height="25.2" rx="1.5" fill="url(#wood3d)"/>
      <path d="M-5.2 -9.6 L-0.8 -9.6 C3.2 -9.6, 6.8 -10.8, 9.2 -11.8 C11.0 -7.8, 11.0 -2.6, 8.8 1.0 C6.4 -0.8, 3.0 -3.2, -0.8 -4.0 L-5.2 -4.0 Z" fill="url(#steelDark)" stroke="#1e293b" stroke-width="0.9" stroke-linejoin="round"/>
      <path d="M6.2 -10.6 L9.2 -11.8 C11.0 -7.8, 11.0 -2.6, 8.8 1.0 L6.0 -0.8 C7.8 -3.8, 7.8 -7.6, 6.2 -10.6 Z" fill="url(#steelLight)"/>
      <path d="M9.2 -11.8 C11.0 -7.8, 11.0 -2.6, 8.8 1.0" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round"/>
    </g>
  `,

  // 7. Gather Mine -> Pickaxe: Wooden Stick with a Metal Semi-Circle Arch at the Top and Sharp Spikes on Both Sides!
  [RtsCursorTypes.MINE_RESOURCE]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)" transform="translate(16, 16) rotate(-22)">
      <rect x="-2.2" y="-12.5" width="4.4" height="25.5" rx="2" fill="#090d16" stroke="#090d16" stroke-width="1.8"/>
      <path d="M-13.2 -2.2 Q0 -14.8 13.2 -2.2 Q0 -8.2 -13.2 -2.2 Z" fill="#090d16" stroke="#090d16" stroke-width="2.4" stroke-linejoin="round"/>
      <rect x="-1.6" y="-12" width="3.2" height="24.5" rx="1.5" fill="url(#wood3d)"/>
      <line x1="-0.6" y1="-11" x2="-0.6" y2="11.5" stroke="#fbbf24" stroke-width="0.8" opacity="0.75"/>
      <path d="M-13 -2 Q0 -14.2 13 -2 Q0 -7.8 -13 -2 Z" fill="url(#steelDark)" stroke="#1e293b" stroke-width="0.9" stroke-linejoin="round"/>
      <path d="M-13 -2 Q0 -14.2 13 -2 Q0 -10.6 -13 -2 Z" fill="url(#steelLight)"/>
      <path d="M-13 -2 L-9.5 -4.8 M13 -2 L9.5 -4.8" stroke="#ffffff" stroke-width="1.3" stroke-linecap="round"/>
      <rect x="-2.6" y="-10.2" width="5.2" height="3.8" rx="0.9" fill="url(#ironWork)" stroke="#0f172a" stroke-width="0.8"/>
    </g>
  `,

  [RtsCursorTypes.MINE_RESOURCE_STRIKE]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)" transform="translate(15, 16) rotate(-42)">
      <rect x="-2.2" y="-12.5" width="4.4" height="25.5" rx="2" fill="#090d16" stroke="#090d16" stroke-width="1.8"/>
      <path d="M-13.2 -2.2 Q0 -14.8 13.2 -2.2 Q0 -8.2 -13.2 -2.2 Z" fill="#090d16" stroke="#090d16" stroke-width="2.4" stroke-linejoin="round"/>
      <rect x="-1.6" y="-12" width="3.2" height="24.5" rx="1.5" fill="url(#wood3d)"/>
      <path d="M-13 -2 Q0 -14.2 13 -2 Q0 -7.8 -13 -2 Z" fill="url(#steelDark)" stroke="#1e293b" stroke-width="0.9" stroke-linejoin="round"/>
      <path d="M-13 -2 Q0 -14.2 13 -2 Q0 -10.6 -13 -2 Z" fill="url(#steelLight)"/>
      <rect x="-2.6" y="-10.2" width="5.2" height="3.8" rx="0.9" fill="url(#ironWork)" stroke="#0f172a" stroke-width="0.8"/>
    </g>
  `,

  // 8. Build / Repair Building -> Authentic Workman Construction Hammer
  [RtsCursorTypes.BUILD_REPAIR]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)" transform="translate(16, 16) rotate(-30)">
      <rect x="-2.2" y="-12.2" width="4.4" height="25.2" rx="2" fill="#090d16" stroke="#090d16" stroke-width="1.8"/>
      <path d="M-9.5 -10.5 L-6 -10.5 L-4.5 -9.4 L4.5 -9.4 L9.5 -8.2 L9.5 -5.2 L4.5 -4.6 L-4.5 -4.6 L-6 -3.5 L-9.5 -3.5 Z" fill="#090d16" stroke="#090d16" stroke-width="2" stroke-linejoin="round"/>
      <rect x="-1.6" y="-11.6" width="3.2" height="24" rx="1.4" fill="url(#wood3d)"/>
      <line x1="-0.6" y1="-10.5" x2="-0.6" y2="11.5" stroke="#fbbf24" stroke-width="0.8" opacity="0.75"/>
      <path d="M-9 -10 L-6 -10 L-4.5 -9 L4.5 -9 L9.2 -7.8 L9.2 -5.5 L4.5 -4.8 L-4.5 -4.8 L-6 -3.8 L-9 -3.8 Z" fill="url(#steelDark)" stroke="#1e293b" stroke-width="0.9" stroke-linejoin="round"/>
      <path d="M-8.6 -9.6 L-6 -9.6 L-4.5 -8.6 L4.5 -8.6 L8.8 -7.5 L8.8 -6.6 L-8.6 -6.6 Z" fill="url(#steelLight)"/>
      <line x1="-8.8" y1="-9.6" x2="-8.8" y2="-4.2" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round"/>
    </g>
  `,

  [RtsCursorTypes.BUILD_REPAIR_STRIKE]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)" transform="translate(15, 16) rotate(-50)">
      <rect x="-2.2" y="-12.2" width="4.4" height="25.2" rx="2" fill="#090d16" stroke="#090d16" stroke-width="1.8"/>
      <path d="M-9.5 -10.5 L-6 -10.5 L-4.5 -9.4 L4.5 -9.4 L9.5 -8.2 L9.5 -5.2 L4.5 -4.6 L-4.5 -4.6 L-6 -3.5 L-9.5 -3.5 Z" fill="#090d16" stroke="#090d16" stroke-width="2" stroke-linejoin="round"/>
      <rect x="-1.6" y="-11.6" width="3.2" height="24" rx="1.4" fill="url(#wood3d)"/>
      <path d="M-9 -10 L-6 -10 L-4.5 -9 L4.5 -9 L9.2 -7.8 L9.2 -5.5 L4.5 -4.8 L-4.5 -4.8 L-6 -3.8 L-9 -3.8 Z" fill="url(#steelDark)" stroke="#1e293b" stroke-width="0.9" stroke-linejoin="round"/>
      <path d="M-8.6 -9.6 L-6 -9.6 L-4.5 -8.6 L4.5 -8.6 L8.8 -7.5 L8.8 -6.6 L-8.6 -6.6 Z" fill="url(#steelLight)"/>
    </g>
  `,

  // 9. Invalid Building Placement -> Construction Hammer + Crimson X
  [RtsCursorTypes.BUILD_INVALID]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)">
      <g transform="translate(16, 16) rotate(-30)">
        <rect x="-1.8" y="-11.6" width="3.6" height="24" rx="1.4" fill="#78350f" stroke="#090d16" stroke-width="1.5"/>
        <path d="M-9 -10 L-6 -10 L-4.5 -9 L4.5 -9 L9.2 -7.8 L9.2 -5.5 L4.5 -4.8 L-4.5 -4.8 L-6 -3.8 L-9 -3.8 Z" fill="#64748b" stroke="#090d16" stroke-width="1.5" stroke-linejoin="round"/>
      </g>
      <path d="M7 7 L25 25 M25 7 L7 25" stroke="#090d16" stroke-width="5" stroke-linecap="round"/>
      <path d="M7 7 L25 25 M25 7 L7 25" stroke="#ef4444" stroke-width="2.8" stroke-linecap="round"/>
    </g>
  `,

  // 10. Resource Drop-off -> Clean 3D Emerald Green Deposit Arrow
  [RtsCursorTypes.DROPOFF_RESOURCE]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)">
      <path d="M12 4 L20 4 L20 15 L26 15 L16 27 L6 15 L12 15 Z" fill="#090d16" stroke="#090d16" stroke-width="2.2" stroke-linejoin="round"/>
      <polygon points="12.5,4.8 16,4.8 16,25.8 7.2,15.5 12.5,15.5" fill="url(#emeraldLight)"/>
      <polygon points="16,4.8 19.5,4.8 19.5,15.5 24.8,15.5 16,25.8" fill="url(#emeraldDark)"/>
      <path d="M12.5 4.8 L19.5 4.8 L19.5 15.5 L24.8 15.5 L16 25.8 L7.2 15.5 L12.5 15.5 Z" fill="none" stroke="url(#gold3d)" stroke-width="1.2" stroke-linejoin="round"/>
      <line x1="13.5" y1="5.8" x2="13.5" y2="16.5" stroke="#ffffff" stroke-width="1.1" stroke-linecap="round" opacity="0.85"/>
    </g>
  `,

  [RtsCursorTypes.DROPOFF_RESOURCE_PRESSED]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)" transform="translate(0, 2.5) scale(0.94)">
      <path d="M12 4 L20 4 L20 15 L26 15 L16 27 L6 15 L12 15 Z" fill="#090d16" stroke="#090d16" stroke-width="2.2" stroke-linejoin="round"/>
      <polygon points="12.5,4.8 16,4.8 16,25.8 7.2,15.5 12.5,15.5" fill="url(#emeraldLight)"/>
      <polygon points="16,4.8 19.5,4.8 19.5,15.5 24.8,15.5 16,25.8" fill="url(#emeraldDark)"/>
      <path d="M12.5 4.8 L19.5 4.8 L19.5 15.5 L24.8 15.5 L16 25.8 L7.2 15.5 L12.5 15.5 Z" fill="none" stroke="#fef08a" stroke-width="1.35" stroke-linejoin="round"/>
    </g>
  `,

  // 11. Garrison / Resupply Ammo / Infirmary Heal
  [RtsCursorTypes.GARRISON_RESUPPLY]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)">
      <path d="M7 4 L25 4 L25 16 C25 22.8 16 28 16 28 C16 28 7 22.8 7 16 Z" fill="#090d16" stroke="url(#gold3d)" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M8.2 5.2 L16 5.2 L16 26.5 C16 26.5 8.2 21.8 8.2 15.8 Z" fill="#1e293b"/>
      <path d="M16 5.2 L23.8 5.2 L23.8 15.8 C23.8 21.8 16 26.5 16 26.5 Z" fill="#0f172a"/>
      <path d="M11 16.5 L16 11.2 L21 16.5 M16 11.5 L16 22.5" fill="none" stroke="#38bdf8" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="16" cy="8" r="1.5" fill="#fef08a"/>
    </g>
  `,

  [RtsCursorTypes.GARRISON_RESUPPLY_PRESSED]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)" transform="translate(1, 1) scale(0.93)">
      <path d="M7 4 L25 4 L25 16 C25 22.8 16 28 16 28 C16 28 7 22.8 7 16 Z" fill="#090d16" stroke="#38bdf8" stroke-width="2" stroke-linejoin="round"/>
      <path d="M11 14.5 L16 9.2 L21 14.5 M16 9.5 L16 20.5" fill="none" stroke="#bae6fd" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  `,

  // 12. Attack-Move Mode (Shift+A)
  [RtsCursorTypes.ATTACK_MOVE]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)">
      <line x1="16" y1="2" x2="16" y2="8" stroke="#090d16" stroke-width="3.6" stroke-linecap="round"/>
      <line x1="16" y1="24" x2="16" y2="30" stroke="#090d16" stroke-width="3.6" stroke-linecap="round"/>
      <line x1="2" y1="16" x2="8" y2="16" stroke="#090d16" stroke-width="3.6" stroke-linecap="round"/>
      <line x1="24" y1="16" x2="30" y2="16" stroke="#090d16" stroke-width="3.6" stroke-linecap="round"/>
      <line x1="16" y1="2" x2="16" y2="8" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/>
      <line x1="16" y1="24" x2="16" y2="30" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/>
      <line x1="2" y1="16" x2="8" y2="16" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/>
      <line x1="24" y1="16" x2="30" y2="16" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/>
      <polygon points="16,8.5 18.5,16 16,21.5 13.5,16" fill="url(#crimsonLight)" stroke="#7f1d1d" stroke-width="1"/>
    </g>
  `,

  [RtsCursorTypes.ATTACK_MOVE_PRESSED]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)" transform="translate(1.2, 1.2) scale(0.92)">
      <line x1="16" y1="2" x2="16" y2="8" stroke="#fecaca" stroke-width="2.6" stroke-linecap="round"/>
      <line x1="16" y1="24" x2="16" y2="30" stroke="#fecaca" stroke-width="2.6" stroke-linecap="round"/>
      <line x1="2" y1="16" x2="8" y2="16" stroke="#fecaca" stroke-width="2.6" stroke-linecap="round"/>
      <line x1="24" y1="16" x2="30" y2="16" stroke="#fecaca" stroke-width="2.6" stroke-linecap="round"/>
      <polygon points="16,7.5 19,16 16,22.5 13,16" fill="url(#crimsonLight)" stroke="#ef4444" stroke-width="1.2"/>
    </g>
  `,

  // 13. Patrol Mode (Key P)
  [RtsCursorTypes.PATROL]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)">
      <line x1="9" y1="4" x2="9" y2="27" stroke="#090d16" stroke-width="3.8" stroke-linecap="round"/>
      <path d="M10 5 L26 8.5 L20.5 13.5 L26 18.5 L10 18.5 Z" fill="#2563eb" stroke="url(#gold3d)" stroke-width="1.5" stroke-linejoin="round"/>
      <polygon points="10,5 26,8.5 20.5,13.5 10,12" fill="#60a5fa" opacity="0.55"/>
      <line x1="9" y1="4" x2="9" y2="27" stroke="url(#steelLight)" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="9" cy="4" r="1.8" fill="url(#gold3d)"/>
    </g>
  `,

  [RtsCursorTypes.PATROL_PRESSED]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)" transform="translate(1, 1.5) scale(0.93)">
      <line x1="9" y1="4" x2="9" y2="27" stroke="#090d16" stroke-width="3.8" stroke-linecap="round"/>
      <path d="M10 5 L26 8.5 L20.5 13.5 L26 18.5 L10 18.5 Z" fill="#3b82f6" stroke="#fef08a" stroke-width="1.6" stroke-linejoin="round"/>
      <line x1="9" y1="4" x2="9" y2="27" stroke="url(#steelLight)" stroke-width="1.8" stroke-linecap="round"/>
    </g>
  `,

  // 14. Right-Click Formation Line Drag
  [RtsCursorTypes.FORMATION_DRAG]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)">
      <path d="M4 18 L28 18 M8.5 13.5 L4 18 L8.5 22.5 M23.5 13.5 L28 18 L23.5 22.5" fill="none" stroke="#090d16" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M4 18 L28 18 M8.5 13.5 L4 18 L8.5 22.5 M23.5 13.5 L28 18 L23.5 22.5" fill="none" stroke="url(#gold3d)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M16 18 L16 6 M12 10 L16 5.5 L20 10" fill="none" stroke="#090d16" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M16 18 L16 6 M12 10 L16 5.5 L20 10" fill="none" stroke="#38bdf8" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  `,

  // 15. Camera Orbit
  [RtsCursorTypes.CAMERA_ORBIT]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)">
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="#38bdf8" stroke-width="2" stroke-dasharray="6 3"/>
      <circle cx="16" cy="16" r="2.5" fill="url(#gold3d)"/>
    </g>
  `,

  // 16. Spell Target Reticle — Neutral (Red target reticle!)
  [RtsCursorTypes.SPELL_TARGET_NEUTRAL]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)">
      <circle cx="16" cy="16" r="10.2" fill="rgba(69,10,10,0.35)" stroke="#ef4444" stroke-width="2.1"/>
      <circle cx="16" cy="16" r="5.8" fill="none" stroke="#fca5a5" stroke-width="1.2" stroke-dasharray="3 2"/>
      <line x1="16" y1="2" x2="16" y2="8.5" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="16" y1="23.5" x2="16" y2="30" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="2" y1="16" x2="8.5" y2="16" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="23.5" y1="16" x2="30" y2="16" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="16" cy="16" r="2.2" fill="#f87171" stroke="#450a0a" stroke-width="0.8"/>
    </g>
  `,

  // 17. Spell Target Reticle — VALID Target (Same RED target reticle + extra lock-on corner brackets & center diamond!)
  [RtsCursorTypes.SPELL_TARGET_VALID]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)">
      <circle cx="16" cy="16" r="10.2" fill="rgba(127,29,29,0.52)" stroke="#ef4444" stroke-width="2.3"/>
      <circle cx="16" cy="16" r="5.8" fill="none" stroke="#fca5a5" stroke-width="1.3"/>
      <path d="M4.5 9.5 L4.5 4.5 L9.5 4.5 M22.5 4.5 L27.5 4.5 L27.5 9.5 M27.5 22.5 L27.5 27.5 L22.5 27.5 M9.5 27.5 L4.5 27.5 L4.5 22.5" fill="none" stroke="#ef4444" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="16" y1="1.5" x2="16" y2="8.2" stroke="#ef4444" stroke-width="2.4" stroke-linecap="round"/>
      <line x1="16" y1="23.8" x2="16" y2="30.5" stroke="#ef4444" stroke-width="2.4" stroke-linecap="round"/>
      <line x1="1.5" y1="16" x2="8.2" y2="16" stroke="#ef4444" stroke-width="2.4" stroke-linecap="round"/>
      <line x1="23.8" y1="16" x2="30.5" y2="16" stroke="#ef4444" stroke-width="2.4" stroke-linecap="round"/>
      <polygon points="16,11.2 20.8,16 16,20.8 11.2,16" fill="url(#crimsonLight)" stroke="#fef2f2" stroke-width="1.1"/>
      <circle cx="16" cy="16" r="1.6" fill="#ffffff"/>
    </g>
  `,

  // 18. Spell Target Reticle — INVALID Object ("זה אי אפשר!")
  [RtsCursorTypes.SPELL_TARGET_INVALID]: `
    ${SHARED_3D_DEFS}
    <g filter="url(#ds)">
      <circle cx="16" cy="16" r="11.0" fill="rgba(69,10,10,0.58)" stroke="#ef4444" stroke-width="2.4"/>
      <line x1="16" y1="2" x2="16" y2="7.5" stroke="#f87171" stroke-width="2.0" stroke-linecap="round"/>
      <line x1="16" y1="24.5" x2="16" y2="30" stroke="#f87171" stroke-width="2.0" stroke-linecap="round"/>
      <line x1="2" y1="16" x2="7.5" y2="16" stroke="#f87171" stroke-width="2.0" stroke-linecap="round"/>
      <line x1="24.5" y1="16" x2="30" y2="16" stroke="#f87171" stroke-width="2.0" stroke-linecap="round"/>
      <line x1="10.5" y1="10.5" x2="21.5" y2="21.5" stroke="#fef2f2" stroke-width="2.8" stroke-linecap="round"/>
      <line x1="21.5" y1="10.5" x2="10.5" y2="21.5" stroke="#fef2f2" stroke-width="2.8" stroke-linecap="round"/>
    </g>
  `
};

const CURSOR_HOTSPOTS = {
  [RtsCursorTypes.DEFAULT]: [3, 2],
  [RtsCursorTypes.DEFAULT_PRESSED]: [3, 2],
  [RtsCursorTypes.HAND_POINTER]: [10, 4],
  [RtsCursorTypes.HAND_POINTER_PRESSED]: [10, 4],
  [RtsCursorTypes.SELECT_FRIENDLY]: [3, 2],
  [RtsCursorTypes.SELECT_FRIENDLY_PRESSED]: [3, 2],
  [RtsCursorTypes.ATTACK_ENEMY]: [3, 3],
  [RtsCursorTypes.ATTACK_ENEMY_STRIKE]: [3, 3],
  [RtsCursorTypes.ATTACK_RANGED]: [3, 3],
  [RtsCursorTypes.ATTACK_RANGED_STRIKE]: [3, 3],
  [RtsCursorTypes.CHOP_WOOD]: [12, 12],
  [RtsCursorTypes.CHOP_WOOD_STRIKE]: [12, 12],
  [RtsCursorTypes.MINE_RESOURCE]: [16, 10],
  [RtsCursorTypes.MINE_RESOURCE_STRIKE]: [16, 10],
  [RtsCursorTypes.BUILD_REPAIR]: [14, 10],
  [RtsCursorTypes.BUILD_REPAIR_STRIKE]: [14, 10],
  [RtsCursorTypes.BUILD_INVALID]: [16, 16],
  [RtsCursorTypes.DROPOFF_RESOURCE]: [16, 25],
  [RtsCursorTypes.DROPOFF_RESOURCE_PRESSED]: [16, 25],
  [RtsCursorTypes.GARRISON_RESUPPLY]: [16, 16],
  [RtsCursorTypes.GARRISON_RESUPPLY_PRESSED]: [16, 16],
  [RtsCursorTypes.ATTACK_MOVE]: [16, 16],
  [RtsCursorTypes.ATTACK_MOVE_PRESSED]: [16, 16],
  [RtsCursorTypes.PATROL]: [9, 26],
  [RtsCursorTypes.PATROL_PRESSED]: [9, 26],
  [RtsCursorTypes.FORMATION_DRAG]: [16, 18],
  [RtsCursorTypes.CAMERA_ORBIT]: [16, 16],
  [RtsCursorTypes.SPELL_TARGET_NEUTRAL]: [16, 16],
  [RtsCursorTypes.SPELL_TARGET_VALID]: [16, 16],
  [RtsCursorTypes.SPELL_TARGET_INVALID]: [16, 16]
};

const CURSOR_CSS_MAP = {};
for (const [k, body] of Object.entries(CURSOR_RAW_SVGS)) {
  const [hx, hy] = CURSOR_HOTSPOTS[k] || [4, 4];
  CURSOR_CSS_MAP[k] = buildSvgCursorUrl(body, hx, hy);
}
CURSOR_CSS_MAP[RtsCursorTypes.HIDDEN] = "none";

const STRIKE_VARIANT_MAP = {
  [RtsCursorTypes.DEFAULT]: RtsCursorTypes.DEFAULT_PRESSED,
  [RtsCursorTypes.HAND_POINTER]: RtsCursorTypes.HAND_POINTER_PRESSED,
  [RtsCursorTypes.SELECT_FRIENDLY]: RtsCursorTypes.SELECT_FRIENDLY_PRESSED,
  [RtsCursorTypes.ATTACK_ENEMY]: RtsCursorTypes.ATTACK_ENEMY_STRIKE,
  [RtsCursorTypes.ATTACK_RANGED]: RtsCursorTypes.ATTACK_RANGED_STRIKE,
  [RtsCursorTypes.CHOP_WOOD]: RtsCursorTypes.CHOP_WOOD_STRIKE,
  [RtsCursorTypes.MINE_RESOURCE]: RtsCursorTypes.MINE_RESOURCE_STRIKE,
  [RtsCursorTypes.BUILD_REPAIR]: RtsCursorTypes.BUILD_REPAIR_STRIKE,
  [RtsCursorTypes.DROPOFF_RESOURCE]: RtsCursorTypes.DROPOFF_RESOURCE_PRESSED,
  [RtsCursorTypes.GARRISON_RESUPPLY]: RtsCursorTypes.GARRISON_RESUPPLY_PRESSED,
  [RtsCursorTypes.ATTACK_MOVE]: RtsCursorTypes.ATTACK_MOVE_PRESSED,
  [RtsCursorTypes.PATROL]: RtsCursorTypes.PATROL_PRESSED
};

export class RtsCursorManager {
  constructor({ domElement, container, worldPicker, simBridge }) {
    this.domElement = domElement;
    this.container = container;
    this.worldPicker = worldPicker;
    this.simBridge = simBridge;

    this.baseCursorType = RtsCursorTypes.DEFAULT;
    this.currentCursorType = null;
    this.hoveredFriendlyCompanyId = null;
    this.hoveredEnemyCompanyId = null;
    this.hoveredBuildingId = null;

    this._isMousePressed = false;
    this._mousedownTime = 0;
    this._strikeTimer = null;

    this._injectGlobalUiCursorStyles();
    this._bindClickStrikeListeners();
    this.setCursor(RtsCursorTypes.DEFAULT);
  }

  _injectGlobalUiCursorStyles() {
    if (typeof document === "undefined") return;
    let styleEl = document.getElementById("kings-lands-custom-cursors-style");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "kings-lands-custom-cursors-style";
      document.head.appendChild(styleEl);
    }
    const defaultUrl = CURSOR_CSS_MAP[RtsCursorTypes.DEFAULT];
    const defaultPressedUrl = CURSOR_CSS_MAP[RtsCursorTypes.DEFAULT_PRESSED];
    const handUrl = CURSOR_CSS_MAP[RtsCursorTypes.HAND_POINTER];
    const handPressedUrl = CURSOR_CSS_MAP[RtsCursorTypes.HAND_POINTER_PRESSED];
    styleEl.textContent = `
      body, #app {
        cursor: ${defaultUrl};
      }
      body:active {
        cursor: ${defaultPressedUrl};
      }
      button:not(:disabled):not([data-no-pointer="1"]):not(.cursor-default):not(.cursor-not-allowed),
      [role="button"]:not(:disabled):not([data-no-pointer="1"]):not(.cursor-default):not(.cursor-not-allowed),
      select:not(:disabled),
      label.cursor-pointer,
      .cursor-pointer:not([data-no-pointer="1"]),
      #building-radial-menu button:not(:disabled):not([data-no-pointer="1"]),
      #worker-build-chain-menu button:not(:disabled):not([data-no-pointer="1"]) {
        cursor: ${handUrl} !important;
      }
      button:not(:disabled):not([data-no-pointer="1"]):not(.cursor-default):not(.cursor-not-allowed):active,
      [role="button"]:not(:disabled):not([data-no-pointer="1"]):not(.cursor-default):not(.cursor-not-allowed):active,
      select:not(:disabled):active,
      label.cursor-pointer:active,
      .cursor-pointer:not([data-no-pointer="1"]):active,
      #building-radial-menu button:not(:disabled):not([data-no-pointer="1"]):active,
      #worker-build-chain-menu button:not(:disabled):not([data-no-pointer="1"]):active {
        cursor: ${handPressedUrl} !important;
      }
      [data-no-pointer="1"],
      button[data-no-pointer="1"],
      .cursor-default {
        cursor: ${defaultUrl} !important;
      }
    `;
  }

  _bindClickStrikeListeners() {
    if (typeof window === "undefined") return;

    // Hold the pressed/strike cursor state for as long as the mouse button is held down!
    // Only release when the user actually releases the mouse button (mouseup / blur).
    window.addEventListener(
      "mousedown",
      () => {
        clearTimeout(this._strikeTimer);
        this._isMousePressed = true;
        this._mousedownTime = performance.now();
        this._applyEffectiveCursor();
      },
      true
    );

    const handleRelease = () => {
      if (!this._isMousePressed) return;
      clearTimeout(this._strikeTimer);
      const heldMs = performance.now() - (this._mousedownTime || 0);
      const minTapVisualMs = 110;
      if (heldMs < minTapVisualMs) {
        this._strikeTimer = setTimeout(() => {
          this._isMousePressed = false;
          this._applyEffectiveCursor();
        }, minTapVisualMs - heldMs);
      } else {
        this._isMousePressed = false;
        this._applyEffectiveCursor();
      }
    };

    window.addEventListener("mouseup", handleRelease, true);
    window.addEventListener("blur", () => {
      clearTimeout(this._strikeTimer);
      this._isMousePressed = false;
      this._applyEffectiveCursor();
    });
  }

  _applyEffectiveCursor() {
    let targetType = this.baseCursorType;
    if (this._isMousePressed && STRIKE_VARIANT_MAP[targetType]) {
      targetType = STRIKE_VARIANT_MAP[targetType];
    }
    const resolved = CURSOR_CSS_MAP[targetType] ? targetType : RtsCursorTypes.DEFAULT;
    if (this.currentCursorType === resolved) return;
    this.currentCursorType = resolved;
    const cssVal = CURSOR_CSS_MAP[resolved];
    if (this.domElement) {
      this.domElement.style.cursor = cssVal;
    }
    if (this.container) {
      this.container.style.cursor = cssVal;
    }
  }

  setCursor(cursorType) {
    this.baseCursorType = CURSOR_CSS_MAP[cursorType] ? cursorType : RtsCursorTypes.DEFAULT;
    this._applyEffectiveCursor();
  }

  updateFromMouseEvent(e, context = {}) {
    const {
      selectedCompanyIds,
      selectionController,
      targetingMode = "NONE",
      isActivelyStretchingFormation = false,
      isLeftMarqueeDragging = false,
      activePlacementType = null,
      isPlacementValid = true
    } = context;

    this.hoveredFriendlyCompanyId = null;
    this.hoveredEnemyCompanyId = null;
    this.hoveredBuildingId = null;

    if (activePlacementType) {
      this.setCursor(
        isPlacementValid ? RtsCursorTypes.BUILD_REPAIR : RtsCursorTypes.BUILD_INVALID
      );
      return;
    }

    if (isActivelyStretchingFormation && selectedCompanyIds && selectedCompanyIds.size > 0) {
      this.setCursor(RtsCursorTypes.FORMATION_DRAG);
      return;
    }

    if (targetingMode === "SPELL_GROUND") {
      this.setCursor(RtsCursorTypes.HIDDEN);
      return;
    }
    if (targetingMode === "SPELL_UNIT") {
      const spellTargetMode = context.spellTargetMode || "unit";
      if (this.worldPicker && e) {
        // 1. Valid Enemy Unit -> SPELL_TARGET_VALID ("כאן אפשר!")
        const enemyUnit = this.worldPicker.findEnemyUnitOnScreen(e.clientX, e.clientY, 44);
        if (enemyUnit) {
          this.hoveredEnemyCompanyId = enemyUnit.companyId ?? null;
          this.setCursor(RtsCursorTypes.SPELL_TARGET_VALID);
          return;
        }

        const tHit = this.worldPicker.raycastTerrain(e);
        if (tHit) {
          // 2. Building under cursor: valid ONLY if enemy building AND spellTargetMode === 'unit_or_building'; otherwise INVALID!
          const bld = this.worldPicker.findBuildingNear(tHit.x, tHit.z, 3.2);
          if (bld && bld.type !== "citadel_slot" && (bld.hp ?? 1) > 0) {
            this.hoveredBuildingId = bld.id;
            const isEnemySpellBld = this.simBridge?.isEnemyOfPlayer ? this.simBridge.isEnemyOfPlayer(bld.team) : bld.team !== 1;
            if (isEnemySpellBld && spellTargetMode === "unit_or_building") {
              this.setCursor(RtsCursorTypes.SPELL_TARGET_VALID);
            } else {
              this.setCursor(RtsCursorTypes.SPELL_TARGET_INVALID);
            }
            return;
          }

          // 3. Resource Node (tree / mine) under cursor -> INVALID!
          const resNode = this.worldPicker.findResourceNodeAtMouse(e, tHit);
          if (resNode) {
            this.setCursor(RtsCursorTypes.SPELL_TARGET_INVALID);
            return;
          }
        }

        // 4. Friendly Unit under cursor -> INVALID!
        const friendlyUnit = this.worldPicker.findNearestUnitOnScreen(e.clientX, e.clientY, 1, 34);
        if (friendlyUnit) {
          this.hoveredFriendlyCompanyId = friendlyUnit.companyId ?? null;
          this.setCursor(RtsCursorTypes.SPELL_TARGET_INVALID);
          return;
        }
      }
      // 5. Empty ground -> Neutral Target Reticle
      this.setCursor(RtsCursorTypes.SPELL_TARGET_NEUTRAL);
      return;
    }
    if (targetingMode === "ATTACK_MOVE") {
      this.setCursor(RtsCursorTypes.ATTACK_MOVE);
      return;
    }
    if (targetingMode === "PATROL") {
      this.setCursor(RtsCursorTypes.PATROL);
      return;
    }

    if (isLeftMarqueeDragging) {
      this.setCursor(RtsCursorTypes.DEFAULT);
      return;
    }

    if (!this.worldPicker || !e) {
      this.setCursor(RtsCursorTypes.DEFAULT);
      return;
    }

    const clientX = e.clientX;
    const clientY = e.clientY;

    const hasSelectedUnits = Boolean(selectedCompanyIds && selectedCompanyIds.size > 0);
    let hasSelectedWorkers = false;
    let hasSelectedArchers = false;
    let hasSelectedCombatUnits = false;

    if (hasSelectedUnits && selectionController) {
      const friendlyMap = selectionController.gatherFriendlyCompanies?.();
      if (friendlyMap) {
        for (const cid of selectedCompanyIds) {
          const comp = friendlyMap.get(cid);
          if (!comp) continue;
          if (comp.unitType === "worker") {
            hasSelectedWorkers = true;
          } else {
            hasSelectedCombatUnits = true;
            if (comp.unitType === "archer") {
              hasSelectedArchers = true;
            }
          }
        }
      }
    }

    const hoveredEnemyUnit = this.worldPicker.findEnemyUnitOnScreen(clientX, clientY, 34);
    if (hoveredEnemyUnit) {
      this.hoveredEnemyCompanyId = hoveredEnemyUnit.companyId ?? null;
      this.setCursor(
        hasSelectedArchers && !hasSelectedWorkers
          ? RtsCursorTypes.ATTACK_RANGED
          : RtsCursorTypes.ATTACK_ENEMY
      );
      return;
    }

    const terrainHit = this.worldPicker.raycastTerrain(e);

    if (hasSelectedWorkers) {
      const resNode = this.worldPicker.findResourceNodeAtMouse(e, terrainHit);
      if (resNode) {
        this.setCursor(
          resNode.isMine ? RtsCursorTypes.MINE_RESOURCE : RtsCursorTypes.CHOP_WOOD
        );
        return;
      }
    }

    if (terrainHit) {
      const hoveredBld = this.worldPicker.findBuildingNear(terrainHit.x, terrainHit.z, 0.85);
      if (hoveredBld && hoveredBld.type !== "citadel_slot" && (hoveredBld.hp ?? 1) > 0) {
        this.hoveredBuildingId = hoveredBld.id;

        const isEnemyBld = this.simBridge?.isEnemyOfPlayer ? this.simBridge.isEnemyOfPlayer(hoveredBld.team) : hoveredBld.team !== 1;
        if (isEnemyBld) {
          this.setCursor(
            hasSelectedArchers && !hasSelectedWorkers
              ? RtsCursorTypes.ATTACK_RANGED
              : RtsCursorTypes.ATTACK_ENEMY
          );
          return;
        }

        if (hasSelectedWorkers) {
          const isUnfinishedOrDamaged =
            !hoveredBld.isCompleted ||
            (typeof hoveredBld.maxHp === "number" &&
              hoveredBld.maxHp > 0 &&
              hoveredBld.hp < hoveredBld.maxHp);
          if (isUnfinishedOrDamaged) {
            this.setCursor(RtsCursorTypes.BUILD_REPAIR);
            return;
          }

          if (
            hoveredBld.isCompleted &&
            (hoveredBld.type === "gathering_camp" || hoveredBld.type === "citadel")
          ) {
            this.setCursor(RtsCursorTypes.DROPOFF_RESOURCE);
            return;
          }

          if (hoveredBld.isCompleted && hoveredBld.type === "watchtower") {
            this.setCursor(RtsCursorTypes.DROPOFF_RESOURCE);
            return;
          }
        }

        if (hasSelectedCombatUnits && hoveredBld.isCompleted) {
          if (
            hoveredBld.type === "infirmary" ||
            hoveredBld.type === "watchtower" ||
            (hasSelectedArchers &&
              (hoveredBld.type === "archery_range" ||
                hoveredBld.type === "blacksmith" ||
                hoveredBld.type === "citadel"))
          ) {
            this.setCursor(RtsCursorTypes.DROPOFF_RESOURCE);
            return;
          }
        }

        this.setCursor(RtsCursorTypes.SELECT_FRIENDLY);
        return;
      }
    }

    const hoveredFriendlyUnit = this.worldPicker.findNearestUnitOnScreen(clientX, clientY, 1, 30);
    if (hoveredFriendlyUnit) {
      this.hoveredFriendlyCompanyId = hoveredFriendlyUnit.companyId ?? null;
      this.setCursor(RtsCursorTypes.SELECT_FRIENDLY);
      return;
    }

    this.setCursor(RtsCursorTypes.DEFAULT);
  }
}
