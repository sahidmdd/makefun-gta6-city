// main.js — the game loop: input, physics glue, collision, the wanted system, the mission runner,
// the camera and the render order. Everything else lives in the modules beside it.

import { initAudio, sfx, setEngine, setSiren, toggleMute, isMuted } from './audio.js';
import { makeCity, drawCity, PITCH, ROAD, WORLD, buildingsNear, blockRect, perimeterPoint } from './city.js';
import {
  Car, Cop, Ped, Bullet, Particle,
  spawnTraffic, spawnCrowd, spawnPoliceCar, spawnFootCop, wrapAngle,
} from './entities.js';
import { MISSIONS, MissionRun, advanceStep } from './missions.js';
import { drawHUD, drawStart, drawPause, drawBigCard } from './hud.js';

const SAVE_KEY = 'bahia-marisol-save-v1';
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
const keys = Object.create(null);

let dpr = 1;
let W = 1280;
let H = 720;

// The single mutable game state. Modules read it through the small accessors below.
const game = {
  t: 0,
  hour: 9.4,
  mode: 'start', // start | play | pause | wasted | busted
  seed: 1,
  city: null,
  rnd: Math.random,
  player: { x: 0, y: 0, angle: 0, hp: 100, armour: 0, car: null, ammo: 12, mag: 12, reload: 0, cd: 0 },
  cars: [],
  peds: [],
  cops: [],
  bullets: [],
  particles: [],
  camera: { x: 0, y: 0, zoom: 0.9 },
  wanted: 0,
  heat: 0,
  money: 0,
  cleared: 0,
  run: null,
  missionCar: null,
  missionDelay: 0,
  failT: 0,
  toast: '',
  toastT: 0,
  helpT: 6,
  shake: 0,
  flash: 0,
  save: null,
  spawnTimer: 0,
  mouse: { x: 0, y: 0, down: false },
  deathT: 0,
};

game.playerPoint = () => {
  const c = game.player.car;
  return c ? { x: c.x, y: c.y } : { x: game.player.x, y: game.player.y };
};
game.facing = () => {
  const c = game.player.car;
  return c ? c.angle : game.player.angle;
};
game.objectivePoint = () => (game.run && !game.run.done ? game.run.objective(game.city) : null);

// ------------------------------------------------------------------ boot

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = Math.floor(window.innerWidth);
  H = Math.floor(window.innerHeight);
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
}

function seededRnd(seed) {
  let a = seed * 9301 + 49297;
  return () => {
    a = (a * 9301 + 49297) % 233280;
    return a / 233280;
  };
}

function readSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSave() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: game.money,
      cleared: game.cleared,
      mission: game.missionIndex || 0,
      hp: game.player.hp,
    }));
  } catch {
    /* storage may be refused in a private window: the run still plays, it just cannot be resumed */
  }
}

// newGame — builds the city, the traffic, the crowd and the player at the safehouse.
function newGame(seed = 1, resume = null) {
  game.seed = seed;
  game.rnd = seededRnd(seed);
  game.city = makeCity(seed);
  game.cars = spawnTraffic(game.city, 110, game.rnd);
  game.peds = spawnCrowd(game.city, 260, game.rnd, game.city.places.strip, 3200);
  game.cops = [];
  game.bullets = [];
  game.particles = [];
  game.wanted = 0;
  game.heat = 0;
  game.spawnTimer = 0;
  game.missionCar = null;
  game.cleared = 0;
  game.money = 0;
  game.missionIndex = 0;

  if (resume) {
    game.money = resume.money || 0;
    game.cleared = resume.cleared || 0;
    game.missionIndex = clamp(resume.mission || 0, 0, MISSIONS.length - 1);
  }

  const house = game.city.places.safehouse;
  game.player.x = house.x;
  game.player.y = house.y;
  game.player.angle = 0;
  game.player.hp = resume && resume.hp ? clamp(resume.hp, 25, 100) : 100;
  game.player.armour = 0;
  game.player.car = null;
  game.player.ammo = game.player.mag;

  game.camera.x = house.x;
  game.camera.y = house.y;
  game.camera.zoom = 0.92;

  startMission(game.missionIndex);
}

// ---------------------------------------------------------------- missions

function startMission(index) {
  if (index >= MISSIONS.length) {
    game.run = null;
    game.toast = 'ALL FOUR JOBS CLEARED — THE CITY IS YOURS';
    game.toastT = 6;
    sfx('win');
    return;
  }
  game.missionIndex = index;
  game.run = new MissionRun(MISSIONS[index], game.city, game.rnd);
  game.failT = 0;

  // Job one puts a specific car in the world; the rest reuse whatever is parked nearby.
  if (MISSIONS[index].id === 1) {
    const g = game.city.places.garage;
    const car = new Car(g.x - 90, g.y + 40, 0.2, 'sports', 'target');
    car.color = '#37d6c4';
    game.cars.push(car);
    game.missionCar = car;
  } else {
    game.missionCar = null;
  }
  game.toast = `JOB ${index + 1}: ${MISSIONS[index].title.toUpperCase()}`;
  game.toastT = 4.5;
}

function completeMission() {
  const def = game.run.def;
  game.money += def.reward;
  game.cleared += 1;
  game.run = null;
  game.missionCar = null;
  game.toast = `JOB DONE  +$${def.reward}  ·  ${def.outro}`;
  game.toastT = 6;
  sfx('win');
  writeSave();
  game.missionDelay = 3.2;
}

function failMission(reason) {
  if (game.failT > 0) return;
  game.failT = 2.6;
  game.toast = reason;
  game.toastT = 2.6;
  sfx('fail');
}

function collectKeyPress() {
  const run = game.run;
  if (!run || run.done) return;
  const s = run.step;
  if (s.kind !== 'collect' || s.scatter) return;
  const place = game.city.places[s.to];
  const p = game.playerPoint();
  if (dist(p.x, p.y, place.x, place.y) < s.radius) {
    run.got += 1;
    sfx('cash');
    commitCrime(2);
    game.toast = 'YOU GOT THE CASH — AND THE COPS';
    game.toastT = 3;
    advanceStep(game);
  }
}

// tickMission — the one place objectives are evaluated against the world.
function tickMission(dt) {
  const run = game.run;
  if (!run || run.done) return;

  if (run.timer > 0) {
    run.timer -= dt;
    if (run.timer <= 0) {
      game.run = null;
      startMission(game.missionIndex);
      failMission('OUT OF TIME — JOB RESET');
      return;
    }
  }

  const s = run.step;
  const p = game.playerPoint();
  const inCar = !!game.player.car;

  if (s.kind === 'goto') {
    const place = game.city.places[s.to];
    // Reaching the meeting point by taking the car that is parked there counts as arriving.
    const arrived = dist(p.x, p.y, place.x, place.y) < s.radius
      || (game.missionCar && game.player.car === game.missionCar);
    if (arrived) {
      sfx('pickup');
      advanceStep(game);
      if (game.run && game.run.i === 1 && game.run.def.id === 1) {
        game.toast = 'THERE IT IS — THE TEAL SIERRA';
        game.toastT = 3;
      }
    }
  } else if (s.kind === 'steal') {
    if (game.player.car && game.player.car === game.missionCar) {
      game.missionCar.kind = 'player';
      game.toast = 'CAR TAKEN — GET TO THE DOCKS';
      game.toastT = 3;
      advanceStep(game);
    }
  } else if (s.kind === 'deliver') {
    const place = game.city.places[s.to];
    const rightCar = game.missionCar ? game.player.car === game.missionCar : inCar;
    if (rightCar && dist(p.x, p.y, place.x, place.y) < s.radius) {
      sfx('cash');
      advanceStep(game);
    }
  } else if (s.kind === 'collect' && s.scatter) {
    for (const m of run.markers) {
      if (m.taken) continue;
      if (dist(p.x, p.y, m.x, m.y) < s.radius) {
        m.taken = true;
        run.got += 1;
        sfx('pickup');
        game.toast = `BAG ${run.got} / ${s.scatter}`;
        game.toastT = 2;
      }
    }
    if (run.got >= s.scatter) advanceStep(game);
  } else if (s.kind === 'escape') {
    if (game.wanted === 0) advanceStep(game);
  } else if (s.kind === 'survive') {
    run.survived += dt;
    if (Math.floor(run.survived) % 10 === 0 && Math.random() < 0.05) {
      game.toast = `${Math.max(0, Math.ceil(s.seconds - run.survived))}s LEFT`;
      game.toastT = 1.4;
    }
    if (run.survived >= s.seconds) advanceStep(game);
  }

  if (game.run && game.run.done) completeMission();
}

// ------------------------------------------------------------------ crime

function commitCrime(stars) {
  const before = game.wanted;
  game.wanted = clamp(game.wanted + stars, 0, 5);
  game.heat = 0;
  if (game.wanted > before) sfx('star');
}

function copFire(source) {
  const p = game.playerPoint();
  const base = Math.atan2(p.y - source.y, p.x - source.x);
  const spread = (Math.random() - 0.5) * 0.22;
  game.bullets.push(new Bullet(source.x, source.y, base + spread, 900, 9, 'cop'));
  sfx('shot2', 0.5);
  game.particles.push(new Particle(source.x, source.y, 0, 0, 0.12, '#ffcf8b', 5));
}

// Police cars and officers call back into the loop through the game object.
game.copFire = copFire;

function playerFire() {
  const pl = game.player;
  if (pl.cd > 0 || pl.reload > 0) return;
  if (pl.ammo <= 0) {
    sfx('ui');
    game.toast = 'EMPTY — PRESS R';
    game.toastT = 1.2;
    return;
  }
  pl.ammo -= 1;
  pl.cd = 0.19;
  const p = game.playerPoint();
  const cam = game.camera;
  const wx = cam.x + (game.mouse.x - W / 2) / cam.zoom;
  const wy = cam.y + (game.mouse.y - H / 2) / cam.zoom;
  const a = Math.atan2(wy - p.y, wx - p.x);
  game.bullets.push(new Bullet(p.x + Math.cos(a) * 16, p.y + Math.sin(a) * 16, a, 1350, 26, 'player'));
  game.shake = Math.max(game.shake, 3.5);
  sfx('shot');
}

// Hit resolution for every bullet in flight: actors first, then walls.
function resolveBullets(dt) {
  for (const b of game.bullets) {
    b.update(dt);
    if (b.dead) continue;

    if (b.owner === 'cop') {
      const p = game.playerPoint();
      if (dist(b.x, b.y, p.x, p.y) < 16) {
        b.dead = true;
        hurtPlayer(b.damage);
        game.particles.push(new Particle(b.x, b.y, 0, 0, 0.2, '#ff6b57', 6));
        continue;
      }
    } else {
      let hit = false;
      for (const cop of game.cops) {
        if (cop.dead) continue;
        if (dist(b.x, b.y, cop.x, cop.y) < 15) {
          cop.hp -= b.damage;
          b.dead = true;
          hit = true;
          if (cop.hp <= 0) {
            cop.dead = true;
            commitCrime(1);
            game.money += 25;
          }
          break;
        }
      }
      if (hit) continue;
      for (const ped of game.peds) {
        if (ped.dead) continue;
        if (dist(b.x, b.y, ped.x, ped.y) < 14) {
          ped.dead = true;
          b.dead = true;
          commitCrime(2);
          hit = true;
          break;
        }
      }
      if (hit) continue;
      for (const car of game.cars) {
        if (car === game.player.car || car.dead) continue;
        if (dist(b.x, b.y, car.x, car.y) < car.radius + 4) {
          car.hp -= b.damage * 0.5;
          b.dead = true;
          if (car.kind === 'police') commitCrime(1);
          break;
        }
      }
    }
  }
  game.bullets = game.bullets.filter((b) => !b.dead);
}

function hurtPlayer(dmg) {
  const pl = game.player;
  if (pl.armour > 0) {
    const absorbed = Math.min(pl.armour, dmg * 0.7);
    pl.armour -= absorbed;
    dmg -= absorbed;
  }
  pl.hp -= dmg;
  game.shake = Math.max(game.shake, 6);
  game.flash = Math.max(game.flash, 0.22);
  sfx('hit');
  if (pl.hp <= 0) die();
}

// ----------------------------------------------------------------- world

game.onCrash = (car, impact) => {
  if (impact > 120 && car === game.player.car) {
    hurtPlayer(Math.min(14, impact * 0.05));
    game.shake = Math.max(game.shake, 7);
  }
  if (impact > 150) sfx('crash', 0.7);
};

game.onCarDestroyed = (car) => {
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * TAU;
    game.particles.push(new Particle(car.x, car.y, Math.cos(a) * 180, Math.sin(a) * 180, 0.6 + Math.random() * 0.5, i % 3 ? '#ffb03a' : '#6b6b6b', 6 + Math.random() * 7));
  }
  sfx('crash', 1);
  if (car === game.player.car) {
    game.player.car = null;
    game.player.x = car.x;
    game.player.y = car.y;
    hurtPlayer(28);
  }
  if (car === game.missionCar) failMission('THE CAR IS WRECKED — JOB RESET');
};

function enterExitCar() {
  const pl = game.player;
  if (pl.car) {
    const car = pl.car;
    car.kind = car === game.missionCar ? 'target' : 'traffic';
    car.speed = 0;
    pl.x = car.x + Math.cos(car.angle + Math.PI / 2) * (car.radius + 16);
    pl.y = car.y + Math.sin(car.angle + Math.PI / 2) * (car.radius + 16);
    pl.car = null;
    setEngine(0, false);
    sfx('ui');
    return;
  }
  let best = null;
  let bd = 95;
  for (const car of game.cars) {
    if (car.dead) continue;
    if (car.kind === 'police') continue;
    const d = dist(pl.x, pl.y, car.x, car.y);
    if (d < bd) {
      bd = d;
      best = car;
    }
  }
  if (!best) return;
  const stolen = best.kind !== 'target';
  best.kind = 'player';
  best.speed = Math.max(best.speed, 40);
  pl.car = best;
  sfx('ui');
  if (stolen) {
    const witnessed = game.cars.some((c) => c.kind === 'police' && !c.dead && dist(c.x, c.y, pl.x, pl.y) < 800);
    if (witnessed && game.wanted < 1) {
      commitCrime(1);
      game.toast = 'GRAND THEFT AUTO — WITNESSED';
      game.toastT = 2.4;
    }
  } else {
    game.toast = 'THIS IS THE CAR';
    game.toastT = 1.6;
  }
}

function die() {
  if (game.mode !== 'play') return;
  game.mode = 'wasted';
  game.deathT = 2.6;
  game.player.hp = 0;
  game.wanted = 0;
  game.heat = 0;
  sfx('fail');
}

function busted() {
  if (game.mode !== 'play') return;
  game.mode = 'busted';
  game.deathT = 2.6;
  game.player.car = null;
  setEngine(0, false);
  game.wanted = 0;
  game.heat = 0;
  sfx('fail');
}

function respawn(spend) {
  const pl = game.player;
  const place = spend ? game.city.places.precinct : game.city.places.hospital;
  game.money = Math.max(0, Math.round(game.money * 0.92));
  pl.hp = 100;
  pl.armour = 0;
  pl.x = place.x + 80;
  pl.y = place.y + 80;
  pl.car = null;
  game.cops = [];
  game.bullets = [];
  game.camera.x = pl.x;
  game.camera.y = pl.y;
  game.mode = 'play';
  if (game.run) {
    game.run = null;
    startMission(game.missionIndex);
    game.toast = 'JOB LOST — BACK TO THE START';
    game.toastT = 3;
  }
}

// ------------------------------------------------------------------ loop

function update(dt) {
  game.t += dt;
  game.hour = (game.hour + dt * (24 / 420)) % 24;
  game.toastT = Math.max(0, game.toastT - dt);
  game.helpT = Math.max(0, game.helpT - dt);
  game.shake *= Math.pow(0.02, dt);
  game.flash = Math.max(0, game.flash - dt * 3);
  game.missionDelay = Math.max(0, game.missionDelay - dt);

  if (game.mode === 'wasted' || game.mode === 'busted') {
    game.deathT -= dt;
    if (game.deathT <= 0) respawn(game.mode === 'busted');
    return;
  }
  if (game.mode !== 'play') return;

  if (game.missionDelay > 0 && !game.run) {
    game.missionDelay -= dt;
    if (game.missionDelay <= 0) startMission(game.missionIndex + 1);
  }
  if (game.failT > 0) game.failT -= dt;

  const pl = game.player;
  pl.cd -= dt;
  if (pl.reload > 0) {
    pl.reload -= dt;
    if (pl.reload <= 0) pl.ammo = pl.mag;
  }

  // On foot: straight-line walking with building collision.
  if (!pl.car) {
    let ax = 0;
    let ay = 0;
    if (keys.KeyW || keys.ArrowUp) ay -= 1;
    if (keys.KeyS || keys.ArrowDown) ay += 1;
    if (keys.KeyA || keys.ArrowLeft) ax -= 1;
    if (keys.KeyD || keys.ArrowRight) ax += 1;
    if (ax || ay) {
      const l = Math.hypot(ax, ay);
      const sprint = keys.ShiftLeft || keys.ShiftRight;
      const sp = sprint ? 235 : 138;
      pl.x += (ax / l) * sp * dt;
      pl.y += (ay / l) * sp * dt;
      pl.angle = Math.atan2(ay, ax);
    }
    pushOutBuildings({ x: pl.x, y: pl.y }, 11, (nx, ny) => {
      pl.x = nx;
      pl.y = ny;
    });
    pl.x = clamp(pl.x, 6, WORLD - 6);
    pl.y = clamp(pl.y, 6, WORLD - 6);
  }

  // Cars: player-driven or AI.
  for (const car of game.cars) {
    if (car.kind === 'player') {
      let throttle = 0;
      if (keys.KeyW || keys.ArrowUp) throttle = 1;
      if (keys.KeyS || keys.ArrowDown) throttle = -1;
      let steer = 0;
      if (keys.KeyA || keys.ArrowLeft) steer = -1;
      if (keys.KeyD || keys.ArrowRight) steer = 1;
      car.update(dt, game, throttle, steer, keys.Space);
    } else {
      car.update(dt, game);
    }
  }

  // Cars hitting each other: a light push, no stacking.
  for (const a of game.cars) {
    if (a.dead) continue;
    for (const b of game.cars) {
      if (b === a || b.dead) continue;
      const d = dist(a.x, a.y, b.x, b.y);
      const min = a.radius + b.radius;
      if (d > 0 && d < min) {
        const push = (min - d) / 2;
        const nx = (a.x - b.x) / d;
        const ny = (a.y - b.y) / d;
        a.dvx += nx * push * 9;
        a.dvy += ny * push * 9;
        b.dvx -= nx * push * 9;
        b.dvy -= ny * push * 9;
        const rel = Math.abs(a.speed - b.speed);
        if (rel > 220) {
          a.hp -= rel * 0.03;
          b.hp -= rel * 0.03;
        }
      }
    }
  }

  for (const ped of game.peds) ped.update(dt, game);
  for (const cop of game.cops) cop.update(dt, game);

  // Running down pedestrians with a car that is actually moving.
  const pcar = pl.car;
  if (pcar && Math.abs(pcar.speed) > 130) {
    for (const ped of game.peds) {
      if (ped.dead) continue;
      if (dist(pcar.x, pcar.y, ped.x, ped.y) < pcar.radius + 8) {
        ped.dead = true;
        commitCrime(2);
        sfx('crash', 0.6);
        game.shake = Math.max(game.shake, 5);
      }
    }
  }

  resolveBullets(dt);
  for (const pt of game.particles) pt.update(dt);
  game.particles = game.particles.filter((p) => p.life > 0);

  // Wanted level: decays once the player has been out of sight for a while.
  if (game.wanted > 0) {
    const p = game.playerPoint();
    const seen = game.cops.some((c) => !c.dead && dist(c.x, c.y, p.x, p.y) < 720)
      || game.cars.some((c) => c.kind === 'police' && !c.dead && dist(c.x, c.y, p.x, p.y) < 720);
    if (seen) {
      game.heat = 0;
    } else {
      game.heat += dt;
      if (game.heat > 6.5) {
        game.wanted -= 1;
        game.heat = 0;
      }
    }
  }

  // Police response: one cruiser per active star, up to three, plus officers on foot at 3+.
  if (game.wanted > 0) {
    game.spawnTimer -= dt;
    const livePolice = game.cars.filter((c) => c.kind === 'police' && !c.dead).length;
    if (game.spawnTimer <= 0 && livePolice < Math.min(6, game.wanted + 1)) {
      game.spawnTimer = 2.8;
      const p = game.playerPoint();
      game.cars.push(spawnPoliceCar(game.city, p.x, p.y, game.rnd));
    }
    if (game.wanted >= 3 && game.cops.filter((c) => !c.dead).length < game.wanted) {
      if (Math.random() < dt * 0.6) {
        const police = game.cars.filter((c) => c.kind === 'police' && !c.dead);
        const p = game.playerPoint();
        let near = null;
        let bd = 520;
        for (const c of police) {
          const d = dist(c.x, c.y, p.x, p.y);
          if (d < bd) {
            bd = d;
            near = c;
          }
        }
        if (near) game.cops.push(spawnFootCop(near));
      }
    }
  }

  // Arrest: an officer reachable on foot ends the run.
  if (!pl.car && game.wanted > 0) {
    const p = game.playerPoint();
    for (const cop of game.cops) {
      if (!cop.dead && dist(cop.x, cop.y, p.x, p.y) < 40) {
        busted();
        break;
      }
    }
  }

  if (pl.car) {
    setEngine(pl.car.speedRatio, true);
  } else {
    setEngine(0, false);
  }
  setSiren(game.wanted > 0, dt);

  tickMission(dt);

  // Camera: leads the car, settles on the player on foot.
  const p = game.playerPoint();
  const lead = pl.car ? 0.34 : 0;
  const tx = p.x + (pl.car ? Math.cos(pl.car.angle) * pl.car.speed * lead : 0);
  const ty = p.y + (pl.car ? Math.sin(pl.car.angle) * pl.car.speed * lead : 0);
  game.camera.x += (tx - game.camera.x) * Math.min(1, dt * 5.5);
  game.camera.y += (ty - game.camera.y) * Math.min(1, dt * 5.5);
  const wantZoom = pl.car ? 0.62 + Math.min(0.18, Math.abs(pl.car.speed) / 4000) : 0.92;
  game.camera.zoom += (wantZoom - game.camera.zoom) * Math.min(1, dt * 3);
}

// pushOutBuildings — circle-versus-rect separation against the nine blocks around the point.
function pushOutBuildings(p, radius, apply) {
  const rects = buildingsNear(game.city, p.x, p.y);
  for (const f of rects) {
    const cx = clamp(p.x, f.x, f.x + f.w);
    const cy = clamp(p.y, f.y, f.y + f.h);
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > radius * radius) continue;
    if (d2 < 0.001) {
      apply(f.x - radius, p.y);
      continue;
    }
    const d = Math.sqrt(d2);
    const push = radius - d;
    apply(p.x + (dx / d) * push, p.y + (dy / d) * push);
  }
}

// ---------------------------------------------------------------- render

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b1117';
  ctx.fillRect(0, 0, W, H);

  const cam = game.camera;
  const night = game.hour < 6.2 || game.hour > 19.4;
  const dark = Math.max(0, Math.min(1, (game.hour > 19 ? game.hour - 19 : game.hour < 6.2 ? 6.2 - game.hour : 0) / 3));
  const sh = game.shake;
  const ox = (Math.random() - 0.5) * sh;
  const oy = (Math.random() - 0.5) * sh;

  ctx.save();
  ctx.translate(W / 2 + ox, H / 2 + oy);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  const vw = W / cam.zoom;
  const vh = H / cam.zoom;
  const view = { x0: cam.x - vw / 2, y0: cam.y - vh / 2, x1: cam.x + vw / 2, y1: cam.y + vh / 2 };

  drawCity(ctx, game.city, view, night);
  drawMarkers(ctx);
  for (const ped of game.peds) ped.draw(ctx, game.t);
  for (const car of game.cars) car.draw(ctx, game.t);
  for (const cop of game.cops) cop.draw(ctx, game.t);
  if (!game.player.car) drawPlayerOnFoot(ctx);
  for (const b of game.bullets) b.draw(ctx);
  for (const pt of game.particles) pt.draw(ctx);

  ctx.restore();

  // Day/night wash and the muzzle flash read as one grade over the whole frame.
  if (dark > 0.02) {
    ctx.fillStyle = `rgba(10,22,52,${0.42 * dark})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (game.flash > 0.01) {
    ctx.fillStyle = `rgba(255,60,40,${game.flash * 0.5})`;
    ctx.fillRect(0, 0, W, H);
  }

  if (game.mode === 'start') {
    drawStart(ctx, game, W, H);
    return;
  }
  drawHUD(ctx, game, W, H);
  if (game.mode === 'pause') drawPause(ctx, game, W, H);
  if (game.mode === 'wasted') drawBigCard(ctx, game, W, H, 'WASTED', 'You wake up at the clinic, lighter in the wallet.', '#ff5a4d');
  if (game.mode === 'busted') drawBigCard(ctx, game, W, H, 'BUSTED', 'The precinct books you and takes a cut.', '#5aa8ff');
}

// Ground markers: a pulsing ring for the live objective and the mission car.
function drawMarkers(ctx) {
  const obj = game.objectivePoint();
  const pulse = (Math.sin(game.t * 3) + 1) / 2;
  if (obj) {
    ctx.strokeStyle = `rgba(245,196,81,${0.45 + pulse * 0.4})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(obj.x, obj.y, obj.r * (0.72 + pulse * 0.16), 0, TAU);
    ctx.stroke();
    ctx.fillStyle = `rgba(245,196,81,${0.1 + pulse * 0.08})`;
    ctx.beginPath();
    ctx.arc(obj.x, obj.y, obj.r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#f5c451';
    ctx.beginPath();
    ctx.moveTo(obj.x, obj.y - 26 - pulse * 6);
    ctx.lineTo(obj.x - 10, obj.y - 44 - pulse * 6);
    ctx.lineTo(obj.x + 10, obj.y - 44 - pulse * 6);
    ctx.closePath();
    ctx.fill();
  }
}

function drawPlayerOnFoot(ctx) {
  const pl = game.player;
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  ctx.beginPath();
  ctx.ellipse(pl.x + 2, pl.y + 4, 11, 9, 0, 0, TAU);
  ctx.fill();

  ctx.save();
  ctx.translate(pl.x, pl.y);
  ctx.rotate(pl.angle);
  ctx.fillStyle = '#f0e6d2';
  ctx.beginPath();
  ctx.ellipse(0, 0, 11, 9, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#1d2b3a';
  ctx.beginPath();
  ctx.ellipse(-1, 0, 8, 6.5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#e6c39a';
  ctx.beginPath();
  ctx.arc(3, 0, 4.6, 0, TAU);
  ctx.fill();
  // The pistol points where the mouse points.
  const cam = game.camera;
  const wx = cam.x + (game.mouse.x - W / 2) / cam.zoom;
  const wy = cam.y + (game.mouse.y - H / 2) / cam.zoom;
  ctx.rotate(wrapAngle(Math.atan2(wy - pl.y, wx - pl.x) - pl.angle));
  ctx.fillStyle = '#15181c';
  ctx.fillRect(6, -1.6, 12, 3.2);
  ctx.restore();
}

// ----------------------------------------------------------------- input

function onKeyDown(e) {
  if (e.code === 'Escape') {
    if (game.mode === 'play') {
      game.mode = 'pause';
      writeSave();
      sfx('ui');
    } else if (game.mode === 'pause') {
      game.mode = 'play';
      sfx('ui');
    }
    e.preventDefault();
    return;
  }
  if (game.mode === 'pause' && e.code === 'KeyQ') {
    game.save = readSave();
    game.mode = 'start';
    return;
  }
  if (game.mode === 'start') {
    if (e.code === 'Enter') {
      initAudio();
      if (game.save) newGame(1, game.save);
      game.mode = 'play';
      sfx('ui');
      writeSave();
    } else if (e.code === 'KeyN') {
      initAudio();
      localStorage.removeItem(SAVE_KEY);
      game.save = null;
      newGame(1, null);
      game.mode = 'play';
      sfx('ui');
    }
    return;
  }
  if (game.mode !== 'play') return;

  keys[e.code] = true;
  if (e.code === 'KeyE') enterExitCar();
  if (e.code === 'KeyR' && game.player.reload <= 0 && game.player.ammo < game.player.mag) {
    game.player.reload = 1.1;
    sfx('ui');
  }
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyF') collectKeyPress();
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
}

function onKeyUp(e) {
  keys[e.code] = false;
}

function onMouseMove(e) {
  const r = canvas.getBoundingClientRect();
  game.mouse.x = e.clientX - r.left;
  game.mouse.y = e.clientY - r.top;
}

function onMouseDown(e) {
  if (game.mode !== 'play') return;
  if (e.button === 0) {
    game.mouse.down = true;
    playerFire();
  }
}

function onMouseUp() {
  game.mouse.down = false;
}

// --------------------------------------------------------------- shot rig

// setupShot — deterministic frames for the screenshots: the title, a street with traffic, a chase
// with the wanted level up, and a mission objective on the HUD.
function setupShot(name) {
  const place = game.city.places.strip;
  if (name === 'start') {
    game.mode = 'start';
    game.camera.x = game.city.places.safehouse.x;
    game.camera.y = game.city.places.safehouse.y;
    return;
  }
  const avenueY = 9 * PITCH;
  game.mode = 'play';
  game.helpT = 0;

  if (name === 'street') {
    game.hour = 10.6;
    game.money = 7420;
    const car = new Car(place.x - 40, avenueY + 30, 0, 'sports', 'player');
    car.speed = 190;
    game.cars.push(car);
    game.player.car = car;
    game.player.x = car.x;
    game.player.y = car.y;
    game.player.hp = 88;
    game.player.armour = 55;
    // A cluster of traffic ahead and behind, plus a crowd on the kerb, so the street is alive.
    const specs = ['sedan', 'taxi', 'coupe', 'van', 'sedan', 'truck', 'coupe'];
    for (let i = 0; i < specs.length; i++) {
      const ahead = i < 4;
      const off = (ahead ? 1 : -1) * (210 + i * 130);
      const t = new Car(place.x + off, avenueY + 30, ahead ? 0 : Math.PI, specs[i], 'traffic');
      t.speed = 150;
      t.axis = 'h';
      t.line = 9;
      t.dir = ahead ? 1 : -1;
      game.cars.push(t);
    }
    // Kerbside crowd on both blocks that face this avenue, close enough to read at this zoom.
    for (let i = 0; i < 26; i++) {
      const bj = i % 2 ? 8 : 9;
      const bi = Math.floor(place.x / PITCH) - 2 + (i % 6);
      const b = game.city.blockMap.get(bi + ',' + bj);
      if (!b) continue;
      const t = (i * 0.37) % 1;
      const pt = perimeterPoint(b.rect, t);
      game.peds.push(new Ped(pt.x, pt.y, b.rect, i % 6));
    }
    game.camera.x = car.x;
    game.camera.y = car.y;
    game.camera.zoom = 0.74;
    startMission(2);
    game.run.i = 0;
    game.run.prepare(game.city, game.rnd, 0);
    game.toast = '';
    game.toastT = 0;
    return;
  }

  if (name === 'chase') {
    game.hour = 18.3;
    const car = new Car(place.x + 120, avenueY + 30, 0, 'coupe', 'player');
    car.speed = 300;
    game.cars.push(car);
    game.player.car = car;
    game.player.x = car.x;
    game.player.y = car.y;
    game.player.hp = 74;
    game.player.armour = 40;
    game.wanted = 4;
    game.money = 12450;
    for (let i = 0; i < 3; i++) {
      const pc = new Car(place.x - 180 - i * 190, avenueY + 30 + (i % 2 ? 0 : -34), 0, 'police', 'police');
      pc.speed = 320;
      game.cars.push(pc);
    }
    for (let i = 0; i < 2; i++) {
      game.cops.push(new Cop(car.x + 60 + i * 30, car.y - 70 - i * 20));
    }
    game.camera.x = car.x;
    game.camera.y = car.y;
    game.camera.zoom = 0.66;
    startMission(3);
    game.run.i = 1;
    game.run.prepare(game.city, game.rnd, 1);
    game.toast = 'HOLD OUT — 45s';
    game.toastT = 4;
    return;
  }

  if (name === 'mission') {
    game.hour = 15.1;
    const shop = game.city.places.shop;
    const car = new Car(shop.x - 150, 3 * PITCH + 30, 0, 'sedan', 'player');
    car.speed = 60;
    game.cars.push(car);
    game.player.car = car;
    game.player.x = car.x;
    game.player.y = car.y;
    game.player.hp = 96;
    game.player.armour = 100;
    game.wanted = 2;
    game.money = 3820;
    for (let i = 0; i < 2; i++) {
      const pc = new Car(shop.x - 120 - i * 150, 3 * PITCH + 30, 0, 'police', 'police');
      game.cars.push(pc);
    }
    game.camera.x = car.x;
    game.camera.y = car.y;
    game.camera.zoom = 0.7;
    startMission(1);
    game.run.i = 0;
    game.run.prepare(game.city, game.rnd, 0);
    game.toast = '';
    game.toastT = 0;
  }
}

// ------------------------------------------------------------------ boot

let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
  last = ts;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

function boot() {
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
  });

  const params = new URLSearchParams(location.search);
  const seed = Number(params.get('seed') || 1) || 1;
  game.save = readSave();
  newGame(seed, null);
  const shot = params.get('shot');
  if (shot) setupShot(shot);
  // A read-only handle for play-testing: ?debug exposes the state, nothing else changes.
  if (params.has('debug')) window.bahia = game;

  const status = document.getElementById('status');
  if (status) status.textContent = 'Bahia Marisol is running.';

  last = performance.now();
  requestAnimationFrame(frame);
}

boot();
