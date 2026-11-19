// NEON BAY v2 — the six-mission story. Pure data: the world engine walks
// the steps of the active mission, the renderer reads the objective.
// Step types: goto | steal | deliverCar | pickup | kill | channel | meet | escape.
// Places and points are resolved by the world against the generated city.

export const MISSIONS = [
  {
    id: 'first-wheels', title: 'First Wheels', reward: 250, unlock: 'pistol',
    intro: 'The gold coupe at Bay Motors has your name on it. Take it, park it at the safehouse.',
    steps: [
      { t: 'steal', car: 'coupe', label: 'Steal the gold coupe at Bay Motors' },
      { t: 'deliverCar', car: 'coupe', place: 'safehouse', label: 'Park the coupe at Safehouse Mar' },
    ],
  },
  {
    id: 'package-run', title: 'Package Run', reward: 350,
    intro: 'A package waits in the west park. It is hot — the whole bay will smell it.',
    steps: [
      { t: 'pickup', point: 'park', heat: 210, label: 'Pick up the package in the west park' },
      { t: 'meet', place: 'hotel', label: 'Drop the package at Hotel Lumina' },
    ],
  },
  {
    id: 'beachside', title: 'Beachside Business', reward: 600,
    intro: 'Three dealers are cutting into our beach. Shut them down, then lose the heat.',
    steps: [
      { t: 'kill', count: 3, label: 'Shut down the beach dealers' },
      { t: 'escape', label: 'Lose the heat' },
    ],
  },
  {
    id: 'big-score', title: 'The Big Score', reward: 1500,
    intro: 'Banco Neon keeps its vault polite and unlocked for exactly three seconds. Be there.',
    steps: [
      { t: 'channel', place: 'bank', secs: 3, heat: 540, label: 'Crack the Banco Neon vault' },
      { t: 'escape', label: 'Lose the heat' },
    ],
  },
  {
    id: 'night-run', title: 'Night Run', reward: 1000,
    intro: 'A cyan racer at Bay Motors needs to be at Hotel Lumina before the city sleeps. Quietly.',
    steps: [
      { t: 'steal', car: 'job', label: 'Take the cyan racer at Bay Motors' },
      { t: 'deliverCar', car: 'job', place: 'hotel', label: 'Deliver the racer to Hotel Lumina' },
      { t: 'escape', label: 'Lose the heat' },
    ],
  },
  {
    id: 'bay-legend', title: 'Bay Legend', reward: 2500,
    intro: 'One last vault. The buyer waits at the pier with cash and a fast boat. Become the legend.',
    steps: [
      { t: 'channel', place: 'bank', secs: 4, heat: 540, label: 'Empty the Banco Neon vault' },
      { t: 'meet', point: 'pier', label: 'Meet the buyer at the pier' },
      { t: 'escape', label: 'Lose the heat — become the Bay Legend' },
    ],
  },
];

// Named free points that are not economy places.
export const POINTS = {
  park: (city) => ({ x: city.parks[0].x + city.parks[0].w / 2, y: city.parks[0].y + city.parks[0].h / 2 }),
  pier: () => ({ x: 4500, y: 2050 }),
};

export const STORY_TOTAL = MISSIONS.reduce((s, m) => s + m.reward, 0); // 6200
