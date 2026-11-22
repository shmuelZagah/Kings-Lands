/**
 * Kings Lands — Top Economy & Population HUD Bar
 * (src/ui/hud/topResourceBar.js)
 *
 * Extracted from `WorkerPlacementController` in Stage 2.
 */

export class TopResourceBar {
  constructor() {
    this._cleanupLegacyHintsOnScreen();
    this._buildDom();
  }

  _cleanupLegacyHintsOnScreen() {
    document.querySelectorAll('div, span, p, li, aside, footer').forEach((el) => {
      if (
        el.children.length === 0 &&
        /left\s*click|right\s*click|legend|controls/i.test(el.textContent || '')
      ) {
        el.remove();
      }
    });
  }

  _buildDom() {
    const existing = document.getElementById('phase5-resource-bar');
    if (existing) existing.remove();

    this.rootEl = document.createElement('header');
    this.rootEl.id = 'phase5-resource-bar';
    this.rootEl.className =
      'pointer-events-none fixed top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-5 rounded-sm border border-amber-500/60 bg-slate-950/95 px-6 py-2 text-xs shadow-[0_8px_28px_rgba(0,0,0,0.92)] backdrop-blur-md select-none';
    this.rootEl.style.backgroundImage = "linear-gradient(rgba(6,10,18,0.72), rgba(6,10,18,0.82)), url('/assets/hud_resource_bar_bg.jpg')";
    this.rootEl.style.backgroundSize = 'cover';
    this.rootEl.style.backgroundPosition = 'center';

    this.rootEl.innerHTML = `
      <div class="flex items-center gap-1.5"><span class="text-amber-400 font-bold">Coins:</span><span id="res-coins" class="mono font-bold text-amber-200">1200</span></div>
      <div class="flex items-center gap-1.5"><span class="text-emerald-400 font-bold">Wood:</span><span id="res-wood" class="mono font-bold text-emerald-200">800</span></div>
      <div class="flex items-center gap-1.5"><span class="text-slate-300 font-bold">Stone:</span><span id="res-stone" class="mono font-bold text-slate-100">500</span></div>
      <div class="flex items-center gap-1.5"><span class="text-sky-400 font-bold">Iron:</span><span id="res-iron" class="mono font-bold text-sky-200">400</span></div>
      <div class="flex items-center gap-1.5 border-l border-slate-700 pl-3"><span class="text-teal-300 font-bold">Pop:</span><span id="res-pop" class="mono font-bold text-teal-100">0/100</span></div>
    `;
    document.body.appendChild(this.rootEl);

    this.coinsEl = this.rootEl.querySelector('#res-coins');
    this.woodEl = this.rootEl.querySelector('#res-wood');
    this.stoneEl = this.rootEl.querySelector('#res-stone');
    this.ironEl = this.rootEl.querySelector('#res-iron');
    this.popEl = this.rootEl.querySelector('#res-pop');
  }

  update(eco) {
    if (!eco) return;
    if (this.coinsEl) this.coinsEl.textContent = String(eco.coins);
    if (this.woodEl) this.woodEl.textContent = String(eco.wood);
    if (this.stoneEl) this.stoneEl.textContent = String(eco.stone);
    if (this.ironEl) this.ironEl.textContent = String(eco.iron);
    if (this.popEl) this.popEl.textContent = `${eco.popUsed}/${eco.popCap}`;
  }
}