/**
 * Pure tree/selection helpers and Blender-style Outliner + Add/Data workspace HTML renderer
 * for Building Parts in Studio Rig mode.
 * No Three.js or DOM globals required for the pure helper functions.
 */

import { isPartEffectivelyActive } from '../../data/buildingParts.js';
import {
  BUILDING_DETAIL_BUDGETS,
  DEFAULT_GLB_CATEGORIES,
  PRIMITIVE_SHAPES,
  getGlbLibraryCategories,
  normalizeGlbCategory,
  resolveBuildingGlbBudget
} from './buildingGlbLibrary.js';

export const RIG_COLLAPSE_STORAGE_KEY = 'kings_lands_studio_rig_collapsed';

export const PART_KIND_META = Object.freeze({
  model: { icon: '🧱', label: 'Model' },
  fire_point: { icon: '🏹', label: 'Fire point' },
  exit_point: { icon: '🚪', label: 'Exit point' },
  group: { icon: '📁', label: 'Group' }
});

export function escHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function isPartDeletable(part) {
  return Boolean(part && part.kind !== 'fire_point');
}

export function canAddExitPoint(parts) {
  return !(parts || []).some((p) => p?.kind === 'exit_point');
}

export function isPartAncestor(parts, ancestorId, nodeId) {
  if (!ancestorId || !nodeId) return false;
  const byId = new Map((parts || []).map((p) => [p.id, p]));
  let cur = byId.get(nodeId);
  for (let g = 0; cur && g < 40; g++) {
    if (cur.parent === ancestorId) return true;
    cur = cur.parent ? byId.get(cur.parent) : null;
  }
  return false;
}

/**
 * Returns true if setting `movingId.parent = targetParentId` would create a cycle or target an invalid parent.
 * `targetParentId === null` (Building body root) is always valid.
 */
export function wouldCreateParentLoop(parts, movingId, targetParentId) {
  if (!movingId) return true;
  if (!targetParentId) return false;
  if (movingId === targetParentId) return true;
  const target = (parts || []).find((p) => p?.id === targetParentId);
  if (!target || (target.kind !== 'group' && target.kind !== 'model')) return true;
  return isPartAncestor(parts, movingId, targetParentId);
}

/**
 * Given a set of selected part IDs, returns only the top-level IDs (no selected ancestor in the set),
 * so transforming a parent + child together via a temporary pivot never double-transforms children.
 */
export function topLevelSelectedPartIds(parts, selectedIds) {
  const sel = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  const out = [];
  const byId = new Map((parts || []).map((q) => [q.id, q]));
  for (const p of parts || []) {
    if (!sel.has(p.id)) continue;
    let hasSelectedAncestor = false;
    let cur = p.parent ? byId.get(p.parent) : null;
    for (let g = 0; cur && g < 40; g++) {
      if (sel.has(cur.id)) {
        hasSelectedAncestor = true;
        break;
      }
      cur = cur.parent ? byId.get(cur.parent) : null;
    }
    if (!hasSelectedAncestor) out.push(p.id);
  }
  return out;
}

export function isPartHiddenByEye(parts, part, hiddenIds) {
  if (!part || !hiddenIds || hiddenIds.size === 0) return false;
  const byId = new Map((parts || []).map((q) => [q.id, q]));
  let cur = part;
  for (let g = 0; cur && g < 40; g++) {
    if (hiddenIds.has(cur.id)) return true;
    cur = cur.parent ? byId.get(cur.parent) : null;
  }
  return false;
}

export function isPartLevelInRange(parts, part, level) {
  if (!part) return false;
  const lv = Math.max(1, Number(level) | 0 || 1);
  const byId = new Map((parts || []).map((q) => [q.id, q]));
  let cur = part;
  for (let g = 0; cur && g < 40; g++) {
    const inLv = lv >= (cur.minLevel || 1) && (cur.maxLevel == null || lv <= cur.maxLevel);
    if (!inLv) return false;
    cur = cur.parent ? byId.get(cur.parent) : null;
  }
  return true;
}

export function hasDisabledAncestor(parts, part) {
  if (!part?.parent) return false;
  const byId = new Map((parts || []).map((q) => [q.id, q]));
  let cur = byId.get(part.parent);
  for (let g = 0; cur && g < 40; g++) {
    if (cur.enabled === false) return true;
    cur = cur.parent ? byId.get(cur.parent) : null;
  }
  return false;
}

/**
 * Returns IDs of deletable parts NOT in `targetIds` that descend from any ID in `targetIds`.
 * `fire_point` parts are managed in Units & Buildings Lab and never marked for cascade deletion.
 */
export function collectUnselectedDescendantIds(parts, targetIds) {
  const targetSet = targetIds instanceof Set ? targetIds : new Set(targetIds || []);
  const out = [];
  for (const p of parts || []) {
    if (!p || p.kind === 'fire_point' || targetSet.has(p.id)) continue;
    for (const tid of targetSet) {
      if (isPartAncestor(parts, tid, p.id)) {
        out.push(p.id);
        break;
      }
    }
  }
  return out;
}

/**
 * Computes the next `parts` list after deleting `targetIds`.
 * Fire points (`kind === 'fire_point'`) are strictly protected:
 *  - Never deleted even if included in `targetIds` or descended from a deleted group.
 *  - Any surviving child whose parent is removed gets reparented up to the nearest surviving ancestor (or null).
 *
 * mode = 'delete_children' deletes non-fire-point descendants too;
 * mode = 'reparent_up' promotes direct surviving children to the nearest surviving ancestor (or null).
 */
export function computeDeleteOutcome(parts, targetIds, mode = 'reparent_up') {
  const cloned = JSON.parse(JSON.stringify(parts || []));
  const byId = new Map(cloned.map((p) => [p.id, p]));
  const rawTargets = targetIds instanceof Set ? targetIds : new Set(targetIds || []);
  const targetSet = new Set([...rawTargets].filter((id) => {
    const p = byId.get(id);
    return p && p.kind !== 'fire_point';
  }));

  if (targetSet.size === 0) {
    return { nextParts: cloned, deletedIds: [], reparented: [] };
  }

  let removedSet;
  if (mode === 'delete_children') {
    const descendants = collectUnselectedDescendantIds(cloned, targetSet);
    removedSet = new Set([...targetSet, ...descendants]);
  } else {
    removedSet = new Set(targetSet);
  }

  const reparented = [];
  for (const p of cloned) {
    if (removedSet.has(p.id)) continue;
    if (p.parent && removedSet.has(p.parent)) {
      const oldParent = p.parent;
      let nextParent = p.parent;
      for (let g = 0; nextParent && removedSet.has(nextParent) && g < 40; g++) {
        nextParent = byId.get(nextParent)?.parent || null;
      }
      if (nextParent && removedSet.has(nextParent)) nextParent = null;
      p.parent = nextParent || null;
      reparented.push({ id: p.id, oldParent, newParent: p.parent });
    }
  }

  return {
    nextParts: cloned.filter((p) => !removedSet.has(p.id)),
    deletedIds: [...removedSet],
    reparented
  };
}

/** Returns visible part IDs in tree order (skipping children inside collapsed nodes) for Shift-click range selection. */
export function getOrderedTreePartIds(parts, collapsedIds = null) {
  const collapsed = collapsedIds instanceof Set ? collapsedIds : new Set(collapsedIds || []);
  const byId = new Map((parts || []).map((p) => [p.id, p]));
  const childrenOf = new Map();
  const roots = [];
  for (const p of parts || []) {
    if (p.parent && byId.has(p.parent) && p.parent !== p.id) {
      if (!childrenOf.has(p.parent)) childrenOf.set(p.parent, []);
      childrenOf.get(p.parent).push(p);
    } else {
      roots.push(p);
    }
  }
  const ordered = [];
  const walk = (list) => {
    for (const p of list) {
      ordered.push(p.id);
      const kids = childrenOf.get(p.id);
      if (kids?.length && !collapsed.has(p.id)) walk(kids);
    }
  };
  walk(roots);
  return ordered;
}

export function resolveMultiSelectRange(orderedIds, anchorId, clickedId) {
  if (!orderedIds?.length) return clickedId ? [clickedId] : [];
  const i1 = orderedIds.indexOf(anchorId);
  const i2 = orderedIds.indexOf(clickedId);
  if (i1 < 0 || i2 < 0) return clickedId ? [clickedId] : [];
  const a = Math.min(i1, i2);
  const b = Math.max(i1, i2);
  return orderedIds.slice(a, b + 1);
}

export function computeMaxBuildingLevel(bDef, parts = [], previewLevel = 1) {
  const maxPartLv = Math.max(
    1,
    ...(parts || []).map((p) => Math.max(Number(p?.minLevel) || 1, Number(p?.maxLevel) || 1))
  );
  const baseMax = Math.max(
    bDef?.canAutoLevel ? Math.max(2, (bDef?.maxLevel | 0) || 3) : ((bDef?.maxLevel | 0) || 1),
    maxPartLv,
    previewLevel | 0 || 1
  );
  return Math.max(3, Math.min(10, baseMax));
}

function buildTargetParentOptionsHtml(parts, selectedTargetId) {
  const byId = new Map((parts || []).map((p) => [p.id, p]));
  const depthOf = (p) => {
    let d = 0;
    let cur = p;
    for (let g = 0; cur?.parent && g < 16; g++) {
      d++;
      cur = byId.get(cur.parent);
    }
    return d;
  };
  const validTarget = selectedTargetId && byId.get(selectedTargetId)
    && (byId.get(selectedTargetId).kind === 'group' || byId.get(selectedTargetId).kind === 'model')
    ? selectedTargetId
    : '';
  const opts = [`<option value="" ${validTarget === '' ? 'selected' : ''}>Building body (Root)</option>`];
  for (const p of parts || []) {
    if (p.kind !== 'group' && p.kind !== 'model') continue;
    const indent = '\u00A0\u00A0'.repeat(depthOf(p));
    const icon = p.kind === 'group' ? '📁' : '🧱';
    opts.push(`<option value="${escHtml(p.id)}" ${validTarget === p.id ? 'selected' : ''}>${indent}${icon} ${escHtml(p.name || p.id)}</option>`);
  }
  return opts.join('');
}

const EYE_OPEN_SVG = `<svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4z"/><circle cx="8" cy="8" r="2"/></svg>`;
const EYE_OFF_SVG = `<svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 2l12 12M4.4 4.5C2.6 5.7 1.5 8 1.5 8s2.4 4 6.5 4c1.5 0 2.8-.4 3.9-1.1M7 4.1c.3 0 .6-.1 1-.1 4.1 0 6.5 4 6.5 4s-.9 1.6-2.4 2.8"/></svg>`;

function renderTransformGridHtml(tr) {
  const pos = tr?.pos || [0, 0, 0];
  const rotDeg = tr?.rotDeg || [0, 0, 0];
  const scale = tr?.scale || [1, 1, 1];
  const axes = [
    { label: 'X', cls: 'text-rose-400' },
    { label: 'Y', cls: 'text-emerald-400' },
    { label: 'Z', cls: 'text-sky-400' }
  ];
  const row = (group, title, vals, step, dec) => `
    <div class="grid grid-cols-[54px_1fr_1fr_1fr] items-center gap-1">
      <span class="text-[10px] font-semibold text-slate-400">${title}</span>
      ${axes.map((a, i) => `
        <label class="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1 py-0.5">
          <span class="text-[10px] font-bold ${a.cls}">${a.label}</span>
          <input type="number" step="${step}" data-rig-tr="${group}" data-axis="${i}" value="${Number(vals[i] || 0).toFixed(dec)}" class="w-full min-w-0 bg-transparent text-[11px] text-slate-100 mono focus:outline-none" />
        </label>
      `).join('')}
    </div>`;
  return `
    <div class="flex flex-col gap-1 border-t border-slate-800 pt-2 mt-1">
      <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Transform (synced with Inspector)</div>
      ${row('pos', 'Position', pos, '0.05', 3)}
      ${row('rot', 'Rot (°)', rotDeg, '1', 1)}
      ${row('scl', 'Scale', scale, '0.05', 3)}
    </div>`;
}

export function renderBuildingRigPanelHtml({
  unitId,
  unitDef,
  bDef,
  socketNames = [],
  parts = [],
  previewLevel = 1,
  selectedSocketName = 'torso',
  selectedPartIds = new Set(),
  hiddenPartIds = new Set(),
  collapsedNodes = new Set(),
  rigCollapsed = false,
  renamingPartId = null,
  rigRightTab = 'add',
  rigAddSubTab = 'primitives',
  rigImportSubTab = 'new',
  rigTargetParentId = null,
  rigPrimColor = '#94a3b8',
  rigImportState = {},
  glbLibrary = [],
  rigLibCategoryFilter = 'All',
  selectedTransform = null
}) {
  const maxLv = computeMaxBuildingLevel(bDef, parts, previewLevel);
  const curLv = Math.max(1, Math.min(maxLv, previewLevel || 1));

  if (rigCollapsed) {
    return `
      <div id="st-rig-header" class="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-1 h-8 bg-slate-900">
        <button type="button" id="st-rig-collapse" aria-expanded="false" class="inline-flex items-center gap-1.5 rounded border border-slate-600 bg-slate-800 hover:bg-slate-700 px-2.5 py-0.5 text-[11px] font-bold text-rose-300 cursor-pointer" title="Expand Rig & Parts panel">
          <span>▸</span>
          <span>RIG &amp; PARTS</span>
          <span class="text-[10px] font-normal text-slate-400">(${parts.length})</span>
        </button>
        <span class="text-[10px] font-semibold text-sky-300/80">Lv ${curLv} · Collapsed</span>
      </div>
      <div id="st-rig-body" class="hidden"></div>`;
  }

  const exitDisabled = !canAddExitPoint(parts);
  const labels = unitDef?.jointLabels || {
    pelvis: 'Foundation',
    torso: 'Building body',
    arm_L: 'Door leaf L',
    arm_R: 'Door leaf R'
  };
  const bodySet = new Set(socketNames);
  const byId = new Map((parts || []).map((p) => [p.id, p]));
  const childrenOf = new Map();
  const rootParts = [];
  for (const p of parts || []) {
    if (p.parent && byId.has(p.parent) && p.parent !== p.id) {
      if (!childrenOf.has(p.parent)) childrenOf.set(p.parent, []);
      childrenOf.get(p.parent).push(p);
    } else {
      rootParts.push(p);
    }
  }

  const selPartsSet = selectedPartIds instanceof Set ? selectedPartIds : new Set(selectedPartIds || []);
  const singleSelectedPart = selPartsSet.size <= 1 ? (parts.find((p) => p.id === (selPartsSet.size === 1 ? [...selPartsSet][0] : selectedSocketName)) || null) : null;
  const multiCount = selPartsSet.size > 1 ? selPartsSet.size : 0;

  const renderJointRow = (jointId, depth, { isTorso = false, hasKids = false } = {}) => {
    const active = selPartsSet.size === 0 && selectedSocketName === jointId;
    const isCollapsed = collapsedNodes.has(jointId);
    const label = labels[jointId] || jointId;
    const dropAttr = isTorso ? 'data-part-drop="torso"' : '';
    return `<div class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${active ? 'bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/70' : 'text-slate-200 hover:bg-slate-800/70'}" style="padding-left:${depth * 14 + 4}px" ${dropAttr}>
      ${hasKids
        ? `<button type="button" class="w-4 h-4 flex items-center justify-center rounded text-[10px] text-slate-400 hover:text-white cursor-pointer" data-outliner-toggle="${escHtml(jointId)}" aria-expanded="${!isCollapsed}" aria-label="Toggle ${escHtml(label)}">${isCollapsed ? '▸' : '▾'}</button>`
        : '<span class="w-4 shrink-0"></span>'}
      <span class="shrink-0 text-[11px]" aria-hidden="true">${isTorso ? '🏛' : jointId === 'pelvis' ? '🪨' : '🚪'}</span>
      <button type="button" class="rig-part flex-1 min-w-0 truncate text-left font-semibold cursor-pointer ${active ? 'text-rose-200' : 'text-slate-200'}" data-joint="${escHtml(jointId)}">${escHtml(label)}</button>
    </div>`;
  };

  const renderPartRow = (p, depth) => {
    const kids = childrenOf.get(p.id) || [];
    const hasKids = kids.length > 0;
    const isCollapsed = collapsedNodes.has(p.id);
    const isSelected = selPartsSet.size > 0 ? selPartsSet.has(p.id) : selectedSocketName === p.id;
    const effectiveActive = isPartEffectivelyActive(parts, p, curLv);
    const selfHidden = hiddenPartIds.has(p.id);
    const eyeHidden = isPartHiddenByEye(parts, p, hiddenPartIds);
    const greyed = !effectiveActive || eyeHidden;
    const meta = PART_KIND_META[p.kind] || PART_KIND_META.model;
    const canDropInto = p.kind === 'group' || p.kind === 'model';
    const isRenaming = renamingPartId === p.id;
    const isFirePoint = p.kind === 'fire_point';
    const levelBadge = !isPartLevelInRange(parts, p, curLv)
      ? `<span class="rounded bg-slate-800 px-1 py-0.2 text-[9px] text-slate-400 mono">Lv${p.minLevel || 1}${p.maxLevel != null ? '-' + p.maxLevel : '+'}</span>`
      : '';

    const rowCls = isSelected
      ? 'bg-amber-500/20 text-amber-100 ring-1 ring-amber-400/80'
      : greyed
        ? 'text-slate-500 hover:bg-slate-800/50'
        : 'text-slate-200 hover:bg-slate-800/70';

    const rowActionHtml = isFirePoint
      ? `<span class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-amber-400/85 text-[11px] cursor-help" data-fire-point-lock="${escHtml(p.id)}" title="Managed in Units &amp; Buildings Lab" aria-label="Managed in Units &amp; Buildings Lab">🔒</span>`
      : `<button type="button" data-part-delete="${escHtml(p.id)}" class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-rose-400 hover:bg-rose-500/20 hover:text-rose-200 font-bold cursor-pointer" aria-label="Delete ${escHtml(p.name || p.id)}" title="Delete ${escHtml(p.name || p.id)}">✕</button>`;

    const rowHtml = `<div class="outliner-part-row flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors ${rowCls} ${p.enabled === false ? 'opacity-60' : ''}" style="padding-left:${depth * 14 + 4}px" draggable="${isRenaming ? 'false' : 'true'}" data-part-drag="${escHtml(p.id)}" ${canDropInto ? `data-part-drop="${escHtml(p.id)}"` : ''}>
      ${hasKids
        ? `<button type="button" class="w-4 h-4 flex items-center justify-center rounded text-[10px] text-slate-400 hover:text-white cursor-pointer" data-outliner-toggle="${escHtml(p.id)}" aria-expanded="${!isCollapsed}" aria-label="Toggle ${escHtml(p.name || p.id)}">${isCollapsed ? '▸' : '▾'}</button>`
        : '<span class="w-4 shrink-0"></span>'}
      <span class="shrink-0 text-[11px]" aria-hidden="true">${meta.icon}</span>
      ${isRenaming
        ? `<input type="text" data-part-rename-input="${escHtml(p.id)}" value="${escHtml(p.name || p.id)}" class="flex-1 min-w-0 rounded border border-sky-400 bg-slate-950 px-1 py-0 text-[11px] text-slate-100" aria-label="Rename ${escHtml(p.name || p.id)}" />`
        : `<button type="button" class="outliner-part-btn flex-1 min-w-0 truncate text-left font-medium cursor-pointer ${greyed && !isSelected ? 'text-slate-500' : ''}" data-part-select="${escHtml(p.id)}" title="${escHtml(p.name || p.id)} (${meta.label}) — double-click to rename">${escHtml(p.name || p.id)}</button>`}
      ${levelBadge}
      <input type="checkbox" data-part-enabled="${escHtml(p.id)}" ${p.enabled === false ? '' : 'checked'} class="h-3.5 w-3.5 accent-emerald-400 cursor-pointer shrink-0" title="Enabled in game (saved)" aria-label="Enable ${escHtml(p.name || p.id)}" />
      <button type="button" data-part-eye="${escHtml(p.id)}" class="flex h-5 w-5 shrink-0 items-center justify-center rounded ${selfHidden ? 'text-slate-600 bg-slate-800/60' : 'text-sky-300 hover:bg-slate-800'} cursor-pointer" aria-label="Toggle viewport visibility for ${escHtml(p.name || p.id)}" aria-pressed="${!selfHidden}" title="${selfHidden ? 'Show in viewport (view only)' : 'Hide in viewport (view only)'}">${selfHidden ? EYE_OFF_SVG : EYE_OPEN_SVG}</button>
      ${rowActionHtml}
    </div>`;

    if (!hasKids || isCollapsed) return rowHtml;
    return rowHtml + kids.map((k) => renderPartRow(k, depth + 1)).join('');
  };

  // Tree rows: Foundation (pelvis) -> Building body (torso) -> [Door leaf L, Door leaf R, root parts...]
  const treeRows = [];
  const hasTorso = bodySet.has('torso');
  const doorJoints = ['arm_L', 'arm_R'].filter((j) => bodySet.has(j));
  const torsoHasKids = doorJoints.length > 0 || rootParts.length > 0;
  if (bodySet.has('pelvis')) {
    treeRows.push(renderJointRow('pelvis', 0, { hasKids: hasTorso }));
  }
  if (hasTorso && !collapsedNodes.has('pelvis')) {
    const torsoDepth = bodySet.has('pelvis') ? 1 : 0;
    treeRows.push(renderJointRow('torso', torsoDepth, { isTorso: true, hasKids: torsoHasKids }));
    if (!collapsedNodes.has('torso')) {
      for (const dj of doorJoints) treeRows.push(renderJointRow(dj, torsoDepth + 1));
      for (const rp of rootParts) treeRows.push(renderPartRow(rp, torsoDepth + 1));
    }
  } else if (!hasTorso) {
    for (const rp of rootParts) treeRows.push(renderPartRow(rp, 0));
  }

  // Right Side Panel: Add vs Data tabs
  const activeTab = rigRightTab === 'data' ? 'data' : 'add';
  const activeAddSub = rigAddSubTab === 'import' ? 'import' : 'primitives';
  const activeImpSub = rigImportSubTab === 'existing' ? 'existing' : 'new';

  const targetParentOptionsHtml = buildTargetParentOptionsHtml(parts, rigTargetParentId);
  const allCategories = getGlbLibraryCategories(glbLibrary);
  const impDetail = rigImportState?.detail || 'medium';
  const impCustom = rigImportState?.custom ?? '';
  const impBudget = resolveBuildingGlbBudget(impDetail, impCustom);
  const impCat = normalizeGlbCategory(rigImportState?.category || 'General');
  const impNewCat = rigImportState?.newCategory ?? '';
  const impFitSize = rigImportState?.fitSize ?? 4;
  const impFileName = rigImportState?.fileName || '';
  const impFileSize = rigImportState?.fileSize || 0;
  const impName = rigImportState?.name || '';

  const filterCat = rigLibCategoryFilter || 'All';
  const filteredLib = (glbLibrary || []).filter(
    (item) => filterCat === 'All' || normalizeGlbCategory(item.category).toLowerCase() === filterCat.toLowerCase()
  );

  let dataPanelHtml = '';
  if (multiCount > 1) {
    const selList = parts.filter((p) => selPartsSet.has(p.id));
    const deletableCount = selList.filter((p) => p.kind !== 'fire_point').length;
    const minValues = new Set(selList.map((p) => p.minLevel ?? 1));
    const maxValues = new Set(selList.map((p) => (p.maxLevel == null ? '' : String(p.maxLevel))));
    const commonMin = minValues.size === 1 ? [...minValues][0] : '';
    const commonMax = maxValues.size === 1 ? [...maxValues][0] : '';
    dataPanelHtml = `<div class="rounded-lg border border-amber-500/40 bg-slate-950/70 p-2.5 flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <span class="font-bold text-amber-300">${multiCount} parts selected</span>
        ${deletableCount > 0
          ? `<button type="button" data-multi-delete="1" class="rounded border border-rose-500/60 bg-rose-500/15 px-2.5 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/30 cursor-pointer">Delete selected (${deletableCount})</button>`
          : `<span class="text-[10px] text-amber-300/85">🔒 Fire points managed in Units &amp; Buildings Lab</span>`}
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" data-multi-enable="1" class="rounded border border-emerald-500/50 bg-emerald-500/15 px-2 py-1 font-semibold text-emerald-200 hover:bg-emerald-500/25 cursor-pointer">Enable all</button>
        <button type="button" data-multi-disable="1" class="rounded border border-slate-600 bg-slate-800 px-2 py-1 font-semibold text-slate-300 hover:bg-slate-700 cursor-pointer">Disable all</button>
        <label class="flex items-center gap-1 text-slate-400">minLevel<input id="st-multi-min-lv" type="number" min="1" step="1" value="${escHtml(commonMin)}" placeholder="—" class="w-16 rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-slate-100" /></label>
        <label class="flex items-center gap-1 text-slate-400">maxLevel<input id="st-multi-max-lv" type="number" min="1" step="1" value="${escHtml(commonMax)}" placeholder="none" class="w-16 rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-slate-100" /></label>
        <button type="button" data-multi-apply-levels="1" class="rounded bg-sky-600 hover:bg-sky-500 px-2 py-1 font-bold text-slate-950 cursor-pointer">Apply levels</button>
      </div>
      ${selectedTransform ? renderTransformGridHtml(selectedTransform) : ''}
    </div>`;
  } else if (singleSelectedPart) {
    const sel = singleSelectedPart;
    const meta = PART_KIND_META[sel.kind] || PART_KIND_META.model;
    const num = (f, v, step = 1, extra = '') =>
      `<label class="flex items-center gap-1 text-slate-400">${f}<input data-part-field="${f}" type="number" step="${step}" ${extra} value="${v ?? ''}" class="w-16 rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-slate-100"></label>`;
    const primShape = sel.model?.type === 'primitive' ? (sel.model.primitive?.shape || sel.model.ref || 'box') : null;
    const primColor = sel.model?.primitive?.color || '#94a3b8';
    const isFire = sel.kind === 'fire_point';
    dataPanelHtml = `<div class="rounded-lg border border-slate-700 bg-slate-950/70 p-2.5 flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-bold text-amber-300">${meta.icon} ${escHtml(sel.kind)}</span>
        <label class="flex items-center gap-1 text-slate-400">Name<input data-part-field="name" type="text" value="${escHtml(sel.name || '')}" class="w-32 rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-slate-100"></label>
        ${num('minLevel', sel.minLevel, 1, 'min="1"')}
        ${num('maxLevel', sel.maxLevel, 1, 'min="1" placeholder="none"')}
        <label class="flex items-center gap-1 text-slate-300 cursor-pointer"><input data-part-field="enabled" type="checkbox" ${sel.enabled === false ? '' : 'checked'} class="accent-emerald-400"> enabled</label>
        ${sel.model?.type === 'glb' ? `${num('fitSize', sel.model.fitSize, 0.1, 'min="0.1"')}<span class="text-slate-500">size (m)</span>` : ''}
        ${sel.model?.type === 'primitive' && sel.model?.primitive ? `<label class="flex items-center gap-1 text-slate-400">Color<input data-part-color="1" type="color" value="${escHtml(primColor)}" class="h-5 w-7 rounded border border-slate-600 bg-slate-800 cursor-pointer" /></label><span class="text-[10px] text-slate-500">(${escHtml(primShape)})</span>` : ''}
        ${isFire
          ? `<span class="ml-auto text-[10px] text-amber-300/85" title="Managed in Units &amp; Buildings Lab">🔒 Managed in Units &amp; Buildings Lab</span>`
          : `<button type="button" class="ml-auto rounded border border-rose-500/50 bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/20 cursor-pointer" data-part-delete="${escHtml(sel.id)}">Delete</button>`}
      </div>
      ${renderTransformGridHtml(selectedTransform || { pos: sel.pos, rotDeg: (sel.rot || [0, 0, 0]).map((r) => r * 180 / Math.PI), scale: sel.scale })}
    </div>`;
  } else if (bodySet.has(selectedSocketName)) {
    const jLabel = labels[selectedSocketName] || selectedSocketName;
    dataPanelHtml = `<div class="rounded-lg border border-slate-700 bg-slate-950/70 p-2.5 flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <span class="font-bold text-rose-300">🏛 ${escHtml(jLabel)}</span>
        <span class="text-[10px] text-slate-400">(${escHtml(selectedSocketName)})</span>
      </div>
      ${selectedTransform ? renderTransformGridHtml(selectedTransform) : ''}
    </div>`;
  } else {
    dataPanelHtml = `<div class="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5 text-slate-400">Select a part in the Outliner or viewport to edit its properties.</div>`;
  }

  const structBtn = (k, label) => {
    const disabled = k === 'exit_point' && exitDisabled;
    return `<button type="button" data-part-add="${k}" ${disabled ? 'disabled title="A building has at most one exit point"' : ''} class="rounded border px-2 py-0.5 text-[11px] font-semibold ${disabled ? 'border-slate-700 bg-slate-800/60 text-slate-500 cursor-not-allowed opacity-60' : 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 cursor-pointer'}">${label}</button>`;
  };

  const primPanelHtml = `
    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span class="text-slate-400">Click a shape to spawn it under the target Group:</span>
        <label class="flex items-center gap-1.5 text-slate-300">
          <span>Color</span>
          <input id="st-rig-prim-color" type="color" value="${escHtml(rigPrimColor)}" class="h-6 w-8 rounded border border-slate-600 bg-slate-900 cursor-pointer" />
        </label>
      </div>
      <div class="grid grid-cols-3 gap-1.5">
        ${PRIMITIVE_SHAPES.map((s) => `
          <button type="button" data-add-primitive="${escHtml(s.shape)}" class="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900/90 hover:border-emerald-400/70 hover:bg-slate-800 px-2 py-1.5 text-left text-[11px] font-semibold text-slate-200 cursor-pointer transition-colors">
            <span class="text-sm leading-none">${s.icon}</span>
            <span class="truncate">${escHtml(s.label)}</span>
          </button>
        `).join('')}
      </div>
    </div>`;

  const newImportHtml = `
    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-1.5">
        <button type="button" id="st-rig-imp-pick" class="rounded bg-sky-600 hover:bg-sky-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 cursor-pointer">Choose .glb…</button>
        <span class="min-w-0 flex-1 truncate text-[11px] ${impFileName ? 'text-emerald-300 font-semibold' : 'text-slate-500'}">${impFileName ? `${escHtml(impFileName)} (${(impFileSize / 1048576).toFixed(2)} MB)` : 'No .glb file selected'}</span>
        <input id="st-part-glb" type="file" accept=".glb,model/gltf-binary" class="hidden" />
      </div>
      <div class="grid grid-cols-2 gap-1.5 text-[11px]">
        <label class="flex flex-col gap-0.5 text-slate-400">Name
          <input id="st-rig-imp-name" type="text" value="${escHtml(impName)}" placeholder="${escHtml(impFileName ? impFileName.replace(/\.[^.]+$/, '') : 'e.g. Watch Roof')}" class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100" />
        </label>
        <label class="flex flex-col gap-0.5 text-slate-400">Size (m)
          <input id="st-rig-imp-size" type="number" step="0.1" min="0.1" value="${escHtml(impFitSize)}" class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100" />
        </label>
        <label class="flex flex-col gap-0.5 text-slate-400">Asset Category
          <select id="st-rig-imp-category" class="rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-slate-100">
            ${allCategories.map((c) => `<option value="${escHtml(c)}" ${c === impCat && !impNewCat ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
            <option value="__new__" ${impNewCat ? 'selected' : ''}>+ New category…</option>
          </select>
        </label>
        <label class="flex flex-col gap-0.5 text-slate-400">Custom Category (optional)
          <input id="st-rig-imp-new-cat" type="text" value="${escHtml(impNewCat)}" placeholder="Type new category…" class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100" />
        </label>
      </div>
      <div class="rounded border border-slate-800 bg-slate-950/60 p-1.5 flex flex-col gap-1">
        <div class="flex items-center justify-between text-[10px]">
          <span class="font-bold text-amber-300">Detail kit (polygon reduction)</span>
          <span class="text-slate-400">Budget: <b class="text-slate-200">${impBudget.toLocaleString()}</b> tris</span>
        </div>
        <div class="flex flex-wrap items-center gap-1">
          ${['low', 'medium', 'high'].map((d) => `
            <button type="button" data-rig-imp-detail="${d}" class="flex-1 rounded px-1.5 py-0.5 text-[10px] font-bold cursor-pointer ${!impCustom && impDetail === d ? 'bg-amber-400 text-slate-950' : 'border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'}">${d[0].toUpperCase() + d.slice(1)} · ${BUILDING_DETAIL_BUDGETS[d].toLocaleString()}</button>
          `).join('')}
          <input id="st-rig-imp-custom" type="number" min="200" step="100" value="${escHtml(impCustom)}" placeholder="Custom tris" class="w-24 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-100" title="Custom triangle budget" />
        </div>
      </div>
      <button type="button" id="st-rig-imp-go" ${impFileName ? '' : 'disabled'} class="rounded px-3 py-1.5 text-[11px] font-extrabold ${impFileName ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}">Import &amp; Add to Building</button>
    </div>`;

  const existingLibraryHtml = `
    <div class="flex flex-col gap-1.5">
      <div class="flex flex-wrap items-center gap-1">
        ${['All', ...allCategories].map((c) => `
          <button type="button" data-lib-cat="${escHtml(c)}" class="rounded px-2 py-0.5 text-[10px] font-bold cursor-pointer ${filterCat === c ? 'bg-amber-400 text-slate-950' : 'border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'}">${escHtml(c)}</button>
        `).join('')}
      </div>
      ${filteredLib.length
        ? `<div class="grid grid-cols-2 gap-1.5 max-h-32 overflow-y-auto pr-0.5">
            ${filteredLib.map((item) => `
              <div class="flex items-center gap-1 rounded border border-slate-700 bg-slate-950/75 hover:border-sky-400/70 p-1">
                <button type="button" data-lib-add="${escHtml(item.id)}" class="flex-1 min-w-0 text-left cursor-pointer" title="Add ${escHtml(item.name)} to building">
                  <div class="truncate text-[11px] font-semibold text-slate-100">🧱 ${escHtml(item.name)}</div>
                  <div class="truncate text-[9px] text-slate-400">${escHtml(item.category)}${item.triangles ? ` · ${item.triangles.toLocaleString()} tris` : ''} · ${Number(item.fitSize || 4).toFixed(1)}m</div>
                </button>
                <button type="button" data-lib-del="${escHtml(item.id)}" class="h-5 w-5 shrink-0 flex items-center justify-center rounded text-[10px] font-bold text-rose-400 hover:bg-rose-500/20 cursor-pointer" title="Remove from reusable library">✕</button>
              </div>
            `).join('')}
          </div>`
        : `<div class="rounded border border-slate-800 bg-slate-950/50 p-2 text-[11px] text-slate-400">No saved .glb models in <b>${escHtml(filterCat)}</b> yet. Use <b>New Import</b> to add one!</div>`}
    </div>`;

  const importPanelHtml = `
    <div class="flex flex-col gap-2">
      <div class="flex gap-1 border-b border-slate-800 pb-1">
        <button type="button" data-rig-imp-sub="new" class="rounded px-2.5 py-0.5 text-[11px] font-bold cursor-pointer ${activeImpSub === 'new' ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}">New Import</button>
        <button type="button" data-rig-imp-sub="existing" class="rounded px-2.5 py-0.5 text-[11px] font-bold cursor-pointer ${activeImpSub === 'existing' ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}">Existing (${glbLibrary.length})</button>
      </div>
      ${activeImpSub === 'existing' ? existingLibraryHtml : newImportHtml}
    </div>`;

  const addPanelHtml = `
    <div class="flex flex-col gap-2 rounded-lg border border-slate-700 bg-slate-950/60 p-2">
      <div class="flex flex-wrap items-center gap-1.5 border-b border-slate-800 pb-1.5">
        <label class="flex items-center gap-1 text-[11px] text-slate-300 min-w-0 flex-1">
          <span class="shrink-0 text-slate-400">Target Group:</span>
          <select id="st-rig-target-parent" data-rig-target-parent="1" class="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-100">
            ${targetParentOptionsHtml}
          </select>
        </label>
        ${structBtn('group', '+ Group')}
        ${structBtn('exit_point', '+ Exit point')}
      </div>
      <div class="flex gap-1">
        <button type="button" data-rig-add-sub="primitives" class="flex-1 rounded py-1 text-[11px] font-bold cursor-pointer ${activeAddSub === 'primitives' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700'}">Primitives</button>
        <button type="button" data-rig-add-sub="import" class="flex-1 rounded py-1 text-[11px] font-bold cursor-pointer ${activeAddSub === 'import' ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700'}">Import (.glb)</button>
      </div>
      ${activeAddSub === 'import' ? importPanelHtml : primPanelHtml}
    </div>`;

  return `
    <div id="st-rig-header" class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-1.5 bg-slate-900">
      <div class="flex items-center gap-2">
        <button type="button" id="st-rig-collapse" aria-expanded="true" class="inline-flex items-center gap-1.5 rounded border border-slate-600 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 font-bold text-rose-300 cursor-pointer" title="Collapse Rig &amp; Parts panel">
          <span>▾</span>
          <span>RIG &amp; PARTS</span>
          <span class="text-[10px] font-normal text-slate-400">(${parts.length})</span>
        </button>
        <label class="flex items-center gap-1.5 text-sky-300 font-semibold">
          <span>Level:</span>
          <select id="st-rig-bld-lv-select" aria-label="Building preview level" class="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] font-bold text-sky-300">
            ${Array.from({ length: maxLv }, (_, idx) => {
              const lv = idx + 1;
              return `<option value="${lv}" ${lv === curLv ? 'selected' : ''}>Level ${lv}${lv === 1 ? ' (Base)' : ''}</option>`;
            }).join('')}
          </select>
        </label>
      </div>
      <span class="text-[10px] text-slate-400 hidden sm:inline">Drag rows onto 📁 Group or Building body · Delete key removes selected</span>
    </div>
    <div id="st-rig-body" class="max-h-[38vh] overflow-y-auto px-4 py-2">
      <div class="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(280px,1.05fr)_minmax(320px,1.15fr)] items-start">
        <div id="st-outliner-tree" class="rounded-lg border border-slate-700 bg-slate-950/75 p-1.5 max-h-60 overflow-y-auto flex flex-col gap-0.5" role="tree" aria-label="Building Outliner">
          ${treeRows.join('')}
        </div>
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center gap-1.5 border-b border-slate-800 pb-1">
            <button type="button" data-rig-tab="add" class="rounded px-3 py-1 text-[11px] font-bold cursor-pointer ${activeTab === 'add' ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}">Add</button>
            <button type="button" data-rig-tab="data" class="rounded px-3 py-1 text-[11px] font-bold cursor-pointer ${activeTab === 'data' ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}">Data</button>
            ${activeTab === 'data'
              ? `<button type="button" data-rig-back-add="1" class="ml-auto rounded border border-sky-500/50 bg-sky-500/15 hover:bg-sky-500/25 px-2.5 py-1 text-[11px] font-bold text-sky-200 cursor-pointer">← Back to Add</button>`
              : ''}
          </div>
          ${activeTab === 'data' ? dataPanelHtml : addPanelHtml}
        </div>
      </div>
    </div>`;
}
