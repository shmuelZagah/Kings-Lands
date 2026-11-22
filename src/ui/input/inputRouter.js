export class InputRouter {
  constructor(domElement) {
    this.domElement = domElement;
    this.layers = [];
    this._bindDomEvents();
  }

  registerLayer(id, handler, priority = 0) {
    this.layers = this.layers.filter((l) => l.id !== id);
    this.layers.push({ id, handler, priority: priority | 0 });
    this.layers.sort((a, b) => b.priority - a.priority);
  }

  _isTextInputFocused() {
    const tag = document.activeElement?.tagName;
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  }

  _notifyWindowBlur() {
    for (let i = 0; i < this.layers.length; i++) {
      const handler = this.layers[i].handler;
      if (typeof handler.onWindowBlur === 'function') {
        handler.onWindowBlur();
      } else {
        // Fallback for layers like CameraController that don't have onWindowBlur
        if (handler.keysDown instanceof Set) handler.keysDown.clear();
        if ('dragMode' in handler) handler.dragMode = null;
        if ('isPointerInside' in handler) handler.isPointerInside = false;
        if ('isLeftDragging' in handler) handler.isLeftDragging = false;
        if ('isRightDragging' in handler) handler.isRightDragging = false;
      }
    }
  }

  _bindDomEvents() {
    this.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    this.domElement.addEventListener('auxclick', (e) => {
      if (e.button === 1) e.preventDefault();
    });

    window.addEventListener('blur', () => {
      this._notifyWindowBlur();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this._notifyWindowBlur();
      }
    });

    this.domElement.addEventListener('mouseenter', (e) => {
      for (let i = 0; i < this.layers.length; i++) {
        this.layers[i].handler.onMouseEnter?.(e);
      }
    });

    this.domElement.addEventListener('mouseleave', (e) => {
      for (let i = 0; i < this.layers.length; i++) {
        this.layers[i].handler.onMouseLeave?.(e);
      }
    });

    this.domElement.addEventListener(
      'wheel',
      (e) => {
        for (let i = 0; i < this.layers.length; i++) {
          if (this.layers[i].handler.onWheel?.(e) === true) {
            return;
          }
        }
      },
      { passive: false }
    );

    this.domElement.addEventListener('mousedown', (e) => {
      for (let i = 0; i < this.layers.length; i++) {
        if (this.layers[i].handler.onMouseDown?.(e) === true) {
          return;
        }
      }
    });

    window.addEventListener('mousemove', (e) => {
      for (let i = 0; i < this.layers.length; i++) {
        if (this.layers[i].handler.onMouseMove?.(e) === true) {
          return;
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      for (let i = 0; i < this.layers.length; i++) {
        if (this.layers[i].handler.onMouseUp?.(e) === true) {
          return;
        }
      }
    });

    this.domElement.addEventListener('dblclick', (e) => {
      for (let i = 0; i < this.layers.length; i++) {
        if (this.layers[i].handler.onDblClick?.(e) === true) {
          return;
        }
      }
    });

    window.addEventListener('keydown', (e) => {
      if (this._isTextInputFocused()) return;
      for (let i = 0; i < this.layers.length; i++) {
        if (this.layers[i].handler.onKeyDown?.(e) === true) {
          return;
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      for (let i = 0; i < this.layers.length; i++) {
        this.layers[i].handler.onKeyUp?.(e);
      }
    });
  }
}