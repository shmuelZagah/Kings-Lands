/**
 * Kings Lands — Victory / Defeat Summary Modal
 * (src/ui/hud/victoryScreenModal.js)
 */

export class VictoryScreenModal {
  constructor({ simBridge, synthAudio }) {
    this.simBridge = simBridge;
    this.synthAudio = synthAudio;

    this._dismissedVictoryModal = false;
    this._lastOutcomeKey = '';
    this._buildDom();
  }

  _buildDom() {
    const existingBanner = document.getElementById('phase7-status-banner');
    if (existingBanner) existingBanner.remove();
    const existingModal = document.getElementById('phase7-victory-modal');
    if (existingModal) existingModal.remove();

    this.modalEl = document.createElement('div');
    this.modalEl.id = 'phase7-victory-modal';
    this.modalEl.className =
      'fixed inset-0 z-50 hidden flex items-center justify-center bg-slate-950/80 backdrop-blur-md select-none';
    this.modalEl.innerHTML = `
      <div class="relative w-[460px] max-w-[92vw] rounded-3xl border-2 border-amber-400/80 bg-slate-900/95 p-7 text-center shadow-[0_24px_64px_rgba(0,0,0,0.95),inset_0_0_32px_rgba(251,191,36,0.18)]">
        <img src="/assets/hud_victory_emblem.jpg" alt="Kings Lands Crest" class="mx-auto mb-3 w-20 h-20 rounded-full border-2 border-amber-400/80 object-cover shadow-[0_0_24px_rgba(251,191,36,0.35)]" />
        <div id="vm-badge" class="mx-auto mb-3 inline-flex items-center gap-2 rounded-full border border-amber-400/50 bg-amber-500/15 px-4 py-1 text-xs font-extrabold uppercase tracking-widest text-amber-300">
          Battle Concluded
        </div>
        <h2 id="vm-title" class="text-4xl font-black uppercase tracking-wider text-amber-300 drop-shadow-[0_2px_10px_rgba(251,191,36,0.45)]">
          VICTORY
        </h2>
        <p id="vm-subtitle" class="mt-2 text-sm font-medium text-slate-300">
          All enemy production strongholds and builders have been vanquished!
        </p>

        <div id="vm-stats" class="mt-5 grid grid-cols-3 gap-2.5 rounded-2xl border border-slate-800 bg-slate-950/90 p-3.5 text-left mono">
        </div>

        <div class="mt-6 flex items-center justify-center gap-3">
          <button
            id="vm-btn-restart"
            type="button"
            class="rounded-xl border-2 border-amber-400 bg-amber-500/25 hover:bg-amber-500/40 px-5 py-2.5 text-xs font-extrabold uppercase tracking-wider text-amber-200 shadow-lg cursor-pointer transition"
          >
            New Battle
          </button>
          <button
            id="vm-btn-spectate"
            type="button"
            class="rounded-xl border border-slate-700 bg-slate-800/90 hover:bg-slate-700 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-300 cursor-pointer transition"
          >
            Continue Spectating
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(this.modalEl);

    this.modalEl.querySelector('#vm-btn-restart')?.addEventListener('click', () => {
      window.location.reload();
    });
    this.modalEl.querySelector('#vm-btn-spectate')?.addEventListener('click', () => {
      this._dismissedVictoryModal = true;
      this.modalEl.classList.add('hidden');
    });
  }

  update() {
    const victory = this.simBridge.getVictoryState?.();
    if (!victory) return;

    const res = victory.matchResult;
    if (res && !this._dismissedVictoryModal) {
      const key = `${res.outcome}:${res.finishedTick}`;
      if (key !== this._lastOutcomeKey) {
        this._lastOutcomeKey = key;
        const isWin = res.outcome === 'VICTORY';
        const eco = this.simBridge.getEconomyState?.() || {};

        const titleEl = this.modalEl.querySelector('#vm-title');
        const subEl = this.modalEl.querySelector('#vm-subtitle');
        const badgeEl = this.modalEl.querySelector('#vm-badge');
        const statsEl = this.modalEl.querySelector('#vm-stats');

        if (titleEl) {
          titleEl.textContent = isWin ? '🏆 VICTORY' : '💀 DEFEAT';
          titleEl.className = isWin
            ? 'text-4xl font-black uppercase tracking-wider text-amber-300 drop-shadow-[0_2px_10px_rgba(251,191,36,0.45)]'
            : 'text-4xl font-black uppercase tracking-wider text-rose-400 drop-shadow-[0_2px_10px_rgba(244,63,94,0.45)]';
        }
        if (badgeEl) {
          badgeEl.textContent = isWin ? 'Total Dominion' : 'Kingdom Fallen';
        }
        if (subEl) {
          subEl.textContent = isWin
            ? 'All enemy production strongholds and workers were eliminated!'
            : 'Your kingdom lost all production buildings and workers.';
        }
        if (statsEl) {
          const secs = Math.round((res.finishedTick || 0) / 20);
          const mins = Math.floor(secs / 60);
          const remSecs = String(secs % 60).padStart(2, '0');
          statsEl.innerHTML = `
            <div>
              <div class="text-[10px] text-slate-400 uppercase">Survivors</div>
              <div class="text-sm font-extrabold text-sky-300">${eco.popUsed || 0} Units</div>
            </div>
            <div>
              <div class="text-[10px] text-slate-400 uppercase">Treasury</div>
              <div class="text-sm font-extrabold text-amber-300">${eco.coins || 0} Gold</div>
            </div>
            <div>
              <div class="text-[10px] text-slate-400 uppercase">Battle Time</div>
              <div class="text-sm font-extrabold text-emerald-300">${mins}:${remSecs}</div>
            </div>
          `;
        }

        this.modalEl.classList.remove('hidden');
        if (this.synthAudio) this.synthAudio.playHornAlert?.();
      }
    }
  }
}
