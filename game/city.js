// city.js — the town of Bahia Marisol: one deterministic grid city of roads, blocks, towers, parks
// and car parks, generated from a seed and drawn with canvas primitives only (no image files).

export const PITCH = 480; // distance between two parallel road centre lines
export const ROAD = 124; // asphalt width, so each block is PITCH-ROAD wide
export const GRID = 20; // blocks per side
export const WORLD = GRID * PITCH; // world is WORLD x WORLD, roads centred on multiples of PITCH

const DISTRICTS = [
  'Coral Heights', 'Marisol', 'Vice Row', 'Sunset Palms', 'Los Caimanes', 'Alba Bay',
  'Neon Quarter', 'Puerto Dulce', 'Sierra Verde', 'Bahia Norte', 'Calle Ocho', 'Palm Grove',
];

const WALLS = [
  '#d8c2a2', '#e7d6b9', '#c9a888', '#b9c8c3', '#e5b9a0', '#d6d1c3',
  '#a8bec6', '#cfbfa7', '#e8cbb0', '#bfcfd2', '#ddc8b4', '#c4b49b',
];
const GLASS = ['#3f6f7a', '#35606c', '#4a7a84', '#2f535e'];
const ACCENTS = ['#ff6b57', '#ffd166', '#37d6c4', '#8b7bff', '#ff8fc7', '#63d471'];

// Deterministic 32-bit PRNG: the same seed always rebuilds the same city.
function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

// blockRect(i, j) — the buildable square between road i and road i+1.
export function blockRect(i, j) {
  return {
    x: i * PITCH + ROAD / 2,
    y: j * PITCH + ROAD / 2,
    w: PITCH - ROAD,
    h: PITCH - ROAD,
  };
}

// A block's lots: split the buildable square into two to four footprints with a small gap between.
function splitLots(x, y, w, h, rnd, out, depth) {
  const small = w < 168 && h < 168;
  if (depth <= 0 || small || rnd() < 0.34) {
    out.push({ x, y, w, h });
    return;
  }
  const gap = 12;
  if (w >= h) {
    const cut = w * (0.34 + rnd() * 0.32);
    splitLots(x, y, cut - gap / 2, h, rnd, out, depth - 1);
    splitLots(x + cut + gap / 2, y, w - cut - gap / 2, h, rnd, out, depth - 1);
  } else {
    const cut = h * (0.34 + rnd() * 0.32);
    splitLots(x, y, w, cut - gap / 2, rnd, out, depth - 1);
    splitLots(x, y + cut + gap / 2, w, h - cut - gap / 2, rnd, out, depth - 1);
  }
}

function makeBuilding(lot, rnd) {
  const inset = 6;
  const x = lot.x + inset;
  const y = lot.y + inset;
  const w = Math.max(28, lot.w - inset * 2);
  const h = Math.max(28, lot.h - inset * 2);
  const tall = rnd() < 0.34;
  const roof = [];
  const props = tall ? 3 : 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < props; i++) {
    roof.push({
      x: x + 8 + rnd() * Math.max(1, w - 40),
      y: y + 8 + rnd() * Math.max(1, h - 40),
      w: 14 + rnd() * 18,
      h: 14 + rnd() * 18,
      kind: rnd() < 0.5 ? 'ac' : 'tank',
    });
  }
  return {
    x, y, w, h,
    color: tall ? pick(rnd, GLASS) : pick(rnd, WALLS),
    accent: pick(rnd, ACCENTS),
    tall,
    shadow: tall ? 16 : 8,
    winRow: 22 + Math.floor(rnd() * 14),
    winCol: 20 + Math.floor(rnd() * 12),
    roof,
  };
}

// makeCity(seed) — the whole map: blocks, the places the story uses, and the traffic spawn lines.
export function makeCity(seed = 1) {
  const rnd = rng(seed * 2654435761 + 12345);
  const blocks = [];
  const blockMap = new Map();

  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const rect = blockRect(i, j);
      const roll = rnd();
      const park = roll < 0.11;
      const lot = !park && roll < 0.19;
      const block = {
        i, j, rect,
        kind: park ? 'park' : lot ? 'lot' : 'build',
        name: DISTRICTS[(i * 7 + j * 3) % DISTRICTS.length],
        buildings: [],
        trees: [],
      };
      if (block.kind === 'build') {
        const lots = [];
        // Buildings sit back from the kerb so there is a real pavement to walk on.
        splitLots(rect.x + 46, rect.y + 46, rect.w - 92, rect.h - 92, rnd, lots, 2);
        for (const l of lots) block.buildings.push(makeBuilding(l, rnd));
      } else if (block.kind === 'park') {
        const n = 5 + Math.floor(rnd() * 5);
        for (let k = 0; k < n; k++) {
          block.trees.push({
            x: rect.x + 54 + rnd() * (rect.w - 108),
            y: rect.y + 54 + rnd() * (rect.h - 108),
            r: 14 + rnd() * 12,
          });
        }
      }
      blocks.push(block);
      blockMap.set(i + ',' + j, block);
    }
  }

  const centre = (i, j) => {
    const r = blockRect(i, j);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };

  // The places the story hangs off. Kept on the map so markers and missions can name them.
  const places = {
    safehouse: { ...centre(4, 15), name: 'Bahia Marisol Safehouse' },
    garage: { ...centre(3, 4), name: 'Coral Heights Garage' },
    docks: { ...centre(16, 16), name: 'Puerto Dulce Docks' },
    shop: { ...centre(9, 3), name: 'Neon Quarter Pawn Shop' },
    tower: { ...centre(10, 10), name: 'Torre Marisol' },
    precinct: { ...centre(14, 6), name: 'Bahia Marisol Police' },
    hospital: { ...centre(2, 12), name: 'Clínica Alba Bay' },
    strip: { ...centre(6, 9), name: 'Calle Ocho Strip' },
  };

  // Traffic runs on the road lines; each entry is a legal start for a lane car.
  const lanes = [];
  for (let k = 1; k < GRID; k++) {
    lanes.push({ axis: 'h', line: k });
    lanes.push({ axis: 'v', line: k });
  }

  return { seed, blocks, blockMap, places, lanes, rnd };
}

// onRoad(x, y) — true where asphalt is; the pitch grid makes this a single modulo test.
export function onRoad(x, y) {
  const mx = ((x % PITCH) + PITCH) % PITCH;
  const my = ((y % PITCH) + PITCH) % PITCH;
  return mx < ROAD / 2 || mx > PITCH - ROAD / 2 || my < ROAD / 2 || my > PITCH - ROAD / 2;
}

// roadSnap(v) — the centre line of the nearest road perpendicular to the given axis.
export function roadSnap(v) {
  return Math.round(v / PITCH) * PITCH;
}

// buildingsNear — the footprints of the nine blocks around a point, for car and bullet collisions.
export function buildingsNear(city, x, y) {
  const bi = Math.floor(x / PITCH);
  const bj = Math.floor(y / PITCH);
  const out = [];
  for (let i = bi - 1; i <= bi + 1; i++) {
    for (let j = bj - 1; j <= bj + 1; j++) {
      const b = city.blockMap.get(i + ',' + j);
      if (b && b.buildings.length) for (const f of b.buildings) out.push(f);
    }
  }
  return out;
}

// blockAt — the block containing a point, or null when the point is on a road or off the map.
export function blockAt(city, x, y) {
  return city.blockMap.get(Math.floor(x / PITCH) + ',' + Math.floor(y / PITCH)) || null;
}

// perimeterPoint — a point walking the inside kerb of a block, t in [0,1) going clockwise.
export function perimeterPoint(rect, t) {
  const inset = 27;
  const x = rect.x + inset;
  const y = rect.y + inset;
  const w = rect.w - inset * 2;
  const h = rect.h - inset * 2;
  const per = 2 * (w + h);
  let d = ((t % 1) + 1) % 1 * per;
  if (d < w) return { x: x + d, y };
  d -= w;
  if (d < h) return { x: x + w, y: y + d };
  d -= h;
  if (d < w) return { x: x + w - d, y: y + h };
  d -= w;
  return { x, y: y + h - d };
}

// ---------------------------------------------------------------- drawing

const ASPHALT = '#23262b';
const KERB = '#3a3f46';
const WALK = '#8d8577';
const PARK_GREEN = '#3f7a45';
const LOT_GREY = '#31353b';

function drawRoadMarkings(ctx, view) {
  ctx.strokeStyle = 'rgba(240,232,200,0.5)';
  ctx.lineWidth = 3;
  ctx.setLineDash([26, 26]);
  const k0 = Math.max(0, Math.floor(view.y0 / PITCH));
  const k1 = Math.min(GRID, Math.ceil(view.y1 / PITCH));
  const h0 = Math.max(0, Math.floor(view.x0 / PITCH));
  const h1 = Math.min(GRID, Math.ceil(view.x1 / PITCH));
  ctx.beginPath();
  for (let k = k0; k <= k1; k++) {
    ctx.moveTo(view.x0, k * PITCH);
    ctx.lineTo(view.x1, k * PITCH);
  }
  for (let k = h0; k <= h1; k++) {
    ctx.moveTo(k * PITCH, view.y0);
    ctx.lineTo(k * PITCH, view.y1);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawCrosswalks(ctx, view) {
  ctx.fillStyle = 'rgba(235,230,210,0.32)';
  const i0 = Math.max(0, Math.floor(view.x0 / PITCH) - 1);
  const i1 = Math.min(GRID, Math.ceil(view.x1 / PITCH) + 1);
  const j0 = Math.max(0, Math.floor(view.y0 / PITCH) - 1);
  const j1 = Math.min(GRID, Math.ceil(view.y1 / PITCH) + 1);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const cx = i * PITCH;
      const cy = j * PITCH;
      if (cx < view.x0 - 120 || cx > view.x1 + 120 || cy < view.y0 - 120 || cy > view.y1 + 120) continue;
      for (let s = 0; s < 4; s++) {
        if (s < 2) {
          const x = cx + (s === 0 ? -ROAD / 2 - 26 : ROAD / 2 + 4);
          ctx.fillRect(x, cy - ROAD / 2 + 6, 22, ROAD - 12);
        } else {
          const y = cy + (s === 2 ? -ROAD / 2 - 26 : ROAD / 2 + 4);
          ctx.fillRect(cx - ROAD / 2 + 6, y, ROAD - 12, 22);
        }
      }
    }
  }
}

function drawBuilding(ctx, b, night) {
  // Contact shadow on the pavement sells the height without a 3D pass.
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(b.x + b.shadow * 0.5, b.y + b.shadow * 0.5, b.w, b.h);

  ctx.fillStyle = b.color;
  ctx.fillRect(b.x, b.y, b.w, b.h);

  // Roof plate inset from the walls.
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  ctx.fillRect(b.x + 5, b.y + 5, b.w - 10, b.h - 10);

  // Windows: a deterministic grid of lit or dark panes.
  const cols = Math.max(1, Math.floor(b.w / b.winCol));
  const rows = Math.max(1, Math.floor(b.h / b.winRow));
  const pw = (b.w - 18) / cols;
  const ph = (b.h - 18) / rows;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const lit = ((c * 7 + r * 13 + Math.round(b.x)) % 11) < (night ? 6 : 2);
      ctx.fillStyle = lit ? (night ? 'rgba(255,214,140,0.85)' : 'rgba(255,240,200,0.5)') : 'rgba(20,30,40,0.35)';
      ctx.fillRect(b.x + 12 + c * pw, b.y + 12 + r * ph, Math.max(3, pw - 5), Math.max(3, ph - 5));
    }
  }

  // Rooftop plant.
  for (const p of b.roof) {
    ctx.fillStyle = p.kind === 'ac' ? '#6d737a' : '#8a6a4a';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(p.x, p.y + p.h - 3, p.w, 3);
  }

  // A colour band along one edge: signage, and the only strong colour on the block.
  ctx.fillStyle = b.accent;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(b.x, b.y + b.h - 7, b.w, 5);
  ctx.globalAlpha = 1;
}

function drawPark(ctx, block, rnd) {
  const r = block.rect;
  const p = 40;
  ctx.fillStyle = PARK_GREEN;
  ctx.fillRect(r.x + p, r.y + p, r.w - p * 2, r.h - p * 2);
  ctx.fillStyle = '#4d8f52';
  ctx.fillRect(r.x + p, r.y + p, r.w - p * 2, (r.h - p * 2) * 0.5);
  ctx.fillStyle = '#c8b48c';
  const pathW = 14;
  ctx.fillRect(r.x + r.w / 2 - pathW / 2, r.y + p, pathW, r.h - p * 2);
  ctx.fillRect(r.x + p, r.y + r.h / 2 - pathW / 2, r.w - p * 2, pathW);
  for (const t of block.trees) {
    ctx.fillStyle = '#1f4d24';
    ctx.beginPath();
    ctx.arc(t.x + 3, t.y + 4, t.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2f7a36';
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3f9a45';
    ctx.beginPath();
    ctx.arc(t.x - t.r * 0.25, t.y - t.r * 0.3, t.r * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawLot(ctx, block) {
  const r = block.rect;
  const p = 40;
  ctx.fillStyle = LOT_GREY;
  ctx.fillRect(r.x + p, r.y + p, r.w - p * 2, r.h - p * 2);
  ctx.strokeStyle = 'rgba(230,230,210,0.28)';
  ctx.lineWidth = 2;
  const bays = 7;
  for (let i = 1; i < bays; i++) {
    const x = r.x + p + ((r.w - p * 2) / bays) * i;
    ctx.beginPath();
    ctx.moveTo(x, r.y + p + 18);
    ctx.lineTo(x, r.y + r.h * 0.52);
    ctx.moveTo(x, r.y + r.h * 0.58);
    ctx.lineTo(x, r.y + r.h - p - 18);
    ctx.stroke();
  }
}

// drawCity — paints everything under the actors: sea, beach, asphalt, pavements, blocks, markings.
export function drawCity(ctx, city, view, night) {
  const vw = view.x1 - view.x0;
  const vh = view.y1 - view.y0;

  // Sea around the island.
  ctx.fillStyle = night ? '#0e3340' : '#12586e';
  ctx.fillRect(view.x0, view.y0, vw, vh);

  // Island: the beach ring then the city slab.
  ctx.fillStyle = '#cbb088';
  ctx.fillRect(-90, -90, WORLD + 180, WORLD + 180);
  ctx.fillStyle = ASPHALT;
  ctx.fillRect(0, 0, WORLD, WORLD);

  const i0 = Math.max(0, Math.floor(view.x0 / PITCH));
  const i1 = Math.min(GRID - 1, Math.ceil(view.x1 / PITCH));
  const j0 = Math.max(0, Math.floor(view.y0 / PITCH));
  const j1 = Math.min(GRID - 1, Math.ceil(view.y1 / PITCH));

  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const block = city.blockMap.get(i + ',' + j);
      if (!block) continue;
      const r = block.rect;
      if (r.x > view.x1 || r.y > view.y1 || r.x + r.w < view.x0 || r.y + r.h < view.y0) continue;

      // Pavement base, then a kerb lip.
      ctx.fillStyle = WALK;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = KERB;
      ctx.fillRect(r.x, r.y, r.w, 5);
      ctx.fillRect(r.x, r.y + r.h - 5, r.w, 5);

      if (block.kind === 'park') drawPark(ctx, block, city.rnd);
      else if (block.kind === 'lot') drawLot(ctx, block);
      else for (const b of block.buildings) drawBuilding(ctx, b, night);
    }
  }

  drawRoadMarkings(ctx, view);
  drawCrosswalks(ctx, view);

  // The shoreline is drawn last so it sits over the outermost road.
  ctx.strokeStyle = 'rgba(20,80,100,0.55)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, WORLD - 6, WORLD - 6);
}
