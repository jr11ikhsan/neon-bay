// Keyboard and pointer input for NEON BAY. Held keys give movement and driving axes;
// one-shot presses (confirm, pause, interact) are queued as bit flags and taken once
// by the loop, so a press between two frames is never lost and never counted twice.
// The mouse aims: its position is kept in canvas device pixels and the renderer
// converts it to world coordinates for the player's aim direction.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_INTERACT = 4;

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const INTERACT = new Set(['KeyE', 'KeyF']);
const GAME_KEYS = new Set([...UP, ...DOWN, ...LEFT, ...RIGHT, ...CONFIRM, ...PAUSE, ...INTERACT, 'ShiftLeft', 'ShiftRight', 'KeyM']);

export function createInput(canvas) {
  const held = new Set();
  let actions = 0;
  const pointer = { x: 0, y: 0, down: false };

  window.addEventListener('keydown', (event) => {
    if (!GAME_KEYS.has(event.code)) return;
    held.add(event.code);
    if (!event.repeat) {
      if (CONFIRM.has(event.code)) actions |= ACTION_CONFIRM;
      else if (PAUSE.has(event.code)) actions |= ACTION_PAUSE;
      else if (INTERACT.has(event.code)) actions |= ACTION_INTERACT;
    }
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    held.clear();
    pointer.down = false;
  });
  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    const ratio = canvas.width / Math.max(1, rect.width);
    pointer.x = (event.clientX - rect.left) * ratio;
    pointer.y = (event.clientY - rect.top) * ratio;
  });
  canvas.addEventListener('pointerdown', (event) => {
    pointer.down = true;
    actions |= ACTION_CONFIRM;
    canvas.setPointerCapture?.(event.pointerId);
  });
  window.addEventListener('pointerup', () => {
    pointer.down = false;
  });

  const anyHeld = (set) => {
    for (const code of set) if (held.has(code)) return true;
    return false;
  };

  return {
    pointer,
    /** -1..1 movement axes from the held keys. */
    moveX() { return (anyHeld(RIGHT) ? 1 : 0) - (anyHeld(LEFT) ? 1 : 0); },
    moveY() { return (anyHeld(DOWN) ? 1 : 0) - (anyHeld(UP) ? 1 : 0); },
    running() { return anyHeld(new Set(['ShiftLeft', 'ShiftRight'])); },
    attackHeld() { return pointer.down; },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
