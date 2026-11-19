// NEON BAY — the six-mission story chain, as data.
// The world simulation interprets these steps; rewards total exactly $6,200.
//
// Step types the engine understands:
//   steal    — get into the named target car (target: 'coupe' | 'jobcar')
//   deliver  — bring the target car to the point
//   pickup   — walk over the package at the point (adds `heat`)
//   kill     — take out `count` dealers spawned at the beach spots
//   channel  — stand at the point for `dur` seconds (adds `heat` at the end)
//   meet     — walk to the person waiting at the point
//   escape   — get the wanted level back to zero stars
// Coordinates are filled in by the world from the city (place doors, the
// package spot, the plaza), so this file stays pure story data.

export const MISSIONS = [
  {
    id: 'm1', title: 'First Wheels', reward: 250,
    brief: 'Steal the gold coupe at Bay Motors and drop it at Taller Sol.',
    steps: [
      { type: 'steal', target: 'coupe', label: 'Steal the gold coupe' },
      { type: 'deliver', target: 'coupe', at: 'garage', label: 'Deliver the coupe to Taller Sol' },
    ],
  },
  {
    id: 'm2', title: 'Package Run', reward: 450,
    brief: 'Pick up the package on the boardwalk and take it to Market Sol.',
    steps: [
      { type: 'pickup', at: 'package', heat: 210, label: 'Pick up the package' },
      { type: 'goto', at: 'market', label: 'Take the package to Market Sol' },
    ],
  },
  {
    id: 'm3', title: 'Beachside Business', reward: 800,
    brief: 'Shut down the three dealers working the beach, then lose the heat.',
    steps: [
      { type: 'kill', count: 3, label: 'Take out the beach dealers' },
      { type: 'escape', label: 'Lose the wanted level' },
    ],
  },
  {
    id: 'm4', title: 'The Big Score', reward: 1200,
    brief: 'Crack the bank vault, then disappear.',
    steps: [
      { type: 'channel', at: 'bank', dur: 3, heat: 540, label: 'Crack the bank vault' },
      { type: 'escape', label: 'Lose the wanted level' },
    ],
  },
  {
    id: 'm5', title: 'Night Run', reward: 1000,
    brief: 'Lift the cyan racer from Bay Motors, drop it at Hotel Lumina, vanish.',
    steps: [
      { type: 'steal', target: 'jobcar', label: 'Steal the cyan racer' },
      { type: 'deliver', target: 'jobcar', at: 'hotel', label: 'Deliver the racer to Hotel Lumina' },
      { type: 'escape', label: 'Lose the wanted level' },
    ],
  },
  {
    id: 'm6', title: 'Bay Legend', reward: 2500,
    brief: 'Empty the vault one last time, meet the buyer at the plaza, get out clean.',
    steps: [
      { type: 'channel', at: 'bank', dur: 4, heat: 540, label: 'Empty the bank vault' },
      { type: 'meet', at: 'plaza', label: 'Meet the buyer at the plaza' },
      { type: 'escape', label: 'Lose the wanted level' },
    ],
  },
];

export const TOTAL_REWARD = MISSIONS.reduce((s, m) => s + m.reward, 0);
