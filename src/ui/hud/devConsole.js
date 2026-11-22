/**
 * Kings Lands — Phase 5+: Developer Testing Console with '/' Interactive Command Menu,
 * Capture-Phase Hotkey Blocking & Quick Cheats
 * (src/ui/hud/devConsole.js)
 */

import { CommandTypes } from '../../core/commandBus.js';

export const DEV_CONSOLE_COMMANDS = Object.freeze([
  {
    code: 'c',
    aliases: ['c', 'fow', 'fog', 'nofog'],
    label: '/c  (or fow)',
    desc: 'חשיפת/הסתרת כל המפה וערפל הקרב (Toggle Full Map & AI Fog of War)'
  },
  {
    code: 'q',
    aliases: ['q', 'add', 'resources'],
    label: '/q',
    desc: 'הוספת +1,000 לכל המשאבים (Grant +1,000 Coins, Wood, Stone & Iron)'
  },
  {
    code: 'lv',
    aliases: ['lv', 'levelup', 'xp'],
    label: '/lv  (or levelup)',
    desc: 'העלאת רמה לכל הגיבורים החיים של השחקן (+1 Hero Level & Skill Point)'
  },
  {
    code: 'ballista',
    aliases: ['ballista', 'siege'],
    label: '/ballista',
    desc: 'שיגור מיידי של סוללת בליסטראות (3 בליסטראות) ליד המצודה (Spawn Field Ballista Battery)'
  },
  {
    code: 'd',
    aliases: ['d', 'damage'],
    label: '/d  (or damage)',
    desc: 'הורדת 50% חיים למבנה הנבחר או למבני השחקן לבדיקת תיקון (50% Building Damage)'
  },
  {
    code: 'ai adaptive',
    aliases: ['ai adaptive', 'ai'],
    label: '/ai adaptive',
    desc: 'הפעלת AI חכם ולומד שמתאים את עצמו לצבא שלך (Smart Adaptive Counter-AI)'
  },
  {
    code: 'ai hard',
    aliases: ['ai hard'],
    label: '/ai hard',
    desc: 'הגדרת קושי ה-AI לרמה גבוהה ומהירה (High-Cadence Hard AI)'
  },
  {
    code: 'ai normal',
    aliases: ['ai normal'],
    label: '/ai normal',
    desc: 'הגדרת קושי ה-AI לרמה רגילה (Balanced Normal AI)'
  },
  {
    code: 'ai easy',
    aliases: ['ai easy'],
    label: '/ai easy',
    desc: 'הגדרת קושי ה-AI לרמה קלה (Relaxed Easy AI)'
  },
  {
    code: 'ai off',
    aliases: ['ai off', 'ai disable', 'ai 0'],
    label: '/ai off',
    desc: 'כיבוי מוח ה-AI של האויב לבדיקות חופשיות (Pause Enemy AI Brain)'
  },
  {
    code: 'laststand',
    aliases: ['laststand'],
    label: '/laststand',
    desc: 'השמדת מבני הייצור של האויב והפעלת מצב קרב אחרון (Trigger Enemy Last Stand)'
  },
  {
    code: 'panic',
    aliases: ['panic', 'rout'],
    label: '/panic',
    desc: 'שבירת מורל לשתי פלוגות לבדיקת מנוסה אזורית (Trigger Morale Rout Cascade)'
  },
  {
    code: 'win',
    aliases: ['win', 'victory'],
    label: '/win',
    desc: 'הפעלת ניצחון מיידי וקריסת מצודת האויב (Instant Victory)'
  },
  {
    code: 'lose',
    aliases: ['lose', 'defeat'],
    label: '/lose',
    desc: 'הפעלת הפסד מיידי וקריסת מצודת השחקן (Instant Defeat)'
  }
]);

export class DevConsole {
  constructor({ commandBus, buildingRadialMenu, synthAudio, enabled = true }) {
    this.enabled = enabled !== false;
    this.commandBus = commandBus;
    this.buildingRadialMenu = buildingRadialMenu || null;
    this.synthAudio = synthAudio;
    this.isOpen = false;
    this.showCommandList = false;
    this.selectedCommandIndex = 0;
    this._filteredCommands = [...DEV_CONSOLE_COMMANDS];

    this._buildDom();
    this._bindKeys();
  }

  _buildDom() {
    const existing = document.getElementById('phase5-dev-console');
    if (existing) existing.remove();

    this.rootEl = document.createElement('div');
    this.rootEl.id = 'phase5-dev-console';
    this.rootEl.className =
      'fixed top-14 left-1/2 -translate-x-1/2 z-50 hidden flex flex-col gap-1.5 rounded-2xl border border-amber-400/80 bg-slate-950/95 px-3.5 py-2.5 shadow-2xl backdrop-blur-md w-[480px] max-w-[94vw] select-none';

    this.rootEl.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="text-[11px] font-bold uppercase tracking-wider text-amber-400 mono shrink-0">Console &gt;</span>
        <input
          id="dev-console-input"
          type="text"
          placeholder="הקלד פקודה או לחץ / להצגת כל הקודים ('c', 'q', 'lv', 'ballista', 'ai'...)"
          autocomplete="off"
          class="flex-1 bg-transparent text-xs font-semibold text-teal-200 placeholder-slate-500 focus:outline-none mono"
        />
        <button
          id="dev-console-help-btn"
          type="button"
          title="הצג/הסתר את רשימת כל הקודים (/)"
          class="rounded-lg border border-amber-400/50 bg-amber-500/15 hover:bg-amber-500/30 px-2 py-0.5 text-[10px] font-black text-amber-300 mono cursor-pointer transition"
        >
          / קודים
        </button>
      </div>
      <div
        id="dev-console-codes-list"
        class="hidden flex-col gap-1 max-h-64 overflow-y-auto border-t border-slate-800/90 pt-2 mt-0.5"
      ></div>
    `;

    this.rootEl.addEventListener('mousedown', (e) => e.stopPropagation());
    this.rootEl.addEventListener('mouseup', (e) => e.stopPropagation());
    this.rootEl.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(this.rootEl);

    this.inputEl = this.rootEl.querySelector('#dev-console-input');
    this.listEl = this.rootEl.querySelector('#dev-console-codes-list');
    this.helpBtnEl = this.rootEl.querySelector('#dev-console-help-btn');

    if (this.helpBtnEl) {
      this.helpBtnEl.addEventListener('click', () => {
        this.showCommandList = !this.showCommandList;
        this._renderCommandList();
        this.inputEl?.focus();
      });
    }

    if (this.inputEl) {
      this.inputEl.addEventListener('input', () => {
        const raw = this.inputEl.value || '';
        if (raw.startsWith('/')) {
          this.showCommandList = true;
        }
        this.selectedCommandIndex = 0;
        this._renderCommandList();
      });
    }
  }

  _getFilterQuery() {
    const raw = (this.inputEl?.value || '').trim().toLowerCase();
    return raw.startsWith('/') ? raw.slice(1).trim() : raw;
  }

  _renderCommandList() {
    if (!this.listEl) return;
    if (!this.showCommandList) {
      this.listEl.classList.add('hidden');
      this.listEl.classList.remove('flex');
      return;
    }

    const q = this._getFilterQuery();
    this._filteredCommands = DEV_CONSOLE_COMMANDS.filter((item) => {
      if (!q) return true;
      return (
        item.code.includes(q) ||
        item.label.toLowerCase().includes(q) ||
        item.desc.toLowerCase().includes(q) ||
        item.aliases.some((a) => a.includes(q))
      );
    });

    if (this._filteredCommands.length === 0) {
      this._filteredCommands = [...DEV_CONSOLE_COMMANDS];
    }
    this.selectedCommandIndex = Math.max(
      0,
      Math.min(this.selectedCommandIndex, this._filteredCommands.length - 1)
    );

    this.listEl.classList.remove('hidden');
    this.listEl.classList.add('flex');

    this.listEl.innerHTML = this._filteredCommands
      .map((item, idx) => {
        const isActive = idx === this.selectedCommandIndex;
        return `
          <button
            type="button"
            data-cmd-code="${item.code}"
            class="w-full text-left rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-3 text-xs transition cursor-pointer ${
              isActive
                ? 'bg-amber-500/25 border border-amber-400/70 text-amber-200'
                : 'bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800 text-slate-300'
            }"
          >
            <span class="font-black text-teal-300 mono shrink-0">${item.label}</span>
            <span class="text-[11px] text-slate-300 truncate" dir="rtl">${item.desc}</span>
          </button>
        `;
      })
      .join('');

    const buttons = this.listEl.querySelectorAll('[data-cmd-code]');
    buttons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const code = btn.getAttribute('data-cmd-code');
        if (code) {
          this.executeCode(code);
        }
      });
    });
  }

  _bindKeys() {
    // Capture-phase listener (`true`) intercepts all keys BEFORE CameraController or FormationPreview3D!
    this._onKeyDownCapture = (e) => {
      if (this.isDestroyed) return;
      if (
        document.getElementById('heroes-hall-root')?.childElementCount > 0 ||
        document.getElementById('studio-root')?.childElementCount > 0
      ) {
        return;
      }
      if (this.isOpen) {
        // Block WASD, Arrows, Space, P, X from reaching camera/unit controllers while typing
        e.stopImmediatePropagation();

        if (e.code === 'ArrowDown' && this.showCommandList && this._filteredCommands.length > 0) {
          e.preventDefault();
          this.selectedCommandIndex = (this.selectedCommandIndex + 1) % this._filteredCommands.length;
          this._renderCommandList();
          return;
        }
        if (e.code === 'ArrowUp' && this.showCommandList && this._filteredCommands.length > 0) {
          e.preventDefault();
          this.selectedCommandIndex =
            (this.selectedCommandIndex - 1 + this._filteredCommands.length) %
            this._filteredCommands.length;
          this._renderCommandList();
          return;
        }
        if (e.code === 'Enter') {
          e.preventDefault();
          this._submitAndClose();
        } else if (e.code === 'Escape') {
          e.preventDefault();
          this.close();
        }
        return;
      }

      const activeTag = document.activeElement?.tagName;
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag);

      // Pressing '/' opens the DevConsole AND shows all available cheat/command codes!
      if ((e.code === 'Slash' || e.key === '/') && !inInput) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.open(true, '/');
        return;
      }

      if (e.code === 'Enter' && !inInput) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.open(false, '');
        return;
      }

      // Quick debug hotkey: Alt + D instantly damages the selected building (or Team 1 buildings) by 50%
      if (e.code === 'KeyD' && e.altKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const selectedBld = this.buildingRadialMenu?.getSelectedBuilding?.();
        this.commandBus.issue(CommandTypes.DAMAGE_BUILDING_CHEAT, {
          team: 1,
          buildingId: selectedBld ? selectedBld.id : null
        });
        if (this.synthAudio) this.synthAudio.playHornAlert();
      }
    };

    this._onKeyUpCapture = (e) => {
      if (this.isDestroyed) return;
      if (this.isOpen) {
        e.stopImmediatePropagation();
      }
    };

    window.addEventListener('keydown', this._onKeyDownCapture, true);
    window.addEventListener('keyup', this._onKeyUpCapture, true);
  }

  destroy() {
    this.isDestroyed = true;
    this.close();
    if (this._onKeyDownCapture) {
      window.removeEventListener('keydown', this._onKeyDownCapture, true);
      this._onKeyDownCapture = null;
    }
    if (this._onKeyUpCapture) {
      window.removeEventListener('keyup', this._onKeyUpCapture, true);
      this._onKeyUpCapture = null;
    }
    if (this.rootEl) {
      this.rootEl.remove();
      this.rootEl = null;
    }
  }

  open(showList = false, initialValue = '') {
    if (!this.enabled) return;
    this.isOpen = true;
    this.showCommandList = Boolean(showList);
    this.selectedCommandIndex = 0;
    this.rootEl.classList.remove('hidden');
    this.inputEl.value = initialValue;
    this._renderCommandList();
    this.inputEl.focus();
  }

  close() {
    this.isOpen = false;
    this.showCommandList = false;
    if (this.inputEl) {
      this.inputEl.value = '';
      this.inputEl.blur();
    }
    if (this.listEl) {
      this.listEl.classList.add('hidden');
      this.listEl.classList.remove('flex');
    }
    if (this.rootEl) {
      this.rootEl.classList.add('hidden');
    }
  }

  executeCode(rawCode) {
    const clean = String(rawCode || '')
      .trim()
      .replace(/^\/+/, '')
      .trim()
      .toLowerCase();
    if (!clean) {
      this.close();
      return;
    }
    const selectedBld = this.buildingRadialMenu?.getSelectedBuilding?.();
    if (clean === 'd' || clean === 'damage') {
      this.commandBus.issue(CommandTypes.DAMAGE_BUILDING_CHEAT, {
        team: 1,
        buildingId: selectedBld ? selectedBld.id : null
      });
    } else {
      this.commandBus.issue(CommandTypes.DEV_CHEAT, {
        team: 1,
        code: clean,
        buildingId: selectedBld ? selectedBld.id : null
      });
    }
    if (this.synthAudio) this.synthAudio.playFocusWhoosh();
    this.close();
  }

  _submitAndClose() {
    const raw = (this.inputEl?.value || '').trim();
    const stripped = raw.replace(/^\/+/, '').trim().toLowerCase();

    if (!stripped && this.showCommandList && this._filteredCommands.length > 0) {
      const picked = this._filteredCommands[this.selectedCommandIndex] || this._filteredCommands[0];
      if (picked) {
        this.executeCode(picked.code);
        return;
      }
    }

    if (
      raw.startsWith('/') &&
      this.showCommandList &&
      this._filteredCommands.length > 0 &&
      !DEV_CONSOLE_COMMANDS.some((c) => c.code === stripped || c.aliases.includes(stripped))
    ) {
      const picked = this._filteredCommands[this.selectedCommandIndex] || this._filteredCommands[0];
      if (picked) {
        this.executeCode(picked.code);
        return;
      }
    }

    this.executeCode(stripped);
  }
}
