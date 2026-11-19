// A small seeded random number generator (mulberry32): the same seed gives the same
// city and the same screenshot scenes, which is what makes ?shot= frames repeatable.

export function createRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random helpers built on a mulberry32 stream. */
export function rngTools(random) {
  return {
    range: (min, max) => min + random() * (max - min),
    int: (min, max) => Math.floor(min + random() * (max - min + 1)),
    pick: (list) => list[Math.floor(random() * list.length) % list.length],
    chance: (p) => random() < p,
  };
}
