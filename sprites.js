/*
 * Linafa 27 — sprite generation.
 * Players are 16x22 outlined pixel art in the style of the hand-drawn sheet (sprites.py): a big head with
 * one of seven hairstyles (plus moustache/beard), a 2-tone kit, 1px outlines.
 *  - Standing and running use the hand-drawn grids directly (idle + two stride frames, 8 directions).
 *  - Every other animation (kicks, dives, celebrations, tackles...) comes from the pose rig: a tiny 3D
 *    skeleton posed by joint angles, projected for one of 8 directions and drawn in the same style, with
 *    the hand-drawn head stamped on top.
 * Sprites are drawn at native size and scaled up by SCALE when blitted. Every frame is cached per player.
 * Fans are hand-placed pixel sprites with a handful of states.
 */
'use strict';
(function () {
const DEG = Math.PI / 180;
const OUT = '#16141c';
const EYE = '#2a1912', BOOT = '#101014', MOUTH = '#6a1f24', TEETH = '#f4f2ea';
const SCALE = 2;                          // screen pixels per sprite pixel
const SPR = 48, AX = 24, AY = 40;         // native sprite canvas and ground anchor
// rig proportions in native pixels, matched to the hand-drawn grid (head 7 rows, shirt 6, shorts 2, legs 4)
const HIP = 2, TH = 1.8, SH = 1.8, FT = 1.3, TORSO = 6.9, SHW = 4.9, UA = 2.5, FA = 2.3, DEPTH = 0.6;

// ---------- colour helpers ----------
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
function mix(a, b, t) {
  const ca = rgb(a), cb = rgb(b);
  return '#' + ca.map((x, i) => Math.round(x * (1 - t) + cb[i] * t).toString(16).padStart(2, '0')).join('');
}
const lum = hex => { const [r, g, b] = rgb(hex); return 0.299 * r + 0.587 * g + 0.114 * b; };
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function outline(c) {
  const g = c.getContext('2d'), id = g.getImageData(0, 0, c.width, c.height), d = id.data, w = c.width, h = c.height;
  const [r0, g0, b0] = rgb(OUT), mark = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; if (d[i + 3] !== 0) continue;
    if ((x > 0 && d[i - 1] > 0) || (x < w - 1 && d[i + 7] > 0) || (y > 0 && d[i - w * 4 + 3] > 0) || (y < h - 1 && d[i + w * 4 + 3] > 0)) mark.push(i);
  }
  for (const i of mark) { d[i] = r0; d[i + 1] = g0; d[i + 2] = b0; d[i + 3] = 240; }
  g.putImageData(id, 0, 0);
}

// ---------- palettes (from the sprite sheet) ----------
const SKIN_PAL = [['#f1c29a', '#cf9670'], ['#cf8f5c', '#a46740'], ['#7d4a2d', '#56311c']];
const HAIR_PAL = [['#262022', '#151214'], ['#6e3f1d', '#4a2812'], ['#ecc85a', '#bf9532'], ['#c0582a', '#8c3b1a']];
function nearest(pal, hex) {
  const c = rgb(hex); let best = pal[0], bd = Infinity;
  for (const e of pal) { const d = rgb(e[0]).reduce((a, v, i) => a + (v - c[i]) ** 2, 0); if (d < bd) { bd = d; best = e; } }
  return best;
}

// ---------- kit + look ----------
function kitFor(p) {
  const k = p.kitOverride || (p.role === 'GK' ? p.team.gkKit : p.team.kit);
  const src = k.shirt + k.shorts + k.socks + k.stripes;
  if (k._c && k._c.src === src) return k._c;
  const trim = k.trim || (k.shorts.toLowerCase() !== k.shirt.toLowerCase() ? k.shorts : (lum(k.shirt) > 140 ? '#222222' : '#f2f2f2'));
  const dk = c => shade(c, lum(c) > 200 ? -0.26 : -0.36);
  k._c = { src, shirt: k.shirt, stripes: k.stripes, shorts: k.shorts, socks: k.socks, trim,
    numCol: lum(k.shirt) > 150 ? '#1a1a1a' : '#ffffff',
    glove: p.role === 'GK' ? (lum(k.shirt) > 150 ? '#2b2b2b' : '#f2f0e6') : null,
    J: k.shirt, j: dk(k.shirt), w: k.shorts, W: dk(k.shorts), d: k.socks, D: dk(k.socks),
    sJ: k.stripes || null, sj: k.stripes ? dk(k.stripes) : null };
  return k._c;
}
// hairstyles from the sheet, weighted so a team is mostly short back and sides
const HAIR_WEIGHTED = ['short', 'short', 'short', 'crop', 'crop', 'short', 'none', 'bald patch', 'mullet', 'mullet', 'long', 'dreads', 'ponytail', 'ponytail', 'afro', 'long'];
function looks(p) {
  if (!p._look) {
    const h = hashStr(p.name + '#'), t = (h >>> 11) % 7;
    const sk = nearest(SKIN_PAL, p.skin || '#f1c29a'), hr = nearest(HAIR_PAL, p.hair || '#262022');
    let style = HAIR_WEIGHTED[h % HAIR_WEIGHTED.length];
    if ((style === 'dreads' || style === 'afro') && sk === SKIN_PAL[0]) style = style === 'afro' ? 'mullet' : 'long';
    const facial = (h >>> 13) % 9 === 0 ? 'beard' : t < 2 ? 'moustache' : null;
    p._look = { style, facial, cel: (h >>> 4) % 13 === 12 || (h >>> 4) % 9 === 0 ? 12 : (h >>> 4) % 12, sad: (h >>> 7) % 5,
      run: RUN_STYLES[(h >>> 19) % RUN_STYLES.length],
      s: sk[0], S: sk[1], k: hr[0], K: hr[1] };
    p._look.q = mix(hr[0], sk[0], 0.45);          // crop: hair with skin showing through
    p._look.l = mix(sk[0], '#ffffff', 0.35);      // scalp shine
    p._look.r = mix(hr[0], '#ffffff', 0.28);      // dreadlock strand highlight
    p._look.z = ['#e02828', '#2a6cd6', '#f2f0e6', '#f0c020'][(h >>> 21) % 4];   // hair tie
  }
  return p._look;
}
// char -> colour for one player
function palFor(k, lk) {
  return { o: OUT, e: EYE, b: BOOT, m: MOUTH, T: TEETH, c: k.trim, n: k.numCol,
    J: k.J, j: k.j, w: k.w, W: k.W, d: k.d, D: k.D, s: lk.s, S: lk.S, k: lk.k, K: lk.K, q: lk.q, l: lk.l, r: lk.r,
    z: lk.z, g: k.glove || lk.s, G: k.glove ? shade(k.glove, -0.3) : lk.S, X: k.sJ, x: k.sj };
}
function rotY(v, ang) { // head turn: positive turns the face toward the player's right
  const c = Math.cos(ang * DEG), s = Math.sin(ang * DEG);
  return [v[0] * c + v[2] * s, v[1], v[2] * c - v[0] * s];
}

// ---------- the rig ----------
const add = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
function limbDir(pitch, abduct, s) {
  const p = pitch * DEG, a = abduct * DEG;
  return [s * Math.sin(a), -Math.cos(a) * Math.cos(p), Math.cos(a) * Math.sin(p)];
}
function rotX(v, py, pz, ang) { // pitch: positive leans forward (+z)
  const c = Math.cos(ang * DEG), s = Math.sin(ang * DEG), y = v[1] - py, z = v[2] - pz;
  return [v[0], py + y * c - z * s, pz + z * c + y * s];
}
function rotZ(v, px, py, ang) { // roll: positive tips the top toward +x (the player's right)
  const c = Math.cos(ang * DEG), s = Math.sin(ang * DEG), x = v[0] - px, y = v[1] - py;
  return [px + x * c + y * s, py + y * c - x * s, v[2]];
}

const P0 = () => ({ lean: 0, pitch: 0, roll: 0, lift: 0, headPitch: 0, headYaw: 0, face: 'neutral', sway: 0, hairBob: 0,
  lLeg: [0, 0, 4], rLeg: [0, 0, 4], lArm: [6, 18, 12], rArm: [6, 18, 12] });

// Running styles: every player gets one, so the team doesn't move like clones.
// stride/fold: leg reach and knee fold, swing: arm swing, elbow: base elbow bend, abd: elbows out,
// lean/head: body and head carriage, bounce: vertical bob, cad: distance per frame (cadence),
// roll: side-to-side waddle, cross: arms swing across the body, heel: extra back-kick.
const RS = (o) => Object.assign({ stride: 1, fold: 1, swing: 1, elbow: 82, abd: 9, lean: 8, head: 0, bounce: 1, cad: 3.4, roll: 0, cross: 0, heel: 0 }, o);
const RUN_STYLES = [
  RS({}),                                                               // textbook
  RS({ stride: 1.2, fold: 0.9, swing: 0.9, cad: 4.0, lean: 9 }),        // long strider
  RS({ stride: 0.75, fold: 0.8, swing: 0.8, elbow: 95, cad: 2.8, bounce: 1.4 }), // choppy
  RS({ abd: 24, elbow: 90, swing: 0.8 }),                               // elbows out
  RS({ swing: 1.45, elbow: 75, lean: 11 }),                             // arm pumper
  RS({ elbow: 40, swing: 0.8, abd: 12 }),                               // low arms
  RS({ lean: 15, head: 14, stride: 1.05 }),                             // head-down bull
  RS({ lean: 2, head: -8, swing: 0.9 }),                                // upright
  RS({ bounce: 2.4, fold: 1.2, cad: 3.2 }),                             // bouncy
  RS({ stride: 0.7, fold: 0.55, swing: 0.6, bounce: 0.3, cad: 3.0, lean: 5 }), // shuffler
  RS({ roll: 6, abd: 16, stride: 0.9 }),                                // waddler
  RS({ fold: 1.4, heel: 1, lean: 10 }),                                 // heel kicker
  RS({ cross: 1, swing: 1.1 }),                                         // swings across the body
  RS({ fold: 0.6, elbow: 60, swing: 0.7, lean: 4 }),                    // stiff
  RS({ stride: 1.15, fold: 1.25, swing: 1.3, elbow: 88, lean: 12, head: 4 }), // sprinter
  RS({ swing: 0.5, elbow: 30, lean: 4, bounce: 0.6, cad: 3.8, head: 6 }), // lazy
  RS({ lean: 16, head: 10, abd: 14, elbow: 100 }),                      // hunched
  RS({ stride: 1.1, bounce: 1.8, swing: 0.9, roll: 3, head: -4 }),      // floaty
];

// Natural stride: the stance leg stays fairly straight while the swing leg folds just after
// toe-off (thigh still behind, moving forward), then reaches out ahead.
function runLegs(P, f, stride, fold, heel) {
  const ph = f / 8 * Math.PI * 2, s = Math.sin(ph);
  if (fold === undefined) fold = stride;
  const fd = a => { const c = Math.max(0, Math.cos(a + Math.PI / 4)); return 16 + 58 * fold * c + (heel || 0) * c * c * 30; };
  P.lLeg = [4 + 26 * stride * s, fd(ph), 3];
  P.rLeg = [4 - 26 * stride * s, fd(ph + Math.PI), 3];
  return s;
}
// k: intensity (jog 0.7, run 1, sprint 1.15)
function runPose(P, f, rs, k) {
  const ph = f / 8 * Math.PI * 2;
  const s = runLegs(P, f, rs.stride * k, rs.fold * Math.min(1.2, k), rs.heel);
  const sw = 32 * rs.swing * k;
  const cl = rs.cross ? 10 * Math.max(0, -s) : 0, cr = rs.cross ? 10 * Math.max(0, s) : 0;
  P.lArm = [8 - sw * s, rs.elbow - 12 * s, Math.max(0, rs.abd - cl)];
  P.rArm = [8 + sw * s, rs.elbow + 12 * s, Math.max(0, rs.abd - cr)];
  P.lean = rs.lean * (0.6 + 0.4 * k) + (k > 1 ? 3 : 0);
  P.headPitch = rs.head;
  P.lift = Math.round(Math.abs(s) * 1.2 * rs.bounce * k);
  P.roll = rs.roll * s;
  P.sway = Math.cos(ph) * 1.1 * k; P.hairBob = Math.abs(s) * 0.9 * rs.bounce;
  return s;
}

// pose library: [thigh pitch, knee bend, abduction] for legs, [shoulder pitch, elbow bend, abduction] for arms.
// P.face picks the expression: neutral, angry, rage, tongue, effort, happy, shout, sad, pain.
function poseParams(name, f, lk, extra) {
  const P = P0(), rs = lk.run, sg = extra || 1;
  const both = (a, l) => { if (a) { P.lArm = a.slice(); P.rArm = a.slice(); } if (l) { P.lLeg = l.slice(); P.rLeg = l.slice(); } };
  switch (name) {
    // ---- standing about
    case 'idle':
      both([4, 14 + f * 8, 9 + f * 2], null); P.sway = f * 0.4; P.lLeg = [3, 4, 6]; P.rLeg = [-3, 3, 6]; P.lean = 2 + f; break;
    case 'hips': both([-15, 105, 42], null); P.lLeg = [2, 3, 8]; P.rLeg = [-2, 3, 8]; P.lean = 1; break;
    case 'look': both([4, 16, 9], null); P.lLeg = [3, 4, 6]; P.rLeg = [-3, 3, 6]; P.headYaw = f ? -45 : 45; break;
    case 'tired': // bent over, hands on knees
      both([48, 8, 10], [14, 22, 8]); P.lean = 42; P.headPitch = -20; P.face = 'effort'; break;
    case 'stretch': both([176, f ? 20 : 40, f ? 22 : 12], [0, 0, 8]); P.lean = f ? -6 : 0; P.headPitch = -12; break;
    case 'socks': // pulling his socks up
      P.rArm = [70, 0, 4]; P.lArm = [55, 10, 12]; P.lean = 62; P.lLeg = [2, 4, 6]; P.rLeg = [-14, 4, 6]; P.headPitch = 10; break;
    case 'warm': // bouncing on the toes before kick-off
      both([10, 30, 14], [6, 14 + f * 14, 6]); P.lift = f ? 0 : 2; P.hairBob = f ? 1 : -1; break;
    // ---- moving
    case 'walk': {
      const ph = f / 8 * Math.PI * 2, s = Math.sin(ph);
      P.lLeg = [20 * s, 6 + 30 * Math.max(0, -Math.sin(ph + 0.6)), 4];
      P.rLeg = [-20 * s, 6 + 30 * Math.max(0, Math.sin(ph + 0.6)), 4];
      P.lArm = [-20 * s * rs.swing, 22, rs.abd + 5]; P.rArm = [20 * s * rs.swing, 22, rs.abd + 5];
      P.lean = 3 + rs.lean * 0.15; P.headPitch = rs.head * 0.5; P.sway = Math.cos(ph) * 0.8; P.roll = rs.roll * 0.5 * s; break;
    }
    case 'jog': runPose(P, f, rs, 0.7); break;
    case 'run': runPose(P, f, rs, 1); break;
    case 'sprint': runPose(P, f, rs, 1.15); P.face = 'effort'; break;
    case 'callrun': runPose(P, f, rs, 0.85); P.rArm = [172, 10, 16]; P.face = 'shout'; break;   // "here! square it!"
    case 'dribble': { // shorter strides, hunched over the ball, arms out for balance
      const s = runPose(P, f, rs, 0.8);
      P.lArm = [6 - 24 * s, 65, 24]; P.rArm = [6 + 24 * s, 65, 24];
      P.lean = 13; P.headPitch = 14; P.face = 'effort'; break;
    }
    case 'shield': // back into the defender, arms out
      both([14, 22, 46], null); P.lLeg = [16, 26, 14]; P.rLeg = [4, 22, 14]; P.lean = 12; P.face = 'effort'; break;
    case 'jockey': // defender crouched, side-on, waiting to pounce
      P.lLeg = [22 + f * 6, 48, 16]; P.rLeg = [12 - f * 6, 42, 16]; both([18, 34, 32], null); P.lean = 18; P.face = 'angry'; break;
    // ---- on the ball
    case 'trap': P.rLeg = [28, 42, 2]; P.lLeg = [-4, 14, 6]; P.lArm = [20, 22, 38]; P.rArm = [12, 22, 34]; P.lean = 6; P.headPitch = 18; break;
    case 'chest': both([30, 30, 52], [6, 16, 8]); P.lean = -18; P.headPitch = 26; break;
    case 'windup':
      P.rLeg = [-38, 100, 6]; P.lLeg = [10, 18, 6]; P.lArm = [58, 30, 45]; P.rArm = [-32, 25, 40]; P.lean = 6; P.face = 'tongue'; break;
    case 'kick': case 'shot': {
      const Lg = [[52, 30], [86, 6], [38, 40]][f];
      P.rLeg = [Lg[0], Lg[1], 4]; P.lLeg = [-8, 20, 6];
      P.lArm = [45, 30, 60]; P.rArm = [-40, 20, 50]; P.lean = f === 1 ? -14 : -4; P.face = 'tongue'; break;
    }
    case 'pass': { // inside of the foot: the leg swings forward and across
      const Lg = [[22, 22, -6], [38, 12, -24], [20, 24, -10]][f];
      P.rLeg = Lg; P.lLeg = [-4, 16, 6]; P.lArm = [20, 25, 32]; P.rArm = [-10, 25, 28]; P.lean = 2; P.headPitch = 16; break;
    }
    case 'volley': // leaning away, leg swinging round at hip height
      P.rLeg = [[50, 40, 40], [75, 6, 62], [40, 30, 30]][f]; P.lLeg = [-6, 18, 4]; P.lArm = [40, 20, 75]; P.rArm = [-20, 20, 55];
      P.roll = -24; P.lean = -8; P.face = 'tongue'; break;
    case 'bicycle': // upside down, legs scissoring over the head
      P.pitch = [-100, -165, -215][f]; P.rLeg = [[60, 60, 4], [140, 8, 4], [120, 30, 4]][f]; P.lLeg = [[110, 20, 4], [50, 80, 4], [40, 60, 4]][f];
      both([-60, 10, 62], null); P.lift = [6, 11, 5][f]; P.face = 'effort'; break;
    case 'head':
      if (f === 0) { P.lLeg = [25, 65, 8]; P.rLeg = [12, 75, 8]; both([80, 45, 50], null); P.lean = 6; P.headPitch = -18; }
      else { P.lLeg = [18, 40, 8]; P.rLeg = [5, 50, 8]; both([55, 50, 48], null); P.lean = 22; P.headPitch = 28; }
      P.face = 'effort'; break;
    case 'divehead': // full-length diving header
      P.pitch = 82; both([-35, 10, 34], [-15, 12, 6]); P.headPitch = -60; P.lift = 4; P.face = 'effort'; break;
    case 'throw': // 0 ball held up, 1 wound back behind the head, 2 released with the weight going through
      if (f === 0) { both([168, 30, 16], null); P.lean = -3; P.headPitch = -6; P.lLeg = [8, 6, 6]; P.rLeg = [-10, 10, 6]; }
      else if (f === 1) { both([176, 112, 18], null); P.lean = -16; P.headPitch = -14; P.lLeg = [14, 8, 6]; P.rLeg = [-18, 14, 6]; P.face = 'effort'; }
      else { both([118, 8, 12], null); P.lean = 16; P.headPitch = 6; P.lLeg = [20, 14, 6]; P.rLeg = [-24, 30, 6]; P.face = 'effort'; }
      break;
    // ---- goalkeepers
    case 'ready': both([42 + f * 6, 38, 40], [30, 55 + f * 6, 14]); P.lean = 24; break;
    case 'shuffle': // crouched side-step across the goal
      P.lLeg = [24, 50, f ? 26 : 8]; P.rLeg = [24, 50, f ? 8 : 26]; both([40, 40, 42], null); P.lean = 22; P.lift = f; break;
    case 'gloves': both([62, f ? 86 : 70, f ? 4 : 20], [6, 10, 10]); P.lean = 4; break;   // clapping his gloves together
    case 'organise': P.rArm = [96, 4, 62]; P.lArm = [10, 30, 14]; P.lLeg = [6, 10, 10]; P.rLeg = [-4, 8, 10]; P.headYaw = 35; P.face = 'shout'; break;
    case 'block': both([150, 15, 48], [14, 28, 16]); P.lean = 6; P.face = 'shout'; break;
    case 'starfish': // spread himself big at close range
      both([110, 0, 82], [10, 10, 34]); P.lift = 4; P.face = 'shout'; break;
    case 'hold': both([72, 58, 4], null); P.lean = 6; break;
    case 'catch': both([62, 118, 4], [20, 40, 8]); P.lean = 22; P.headPitch = 18; P.lift = f; break;
    case 'punch': both([172, 0, 8], [10, 30, 8]); P.lift = 6; P.lean = -6; P.face = 'shout'; break;
    case 'parry': both([105, 8, 46], [18, 36, 12]); P.lean = 4; P.face = 'effort'; break;
    case 'gkthrow': // overarm throw
      if (f === 0) { P.rArm = [-70, 40, 30]; P.lArm = [70, 20, 30]; P.lean = -6; P.lLeg = [18, 10, 6]; P.rLeg = [-18, 10, 6]; }
      else { P.rArm = [150, 0, 20]; P.lArm = [-20, 30, 30]; P.lean = 18; P.lLeg = [24, 20, 6]; P.rLeg = [-30, 30, 6]; }
      break;
    case 'gkroll': // bowled out along the ground
      P.rArm = [f ? 70 : -40, 10, 6]; P.lArm = [40, 40, 30]; P.lLeg = [50, 80, 6]; P.rLeg = [-30, 90, 8]; P.lean = 40; P.headPitch = -10; break;
    case 'punt': // drop-kick out of the hands
      if (f === 0) { both([80, 10, 14], null); P.rLeg = [-30, 70, 4]; P.lLeg = [8, 14, 6]; }
      else { both([45, 20, 58], null); P.rLeg = [100, 0, 4]; P.lLeg = [-12, 10, 6]; P.lean = -18; P.face = 'effort'; }
      break;
    case 'diveMid': case 'diveHigh': case 'diveLow': case 'diveTip': {
      const k = name, lead = sg > 0 ? 'rArm' : 'lArm', other = sg > 0 ? 'lArm' : 'rArm';
      if (k === 'diveLow') {        // scrambling down low to the post
        P.roll = sg * [50, 88, 96][f]; P.lean = [30, 10, 0][f]; both([[80, 10, 30], [110, 0, 30], [90, 30, 20]][f], [[20, 40, 10], [0, 10, 8], [10, 30, 10]][f]); P.lift = [0, 1, 0][f];
      } else if (k === 'diveHigh') { // flying for the top corner
        P.roll = sg * [25, 62, 86][f]; both([[160, 0, 20], [180, 0, 8], [150, 30, 20]][f], [[20, 50, 8], [-10, 40, 10], [20, 40, 10]][f]); P.lift = [5, 13, 4][f];
      } else if (k === 'diveTip') { // one strong hand to tip it round
        P.roll = sg * [25, 66, 88][f]; P[lead] = [[165, 0, 15], [180, 0, 6], [160, 20, 15]][f]; P[other] = [60, 60, 30];
        both(null, [[20, 50, 8], [-6, 30, 10], [20, 40, 10]][f]); P.lift = [5, 11, 4][f];
      } else {                       // standard full-stretch
        P.roll = sg * [35, 82, 92][f]; both([[120, 20, 30], [176, 0, 14], [150, 40, 20]][f], null);
        P.lLeg = [[10, 40, 10], [0, 0, 8], [10, 30, 10]][f]; P.rLeg = [[-10, 20, 8], [22, 28, 8], [30, 50, 10]][f]; P.lift = [2, 7, 2][f];
      }
      P.face = f === 2 ? 'pain' : 'effort'; break;
    }
    case 'dive': // kept for compatibility
      P.roll = 82 * sg; both([176, 0, 14], null); P.lLeg = [0, 0, 8]; P.rLeg = [22, 28, 8]; P.lift = 7; P.face = 'effort'; break;
    // ---- end of the match
    case 'handshake': // right hand out, pumping up and down
      P.rArm = [f ? 70 : 56, 18, -8]; P.lArm = [6, 18, 12]; P.lLeg = [3, 4, 6]; P.rLeg = [-3, 3, 6]; P.lean = 6; P.face = 'happy'; break;
    case 'applaud': // clapping the fans, hands above the head
      both([150, f ? 70 : 40, f ? 4 : 26], null); P.lLeg = [3, 4, 6]; P.rLeg = [-3, 3, 6]; P.headPitch = -10; P.face = 'happy'; break;
    case 'hug': // arms round a team-mate, rocking
      both([82, 74, 34], [6, 10, 8]); P.lean = 10; P.roll = f ? 5 : -5; P.face = 'happy'; break;
    case 'wave': P.rArm = [166, f ? 34 : 6, f ? 34 : 10]; P.lArm = [6, 18, 12]; P.face = 'happy'; break;
    case 'trudge': { // walking off beaten: short steps, head down, arms hanging
      const ph = f / 8 * Math.PI * 2, s = Math.sin(ph);
      P.lLeg = [14 * s, 6 + 20 * Math.max(0, -Math.sin(ph + 0.6)), 4]; P.rLeg = [-14 * s, 6 + 20 * Math.max(0, Math.sin(ph + 0.6)), 4];
      P.lArm = [-8 * s, 8, 5]; P.rArm = [8 * s, 8, 5]; P.lean = 7; P.headPitch = 26; P.sway = Math.cos(ph) * 0.6; P.face = 'sad'; break;
    }
    // ---- officials
    case 'point': P.rArm = [100, 0, 30]; P.lArm = [4, 15, 12]; P.face = 'angry'; break;
    case 'whistle': P.rArm = [55, 150, 12]; P.lArm = [4, 15, 12]; P.headPitch = -6; break;
    case 'flag': P.rArm = [176, 0, 10]; break;
    // ---- reactions
    case 'complain': both([45, 35, 58], null); P.lean = 4; P.headPitch = -8; P.face = 'rage'; break;
    case 'stumble':
      P.lArm = [72, 20, 72]; P.rArm = [-28, 30, 58]; P.lean = 20; P.lLeg = [28, 45, 8]; P.rLeg = [-18, 25, 10]; P.face = 'shout'; break;
    case 'clap': both([62, f ? 78 : 60, f ? 2 : 26], null); P.face = 'happy'; P.lean = 2; break;
    case 'sad':
      P.face = 'sad';
      if (lk.sad === 0) { both([158, 150, 42], null); P.headPitch = 24; P.lean = 6; }
      else if (lk.sad === 1) { both([-18, 105, 42], null); P.headPitch = 32; P.lean = 9; }
      else if (lk.sad === 2) { both([118, 150, 18], [0, 92, 6]); P.lean = 34; P.headPitch = 30; }   // on his knees, head in hands
      else if (lk.sad === 3) { P.pitch = -86; both([170, 30, 25], null); P.lLeg = [0, 6, 12]; P.rLeg = [10, 30, 10]; } // flat out
      else { both([-40, 0, 34], null); P.lLeg = [88, 0, 10]; P.rLeg = [88, 30, 14]; P.lean = -14; P.headPitch = 30; } // sat on the grass
      break;
    case 'celebrate': {
      P.face = f % 2 ? 'shout' : 'happy';
      const c = lk.cel;
      if (c === 0) { const up = f % 2; both([172, 8, 22 + up * 8], null); P.hairBob = up ? -1.5 : 1.5; P.lift = up ? 6 : 0; const k = up ? 18 : 48; both(null, [k * 0.6, k, 6]); }
      else if (c === 1) { runLegs(P, f * 2, 0.8); both([4, 6, 88], null); P.lean = 12; P.roll = f < 2 ? 10 : -10; }        // airplane
      else if (c === 2) { P.rArm = [150, f % 2 ? 12 : 115, 24]; P.lArm = [14, 75, 18]; P.lean = -4; P.lLeg = [6, 10, 8]; P.rLeg = [-6, 8, 8]; } // fist pump
      else if (c === 3) { both([168, 0, 16], [0, 92, 6]); P.lean = -16; P.headPitch = -28; }                               // pointing to the sky
      else if (c === 4) { both([95, 10, 62], [0, 92, 8]); P.lean = -22; P.headPitch = -22; P.face = 'shout'; }            // knee slide
      else if (c === 5) { P.rArm = [62, 140, 6]; P.lArm = [-10, 100, 40]; P.headPitch = -6; P.face = 'neutral'; both(null, [4, 6, 6]); } // shhh
      else if (c === 6) { const a = f % 2; P.lArm = [a ? 90 : 0, 90, 30]; P.rArm = [a ? 0 : 90, 90, 30]; P.lLeg = [a ? 20 : 0, a ? 40 : 6, 8]; P.rLeg = [a ? 0 : 20, a ? 6 : 40, 8]; P.headYaw = a ? 30 : -30; } // robot
      else if (c === 7) { P.pitch = [0, -100, -200, -300][f]; both([120, 60, 30], [80, 110, 6]); P.lift = [0, 9, 11, 5][f]; P.face = 'shout'; } // somersault
      else if (c === 8) { P.roll = [0, 90, 180, 270][f]; both([175, 0, 30], [0, 0, 30]); P.lift = [0, 5, 7, 5][f]; }       // cartwheel
      else if (c === 9) { P.rArm = [150, 160, 30]; P.lArm = [0, 10, 8]; both(null, [0, 0, 4]); P.headPitch = -10; P.face = 'neutral'; } // salute
      else if (c === 10) { both([55, 100, 4], [4, 8, 8]); P.roll = f % 2 ? 7 : -7; P.lean = 6; P.face = 'happy'; }      // rocking the baby
      else if (c === 11) { P.pitch = 86; both([172, 0, 22], [0, 6, 8]); P.headPitch = -60; P.face = 'shout'; }          // belly slide
      else {                                                                                                         // the Shearer
        runLegs(P, f * 2, 0.6); P.rArm = [180, 0, 3]; P.lArm = [-6, 18, 10]; P.lean = 2; P.headPitch = -10; P.face = 'happy';
        P.lift = f % 2;
      }
      break;
    }
    case 'slide':
      P.pitch = -62; P.lLeg = [86, 4, 6]; P.rLeg = [70, 72, 10]; P.lArm = [-55, 10, 38]; P.rArm = [42, 42, 42]; P.headPitch = 25; P.face = 'angry'; break;
    case 'fall':
      P.pitch = -38; both([150, 30, 58], null); P.lLeg = [42, 32, 10]; P.rLeg = [16, 10, 10]; P.face = 'shout'; break;
    case 'down':
      P.pitch = -86; P.lArm = [10, 25, 65]; P.rArm = [-5, 30, 55]; P.lLeg = [0, 10, 12]; P.rLeg = [16, 42, 8]; P.face = 'pain'; break;
    case 'kneel':
      P.lLeg = [0, 92, 4]; P.rLeg = [86, 88, 6]; P.lean = 24; P.rArm = [55, 68, 12]; P.lArm = [15, 22, 15]; P.face = 'pain'; break;
  }
  return P;
}

// =====================================================================
// Hand-drawn grids (ported from sprites.py). One char per pixel:
// o outline, k/K hair, s/S skin, e eye, J/j shirt, c collar, n number, w/W shorts, d/D socks, b boots,
// q crop, l scalp shine, r dread highlight, m mouth, T teeth, g/G gloves, '.' transparent.
// =====================================================================
const GW = 16;
const norm = (grid, w) => { w = w || Math.max(...grid.map(r => r.length)); return grid.map(r => r.padEnd(w, '.').slice(0, w)); };
const mirror = grid => norm(grid).map(r => r.split('').reverse().join(''));

function torsoS(swing, back) {
  const num = back;
  const r8 = '..o' + (num ? 'JJJnJnnnJj' : 'JJJJJJJJJj') + 'o..';
  const r9 = '..o' + (num ? 'JJnnJnJnJj' : 'JJJJJJJJJj') + 'o..';
  const mid = num ? 'JJnJnJnj' : 'JJJJJJJj';
  const bot = num ? 'JJnJnnnj' : 'JJJJJJJj';
  const rows = [back ? '...ooJJJJJJoo...' : '...ooJJccJJoo...', r8, r9, '.oJo' + mid + 'ojo.', '.oso' + mid + 'oSo.', '.oso' + bot + 'oSo.'];
  if (swing === 1) rows[5] = '..oo' + bot + 'oSo.';
  else if (swing === -1) rows[5] = '.oso' + bot + 'oo..';
  return rows;
}
const SHORTS_S = ['..oowwwwwwwWoo..', '...owwwWwwwWo...'];
const SHORTS_S_SW1 = ['...owwwwwwwWoSo.', '...owwwWwwwWoo..'];
const SHORTS_S_SW2 = ['.oSowwwwwwwWo...', '..oowwwWwwwWo...'];
const LEGS_S_IDLE = ['....osSoosSo....', '....oddoodDo....', '....obboobbo....', '....oooooooo....'];
const LEGS_S_RUN_A = ['....osSoosSo....', '....oddoobbo....', '....oddo.oo.....', '....obbo........', '....oooo........'];
const LEGS_S_RUN_B = ['....osSoosSo....', '....obbooddo....', '.....oo.odDo....', '........obbo....', '........oooo....'];
const HEAD7 = ['', '', '', '', '', '', ''];   // placeholder rows: the head is replaced by BALD + hair
function playerS(f) {
  if (f === 'idle') return HEAD7.concat(torsoS(0), SHORTS_S, LEGS_S_IDLE);
  if (f === 'a') return HEAD7.concat(torsoS(-1), SHORTS_S_SW2, LEGS_S_RUN_A);
  return HEAD7.concat(torsoS(1), SHORTS_S_SW1, LEGS_S_RUN_B);
}
function playerN(f) {
  if (f === 'idle') return HEAD7.concat(torsoS(0, true), SHORTS_S, LEGS_S_IDLE);
  if (f === 'a') return HEAD7.concat(torsoS(1, true), SHORTS_S_SW1, LEGS_S_RUN_B);
  return HEAD7.concat(torsoS(-1, true), SHORTS_S_SW2, LEGS_S_RUN_A);
}
const TORSO_E = ['....ooJJcJoo....', '....oJJJJJjo....', '....oJJJJJjo....', '....oJoJoJjo....', '....oJosoJjo....', '....oJoSoJjo....'];
const TORSO_E_SWING_F = ['....ooJJcJoo....', '....oJJJJJjo....', '....oJJJJJJoo...', '....oJJJJjoJSo..', '....oJJJJjoSSo..', '....oJJJJjjoo...'];
const TORSO_E_SWING_B = ['....ooJJcJoo....', '....oJJJJJjo....', '...ooJJJJJjo....', '..oSoJJJJJjo....', '..oSSoJJJJjo....', '...ooJJJJJjo....'];
const SHORTS_E = ['....owwwwwWo....', '....owwwwWWo....'];
const LEGS_E_IDLE = ['.....osSSo......', '.....oddDo......', '.....obbbbo.....', '.....oooooo.....'];
const LEGS_E_RUN_A = ['....osSooSSo....', '...oddo..odDo...', '..obbo....odDo..', '..oo.......obbbo', '...........oooo.'];
const LEGS_E_RUN_B = ['.....osSSo......', '....obbodDo.....', '....ooo.odDo....', '........obbbo...', '........ooooo...'];
function playerE(f) {
  if (f === 'idle') return HEAD7.concat(TORSO_E, SHORTS_E, LEGS_E_IDLE);
  if (f === 'a') return HEAD7.concat(TORSO_E_SWING_B, SHORTS_E, LEGS_E_RUN_A);
  return HEAD7.concat(TORSO_E_SWING_F, SHORTS_E, LEGS_E_RUN_B);
}
function torsoSE(swing) {
  const rows = ['...ooJJJccJoo...', '..oJJJJJJJJJjo..', '..oJJJJJJJJJjo..', '..ooJJJJJJJjojo.', '...oJJJJJJJjoSo.', '...oJJJJJJJjoSo.'];
  if (swing === -1) rows[5] = '...oJJJJJJJjoo..';
  return rows;
}
const SHORTS_SE = ['...owwwwwwwWoo..', '...owwwwwWwWo...'];
const SHORTS_SE_FWD = ['...owwwwwwwWoSo.', '...owwwwwWwWoo..'];
const LEGS_SE_IDLE = ['....osSoosSo....', '....oddoodDo....', '....obbbobbbo...', '....ooooooooo...'];
const LEGS_SE_A = ['....osSoosSo....', '...obbo.odDo....', '...oo...odDo....', '........obbbo...', '........ooooo...'];
const LEGS_SE_B = ['....osSoosSo....', '....oddo.obbo...', '....oddo..oo....', '....obbbo.......', '....ooooo.......'];
function playerSE(f) {
  if (f === 'idle') return HEAD7.concat(torsoSE(0), SHORTS_SE, LEGS_SE_IDLE);
  if (f === 'a') return HEAD7.concat(torsoSE(0), SHORTS_SE_FWD, LEGS_SE_A);
  return HEAD7.concat(torsoSE(-1), SHORTS_SE, LEGS_SE_B);
}
function torsoNE(swing) {
  const mid = 'JJJJJJJj';
  const rows = ['...ooJJJJJJoo...', '..oJJJJJJJJJjo..', '..oJJJJJJJJJjo..', '.oJo' + mid + 'oo..', '.oso' + mid + 'o...', '.oso' + mid + 'o...'];
  if (swing === -1) rows[5] = '..oo' + mid + 'o...';
  return rows;
}
const SHORTS_NE = ['..oowwwwwwwWo...', '...owwwWwwwWo...'];
const SHORTS_NE_FWD = ['.oSowwwwwwwWo...', '..oowwwWwwwWo...'];
const LEGS_NE_IDLE = ['....osSoosSo....', '....oddoodDo....', '....obboobbo....', '....oooooooo....'];
const LEGS_NE_A = ['....osSoosSo....', '....oddoobbo....', '...obbo..oo.....', '...oooo.........'];
const LEGS_NE_B = ['....osSoosSo....', '....obbooddo....', '.....oo.oddo....', '........obbbo...', '........ooooo...'];
function playerNE(f) {
  if (f === 'idle') return HEAD7.concat(torsoNE(0), SHORTS_NE, LEGS_NE_IDLE);
  if (f === 'a') return HEAD7.concat(torsoNE(0), SHORTS_NE_FWD, LEGS_NE_A);
  return HEAD7.concat(torsoNE(-1), SHORTS_NE, LEGS_NE_B);
}
const BODY = { s: playerS, se: playerSE, e: playerE, ne: playerNE, n: f => playerN(f).map(r => r.replace(/n/g, 'J')) };

// ---------- heads: a bald head per direction, hair and facial hair painted over it ----------
const BALD = {
  s: ['......oooo......', '.....osssso.....', '....osssssSo....', '....osssssSo....', '....osesseSo....', '....osssssSo....', '.....osssSo.....'],
  se: ['......oooo......', '.....osssso.....', '....osssssSo....', '....osssssSo....', '....osSseseo....', '....osssssSo....', '.....osssSo.....'],
  e: ['......oooo......', '.....osssso.....', '....osssssso....', '....osssssso....', '....osSssseso...', '....osssssSo....', '.....osssSo.....'],
  ne: ['......oooo......', '.....osssso.....', '....osssssSo....', '....osssssSo....', '....osssssso....', '....oSssssSo....', '.....osssSo.....'],
  n: ['......oooo......', '.....osssso.....', '....osssssSo....', '....osssssSo....', '....osssssSo....', '....oSsssSSo....', '.....osssSo.....'],
};
const SHORT = {
  s: ['', '......kkkk......', '.....kkkkkk.....', '.....kkkkkK.....', '.....k....K.....'],
  se: ['', '......kkkk......', '.....kkkkkK.....', '.....kkkkkK.....', '.....kk.........', '.....k..........'],
  e: ['', '......kkkk......', '.....kkkkkk.....', '.....kkkkkk.....', '.....kkk........', '.....kk.........'],
  ne: ['', '......kkkk......', '.....kkkkkk.....', '.....kkkkkK.....', '.....Kkkkk......', '.....KKkkk......'],
  n: ['', '......kkkk......', '.....kkkkkk.....', '.....kkkkkK.....', '.....kkkkkK.....', '.....KkkkKK.....'],
};
const dreadTop = rows => rows.map(r => r.split('').map((ch, x) => ('kK'.includes(ch) ? (x % 2 ? 'r' : 'k') : ch)).join(''));
const each = f => ({ s: f('s'), se: f('se'), e: f('e'), ne: f('ne'), n: f('n') });
// style -> dir -> [overlay rows, row the hair starts swinging from (or null)]
const HAIR_STYLES = {
  short: each(d => [SHORT[d], null]),
  crop: {
    s: [['', '......qqqq......', '.....qqqqqq.....', '.....qqqqqq.....'], null],
    se: [['', '......qqqq......', '.....qqqqqq.....', '.....qqqqqq.....', '.....q..........'], null],
    e: [['', '......qqqq......', '.....qqqqqq.....', '.....qqqqq......', '.....q..........'], null],
    ne: [['', '......qqqq......', '.....qqqqqq.....', '.....qqqqqq.....', '.....qqqqq......', '.....qqqq.......'], null],
    n: [['', '......qqqq......', '.....qqqqqq.....', '.....qqqqqq.....', '.....qqqqqq.....', '.....qqqqqq.....'], null],
  },
  none: {
    s: [['', '......l.........', '.....l..........'], null],
    se: [['', '......l.........', '.....l..........'], null],
    e: [['', '.......l........', '......l.........'], null],
    ne: [['', '', '......l.........', '.....l..........'], null],
    n: [['', '', '......l.........', '.....l..........'], null],
  },
  'bald patch': {
    s: [['', '......kslk......', '.....kksskK.....', '.....kkkkkK.....', '.....k....K.....'], null],
    se: [['', '......kslk......', '.....kssskK.....', '.....kkkkkK.....', '.....kk.........', '.....k..........'], null],
    e: [['', '......lssk......', '.....kssskk.....', '.....kkkkkk.....', '.....kkk........', '.....kk.........'], null],
    ne: [['', '......kkkk......', '.....kkslkK.....', '.....ksssKK.....', '.....Kkkkk......', '.....KKkkk......'], null],
    n: [['', '......kkkk......', '.....kkslkk.....', '.....ksssKK.....', '.....kkkkkK.....', '.....KkkkKK.....'], null],
  },
  mullet: {
    s: [SHORT.s.concat(['.....k....K.....', '....ok....Ko....', '...ok......Ko...', '...o........o...']), null],
    se: [SHORT.se.slice(0, 5).concat(['....okk.........', '...okKo.........', '...okK..........', '...oo...........']), null],
    e: [SHORT.e.slice(0, 5).concat(['....okk.........', '...okkK.........', '...okK..........', '...oo...........']), null],
    ne: [SHORT.ne.concat(['.....okkkKo.....', '....okkkKKo.....', '.....okKKo......', '......oo........']), null],
    n: [SHORT.n.concat(['.....okkkKo.....', '....okkkkKKo....', '.....okkKKo.....', '......oooo......']), null],
  },
  long: {
    s: [['', '......kkkk......', '.....kkkkkk.....', '....okkkkkKo....', '....ok....Ko....', '...okk....KKo...', '...okk....KKo...',
      '...okk....KKo...', '...okk....KKo...', '...ok......Ko...', '....o......o....'], 7],
    se: [['', '......kkkk......', '.....kkkkkK.....', '....okkkkkKo....', '....okk.........', '...okkk....Ko...', '...okkK....Ko...',
      '..okkKo....Ko...', '..okKko....Ko...', '..okKo.....o....', '...oo...........'], 7],
    e: [['', '......kkkk......', '.....kkkkkk.....', '.....kkkkkk.....', '....okkk........', '...okkkk........', '...okkKo........',
      '...okkKo........', '...okKo.........', '...oKo..........', '....o...........'], 6],
    ne: [['', '......kkkk......', '.....kkkkkk.....', '.....kkkkkK.....', '.....Kkkkkk.....', '.....KKkkkK.....', '....okkkkkKo....',
      '....okkkkkKo....', '....okkkkKKo....', '....okkKkKKo....', '.....okKKKo.....', '......oooo......'], 8],
    n: [['', '......kkkk......', '.....kkkkkk.....', '.....kkkkkK.....', '.....kkkkkK.....', '.....KkkkKK.....', '....okkkkkKo....',
      '....okkkkkKo....', '....okkkkKKo....', '....okkKkKKo....', '.....okKKKo.....', '......oooo......'], 8],
  },
  dreads: {
    s: [dreadTop(['', '......kkkk......', '.....kkkkkk.....', '....okkkkkko....', '....ok....ko....', '...okk....kko...', '...okk....kko...',
      '...okk....kko...', '...okk....kko...']).concat(['...oko....oko...', '....o......o....']), 7],
    se: [dreadTop(['', '......kkkk......', '.....kkkkkk.....', '....okkkkkko....', '....okk.........', '...okkk....ko...', '...okkk....ko...',
      '..okkko....ko...', '..okkko....ko...']).concat(['..okoko....o....', '...o.o..........']), 7],
    e: [dreadTop(['', '......kkkk......', '.....kkkkkk.....', '.....kkkkkk.....', '....okkk........', '...okkkk........', '...okkko........',
      '...okkko........']).concat(['...orork........', '....o.o.........']), 6],
    ne: [dreadTop(['', '......kkkk......', '.....kkkkkk.....', '.....kkkkkk.....', '.....kkkkk......', '.....kkkkkk.....', '....okkkkkko....',
      '....okkkkkko....', '....okkkkkko....']).concat(['....okoroko.....', '....o.o.o.o.....']), 8],
    n: [dreadTop(['', '......kkkk......', '.....kkkkkk.....', '.....kkkkkk.....', '.....kkkkkk.....', '.....kkkkkk.....', '....okkkkkko....',
      '....okkkkkko....', '....okkkkkko....']).concat(['....okoroko.....', '....o.o.o.o.....']), 8],
  },
};
// ponytail: tied back, the tail swings and streams; afro: a big round mass
HAIR_STYLES.ponytail = {
  s: [['', '......kkkk......', '.....kkkkkk.....', '.....kKkkkK.....', '.....k....K.....', '............ko..', '...........okKo.',
    '...........okKo.', '............oo..'], 6],
  se: [['', '......kkkk......', '.....kkkkkK.....', '...ozkkkkkK.....', '..okKk..........', '..okK...........', '..okK...........',
    '...oo...........'], 4],
  e: [['', '......kkkk......', '.....kkkkkk.....', '...ozkkkkkk.....', '..okkKk.........', '..okK...........', '..okK...........',
    '...oo...........'], 4],
  ne: [['', '......kkkk......', '.....kkkkkk.....', '.....kkkkkK.....', '.....Kzzkk......', '.....okKo.......', '.....okKo.......',
    '.....okKo.......', '......oo........'], 6],
  n: [['', '......kkkk......', '.....kkkkkk.....', '.....kkkkkK.....', '.....kkkkkK.....', '.....KkzzkK.....', '......okKo......',
    '......okKo......', '......okKo......', '.......oo.......'], 7],
};
HAIR_STYLES.afro = {
  s: [['.....oooooo.....', '....okkkkkko....', '...okkkkkkkko...', '...okkkkkkkKo...', '...okk....kKo...', '....ok....Ko....'], null],
  se: [['.....oooooo.....', '....okkkkkko....', '...okkkkkkkko...', '...okkkkkkkKo...', '...okkk.........', '...okkK.........', '....oo..........'], null],
  e: [['.....oooooo.....', '....okkkkkko....', '...okkkkkkkko...', '...okkkkkkkko...', '...okkkk........', '...okkkK........', '....okK.........'], null],
  ne: [['.....oooooo.....', '....okkkkkko....', '...okkkkkkkko...', '...okkkkkkkKo...', '...okkkkkkkKo...', '....okkkkkKo....', '.....oKKKKo.....'], null],
  n: [['.....oooooo.....', '....okkkkkko....', '...okkkkkkkko...', '...okkkkkkkKo...', '...okkkkkkkKo...', '....okkkkkKo....', '.....oKKKKo.....'], null],
};
const FACIAL = {
  moustache: { s: ['', '', '', '', '', '.......kK.......', '......k..K......'], se: ['', '', '', '', '', '........kK......', '.......k.K......'],
    e: ['', '', '', '', '', '.........kK.....'] },
  beard: { s: ['', '', '', '', '.....k....K.....', '.....kkssKK.....', '.....okkKKo.....'], se: ['', '', '', '', '.....kk.........', '.....kkkssK.....', '.....okkKKo.....'],
    e: ['', '', '', '', '.....kkk........', '.....kkkkkK.....', '......kkKKo.....'], ne: ['', '', '', '', '..........k.....', '..........K.....'] },
};
// where the mouth and eyes are on each base head, for expressions
const FACE_PTS = { s: { m: [[7, 5], [8, 5]], e: [[6, 4], [9, 4]] }, se: { m: [[9, 5]], e: [[8, 4], [10, 4]] }, e: { m: [[10, 5]], e: [[10, 4]] } };
// Hair flow. sway: the hair's side-to-side swing (lags the stride, -1..1); stream: how hard it trails
// behind (0 still, 1 running, 2 sprinting). Turned into a pixel shift for the loose rows of the hair,
// per view: "behind" is left in the side views, up-screen facing the camera, down-screen facing away.
function hairMotion(base, sway, stream) {
  let dx = sway, dy = 0;
  if (base === 'e') { dx = -stream - (sway > 0 ? 1 : 0); dy = stream >= 2 ? -1 : sway < 0 ? 1 : 0; }
  else if (base === 's') dy = stream >= 1 ? -1 : 0;
  else if (base === 'n') dy = stream >= 2 ? 1 : 0;
  else if (base === 'se') { dx = sway - (stream >= 1 ? 1 : 0); dy = stream >= 2 ? -1 : 0; }
  else if (base === 'ne') { dx = sway - (stream >= 1 ? 1 : 0); dy = stream >= 2 ? 1 : 0; }
  return [Math.max(-2, Math.min(2, dx)), dy];
}
const FLIP = { w: 'e', nw: 'ne', sw: 'se' };
const DIRS = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];   // index = facing sector (0 = +x, clockwise)
const NUM_COL = { n: 8, ne: 7, nw: 9 };   // centre column of the shirt number

function shiftRow(row, dx) {
  row = row.padEnd(GW, '.');
  if (dx > 0) return '.'.repeat(dx) + row.slice(0, -dx);
  if (dx < 0) return row.slice(-dx) + '.'.repeat(-dx);
  return row;
}
// g: array of char arrays. Rows from swayFrom down are loose: they shift by dx (the tips twice as far)
// and, below the first loose row, by dy rows.
function paintOver(g, overlay, swayFrom, dx, dy) {
  dx = dx || 0; dy = dy || 0;
  overlay.forEach((row, y0) => {
    if (!row) return;
    let y = y0;
    if (swayFrom != null && y0 >= swayFrom) {
      row = shiftRow(row, Math.abs(dx) === 1 ? dx * (y0 >= swayFrom + 2 ? 2 : 1) : dx);
      if (y0 > swayFrom) y += dy;
    }
    if (y < 0 || y >= g.length) return;
    for (let x = 0; x < row.length && x < g[y].length; x++) if (row[x] !== '.') g[y][x] = row[x];
  });
}
function applyFace(g, base, face) {
  const pts = FACE_PTS[base]; if (!pts || !face || face === 'neutral' || face === 'angry' || face === 'sad') return;
  if (face === 'effort' || face === 'pain') for (const [x, y] of pts.e) g[y][x] = 'S';
  const mc = face === 'happy' || face === 'effort' ? 'T' : face === 'pain' ? 'm' : face === 'tongue' ? 'm' : 'm';
  const ms = face === 'tongue' || face === 'pain' ? pts.m.slice(0, 1) : pts.m;
  for (const [x, y] of ms) g[y][x] = mc;
}
// shirt numbers: 3x5 digits with a narrow 1, stamped only onto shirt pixels
const DIGIT = ['nnn/n.n/n.n/n.n/nnn', '.n/nn/.n/.n/.n', 'nnn/..n/nnn/n../nnn', 'nnn/..n/nnn/..n/nnn', 'n.n/n.n/nnn/..n/..n',
  'nnn/n../nnn/..n/nnn', 'nnn/n../nnn/n.n/nnn', 'nnn/..n/..n/..n/..n', 'nnn/n.n/nnn/n.n/nnn', 'nnn/n.n/nnn/..n/nnn'].map(s => s.split('/'));
function stampNum(g, num, cx, row, mask) {
  const ds = String(num % 100).split('').map(Number), w = ds.reduce((a, d) => a + DIGIT[d][0].length, 0) + ds.length - 1;
  let x0 = Math.round(cx - w / 2);
  for (const d of ds) {
    const gl = DIGIT[d];
    for (let y = 0; y < 5; y++) for (let x = 0; x < gl[y].length; x++) {
      const gy = row + y, gx = x0 + x;
      if (gl[y][x] === 'n' && g[gy] && mask.includes(g[gy][gx])) g[gy][gx] = 'n';
    }
    x0 += gl[0].length + 1;
  }
}

// head grid (head rows 0-6, long hair carries on below) for a facing, before mirroring
function headGrid(dir, style, facial, face, sway, stream) {
  const base = FLIP[dir] || dir;
  const g = BALD[base].concat(Array(6).fill('.'.repeat(GW))).map(r => r.split(''));
  const [rows, swayFrom] = HAIR_STYLES[style][base];
  const [dx, dy] = hairMotion(base, sway || 0, stream || 0);
  paintOver(g, rows, swayFrom, dx, dy);
  if (facial && FACIAL[facial][base]) paintOver(g, FACIAL[facial][base]);
  applyFace(g, base, face);
  return FLIP[dir] ? g.map(r => r.reverse()) : g;
}

// full hand-drawn body. frame: idle | a | b
const gridCache = new Map();
function gridPlayer(dir, frame, lk, num, face, gk, sway, stream) {
  const key = dir + frame + lk.style + lk.facial + num + face + gk + sway + stream;
  let g = gridCache.get(key); if (g) return g;
  const base = FLIP[dir] || dir;
  g = norm(BODY[base](frame)).map(r => r.split(''));
  const hd = headGrid(base, lk.style, lk.facial, face, sway, stream);
  for (let y = 0; y < hd.length && y < g.length; y++) for (let x = 0; x < GW; x++) if (y < 7 || hd[y][x] !== '.') g[y][x] = hd[y][x];
  if (FLIP[dir]) g = g.map(r => r.reverse());
  if (NUM_COL[dir] && num) stampNum(g, num, NUM_COL[dir], 8, 'Jj');
  if (gk) for (let y = 7; y < 15; y++) for (let x = 0; x < GW; x++) { if (g[y][x] === 's') g[y][x] = 'g'; else if (g[y][x] === 'S') g[y][x] = 'G'; }
  gridCache.set(key, g);
  return g;
}

// paint a char grid; rot: quarter turns clockwise about (ax, ay) in grid space, placed at (px, py)
function paintGrid(g, grid, pal, px, py, ax, ay, rot, stripes) {
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) {
    let ch = grid[y][x]; if (ch === '.') continue;
    if (stripes && (ch === 'J' || ch === 'j') && ((x >> 1) & 1)) ch = ch === 'J' ? 'X' : 'x';
    let u = x + 0.5 - ax, v = y + 0.5 - ay;
    for (let i = 0; i < (rot & 3); i++) { const t = u; u = -v; v = t; }
    g.fillStyle = pal[ch] || '#ff00ff';
    g.fillRect(Math.floor(px + u), Math.floor(py + v), 1, 1);
  }
}

// ---------- the rig skeleton ----------
function skeleton(P, zf) {   // zf squashes the body's depth (front-on views read flatter, like the sheet)
  zf = zf || 1;
  const J = {};
  for (const [sd, s] of [['l', -1], ['r', 1]]) {
    const [th, kn, ab] = P[sd + 'Leg'];
    const h = [s * HIP, 0, 0];
    const k = add(h, limbDir(th, ab, s), TH);
    const sp = th - kn;
    const a = add(k, limbDir(sp, ab * 0.5, s), SH);
    const t = add(a, [0, Math.sin(sp * DEG), Math.cos(sp * DEG)], FT);
    Object.assign(J, { [sd + 'Hip']: h, [sd + 'Knee']: k, [sd + 'Ankle']: a, [sd + 'Toe']: t });
    const [pi, el, ab2] = P[sd + 'Arm'];
    const shp = [s * SHW, TORSO - 1.3, 0];
    const e = add(shp, limbDir(pi, ab2, s), UA);
    const hand = add(e, limbDir(pi + el, ab2, s), FA);
    Object.assign(J, { [sd + 'Sh']: shp, [sd + 'Elbow']: e, [sd + 'Hand']: hand });
  }
  J.neck = [0, TORSO, 0];
  J.head = [0, TORSO + 3.5, 0.2];
  if (P.headPitch) J.head = rotX(J.head, TORSO, 0, P.headPitch * 0.5);
  const chest = [], pelvis = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const z = sz * zf;
    chest.push([sx * 2.8, TORSO - 0.1, z * 2.2], [sx * 4.1, TORSO - 1.3, z * 3.0], [sx * 4.0, 0.8, z * 2.8]);   // rounded shoulders
    pelvis.push([sx * 4.6, 0.5, z * 2.7], [sx * 4.4, -0.9, z * 2.5]);
  }
  const upper = ['neck', 'head', 'lSh', 'lElbow', 'lHand', 'rSh', 'rElbow', 'rHand'];
  for (const n of upper) J[n] = rotX(J[n], 0, 0, P.lean);
  for (let i = 0; i < chest.length; i++) chest[i] = rotX(chest[i], 0, 0, P.lean * (chest[i][1] > 3 ? 1 : 0.4));
  J.chest = chest; J.pelvis = pelvis;
  J.back = rotX([0, TORSO * 0.55, -3.0], 0, 0, P.lean);
  if (P.pitch || P.roll) {
    const tf = v => { if (P.pitch) v = rotX(v, TORSO / 2, 0, P.pitch); if (P.roll) v = rotZ(v, 0, TORSO / 2, P.roll); return v; };
    for (const n in J) J[n] = Array.isArray(J[n][0]) ? J[n].map(tf) : tf(J[n]);
  }
  // ground the lowest point (the head counts too, for dives and somersaults), then lift (jumps)
  let minY = Infinity;
  const pts = [J.lAnkle, J.rAnkle, J.lToe, J.rToe, J.lKnee, J.rKnee, J.lHand, J.rHand, J.lElbow, J.rElbow, ...J.chest, ...J.pelvis];
  for (const v of pts) minY = Math.min(minY, v[1]);
  const hu = [J.head[0] - J.neck[0], J.head[1] - J.neck[1]];
  minY = Math.min(minY, J.neck[1] + hu[1] * 2);
  J.oy = -minY + 1.7 + (P.lift || 0) * 0.5;
  return J;
}

// ---------- rig rasteriser ----------
function stampLine(g, a, b, w, col) {
  g.fillStyle = col;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 1.5));
  for (let i = 0; i <= n; i++) {
    const x = a.x + (b.x - a.x) * i / n, y = a.y + (b.y - a.y) * i / n;
    g.fillRect(Math.round(x - w / 2), Math.round(y - w / 2), w, w);
  }
}
// segs: [a, b, w, col, dark]. Outline the whole limb first so it reads as one piece, then fill, then a
// dark edge on the lower-right side of 2px-wide segments (the sheet's 'sS' / 'dD' shading).
function limb(g, segs) {
  for (const [a, b, w] of segs) stampLine(g, a, b, w + 2, OUT);
  for (const [a, b, w, c] of segs) stampLine(g, a, b, w, c);
  for (const [a, b, w, , dk] of segs) {
    if (w < 2 || !dk) continue;
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    let nx = -dy / l, ny = dx / l; if (nx + ny * 0.4 < 0) { nx = -nx; ny = -ny; }
    stampLine(g, { x: a.x + nx * 0.5, y: a.y + ny * 0.5 }, { x: b.x + nx * 0.5, y: b.y + ny * 0.5 }, 1, dk);
  }
}
const lerpP = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, d: a.d + (b.d - a.d) * t });

function hull(pts) {
  pts = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
// scanline fill of a convex polygon with a 1px outline; colFn(x, y, x0, x1) picks each pixel's colour
function fillPoly(g, poly, colFn) {
  const ys = poly.map(p => p.y), y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
  const rows = [];
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5; let xa = Infinity, xb = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((a.y <= yc && b.y >= yc) || (b.y <= yc && a.y >= yc)) {
        const x = a.y === b.y ? Math.min(a.x, b.x) : a.x + (yc - a.y) / (b.y - a.y) * (b.x - a.x);
        const x2 = a.y === b.y ? Math.max(a.x, b.x) : x;
        xa = Math.min(xa, x); xb = Math.max(xb, x2);
      }
    }
    if (xa <= xb) rows.push([y, Math.round(xa), Math.max(Math.round(xa) + 1, Math.round(xb))]);
  }
  if (!rows.length) return;
  g.fillStyle = OUT;
  for (const [y, a, b] of rows) g.fillRect(a - 1, y - 1, b - a + 2, 3);
  for (const [y, a, b] of rows) for (let x = a; x < b; x++) { g.fillStyle = colFn(x, y, a, b); g.fillRect(x, y, 1, 1); }
}

function drawRig(g, p, k, lk, P, sec) {
  const ang = sec * 45 * DEG;
  const F = [Math.cos(ang), Math.sin(ang)], R = [-F[1], F[0]];
  const J = skeleton(P, 1 - 0.65 * Math.abs(R[0])), oy = J.oy;
  const pr = v => { const gx = R[0] * v[0] + F[0] * v[2], gy = R[1] * v[0] + F[1] * v[2]; return { x: AX + gx, y: AY - (v[1] + oy) + gy * DEPTH, d: gy }; };
  const Q = {}; for (const n in J) if (n !== 'oy') Q[n] = Array.isArray(J[n][0]) ? J[n].map(pr) : pr(J[n]);
  const pal = palFor(k, lk);
  const torsoD = (Q.lSh.d + Q.rSh.d) / 2;
  const facingAway = F[1] < -0.35;
  const parts = [];
  for (const sd of ['l', 'r']) {
    const hip = Q[sd + 'Hip'], knee = Q[sd + 'Knee'], ank = Q[sd + 'Ankle'], toe = Q[sd + 'Toe'];
    const ld = (hip.d + ank.d) / 2 - 0.4;   // legs sit under the shorts unless clearly in front
    parts.push({ d: ld, draw: () => {
      const kn = lerpP(knee, ank, 0.3);
      limb(g, [[hip, knee, 2, pal.s, pal.S], [knee, kn, 2, pal.s, pal.S], [kn, ank, 2, pal.d, pal.D], [ank, toe, 2, pal.b]]);
    } });
    const sh = Q[sd + 'Sh'], el = Q[sd + 'Elbow'], hd = Q[sd + 'Hand'];
    const ad = (sh.d + el.d + hd.d) / 3 + 0.05;
    parts.push({ d: ad, draw: () => {
      const sleeve = lerpP(sh, el, 0.6), far = ad < torsoD - 0.5;
      limb(g, [[sh, sleeve, 1, far ? pal.j : pal.J], [sleeve, hd, 1, far ? pal.S : pal.s]]);
      g.fillStyle = k.glove ? pal.g : far ? pal.S : pal.s; g.fillRect(Math.round(hd.x - 0.5), Math.round(hd.y - 0.5), 1, 1);
    } });
  }
  // torso: shorts box, then the shirt box with stripes, dark right edge and number on the back
  parts.push({ d: torsoD, draw: () => {
    const cx = Math.round((Q.lSh.x + Q.rSh.x) / 2), wide = Math.abs(R[0]) > 0.5;
    fillPoly(g, hull(Q.chest), (x, y, a, b) => {
      const st = k.sJ && wide && (((x - cx + 64) >> 1) & 1);
      return x >= b - 1 ? (st ? pal.x : pal.j) : st ? pal.X : pal.J;
    });
    fillPoly(g, hull(Q.pelvis), (x, y, a, b) => x >= b - 1 ? pal.W : pal.w);
    if (facingAway && p.num) {
      const bk = Q.back, ds = String(p.num % 100).split('').map(Number);
      let x0 = Math.round(bk.x - (ds.reduce((a, d) => a + DIGIT[d][0].length, 0) + ds.length - 1) / 2), y0 = Math.round(bk.y) - 3;
      g.fillStyle = pal.n;
      for (const d of ds) { const gl = DIGIT[d]; for (let y = 0; y < 5; y++) for (let x = 0; x < gl[y].length; x++) if (gl[y][x] === 'n') g.fillRect(x0 + x, y0 + y, 1, 1); x0 += gl[0].length + 1; }
    }
  } });
  // head: the hand-drawn head for the nearest direction (turned by headYaw), rotated in quarter turns
  // when the body is lying down or upside down
  parts.push({ d: torsoD + 0.02, draw: () => {
    const hsec = (((sec + Math.round((P.headYaw || 0) / 45)) % 8) + 8) % 8;
    const ux = Q.head.x - Q.neck.x, uy = Q.head.y - Q.neck.y;
    const rot = ((Math.round(Math.atan2(ux, -uy) / (Math.PI / 2)) % 4) + 4) % 4;
    const sway = Math.max(-1, Math.min(1, Math.round(P.sway || 0)));
    const hg = headGrid(DIRS[hsec], lk.style, lk.facial, P.face, sway, (P.lift || 0) > 4 ? 2 : Math.abs(P.hairBob || 0) > 0.6 ? 1 : 0);
    paintGrid(g, hg, pal, Math.round(Q.neck.x), Math.round(Q.neck.y), 8, 7, rot);
  } });
  parts.sort((a, b) => a.d - b.d);
  for (const pt of parts) pt.draw();
  return { hand: Q.rHand };
}

// grid-drawn frames for the standing / running poses
const GRID_POSES = { idle: 1, walk: 1, jog: 1, run: 1, sprint: 1, dribble: 1 };
const RUN_CYCLE = ['a', 'a', 'idle', 'idle', 'b', 'b', 'idle', 'idle'];
function drawGrid(g, p, k, lk, pose, f, sec, face) {
  const frame = pose === 'idle' ? 'idle' : RUN_CYCLE[f & 7];
  // hair lags the stride and streams out behind at speed; standing, a breeze lifts it now and then
  const ph = (f & 7) / 8 * Math.PI * 2;
  const sway = pose === 'idle' ? (f ? 1 : 0) : Math.max(-1, Math.min(1, Math.round((pose === 'walk' ? 0.8 : 1.3) * Math.sin(ph - 1.0))));
  const stream = pose === 'sprint' ? 2 : pose === 'run' || pose === 'dribble' ? 1 : 0;
  const dir = DIRS[sec], grid = gridPlayer(dir, frame, lk, p.num, face, !!k.glove, sway, stream);
  const pal = palFor(k, lk);
  const ox = AX - 8, oy = AY - grid.length;
  paintGrid(g, grid, pal, ox, oy, 0, 0, 0, !!k.sJ);
  // a hand for the linesman's flag: the lowest hand pixel on the right of the sprite
  let hand = { x: AX + 5, y: AY - 8 };
  for (let y = 7; y < 15 && y < grid.length; y++) for (let x = GW - 1; x >= 8; x--) if ('sSgG'.includes(grid[y][x])) { hand = { x: ox + x + 0.5, y: oy + y + 0.5 }; break; }
  return { hand };
}

// ---------- atlases ----------
// Sprites are drawn on small software canvases (cheap per-pixel work and pixel reads), then packed
// into one big atlas per sprite type, so the GPU draws a frame from two textures instead of hundreds.
function scratch(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return { c, g: c.getContext('2d', { willReadFrequently: true }) };
}
function Atlas(w, h, cw, ch) {
  this.c = document.createElement('canvas'); this.c.width = w; this.c.height = h;
  this.g = this.c.getContext('2d');
  this.cw = cw; this.ch = ch; this.cols = Math.floor(w / cw); this.n = this.cols * Math.floor(h / ch);
  this.next = 0; this.gen = 0;
}
Atlas.prototype.put = function (src) {
  if (this.next >= this.n) { this.next = 0; this.gen++; this.g.clearRect(0, 0, this.c.width, this.c.height); }
  const i = this.next++, x = (i % this.cols) * this.cw, y = Math.floor(i / this.cols) * this.ch;
  this.g.drawImage(src, x, y);
  return { img: this.c, sx: x, sy: y, gen: this.gen };
};
const playerAtlas = new Atlas(4096, 2048, SPR, SPR);
const playerScratch = scratch(SPR, SPR);

// Low sun from the upper left: brighten each sprite's lit edge (left side, and tops of heads and
// shoulders), so with the dark right-hand edge already in the art every shape reads as round.
const [OR, OG, OB] = rgb(OUT);
function rimLight(c) {
  const g = c.getContext('2d'), w = c.width, h = c.height, id = g.getImageData(0, 0, w, h), d = id.data, src = d.slice();
  const edge = i => i < 0 || src[i + 3] === 0 || (Math.abs(src[i] - OR) < 8 && Math.abs(src[i + 1] - OG) < 8 && Math.abs(src[i + 2] - OB) < 8);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (src[i + 3] === 0 || edge(i)) continue;
    const t = (x === 0 || edge(i - 4) ? 0.26 : 0) + (y === 0 || edge(i - w * 4) ? 0.12 : 0);
    if (!t) continue;
    for (let k = 0; k < 3; k++) d[i + k] = Math.round(src[i + k] + (255 - src[i + k]) * t * (0.55 + src[i + k] / 560));
  }
  g.putImageData(id, 0, 0);
}

// Form shading for kit and skin, worked out from the finished sprite so the hand-drawn frames and the
// rig poses get the same treatment. Light comes from the upper left:
//  - every horizontal run between outlines is treated as a cylinder: its right third falls into shadow
//  - a part tucked under another (chin over collar, shirt over shorts, shorts over knees) gets a contact shadow
//  - a pale pixel under a much darker one (hair over forehead) is shadowed too
//  - undersides (a pixel with outline below it) are slightly darker
// Shadows shift toward blue rather than just going black.
function shadeForm(c) {
  const g = c.getContext('2d'), w = c.width, h = c.height, id = g.getImageData(0, 0, w, h), d = id.data, src = d.slice();
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : (y * w + x) * 4);
  const solid = i => i >= 0 && src[i + 3] !== 0;
  const isOut = i => i >= 0 && src[i + 3] !== 0 && Math.abs(src[i] - OR) < 8 && Math.abs(src[i + 1] - OG) < 8 && Math.abs(src[i + 2] - OB) < 8;
  const body = i => solid(i) && !isOut(i);
  const L = i => 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
  const k = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w;) {
      if (!body(at(x, y))) { x++; continue; }
      let x2 = x; while (x2 < w && body(at(x2, y))) x2++;
      const n = x2 - x;
      if (n >= 3) for (let xx = x; xx < x2; xx++) {          // light, base, half-shadow, shadow
        const t = (xx - x + 0.5) / n;
        k[y * w + xx] += t > 0.62 ? (n >= 6 ? 0.26 : 0.18) : t > 0.4 && n >= 5 ? 0.09 : 0;
      }
      x = x2;
    }
  }
  for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) {
    const i = at(x, y); if (!body(i)) continue;
    const up = at(x, y - 1), up2 = at(x, y - 2), dn = at(x, y + 1);
    if (isOut(up) && body(up2)) k[y * w + x] += 0.28;                        // contact shadow under another part
    else if (body(up) && L(up) < L(i) - 70) k[y * w + x] += 0.2;           // hair over skin, dark over light
    if (isOut(dn) || !solid(dn)) k[y * w + x] += 0.12;                     // underside
  }
  for (let j = 0; j < w * h; j++) {
    const t = Math.min(0.5, k[j]); if (!t) continue;
    const i = j * 4;
    d[i] = Math.round(src[i] * (1 - t)); d[i + 1] = Math.round(src[i + 1] * (1 - t * 0.9)); d[i + 2] = Math.round(src[i + 2] * (1 - t * 0.6) + 14 * t);
  }
  g.putImageData(id, 0, 0);
}
// standing in the stands' shadow: the same tint the shadow overlay puts on the pitch
function inShadow(c) {
  const g = c.getContext('2d'), id = g.getImageData(0, 0, c.width, c.height), d = id.data;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { d[i] = d[i] * 0.72 + 2.2; d[i + 1] = d[i + 1] * 0.72 + 4.5; d[i + 2] = d[i + 2] * 0.72 + 11; }
  g.putImageData(id, 0, 0);
}

// ---------- public: player sprite ----------
const cache = new WeakMap();
function playerSprite(p, pose, f, sec, extra, shadowed) {
  let m = cache.get(p); if (!m) { m = new Map(); cache.set(p, m); }
  const key = pose + '|' + f + '|' + sec + '|' + (extra || 0) + (shadowed ? '|s' : '');
  let e = m.get(key);
  if (!e || e.gen !== playerAtlas.gen) {
    const { c, g } = playerScratch;
    g.clearRect(0, 0, SPR, SPR);
    const k = kitFor(p), lk = looks(p);
    const info = GRID_POSES[pose]
      ? drawGrid(g, p, k, lk, pose, f, sec, pose === 'sprint' || pose === 'dribble' ? 'effort' : 'neutral')
      : drawRig(g, p, k, lk, poseParams(pose, f, lk, extra), sec);
    shadeForm(c);
    rimLight(c);
    if (shadowed) inShadow(c);
    e = playerAtlas.put(c); e.hand = info.hand; m.set(key, e);
  }
  return e;
}

// ---------- fans ----------
// Built from the same pieces as the players (sheet heads and hairstyles, 2-tone clothes, 1px outlines),
// drawn at native size and scaled by SCALE. Fans at the near end are seen from behind (look.away).
// look: { shirt, stripes, pants, skin, hair, hairStyle 0-5, hat, scarf:[a,b], away, key }
const FW = 18, FH = 25, FX = 9, FY = 23;          // native canvas; (FX, FY) is the seat/feet point
const FAN_HAIR_STYLES = ['short', 'crop', 'long', 'none', 'bald patch', 'mullet'];
const fanCache = new Map();
const fanAtlas = new Atlas(2048, 2048, FW, FH);
const fanScratch = scratch(FW, FH);
// returns the atlas slot, or null when it isn't drawn yet and the caller is out of budget
function fanSlot(look, state, f, mayCreate) {
  const e = fanCache.get(look.key + state + f);
  if (e && e.gen === fanAtlas.gen) return e;
  if (!mayCreate) return null;
  return fanSprite(look, state, f);
}
function fanGrid(look, state, f) {
  const G = Array.from({ length: FH }, () => Array(FW).fill('.'));
  const put = (x, y, ch) => { x += 1; if (y >= 0 && y < FH && x >= 0 && x < FW) G[y][x] = ch; };   // x in 16-wide sheet columns
  const seated = state === 'sit' || state === 'lean' || state === 'sad';
  const hy = seated ? 6 : 4, T = hy + 7;                   // head top row, shoulder row
  // legs: standing fans show trousers and shoes; seated ones a lap and shoes
  if (seated) { for (let y = 19; y <= 20; y++) for (let x = 3; x <= 12; x++) put(x, y, x === 12 ? 'P' : 'p'); }
  else {
    for (let y = 17; y <= 18; y++) for (let x = 3; x <= 12; x++) put(x, y, x === 12 ? 'P' : 'p');
    for (const x of [5, 6, 9, 10]) { put(x, 19, x === 10 ? 'P' : 'p'); put(x, 20, x === 10 ? 'P' : 'p'); }
  }
  for (const x of [5, 6, 9, 10]) put(x, 21, 'b');
  // torso, with stripes on every other pair of columns
  const shirtAt = (x, y, dark) => put(x, y, look.stripes && ((x >> 1) & 1) ? (dark ? 'x' : 'X') : dark ? 'j' : 'J');
  const bot = seated ? 18 : 16;
  for (let y = T; y <= bot; y++) for (let x = y <= T + 1 ? 3 : 4; x <= (y <= T + 1 ? 12 : 11); x++) shirtAt(x, y, x >= (y <= T + 1 ? 12 : 11));
  // arms. side: -1 left (col 2), 1 right (col 13, shaded)
  const sk = s => (s > 0 ? 'S' : 's'), sl = s => (s > 0 ? 'j' : 'J');
  const armDown = (s, len) => { const x = s < 0 ? 2 : 13; put(x, T + 1, sl(s)); for (let y = T + 2; y <= T + 1 + len; y++) put(x, y, sk(s)); };
  const armUp = (s, sway) => {
    const x = s < 0 ? 2 : 13;
    put(x, T, sl(s)); put(x, T + 1, sl(s));
    for (let y = hy - 3; y < T; y++) put(x + (y < hy + 2 ? sway : 0), y, sk(s));
  };
  const sway = f ? 1 : -1;
  if (state === 'cheer') { armUp(-1, 0); armUp(1, 0); }
  else if (state === 'scarf') { armUp(-1, sway); armUp(1, sway); }
  else if (state === 'wave') { armDown(-1, 4); armUp(1, sway); }
  else if (state === 'sad') {   // hands on head
    for (const s of [-1, 1]) { const x = s < 0 ? 2 : 13; put(x, T, sl(s)); for (let y = hy + 2; y < T; y++) put(x, y, sk(s)); put(x + (s < 0 ? 1 : -1), hy + 1, sk(s)); }
  } else if (state === 'clap') {
    for (const s of [-1, 1]) { const x = s < 0 ? 2 : 13; put(x, T + 1, sl(s)); put(x, T + 2, sk(s)); }
    if (f) { put(3, T + 3, 's'); put(4, T + 3, 's'); put(5, T + 2, 's'); put(6, T + 2, 's'); put(7, T + 1, 's'); put(8, T + 1, 'S'); put(9, T + 2, 'S'); put(10, T + 2, 'S'); put(11, T + 3, 'S'); put(12, T + 3, 'S'); }
    else { put(2, T + 3, 's'); put(3, T + 4, 's'); put(13, T + 3, 'S'); put(12, T + 4, 'S'); }
  } else if (state === 'lean') {   // elbows on knees, forearms across the lap
    armDown(-1, 3); armDown(1, 3); for (let x = 3; x <= 12; x++) put(x, T + 5, x > 8 ? 'S' : 's');
  } else { armDown(-1, 4); armDown(1, 4); }
  // head: the sheet's front or back head with a hairstyle, or a woolly hat
  const base = look.away ? 'n' : 's';
  const hg = BALD[base].map(r => r.split(''));
  const style = FAN_HAIR_STYLES[look.hairStyle % FAN_HAIR_STYLES.length];
  if (look.hat) paintOver(hg, ['......hhhh......', '.....hhhhhh.....', '.....hhhhhH.....', '.....HHHHHH.....']);
  else paintOver(hg, HAIR_STYLES[style][base][0].slice(0, 7));
  if (!look.away && (state === 'cheer' || state === 'scarf' || state === 'wave')) { hg[5][7] = 'm'; hg[5][8] = 'm'; }
  for (let y = 0; y < 7; y++) for (let x = 0; x < GW; x++) if (hg[y][x] !== '.') put(x, hy + y, hg[y][x]);
  // scarf: held up over the head, or worn round the neck
  if (look.scarf) {
    if (state === 'scarf') { for (let x = -1; x <= 16; x++) put(x + sway, hy - 3, ((x + 8) >> 1) & 1 ? 'A' : 'a'); }
    else { for (let x = 5; x <= 10; x++) put(x, T, x & 1 ? 'A' : 'a'); for (let y = T + 1; y <= T + 3; y++) put(9, y, y & 1 ? 'A' : 'a'); }
  }
  // outline everything that isn't outlined yet
  const out = [];
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    if (G[y][x] !== '.') continue;
    const n = (yy, xx) => yy >= 0 && yy < FH && xx >= 0 && xx < FW && G[yy][xx] !== '.' && G[yy][xx] !== 'o';
    if (n(y - 1, x) || n(y + 1, x) || n(y, x - 1) || n(y, x + 1)) out.push([x, y]);
  }
  for (const [x, y] of out) G[y][x] = 'o';
  return G;
}
function fanSprite(look, state, f) {
  const key = look.key + state + f;
  const { c, g } = fanScratch;
  g.clearRect(0, 0, FW, FH);
  const sk = nearest(SKIN_PAL, look.skin), hr = nearest(HAIR_PAL, look.hair);
  const dk = col => shade(col, lum(col) > 200 ? -0.26 : -0.36);
  const pal = { o: OUT, e: EYE, b: BOOT, m: MOUTH, J: look.shirt, j: dk(look.shirt), X: look.stripes || look.shirt, x: dk(look.stripes || look.shirt),
    p: look.pants, P: dk(look.pants), s: sk[0], S: sk[1], k: hr[0], K: hr[1], q: mix(hr[0], sk[0], 0.45), l: mix(sk[0], '#ffffff', 0.35),
    r: mix(hr[0], '#ffffff', 0.28), h: look.hat || '#000', H: look.hat ? dk(look.hat) : '#000',
    a: look.scarf ? look.scarf[0] : '#000', A: look.scarf ? look.scarf[1] : '#000' };
  const grid = fanGrid(look, state, f);
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) { const ch = grid[y][x]; if (ch !== '.') { g.fillStyle = pal[ch]; g.fillRect(x, y, 1, 1); } }
  rimLight(c);
  const e = fanAtlas.put(c); e.made = true;
  fanCache.set(key, e);
  return e;
}

// the sheet's ball: 4 spin frames
const BALL = [
  ['..ooo..', '.owwwo.', 'owwbwwo', 'owbbbwo', 'owwbwwo', '.owwwo.', '..ooo..'],
  ['..ooo..', '.owwbo.', 'owwbbwo', 'owwwwwo', 'obwwwwo', '.obwwo.', '..ooo..'],
  ['..ooo..', '.owwwo.', 'owwwwbo', 'obwwbbo', 'obbwwbo', '.owwwo.', '..ooo..'],
  ['..ooo..', '.obwwo.', 'obbwwwo', 'owwwwwo', 'owwwbbo', '.owwbo.', '..ooo..'],
];
const BALL_PAL = { o: OUT, w: '#f7f7f2', b: '#1b1b20' };
// a ball frame as a canvas, scaled up by k
function ballSprite(frame, k) {
  const grid = BALL[frame & 3], c = document.createElement('canvas'); c.width = c.height = 7 * k;
  const g = c.getContext('2d');
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (grid[y][x] !== '.') { g.fillStyle = BALL_PAL[grid[y][x]]; g.fillRect(x * k, y * k, k, k); }
  return c;
}

window.Sprites = { _RUN_STYLES: RUN_STYLES, playerSprite, fanSlot, ballSprite, kitFor, looks, AX, AY, SPR, SCALE, FW, FH, FX, FY, shade, hashStr };
})();
