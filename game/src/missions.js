// NEON BAY v5 — the story: six chained missions over one neon night.
// Steps are data; the world engine in world.js interprets them. Rewards
// sum to exactly $6,200 — the number the whole economy is tuned around.
//
// Step kinds the engine understands:
//   goto      reach a place door (on foot or in a car)
//   steal     get into the step's target car ('coupe' first, then 'job')
//   deliverCar arrive at a place door while driving the target car
//   pickup    touch the package point; `heat` lands the moment you do
//   kill      drop `count` dealers inside `area`
//   channel   stay in the place zone for `seconds`; `heat` lands at the end
//   meet      reach a named point (a person waiting there)
//   escape    get the heat to zero — Casa Segura hides you while you wait

export const MISSIONS = [
  {
    id: 'first-wheels',
    title: 'First Wheels',
    intro: 'Sol needs a coupe moved. Quietly.',
    reward: 250,
    steps: [
      { kind: 'goto', place: 'carLot', r: 95, label: 'Reach Bay Motors' },
      { kind: 'steal', car: 'coupe', label: 'Steal the gold coupe' },
      { kind: 'deliverCar', place: 'garage', r: 110, label: 'Deliver the coupe to Taller Sol' },
    ],
  },
  {
    id: 'package-run',
    title: 'Package Run',
    intro: 'A package at the market. It is warm. Do not ask.',
    reward: 450,
    steps: [
      { kind: 'pickup', place: 'market', r: 80, heat: 210, label: 'Pick up the package at Mercado Sol' },
      { kind: 'goto', place: 'hotel', r: 95, label: 'Deliver the package to Hotel Lumina' },
    ],
  },
  {
    id: 'beachside-business',
    title: 'Beachside Business',
    intro: 'Three dealers are selling on our sand. End it.',
    reward: 800,
    steps: [
      { kind: 'kill', count: 3, area: { x: 4360, y: 1700, r: 330 }, label: 'Clear the beach dealers' },
      { kind: 'escape', label: 'Lose the heat' },
    ],
  },
  {
    id: 'the-big-score',
    title: 'The Big Score',
    intro: 'The Banco del Sol vault. Three seconds of courage.',
    reward: 1200,
    steps: [
      { kind: 'channel', place: 'bank', seconds: 3, heat: 540, r: 96, label: 'Crack the bank vault' },
      { kind: 'goto', place: 'hideout', r: 100, label: 'Get to Casa Segura' },
      { kind: 'escape', label: 'Lose the heat' },
    ],
  },
  {
    id: 'night-run',
    title: 'Night Run',
    intro: 'A cyan racer at Bay Motors has a buyer at the Lumina.',
    reward: 1000,
    steps: [
      { kind: 'steal', car: 'job', label: 'Steal the cyan racer at Bay Motors' },
      { kind: 'deliverCar', place: 'hotel', r: 110, label: 'Deliver the racer to Hotel Lumina' },
      { kind: 'escape', label: 'Lose the heat' },
    ],
  },
  {
    id: 'bay-legend',
    title: 'Bay Legend',
    intro: 'One last vault. Then a buyer. Then the night is yours.',
    reward: 2500,
    steps: [
      { kind: 'channel', place: 'bank', seconds: 4, heat: 560, r: 96, label: 'Empty the vault — the big one' },
      { kind: 'meet', point: 'pier', r: 95, label: 'Meet the buyer at the pier' },
      { kind: 'escape', label: 'Disappear into the night' },
    ],
  },
];

export const TOTAL_REWARD = MISSIONS.reduce((sum, m) => sum + m.reward, 0);
