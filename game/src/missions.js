// NEON BAY v3 — the six-mission story chain. Steps are data; world.js runs them.
// Rewards sum to exactly $6,200. Coordinates resolve from the generated city's places.
import { placeById } from './city.js';

export function buildMissions(city) {
  const hotel = placeById(city, 'hotel'), bank = placeById(city, 'bank'),
    safe = placeById(city, 'safehouse'), lot = placeById(city, 'carlot');
  const coupe = city.missionSpots.coupe, job = city.missionSpots.job;
  return [
    { id: 'm1', title: 'First Wheels', reward: 250, intro: 'Steal the gold coupe at Bay Motors and drop it at Hotel Lumina.',
      steps: [
        { t: 'goto', x: lot.x, y: lot.y, label: 'Go to Bay Motors' },
        { t: 'steal', car: 'coupe', x: coupe.x, y: coupe.y, label: 'Steal the gold coupe' },
        { t: 'deliver', car: 'coupe', x: hotel.x, y: hotel.y, label: 'Deliver the coupe to Hotel Lumina' },
      ] },
    { id: 'm2', title: 'Package Run', reward: 450, intro: 'Pick up the hot package at the plaza and bring it to Casa Segura.',
      steps: [
        { t: 'goto', x: 2816, y: 2816, label: 'Go to the plaza drop' },
        { t: 'pickup', x: 2816, y: 2816, heat: 210, label: 'Pick up the package' },
        { t: 'deliver', x: safe.x, y: safe.y, label: 'Deliver the package to Casa Segura' },
      ] },
    { id: 'm3', title: 'Beachside Business', reward: 800, intro: 'Three rival dealers are working our beach. Shut them down and lose the heat.',
      steps: [
        { t: 'goto', x: 4200, y: 1800, label: 'Go to the beach' },
        { t: 'kill', n: 3, label: 'Shut down the beach dealers' },
        { t: 'escape', label: 'Lose the heat' },
      ] },
    { id: 'm4', title: 'The Big Score', reward: 1200, intro: 'Crack the Banco Neon vault, then disappear to Casa Segura.',
      steps: [
        { t: 'goto', x: bank.x, y: bank.y, label: 'Go to Banco Neon' },
        { t: 'channel', x: bank.x, y: bank.y, dur: 3, heat: 540, label: 'Crack the vault' },
        { t: 'goto', x: safe.x, y: safe.y, label: 'Get to Casa Segura' },
        { t: 'escape', label: 'Lose the heat' },
      ] },
    { id: 'm5', title: 'Night Run', reward: 1000, intro: 'Lift the cyan racer from Bay Motors, deliver it to Hotel Lumina, vanish.',
      steps: [
        { t: 'goto', x: lot.x, y: lot.y, label: 'Go to Bay Motors' },
        { t: 'steal', car: 'job', x: job.x, y: job.y, label: 'Steal the cyan racer' },
        { t: 'deliver', car: 'job', x: hotel.x, y: hotel.y, label: 'Deliver the racer to Hotel Lumina' },
        { t: 'escape', label: 'Lose the heat' },
      ] },
    { id: 'm6', title: 'Bay Legend', reward: 2500, intro: 'One last vault. Empty Banco Neon, meet the buyer on the sand, and be a ghost.',
      steps: [
        { t: 'goto', x: bank.x, y: bank.y, label: 'Go to Banco Neon' },
        { t: 'channel', x: bank.x, y: bank.y, dur: 4, heat: 600, label: 'Empty the vault' },
        { t: 'meet', x: 4300, y: 1200, label: 'Meet the buyer on the beach' },
        { t: 'escape', label: 'Lose the heat' },
      ] },
  ];
}
export const TOTAL_REWARD = 6200;
