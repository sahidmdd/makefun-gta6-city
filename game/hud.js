// hud.js — everything drawn over the world: the radar minimap, health and armour, money, wanted
// stars, the objective strip, the speedometer, toasts and the start and pause screens.

import { PITCH, GRID, WORLD, blockRect } from './city.js';

const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif';
const MONO = '"SF Mono", "Consolas", "DejaVu Sans Mono", monospace';

const INK = '#f4efe4';
const DIM = 'rgba(244,239,228,0.55)';
const GOLD = '#f5c451';
const DANGER = '#ff5a4d';
const HEALTH = '#5fd68a';
const ARMOUR = '#5aa8ff';

function txt(ctx, s, x, y, size, color, align = 'left', weight = '600', font = FONT) {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

// A five-point star, filled or hollow: the wanted level, drawn rather than typed.
function star(ctx, cx, cy, r, filled) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.44;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  if (filled) {
    ctx.fillStyle = GOLD;
    ctx.fill();
  } else {
    ctx.strokeStyle = 'rgba(245,196,81,0.35)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
}

function bar(ctx, x, y, w, h, frac, color, label) {
  ctx.fillStyle = 'rgba(10,14,18,0.62)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * Math.max(0, Math.min(1, frac))), h - 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (label) txt(ctx, label, x + 8, y + h - 4, 10, 'rgba(10,14,18,0.7)', 'left', '700');
}

// The radar: roads and blocks in a window around the player, with blips for everything that matters.
export function drawMinimap(ctx, game, W) {
  const size = 188;
  const pad = 18;
  const x = pad;
  const y = pad;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const range = 1500; // world units across the radar
  const scale = size / range;
  const p = game.playerPoint();

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();

  ctx.fillStyle = 'rgba(12,18,24,0.82)';
  ctx.fillRect(x, y, size, size);

  // Blocks near the player, drawn as dark plates so the roads read as the bright grid.
  const i0 = Math.max(0, Math.floor((p.x - range / 2) / PITCH));
  const i1 = Math.min(GRID - 1, Math.ceil((p.x + range / 2) / PITCH));
  const j0 = Math.max(0, Math.floor((p.y - range / 2) / PITCH));
  const j1 = Math.min(GRID - 1, Math.ceil((p.y + range / 2) / PITCH));
  ctx.fillStyle = 'rgba(150,175,190,0.16)';
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const r = blockRect(i, j);
      ctx.fillRect(x + (r.x - p.x) * scale + size / 2, y + (r.y - p.y) * scale + size / 2, r.w * scale, r.h * scale);
    }
  }

  ctx.strokeStyle = 'rgba(120,150,170,0.42)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = i0; i <= i1 + 1; i++) {
    const sx = x + (i * PITCH - p.x) * scale + size / 2;
    ctx.moveTo(sx, y);
    ctx.lineTo(sx, y + size);
  }
  for (let j = j0; j <= j1 + 1; j++) {
    const sy = y + (j * PITCH - p.y) * scale + size / 2;
    ctx.moveTo(x, sy);
    ctx.lineTo(x + size, sy);
  }
  ctx.stroke();

  // Blips.
  const blip = (bx, by, color, r) => {
    const sx = x + (bx - p.x) * scale + size / 2;
    const sy = y + (by - p.y) * scale + size / 2;
    if (sx < x - 6 || sy < y - 6 || sx > x + size + 6 || sy > y + size + 6) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  };

  if (game.city) {
    const house = game.city.places.safehouse;
    blip(house.x, house.y, '#63d471', 3.6);
    for (const car of game.cars) if (car.kind === 'police' && !car.dead) blip(car.x, car.y, '#4d8dff', 3.2);
    for (const cop of game.cops) if (!cop.dead) blip(cop.x, cop.y, '#4d8dff', 2.6);
    if (game.run) {
      for (const m of game.run.markers) if (!m.taken) blip(m.x, m.y, GOLD, 4);
      const obj = game.objectivePoint();
      if (obj) blip(obj.x, obj.y, GOLD, 4.4);
    }
    if (game.missionCar) blip(game.missionCar.x, game.missionCar.y, '#37d6c4', 3.6);
  }

  // Player arrow at the centre.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(game.facing());
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(-4, 4.2);
  ctx.lineTo(-2, 0);
  ctx.lineTo(-4, -4.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // North tick.
  txt(ctx, 'N', x + size - 11, y + 15, 10, DIM, 'center', '700', FONT);
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1.4;
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  ctx.fillStyle = 'rgba(12,18,24,0.7)';
  ctx.fillRect(x, y + size - 16, 74, 16);
  txt(ctx, 'BAHIA MARISOL', x + 5, y + size - 4, 9.5, DIM, 'left', '700', FONT);
}

// Wanted stars, cash, and the two survival bars. Everything the player checks at a glance.
function drawStatus(ctx, game, W) {
  const right = W - 22;
  txt(ctx, '$' + game.money.toLocaleString('en-US'), right, 44, 27, HEALTH, 'right', '800', MONO);

  for (let i = 0; i < 5; i++) star(ctx, right - 12 - i * 25, 66, 9.4, game.wanted > i);

  const bx = 20;
  const by = ctx.canvas.height / (window.devicePixelRatio || 1) - 74;
  bar(ctx, bx, by, 168, 13, game.player.hp / 100, HEALTH, 'VITALS');
  bar(ctx, bx, by + 18, 168, 13, game.player.armour / 100, ARMOUR, 'ARMOUR');
}

// Objective strip: who gave the job, what to do now, and the clock when the job has one.
function drawObjective(ctx, game, W, H) {
  if (!game.run) return;
  const obj = game.objectivePoint();
  const w = Math.min(560, W - 300);
  const x = (W - w) / 2;
  const y = H - 96;
  ctx.fillStyle = 'rgba(10,14,18,0.72)';
  ctx.fillRect(x, y, w, 60);
  ctx.fillStyle = GOLD;
  ctx.fillRect(x, y, 4, 60);

  txt(ctx, game.run.def.title.toUpperCase() + '  ·  ' + game.run.def.giver, x + 14, y + 19, 12, GOLD, 'left', '800');
  txt(ctx, game.run.stepText, x + 14, y + 39, 13.5, INK, 'left', '600');

  let meta = '';
  if (game.run.timer > 0) meta = Math.ceil(game.run.timer) + 's';
  if (obj) {
    const p = game.playerPoint();
    const d = Math.round(Math.hypot(obj.x - p.x, obj.y - p.y) / 12);
    meta += (meta ? ' · ' : '') + d + ' m';
  }
  if (meta) txt(ctx, meta, x + w - 12, y + 39, 12.5, DIM, 'right', '700', MONO);
}

function drawSpeedo(ctx, game, W, H) {
  const car = game.player.car;
  if (!car) return;
  const kmh = Math.round(Math.abs(car.speed) * 0.42);
  const x = W - 150;
  const y = H - 96;
  ctx.fillStyle = 'rgba(10,14,18,0.7)';
  ctx.fillRect(x, y, 128, 60);
  txt(ctx, String(kmh), x + 64, y + 36, 30, INK, 'center', '800', MONO);
  txt(ctx, 'KM/H', x + 64, y + 52, 10, DIM, 'center', '700');
  txt(ctx, car.spec.name, x + 64, y + 14, 10, GOLD, 'center', '800');
}

function drawToast(ctx, game, W, H) {
  if (!game.toast || game.toastT <= 0) return;
  const a = Math.min(1, game.toastT / 0.5);
  ctx.globalAlpha = a;
  ctx.font = `700 17px ${FONT}`;
  const m = ctx.measureText(game.toast);
  const w = m.width + 34;
  const x = (W - w) / 2;
  const y = H * 0.24;
  ctx.fillStyle = 'rgba(10,14,18,0.82)';
  ctx.fillRect(x, y, w, 38);
  ctx.fillStyle = GOLD;
  ctx.fillRect(x, y, 3, 38);
  txt(ctx, game.toast, W / 2, y + 25, 17, INK, 'center', '700');
  ctx.globalAlpha = 1;
}

// drawHUD — one call per frame from the game loop.
export function drawHUD(ctx, game, W, H) {
  drawMinimap(ctx, game, W);
  drawStatus(ctx, game, W);
  drawObjective(ctx, game, W, H);
  drawSpeedo(ctx, game, W, H);
  drawToast(ctx, game, W, H);

  if (game.helpT > 0) {
    ctx.globalAlpha = Math.min(1, game.helpT);
    txt(ctx, 'WASD move · SHIFT sprint · E enter/exit car · CLICK fire · R reload · ESC pause', W / 2, H - 20, 12, DIM, 'center', '600');
    ctx.globalAlpha = 1;
  }
}

// The start screen doubles as the controls card and the place a saved run is resumed from.
export function drawStart(ctx, game, W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(9,18,26,0.86)');
  g.addColorStop(0.55, 'rgba(9,18,26,0.72)');
  g.addColorStop(1, 'rgba(9,18,26,0.94)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2;
  txt(ctx, 'BAHIA', cx, H * 0.3, 92, INK, 'center', '800');
  txt(ctx, 'MARISOL', cx, H * 0.3 + 78, 92, GOLD, 'center', '800');
  txt(ctx, 'AN OPEN-WORLD CRIME STORY', cx, H * 0.3 + 118, 15, DIM, 'center', '700');

  const lines = [
    ['WASD', 'walk and drive'],
    ['SHIFT', 'sprint'],
    ['E', 'enter or leave a car'],
    ['MOUSE / CLICK', 'aim and shoot'],
    ['R', 'reload'],
    ['ESC', 'pause and save'],
  ];
  const top = H * 0.3 + 168;
  lines.forEach((row, i) => {
    const y = top + i * 24;
    txt(ctx, row[0], cx - 22, y, 13, GOLD, 'right', '800', MONO);
    txt(ctx, row[1], cx + 22, y, 13, INK, 'left', '500');
  });

  const pulse = 0.55 + 0.45 * Math.sin(game.t * 3);
  ctx.globalAlpha = pulse;
  txt(ctx, game.save ? 'PRESS ENTER TO CONTINUE' : 'PRESS ENTER TO START', cx, H - 96, 18, INK, 'center', '800');
  ctx.globalAlpha = 1;
  if (game.save) txt(ctx, 'N to start a new run instead', cx, H - 70, 12, DIM, 'center', '500');
  txt(ctx, 'Four jobs · one city · no way out but through', cx, H - 40, 12, DIM, 'center', '500');
}

export function drawPause(ctx, game, W, H) {
  ctx.fillStyle = 'rgba(6,10,14,0.78)';
  ctx.fillRect(0, 0, W, H);
  txt(ctx, 'PAUSED', W / 2, H * 0.4, 54, INK, 'center', '800');
  txt(ctx, 'ESC to resume · Q to quit to the title · progress is saved', W / 2, H * 0.4 + 36, 13, DIM, 'center', '500');
  txt(ctx, `Missions cleared ${game.cleared} / 4 · $${game.money.toLocaleString('en-US')}`, W / 2, H * 0.4 + 68, 13, GOLD, 'center', '700');
}

export function drawBigCard(ctx, game, W, H, title, sub, color) {
  ctx.fillStyle = 'rgba(6,10,14,0.72)';
  ctx.fillRect(0, 0, W, H);
  txt(ctx, title, W / 2, H * 0.44, 62, color, 'center', '800');
  txt(ctx, sub, W / 2, H * 0.44 + 34, 14, INK, 'center', '600');
  void game;
}
