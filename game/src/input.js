// NEON BAY v2 — keyboard + mouse input. The game reads a plain state
// object each frame: held keys become the move vector, mouse position is
// the aim point on the HUD canvas, and edge-triggered presses (E, P,
// Enter…) are queued until the frame consumes them.

export function createInput(canvas) {
  const held = new Set();
  const pressed = new Set();
  const mouse = { x: 0, y: 0, down: false, clicked: false };

  const onKey = (down) => (e) => {
    if (e.repeat) { if (down) e.preventDefault(); return; }
    if (down) { held.add(e.code); pressed.add(e.code); } else held.delete(e.code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  };
  const kd = onKey(true), ku = onKey(false);
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);

  const rect = () => canvas.getBoundingClientRect();
  const onMove = (e) => { const r = rect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; };
  const onDown = (e) => { if (e.button === 0) { mouse.down = true; mouse.clicked = true; onMove(e); } };
  const onUp = (e) => { if (e.button === 0) mouse.down = false; };
  const onCtx = (e) => e.preventDefault();
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('contextmenu', onCtx);

  return {
    mouse,
    held: (code) => held.has(code),
    pressed: (code) => pressed.has(code),
    moveVec() {
      let mx = 0, my = 0;
      if (held.has('KeyA') || held.has('ArrowLeft')) mx -= 1;
      if (held.has('KeyD') || held.has('ArrowRight')) mx += 1;
      if (held.has('KeyW') || held.has('ArrowUp')) my -= 1;
      if (held.has('KeyS') || held.has('ArrowDown')) my += 1;
      return { mx, my };
    },
    run: () => held.has('ShiftLeft') || held.has('ShiftRight'),
    attack: () => mouse.down || held.has('Space'),
    weaponKey() {
      if (pressed.has('Digit1')) return 0;
      if (pressed.has('Digit2')) return 1;
      if (pressed.has('Digit3')) return 2;
      if (pressed.has('Digit4')) return 3;
      return null;
    },
    endFrame() { pressed.clear(); mouse.clicked = false; },
    dispose() {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('contextmenu', onCtx);
    },
  };
}
