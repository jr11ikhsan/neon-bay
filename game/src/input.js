// NEON BAY — keyboard + mouse input.
// Held state is polled every frame; one-shot actions (interact, pause,
// weapon slots, menu keys) are edge-triggered flags the shell consumes.
// Movement comes out in screen space (x right, y down); the shell rotates
// it into world space with the camera yaw, so this file stays dumb.

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.mouseX = 0; this.mouseY = 0; this.mouseDown = false;
    this.interact = false;      // E
    this.pause = false;         // P or Esc
    this.confirm = false;       // Enter / Space
    this.saveKey = false;       // S (on the pause screen)
    this.continueKey = false;   // C (on the title screen)
    this.mute = false;          // M
    this.weaponSlot = -1;       // 0..3 from 1/2/3/4, Q cycles (reported as 9)
    this._down = (e) => {
      if (e.repeat) { if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault(); return; }
      this.keys.add(e.code);
      switch (e.code) {
        case 'KeyE': this.interact = true; break;
        case 'KeyP': case 'Escape': this.pause = true; break;
        case 'Enter': case 'Space': this.confirm = true; if (e.code === 'Space') e.preventDefault(); break;
        case 'KeyS': this.saveKey = true; break;
        case 'KeyC': this.continueKey = true; break;
        case 'KeyM': this.mute = true; break;
        case 'Digit1': this.weaponSlot = 0; break;
        case 'Digit2': this.weaponSlot = 1; break;
        case 'Digit3': this.weaponSlot = 2; break;
        case 'Digit4': this.weaponSlot = 3; break;
        case 'KeyQ': this.weaponSlot = 9; break;
        case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': e.preventDefault(); break;
      }
    };
    this._up = (e) => this.keys.delete(e.code);
    this._move = (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = (e.clientX - r.left) * (canvas.width / r.width || 1);
      this.mouseY = (e.clientY - r.top) * (canvas.height / r.height || 1);
    };
    this._md = (e) => { if (e.button === 0) this.mouseDown = true; };
    this._mu = (e) => { if (e.button === 0) this.mouseDown = false; };
    window.addEventListener('keydown', this._down);
    window.addEventListener('keyup', this._up);
    canvas.addEventListener('mousemove', this._move);
    canvas.addEventListener('mousedown', this._md);
    window.addEventListener('mouseup', this._mu);
  }

  // Screen-space move vector: x right, y down (W = -1), not normalised.
  moveVec() {
    let x = 0, y = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1;
    return { x, y };
  }
  get sprint() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }

  // Read-and-clear helpers for the edge-triggered flags.
  take(name) { const v = this[name]; this[name] = name === 'weaponSlot' ? -1 : false; return v; }
}
