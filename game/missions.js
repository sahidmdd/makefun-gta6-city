// missions.js — the four-job story chain, its markers and its state machine. Each mission is data;
// the runner advances a step when the world agrees the objective is met.

import { WORLD, PITCH, roadSnap } from './city.js';

// Four jobs, chained: a courier run, a shakedown that goes loud, a package sweep against the clock
// and a last stand at the tower. Each ends with cash and a line of story.
export const MISSIONS = [
  {
    id: 1,
    title: 'Wake Up Call',
    giver: 'RICO',
    reward: 450,
    brief: '"You slept through the alarm, kid. My Sierra is parked up in Coral Heights. Bring it to the docks before the tide turns."',
    outro: '"Clean run. Here is your cut — do not spend it all on the strip."',
    steps: [
      { kind: 'goto', to: 'garage', radius: 105, text: 'Meet Rico at the Coral Heights garage' },
      { kind: 'steal', radius: 90, text: 'Take the teal Sierra GT' },
      { kind: 'deliver', to: 'docks', radius: 135, text: 'Drive it to the Puerto Dulce docks' },
    ],
  },
  {
    id: 2,
    title: 'Shakedown',
    giver: 'RICO',
    reward: 900,
    brief: '"The pawn shop on Calle Ocho is holding my money. Walk in, take it, and do not let the cops keep the receipt."',
    outro: '"Two stars and you still made it. You are either lucky or stupid. Either way, paid."',
    steps: [
      { kind: 'goto', to: 'shop', radius: 100, text: 'Go to the Neon Quarter pawn shop' },
      { kind: 'collect', to: 'shop', radius: 70, count: 1, text: 'Collect the cash — this will bring heat' },
      { kind: 'escape', text: 'Lose the police' },
    ],
  },
  {
    id: 3,
    title: 'Paper Trail',
    giver: 'VERA',
    reward: 1500,
    brief: '"Three drop bags, all over the city, and the courier is already talking. Ninety seconds each, no second chances."',
    outro: '"All three. I might have to keep you."',
    timeLimit: 210,
    steps: [
      { kind: 'goto', to: 'strip', radius: 100, text: 'Meet Vera on the Calle Ocho strip' },
      { kind: 'collect', scatter: 3, radius: 80, text: 'Collect the three drop bags' },
      { kind: 'deliver', to: 'safehouse', radius: 120, text: 'Bring the bags back to the safehouse' },
    ],
  },
  {
    id: 4,
    title: 'The Long Way Home',
    giver: 'VERA',
    reward: 4000,
    brief: '"They know the tower. Take the stairs, hold the lobby, then get to the safehouse and stay alive."',
    outro: '"Bahia Marisol is yours, kid. Nobody runs this city but us."',
    steps: [
      { kind: 'goto', to: 'tower', radius: 110, text: 'Reach the Torre Marisol' },
      { kind: 'survive', seconds: 45, text: 'Hold out against the response' },
      { kind: 'deliver', to: 'safehouse', radius: 120, text: 'Escape to the safehouse' },
    ],
  },
];

function pointOnRoad(rnd) {
  const line = 1 + Math.floor(rnd() * (WORLD / PITCH - 2));
  const along = 60 + rnd() * (WORLD - 120);
  return rnd() < 0.5
    ? { x: along, y: line * PITCH + 40 }
    : { x: line * PITCH + 40, y: along };
}

export class MissionRun {
  constructor(def, city, rnd) {
    this.def = def;
    this.i = 0;
    this.timer = def.timeLimit || 0;
    this.got = 0;
    this.survived = 0;
    this.started = 0;
    this.markers = [];
    this.done = false;
    this.stepText = def.steps[0].text;
    this.stepTime = 0;
    this.prepare(city, rnd, 0);
  }

  get step() {
    return this.def.steps[this.i];
  }

  // prepare — sets up whatever the current step needs in the world before it can be met.
  prepare(city, rnd, index) {
    const s = this.def.steps[index];
    this.stepText = s.text;
    this.stepTime = 0;
    if (s.kind === 'collect' && s.scatter) {
      this.markers = [];
      const taken = new Set();
      for (let n = 0; n < s.scatter; n++) {
        let p = pointOnRoad(rnd);
        let guard = 0;
        while (taken.has(Math.round(p.x / 500) + ':' + Math.round(p.y / 500)) && guard++ < 40) p = pointOnRoad(rnd);
        taken.add(Math.round(p.x / 500) + ':' + Math.round(p.y / 500));
        this.markers.push({ x: p.x, y: p.y, taken: false });
      }
    }
  }

  // The single live objective point the HUD arrow and the radar blip point at.
  objective(city) {
    const s = this.step;
    if (!s) return null;
    if (s.kind === 'collect' && s.scatter) {
      const left = this.markers.filter((m) => !m.taken);
      if (!left.length) return null;
      let best = left[0];
      let bd = Infinity;
      for (const m of left) {
        const d = m.x * m.x + m.y * m.y;
        if (d < bd) {
          bd = d;
          best = m;
        }
      }
      return { x: best.x, y: best.y, r: s.radius };
    }
    const place = city.places[s.to];
    if (!place) return null;
    return { x: place.x, y: place.y, r: s.radius };
  }
}

// advanceStep — returns true when the run has moved to a new step (so the HUD can flash).
export function advanceStep(game) {
  game.run.i += 1;
  if (game.run.i >= game.run.def.steps.length) {
    game.run.done = true;
    return true;
  }
  game.run.prepare(game.city, game.rnd, game.run.i);
  return true;
}
