// NEON BAY v3 — keyboard + mouse input. Produces the world-space input snapshot world.step eats:
// movement is camera-relative, driving uses throttle/steer, aim comes from the renderer's ground ray.
export class Input {
  constructor(el) {
    this.keys = new Set();
    this.mouseDown = false; this.mouseEdge = false;
    this.mouseX = 0; this.mouseY = 0;
    this.interactEdge = false; this.pauseEdge = false; this.confirmEdge = false;
    this.weaponTo = null; this.muteEdge = false; this.saveEdge = false; this.continueEdge = false;
    this.el = el;
    addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyE') this.interactEdge = true;
      if (e.code === 'KeyP' || e.code === 'Escape') this.pauseEdge = true;
      if (e.code === 'Enter' || e.code === 'Space') this.confirmEdge = true;
      if (e.code === 'KeyM') this.muteEdge = true;
      if (e.code === 'KeyS') this.saveEdge = true;
      if (e.code === 'KeyC') this.continueEdge = true;
      if (e.code === 'Digit1') this.weaponTo = 1;
      if (e.code === 'Digit2') this.weaponTo = 2;
      if (e.code === 'Digit3') this.weaponTo = 3;
      if (e.code === 'Digit4') this.weaponTo = 4;
      if (e.code === 'KeyQ') this.weaponCycle = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    el.addEventListener('mousemove', e => { const r = el.getBoundingClientRect(); this.mouseX = e.clientX - r.left; this.mouseY = e.clientY - r.top; });
    el.addEventListener('mousedown', e => { if (e.button === 0) { this.mouseDown = true; this.mouseEdge = true; } });
    addEventListener('mouseup', e => { if (e.button === 0) this.mouseDown = false; });
    el.addEventListener('contextmenu', e => e.preventDefault());
  }
  // camYaw: the renderer's current view direction (radians, world space). aimPoint: world coords under the mouse.
  snapshot(camYaw, aimPoint, player) {
    const k = this.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const fx = Math.cos(camYaw), fy = Math.sin(camYaw), rx = -Math.sin(camYaw), ry = Math.cos(camYaw);
    const snap = {
      mx: fx * fwd + rx * side, my: fy * fwd + ry * side,
      throttle: fwd, steer: side,
      sprint: k.has('ShiftLeft') || k.has('ShiftRight'),
      fire: this.mouseDown, firePressed: this.mouseEdge,
      interact: this.interactEdge, pause: this.pauseEdge, confirm: this.confirmEdge,
      save: this.saveEdge, cont: this.continueEdge, mute: this.muteEdge,
      aim: aimPoint && player ? Math.atan2(aimPoint.y - player.y, aimPoint.x - player.x) : null,
      weaponTo: this.weaponTo,
    };
    if (this.weaponCycle && player) {
      const order = ['fist', 'pistol', 'smg', 'shotgun'].filter(w => player.owned[w]);
      const next = order[(order.indexOf(player.weapon) + 1) % order.length];
      snap.weaponTo = ['fist', 'pistol', 'smg', 'shotgun'].indexOf(next) + 1;
    }
    this.mouseEdge = false; this.interactEdge = false; this.pauseEdge = false; this.confirmEdge = false;
    this.saveEdge = false; this.continueEdge = false; this.muteEdge = false; this.weaponTo = null; this.weaponCycle = false;
    return snap;
  }
}
