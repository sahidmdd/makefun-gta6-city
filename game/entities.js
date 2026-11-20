// entities.js — every actor in the street: cars with arcade physics, lane traffic AI, pedestrians on
// the kerb, police that chase and shoot, bullets and debris. All drawn with canvas primitives.

import { PITCH, WORLD, buildingsNear, perimeterPoint, blockAt } from './city.js';

const LANE = 30; // distance from a road's centre line to the middle of a lane
const TAU = Math.PI * 2;

export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// The car catalogue: original names, all silhouettes drawn from the same rounded-box body.
export const SPECS = {
  sedan: { name: 'Marisol 240', w: 62, h: 28, max: 400, accel: 300, grip: 3.4, hp: 100, color: '#c2452f' },
  coupe: { name: 'Caña Coupé', w: 58, h: 26, max: 470, accel: 360, grip: 3.8, hp: 90, color: '#2f6fb5' },
  van: { name: 'Bahia Van', w: 74, h: 32, max: 330, accel: 240, grip: 2.6, hp: 140, color: '#cfc7b4' },
  taxi: { name: 'Taxi Sol', w: 62, h: 28, max: 390, accel: 300, grip: 3.4, hp: 100, color: '#f0b429' },
  sports: { name: 'Sierra GT', w: 60, h: 26, max: 560, accel: 430, grip: 4.4, hp: 85, color: '#37d6c4' },
  police: { name: 'Patrulla', w: 64, h: 29, max: 520, accel: 420, grip: 4.2, hp: 130, color: '#e8ecef' },
  truck: { name: 'Carga 700', w: 86, h: 36, max: 280, accel: 200, grip: 2.2, hp: 190, color: '#8a8f96' },
};

const TRAFFIC_KINDS = ['sedan', 'sedan', 'coupe', 'van', 'taxi', 'truck', 'sedan', 'coupe'];

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

// Push a circle out of every nearby building footprint; returns the impact speed it absorbed.
function resolveBuildings(city, body, radius) {
  const rects = buildingsNear(city, body.x, body.y);
  let impact = 0;
  for (const f of rects) {
    const cx = clamp(body.x, f.x, f.x + f.w);
    const cy = clamp(body.y, f.y, f.y + f.h);
    let dx = body.x - cx;
    let dy = body.y - cy;
    let d2 = dx * dx + dy * dy;
    if (d2 > radius * radius) continue;
    if (d2 < 0.0001) {
      // Dead centre: push out along the shallowest axis.
      const left = body.x - f.x;
      const right = f.x + f.w - body.x;
      const up = body.y - f.y;
      const down = f.y + f.h - body.y;
      const m = Math.min(left, right, up, down);
      if (m === left) body.x = f.x - radius;
      else if (m === right) body.x = f.x + f.w + radius;
      else if (m === up) body.y = f.y - radius;
      else body.y = f.y + f.h + radius;
      impact = Math.max(impact, 60);
      continue;
    }
    const d = Math.sqrt(d2);
    const push = radius - d;
    body.x += (dx / d) * push;
    body.y += (dy / d) * push;
    impact = Math.max(impact, (0.5 - d / radius) * 200);
  }
  return impact;
}

export class Car {
  constructor(x, y, angle, specKey, kind = 'traffic') {
    const spec = SPECS[specKey] || SPECS.sedan;
    this.spec = spec;
    this.specKey = specKey;
    this.kind = kind; // 'traffic' | 'player' | 'police' | 'target'
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.speed = 0;
    this.steer = 0;
    this.dvx = 0; // sideways push-back from an impact
    this.dvy = 0;
    this.w = spec.w;
    this.h = spec.h;
    this.radius = spec.w * 0.44;
    this.hp = spec.hp;
    this.color = spec.color;
    this.dead = false;
    this.smoke = 0;

    // Lane state for traffic AI.
    this.axis = Math.abs(Math.cos(angle)) > 0.5 ? 'h' : 'v';
    this.line = Math.round((this.axis === 'h' ? y : x) / PITCH);
    this.dir = this.axis === 'h' ? (Math.cos(angle) > 0 ? 1 : -1) : Math.sin(angle) > 0 ? 1 : -1;
    this.node = -1;
    this.cruise = 110 + Math.random() * 50;

    // Police state.
    this.fireCd = 0;
    this.stuck = 0;
    this.wander = 0;
  }

  get speedRatio() {
    return clamp(Math.abs(this.speed) / this.spec.max, 0, 1);
  }

  laneX() {
    return this.line * PITCH + (this.dir > 0 ? -LANE : LANE);
  }

  laneY() {
    return this.line * PITCH + (this.dir > 0 ? LANE : -LANE);
  }

  // Snap to lane, then drive. Player and police steer themselves; traffic follows the grid.
  update(dt, game, throttle = 0, steer = 0, brake = false) {
    if (this.dead) return;
    this.fireCd -= dt;

    if (this.kind === 'traffic') this.driveLane(dt, game);
    else if (this.kind === 'police') this.driveChase(dt, game);
    else this.drivePlayer(dt, throttle, steer, brake);

    // Impact push-back decays fast; it is what makes a side-swipe feel like a hit.
    this.x += this.dvx * dt;
    this.y += this.dvy * dt;
    this.dvx *= Math.pow(0.02, dt);
    this.dvy *= Math.pow(0.02, dt);

    const impact = resolveBuildings(game.city, this, this.radius);
    if (impact > 30) {
      this.hp -= impact * 0.16;
      this.speed *= 0.24;
      if (impact > 90) game.onCrash(this, impact);
    }

    this.x = clamp(this.x, 8, WORLD - 8);
    this.y = clamp(this.y, 8, WORLD - 8);

    if (this.hp <= 0 && !this.dead) {
      this.dead = true;
      this.speed = 0;
      game.onCarDestroyed(this);
    }
    if (this.hp < this.spec.hp * 0.45) this.smoke += dt;
  }

  drivePlayer(dt, throttle, steer, brake) {
    const spec = this.spec;
    const target = throttle * spec.max;
    if (throttle > 0) this.speed += spec.accel * dt;
    else if (throttle < 0) this.speed -= spec.accel * 1.15 * dt;
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), spec.max * 0.9 * dt);

    if (brake) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), spec.max * 2.4 * dt);
    this.speed = clamp(this.speed, -spec.max * 0.42, target > 0 ? spec.max : spec.max);

    this.steer += (steer - this.steer) * Math.min(1, dt * 9);
    const grip = clamp(Math.abs(this.speed) / 150, 0, 1);
    this.angle += this.steer * spec.grip * grip * dt * Math.sign(this.speed || 1);

    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;
  }

  driveChase(dt, game) {
    const target = game.playerPoint();
    const want = Math.atan2(target.y - this.y, target.x - this.x);
    const diff = wrapAngle(want - this.angle);
    const turn = clamp(diff, -3.2 * dt, 3.2 * dt);
    this.angle += turn;
    // Reverse out of a wall rather than grinding on it.
    if (Math.abs(diff) > 1.9 && Math.abs(this.speed) < 30) this.stuck += dt;
    else this.stuck = 0;
    if (this.stuck > 0.7) {
      this.speed = -90;
      this.stuck = 0;
    } else {
      this.speed = Math.min(this.spec.max, this.speed + this.spec.accel * 0.85 * dt);
    }
    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;

    const dist = Math.hypot(target.x - this.x, target.y - this.y);
    if (dist < 360 && this.fireCd <= 0 && game.wanted > 0) {
      this.fireCd = 0.75 + Math.random() * 0.7;
      game.copFire(this);
    }
  }

  driveLane(dt, game) {
    // Slow for whatever is straight ahead in the same lane.
    let gap = 999;
    for (const other of game.cars) {
      if (other === this || other.dead) continue;
      if (other.axis !== this.axis) continue;
      if (this.axis === 'h') {
        if (Math.sign(other.y - this.laneY()) * 1 !== 0 && Math.abs(other.y - this.laneY()) > 26) continue;
        const d = (other.x - this.x) * this.dir;
        if (d > 0 && d < gap) gap = d;
      } else {
        if (Math.abs(other.x - this.laneX()) > 26) continue;
        const d = (other.y - this.y) * this.dir;
        if (d > 0 && d < gap) gap = d;
      }
    }
    const want = gap < 90 ? 0 : gap < 190 ? this.cruise * 0.45 : this.cruise;
    this.speed += clamp(want - this.speed, -260 * dt, 120 * dt);

    if (this.axis === 'h') {
      this.x += this.dir * this.speed * dt;
      this.y += (this.laneY() - this.y) * Math.min(1, dt * 4);
      this.angle = this.dir > 0 ? 0 : Math.PI;
    } else {
      this.y += this.dir * this.speed * dt;
      this.x += (this.laneX() - this.x) * Math.min(1, dt * 4);
      this.angle = this.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }

    // Junction decision: straight on, or a turn onto the crossing road.
    const along = this.axis === 'h' ? this.x : this.y;
    const node = Math.round(along / PITCH);
    if (node !== this.node && Math.abs(along - node * PITCH) < 26 && node > 0 && node < 20) {
      this.node = node;
      if (Math.random() < 0.26) {
        const turnDir = Math.random() < 0.5 ? 1 : -1;
        if (this.axis === 'h') {
          this.axis = 'v';
          this.line = node;
          this.dir = turnDir;
          this.x = this.line * PITCH + (turnDir > 0 ? -LANE : LANE);
        } else {
          this.axis = 'h';
          this.line = node;
          this.dir = turnDir;
          this.y = this.line * PITCH + (turnDir > 0 ? LANE : -LANE);
        }
      }
    }

    // Wrap around the island so traffic never thins out.
    if (this.x < -60) this.x = WORLD + 40;
    if (this.x > WORLD + 60) this.x = -40;
    if (this.y < -60) this.y = WORLD + 40;
    if (this.y > WORLD + 60) this.y = -40;
  }

  draw(ctx, t) {
    const w = this.w;
    const h = this.h;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(ctx, -w / 2 + 3, -h / 2 + 4, w, h, 7);
    ctx.fill();

    ctx.fillStyle = this.dead ? '#3a3a3a' : this.color;
    roundRect(ctx, -w / 2, -h / 2, w, h, 7);
    ctx.fill();

    // Cabin and windscreen.
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    roundRect(ctx, -w * 0.16, -h / 2 + 3, w * 0.44, h - 6, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(150,220,235,0.85)';
    roundRect(ctx, w * 0.2, -h / 2 + 4, w * 0.09, h - 8, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(150,220,235,0.55)';
    roundRect(ctx, -w * 0.19, -h / 2 + 4, w * 0.08, h - 8, 3);
    ctx.fill();

    // Headlights and tail lights.
    ctx.fillStyle = '#ffeeb0';
    ctx.fillRect(w / 2 - 4, -h / 2 + 3, 4, 6);
    ctx.fillRect(w / 2 - 4, h / 2 - 9, 4, 6);
    ctx.fillStyle = '#d8433a';
    ctx.fillRect(-w / 2, -h / 2 + 3, 3, 6);
    ctx.fillRect(-w / 2, h / 2 - 9, 3, 6);

    // Police livery: a lit bar that alternates red and blue.
    if (this.kind === 'police') {
      ctx.fillStyle = '#12242e';
      roundRect(ctx, -w * 0.1, -h / 2 + 2, w * 0.26, h - 4, 3);
      ctx.fill();
      const on = Math.floor(t * 4) % 2 === 0;
      ctx.fillStyle = on ? '#ff3b30' : '#2f74ff';
      ctx.fillRect(-w * 0.08, -h / 2 + 1, w * 0.11, 5);
      ctx.fillStyle = on ? '#2f74ff' : '#ff3b30';
      ctx.fillRect(w * 0.04, -h / 2 + 1, w * 0.11, 5);
    }

    ctx.restore();

    // Smoke from a badly damaged car.
    if (this.smoke > 0 && !this.dead) {
      ctx.fillStyle = `rgba(90,90,90,${0.1 + 0.12 * Math.sin(t * 6)})`;
      ctx.beginPath();
      ctx.arc(this.x - Math.cos(this.angle) * 20, this.y - Math.sin(this.angle) * 20, 13 + Math.sin(t * 5) * 3, 0, TAU);
      ctx.fill();
    }
  }
}

export class Ped {
  constructor(x, y, rect, variant) {
    this.x = x;
    this.y = y;
    this.rect = rect;
    this.variant = variant;
    this.t = Math.random();
    this.speed = 28 + Math.random() * 22;
    this.angle = Math.random() * TAU;
    this.target = perimeterPoint(rect, this.t);
    this.hp = 20;
    this.dead = false;
    this.panic = 0;
    this.shirt = ['#e05a4a', '#3f7fb3', '#e8c05a', '#63b06a', '#a86bc0', '#d9d4c8'][variant % 6];
    this.pants = ['#2f3a4a', '#4a4038', '#3b3b46'][variant % 3];
  }

  update(dt, game) {
    if (this.dead) return;
    if (game.wanted >= 2) this.panic = Math.max(this.panic, 3);
    this.panic = Math.max(0, this.panic - dt);

    const sp = this.speed * (this.panic > 0 ? 2.6 : 1);
    const dx = this.target.x - this.x;
    const dy = this.target.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 6) {
      this.t += (Math.random() < 0.5 ? -1 : 1) * (0.06 + Math.random() * 0.12);
      this.target = perimeterPoint(this.rect, this.t);
    } else {
      this.x += (dx / d) * sp * dt;
      this.y += (dy / d) * sp * dt;
      this.angle = Math.atan2(dy, dx);
    }
  }

  draw(ctx, t) {
    if (this.dead) {
      ctx.fillStyle = 'rgba(120,20,20,0.55)';
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, 13, 9, this.angle, 0, TAU);
      ctx.fill();
      return;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(this.x + 2, this.y + 3, 9, 8, 0, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    // Torso, then head, then a swing of the shoulders so a walking crowd reads as alive.
    const swing = Math.sin(t * 7 + this.t * 9) * 2.2;
    ctx.fillStyle = 'rgba(12,18,24,0.55)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 7.8, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = this.shirt;
    ctx.beginPath();
    ctx.ellipse(0, 0, 8.2, 7, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = this.pants;
    ctx.fillRect(-1.8, -6 + swing * 0.3, 3.6, 12);
    ctx.fillStyle = '#e6c39a';
    ctx.beginPath();
    ctx.arc(2, 0, 4.2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

export class Cop {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.angle = 0;
    this.hp = 45;
    this.dead = false;
    this.fireCd = 1 + Math.random();
    this.walk = Math.random() * 6;
  }

  update(dt, game) {
    if (this.dead) return;
    const p = game.playerPoint();
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    this.angle = Math.atan2(dy, dx);
    if (d > 130) {
      this.x += (dx / d) * 72 * dt;
      this.y += (dy / d) * 72 * dt;
      this.walk += dt * 8;
    }
    this.fireCd -= dt;
    if (d < 340 && this.fireCd <= 0) {
      this.fireCd = 0.9 + Math.random() * 0.9;
      game.copFire(this);
    }
  }

  draw(ctx, t) {
    if (this.dead) {
      ctx.fillStyle = 'rgba(30,40,70,0.6)';
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, 13, 9, this.angle, 0, TAU);
      ctx.fill();
      return;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(this.x + 2, this.y + 3, 8, 7, 0, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    const swing = Math.sin(this.walk) * 1.8;
    ctx.fillStyle = '#20304f';
    ctx.beginPath();
    ctx.ellipse(0, 0, 7, 6, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#26303f';
    ctx.fillRect(-1.5, -5 + swing * 0.3, 3, 10);
    ctx.fillStyle = '#f2e2c8';
    ctx.beginPath();
    ctx.arc(1.6, 0, 3.4, 0, TAU);
    ctx.fill();
    // Sidearm held ahead.
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(5, 1.5, 6, 2.4);
    ctx.restore();
  }
}

export class Bullet {
  constructor(x, y, angle, speed, damage, owner) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.damage = damage;
    this.owner = owner; // 'player' | 'cop'
    this.life = 1.4;
    this.dead = false;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  draw(ctx) {
    ctx.strokeStyle = this.owner === 'player' ? '#ffe9a8' : '#ff8b7a';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x - this.vx * 0.016, this.y - this.vy * 0.016);
    ctx.stroke();
  }
}

export class Particle {
  constructor(x, y, vx, vy, life, color, size) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.life = life;
    this.max = life;
    this.color = color;
    this.size = size;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= Math.pow(0.2, dt);
    this.vy *= Math.pow(0.2, dt);
    this.life -= dt;
  }

  draw(ctx) {
    const a = Math.max(0, this.life / this.max);
    ctx.globalAlpha = a;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * (0.4 + a), 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// spawnTraffic — fills lanes with cars at legal start points, spread across the map.
export function spawnTraffic(city, count, rnd) {
  const cars = [];
  for (let n = 0; n < count; n++) {
    const lane = city.lanes[Math.floor(rnd() * city.lanes.length)];
    const along = 1 + Math.floor(rnd() * (WORLD / PITCH - 2));
    const kindKey = TRAFFIC_KINDS[Math.floor(rnd() * TRAFFIC_KINDS.length)];
    const dir = rnd() < 0.5 ? 1 : -1;
    let x;
    let y;
    let angle;
    if (lane.axis === 'h') {
      x = rnd() * WORLD;
      y = lane.line * PITCH + (dir > 0 ? LANE : -LANE);
      angle = dir > 0 ? 0 : Math.PI;
    } else {
      x = lane.line * PITCH + (dir > 0 ? -LANE : LANE);
      y = rnd() * WORLD;
      angle = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    const car = new Car(x, y, angle, kindKey, 'traffic');
    car.line = lane.line;
    car.axis = lane.axis;
    car.dir = dir;
    car.cruise = 95 + rnd() * 70;
    car.node = Math.round((lane.axis === 'h' ? x : y) / PITCH);
    void along;
    cars.push(car);
  }
  return cars;
}

// spawnCrowd — pedestrians on block kerbs, clustered around a focus point so the streets the player
// starts on are busy rather than evenly sprinkled across the whole island.
export function spawnCrowd(city, count, rnd, focus = null, radius = 2800) {
  const peds = [];
  const near = [];
  for (const b of city.blocks) {
    if (!focus || Math.hypot(b.rect.x - focus.x, b.rect.y - focus.y) < radius) near.push(b);
  }
  const pool = near.length ? near : city.blocks;
  for (let n = 0; n < count; n++) {
    const block = pool[Math.floor(rnd() * pool.length)];
    if (!block) continue;
    const t = rnd();
    const p = perimeterPoint(block.rect, t);
    peds.push(new Ped(p.x, p.y, block.rect, Math.floor(rnd() * 6)));
  }
  return peds;
}

// spawnPoliceCar — puts a cruiser on the road nearest the player, outside their view.
export function spawnPoliceCar(city, x, y, rnd) {
  const ring = 620 + rnd() * 320;
  const a = rnd() * TAU;
  let px = x + Math.cos(a) * ring;
  let py = y + Math.sin(a) * ring;
  px = Math.round(px / PITCH) * PITCH;
  py = Math.round(py / PITCH) * PITCH;
  px = clamp(px, PITCH, WORLD - PITCH);
  py = clamp(py, PITCH, WORLD - PITCH);
  const car = new Car(px, py, 0, 'police', 'police');
  return car;
}

// spawnFootCop — a patrol officer stepping out of a cruiser that has stopped nearby.
export function spawnFootCop(car) {
  return new Cop(car.x + 20, car.y + 20);
}
