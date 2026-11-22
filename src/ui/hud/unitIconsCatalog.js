/**
 * Kings Lands — Shared Visual Unit Icons Catalog & Renderer
 * (src/ui/hud/unitIconsCatalog.js)
 *
 * Provides visual SVG & custom-image icons for:
 * 1. Building Recruitment Menu (`buildingRadialMenu.js`)
 * 2. Bottom-Center Multi-Squad Selection Bar (`squadCommandBar.js`)
 * 3. Ground Formation Placement Ghost (`formationGhostPreview.js`) & 3D Unit Flag Banner (`modelFactory.js`)
 * 4. Units & Buildings Lab (`unitsTabRenderer.js`) & Animation Lab (`studioGearAndPose.js`)
 */

export const UNIT_ICON_SVGS = Object.freeze({
  swordsman: `<svg viewBox="0 0 64 64" class="w-full h-full drop-shadow"><path d="M16 48 L46 18 M40 16 L48 16 L48 24" stroke="#f8fafc" stroke-width="5" stroke-linecap="round" fill="none"/><path d="M12 52 L20 44 M14 42 L22 50" stroke="#fbbf24" stroke-width="4" stroke-linecap="round"/><path d="M48 48 L18 18 M16 24 L16 16 L24 16" stroke="#cbd5e1" stroke-width="4.5" stroke-linecap="round" fill="none"/><path d="M44 44 L52 52 M42 50 L50 42" stroke="#fbbf24" stroke-width="4" stroke-linecap="round"/></svg>`,
  spearman: `<svg viewBox="0 0 64 64" class="w-full h-full drop-shadow"><line x1="14" y1="52" x2="48" y2="18" stroke="#d97706" stroke-width="4.5" stroke-linecap="round"/><polygon points="54,10 42,16 48,22" fill="#f8fafc"/><path d="M22 22 H42 V36 C42 46 32 52 32 52 C32 52 22 46 22 36 Z" fill="#1e40af" stroke="#fbbf24" stroke-width="3.5"/><circle cx="32" cy="35" r="4" fill="#fbbf24"/></svg>`,
  archer: `<svg viewBox="0 0 64 64" class="w-full h-full drop-shadow"><path d="M22 12 C42 20 42 44 22 52" stroke="#f59e0b" stroke-width="4.5" fill="none" stroke-linecap="round"/><line x1="22" y1="12" x2="22" y2="52" stroke="#e2e8f0" stroke-width="2"/><line x1="12" y1="32" x2="50" y2="32" stroke="#f8fafc" stroke-width="3.5" stroke-linecap="round"/><polygon points="54,32 44,27 44,37" fill="#fbbf24"/></svg>`,
  cavalry: `<svg viewBox="0 0 64 64" class="w-full h-full drop-shadow"><path d="M20 48 V28 C20 17 44 17 44 28 V48" stroke="#fbbf24" stroke-width="6.5" fill="none" stroke-linecap="round"/><line x1="16" y1="48" x2="24" y2="48" stroke="#f8fafc" stroke-width="5" stroke-linecap="round"/><line x1="40" y1="48" x2="48" y2="48" stroke="#f8fafc" stroke-width="5" stroke-linecap="round"/></svg>`,
  worker: `<svg viewBox="0 0 64 64" class="w-full h-full drop-shadow"><line x1="32" y1="26" x2="32" y2="54" stroke="#d97706" stroke-width="5.5" stroke-linecap="round"/><rect x="16" y="16" width="32" height="12" rx="3" fill="#94a3b8" stroke="#f8fafc" stroke-width="2.5"/></svg>`,
  ballista: `<svg viewBox="0 0 64 64" class="w-full h-full drop-shadow"><path d="M14 26 Q32 10 50 26" stroke="#f59e0b" stroke-width="5" fill="none" stroke-linecap="round"/><line x1="14" y1="26" x2="50" y2="26" stroke="#cbd5e1" stroke-width="2.5"/><line x1="32" y1="12" x2="32" y2="52" stroke="#b45309" stroke-width="5.5" stroke-linecap="round"/><polygon points="32,8 25,20 39,20" fill="#f8fafc"/><circle cx="20" cy="46" r="6" stroke="#fbbf24" stroke-width="3" fill="#1e293b"/><circle cx="44" cy="46" r="6" stroke="#fbbf24" stroke-width="3" fill="#1e293b"/></svg>`,
  hero: `<svg viewBox="0 0 64 64" class="w-full h-full drop-shadow"><path d="M12 46 L16 22 L26 32 L32 16 L38 32 L48 22 L52 46 Z" fill="#f59e0b" stroke="#fef08a" stroke-width="3" stroke-linejoin="round"/><circle cx="32" cy="14" r="3.5" fill="#fef08a"/><rect x="12" y="48" width="40" height="5" rx="2" fill="#d97706"/></svg>`,
  shield: `<svg viewBox="0 0 64 64" class="w-full h-full drop-shadow"><path d="M16 14 H48 V34 C48 47 32 55 32 55 C32 55 16 47 16 34 Z" fill="#1d4ed8" stroke="#fbbf24" stroke-width="4"/><path d="M32 18 V50 M20 32 H44" stroke="#f8fafc" stroke-width="3.5" stroke-linecap="round"/></svg>`,
  banner: `<svg viewBox="0 0 64 64" class="w-full h-full drop-shadow"><line x1="18" y1="10" x2="18" y2="54" stroke="#fbbf24" stroke-width="4.5" stroke-linecap="round"/><path d="M18 14 H48 L42 26 L48 38 H18 Z" fill="#dc2626" stroke="#fef08a" stroke-width="3" stroke-linejoin="round"/></svg>`,
  forge: `<svg viewBox="0 0 64 64" class="w-full h-full drop-shadow"><path d="M14 36 H50 L44 48 H20 Z" fill="#64748b" stroke="#cbd5e1" stroke-width="2.5"/><rect x="24" y="48" width="16" height="6" fill="#475569"/><path d="M28 14 L38 24 M34 12 L42 20" stroke="#fbbf24" stroke-width="4" stroke-linecap="round"/></svg>`,
  axe: `<svg viewBox="0 0 64 64" class="w-full h-full drop-shadow"><line x1="18" y1="50" x2="46" y2="14" stroke="#b45309" stroke-width="5" stroke-linecap="round"/><path d="M34 14 C48 12 54 22 46 32 C40 26 36 22 34 14 Z" fill="#e2e8f0" stroke="#94a3b8" stroke-width="2.5"/></svg>`
});

export const BUILT_IN_ICON_KEYS = Object.freeze([
  'swordsman',
  'spearman',
  'archer',
  'cavalry',
  'worker',
  'ballista',
  'hero',
  'shield',
  'banner',
  'axe',
  'forge'
]);

export function resolveAutoUnitIconKey(uStat = null, unitId = '', weaponTypes = null) {
  const id = String(uStat?.id || unitId || '').toLowerCase();
  if (uStat?.isWorker || id === 'worker') return 'worker';
  if (uStat?.isSiege || id.includes('ballista') || id.includes('catapult')) return 'ballista';
  if (Array.isArray(weaponTypes) && weaponTypes.length > 0) {
    if (weaponTypes.includes('bow') || weaponTypes.includes('thrown')) return 'archer';
    if (uStat?.isMounted) return 'cavalry';
    if (weaponTypes.includes('melee_long') || weaponTypes.includes('pike') || weaponTypes.includes('spear')) return 'spearman';
    if (weaponTypes.includes('axe')) return 'axe';
    if (weaponTypes.includes('melee_short') || weaponTypes.includes('sword')) return 'swordsman';
    if (weaponTypes.includes('shield')) return 'shield';
  }
  if (UNIT_ICON_SVGS[id]) return id;
  if (uStat?.isMounted || id.includes('cavalry') || id.includes('knight') || id.includes('rider')) return 'cavalry';
  if (uStat?.isRanged || id.includes('archer') || id.includes('bow') || id.includes('ranger')) return 'archer';
  if (id.includes('spear') || id.includes('pike') || id.includes('halberd') || id.includes('phalanx')) return 'spearman';
  if (uStat?.isHero || id.includes('hero')) return 'hero';
  return 'swordsman';
}

export function getUnitIconSvg(iconKey, uStat = null, unitId = '') {
  const key = (!iconKey || iconKey === 'auto') ? resolveAutoUnitIconKey(uStat, unitId) : iconKey;
  return UNIT_ICON_SVGS[key] || UNIT_ICON_SVGS[resolveAutoUnitIconKey(uStat, unitId)] || UNIT_ICON_SVGS.swordsman;
}

export function findCustomIconById(customIconsList, iconKey) {
  if (!iconKey || !Array.isArray(customIconsList)) return null;
  return customIconsList.find((c) => c && c.id === iconKey && c.dataUrl) || null;
}

/**
 * Resolves the visual representation for a unit icon slot ('recruit' | 'squad' | 'placeholder').
 * Always returns either an image dataUrl (`type: 'image'`) or a crisp SVG (`type: 'svg'`).
 */
export function resolveUnitSlotVisual(uStat, slotType = 'recruit', customIconsList = [], unitId = '') {
  const s = uStat || {};
  if (slotType === 'recruit') {
    if (s.recruitPortraitUrl) {
      return { type: 'image', url: s.recruitPortraitUrl, key: s.recruitIconKey || 'auto' };
    }
    const custom = findCustomIconById(customIconsList, s.recruitIconKey);
    if (custom) {
      return { type: 'image', url: custom.dataUrl, key: custom.id };
    }
    const effKey = (!s.recruitIconKey || s.recruitIconKey === 'auto')
      ? resolveAutoUnitIconKey(s, unitId)
      : s.recruitIconKey;
    return { type: 'svg', svg: getUnitIconSvg(effKey, s, unitId), key: s.recruitIconKey || 'auto', resolvedKey: effKey };
  }

  if (slotType === 'squad') {
    if (s.squadCardIconUrl) {
      return { type: 'image', url: s.squadCardIconUrl, key: s.squadCardIconKey || 'auto' };
    }
    const custom = findCustomIconById(customIconsList, s.squadCardIconKey);
    if (custom) {
      return { type: 'image', url: custom.dataUrl, key: custom.id };
    }
    const effKey = (!s.squadCardIconKey || s.squadCardIconKey === 'auto')
      ? resolveAutoUnitIconKey(s, unitId)
      : s.squadCardIconKey;
    return { type: 'svg', svg: getUnitIconSvg(effKey, s, unitId), key: s.squadCardIconKey || 'auto', resolvedKey: effKey };
  }

  // 'placeholder' (Map Ghost & 3D Flag Banner — supports Set 1 vs Set 2!)
  const isSet2 = slotType === 'placeholder_set2';
  const rawPhKey = isSet2 ? s.placeholderIconKeySet2 : s.placeholderIconKey;
  const rawPhUrl = isSet2 ? s.placeholderIconUrlSet2 : s.placeholderIconUrl;
  if (rawPhUrl) {
    return { type: 'image', url: rawPhUrl, key: rawPhKey || 'auto' };
  }
  const custom = findCustomIconById(customIconsList, rawPhKey);
  if (custom) {
    return { type: 'image', url: custom.dataUrl, key: custom.id };
  }
  const effKey = (!rawPhKey || rawPhKey === 'auto')
    ? resolveAutoUnitIconKey(s, unitId, s._activeWeaponTypes || null)
    : rawPhKey;
  return { type: 'svg', svg: getUnitIconSvg(effKey, s, unitId), key: rawPhKey || 'auto', resolvedKey: effKey };
}

export function renderUnitSlotPreviewInnerHtml(uStat, slotType = 'recruit', customIconsList = [], unitId = '') {
  const vis = resolveUnitSlotVisual(uStat, slotType, customIconsList, unitId);
  if (vis.type === 'image') {
    const fitCls = (slotType === 'placeholder' || slotType === 'placeholder_set2') ? 'w-9 h-9 object-contain p-0.5' : 'w-full h-full object-cover';
    return `<img src="${vis.url}" class="${fitCls}" alt="" />`;
  }
  return `<div class="w-8 h-8 flex items-center justify-center p-0.5">${vis.svg}</div>`;
}

/**
 * Renders a visual grid of clickable icon buttons (showing actual SVGs and custom uploaded icons, never English text)
 * so the user can pick any default or custom icon visually.
 */
export function renderVisualIconPickerGridHtml(
  slotType,
  selectedKey,
  uStat,
  customIconsList = [],
  unitId = '',
  attrPrefix = 'data-ub-pick-icon'
) {
  const curKey = selectedKey || 'auto';
  const autoSvg = getUnitIconSvg('auto', uStat, unitId);
  const items = [
    { key: 'auto', isAuto: true, html: `<div class="w-5 h-5">${autoSvg}</div>`, title: 'Auto Role Icon' },
    ...BUILT_IN_ICON_KEYS.map((k) => ({
      key: k,
      isAuto: false,
      html: `<div class="w-5 h-5">${UNIT_ICON_SVGS[k]}</div>`,
      title: k
    })),
    ...(Array.isArray(customIconsList) ? customIconsList : []).map((c) => ({
      key: c.id,
      isAuto: false,
      isCustom: true,
      url: c.dataUrl,
      html: `<img src="${c.dataUrl}" class="w-5 h-5 object-contain rounded" alt="" />`,
      title: c.label || c.id
    }))
  ];

  return `
    <div class="grid grid-cols-4 gap-1 mt-1 p-1 rounded bg-slate-950/90 border border-slate-800 max-h-28 overflow-y-auto">
      ${items
        .map((it) => {
          const active = curKey === it.key;
          return `
            <button
              type="button"
              ${attrPrefix}-slot="${slotType}"
              ${attrPrefix}-key="${it.key}"
              title="${it.title}"
              class="relative flex items-center justify-center h-7 rounded border transition cursor-pointer ${
                active
                  ? 'border-amber-400 bg-amber-500/25 shadow'
                  : 'border-slate-700/70 bg-slate-900 hover:bg-slate-800 hover:border-slate-500'
              }"
            >
              ${it.html}
              ${it.isAuto ? `<span class="absolute -bottom-0.5 -right-0.5 text-[7px] font-black bg-slate-900/90 text-amber-300 px-0.5 rounded">A</span>` : ''}
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}
