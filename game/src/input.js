// NEON BAY v5 — keyboard and mouse, translated for the world.
// Raw axes come out in screen terms (x right, y down); main.js turns them
// into throttle/steer when the player is driving. One-shot actions (pause,
// save, confirm…) are queued on keydown and drained by the shell each frame,
// so a tap is never lost between frames.

export function createInput(target) {
  const keys = new Set();
  const actions = new Set();
  const mouse = { x: 0, y: 0, down: false };
  let slot = -1;

  const ACTION_KEYS = {
    Enter: 'confirm', Space: 'confirm',
    KeyP: 'pause', Escape: 'pause',
    KeyS: 'save', KeyC: 'continue', KeyM: 'mute', KeyR: 'restart',
  };

  function onKeyDown(e) {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    const action = ACTION_KEYS[e.code];
    if (action) actions.add(action);
    if (e.code === 'Digit1') slot = 0;
    if (e.code === 'Digit2') slot = 1;
    if (e.code === 'Digit3') slot = 2;
    if (e.code === 'Digit4') slot = 3;
    if (e.code === 'KeyQ') actions.add('cycleWeapon');
  }
  function onKeyUp(e) { keys.delete(e.code); }
  function onMouseMove(e) {
    const rect = target.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
  }
  function onMouseDown(e) { mouse.down = true; actions.add('confirm'); mouse.x = e.clientX - target.getBoundingClientRect().left; mouse.y = e.clientY - target.getBoundingClientRect().top; }
  function onMouseUp() { mouse.down = false; }
  function onBlur() { keys.clear(); mouse.down = false; }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  target.addEventListener('mousemove', onMouseMove);
  target.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);

  return {
    mouse,
    /** Continuous control axes for the world step. */
    axes() {
      return {
        x: (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0),
        y: (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0),
        fire: mouse.down,
        interact: keys.has('KeyE'),
        sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
      };
    },
    /** The last weapon slot requested with the number keys, or -1. */
    takeSlot() { const s = slot; slot = -1; return s; },
    /** Drain the one-shot actions pressed since the last call. */
    takeActions() { const out = new Set(actions); actions.clear(); return out; },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      target.removeEventListener('mousemove', onMouseMove);
      target.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
    },
  };
}
