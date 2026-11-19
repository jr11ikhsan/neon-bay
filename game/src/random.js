// NEON BAY v5 — seeded randomness (mulberry32).
// Every random choice in the simulation draws from one of these streams,
// created from the world seed, so a seed plus an input script always
// replays the identical world.

export function createRandom(seed) {
  let a = seed >>> 0;
  function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    /** Float in [lo, hi). */
    range(lo, hi) { return lo + next() * (hi - lo); },
    /** Integer in [lo, hi], both ends included. */
    int(lo, hi) { return Math.floor(lo + next() * (hi - lo + 1)); },
    pick(arr) { return arr[Math.floor(next() * arr.length)]; },
    chance(p) { return next() < p; },
    /** A fresh independent stream, for a subsystem that wants its own. */
    fork() { return createRandom(Math.floor(next() * 4294967296)); },
  };
}
