// The NEON BAY story: six missions in a fixed order, each a short chain of steps.
// The world runs the steps generically by `type`; this file is only the script —
// who, where, what the player is told, and what it pays. Places come from the city.

export const MISSIONS = [
  {
    id: 'first-wheels',
    title: 'Mission 1 — First Wheels',
    intro: 'Your cousin Lucho left a gold coupe at Bay Motors. Take it. Bring it to Taller Sol.',
    reward: 250,
    steps: [
      { type: 'goto', place: 'carLot', text: 'Go to the Bay Motors lot', radius: 110 },
      { type: 'steal', text: 'Steal the gold coupe', radius: 0 },
      { type: 'deliverCar', place: 'garage', text: 'Deliver the coupe to Taller Sol', radius: 120 },
    ],
  },
  {
    id: 'package-run',
    title: 'Mission 2 — Package Run',
    intro: 'Pick up the package at Market Sol. Drop it at Hotel Lumina. Do not get caught holding it.',
    reward: 400,
    steps: [
      { type: 'goto', place: 'market', text: 'Go to Market Sol', radius: 70 },
      { type: 'pickup', place: 'market', text: 'Pick up the package', radius: 46, onStart: 'hotPickup' },
      { type: 'goto', place: 'hotel', text: 'Deliver the package to Hotel Lumina', radius: 70 },
    ],
  },
  {
    id: 'beachside-business',
    title: 'Mission 3 — Beachside Business',
    intro: 'Three rival dealers are working our beach. Shut them down, then lose the heat.',
    reward: 650,
    steps: [
      { type: 'kill', count: 3, text: 'Shut down the 3 dealers on the beach', onStart: 'spawnDealers' },
      { type: 'escape', text: 'Lose your wanted level', onStart: 'none' },
    ],
  },
  {
    id: 'the-big-score',
    title: 'Mission 4 — The Big Score',
    intro: 'Banco del Mar, main door. Grab the cash bag, then disappear to Taller Sol. This is the one.',
    reward: 1500,
    steps: [
      { type: 'goto', place: 'bank', text: 'Go to Banco del Mar', radius: 70 },
      { type: 'channel', place: 'bank', text: 'Grab the cash bag', radius: 46, seconds: 3, onStart: 'bankHeat' },
      { type: 'goto', place: 'hideout', text: 'Escape to Taller Sol', radius: 110 },
    ],
  },
  {
    id: 'night-run',
    title: 'Mission 5 — Night Run',
    intro: 'A buyer at Hotel Lumina wants the cyan racer on the Bay Motors lot — tonight, no questions. Take it, deliver it, vanish.',
    reward: 900,
    steps: [
      { type: 'goto', place: 'carLot', text: 'Go to the Bay Motors lot', radius: 110 },
      { type: 'steal', car: 'job', text: 'Steal the cyan racer', radius: 0, onStart: 'spawnJobCar' },
      { type: 'deliverCar', car: 'job', place: 'hotel', text: 'Deliver the racer to Hotel Lumina', radius: 120 },
      { type: 'escape', text: 'Lose your wanted level', onStart: 'none' },
    ],
  },
  {
    id: 'bay-legend',
    title: 'Mission 6 — Bay Legend',
    intro: 'One last score. Banco del Mar after dark, everything in the side vault — then sell the story at Bay Motors and disappear. Become the legend of Neon Bay.',
    reward: 2500,
    steps: [
      { type: 'goto', place: 'bank', text: 'Go to Banco del Mar', radius: 70 },
      { type: 'channel', place: 'bank', text: 'Empty the side vault', radius: 46, seconds: 4, onStart: 'bankHeat' },
      { type: 'goto', place: 'carLot', text: 'Meet the buyer at Bay Motors', radius: 110 },
      { type: 'escape', text: 'Lose your wanted level', onStart: 'none' },
    ],
  },
];

export const STORY_DONE_TITLE = 'NEON BAY — Story Complete';
export const STORY_DONE_TEXT = 'The bay is yours. Free roam: the city, the cops and the beach are still out there.';
