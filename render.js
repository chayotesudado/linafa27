/* Linafa 27 — renderer. 16-bit-console styling at 640x400 (2 screen px per world unit). */
'use strict';
(function () {
const S = window.Sim;
const { W, L, GOAL_W, GOAL_H, GOAL_D, BOX_W, BOX_D, SIX_W, SIX_D, CIRCLE_R, SPOT_D } = S;
const RS = 2;
const VW = 320, VH = 200;
const CW = VW * RS, CH = VH * RS;
const PM = 110;                      // world margin around the pitch (stands live here)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------- colour + hash helpers ----------
const shadeCache = new Map();
function rgb(hex) {
  hex = hex.replace('#', ''); if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const n = parseInt(hex, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(hex, f) {
  const k = hex + f; let v = shadeCache.get(k);
  if (!v) {
    const c = rgb(hex).map(x => Math.round(f > 0 ? x + (255 - x) * f : x * (1 + f)));
    v = '#' + c.map(x => x.toString(16).padStart(2, '0')).join(''); shadeCache.set(k, v);
  }
  return v;
}
const lum = hex => { const [r, g, b] = rgb(hex); return 0.299 * r + 0.587 * g + 0.114 * b; };
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function hash3(a, b, c) { let h = Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791); h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; }
function rng(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9 >>> 0) / 4294967296); }

// ---------- pixel font (5x7) ----------
const GLYPHS = {
  A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110', D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110', J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 10001 11001 10101 10011 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 10101 01010', X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110', 1: '00100 01100 00100 00100 00100 00100 01110',
  2: '01110 10001 00001 00010 00100 01000 11111', 3: '11111 00010 00100 00010 00001 10001 01110',
  4: '00010 00110 01010 10010 11111 00010 00010', 5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110', 7: '11111 00001 00010 00100 01000 01000 01000',
  8: '01110 10001 10001 01110 10001 10001 01110', 9: '01110 10001 10001 01111 00001 00010 01100',
  "'": '00100 00100 01000 00000 00000 00000 00000', '-': '00000 00000 00000 11111 00000 00000 00000',
  '!': '00100 00100 00100 00100 00100 00000 00100', '.': '00000 00000 00000 00000 00000 01100 01100',
  ':': '00000 01100 01100 00000 01100 01100 00000', '(': '00010 00100 01000 01000 01000 00100 00010',
  ')': '01000 00100 00010 00010 00010 00100 01000', '/': '00001 00010 00010 00100 01000 01000 10000',
  '&': '01100 10010 10100 01000 10101 10010 01101', '?': '01110 10001 00001 00010 00100 00000 00100',
  ',': '00000 00000 00000 00000 01100 00100 01000', '+': '00000 00100 00100 11111 00100 00100 00000',
  '#': '01010 01010 11111 01010 11111 01010 01010', ' ': '00000 00000 00000 00000 00000 00000 00000',
};
const FONT = {};
for (const k in GLYPHS) FONT[k] = GLYPHS[k].split(' ');
function clean(s) {
  return String(s).replace(/ø/gi, 'O').replace(/ß/g, 'SS').replace(/ł/gi, 'L').replace(/æ/gi, 'AE')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}
const textWidth = (s, sc) => clean(s).length * 6 * sc - sc;
// col: css colour, array of 7 row colours, or fn(charIndex) -> either.
// o.bold thickens strokes by one pixel; o.italic slants the top rows right.
function drawText(g, s, x, y, o) {
  s = clean(s); const sc = o.sc || 1, t = Math.max(1, sc >> 1), bw = o.bold ? 1 : 0, adv = 6 * sc + bw;
  const each = (fn) => {
    let cx = x;
    for (let i = 0; i < s.length; i++) {
      const gl = FONT[s[i]] || FONT['?'];
      const dy = o.wave ? Math.round(Math.sin(o.wave.t * o.wave.speed - i * 0.6) * o.wave.amp) : 0;
      for (let r = 0; r < 7; r++) {
        const sl = o.italic ? Math.floor((6 - r) / 3) * sc : 0;
        for (let c = 0; c < 5; c++) if (gl[r][c] === '1') fn(cx + c * sc + sl, y + dy + r * sc, r, i);
      }
      cx += adv;
    }
  };
  if (o.shadow) { g.fillStyle = o.shadow; each((px, py) => g.fillRect(px + t * 2, py + t * 2, sc + bw, sc)); }
  if (o.out) { g.fillStyle = o.out; each((px, py) => g.fillRect(px - t, py - t, sc + 2 * t + bw, sc + 2 * t)); }
  each((px, py, r, i) => {
    const col = typeof o.col === 'function' ? o.col(i) : o.col;
    g.fillStyle = Array.isArray(col) ? col[r] : col;
    g.fillRect(px, py, sc + bw, sc);
  });
}
const GOLD = ['#fffbd0', '#fff07a', '#ffd83a', '#ffb81a', '#ff901a', '#f0641a', '#c8401a'];
const CYCLE = ['#ff4a4a', '#ff9a2a', '#ffe14a', '#6ae25a', '#4ad0ff', '#7a7aff', '#d06aff'];
const SILVER = ['#ffffff', '#f0f4ff', '#dde4f6', '#c7d0ea', '#b0bcdc', '#9aa8cc', '#8090b8'];

function panel(g, x, y, w, h, tone) {
  const c = tone === 'gold' ? ['#3a2a08', '#7a5a14', '#5c4210', '#ffe48a', '#2a1c04'] : ['#080c1e', '#22337a', '#1a2862', '#8fa2f0', '#0c1234'];
  g.fillStyle = c[0]; g.fillRect(x - 2, y - 2, w + 4, h + 4);
  g.fillStyle = c[2]; g.fillRect(x, y, w, h);
  g.fillStyle = c[1]; g.fillRect(x, y, w, h >> 1);
  g.fillStyle = c[3]; g.fillRect(x, y, w, 1); g.fillRect(x, y, 1, h);
  g.fillStyle = c[4]; g.fillRect(x, y + h - 1, w, 1); g.fillRect(x + w - 1, y, 1, h);
}

// ---------- advertising (invented 1980s brands, 112x10 pixel panels) ----------
function makeAd(kind) {
  const c = document.createElement('canvas'); c.width = 112; c.height = 10;
  const g = c.getContext('2d');
  const F = (col, x, y, w, h) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  if (kind === 'leche') {
    // dairy: white board, royal blue lettering, two little pines, cow spots
    F('#f6f4ea', 0, 0, 112, 10); F('#1c4fa0', 0, 0, 112, 1); F('#1c4fa0', 0, 9, 112, 1); F('#d42a2a', 0, 1, 112, 1);
    for (const px of [5, 11]) { F('#1f7a3a', px + 1, 2, 1, 1); F('#1f7a3a', px, 3, 3, 2); F('#1f7a3a', px - 1, 5, 5, 2); F('#6a4420', px + 1, 7, 1, 2); }
    drawText(g, 'LECHE', 19, 2, { sc: 1, col: '#1c4fa0', bold: true });
    // milk carton
    F('#1c4fa0', 56, 3, 7, 6); F('#ffffff', 57, 4, 5, 4); F('#1c4fa0', 57, 2, 5, 1); F('#d42a2a', 58, 5, 3, 1);
    drawText(g, 'PURA', 67, 2, { sc: 1, col: '#d42a2a' });
    for (const [x, y, w, h] of [[93, 3, 4, 3], [99, 5, 3, 3], [104, 2, 5, 4], [96, 7, 2, 1], [108, 7, 3, 2]]) F('#222', x, y, w, h);
  } else if (kind === 'glidden') {
    // paint: deep blue board, paint can, rainbow drips
    F('#14357e', 0, 0, 112, 10);
    const drip = ['#e8322a', '#f7b500', '#2fa84f', '#2a8ce8', '#ffffff'];
    for (let x = 0; x < 112; x++) { const col = drip[Math.floor(x / 3) % drip.length]; F(col, x, 0, 1, 1); if (x % 7 === 3) F(col, x, 1, 1, 1 + (x % 3)); }
    F('#c9ced8', 3, 3, 8, 6); F('#8a909c', 9, 3, 2, 6); F('#e8322a', 3, 5, 8, 2); F('#ffffff', 4, 2, 6, 1); F('#e8322a', 5, 9, 1, 1);
    drawText(g, 'GLIDDEN', 15, 2, { sc: 1, col: '#ffffff', bold: true });
    drawText(g, 'PAINT', 72, 2, { sc: 1, col: '#f7b500' });
  } else if (kind === 'cola') {
    // soft drink: red board, white italic lettering, a wave ribbon and a bottle
    F('#d0141c', 0, 0, 112, 10); F('#9a0c12', 0, 9, 112, 1);
    F('#3a1a10', 4, 3, 3, 6); F('#3a1a10', 5, 1, 1, 2); F('#ffffff', 4, 5, 3, 2);
    drawText(g, 'COLA-COCA', 12, 1, { sc: 1, col: '#ffffff', bold: true, italic: true });
    for (let x = 10; x < 108; x++) F('#ffffff', x, 8 + Math.round(Math.sin(x * 0.11) * 0.6), 1, 1);
    F('#3a1a10', 102, 3, 3, 5); F('#3a1a10', 103, 1, 1, 2); F('#ffffff', 102, 4, 3, 2);
  } else {
    F('#1a1b26', 0, 0, 112, 10); F('#3a3f6a', 0, 0, 112, 1);
    drawText(g, 'LINAFA 27', 20, 2, { sc: 1, col: GOLD, bold: true });
    F('#ffffff', 8, 3, 5, 5); F('#26232c', 10, 4, 1, 1); F('#26232c', 9, 6, 1, 1); F('#26232c', 11, 6, 1, 1);
    F('#ffffff', 99, 3, 5, 5); F('#26232c', 101, 4, 1, 1); F('#26232c', 100, 6, 1, 1); F('#26232c', 102, 6, 1, 1);
  }
  return c;
}

// ---------- stadium bake ----------
function makePitch() {
  const c = document.createElement('canvas');
  c.width = (W + PM * 2) * RS; c.height = (L + PM * 2) * RS;
  const g = c.getContext('2d');
  const R = (x, y, w, h) => g.fillRect(Math.round((x + PM) * RS), Math.round((y + PM) * RS), Math.round(w * RS), Math.round(h * RS));
  const P = (x, y, w, h) => g.fillRect(x, y, w, h);
  const r = rng(12345);

  // mown stripes with a dithered seam between them
  const STR = 42, A = '#318a33', B = '#43a33f';
  for (let y = -PM - STR, k = -3; y < L + PM; y += STR, k++) { g.fillStyle = (k & 1) ? A : B; R(-PM, y, W + PM * 2, STR); }
  for (let y = -PM - STR, k = -3; y < L + PM; y += STR, k++) {
    g.fillStyle = (k & 1) ? B : A;
    const Y = Math.round((y + PM) * RS);
    for (let x = 0; x < c.width; x += 2) { P(x + ((Y >> 1) & 1), Y, 1, 1); P(x + 1, Y + 1, 1, 1); }
  }
  // faint cross-mow, so the stripes read as a checkerboard up close
  g.fillStyle = 'rgba(255,255,210,0.035)';
  for (let x = 0, k = 0; x < W; x += W / 8, k++) if (k & 1) R(x, -PM, W / 8, L + PM * 2);
  // grass texture
  for (let i = 0; i < c.width * c.height / 7; i++) {
    const x = (r() * c.width) | 0, y = (r() * c.height) | 0, v = r();
    g.fillStyle = v < 0.5 ? 'rgba(10,50,10,0.14)' : v < 0.85 ? 'rgba(220,255,160,0.08)' : 'rgba(0,40,0,0.22)';
    P(x, y, 1, v > 0.9 ? 2 : 1);
  }
  // worn goalmouths
  for (const [cx, cy] of [[W / 2, 7], [W / 2, L - 7]]) for (let i = 0; i < 1600; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 24;
    g.fillStyle = `rgba(140,110,50,${0.04 + r() * 0.07})`;
    P(Math.round((cx + Math.cos(a) * d + PM) * RS), Math.round((cy + Math.sin(a) * d * 0.55 + PM) * RS), 2, 1);
  }
  // walkway, white front wall and pale concrete terraces (fans stand on the steps)
  const dither = (x, y, w, h, a, b) => {
    const X0 = Math.round((x + PM) * RS), Y0 = Math.round((y + PM) * RS), Wd = Math.round(w * RS), Hd = Math.round(h * RS);
    g.fillStyle = a; g.fillRect(X0, Y0, Wd, Hd); g.fillStyle = b;
    for (let yy = 0; yy < Hd; yy++) for (let xx = (yy & 1); xx < Wd; xx += 2) g.fillRect(X0 + xx, Y0 + yy, 1, 1);
  };
  dither(-27, -42, 4, L + 84, '#8e8e88', '#a6a69e'); dither(W + 23, -42, 4, L + 84, '#8e8e88', '#a6a69e');
  dither(-PM, -42, W + PM * 2, 7, '#8e8e88', '#a6a69e'); dither(-PM, L + 35, W + PM * 2, 7, '#8e8e88', '#a6a69e');
  g.fillStyle = '#cfcdc4'; R(-PM, -PM, PM - 31, L + PM * 2); R(W + 31, -PM, PM - 31, L + PM * 2);
  R(-PM, -PM, W + PM * 2, PM - 46); R(-PM, L + 46, W + PM * 2, PM - 46);
  for (let k = 0; SIDE0 + k * SIDE_STEP < PM; k++) {        // risers between side terraces
    const a = SIDE0 + k * SIDE_STEP + SIDE_STEP / 2;
    dither(-a - 1.2, -46, 1.2, L + 92, '#9c9a92', '#b4b2aa'); dither(W + a, -46, 1.2, L + 92, '#9c9a92', '#b4b2aa');
  }
  for (let k = 0; END0 + k * END_STEP < PM; k++) {          // risers between end terraces
    const a = END0 + k * END_STEP - 1;
    dither(-PM, -a - 1.5, W + PM * 2, 1.5, '#9c9a92', '#b4b2aa'); dither(-PM, L + a + 2, W + PM * 2, 1.5, '#9c9a92', '#b4b2aa');
  }
  // front walls
  g.fillStyle = '#efeee8'; R(-31, -46, 4, L + 92); R(W + 27, -46, 4, L + 92); R(-PM, -46, W + PM * 2, 4); R(-PM, L + 42, W + PM * 2, 4);
  g.fillStyle = '#b8b6ae'; R(-27.5, -46, 0.5, L + 92); R(W + 27, -46, 0.5, L + 92); R(-PM, -42.5, W + PM * 2, 0.5); R(-PM, L + 45.5, W + PM * 2, 0.5);
  g.fillStyle = '#ffffff'; R(-31, -46, 0.5, L + 92); R(W + 30.5, -46, 0.5, L + 92); R(-PM, -46, W + PM * 2, 0.5); R(-PM, L + 42, W + PM * 2, 0.5);
  // advertising boards: each ad is a 112x10 panel, tiled along the board and rotated on the side boards
  const ads = ['leche', 'glidden', 'cola', 'kick'].map(makeAd);
  g.imageSmoothingEnabled = false;
  const AK = 2, AW = 112 * AK, AH = 10 * AK;   // boards at the players' pixel scale
  const boardH = (x, y, w, seed) => {
    const X = Math.round((x + PM) * RS), Y = Math.round((y + PM) * RS), Wd = Math.round(w * RS);
    g.save(); g.beginPath(); g.rect(X, Y, Wd, AH); g.clip();
    for (let i = 0, px = X; px < X + Wd; i++, px += AW) g.drawImage(ads[(i + seed) % ads.length], px, Y, AW, AH);
    g.restore();
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(X, y < 0 ? Y + AH : Y - 4, Wd, 4);
  };
  const boardV = (x, y, h, seed, dir) => {
    const X = Math.round((x + PM) * RS), Y = Math.round((y + PM) * RS), Hd = Math.round(h * RS);
    g.save(); g.beginPath(); g.rect(X, Y, AH, Hd); g.clip();
    if (dir < 0) { g.translate(X, Y + Hd); g.rotate(-Math.PI / 2); } else { g.translate(X + AH, Y); g.rotate(Math.PI / 2); }
    for (let i = 0, px = 0; px < Hd; i++, px += AW) g.drawImage(ads[(i + seed) % ads.length], px, 0, AW, AH);
    g.restore();
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(dir < 0 ? X + AH : X - 4, Y, 4, Hd);
  };
  boardV(-28, -26, L + 52, 1, -1); boardV(W + 18, -26, L + 52, 3, 1);
  boardH(-28, -37, W + 56, 0); boardH(-28, L + 27, W + 56, 2);

  // lines
  g.fillStyle = '#f2f8ee';
  const arc = (cx, cy, rad, keep) => {
    const n = Math.ceil(rad * RS * 7);
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2, x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
      if (!keep || keep(x, y)) P(Math.round((x + PM) * RS) - 1, Math.round((y + PM) * RS) - 1, 2, 2);
    }
  };
  R(0, 0, 1, L); R(W - 1, 0, 1, L); R(0, 0, W, 1); R(0, L - 1, W, 1); R(0, L / 2 - 0.5, W, 1);
  arc(W / 2, L / 2, CIRCLE_R); arc(W / 2, L / 2, 1.2); arc(W / 2, L / 2, 0.6);
  for (const top of [true, false]) {
    const box = (bw, bd) => {
      const x0 = W / 2 - bw / 2, yy = top ? bd : L - bd - 1;
      R(x0, top ? 0 : L - bd, 1, bd); R(x0 + bw - 1, top ? 0 : L - bd, 1, bd); R(x0, yy, bw, 1);
    };
    box(BOX_W, BOX_D); box(SIX_W, SIX_D);
    const sy = top ? SPOT_D : L - SPOT_D;
    arc(W / 2, sy, 1.2); arc(W / 2, sy, 0.6);
    arc(W / 2, sy, CIRCLE_R, (x, y) => (top ? y > BOX_D + 0.5 : y < L - BOX_D - 1.5));
  }
  for (const [cx, cy] of [[0.5, 0.5], [W - 0.5, 0.5], [0.5, L - 0.5], [W - 0.5, L - 0.5]]) arc(cx, cy, 6, (x, y) => x >= 0 && x < W && y >= 0 && y < L);
  return c;
}

// ---------- goal nets: a sprite sheet of bulge animations ----------
// The mesh is modelled as strands, two diagonal families of 1px rope three pixels apart (exactly the
// at-rest look), plus the edge ropes. A frame bends every strand through a bulge field and rasterises it
// again, so each frame stays clean pixel art: continuous strands, nothing smeared.
// Per goal there are 12 scenarios: where the ball went in (left / centre / right) x low or high x soft or
// hard. The animation is cartoon squash and stretch, keyed by hand (NET_KEYS): the ball punches a pointed
// pocket into the net, it holds at full stretch, snaps back past rest, then boings a few times; the goal
// frame shudders on impact (NET_VIB). Column 0 of the sheet is the net at rest. Everything is drawn once,
// the first time a match is drawn.
const NET_KEYS = [0.55, 1, 1.18, 1.12, 0.45, -0.55, -0.62, -0.15, 0.42, 0.36, -0.22, -0.16, 0.09, 0];
const NET_VIB = [2, -2, 2, -2, 1, -1, 1, -1, 0];
const NET_FPS = 12, NET_FRAMES = NET_KEYS.length, NET_PAD = 34;
function netGeom(top) {
  const w = GOAL_W * RS, D = GOAL_D * RS, H = GOAL_H * RS, h = top ? D + H - 4 : D + H;
  // ropes are rows of the image; `free(Y)` is 0 where the net is tied to the frame and 1 where it can billow
  return top
    ? { w, h, D, H, ropes: [0, h - D], shade: [h - D, h, 64], free: Y => Math.sin(Math.PI / 2 * clamp((h - Y) / (h * 0.75), 0, 1)), dir: -1,
        lowV: h - D, highV: 4 }
    : { w, h, D, H, ropes: [H + 2, h - 1], shade: [H, H + D, 51], free: Y => Math.sin(Math.PI / 2 * clamp(Y / (h * 0.75), 0, 1)), dir: 1,
        lowV: h - 2, highV: D + 6 };
}
const NET_SCEN = [];
for (const pos of [0.25, 0.5, 0.75]) for (const high of [0, 1]) for (const hard of [0, 1]) NET_SCEN.push({ pos, high, hard });
const netScenario = (u, high, hard) => (u < 0.4 ? 0 : u > 0.6 ? 2 : 1) * 4 + (high ? 2 : 0) + (hard ? 1 : 0);
function makeNetSheet(top) {
  const G = netGeom(top), { w, h } = G, P = NET_PAD, cw = w + 2 * P, ch = h + 2 * P;
  const sheet = document.createElement('canvas'); sheet.width = cw * (NET_FRAMES + 1); sheet.height = ch * NET_SCEN.length;
  const sg = sheet.getContext('2d');
  const rgba = (r, g, b, a) => ((Math.round(a * 255) << 24) | (b << 16) | (g << 8) | r) >>> 0;
  // the strand colour over open ground and over the net's shadow (pre-blended, as the old canvas did)
  const MESH = rgba(248, 250, 248, 0.62), sa = G.shade[2] / 255, ma = 0.62 + sa * 0.38;
  const MESH_SH = rgba(Math.round(248 * 0.62 / ma), Math.round(250 * 0.62 / ma), Math.round(248 * 0.62 / ma), ma);
  const ROPE = rgba(143, 149, 143, 1), SHADE = rgba(0, 0, 0, sa);
  const cell = (sc, A) => {
    const img = sg.createImageData(cw, ch), px = new Uint32Array(img.data.buffer);
    for (let y = G.shade[0]; y < G.shade[1]; y++) for (let x = 0; x < w; x++) px[(y + P) * cw + x + P] = SHADE;   // the ground doesn't move
    const cu = sc.pos * w, cv = sc.high ? G.highV : G.lowV;
    const bx2 = 2 * Math.pow(w * 0.32, 2), by2 = 2 * Math.pow(h * 0.5, 2), px2 = 2 * Math.pow(w * 0.11, 2), py2 = 2 * Math.pow(h * 0.22, 2);
    const disp = (X, Y) => {
      if (!A) return [X, Y];
      const dx = X - cu, dy = Y - cv;
      // a broad billow, the whole back edge swinging out, plus (going out) a pointed pocket where the ball is
      const shape = 0.6 * Math.exp(-dx * dx / bx2 - dy * dy / by2) + 0.45 * Math.exp(-dx * dx / bx2) * G.free(Y) ** 3 +
        (A > 0 ? 0.8 * Math.exp(-dx * dx / px2 - dy * dy / py2) : 0);
      const d = A * Math.sqrt(Math.sin(Math.PI * clamp(X / (w - 1), 0, 1))) * G.free(Y) * shape;
      return [X + d * 0.5 * clamp(dx / 10, -1, 1), Y + d * G.dir];   // rubbery: it stretches sideways too
    };
    const plot = (x, y, c) => {
      x = Math.round(x) + P; y = Math.round(y) + P;
      if (x < 0 || y < 0 || x >= cw || y >= ch) return;
      const i = y * cw + x, inSh = y - P >= G.shade[0] && y - P < G.shade[1] && x - P >= 0 && x - P < w;
      px[i] = c === MESH && inSh ? MESH_SH : c;
    };
    const line = (a, b, c) => {   // Bresenham between consecutive strand points, so strands never break
      let [x0, y0] = a.map(Math.round), [x1, y1] = b.map(Math.round);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let e = dx + dy;
      for (;;) { plot(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
    };
    // strands: x + y = c and x - y = c, every third diagonal
    for (const fam of [1, -1]) for (let c = -h; c < w + h; c++) {
      if (((fam > 0 ? c : c + 300) % 3 + 3) % 3) continue;
      let prev = null;
      for (let y = 0; y < h; y++) {
        const x = fam > 0 ? c - y : c + y;
        if (x < 0 || x >= w) { prev = null; continue; }
        const q = disp(x, y);
        if (prev) line(prev, q, MESH); else plot(q[0], q[1], MESH);
        prev = q;
      }
    }
    // the edge ropes: sides are tied to the posts, the cross ropes billow with the mesh
    for (let y = 0; y < h; y++) { plot(0, y, ROPE); plot(w - 1, y, ROPE); }
    for (const ry of G.ropes) { let prev = null; for (let x = 0; x < w; x++) { const q = disp(x, ry); if (prev) line(prev, q, ROPE); prev = q; } }
    return img;
  };
  NET_SCEN.forEach((sc, r) => {
    sg.putImageData(cell(sc, 0), 0, r * ch);
    for (let f = 0; f < NET_FRAMES; f++) sg.putImageData(cell(sc, NET_KEYS[f] * (sc.hard ? 24 : 14)), (f + 1) * cw, r * ch);
  });
  return { sheet, cw, ch, h };
}
const nets = { top: null, bottom: null };

function drawGoal(g, ox, oy, top, t) {
  // a goal makes the whole frame shudder for a moment
  const na = fx.netAnim && fx.netAnim.top === top ? fx.netAnim : null;
  const f = na ? Math.floor((t - na.t0) * NET_FPS) : -1, vib = f >= 0 && f < NET_VIB.length ? NET_VIB[f] : 0;
  const x0 = Math.round((W / 2 - GOAL_W / 2) * RS) + ox + vib, x1 = Math.round((W / 2 + GOAL_W / 2) * RS) + ox + vib;
  const H = GOAL_H * RS, D = GOAL_D * RS;
  const net = top ? nets.top : nets.bottom;
  const gy = top ? oy : oy + L * RS;
  // the frame's shadow falls along the goal line, pushed right by the low sun (like the ball's)
  g.fillStyle = 'rgba(6,24,20,0.38)'; g.fillRect(x0 + 2, gy - 1, x1 - x0 + Math.round(GOAL_H * 0.4), 3);
  const ny = top ? gy - D - H + 4 : gy - H;
  // the bulge animation for this goal, if one is playing (else column 0: the net at rest)
  const col = f >= 0 && f < NET_FRAMES ? f + 1 : 0;
  g.drawImage(net.sheet, col * net.cw, (na ? na.scen : 0) * net.ch, net.cw, net.ch, x0 - NET_PAD, ny - NET_PAD, net.cw, net.ch);
  // round posts: highlight, body, shadow side
  const post = (x, y, h) => {
    g.fillStyle = '#20202a'; g.fillRect(x - 2, y - 1, 6, h + 2);
    g.fillStyle = '#ffffff'; g.fillRect(x - 1, y, 1, h);
    g.fillStyle = '#e2e4ec'; g.fillRect(x, y, 1, h);
    g.fillStyle = '#a2a7b6'; g.fillRect(x + 1, y, 2, h);
  };
  post(x0, gy - H, H + 1); post(x1, gy - H, H + 1);
  g.fillStyle = '#20202a'; g.fillRect(x0 - 2, gy - H - 3, x1 - x0 + 6, 5);
  g.fillStyle = '#ffffff'; g.fillRect(x0 - 1, gy - H - 2, x1 - x0 + 4, 1);
  g.fillStyle = '#e2e4ec'; g.fillRect(x0 - 1, gy - H - 1, x1 - x0 + 4, 1);
  g.fillStyle = '#a2a7b6'; g.fillRect(x0 - 1, gy - H, x1 - x0 + 4, 1);
}

function drawFlags(g, ox, oy, t) {
  const K = 2, P = (col, x, y, w, h) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  for (const [cx, cy] of [[0, 0], [W, 0], [0, L], [W, L]]) {
    const X = Math.round(cx * RS) + ox, Y = Math.round(cy * RS) + oy, top = Y - 20 * K;
    P('rgba(6,24,20,0.4)', X, Y - 1, 14, 3); P('rgba(6,24,20,0.4)', X + 14, Y, 8, 2);   // cast shadow, down-right
    P('#16141c', X - K, top - K, 3 * K, 21 * K + K);
    P('#f2f2ea', X - K / 2, top, K, 20 * K); P('#b8b8b0', X + K / 2, top, 1, 20 * K);
    const f = Math.floor(t * 7 + cx) % 3;
    const rows = [[6, 6, 5, 5], [5, 6, 6, 5], [4, 5, 6, 6]][f];
    for (let i = -1; i <= 4; i++) P('#16141c', X + K, top + i * K, (rows[Math.max(0, Math.min(3, i))] + 1) * K, K);   // outline
    rows.forEach((w, i) => { const c = i < 2 ? '#ff3a2a' : '#ffd400'; P(c, X + K, top + i * K, w * K, K); P(shade(c, 0.3), X + K, top + i * K, w * K, 1); });
  }
}

// ---------- players (sprites come from the rig in sprites.js) ----------
const SP = window.Sprites;
const facingSec = (fx, fy) => ((Math.round(Math.atan2(fy, fx) / (Math.PI / 4)) % 8) + 8) % 8;

// Picks the animation for a player from what he is doing. Cosmetic timers (first touch, complaining,
// keeper saves...) live on the player object as _fields; the simulation never reads them.
function drawPlayer(g, p, X, Y, G, clock) {
  const lk = SP.looks(p);
  let pose, f = 0, fx = p.fx, fy = p.fy, extra = 0;
  const spd = Math.hypot(p.vx, p.vy), idx = p.idx || 0, gk = p.role === 'GK';
  const b = G && G.ball, st = G && G.state;
  if (p.state === 'down' && p.stateT > 0.6) p._fouled = true;               // taken out by a slide
  if (p.state === 'ok' && p._fouled) { p._fouled = false; p._complainT = clock + 0.9; }
  if (p.state !== 'dive') p._diveKind = null;

  if (p.state === 'slide') pose = 'slide';
  else if (p.state === 'dive') {
    if (!p._diveKind) {   // pick the dive from the height of the ball and how far he has to go
      const hz = b ? b.z : 0, far = Math.abs(p.vx) > 140;
      p._diveKind = hz > 12 ? (far || (idx + Math.floor(clock)) % 3 === 0 ? 'diveTip' : 'diveHigh') : hz < 4 ? 'diveLow' : 'diveMid';
    }
    pose = p._diveKind; f = p.stateT > 0.38 ? 0 : p.stateT > 0.16 ? 1 : 2;
    const dir = p.team ? p.team.dir : 1; fx = 0; fy = dir;
    extra = Math.sign(-dir * (Math.sign(p.vx || p.fx) || 1)) || 1;
  } else if (p.state === 'down') pose = p.stateT > 0.55 ? 'fall' : p.stateT < 0.25 ? 'kneel' : 'down';
  else {
    // locomotion: walk / jog / run / sprint
    pose = spd > 72 ? 'sprint' : spd > 56 ? 'run' : spd > 36 ? 'jog' : spd > 8 ? 'walk' : 'idle';
    if (pose === 'idle') {
      const v = Math.floor((clock + idx * 1.7) / 3.5) % 7;
      pose = ['idle', 'hips', 'look', 'idle', 'tired', 'stretch', 'socks'][v];
      if (v === 6 && (idx & 1)) pose = 'idle';
    }
    if (gk && G && (st === 'play' || st === 'setpiece')) {
      pose = spd > 45 ? 'run' : spd > 8 ? 'shuffle' : 'ready';
      if (spd <= 8 && b && Math.hypot(b.x - p.x, b.y - p.y) > 220) pose = ['ready', 'gloves', 'organise'][Math.floor((clock + idx) / 3) % 3];
    }
    if (p.forcePose) pose = p.forcePose;
    if (G && p.team) {
      if (st === 'setpiece' && G.sp.type === 'kickoff' && p !== G.sp.taker && spd < 8 && !gk) pose = 'warm';
      if (st === 'play' && b.owner === p && !gk) pose = spd > 20 ? 'dribble' : 'idle';
      if (st === 'play' && b.owner === p && !gk && spd < 25) {
        for (const o of p.team.opp.players) if (Math.hypot(o.x - p.x, o.y - p.y) < 10) { pose = 'shield'; break; }
      }
      if (st === 'play' && b.owner && b.owner.team === p.team && b.owner !== p && !gk && spd > 36 &&
          Math.hypot(b.owner.x - p.x, b.owner.y - p.y) > 60 && ((Math.floor(clock * 0.8) + idx) % 4 === 0)) pose = 'callrun';
      if (st === 'play' && b.owner && b.owner.team !== p.team && p.team.chaser === p && !gk &&
          Math.hypot(p.x - b.owner.x, p.y - b.owner.y) < 24) pose = 'jockey';
      if (gk && p.threat && st === 'play' && b.owner !== p) pose = Math.hypot(b.x - p.x, b.y - p.y) < 26 ? 'starfish' : 'block';
      if (p._trapT > clock) pose = p._chest ? 'chest' : 'trap';
      if (p._complainT > clock) pose = 'complain';
      if (p.stun > 0 && spd > 8) pose = 'stumble';
      if (gk && p._catchT > clock) { pose = 'catch'; f = p._catchT - clock > 0.2 ? 1 : 0; }
      if (gk && p._saveT > clock) pose = p._saveHigh ? 'punch' : 'parry';
      if (G.humans.some(h => h.player === p && h.charging)) pose = 'windup';
      if (p.kickAnim > 0) {
        if (p._lastPose === 'throw') p._throwRel = true;
        f = p.kickAnim > 0.13 ? 0 : p.kickAnim > 0.06 ? 1 : 2;
        if (p._throwRel) { pose = 'throw'; f = 2; }
        else if (gk && p._gkDist) pose = p._gkDist;
        else if (p._kickZ > 12 && p._bike) pose = 'bicycle';
        else if (p._kickZ > 5) pose = 'volley';
        else pose = p._kickType || 'shot';
        if (pose === 'gkthrow' || pose === 'punt' || pose === 'gkroll') f = f === 0 ? 0 : 1;
      } else { p._throwRel = false; }
      if (p.jump > 0) { pose = p._diveHead ? 'divehead' : 'head'; f = p.jump > 0.15 ? 0 : 1; }
      if (b.owner === p && gk && st === 'play' && !(p._catchT > clock)) pose = 'hold';
      if (st === 'setpiece' && G.sp.taker === p && G.sp.type === 'throw') {   // hold it up, then wind back to throw
        const hm = G.humans.find(h => h.player === p);
        pose = 'throw'; f = (hm ? hm.charging : G.sp.t > 0.85) ? 1 : 0; p._windup = f === 1;
      }
      if (st === 'goal' && G.lastGoal) {
        const sc = G.lastGoal.scorerP, mine = p.team === G.lastGoal.team;
        if (gk) pose = mine ? 'celebrate' : 'sad';
        else if (mine) pose = (p === sc || (sc && Math.hypot(p.x - sc.x, p.y - sc.y) < 30)) ? 'celebrate' : 'clap';
        else if (spd < 20) pose = 'sad';
      }
    }
    if (G && p.act && (st === 'halftime' || st === 'fulltime')) {   // walking off, celebrating, handshakes
      const mv = spd > 8;
      pose = { walk: mv ? 'walk' : 'idle', trudge: mv ? 'trudge' : 'hips', celebrate: 'celebrate', sad: 'sad', hug: 'hug', shake: 'handshake',
        applaud: mv ? 'walk' : 'applaud', hips: 'hips', stretch: 'stretch', tired: 'tired', idle: 'idle' }[p.act] || pose;
      if (pose === 'idle' && !mv && p.team === (G.teams[0].score >= G.teams[1].score ? G.teams[0] : G.teams[1]) && st === 'fulltime' && (idx & 3) === 1) pose = 'wave';
    }
    if (p.sentOff) pose = spd > 8 ? 'trudge' : 'hips';   // sent off: head down to the bench
    const cad = lk.run.cad;
    if (['run', 'sprint', 'jog', 'dribble', 'callrun'].includes(pose)) f = Math.floor(p.anim / (pose === 'jog' ? cad * 0.8 : cad)) % 8;
    else if (pose === 'walk' || pose === 'trudge') f = Math.floor(p.anim / 2.4) % 8;
    else if (pose === 'handshake') f = Math.floor(clock * 7) % 2;
    else if (pose === 'applaud' || pose === 'wave') f = Math.floor(clock * 5 + idx * 0.37) % 2;
    else if (pose === 'hug') f = Math.floor(clock * 2.5 + idx * 0.5) % 2;
    else if (pose === 'jockey' || pose === 'shuffle') f = Math.floor(p.anim / 3) % 2;
    else if (pose === 'warm' || pose === 'gloves') f = Math.floor(clock * 4 + idx * 0.37) % 2;
    else if (pose === 'clap') f = Math.floor(clock * 6 + idx * 0.37) % 2;
    else if (pose === 'look') f = Math.floor(clock * 0.6 + idx) % 2;
    else if (pose === 'stretch') f = Math.floor(clock * 0.8 + idx) % 2;
    else if (pose === 'idle' || pose === 'ready') f = Math.floor(clock * 1.6 + idx * 0.37) % 2;
    else if (pose === 'celebrate') {
      f = Math.floor(clock * (lk.cel === 7 || lk.cel === 8 ? 7 : 5) + idx) % 4;
      if ((lk.cel !== 1 && lk.cel !== 4 && lk.cel !== 11 && lk.cel !== 12) || spd < 8) { fx = 0; fy = 1; }
      if (lk.cel === 11 && spd < 8) { fx = p.x < Sim.W / 2 ? 1 : -1; fy = 0; }   // belly slide reads side-on
    }
    if (pose === 'clap' || pose === 'gloves') { fx = 0; fy = 1; }
    if (pose === 'sad' && (lk.sad === 3 || lk.sad === 4)) { fx = p.x < Sim.W / 2 ? 1 : -1; fy = 0; }   // flat out / sat down read best side-on
  }
  p._lastPose = pose;
  const e = SP.playerSprite(p, pose, f, facingSec(fx, fy), extra, p.y < SHADE_Y || p.x < SHADE_X);   // feet in the stands' shadow
  const K = SP.SCALE;
  g.drawImage(e.img, e.sx, e.sy, SP.SPR, SP.SPR, X - SP.AX * K, Y - SP.AY * K - (p.jump > 0 ? 6 : 0), SP.SPR * K, SP.SPR * K);
  return e;
}

// ball sprites: 3 sizes x 4 spin frames, outlined
// the sprite sheet's ball, 4 spin frames, at the players' pixel scale
const ballSprites = [];
function makeBalls() { for (let fr = 0; fr < 4; fr++) ballSprites.push(SP.ballSprite(fr, SP.SCALE)); }

// dithered shadow blobs; ang tilts the blob for shadows cast down-right by the sun
const shadowCache = {};
function shadowSprite(w, h, ang) {
  ang = ang || 0;
  const key = w + 'x' + h + 'a' + ang; if (shadowCache[key]) return shadowCache[key];
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const cw = Math.ceil(Math.abs(w * ca) + Math.abs(h * sa)) + 2, ch = Math.ceil(Math.abs(w * sa) + Math.abs(h * ca)) + 2;
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d');
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const px = x + 0.5 - cw / 2, py = y + 0.5 - ch / 2;
    const u = (px * ca + py * sa) / (w / 2), v = (-px * sa + py * ca) / (h / 2), d = u * u + v * v;
    if (d > 1) continue;
    if (d < 0.45 || (x + y) % 2 === 0) { g.fillStyle = 'rgba(6,24,20,0.42)'; g.fillRect(x, y, 1, 1); }
  }
  return (shadowCache[key] = c);
}

// baked light: the stands throw the low sun's shadow over the top and left of the pitch, and the
// terraces darken toward the back under the roofs
const SHADE_Y = 10, SHADE_X = 6;   // how far the stands' shadow reaches onto the pitch (world units)
function makeShade() {
  const c = document.createElement('canvas');
  c.width = (W + PM * 2) * RS; c.height = (L + PM * 2) * RS;
  const g = c.getContext('2d');
  const X = x => Math.round((x + PM) * RS), Y = y => Math.round((y + PM) * RS);
  const band = (x0, y0, x1, y1, a) => { g.fillStyle = `rgba(10,12,34,${a.toFixed(3)})`; g.fillRect(X(x0), Y(y0), X(x1) - X(x0), Y(y1) - Y(y0)); };
  // terraces: darker with every row back
  for (let d = 0; d < PM - 46; d += 2) {
    const a = 0.04 + 0.34 * d / (PM - 46);
    band(-PM, -48 - d, W + PM, -46 - d, a); band(-PM, L + 46 + d, W + PM, L + 48 + d, a);
    band(-48 - d, -46, -46 - d, L + 46, a); band(W + 46 + d, -46, W + 48 + d, L + 46, a);
  }
  // the sun's shadow from the top and left stands, with a dithered edge
  const S = 'rgba(8,16,40,0.28)';
  g.fillStyle = S;
  const sy = Y(SHADE_Y), sx = X(SHADE_X);
  g.fillRect(0, 0, c.width, sy); g.fillRect(0, sy, sx, c.height - sy);
  for (let y = sy; y < sy + 6; y++) for (let x = sx + ((y >> 1) & 1) * 2; x < c.width; x += 4) g.fillRect(x, y, 2, 1);
  for (let x = sx; x < sx + 6; x++) for (let y = sy + ((x >> 1) & 1) * 2; y < c.height; y += 4) g.fillRect(x, y, 1, 2);
  return c;
}

// ---------- officials, crowd, particles, effects ----------
const fx = { G: null, last: 0, ex: 0.1, exHold: 0, goalTeam: -1, goalUntil: 0, netAnim: null, shake: 0, parts: [],
  officials: [], banner: null, label: null, whistleT: 0, flagT: 0, pitch: null };
const OFFICIAL_KIT = { shirt: '#1c1c22', shorts: '#1c1c22', socks: '#1c1c22', trim: '#d8d8d8' };
const LINESMAN_KIT = { shirt: '#e8b923', shorts: '#1c1c22', socks: '#1c1c22', trim: '#1c1c22' };

function initFx(G) {
  Object.assign(fx, { looks: new Map(), G, last: G.clock, ex: 0.1, exHold: 0, goalTeam: -1, goalUntil: 0, parts: [], netAnim: null, banner: null, label: null, shake: 0 });
  const mk = (name, kit, x, y, skin, hair) => ({ name, role: 'REF', kitOverride: kit, num: 0, idx: 0, skin, hair,
    x, y, vx: 0, vy: 0, fx: 0, fy: 1, anim: 0, state: 'ok', stateT: 0, jump: 0, kickAnim: 0, forcePose: null, linesman: name !== 'Ref' });
  // the ref switches to yellow when a team plays in a dark kit
  const darkKit = G.teams.some(t => lum(t.kit.shirt) < 70);
  const refKit = darkKit ? { shirt: '#e8d830', shorts: '#1c1c22', socks: '#1c1c22', trim: '#1c1c22' } : OFFICIAL_KIT;
  fx.officials = [mk('Ref', refKit, W / 2 + 40, L / 2 + 20, '#e0ac85', '#3a3a3a'),
    mk('Line A', LINESMAN_KIT, -5, L / 4, '#f1c9a5', '#7a4a22'), mk('Line B', LINESMAN_KIT, W + 5, L * 0.75, '#c68a5e', '#111111')];
  if (!fx.pitch) { fx.pitch = makePitch(); fx.shade = makeShade(); }
}

function moveOfficial(o, tx, ty, dt, sp, faceX) {
  const dx = tx - o.x, dy = ty - o.y, d = Math.hypot(dx, dy);
  if (d < 4) { o.vx *= 0.8; o.vy *= 0.8; }
  else { const s = Math.min(sp, d * 2.5); o.vx = dx / d * s; o.vy = dy / d * s; }
  o.x += o.vx * dt; o.y += o.vy * dt; o.anim += Math.hypot(o.vx, o.vy) * dt;
  if (faceX) { o.fx = faceX; o.fy = 0; }
  else if (d >= 4) { o.fx = dx / d; o.fy = dy / d; }
  else { const b = fx.G.ball, ux = b.x - o.x, uy = b.y - o.y, l = Math.hypot(ux, uy) || 1; o.fx = ux / l; o.fy = uy / l; }
}

function updateFx(G, dt) {
  const b = G.ball;
  const [ref, la, lb] = fx.officials;
  let tx = clamp(b.x + (b.x < W / 2 ? 42 : -42), 20, W - 20), ty = clamp(b.y + (b.y < L / 2 ? 26 : -26), 20, L - 20);
  if (G.state === 'halftime') { tx = -20; ty = L / 2; }            // off to the dressing room with the players
  else if (G.state === 'fulltime') { tx = W / 2 + 30; ty = L / 2; }
  // a stoppage: he runs to the spot; a card: he walks up to the player and holds it up
  const cs = G.cardShow;
  let refSp = 62, cardUp = false;
  if (cs) {
    tx = cs.p.x + (cs.p.x < W / 2 ? 16 : -16); ty = cs.p.y + 2; refSp = Math.max(140, Math.hypot(ref.x - tx, ref.y - ty) * 3.5);
    cardUp = Math.hypot(ref.x - tx, ref.y - ty) < 9 && G.clock - cs.t0 > 0.3;
  } else if (G.state === 'foul' && G.foul) { tx = clamp(G.foul.x + 22, 10, W - 10); ty = clamp(G.foul.y + 16, 10, L - 10); refSp = 120; }
  moveOfficial(ref, tx, ty, dt, refSp, cs && cardUp ? Math.sign(cs.p.x - ref.x) || 1 : 0);
  fx.refCard = cardUp ? cs.color : null;
  // linesmen shadow the ball down their half, stepping aside for a throw-in taker on their line
  const thr = G.state === 'setpiece' && G.sp.type === 'throw' ? G.sp : null;
  const lsY = (lo, hi, side) => { let y = clamp(b.y, lo, hi); if (thr && (side < 0 ? thr.x <= 0 : thr.x >= W) && Math.abs(y - thr.y) < 16) y = thr.y + (thr.y + 18 < hi ? 18 : -18); return y; };
  moveOfficial(la, -5, lsY(15, L / 2, -1), dt, 70, 1);
  moveOfficial(lb, W + 5, lsY(L / 2, L - 15, 1), dt, 70, -1);
  fx.whistleT -= dt; fx.flagT -= dt;
  ref.forcePose = fx.refCard ? 'flag' : fx.whistleT > 0 && Math.hypot(ref.vx, ref.vy) < 20 ? (fx.whistleT > 0.55 ? 'whistle' : 'point') : null;
  la.forcePose = lb.forcePose = fx.flagT > 0 ? 'flag' : null;
  // crowd excitement follows the danger
  let target = 0.12;
  for (const gy of [0, L]) { const d = Math.hypot(b.x - W / 2, b.y - gy); if (d < 160) target = Math.max(target, 0.12 + 0.45 * (1 - d / 160)); }
  fx.exHold -= dt;
  if (fx.exHold <= 0) fx.ex += (target - fx.ex) * Math.min(1, dt * 1.2);
  if (G.clock > fx.goalUntil) fx.goalTeam = -1;
  fx.shake = Math.max(0, fx.shake - dt * 10);
  for (const t of G.teams) for (const p of t.players) if (p.state === 'slide' && Math.random() < 0.6) turf(p.x, p.y, 1, p.fx, p.fy);
  const parts = fx.parts;
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i];
    q.life -= dt;
    q.vz -= (q.conf ? 30 : 260) * dt;
    if (q.conf) { q.vx = Math.sin(G.clock * 6 + q.ph) * 14; q.vz = Math.max(q.vz, -18); }
    q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    if (q.z < 0) { q.z = 0; q.vx *= 0.5; q.vy *= 0.5; q.vz = 0; if (!q.conf) q.life = Math.min(q.life, 0.4); }
    if (q.life <= 0) parts.splice(i, 1);
  }
}

const TURF = ['#2f7a2b', '#5aa84a', '#6b4f2a', '#3b8c36', '#7fbf5a'];
function turf(x, y, n, dx, dy) {
  for (let i = 0; i < n; i++) fx.parts.push({ x: x + (Math.random() - 0.5) * 3, y: y + (Math.random() - 0.5) * 2, z: 0.5,
    vx: (dx || 0) * 25 + (Math.random() - 0.5) * 40, vy: (dy || 0) * 25 + (Math.random() - 0.5) * 30, vz: 25 + Math.random() * 45,
    life: 0.8 + Math.random() * 0.5, col: TURF[(Math.random() * TURF.length) | 0], size: Math.random() < 0.3 ? 2 : 1 });
}
function confetti(team, end) {
  const cols = [team.kit.shirt, team.kit.stripes || team.kit.shorts, '#ffffff', '#ffe14a'];
  const y0 = end < 0 ? -58 : L + 56;
  for (let i = 0; i < 160; i++) fx.parts.push({ conf: true, ph: Math.random() * 6, x: W / 2 + (Math.random() - 0.5) * 260, y: y0 + (Math.random() - 0.5) * 18,
    z: 20 + Math.random() * 60, vx: 0, vy: (end < 0 ? 1 : -1) * (6 + Math.random() * 14), vz: -5, life: 3 + Math.random() * 2,
    col: cols[i % cols.length], size: 2 });
}

// bright, mixed crowd colours (plus each team's kit, see fanLook)
const NEUTRAL = ['#ff7a1a', '#f0f0ea', '#d23cc8', '#7a3cd0', '#ffd21a', '#28b4e8', '#e02828', '#22222e', '#2a9a44',
  '#ff9ad0', '#8a5a2a', '#3060d0', '#14b4a0', '#c8c8c0'];
const FAN_SKIN = ['#f1c9a5', '#e0ac85', '#c68a5e', '#9b6440', '#6e4428', '#f5d6bc'];
const FAN_HAIR = ['#2b1d12', '#4a2f1a', '#111111', '#7a4a22', '#e0b850', '#8c2f12', '#a8a8a8', '#1a1a1a'];
const FAN_PANTS = ['#2c3a6a', '#2a2a30', '#6a5a40', '#3a4a7a', '#4a4a52', '#d8d0c0'];
const SIDE0 = 35, SIDE_STEP = 11, END0 = 50, END_STEP = 10, ALONG = 11, SIDE_ALONG = 10;
const jit = h => ((h & 7) - 3.5) * 0.14;

// every spot on the terraces, back rows first so nearer rows overlap them
function seats(cb) {
  for (let k = Math.floor((PM - END0 - 2) / END_STEP); k >= 0; k--) {
    const wy = -END0 - k * END_STEP;
    for (let i = 0; ; i++) {
      const wx = -PM + 4 + i * ALONG + (k & 1 ? ALONG / 2 : 0); if (wx > W + PM - 4) break;
      const h = hash3(11, k, i); cb(wx + jit(h), wy + jit(h >>> 3), h, false);
    }
  }
  for (const sd of [-1, 1]) for (let k = Math.floor((PM - SIDE0 - 3) / SIDE_STEP); k >= 0; k--) {
    const wx = sd < 0 ? -(SIDE0 + k * SIDE_STEP) : W + SIDE0 + k * SIDE_STEP;
    for (let j = 0; ; j++) {
      const wy = -34 + j * SIDE_ALONG + (k & 1 ? SIDE_ALONG / 2 : 0); if (wy > L + 34) break;
      const h = hash3(sd + 5, k, j); cb(wx + jit(h), wy + jit(h >>> 3), h, false);
    }
  }
  for (let k = 0; END0 + 14 + k * END_STEP < PM; k++) {   // near end: fans seen from behind, kept clear of the boards
    const wy = L + END0 + 14 + k * END_STEP;
    for (let i = 0; ; i++) {
      const wx = -PM + 4 + i * ALONG + (k & 1 ? ALONG / 2 : 0); if (wx > W + PM - 4) break;
      const h = hash3(13, k, i); cb(wx + jit(h), wy + jit(h >>> 3), h, true);
    }
  }
}

function fanLook(h, G, away) {
  let l = fx.looks.get(h); if (l) return l;
  const pick = h % 100, side = pick < 34 ? 0 : pick < 56 ? 1 : 2;
  const kit = side < 2 ? G.teams[side].kit : null;
  const shirt = kit ? kit.shirt : NEUTRAL[(h >>> 8) % NEUTRAL.length];
  const stripes = kit && kit.stripes && (h >>> 9) % 2 ? kit.stripes : null;
  const hr = (h >>> 20) % 14;
  const alt = kit && (kit.stripes || (kit.shorts.toLowerCase() !== kit.shirt.toLowerCase() ? kit.shorts : '#ffffff'));
  const hat = hr === 0 ? (kit ? kit.shirt : '#c03030') : hr === 1 ? '#2a2a3a' : hr === 2 ? '#e8e8e8' : null;
  const scarf = kit && (h >>> 24) % 3 === 0 ? [kit.shirt, alt] : null;
  l = { side, shirt, stripes, pants: FAN_PANTS[(h >>> 14) % FAN_PANTS.length], skin: FAN_SKIN[(h >>> 12) % FAN_SKIN.length],
    hair: FAN_HAIR[(h >>> 4) % FAN_HAIR.length], hairStyle: (h >>> 17) % 6, hat, scarf, away, empty: h % 29 === 0 };
  l.key = [shirt, stripes, l.pants, l.skin, l.hair, l.hairStyle, hat, scarf && scarf.join(), away].join('|');
  fx.looks.set(h, l);
  return l;
}

function drawCrowd(g, G, ox, oy, t) {
  const x0 = cam.x - VW / 2 - 12, x1 = cam.x + VW / 2 + 12, y0 = cam.y - VH / 2 - 2, y1 = cam.y + VH / 2 + 26;
  let budget = 40;   // new fan sprites per frame; the rest keep their old pose until there's room
  const bIn = G.ball.inCrowd ? G.ball : null;
  seats((wx, wy, h, away) => {
    if (wx < x0 || wx > x1 || wy < y0 || wy > y1) return;
    const look = fanLook(h, G, away);
    if (look.empty) return;
    const thr = ((h >>> 16) & 255) / 255;
    if (bIn && Math.abs(wx - bIn.x) < 22 && Math.abs(wy - bIn.y) < 16) {   // the ball's landed among them
      const st = (h & 3) === 0 ? 'wave' : 'cheer', f2 = Math.sin(t * 9 + (h & 63)) > 0 ? 1 : 0;
      let e = SP.fanSlot(look, st, f2, budget > 0);
      if (e && e.made) { budget--; e.made = false; }
      if (!e) e = SP.fanSlot(look, 'stand', 0, false);
      if (e) { const K = SP.SCALE, X = Math.round(wx * RS) + ox, Y = Math.round(wy * RS) + oy - (f2 ? K : 0);
        g.drawImage(e.img, e.sx, e.sy, SP.FW, SP.FH, X - SP.FX * K, Y - SP.FY * K, SP.FW * K, SP.FH * K); }
      return;
    }
    let state = (h >>> 26) % 3 === 0 ? 'lean' : 'sit', f = Math.sin(t * 9 + (h & 63)) > 0 ? 1 : 0;
    if (fx.goalTeam >= 0) {
      if (look.side === fx.goalTeam) state = look.scarf ? 'scarf' : (h & 8) ? 'wave' : 'cheer';
      else if (look.side === 2) state = thr < 0.5 ? 'clap' : 'stand';
      else state = thr < 0.7 ? 'sad' : 'sit';
    } else {
      const e = fx.ex;
      if (e > thr + 0.45) state = look.scarf ? 'scarf' : (h & 8) ? 'wave' : 'cheer';
      else if (e > thr + 0.22) state = (h & 4) ? 'clap' : 'stand';
      else if (e > thr) state = 'stand';
      else if ((h >>> 5) % 41 === 0) { state = 'wave'; f = Math.sin(t * 5 + h) > 0 ? 1 : 0; }   // the odd fan waving anyway
    }
    if (state === 'clap') f = Math.sin(t * 15 + (h & 63)) > 0 ? 1 : 0;
    if (state === 'sit' || state === 'stand' || state === 'sad' || state === 'lean') f = 0;
    let e = SP.fanSlot(look, state, f, budget > 0);
    if (e && e.made) { budget--; e.made = false; }
    if (!e) e = SP.fanSlot(look, 'stand', 0, false) || SP.fanSlot(look, 'sit', 0, false);
    if (!e) return;
    const K = SP.SCALE, hop = (state === 'cheer' || state === 'wave' || state === 'scarf') && f ? K : 0;
    const X = Math.round(wx * RS) + ox, Y = Math.round(wy * RS) + oy - hop;
    g.drawImage(e.img, e.sx, e.sy, SP.FW, SP.FH, X - SP.FX * K, Y - SP.FY * K, SP.FW * K, SP.FH * K);
    if (state !== 'sit' && Math.random() < 0.0006 + fx.ex * 0.002) { g.fillStyle = '#ffffff'; g.fillRect(X - 3, Y - 34, 6, 6); }   // camera flash
  });
}

// ---------- events from the game ----------
function event(e, G) {
  if (fx.G !== G) initFx(G);
  const b = G.ball;
  switch (e.type) {
    case 'kick': {
      const p = b.lastTouch;
      if (p) {
        p._kickType = e.data >= 230 ? 'shot' : 'pass';
        p._kickZ = b.z; p._bike = b.z > 12 && Math.random() < 0.35;
        p._gkDist = p.role === 'GK' ? (b.vz > 60 ? (Math.random() < 0.5 ? 'punt' : 'gkthrow') : 'gkroll') : null;
        if (e.data > 150) turf(p.x, p.y, 5, p.fx, p.fy);
      }
      break;
    }
    case 'header': { const p = b.lastTouch; if (p) p._diveHead = p._headZ < 11 && Math.hypot(p.vx, p.vy) > 45; break; }
    case 'catch': { const k = b.owner; if (k) k._catchT = G.clock + 0.35; break; }
    case 'tackle': case 'foul': turf(b.x, b.y, 6); break;
    case 'crowdball': fx.ex = Math.min(1, fx.ex + 0.2); fx.exHold = 1; break;   // the crowd enjoys catching one
    case 'board': if (e.data > 60) fx.shake = Math.max(fx.shake, 1); break;
    case 'shot': fx.ex = Math.min(1, fx.ex + 0.35); fx.exHold = 1.2; break;
    case 'save': case 'post':
      if (e.type === 'save' && b.lastTouch && b.lastTouch.state === 'ok') { b.lastTouch._saveT = G.clock + 0.35; b.lastTouch._saveHigh = b.z > 14; }
      fx.ex = Math.min(1, fx.ex + 0.45); fx.exHold = 1.5; if (e.type === 'post') fx.shake = 2; break;
    case 'setpiece':
      fx.whistleT = 0.9;
      if (e.data === 'throw' || e.data === 'corner' || e.data === 'goalkick') fx.flagT = 1.6;
      if (e.data !== 'kickoff' && e.data !== 'penalty') fx.label = { text: { throw: 'THROW-IN', corner: 'CORNER', goalkick: 'GOAL KICK', freekick: 'FREE KICK' }[e.data], t0: G.clock };
      break;
    case 'stop': {   // the whistle for a foul, a penalty or an offside
      const f = e.data;
      fx.whistleT = 1.3;
      if (f.kind === 'penalty') { fx.ex = 1; fx.exHold = 2.5; fx.banner = { kind: 'title', text: 'PENALTY!', t0: G.clock, dur: 2.2, sub: f.team.name }; }
      else if (f.kind === 'freekick') fx.label = { text: 'FOUL!', t0: G.clock };
      break;
    }
    case 'offside': fx.flagT = 2.4; fx.label = { text: 'OFFSIDE', t0: G.clock, dur: 2 }; break;
    case 'card': {
      const c = e.data, who = c.p.name.split(' ').slice(-1)[0];
      fx.label = { text: `${c.color === 'yellow' ? 'YELLOW CARD' : c.color === 'red2' ? 'SECOND YELLOW' : 'RED CARD'} - ${who}`, t0: G.clock + 0.3, dur: 2, y: 38 };
      fx.ex = Math.min(1, fx.ex + 0.3); fx.exHold = 1.5;
      break;
    }
    case 'goal': {
      const g = e.data;
      fx.goalTeam = G.teams.indexOf(g.team); fx.goalUntil = G.clock + 5; fx.ex = 1; fx.exHold = 5;
      // pick the bulge animation: where it went in, how high, how hard
      fx.netAnim = { top: b.inNet < 0, t0: G.clock,
        scen: netScenario((b.x - (W / 2 - GOAL_W / 2)) / GOAL_W, b.z > GOAL_H * 0.45, Math.hypot(b.vx, b.vy) > 250) }; fx.shake = 5; fx.whistleT = 1.2;
      confetti(g.team, b.inNet < 0 ? -1 : 1);
      const who = g.scorer ? g.scorer.split(' ').slice(-1)[0] : '';
      fx.banner = { kind: 'goal', t0: G.clock, dur: 3, sub: `${who}${g.og ? ' (OG)' : ''} ${g.minute}'` };
      break;
    }
    // a team's style catching fire, and counter-attacks: a callout (and the crowd stirs)
    case 'hot': fx.label = { text: e.data.text, t0: G.clock, dur: 2.2, y: 38 }; fx.ex = Math.min(1, fx.ex + 0.3); fx.exHold = 2; break;
    case 'label': fx.label = { text: e.data, t0: G.clock, y: 38 }; fx.ex = Math.min(1, fx.ex + 0.25); fx.exHold = 1.2; break;
    case 'halftime': fx.whistleT = 1.5; fx.banner = { kind: 'title', text: 'HALF TIME', t0: G.clock, dur: 3.5, sub: scoreLine(G) }; break;
    case 'fulltime': fx.whistleT = 2; fx.banner = { kind: 'title', text: 'FULL TIME', t0: G.clock, dur: 6, sub: scoreLine(G) }; break;
  }
}
const scoreLine = G => `${G.teams[0].name} ${G.teams[0].score} - ${G.teams[1].score} ${G.teams[1].name}`;

// ---------- HUD ----------
function swatch(g, x, y, kit) {
  g.fillStyle = '#080c1e'; g.fillRect(x - 1, y - 1, 8, 16);
  g.fillStyle = kit.shirt; g.fillRect(x, y, 6, 9);
  if (kit.stripes) { g.fillStyle = kit.stripes; g.fillRect(x + 2, y, 2, 9); }
  g.fillStyle = kit.shorts; g.fillRect(x, y + 9, 6, 5);
}

function drawHud(g, G, humanColors, t) {
  const [A, B] = G.teams;
  const sc = 2, nameW = textWidth('WWW', sc), x = 10, y = 10;
  const w = nameW * 2 + 94;
  panel(g, x, y, w, 22);
  swatch(g, x + 4, y + 4, A.kit);
  drawText(g, A.short, x + 14, y + 4, { sc, col: SILVER, out: '#080c1e' });
  g.fillStyle = '#060914'; g.fillRect(x + 18 + nameW, y + 3, 44, 16);
  const sw = textWidth(`${A.score}-${B.score}`, sc);
  drawText(g, `${A.score}-${B.score}`, x + 18 + nameW + ((44 - sw) >> 1), y + 4, { sc, col: GOLD, out: '#080c1e' });
  drawText(g, B.short, x + 66 + nameW, y + 4, { sc, col: SILVER, out: '#080c1e' });
  swatch(g, x + 70 + nameW * 2, y + 4, B.kit);
  // red cards: one little card under the team name per man sent off
  G.teams.forEach((tm, k) => {
    const n = (G.offPitch || []).filter(q => q.team === tm).length;
    for (let i = 0; i < n; i++) { const cx = x + (k ? 66 + nameW : 14) + i * 7; g.fillStyle = '#080c1e'; g.fillRect(cx - 1, y + 23, 6, 8); g.fillStyle = '#e8231c'; g.fillRect(cx, y + 24, 4, 6); }
  });
  const cx = x + w + 10;
  panel(g, cx, y, textWidth("90'", sc) + 12, 22);
  drawText(g, `${S.minute()}'`, cx + 6, y + 4, { sc, col: GOLD, out: '#080c1e' });
  G.humans.forEach((h, i) => {
    if (!h.player) return;
    const p = h.player, name = p.name.split(' ').slice(-1)[0];
    const nw = textWidth(name, sc), px = 10 + i * 250, py = CH - 30;
    panel(g, px, py, nw + 44, 20);
    g.fillStyle = '#080c1e'; g.fillRect(px + 3, py + 2, 26, 16);
    g.fillStyle = humanColors[h.src]; g.fillRect(px + 4, py + 3, 24, 14);
    drawText(g, String(p.num), px + 5 + (p.num < 10 ? 6 : 0), py + 3, { sc, col: '#101010' });
    drawText(g, name, px + 34, py + 3, { sc, col: SILVER, out: '#080c1e' });
  });
  if (fx.label) {
    const lt = t - fx.label.t0;
    const ld = fx.label.dur || 1.6;
    if (lt > ld) fx.label = null;
    else {
      const tw = textWidth(fx.label.text, sc), lx = Math.round((CW - tw) / 2) - 8;
      const ly = Math.round((fx.label.y || 10) - Math.max(0, 1 - lt / 0.15) * 70 - Math.max(0, (lt - ld + 0.2) / 0.2) * 40);
      panel(g, lx, ly, tw + 16, 22, 'gold');
      drawText(g, fx.label.text, lx + 8, ly + 4, { sc, col: '#ffffff', out: '#2a1c04' });
    }
  }
  if (fx.banner) {
    const bn = fx.banner, bt = t - bn.t0;
    if (bt > bn.dur) fx.banner = null;
    else {
      const text = bn.kind === 'goal' ? 'GOAL!' : bn.text;
      const target = bn.kind === 'goal' ? 9 : 5;
      const s = Math.min(target, 1 + Math.floor(bt * 40));
      const tw = textWidth(text, s), bx = Math.round((CW - tw) / 2), by = Math.round(CH * 0.36 - 3.5 * s);
      const cyc = Math.floor(bt * 14);
      const col = bn.kind === 'goal' ? (i => GOLD.map((_, r) => CYCLE[(r + i + cyc) % CYCLE.length])) : GOLD;
      drawText(g, text, bx, by, { sc: s, col, out: '#14101c', shadow: 'rgba(0,0,0,0.5)', wave: { t: bt, speed: 9, amp: s === target ? s * 0.8 : 0 } });
      if (bn.sub && bt > 0.25) {
        const ss = 2, subW = textWidth(bn.sub, ss), sx = Math.round((CW - subW) / 2);
        panel(g, sx - 8, by + 7 * s + 16, subW + 16, 22);
        drawText(g, bn.sub, sx, by + 7 * s + 20, { sc: ss, col: '#ffffff', out: '#080c1e' });
      }
    }
  }
}

// ---------- frame ----------
const cam = { x: W / 2, y: L / 2 };
function resetCam() { cam.x = W / 2; cam.y = L / 2; }

function draw(ctx, G, humanColors) {
  ctx.imageSmoothingEnabled = false;
  if (!nets.top) { nets.top = makeNetSheet(true); nets.bottom = makeNetSheet(false); makeBalls(); }
  if (!G) { ctx.fillStyle = '#0d130d'; ctx.fillRect(0, 0, CW, CH); return; }
  if (fx.G !== G) initFx(G);
  const dt = clamp(G.clock - fx.last, 0, 0.1); fx.last = G.clock;
  const t = G.clock;
  if (dt > 0) updateFx(G, dt);
  // first touch: a player who has just collected the ball cushions it
  if (G.ball.owner !== fx.lastOwner) {
    const o = G.ball.owner;
    if (o && o.role !== 'GK' && G.state === 'play' && o.kickAnim <= 0) { o._trapT = G.clock + 0.25; o._chest = fx.lastBz > 6; }
    fx.lastOwner = o;
  }
  // remember ball height for chest control, and for headers (set before the header event fires)
  for (const t of G.teams) for (const q of t.players) if (Math.hypot(q.x - G.ball.x, q.y - G.ball.y) < 12) q._headZ = G.ball.z;
  fx.lastBz = G.ball.z;

  const b = G.ball;
  let tx = b.x + clamp(b.vx * 0.25, -40, 40), ty = b.y - b.z * 0.5 + clamp(b.vy * 0.25, -40, 40);
  if (G.state === 'halftime' || G.state === 'fulltime') {   // follow the players, not the dead ball
    const ps = G.teams[0].players.concat(G.teams[1].players);
    tx = ps.reduce((a, q) => a + q.x, 0) / ps.length; ty = ps.reduce((a, q) => a + q.y, 0) / ps.length;
  }
  cam.x += (tx - cam.x) * 0.08; cam.y += (ty - cam.y) * 0.08;
  const cm = G.state === 'out' ? 18 : 0;   // let the camera follow a ball into the stands (not past the back row)
  cam.x = clamp(cam.x, VW / 2 - 72 - cm, W - VW / 2 + 72 + cm);
  cam.y = clamp(cam.y, VH / 2 - 92 - cm, L - VH / 2 + 92 + cm);
  const jx = fx.shake > 0 ? Math.round((Math.random() - 0.5) * fx.shake * 2) : 0;
  const jy = fx.shake > 0 ? Math.round((Math.random() - 0.5) * fx.shake * 2) : 0;
  const ox = Math.round(CW / 2 - cam.x * RS) + jx, oy = Math.round(CH / 2 - cam.y * RS) + jy;
  ctx.fillStyle = '#2a2c3a'; ctx.fillRect(0, 0, CW, CH);
  ctx.drawImage(fx.pitch, ox - PM * RS, oy - PM * RS);
  drawCrowd(ctx, G, ox, oy, t);
  drawGoal(ctx, ox, oy, true, t);
  ctx.drawImage(fx.shade, ox - PM * RS, oy - PM * RS);
  const SX = x => Math.round(x * RS) + ox, SY = y => Math.round(y * RS) + oy;

  const players = G.teams[0].players.concat(G.teams[1].players);
  const people = players.concat(G.offPitch || [], fx.officials);
  for (const p of people) {
    const lying = p.state !== 'ok';
    const s = lying ? shadowSprite(38, 8, 0.12) : shadowSprite(26, 7, 0.3);   // cast down-right
    ctx.drawImage(s, SX(p.x) - (lying ? 16 : 7), SY(p.y) - (lying ? 4 : 5));
  }
  // ball position (in hands for keeper / throw-ins)
  let bx = b.x, by = b.y, bz = b.z;
  if (b.owner && G.state === 'play' && b.owner.role === 'GK') { bx = b.owner.x + b.owner.fx * 2; by = b.owner.y + 0.5; bz = 10; }
  if (G.state === 'setpiece' && G.sp.type === 'throw' && b.owner === G.sp.taker) {
    const o = b.owner, back = o._windup ? 2.5 : 0;                        // behind the head on the wind-up
    bx = o.x - o.fx * back; by = o.y - o.fy * back + 0.5; bz = o._windup ? 19 : 21;
  }
  const bs = shadowSprite(bz > 10 ? 9 : 13, 4);
  ctx.drawImage(bs, SX(bx) - (bs.width >> 1) + Math.round(bz * 0.4), SY(by) - 2);
  for (const q of fx.parts) if (!q.conf) { ctx.fillStyle = q.col; ctx.fillRect(SX(q.x), SY(q.y) - Math.round(q.z * RS), q.size, q.size); }

  const ents = people.map(p => ({ y: p.y, p }));
  ents.push({ y: by + 0.1, ball: true });
  ents.push({ y: L + 0.01, goal: true });
  ents.sort((a, c) => a.y - c.y);
  for (const e of ents) {
    if (e.ball) {
      const c = ballSprites[Math.floor(b.roll / 2.2) % 4];
      ctx.drawImage(c, SX(bx) - (c.width >> 1), SY(by) - Math.round(bz * RS) - c.height + 1);
    } else if (e.goal) drawGoal(ctx, ox, oy, false, t);
    else {
      const c = drawPlayer(ctx, e.p, SX(e.p.x), SY(e.p.y), G, t);
      if (e.p.linesman) drawLinesFlag(ctx, c, SX(e.p.x), SY(e.p.y), e.p);
      else if (e.p === fx.officials[0] && fx.refCard) drawRefCard(ctx, c, SX(e.p.x), SY(e.p.y));
    }
  }
  drawFlags(ctx, ox, oy, t);
  for (const q of fx.parts) if (q.conf) { ctx.fillStyle = q.col; ctx.fillRect(SX(q.x), SY(q.y) - Math.round(q.z * RS), Math.sin(t * 9 + q.ph) > 0 ? 2 : 1, 2); }

  for (const h of G.humans) {
    const p = h.player; if (!p) continue;
    const X = SX(p.x), Y = SY(p.y) - (p.jump > 0 ? 6 : 0) - 49 + (Math.floor(t * 4) % 2);
    ctx.fillStyle = '#14101c';
    ctx.fillRect(X - 5, Y - 2, 11, 3); ctx.fillRect(X - 4, Y + 1, 9, 1); ctx.fillRect(X - 3, Y + 2, 7, 1); ctx.fillRect(X - 2, Y + 3, 5, 1); ctx.fillRect(X - 1, Y + 4, 3, 1);
    ctx.fillStyle = humanColors[h.src];
    ctx.fillRect(X - 4, Y - 1, 9, 2); ctx.fillRect(X - 3, Y + 1, 7, 1); ctx.fillRect(X - 2, Y + 2, 5, 1); ctx.fillRect(X - 1, Y + 3, 3, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(X - 4, Y - 1, 9, 1);
    if (h.charging) {
      const w = Math.round(clamp(h.fireT / S.CHARGE_TIME, 0, 1) * 26);
      ctx.fillStyle = '#14101c'; ctx.fillRect(X - 15, Y - 10, 30, 6);
      for (let i = 0; i < w; i++) { ctx.fillStyle = CYCLE[Math.min(6, Math.floor(i / 26 * 3))]; ctx.fillRect(X - 13 + i, Y - 9, 1, 4); }
    }
  }
  // fade to black as the teams go in at half time, and back up for the second-half kick-off
  let fade = 0;
  if (G.state === 'halftime') fade = clamp((G.stateT - (S.HALFTIME_LEN - 0.9)) / 0.9, 0, 1);
  else if (G.half === 2 && G.state === 'setpiece' && G.sp.type === 'kickoff' && G.time < 1) fade = clamp(1 - G.sp.t / 0.7, 0, 1);
  if (fade > 0) { ctx.fillStyle = `rgba(8,6,14,${fade.toFixed(3)})`; ctx.fillRect(0, 0, CW, CH); }
  drawRadar(ctx, G, players, humanColors);
  drawHud(ctx, G, humanColors, t);
}

// flag in the linesman's right hand, drawn on the sprites' pixel grid (SP.SCALE screen pixels per art pixel).
// Raised for a decision it's waved overhead; otherwise it's carried pointing down and flutters as he runs.
function drawLinesFlag(g, c, X0, Y0, o) {
  const K = SP.SCALE, t = fx.last, up = fx.flagT > 0;
  const hx = Math.round(X0 + (c.hand.x - SP.AX) * K), hy = Math.round(Y0 + (c.hand.y - SP.AY) * K);
  const side = o.fx >= 0 ? 1 : -1, run = Math.min(1, Math.hypot(o.vx, o.vy) / 40);
  const cells = [];   // [x, y, colour] in art pixels from the hand
  const RED = '#ff3a2a', YEL = '#ffd400', POLE = '#e8e8e8';
  const cloth = (ax, ay, dir, w, h, amp, ph) => {   // quartered red/yellow, rippling more toward the free edge
    for (let i = 0; i < w; i++) {
      const dy = Math.round(Math.sin(t * 13 - i * 0.9 + ph) * amp * Math.min(1, i / 2));
      for (let j = 0; j < h; j++) cells.push([ax + dir * (i + 1), ay + j + dy, (i < w / 2) !== (j < h / 2) ? RED : YEL]);
    }
  };
  if (up) {
    // the wave: the pole swings from side to side over his head, cloth streaming off the top
    const a = Math.sin(t * 9) * 0.5, n = 10, sa = Math.sin(a), ca = Math.cos(a);
    for (let k = 0; k <= n; k++) cells.push([Math.round(sa * k), -Math.round(ca * k), POLE]);
    const tx = Math.round(sa * n), ty = -Math.round(ca * n);
    cloth(tx, ty, Math.cos(t * 9) > 0 ? -side : side, 6, 4, 1, 0);
  } else {
    // carried down by his side, tilted back; the cloth trails and flaps with his speed
    const a = Math.PI - side * (0.2 + run * 0.25), n = 7, sa = Math.sin(a), ca = Math.cos(a);
    for (let k = 0; k <= n; k++) cells.push([Math.round(sa * k), -Math.round(ca * k), POLE]);
    const bx = Math.round(sa * (n - 3)), by = -Math.round(ca * (n - 3));
    cloth(bx, by, -side, 4, 3, 0.3 + run * 0.9, 1.3);
  }
  g.fillStyle = '#14101c';
  for (const [x, y] of cells) g.fillRect(hx + x * K - K, hy + y * K - K, K * 3, K * 3);
  for (const [x, y, col] of cells) { g.fillStyle = col; g.fillRect(hx + x * K, hy + y * K, K, K); }
}

// the card held up in the ref's raised hand
function drawRefCard(g, c, X0, Y0) {
  const K = SP.SCALE, hx = Math.round(X0 + (c.hand.x - SP.AX) * K), hy = Math.round(Y0 + (c.hand.y - SP.AY) * K);
  const col = fx.refCard === 'yellow' ? '#ffd400' : '#e8231c';
  g.fillStyle = '#14101c'; g.fillRect(hx - K * 2, hy - K * 6, K * 5, K * 7);
  g.fillStyle = col; g.fillRect(hx - K, hy - K * 5, K * 3, K * 5);
  g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(hx - K, hy - K * 5, K, K * 5);
}

function drawRadar(ctx, G, players, humanColors) {
  const s = 0.15, rw = Math.round(W * s), rh = Math.round(L * s);
  const rx = CW - rw - 12, ry = CH - rh - 12;
  panel(ctx, rx - 3, ry - 3, rw + 6, rh + 6);
  ctx.fillStyle = '#1f5a22'; ctx.fillRect(rx, ry, rw, rh);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(rx, ry + Math.round(rh / 2), rw, 1);
  ctx.fillRect(rx + Math.round((W / 2 - BOX_W / 2) * s), ry + Math.round(BOX_D * s), Math.round(BOX_W * s), 1);
  ctx.fillRect(rx + Math.round((W / 2 - BOX_W / 2) * s), ry + rh - Math.round(BOX_D * s), Math.round(BOX_W * s), 1);
  const dot = (x, y, c, sz) => { ctx.fillStyle = c; ctx.fillRect(rx + Math.round(clamp(x, 0, W) * s) - 1, ry + Math.round(clamp(y, 0, L) * s) - 1, sz, sz); };
  for (const p of players) { dot(p.x, p.y, '#0a0a10', 3); dot(p.x, p.y, p.team.kit.stripes || p.team.kit.shirt, 2); }
  for (const h of G.humans) if (h.player) dot(h.player.x, h.player.y, humanColors[h.src], 3);
  dot(G.ball.x, G.ball.y, '#ffffff', 2);
}

// menu logo
function drawLogo(c, t) {
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, c.width, c.height);
  const text = 'LINAFA 27', sc = 6, tw = textWidth(text, sc);
  const cyc = Math.floor((t || 0) * 10);
  drawText(g, text, Math.round((c.width - tw) / 2), 10, { sc, out: '#14101c', shadow: '#7a1a1a',
    col: i => GOLD.map((col, r) => ((r + i * 2 + 20 - (cyc % 30)) === 0 ? '#ffffff' : col)), wave: { t: t || 0, speed: 3, amp: 2 } });
}

window.Render = { RS, CW, CH, draw, resetCam, event, drawLogo, drawText, textWidth };
})();
