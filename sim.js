/*
 * Linafa 27 — match simulation (no DOM). Exposes window.Sim.
 * World units are pixels at ~6px per metre. Pitch runs vertically: y=0 is the top goal line.
 */
'use strict';
(function (root) {

const W = 408, L = 630;
const GOAL_W = 60, GOAL_H = 21, GOAL_D = 13;   // drawn larger than life to match the sprites
const BOX_W = 242, BOX_D = 99, SIX_W = 110, SIX_D = 33;
const CIRCLE_R = 55, SPOT_D = 66;
const GRAV = 450;
const GROUND_FRICTION = 1.3, AIR_FRICTION = 0.12;
const DT = 1 / 60;
const HALFTIME_LEN = 7, FULLTIME_LEN = 10;   // seconds of walking off / celebrating before play moves on
const TAP_TIME = 0.16, CHARGE_TIME = 0.5, AFTERTOUCH_TIME = 0.5;

// Formation slots as [fx, fy]: fx 0..1 across (left→right as the team attacks),
// fy 0..1 from own goal line toward the opponent's.
const FORMATIONS = {
  '4-4-2': [[.5,.04],[.14,.24],[.38,.2],[.62,.2],[.86,.24],[.14,.45],[.38,.42],[.62,.42],[.86,.45],[.4,.62],[.6,.62]],
  '4-3-3': [[.5,.04],[.14,.24],[.38,.2],[.62,.2],[.86,.24],[.3,.42],[.5,.38],[.7,.42],[.18,.62],[.5,.66],[.82,.62]],
  '4-5-1': [[.5,.04],[.14,.24],[.38,.2],[.62,.2],[.86,.24],[.12,.45],[.32,.42],[.5,.38],[.68,.42],[.88,.45],[.5,.64]],
  '3-5-2': [[.5,.04],[.26,.2],[.5,.18],[.74,.2],[.08,.43],[.32,.4],[.5,.36],[.68,.4],[.92,.43],[.4,.62],[.6,.62]],
  '5-3-2': [[.5,.04],[.08,.26],[.28,.2],[.5,.18],[.72,.2],[.92,.26],[.3,.42],[.5,.4],[.7,.42],[.4,.62],[.6,.62]],
};

const POS_MOD = {
  GK: { pace: -15, shooting: -40, passing: -15, tackling: -40, keeping: 0 },
  DF: { pace: -4, shooting: -20, passing: -8, tackling: 6, keeping: -70 },
  MF: { pace: 0, shooting: -6, passing: 6, tackling: -6, keeping: -70 },
  FW: { pace: 5, shooting: 6, passing: -4, tackling: -25, keeping: -70 },
};
const SKINS = ['#f1c9a5', '#e0ac85', '#c68a5e', '#9b6440', '#6e4428', '#f5d6bc'];
const HAIRS = ['#2b1d12', '#4a2f1a', '#111111', '#7a4a22', '#d9b25a', '#8c2f12', '#3a3a3a'];

// ---------- utils ----------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function norm(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }
function rot(x, y, a) { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; }
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function hexRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function kitClash(a, b) { const x = hexRgb(a.shirt), y = hexRgb(b.shirt); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 130; }

let G = null;

// CPU handicaps apply only to a CPU team playing against a human; assists only to human teams.
const DIFFICULTY = {
  easy:   { cpuSpeed: 0.85, cpuPress: 0.75, cpuSlide: 0.25, stealVsHuman: 0.35, humanSteal: 1.8,
            cpuPassErr: 2.0, cpuShotErr: 1.8, cpuKeeper: -18, humanKeeper: 8, passCone: 0.55, cleanTouch: true,
            slideReach: 14, teamPress: true, smartSwitch: true, shape: 0.3, support: 0.55, cardMul: 0.6 },
  normal: { cpuSpeed: 1, cpuPress: 1, cpuSlide: 1, stealVsHuman: 1, humanSteal: 1,
            cpuPassErr: 1, cpuShotErr: 1, cpuKeeper: 0, humanKeeper: 0, passCone: 0.8, cleanTouch: false,
            slideReach: 9, teamPress: false, smartSwitch: false, shape: 0.8, support: 0.85, cardMul: 1 },
  hard:   { cpuSpeed: 1.06, cpuPress: 1.05, cpuSlide: 1.4, stealVsHuman: 1.3, humanSteal: 0.85,
            cpuPassErr: 0.6, cpuShotErr: 0.7, cpuKeeper: 6, humanKeeper: 0, passCone: 0.8, cleanTouch: false,
            slideReach: 9, teamPress: false, smartSwitch: false, shape: 1, support: 1, cardMul: 1 },
};
// ---------- styles of play ----------
// Every style uses the same knobs with different values, so a new style is just a new entry.
// teams.js picks one per team with `style: "positional"` etc. Local pitch coordinates: fy 0 = own goal line, 1 = theirs.
const STYLE_BASE = {
  label: 'BALANCED',
  // shape
  line: 0,          // back-line height out of possession: <0 sits deep, >0 squeezes up
  block: 0.64,      // vertical gap between the lines of the defensive block (small = compact; scaled up 1.5x in defendZone)
  compact: 0.82,    // horizontal spread of the block (small = narrow, guards the middle)
  shift: 0.34,      // how far the block slides across to the ball side
  fwdHigh: 0,       // forwards who stay up the pitch when defending (the counter threat)
  manMark: 0,       // 1 = each player picks up one opponent and follows him anywhere
  width: 1.4,       // in possession: how far wide men stretch toward the touchlines
  ballPull: 0.15,   // in possession: how much the shape slides toward the ball
  gather: 0,        // in possession: players cluster around the ball (relational play)
  farOutlet: 0,     // 1 = the far-side forward stays wide for the switch
  depth: 0,         // in possession: whole shape pushes up
  overlap: 0,       // in possession: defenders bomb on
  restD: 0.3,       // in possession: defenders stay goal-side of forwards left up the pitch (stops counters)
  spacing: 36,      // how hard team-mates avoid sharing space (positional play keeps lanes; scaled 1.3x in findSpace)
  supR: 70,         // distance of the support triangle around the carrier
  // pressing
  pressZone: 0.55,  // the nearest man closes the carrier down when the ball is below this fy; otherwise he jockeys
  press2Zone: 0.45, // extra pressers join below this
  pressers: 1,      // how many extra pressers
  pressSpeed: 1,
  contain: 0.6,     // speed of the jockeying man when not pressing
  cpress: 0,        // counter-press: players who swarm the ball right after losing it
  cpressT: 0,       // ...for this many seconds
  stamina: 0,       // fraction of pressing intensity lost by the end of each half
  tackle: 1,        // eagerness to slide in and steal
  // on the ball
  tempo: 1,         // >1: releases the ball sooner and more often
  prog: 0.5,        // pass choice: value of forward progress
  finalProg: 0,     // ...extra once the carrier is in the final third (the killer ball)
  boxPass: 6,       // bonus for a ball to a man in front of goal (cut-backs, the pass into the gap)
  safe: 1,          // pass choice: value of an open receiver and a clear lane
  backPen: 0,       // extra penalty on backward passes
  longBias: 0,      // bonus for long balls to forwards and runners
  range: 240,       // longest pass considered
  through: 6,       // bonus for a ball to a runner
  switchBias: 0,    // bonus for switching play to the far side
  dribble: 0,       // chance to take a man on instead of passing when pressed
  skill: 0,         // chance to try a skill move on a man in the way
  skillWin: 0, skillLoss: 1,   // skill move success bonus / how badly a failed one goes
  shootDist: 150, shootEager: 1, crossBias: 0.12,
  shotPow: 1, shotErr: 1, headPow: 1, headErr: 1,   // long shots and headers
  boxCrash: 0,      // centre-backs go up for corners
  secondBall: 0,    // team-mates who crowd the landing spot of a long ball
  oneTwo: 1,        // speed burst for completing a one-two
  // transitions
  counter: 0,       // seconds of all-out forward play after winning the ball...
  counterZone: 0.5, // ...if it was won below this fy
  counterLong: 0,   // ...going long to a forward first
  counterBoost: 1,  // ...with the runners sprinting this much faster
  possClock: 9,     // seconds without going forward before the carrier is forced to try something
  // momentum
  sig: null,        // signature event that makes the team "hot"...
  sigN: 1,          // ...once it has happened this many times
  hot: {}, hotText: '', hotDur: 8,
};
const STYLES = {
  balanced: {},
  // Pep: a grid of zones, short and safe, wingers on the touchline, swarm after losing it, high line.
  positional: {
    label: 'POSITIONAL', restD: 1, line: 0.035, block: 0.56, compact: 0.78, width: 1.75, ballPull: 0.08, depth: 0.03, spacing: 50, supR: 60,
    pressZone: 0.62, press2Zone: 0.5, cpress: 3, cpressT: 5, tempo: 1.8, prog: 0.34, finalProg: 0.6, boxPass: 26, safe: 1.3, range: 210, through: 16,
    skill: 0.04, shootDist: 150, shootEager: 1, crossBias: 0.04, oneTwo: 1.35, possClock: 8,
    sig: 'chain', hot: { tempo: 2.8, through: 20, prog: 0.45 }, hotText: 'TIKI-TAKA!',
  },
  // Klopp/Rangnick: losing the ball is the trigger. Narrow, high, vertical, shoot fast. Tires as the half goes on.
  gegenpress: {
    label: 'GEGENPRESS', restD: 0.7, line: 0.06, block: 0.5, compact: 0.62, shift: 0.42, width: 1.05, ballPull: 0.25, depth: 0.04,
    pressZone: 1, press2Zone: 0.85, pressers: 2, pressSpeed: 1.03, cpress: 4, cpressT: 4, stamina: 0.4, tackle: 1.15,
    tempo: 1.6, prog: 1.0, safe: 0.75, backPen: 0.6, through: 14, dribble: 0.15, shootDist: 165, shootEager: 1.1,
    counter: 4, counterZone: 1, possClock: 6,
    sig: 'press', sigN: 2, hot: { pressSpeed: 1.18, pressers: 3, cpress: 5, stamina: 0 }, hotText: 'GEGENPRESS!',
  },
  // Mourinho/Simeone: two deep compact lines, press only in the danger zone, two forwards kept up, then go long and sprint.
  lowblock: {
    label: 'LOW BLOCK', restD: 0.5, line: -0.12, block: 0.42, compact: 0.6, shift: 0.22, fwdHigh: 2, width: 1.2, depth: -0.03,
    pressZone: 0.34, press2Zone: 0.3, contain: 0.5, tackle: 1.1, tempo: 1.2, prog: 0.8, safe: 0.9, through: 14, range: 300,
    shootDist: 160, counter: 4, counterZone: 0.45, counterLong: 45, counterBoost: 1.18, possClock: 8,
    sig: 'counter', sigN: 2, hot: { counterBoost: 1.25, pressZone: 0.4 }, hotText: 'ON THE BREAK!', hotDur: 20,
  },
  // Pulis/Dyche: launch it at the big man, crowd the second ball, cross it, shoot from anywhere, attack set pieces.
  direct: {
    label: 'DIRECT', line: -0.03, block: 0.6, compact: 0.8, width: 1.35, pressZone: 0.72, press2Zone: 0.55, tackle: 1.5,
    tempo: 1.4, prog: 0.9, safe: 0.7, longBias: 34, range: 330, through: 10, shootDist: 215, shootEager: 1.5, crossBias: 0.5,
    shotPow: 1.15, shotErr: 1.6, headPow: 1.35, headErr: 1.4, boxCrash: 1, secondBall: 2, possClock: 6,
    sig: 'header', sigN: 6, hot: { longBias: 50, secondBall: 3, crossBias: 0.8 }, hotText: 'ROUTE ONE!', hotDur: 12,
  },
  // Gasperini/Bielsa: man-to-man all over the pitch, defenders join in, fast and full of tackles.
  manmark: {
    label: 'MAN-MARKING', restD: 0.15, line: 0.04, block: 0.6, compact: 0.85, width: 1.4, depth: 0.05, overlap: 0.14, manMark: 1,
    pressZone: 1, press2Zone: 0.6, pressSpeed: 1.05, cpress: 2, cpressT: 3, tackle: 1.6,
    tempo: 1.8, prog: 0.8, safe: 0.9, through: 12, dribble: 0.2, skill: 0.1, shootDist: 170, shootEager: 1.2, possClock: 7,
    sig: 'press', sigN: 3, hot: { overlap: 0.24, tempo: 2.3, pressSpeed: 1.12 }, hotText: 'FULL THROTTLE!',
  },
  // Diniz/street football: everyone near the ball, dribbles, flicks, then a sudden switch to the one man left wide.
  flair: {
    label: 'FLAIR', restD: 0.15, line: 0.02, block: 0.6, compact: 0.72, shift: 0.6, width: 0.9, ballPull: 0.5, gather: 0.3, farOutlet: 1,
    spacing: 24, supR: 46, pressZone: 0.65, press2Zone: 0.5, cpress: 2, cpressT: 2,
    tempo: 1.1, prog: 0.5, safe: 1.1, switchBias: 28, through: 8, dribble: 0.45, skill: 0.5, skillWin: 0.18, skillLoss: 1.8,
    shootDist: 165, crossBias: 0.06, possClock: 9,
    sig: 'skill', sigN: 4, hot: { skill: 0.8, dribble: 0.6, skillWin: 0.3 }, hotText: 'JOGO BONITO!',
  },
};
function styleOf(name) {
  const k = STYLES[name] ? name : 'balanced';
  const s = Object.assign({ key: k }, STYLE_BASE, STYLES[k]);
  return { S: s, SH: Object.assign({}, s, s.hot) };
}
const styleLabel = def => styleOf(def.style).S.label;
const sty = t => (t.hotT > G.clock ? t.SH : t.S);
const countering = t => t.counterT > G.clock;
const highFw = p => { const n = sty(p.team).fwdHigh; return n > 0 && p.role === 'FW' && p.idx >= 11 - n; };
const pace = p => p.speed * (p.boostT > 0 ? p.boost : 1) * (p.team.hotT > G.clock ? 1.04 : 1);
// pressing tires a stamina team out as each half goes on
const fatigue = t => 1 - sty(t).stamina * clamp(G.time / G.halfLen, 0, 1);
const ST = (t, k, v) => { t.stats[k] = (t.stats[k] || 0) + (v === undefined ? 1 : v); };
function sigEvent(t, kind) {
  const s = t.S;
  if (s.sig !== kind || G.clock < t.hotCD || G.state !== 'play' || ++t.sigC < s.sigN) return;
  t.sigC = 0; t.hotT = G.clock + s.hotDur; t.hotCD = t.hotT + 60; ST(t, 'hot');
  emit('hot', { team: t, text: `${t.short} ${s.hotText}` });
}

const vsHuman = t => !t.human && !!t.opp.human;   // CPU team facing a human
const slideReach = p => (p.team.human ? G.diff.slideReach : 9);
const emit = (type, data) => G.events.push({ type, data });

// ---------- setup ----------
function parsePlayer(raw, i) {
  const o = Array.isArray(raw) ? { name: raw[0], pos: raw[1], rating: raw[2] } : Object.assign({}, raw);
  const pos = String(o.pos || 'MF').toUpperCase();
  const r = o.rating != null ? o.rating : 70;
  const m = POS_MOD[pos] || POS_MOD.MF;
  const st = {};
  for (const k of ['pace', 'shooting', 'passing', 'tackling', 'keeping']) st[k] = clamp(o[k] != null ? o[k] : r + m[k], 10, 99);
  return { name: o.name || 'Player ' + (i + 1), pos, num: o.number, rating: r, st };
}

function rolesFor(f) {
  const [d, m, a] = f.split('-').map(Number);
  return ['GK'].concat(Array(d).fill('DF'), Array(m).fill('MF'), Array(a).fill('FW'));
}

function teamRating(def) {
  const ps = (def.players || []).slice(0, 11).map(parsePlayer);
  return ps.length ? Math.round(ps.reduce((s, p) => s + p.rating, 0) / ps.length) : 0;
}

function makeTeam(def, dir) {
  const formation = FORMATIONS[def.formation] ? def.formation : '4-4-2';
  const roles = rolesFor(formation);
  const roster = (def.players || []).map(parsePlayer);
  const gi = roster.findIndex(p => p.pos === 'GK');
  if (gi > 0) roster.unshift(roster.splice(gi, 1)[0]);
  const t = {
    name: def.name, short: def.short || def.name.slice(0, 3).toUpperCase(),
    kit: Object.assign({ shirt: '#ffffff', shorts: '#222222', socks: '#ffffff' }, def.kit),
    gkKit: Object.assign({ shirt: '#22aa44', shorts: '#111111', socks: '#22aa44' }, def.gkKit),
    dir, form: FORMATIONS[formation], formation, score: 0, players: [], human: null, opp: null,
    chaser: null, press: [], crowd: [],
    style: def.style, ...styleOf(def.style), hotT: 0, hotCD: 0, counterT: 0, lostT: -99, progT: 0, progFy: 0, chain: 0, sigC: 0,
    labelT: -99, stats: {},
  };
  for (let i = 0; i < 11; i++) {
    const r = roster[i] || parsePlayer(['Trialist ' + (i + 1), roles[i], 55], i);
    const h = hash(r.name);
    t.players.push({
      team: t, idx: i, role: roles[i], name: r.name, num: r.num || i + 1, st: r.st,
      speed: 55 + r.st.pace * 0.28,
      x: W / 2, y: L / 2, vx: 0, vy: 0, fx: 0, fy: dir,
      state: 'ok', stateT: 0, stun: 0, headCD: 0, think: 0, anim: 0, jump: 0, kickAnim: 0,
      holdT: 0, missCD: 0, reactT: 0, threat: false, slideWon: false, boostT: 0, boost: 1,
      skin: SKINS[h % SKINS.length], hair: HAIRS[(h >>> 5) % HAIRS.length],
    });
  }
  return t;
}

function newBall() {
  return { x: W / 2, y: L / 2, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, owner: null, lastTouch: null,
    noTouchP: null, noTouchT: 0, flightT: 0, stealCD: 0, target: null, passer: null, after: null, inNet: 0, roll: 0 };
}

function newMatch(homeDef, awayDef, opts) {
  opts = opts || {};
  const A = makeTeam(homeDef, -1), B = makeTeam(awayDef, 1);
  if (kitClash(A.kit, B.kit) && awayDef.kit2) B.kit = Object.assign({}, B.kit, { stripes: undefined }, awayDef.kit2);
  A.opp = B; B.opp = A;
  G = { teams: [A, B], ball: newBall(), state: 'setpiece', sp: null, half: 1, time: 0,
    halfLen: (opts.halfMinutes || 3) * 60, stateT: 0, events: [], humans: [], clock: 0,
    firstKick: A, goals: [], lastGoal: null,
    foul: null, adv: null, offside: null, pen: null, pendingCards: [], cardShow: null, offPitch: [] };
  if (opts.p1 !== false) addHuman(A, 'p1');
  if (opts.p2) addHuman(B, 'p2');
  G.diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
  for (const t of G.teams) for (const p of t.players) {
    if (vsHuman(t)) { p.speed *= G.diff.cpuSpeed; p.st.keeping = clamp(p.st.keeping + (p.role === 'GK' ? G.diff.cpuKeeper : 0), 10, 99); }
    if (t.human && p.role === 'GK') p.st.keeping = clamp(p.st.keeping + G.diff.humanKeeper, 10, 99);
  }
  setupKickoff(A);
  return G;
}

function addHuman(team, src) {
  const h = { team, src, player: null, prevFire: false, charging: false, fireT: 0,
    inp: { dx: 0, dy: 0, fire: false, pressed: false, released: false } };
  team.human = h; G.humans.push(h);
}

// ---------- geometry helpers ----------
const ownGoalY = t => (t.dir === -1 ? L : 0);
const oppGoalY = t => (t.dir === -1 ? 0 : L);
function toWorld(t, fx, fy) { return t.dir === -1 ? { x: fx * W, y: L - fy * L } : { x: (1 - fx) * W, y: fy * L }; }
function toLocal(t, x, y) { return t.dir === -1 ? { fx: x / W, fy: 1 - y / L } : { fx: 1 - x / W, fy: y / L }; }
function inOwnBox(t, x, y) {
  return Math.abs(x - W / 2) < BOX_W / 2 && (t.dir === -1 ? y > L - BOX_D && y < L + 6 : y < BOX_D && y > -6);
}
function possTeam() { const b = G.ball; return b.owner ? b.owner.team : b.lastTouch ? b.lastTouch.team : null; }
function nearestTo(list, pt) { let best = null, bd = 1e9; for (const p of list) { const d = dist(p, pt); if (d < bd) { bd = d; best = p; } } return best; }
function predictBall(t) {
  const b = G.ball; const k = b.z > 0.5 ? AIR_FRICTION : GROUND_FRICTION;
  const f = (1 - Math.exp(-k * t)) / k;
  return { x: b.x + b.vx * f, y: b.y + b.vy * f };
}
function minute() {
  const m = Math.floor(((G.half - 1) * G.halfLen + G.time) / G.halfLen * 45);
  return Math.min(G.half * 45, m);
}

function homePos(p) {
  const t = p.team, b = G.ball;
  if (p.role === 'GK') return toWorld(t, 0.5, 0.03);
  let bx = b.x, by = b.y;
  if (G.state === 'goal' || G.state === 'halftime' || G.state === 'fulltime') { bx = W / 2; by = L / 2; }
  if (G.state === 'out' && G.pending) { bx = G.pending[2]; by = G.pending[3]; }
  const [hx, hy] = t.form[p.idx];
  const bl = toLocal(t, bx, by);
  const att = possTeam() === t, s = sty(t);
  let fy = 0.452 + (hy - 0.42) * 0.9 + (bl.fy - 0.5) * 0.3 + (att ? 0.08 + s.depth : -0.04 + s.line);
  let fx = hx + (bl.fx - 0.5) * 0.35 + Math.sin(G.clock * 0.7 + p.idx * 1.9) * 0.015;
  if (!att && p.role === 'DF') fy = Math.min(fy, bl.fy - 0.03);
  if (!att && highFw(p)) fy = Math.max(fy, 0.5);
  return toWorld(t, clamp(fx, 0.04, 0.96), clamp(fy, 0.05, 0.93));
}

// ---------- team shape: moving into space, triangles, compact blocks ----------
// In possession: the two or three team-mates nearest the ball take up triangle points around the carrier
// (forward-left, forward-right, and a safe ball behind), each hunting the spot near it with the most
// room and a clear passing lane. Everyone else holds a stretched shape (width and depth) and drifts into
// pockets of space; forwards play on the shoulder of the last defender and now and then run in behind.
// Out of possession: the team squeezes into a compact block between the ball and its goal, shifted to
// the ball side, and picks up the opponents in its zones goal-side.
// How well the CPU does this against a human is G.diff.shape / G.diff.support (easy mode is sloppy).
const SHAPE_EVAL = 0.4;
const lerpPt = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
function roomAt(t, x, y, cap) { let m = cap; for (const o of t.opp.players) m = Math.min(m, Math.hypot(o.x - x, o.y - y)); return m; }
function laneAt(t, ax, ay, bx, by, cap) { let m = cap; for (const o of t.opp.players) m = Math.min(m, segDist(o.x, o.y, ax, ay, bx, by)); return m; }
const TUNE = { support: 1, shape: 1, lead: 0.12, runLead: 0.2 };   // test hook for the headless benchmark (Sim.TUNE)
const shapeSkill = (t, k) => (vsHuman(t) ? G.diff[k] : 1) * TUNE[k];
// furthest-back outfield opponent, in this team's attacking direction
function lastLine(t) { let y = null; for (const o of t.opp.players) if (o.role !== 'GK') { const v = o.y * t.dir; if (y === null || v > y) y = v; } return y * t.dir; }

// the triangle points around the carrier, and who takes them (re-picked twice a second, so it's stable)
function assignSupport(t, c) {
  if (G.clock < (t._supT || 0) && t._supC === c) return;
  t._supT = G.clock + 0.5; t._supC = c;
  for (const q of t.players) q._slot = null;
  const inside = c.x < W / 2 ? 1 : -1;
  const r = sty(t).supR;
  const slots = [{ ang: -56, r }, { ang: 56, r }, { ang: 180 - 40 * inside, r: r * 0.8 }].map(sl => Object.assign(sl, slotPt(t, c, sl)));
  const free = t.players.filter(q => q !== c && q.role !== 'GK' && q.state === 'ok');
  for (const sl of slots) {
    let best = null, bd = 1e9;
    for (const q of free) { const d = Math.hypot(q.x - sl.x, q.y - sl.y) + (q.role === 'DF' && (sl.y - c.y) * t.dir > 0 ? 25 : 0); if (d < bd) { bd = d; best = q; } }
    if (best && bd < 140) { best._slot = sl; free.splice(free.indexOf(best), 1); }
  }
}
// a triangle point relative to the carrier, leading his run (so the triangle moves with him)
function slotPt(t, c, sl) {
  const a = sl.ang * Math.PI / 180, cx = c.x + c.vx * 0.4, cy = c.y + c.vy * 0.4;
  return { x: clamp(cx + Math.sin(a) * sl.r, 12, W - 12), y: clamp(cy + Math.cos(a) * sl.r * t.dir, 12, L - 12) };
}
// best spot near `ideal` for receiving: room from opponents, a clear lane from the ball, not crowding team-mates
function findSpace(p, ideal, from, radius, laneW) {
  const t = p.team, sp = sty(t).spacing * 1.3;
  let best = ideal, bs = -1e9;
  const cands = [];
  for (let r = 0; r <= radius; r += radius / 2) for (let k = 0; k < (r ? 8 : 1); k++) {
    const a = k * Math.PI / 4 + (p.idx * 0.7);
    cands.push([ideal.x + Math.cos(a) * r, ideal.y + Math.sin(a) * r, 0]);
  }
  if (p._spot && Math.hypot(p._spot.x - ideal.x, p._spot.y - ideal.y) < radius + 8) cands.push([p._spot.x, p._spot.y, 7]);   // stay put unless clearly better
  for (const [cx, cy, bonus] of cands) {
    const x = clamp(cx, 8, W - 8), y = clamp(cy, 8, L - 8);
    let sc = bonus + roomAt(t, x, y, 40) - Math.hypot(x - ideal.x, y - ideal.y) * 0.35;
    if (from && laneW) sc += laneAt(t, from.x, from.y, x, y, 16) * laneW;
    for (const m of t.players) if (m !== p && m.role !== 'GK') {   // keep apart: from team-mates, and from where they're heading
      const d = Math.hypot(m.x - x, m.y - y); if (d < sp) sc -= (sp - d) * 1.3;
      if (m._spot) { const e = Math.hypot(m._spot.x - x, m._spot.y - y); if (e < sp * 0.9) sc -= (sp * 0.9 - e) * 1.0; }
    }
    if (sc > bs) { bs = sc; best = { x, y }; }
  }
  return best;
}
function attackSpot(p) {
  const t = p.team, b = G.ball, c = b.owner || b.target || null;
  const sk = shapeSkill(t, 'support');
  const home = homePos(p);
  // stretch the pitch: hold the width (wide men near the touchline) and the depth, barely drifting to the ball
  const [hx, hy] = t.form[p.idx], bl = toLocal(t, b.x, b.y), s = sty(t), ctr = countering(t);
  // relational play leaves one man wide on the far side for the switch
  const far = s.farOutlet && p.role === 'FW' && (hx - 0.5) * (bl.fx - 0.5) < 0 && Math.abs(hx - 0.5) > 0.2;
  const wid = far ? Math.max(s.width, 1.6) : s.width, pull = far ? 0 : s.ballPull;
  let fy = 0.5045 + (hy - 0.42) * 1.08 + (bl.fy - 0.5) * 0.27 + s.depth + (p.role === 'DF' ? s.overlap : 0) + (ctr && p.role !== 'DF' ? 0.08 : 0);
  const bw = toWorld(t, clamp(0.5 + (hx - 0.5) * wid + (bl.fx - 0.5) * pull, 0.05, 0.95), clamp(fy, 0.06, 0.9));
  let base = { x: bw.x, y: bw.y };
  if (s.gather && !far && p.role !== 'DF') base = lerpPt(base, b, s.gather);
  if (p.role === 'DF' && s.restD) {   // rest defence: tuck in goal-side of anyone they've left up front
    let o = null, od = 90;
    for (const q of t.opp.players) if (q.role !== 'GK' && (q.y - base.y) * t.dir < 30) { const d = Math.hypot(q.x - base.x, q.y - base.y); if (d < od) { od = d; o = q; } }
    if (o) base = lerpPt(base, { x: o.x + (W / 2 - o.x) * 0.1, y: o.y - t.dir * (10 + 22 * s.restD) }, Math.min(1, s.restD));
  }
  if (p.role === 'FW') {   // on the shoulder of the last defender, now and then running in behind (always, on the counter)
    const line = lastLine(t), run = (ctr || ((G.clock * 0.3 + p.idx * 0.53) % 1) < 0.4) && c && (c.y - line) * t.dir > -170;
    const lim = line + t.dir * (run ? 22 : -4);   // hold onside, then go
    if ((base.y - lim) * t.dir > 0) base.y = lim;
    if (run) base.y = lim;
    p._run = run;
  } else p._run = false;
  let spot;
  if (p._slot && c && c !== p) spot = findSpace(p, slotPt(t, c, p._slot), c, 18, 1.5);
  else spot = findSpace(p, base, c, 14, 0.5);
  return lerpPt(home, spot, sk);
}
// zonal marking assignments for the defending team (re-picked twice a second)
function assignMarks(t) {
  if (sty(t).manMark) return assignMen(t);
  if (G.clock < (t._markT || 0)) return;
  t._markT = G.clock + 0.5;
  const b = G.ball, carrier = b.owner;
  const opps = t.opp.players.filter(o => o.role !== 'GK' && o !== carrier);
  const mine = t.players.filter(q => q.role !== 'GK' && !highFw(q));
  for (const q of mine) q._mark = null;
  const pairs = [];
  for (const q of mine) { const z = defendZone(q); for (const o of opps) { const d = Math.hypot(o.x - z.x, o.y - z.y); if (d < 50) pairs.push([d, q, o]); } }
  pairs.sort((a, c) => a[0] - c[0]);
  const taken = new Set();
  for (const [, q, o] of pairs) if (!q._mark && !taken.has(o)) { q._mark = o; taken.add(o); }
}
// man-to-man: when the ball is lost everyone picks up the nearest free opponent, and sticks with him
// for the whole spell out of possession (so beating your man leaves nobody covering)
function assignMen(t) {
  const mine = t.players.filter(q => q.role !== 'GK' && q.role && !q._mark);
  if (!mine.length) return;
  const taken = new Set(t.players.map(q => q._mark).filter(Boolean));
  const opps = t.opp.players.filter(o => o.role !== 'GK' && !taken.has(o));
  const pairs = [];
  for (const q of mine) for (const o of opps) pairs.push([dist(q, o) + ((o.y - q.y) * t.dir > 0 ? 15 : 0), q, o]);
  pairs.sort((a, c) => a[0] - c[0]);
  for (const [, q, o] of pairs) if (!q._mark && !taken.has(o)) { q._mark = o; taken.add(o); }
}
// the compact block: between the ball and our goal, squeezed toward the ball side
function defendZone(p) {
  const t = p.team, b = G.ball, [hx, hy] = t.form[p.idx], bl = toLocal(t, b.x, b.y), s = sty(t);
  const mid = clamp(0.38 + (bl.fy - 0.5) * 0.7 + s.line, 0.14 + Math.min(0, s.line) * 0.3, 0.6 + s.line * 2.5);
  let fy = mid + (hy - 0.42) * s.block * 1.5;
  if (p.role === 'DF') fy = Math.min(fy, bl.fy - 0.04);
  let fx = 0.5 + (hx - 0.5) * s.compact + (bl.fx - 0.5) * s.shift;
  if (highFw(p)) { fy = Math.max(fy, 0.52); fx = 0.5 + (hx - 0.5) * 0.7; }   // the out-ball: kept up, saving his legs
  return toWorld(t, clamp(fx, 0.06, 0.94), clamp(fy, 0.05, 0.9));
}
function defendSpot(p) {
  const t = p.team, b = G.ball, sk = shapeSkill(t, 'shape');
  p._run = false;
  let spot = defendZone(p);
  const o = p._mark;
  if (o) {   // goal-side of the man, a touch toward the ball to cut the lane
    const gy = ownGoalY(t), [gx1, gy1] = norm(W / 2 - o.x, gy - o.y), [bx1, by1] = norm(b.x - o.x, b.y - o.y);
    const tight = sty(t).manMark ? 7 : 12;
    const m = { x: o.x + gx1 * tight + bx1 * 4, y: o.y + gy1 * tight + by1 * 4 };
    spot = lerpPt(spot, m, sty(t).manMark ? 0.92 : 0.45);
  }
  return lerpPt(homePos(p), spot, sk);
}
// where an off-the-ball player wants to be, re-thought a few times a second (slower on easy)
function shapeSpot(p) {
  const t = p.team, att = possTeam() === t && G.ball.owner !== null ? true : possTeam() === t;
  const sk = shapeSkill(t, att ? 'support' : 'shape');
  if (!p._spot || G.clock >= p._spotT || p._spotAtt !== att) {
    p._spot = att ? attackSpot(p) : defendSpot(p);
    p._spotAtt = att;
    p._spotT = G.clock + SHAPE_EVAL * (sk < 0.5 ? 1.5 : 1) + (p.idx % 4) * 0.05;
  }
  return p._spot;
}

// ---------- kicking ----------
function kick(p, ux, uy, spd, vz, spin) {
  const b = G.ball, spT = G.state === 'setpiece' ? G.sp.type : null;
  // offside is judged the moment a team-mate plays it (not from throw-ins, corners, goal kicks or kick-offs)
  if (G.state === 'play' || spT === 'freekick') offsideSnapshot(p); else G.offside = null;
  if (spT === 'penalty' && G.pen) G.pen.kicked = G.clock;
  if (spT === 'freekick' && G.sp.wallSpots && vz > 60) for (const q of G.sp.wallSpots.keys()) q.jump = 0.35;   // the wall jumps
  b.owner = null; b.vx = ux * spd; b.vy = uy * spd; b.vz = vz; b.z = Math.max(b.z, 0.1);
  b.spin = spin || 0; b.lastTouch = p; b.noTouchP = p; b.noTouchT = 0.25; b.after = null; b.flightT = 0.09; b.target = null; b.passer = null;
  p.fx = ux; p.fy = uy; p.kickAnim = 0.2;
  if (G.state === 'setpiece') { G.state = 'play'; G.sp = null; }
  emit('kick', spd);
}

// Lead the receiver a little (he comes to meet the ball once it's played); a runner gets it in front of him.
function passTo(p, m, lofted) {
  const lead = m._run ? TUNE.runLead : TUNE.lead;
  let tx = m.x + m.vx * lead, ty = m.y + m.vy * lead;
  let dx = tx - p.x, dy = ty - p.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
  [dx, dy] = rot(dx, dy, (1 - p.st.passing / 100) * 0.18 * rand(-1, 1) * (vsHuman(p.team) ? G.diff.cpuPassErr : 1));
  G._passing = true;
  if (lofted || d > 170) { const vh = 130 + d * 0.4; kick(p, dx, dy, vh, GRAV * (d / vh) / 2); }
  else kick(p, dx, dy, passSpeed(d), 0);
  G._passing = false;
  notePass(p, m, lofted || d > 170);
}
function notePass(p, m, long) {
  const t = p.team, b = G.ball;
  b.target = m; b.passer = p; p._passTo = m; p._passT = G.clock;
  ST(t, 'passes'); if (long) ST(t, 'long');
  const prog = (m.y - p.y) * t.dir;
  if (prog > 25) ST(t, 'fwd'); else if (prog < -15) ST(t, 'back');
}

// Firm enough to arrive before defenders close in, still controllable.
const passSpeed = d => clamp(d * 1.5 + 60, 110, 360);

// Earliest point on the ball's path this player can reach in time.
function interceptPoint(p) {
  const b = G.ball;
  let last = b;
  for (let t = 0.05; t <= 2.0; t += 0.05) {
    const q = predictBall(t);
    // a lofted ball can only be met at feet height (once it has come down)
    if (b.z + b.vz * t - GRAV * t * t / 2 > 6) { last = q; continue; }
    if (Math.hypot(q.x - p.x, q.y - p.y) / p.speed <= t + 0.05) return q;
    last = q;
  }
  return last;
}

// Throw-in: released from above the head, a step inside the touchline.
function throwBall(p, ux, uy, spd, vz) {
  const b = G.ball; G.offside = null;
  b.x = clamp(p.x + ux * 6, 1, W - 1); b.y = p.y + uy * 6; b.z = 17;
  b.owner = null; b.vx = ux * spd; b.vy = uy * spd; b.vz = vz;
  b.spin = 0; b.lastTouch = p; b.noTouchP = p; b.noTouchT = 0.3; b.after = null; b.flightT = 0.12; b.target = null;
  p.fx = ux; p.fy = uy; p.kickAnim = 0.22;
  if (G.state === 'setpiece') { G.state = 'play'; G.sp = null; }
  emit('throwin', spd);
}
function throwTo(p, m) {
  const d = dist(p, m); const [ux, uy] = norm(m.x + m.vx * 0.4 - p.x, m.y + m.vy * 0.4 - p.y);
  throwBall(p, ux, uy, clamp(d * 0.95 + 10, 60, 190), 28);
  G.ball.target = m;
}

// forced: the possession clock has run out, so value going forward over keeping it
function bestPass(p, forced) {
  const t = p.team, s = sty(t), ctr = countering(t); let best = null;
  const wProg = s.prog * (ctr ? 1.8 : 1) + (forced ? 0.8 : 0) + (toLocal(t, p.x, p.y).fy > 0.62 ? s.finalProg : 0), wSafe = forced ? 0.4 : s.safe;
  const longB = s.longBias + (ctr ? s.counterLong : 0), line = lastLine(t), gy = oppGoalY(t);
  const offL = secondLast(t), ballD = p.y * t.dir;
  for (const m of t.players) {
    if (m === p || m.role === 'GK' || m.state !== 'ok') continue;
    if (inOffsidePos(m, offL, ballD) && Math.random() < 0.97) continue;   // nearly always spots a team-mate offside
    const d = dist(p, m);
    if (d < 24 || d > s.range + (ctr ? 60 : 0)) continue;
    const prog = (m.y - p.y) * t.dir;
    let open = 60, blocked = false;
    for (const o of t.opp.players) {
      open = Math.min(open, dist(o, m));
      if (!blocked && segDist(o.x, o.y, p.x, p.y, m.x, m.y) < 11) blocked = true;
    }
    const lane = laneAt(t, p.x, p.y, m.x, m.y, 24);
    let score = prog * wProg + (open + lane * 0.6) * wSafe - d * 0.08 - (blocked ? 30 : 0) - 32 + (m._slot ? 6 : 0) + (m._run ? s.through : 0);
    if (prog < 0) score += prog * (s.backPen + (ctr ? 0.5 : 0));
    if (longB && d > 140 && (m.role === 'FW' || m._run)) score += longB;
    if (s.switchBias && Math.abs(m.x - p.x) > W * 0.4) score += s.switchBias;
    if (s.crossBias > 0.3 && Math.abs(m.x - W / 2) > W * 0.28 && Math.abs(gy - m.y) < 135 + s.crossBias * 240) score += s.crossBias * 30;   // find the wide man to cross
    if (m._run && (m.y - line) * t.dir > -4) score += 8;
    if (Math.abs(m.x - W / 2) < 70 && Math.abs(gy - m.y) < 115 && Math.abs(gy - m.y) < Math.abs(gy - p.y) + 30) score += s.boxPass;   // in behind the last man: hard to find, deadly when it lands
    if (!best || score > best.score) best = { mate: m, score, blocked, d };
  }
  return best;
}

function cpuShoot(p) {
  const t = p.team, gy = oppGoalY(t), k = t.opp.players[0], s = sty(t);
  const far = Math.hypot(W / 2 - p.x, gy - p.y) > 110;   // long shots: hit harder and wilder by some styles
  let side = k.x < W / 2 ? 1 : -1; if (Math.random() < 0.25) side = -side;
  const tx = W / 2 + side * (GOAL_W / 2 - rand(3, 8));
  let [ux, uy] = norm(tx - p.x, gy - p.y);
  [ux, uy] = rot(ux, uy, (1 - p.st.shooting / 100) * 0.22 * rand(-1, 1) * (vsHuman(t) ? G.diff.cpuShotErr : 1) * (far ? s.shotErr : 1));
  kick(p, ux, uy, (210 + p.st.shooting * 0.9 + rand(-20, 20)) * (far ? s.shotPow : 1), rand(12, 50), rand(-30, 30));
  noteShot(p);
}
function noteShot(p) {
  const t = p.team;
  ST(t, 'shots'); if (Math.hypot(W / 2 - p.x, oppGoalY(t) - p.y) > 110) ST(t, 'longShots');
  if (countering(t)) { ST(t, 'cShots'); sigEvent(t, 'counter'); }
  emit('shot');
}
// a ball into the box from out wide
function cpuCross(p) {
  const t = p.team, tx = W / 2 + rand(-35, 35), ty = oppGoalY(t) - t.dir * rand(28, 70);
  const d = Math.hypot(tx - p.x, ty - p.y), [ux, uy] = norm(tx - p.x, ty - p.y), vh = 120 + d * 0.35;
  kick(p, ux, uy, vh, GRAV * (d / vh) / 2, rand(-50, 50));
  ST(t, 'crosses');
}
// step-over, flick or nutmeg on the man in the way: he's left standing, or the ball squirts loose
function trySkill(p, o) {
  const t = p.team, s = sty(t), b = G.ball;
  const pc = clamp(0.38 + s.skillWin + (p.st.pace + p.st.passing) / 400 - o.st.tackling / 260, 0.15, 0.85);
  ST(t, 'skills');
  if (Math.random() < pc) {
    o.stun = 0.75; p.boostT = 0.7; p.boost = 1.3;
    const side = Math.sign((o.x - p.x) * p.fy - (o.y - p.y) * p.fx) || 1;
    [p.fx, p.fy] = rot(p.fx, p.fy, -side * 0.7);
    ST(t, 'skillOk'); emit('skill', p);
    sigEvent(t, 'skill');
  } else {
    const [ux, uy] = norm(o.x - p.x, o.y - p.y);
    Object.assign(b, { owner: null, vx: ux * 70 + rand(-30, 30), vy: uy * 70 + rand(-30, 30), vz: rand(5, 25),
      lastTouch: p, noTouchP: p, noTouchT: 0.35, after: null, target: null, passer: null });
    p.stun = 0.45 * s.skillLoss;
  }
  p.think = rand(0.3, 0.5);
}

function aiHeaderDir(p) {
  const t = p.team, gy = oppGoalY(t);
  if (Math.hypot(W / 2 - p.x, gy - p.y) < 140) return norm(W / 2 + rand(-15, 15) - p.x, gy - p.y);
  return norm(rand(-0.5, 0.5), t.dir);
}

// ---------- set pieces ----------
function startSetPiece(type, team, x, y, taker, fx, fy) {
  const b = G.ball;
  G.state = 'setpiece'; G.stateT = 0;
  if (!taker) taker = type === 'goalkick' ? team.players[0] : nearestTo(team.players.filter(p => p.role !== 'GK'), { x, y });
  if (fx === undefined) {
    if (type === 'throw') { fx = x <= 0 ? 1 : -1; fy = 0; }
    else if (type === 'corner') [fx, fy] = norm(W / 2 - x, (oppGoalY(team) - team.dir * SPOT_D) - y);
    else { fx = 0; fy = team.dir; }
  }
  G.sp = { type, team, x, y, t: 0, taker };
  G._ownT = team; team.progT = G.clock; team.progFy = toLocal(team, x, y).fy;
  Object.assign(b, { owner: taker, target: null, x, y, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, after: null, inNet: 0, inCrowd: false, lastTouch: taker, noTouchP: null });
  const tp = takerSpot(G.sp, fx, fy);
  Object.assign(taker, { x: tp.x, y: tp.y, fx, fy, vx: 0, vy: 0, state: 'ok', stun: 0 });
  for (const h of G.humans) h.charging = false;
  emit('setpiece', type);
}

// where the taker stands: just behind the ball, or for a dead-ball kick a step back and to the side (so the ball shows)
function takerSpot(sp, fx, fy) {
  const far = sp.type === 'freekick' || sp.type === 'penalty', back = far ? 9 : 5, side = far ? 3 : 0;
  return { x: sp.x - fx * back - fy * side, y: sp.y - fy * back + fx * side };
}

function setupKickoff(kt) {
  for (const t of G.teams) { t.counterT = 0; t.lostT = -99; t.chain = 0; }
  for (const t of G.teams) for (const p of t.players) {
    p.boostT = 0; p._mark = null;
    const [hx, hy] = t.form[p.idx];
    const fy = p.role === 'GK' ? 0.03 : Math.min(hy * 0.8, t === kt ? 0.46 : 0.40);
    const w = toWorld(t, hx, fy);
    Object.assign(p, { x: w.x, y: w.y, vx: 0, vy: 0, state: 'ok', stun: 0, fx: 0, fy: t.dir, holdT: 0 });
  }
  const fwd = kt.players.filter(q => q.role !== 'GK').sort((a, c) => kt.form[c.idx][1] - kt.form[a.idx][1]);
  const taker = fwd[0], mate = fwd[1] || fwd[0];
  mate.x = W / 2 - 16; mate.y = L / 2 - kt.dir * 4;
  const [fx, fy] = norm(mate.x - W / 2, mate.y - L / 2);
  G.ball.lastTouch = null;
  startSetPiece('kickoff', kt, W / 2, L / 2, taker, fx, fy);
  G.sp.mate = mate;
}

function cpuSetPiece(p) {
  const sp = G.sp, t = p.team;
  if (sp.type === 'penalty') { penaltyRun(p); return; }
  p.vx = p.vy = 0;
  if (cardBusy() || sp.t < (sp.type === 'kickoff' ? 0.9 : sp.type === 'freekick' ? 1.6 : 1.2)) return;
  if (sp.type === 'freekick') {   // the ref lets the wall form before he blows
    if (sp.wallSpots && sp.t < 4 && [...sp.wallSpots].some(([q, w]) => q.team.players.includes(q) && dist(q, w) > 6)) return;
    cpuFreeKick(p); return;
  }
  if (sp.type === 'kickoff') { passTo(p, sp.mate, false); return; }
  if (sp.type === 'corner') {
    const tx = W / 2 + rand(-30, 30), ty = oppGoalY(t) - t.dir * rand(35, 75);
    const d = Math.hypot(tx - p.x, ty - p.y), [ux, uy] = norm(tx - p.x, ty - p.y);
    const vh = 120 + d * 0.35; kick(p, ux, uy, vh, GRAV * (d / vh) / 2, rand(-60, 60)); return;
  }
  if (sp.type === 'throw') {
    const c = bestPass(p);
    if (c && c.d < 150) throwTo(p, c.mate); else throwBall(p, p.fx, p.fy, 140, 40);
    return;
  }
  gkDistribute(p);
}

// Free kicks: shoot over or round the wall from range, whip it into the box from the final third, else play on.
function cpuFreeKick(p) {
  const t = p.team, gy = oppGoalY(t), d = Math.hypot(W / 2 - p.x, gy - p.y);
  if (p.role === 'GK') { gkDistribute(p); return; }
  if (!G.sp.indirect && d < 235 && Math.abs(p.x - W / 2) < d * 0.75) {
    const ps = (d < 165 ? 0.8 : d < 205 ? 0.55 : 0.3) * (sty(t).shootEager > 1.2 ? 1.25 : 1);
    if (Math.random() < ps) { fkShot(p); return; }
  }
  if (toLocal(t, p.x, p.y).fy > 0.62) { cpuCross(p); return; }
  const c = bestPass(p);
  if (c) passTo(p, c.mate, c.blocked || c.d > 140); else kick(p, p.fx, p.fy, 200, 40);
}
// aimed for a corner, flighted to come down under the bar, with a bit of curl
function fkShot(p) {
  const t = p.team, gy = oppGoalY(t), k = t.opp.players[0];
  const side = (k.x < W / 2 ? 1 : -1) * (Math.random() < 0.7 ? 1 : -1);
  const tx = W / 2 + side * (GOAL_W / 2 - rand(3, 9)), tz = rand(5, 17);
  const d = Math.hypot(tx - p.x, gy - p.y), vh = rand(230, 285) * (0.9 + p.st.shooting / 1000), T = d / vh * 1.05;
  let [ux, uy] = norm(tx - p.x, gy - p.y);
  [ux, uy] = rot(ux, uy, (1 - p.st.shooting / 100) * 0.16 * rand(-1, 1) * (vsHuman(t) ? G.diff.cpuShotErr : 1));
  kick(p, ux, uy, vh, (tz + GRAV * T * T / 2) / T, rand(-40, 40));
  noteShot(p);
}
// Penalties: step back, pause, run up and pick a corner (now and then straight down the middle)
function penaltyRun(p) {
  const sp = G.sp, t = p.team, [ux, uy] = norm(W / 2 - sp.x, oppGoalY(t) - sp.y);
  if (cardBusy() || sp.t < 1.0) { if (walkTo(p, sp.x - ux * 16, sp.y - uy * 16, 0.45)) { p.fx = ux; p.fy = uy; } return; }
  if (sp.t < 1.6) { p.vx = p.vy = 0; p.fx = ux; p.fy = uy; return; }
  if (dist(p, G.ball) > 6) { moveTo(p, sp.x - ux * 3, sp.y - uy * 3, 0.7); return; }
  const gy = oppGoalY(t), side = Math.random() < 0.5 ? -1 : 1;
  const tx = Math.random() < 0.1 ? W / 2 + rand(-6, 6) : W / 2 + side * (GOAL_W / 2 - rand(4, 11));
  let [dx, dy] = norm(tx - p.x, gy - p.y);
  [dx, dy] = rot(dx, dy, (1 - p.st.shooting / 100) * 0.12 * rand(-1, 1) * (vsHuman(t) ? G.diff.cpuShotErr : 1));
  kick(p, dx, dy, 250 + p.st.shooting * 0.6, rand(20, 125), 0);
  noteShot(p);
}

function gkDistribute(p) {
  const t = p.team, s = sty(t), longGame = s.longBias > 20 || (countering(t) && s.counterLong);
  const c = bestPass(p);
  const shortP = longGame ? 0.1 : s.safe > 1.2 ? 0.9 : 0.5;   // positional teams play out from the back
  if (c && !c.blocked && c.d < 160 && Math.random() < shortP) { passTo(p, c.mate, false); return; }
  if (longGame) { const fw = t.players.filter(m => m.role === 'FW'); passTo(p, fw[Math.floor(Math.random() * fw.length)], true); return; }
  const mates = p.team.players.filter(m => m.role === 'FW' || m.role === 'MF');
  passTo(p, mates[Math.floor(Math.random() * mates.length)], true);
}

// ---------- player control ----------
function moveTo(p, tx, ty, frac) {
  const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
  if (d < 2.5) { p.vx *= 0.7; p.vy *= 0.7; faceBall(p); return; }
  let s = pace(p) * frac * (p.stun > 0 ? 0.3 : 1);
  if (d < 16) s *= Math.max(0.3, d / 16);
  p.vx = dx / d * s; p.vy = dy / d * s; p.fx = dx / d; p.fy = dy / d;
}
// Walk to a spot and stay there. Unlike moveTo it has hysteresis: once arrived, a player only sets off
// again if pushed well away, so crowds of players standing about don't flicker between walking and
// standing. fx/fy: which way to face on arrival (default: keep facing).
function walkTo(p, tx, ty, frac, fx, fy) {
  const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
  if (d < 1.5 || (p._arr && d < 6)) {
    p._arr = true; p.vx *= 0.6; p.vy *= 0.6; if (Math.hypot(p.vx, p.vy) < 4) p.vx = p.vy = 0;
    if (fx !== undefined) { p.fx = fx; p.fy = fy; }
    return true;
  }
  p._arr = false;
  const s = p.speed * frac * (d < 10 ? Math.max(0.4, d / 10) : 1);
  p.vx = dx / d * s; p.vy = dy / d * s; p.fx = dx / d; p.fy = dy / d;
  return false;
}
// pull a spot back to the edge of team t's penalty area
function outsideBox(t, h) {
  if (!inOwnBox(t, h.x, h.y)) return h;
  const gy = ownGoalY(t), edge = gy === 0 ? BOX_D + 6 : L - BOX_D - 6;
  return { x: h.x, y: edge };
}
function faceBall(p) { const b = G.ball; const [x, y] = norm(b.x - p.x, b.y - p.y); p.fx = x; p.fy = y; }

function startSlide(p) {
  p.state = 'slide'; p.stateT = 0.45; p.slideWon = false; p._slideFoul = false;
  p.vx = p.fx * p.speed * 1.9; p.vy = p.fy * p.speed * 1.9;
  emit('slide');
}

function humanControl(h, p, dt) {
  const b = G.ball, i = h.inp;
  const sp = G.state === 'setpiece' ? G.sp : null;
  const isTaker = sp && sp.taker === p;
  const aftertouching = b.after && b.after.h === h;
  const mag = aftertouching ? 0 : Math.hypot(i.dx, i.dy);
  if (mag <= 0.3 && !b.owner && b.target === p && G.state === 'play') {
    const ip = interceptPoint(p); moveTo(p, ip.x, ip.y, 1);
  } else if (mag > 0.3) {
    let [ux, uy] = norm(i.dx, i.dy);
    if (isTaker && sp.type === 'throw' && ux * (sp.x <= 0 ? 1 : -1) < 0.3) { ux = p.fx; uy = p.fy; }
    p.fx = ux; p.fy = uy;
    if (!isTaker) { const s = pace(p) * (b.owner === p ? 0.92 : 1) * (p.stun > 0 ? 0.3 : 1); p.vx = ux * s; p.vy = uy * s; }
  } else { p.vx *= 0.75; p.vy *= 0.75; }
  if (isTaker) { p.vx = p.vy = 0; const tp = takerSpot(sp, p.fx, p.fy); p.x = tp.x; p.y = tp.y; }

  const hasBall = b.owner === p;
  if (i.pressed) {
    if (hasBall) { h.charging = true; h.fireT = 0; }
    else if (!isTaker) { h.charging = false; tryHeaderOrSlide(p); }
  }
  if (!h.charging) return;
  if (!hasBall) { h.charging = false; return; }
  h.fireT += dt;
  if (!(i.released || h.fireT >= CHARGE_TIME)) return;
  h.charging = false;
  if (isTaker && (sp.t < 0.35 || cardBusy())) return;
  const throwIn = isTaker && sp.type === 'throw';
  const lofted = isTaker && sp.type === 'corner';
  if (h.fireT < TAP_TIME) humanPass(p, throwIn);
  else {
    const pw = clamp((h.fireT - TAP_TIME) / (CHARGE_TIME - TAP_TIME), 0, 1);
    if (throwIn) throwBall(p, p.fx, p.fy, 150 + pw * 70, 40 + pw * 40);   // long throw
    else if (lofted) kick(p, p.fx, p.fy, 150 + pw * 80, 90 + pw * 70);
    else { kick(p, p.fx, p.fy, 230 + pw * 130, 18 + pw * 50); noteShot(p); }
  }
  if (b.owner === null && b.lastTouch === p) b.after = { h, p, t: AFTERTOUCH_TIME, kx: p.fx, ky: p.fy };
}

function humanPass(p, throwIn) {
  let best = null, bs = -1e9;
  for (const m of p.team.players) {
    if (m === p) continue;
    const dx = m.x - p.x, dy = m.y - p.y, d = Math.hypot(dx, dy);
    if (d < 14 || d > 260) continue;
    const dot = (dx * p.fx + dy * p.fy) / d;
    if (dot < G.diff.passCone) continue;
    const s = dot * 120 - d * 0.25;
    if (s > bs) { bs = s; best = m; }
  }
  if (throwIn) { if (best) throwTo(p, best); else throwBall(p, p.fx, p.fy, 140, 40); return; }
  if (best) {
    const tx = best.x + best.vx * 0.4, ty = best.y + best.vy * 0.4;
    const d = Math.hypot(tx - p.x, ty - p.y), [ux, uy] = norm(tx - p.x, ty - p.y);
    kick(p, ux, uy, passSpeed(d), 0);
    notePass(p, best, false);
  } else kick(p, p.fx, p.fy, 200, 0);
}

function tryHeaderOrSlide(p) {
  const b = G.ball;
  if (!b.owner && b.z > 5 && dist(p, b) < 18) { p.jump = 0.35; return; }
  if (p.stun > 0 || G.state !== 'play') return;
  startSlide(p);
}

function updateControl(h) {
  const b = G.ball, t = h.team;
  if (G.state === 'setpiece' && G.sp.team === t && G.sp.taker.role !== 'GK') { h.player = G.sp.taker; return; }
  if (b.owner && b.owner.team === t) { if (b.owner.role !== 'GK') h.player = b.owner; return; }
  if (h.player && h.player.state === 'slide') return;
  if (!b.owner && b.target && b.target.team === t && b.target.state === 'ok') {
    if (h.player !== b.target) { h.player = b.target; h.charging = false; }
    return;
  }
  let pt = b.owner ? { x: b.x, y: b.y } : predictBall(0.35), cost;
  if (b.owner && G.diff.smartSwitch) {
    const [ux, uy] = norm(W / 2 - b.x, ownGoalY(t) - b.y);
    pt = { x: b.x + ux * 15, y: b.y + uy * 15 };
    cost = p => Math.hypot(p.x - pt.x, p.y - pt.y) + (p.state === 'down' ? 40 : 0) +
      (((p.x - b.x) * ux + (p.y - b.y) * uy) < -5 ? 25 : 0);   // behind the ball = can't defend
  } else cost = p => Math.hypot(p.x - pt.x, p.y - pt.y) + (p.state === 'down' ? 40 : 0);
  let best = null, bd = 1e9;
  for (const p of t.players) { if (p.role === 'GK') continue; const d = cost(p); if (d < bd) { bd = d; best = p; } }
  if (!h.player) { h.player = best; return; }
  if (best !== h.player && bd < cost(h.player) * 0.8 - 2) { h.player = best; h.charging = false; }
}

function computeRoles() {
  const b = G.ball;
  for (const t of G.teams) {
    t.chaser = null; t.press = []; t.helper = null; t.crowd = []; t.engaged = false;
    if (b.owner && b.owner.team === t) continue;
    const s = sty(t), bl = toLocal(t, b.x, b.y).fy, fat = fatigue(t);
    const arr = t.players.filter(p => p.role !== 'GK' && p.state !== 'down').map(p => {
      const pt = b.owner ? b : predictBall(Math.min(dist(p, b) / p.speed, 1.2));
      return { p, d: Math.hypot(pt.x - p.x, pt.y - p.y) };
    }).sort((a, c) => a.d - c.d);
    if (arr[0]) t.chaser = arr[0].p;
    if (!b.owner && b.target && b.target.team === t && b.target.state === 'ok') t.chaser = b.target;
    if (b.owner && s.manMark) {   // the carrier's own marker goes to him
      const mk = t.players.find(q => q._mark === b.owner && q.state === 'ok');
      if (mk && dist(mk, b) < 70) t.chaser = mk;
    }
    // a human already closing the carrier down IS the presser: team-mates don't pile in on the same man
    const hp = t.human && t.human.player;
    if (b.owner && hp && hp.state === 'ok' && hp.role !== 'GK') {
      const hd = dist(hp, b), cd = arr.find(a => a.p !== hp);
      if (hd < 50 || !cd || hd < cd.d * 1.3) t.chaser = hp;
    }
    if (b.owner && t.human && G.diff.teamPress) {
      const hp = arr.find(a => a.p !== t.human.player);
      if (hp && hp.d < 110) t.helper = hp.p;
    }
    // how hard to press: by where the ball is, and in the seconds after losing it
    const cp = G.clock - t.lostT < s.cpressT * fat;
    t.engaged = bl < s.pressZone || cp || !b.owner;
    let n = bl < s.press2Zone ? s.pressers : 0;
    if (cp) n = Math.max(n, s.cpress - 1);
    n = Math.round(n * fat);
    const reach = cp ? 120 : 100;   // the shape is spread out, so the second man comes from a bit further
    for (const a of arr) {
      if (t.press.length >= n) break;
      if (a.p !== t.chaser && a.p !== t.helper && a.d < reach && !(t.human && a.p === t.human.player)) t.press.push(a.p);
    }
    // direct play: crowd where the long ball will land, for the knock-down
    if (s.secondBall && !b.owner && b.target && b.target.team === t && b.z > 3) {
      const tl = (b.vz + Math.sqrt(b.vz * b.vz + 2 * GRAV * b.z)) / GRAV, land = predictBall(tl);
      t.landing = land;
      t.crowd = t.players.filter(q => q !== b.target && q.role !== 'GK' && q.state === 'ok' && dist(q, land) < 140)
        .sort((a, c) => dist(a, land) - dist(c, land)).slice(0, s.secondBall);
    }
  }
  if (G.state === 'play') for (const t of G.teams) {
    const c = b.owner && b.owner.team === t ? b.owner : !b.owner && b.target && b.target.team === t ? b.target : null;
    if (c) assignSupport(t, c); else { t._supC = null; for (const q of t.players) q._slot = null; }
    if (possTeam() !== t) assignMarks(t); else for (const q of t.players) q._mark = null;
  }
}

function ai(p, dt) {
  const b = G.ball, t = p.team, st = G.state;
  if (G.cardShow && G.cardShow.p === p) { walkTo(p, p.x, p.y, 0); faceBall(p); return; }   // stands there to be booked
  if (st === 'goal' && G.stateT < 2.6) {
    // scorer wheels away toward the corner flag, team-mates pile in; the other side trudge back
    const lg = G.lastGoal, sc = lg.scorerP;
    if (t === lg.team && sc) {
      if (p === sc) { moveTo(p, p.x < W / 2 ? 14 : W - 14, lg.end < 0 ? 18 : L - 18, 0.75); return; }
      moveTo(p, sc.x + ((p.idx % 3) - 1) * 9, sc.y + (((p.idx >> 2) % 3) - 1) * 7, 0.9); return;
    }
    const h = homePos(p); walkTo(p, h.x, h.y, 0.25); return;
  }
  if (st === 'goal' || st === 'out') { const h = homePos(p); if (walkTo(p, h.x, h.y, st === 'out' ? 0.55 : 0.45)) faceBall(p); return; }
  if (st === 'foul') { const h = restartSpot(p, G.foul); if (walkTo(p, h.x, h.y, 0.95)) faceBall(p); return; }
  if (st === 'setpiece') {
    const sp = G.sp;
    if (p === sp.taker) { cpuSetPiece(p); return; }
    if (sp.type === 'kickoff') { p.vx = p.vy = 0; faceBall(p); return; }
    if (sp.type === 'freekick' || sp.type === 'penalty') { const h = restartSpot(p, sp); if (walkTo(p, h.x, h.y, 0.95)) faceBall(p); return; }
    let h = homePos(p);
    if (sp.type === 'corner' && t === sp.team && sty(t).boxCrash && (p.role === 'FW' || (p.role === 'DF' && Math.abs(t.form[p.idx][0] - 0.5) < 0.2))) {
      const k = (p.idx * 37) % 5;   // the big men go up and spread across the six-yard box
      h = { x: W / 2 + (k - 2) * 16, y: oppGoalY(t) - t.dir * (24 + (p.idx % 3) * 12) };
    }
    if (t !== sp.team) { const dx = h.x - b.x, dy = h.y - b.y, d = Math.hypot(dx, dy) || 1; if (d < 50) h = { x: b.x + dx / d * 50, y: b.y + dy / d * 50 }; }
    if (t !== sp.team && sp.type === 'goalkick') h = outsideBox(sp.team, h);
    if (walkTo(p, h.x, h.y, 0.8)) faceBall(p); return;
  }
  // the opposing keeper has it in his hands: drop off, give him room, and wait outside his box
  if (b.owner && b.owner.role === 'GK' && b.owner.team !== t) {
    let h = homePos(p);
    const dx = h.x - b.x, dy = h.y - b.y, d = Math.hypot(dx, dy) || 1;
    if (d < 45) h = { x: b.x + dx / d * 45, y: b.y + dy / d * 45 };
    h = outsideBox(b.owner.team, h);
    if (walkTo(p, h.x, h.y, 0.7)) faceBall(p); return;
  }
  if (b.owner === p) { cpuCarry(p, dt); return; }
  const s = sty(t);
  if (t.chaser === p) {
    if (b.owner) {
      const o = b.owner; const [ux, uy] = norm(W / 2 - o.x, ownGoalY(t) - o.y);
      if (!t.engaged) {   // not in our pressing zone: jockey goal-side and show him wide, no lunging
        moveTo(p, o.x + o.vx * 0.3 + ux * 26, o.y + o.vy * 0.3 + uy * 26, s.contain); return;
      }
      moveTo(p, o.x + o.vx * 0.2 + ux * 3, o.y + o.vy * 0.2 + uy * 3, (vsHuman(t) ? G.diff.cpuPress : 1) * s.pressSpeed * fatigue(t));
      const d = dist(p, b);
      if (o.role !== 'GK' && d > 6 && d < 13 && (p.fx * (b.x - p.x) + p.fy * (b.y - p.y)) / d > 0.85 &&
          Math.random() < dt * 0.8 * p.st.tackling / 100 * s.tackle * (vsHuman(t) ? G.diff.cpuSlide : 1) * (inOwnBox(t, p.x, p.y) ? 0.35 : 1)) startSlide(p);
    } else if (b.target === p) { const ip = interceptPoint(p); moveTo(p, ip.x, ip.y, 1); }
    else { const pt = predictBall(Math.min(dist(p, b) / p.speed, 1.2)); moveTo(p, pt.x, pt.y, 1); }
    return;
  }
  if (t.helper === p && b.owner) {
    const o = b.owner; const [ux, uy] = norm(W / 2 - o.x, ownGoalY(t) - o.y);
    moveTo(p, o.x + o.vx * 0.2 + ux * 4, o.y + o.vy * 0.2 + uy * 4, 0.95); return;
  }
  const pi = t.press.indexOf(p);
  if (pi === 0) {   // second man: double up when swarming, otherwise cover goal-side
    const [ux, uy] = norm(W / 2 - b.x, ownGoalY(t) - b.y), r = t.press.length > 1 ? 12 : 28;
    moveTo(p, b.x + ux * r, b.y + uy * r, 0.9 * s.pressSpeed * fatigue(t)); return;
  }
  if (pi > 0 && b.owner) {   // the rest cut off the carrier's nearest outlets
    const outs = b.owner.team.players.filter(o => o !== b.owner && o.role !== 'GK').sort((a, c) => dist(a, b) - dist(c, b));
    const o = outs[(pi - 1) % Math.max(1, outs.length)];
    if (o) { moveTo(p, b.x + (o.x - b.x) * 0.55, b.y + (o.y - b.y) * 0.55, 0.95 * s.pressSpeed * fatigue(t)); return; }
  }
  if (t.crowd.includes(p) && t.landing) {
    const k = t.crowd.indexOf(p), a = k * 2.4 + 0.8;
    moveTo(p, t.landing.x + Math.cos(a) * 18, t.landing.y + Math.sin(a) * 18, 1); return;
  }
  if (st === 'play') {
    const s = shapeSpot(p), d = dist(p, s);
    moveTo(p, s.x, s.y, p._run ? 0.95 : d > 40 ? 0.9 : d > 15 ? 0.7 : 0.5);
    if (d < 4) faceBall(p);
    return;
  }
  const h = homePos(p); moveTo(p, h.x, h.y, dist(p, h) > 40 ? 0.9 : 0.6);
}

function cpuCarry(p, dt) {
  const t = p.team, s = sty(t), ctr = countering(t), gx = W / 2, gy = oppGoalY(t);
  const dG = Math.hypot(gx - p.x, gy - p.y);
  let nearOpp = 1e9; for (const o of t.opp.players) nearOpp = Math.min(nearOpp, dist(o, p));
  // someone stood in the way ahead counts as pressure: look for the pass rather than run into him
  const [gux, guy] = norm(gx - p.x, gy - p.y);
  let blocker = null, bd = 1e9;
  for (const o of t.opp.players) {
    const rx = o.x - p.x, ry = o.y - p.y, d = Math.hypot(rx, ry);
    if (d < 22 && (rx * gux + ry * guy) / (d || 1) > 0.8) { if (dG > 150) nearOpp = Math.min(nearOpp, 20); if (d < bd && o.state === 'ok' && o.stun <= 0 && o.role !== 'GK') { bd = d; blocker = o; } }
  }
  p.think -= dt;
  if (p.think <= 0) {
    // tempo: how soon the ball is released. Patience shows in the choice of pass, never in standing still.
    const tf = s.tempo * (ctr ? 1.3 : 1);
    p.think = rand(0.25, 0.4) / Math.sqrt(tf);
    const roll = q => Math.random() < 1 - Math.pow(1 - Math.min(0.95, q), 1 / Math.sqrt(tf));   // same odds per second whatever the tempo
    // crosses (before the speculative shot from out wide): cross-happy styles whip it in early, from deeper and less wide
    if (dG > 100 && Math.abs(p.x - gx) > W * (0.3 - s.crossBias * 0.12) && Math.abs(gy - p.y) < 135 + s.crossBias * 240 && roll(s.crossBias)) { cpuCross(p); return; }
    const shootD = s.shootDist + (ctr ? 20 : 0);
    if (dG < shootD && Math.abs(p.x - gx) < dG * 0.9 + 10) {
      const ps = (dG < 80 ? 0.78 : dG < 115 ? 0.48 : dG < 150 ? 0.16 : 0.07) * (dG < 80 ? 1 : s.shootEager);
      if (roll(ps)) { cpuShoot(p); return; }
    }
    // possession clock: too long without going forward, so force something risky
    if (G.clock - t.progT > s.possClock) {
      t.progT = G.clock - s.possClock + 2.5; ST(t, 'forced');
      if (dG < 200) { cpuShoot(p); return; }
      const c = bestPass(p, true);
      if (c) { passTo(p, c.mate, c.blocked || c.d > 140); return; }
    }
    if (blocker && bd < 17 && roll(s.skill)) { trySkill(p, blocker); return; }
    const pressed = nearOpp < 22;
    if (pressed || Math.random() < 0.1 * tf) {   // move it on when pressed, or when a really good option is on
      if (!(pressed && nearOpp > 9 && Math.random() < s.dribble)) {   // ...unless he fancies taking his man on
        const c = bestPass(p);
        if (c && (c.score > (nearOpp < 18 ? 0 : 20) || (nearOpp < 14 && c.score > -40))) { passTo(p, c.mate, c.blocked); return; }
      }
    }
  }
  const [ux, uy] = norm(gx - p.x, gy - p.y);
  let dx = ux, dy = uy;
  for (const o of t.opp.players) {
    const rx = o.x - p.x, ry = o.y - p.y, d = Math.hypot(rx, ry);
    if (d > 45 || d < 0.1) continue;
    const ahead = (rx * ux + ry * uy) / d; if (ahead < 0.1) continue;
    const side = Math.sign(rx * -uy + ry * ux) || 1, w = (45 - d) / 45 * 1.5 * ahead;
    dx -= side * -uy * w; dy -= side * ux * w;
  }
  if (p.x < 30) dx += (30 - p.x) / 30;
  if (p.x > W - 30) dx -= (p.x - (W - 30)) / 30;
  [dx, dy] = norm(dx, dy);
  const v = pace(p) * 0.9 * (p.stun > 0 ? 0.3 : 1);
  p.vx = dx * v; p.vy = dy * v; p.fx = dx; p.fy = dy;
}

// ---------- goalkeeper ----------
function gkAI(p, dt) {
  const b = G.ball, t = p.team, st = G.state, gx = W / 2, gy = ownGoalY(t);
  const pen = G.pen;
  if (pen && pen.gk === p) {
    if (st === 'setpiece') { moveTo(p, gx + Math.sin(G.clock * 3) * 4, gy + t.dir * 2, 0.4); faceBall(p); return; }   // on his line, bouncing
    if (st === 'play' && pen.kicked && !pen.dived) {   // he has to guess: the better the keeper, the more often he's right
      pen.dived = true;
      const tl = Math.abs((p.y - b.y) / (b.vy || 1)), side = Math.sign(b.x + b.vx * tl - gx) || 1;
      const dir = Math.random() < 0.3 + p.st.keeping / 400 ? side : Math.random() < 0.8 ? -side : 0;
      if (dir) { Object.assign(p, { state: 'dive', stateT: 0.55, vx: dir * (130 + p.st.keeping * 0.4), vy: 0, fx: dir, fy: 0 }); emit('dive'); }
      return;
    }
  }
  if (st !== 'play' && st !== 'setpiece') { if (walkTo(p, gx, gy + t.dir * 6, 0.5)) faceBall(p); return; }
  if (st === 'setpiece' && G.sp.taker === p) { cpuSetPiece(p); return; }
  if (b.owner === p) {
    p.vx *= 0.7; p.vy *= 0.7; p.fx = 0; p.fy = t.dir; p.holdT += dt;
    if (p.holdT > (countering(t) ? 0.5 : 1.2)) gkDistribute(p);
    return;
  }
  if (st === 'play') { gkCatch(p); if (b.owner === p) return; }

  if (!b.owner && st === 'play' && b.vy * -t.dir > 60) {
    const tl = (p.y - b.y) / b.vy;
    if (tl > 0 && tl < 1.0) {
      const px = b.x + b.vx * tl;
      if (Math.abs(px - gx) < GOAL_W / 2 + 14) {
        if (!p.threat) { p.threat = true; p.reactT = rand(0.04, 0.16) * (1.4 - p.st.keeping / 100); }
        p.reactT -= dt;
        if (p.reactT > 0) { p.vx *= 0.8; p.vy *= 0.8; return; }
        const dx = px - p.x;
        if (Math.abs(dx) > 7 && tl < 0.38) {
          const sp = clamp(Math.abs(dx) / Math.max(tl, 0.12), 60, 150 + p.st.keeping * 0.4);
          Object.assign(p, { state: 'dive', stateT: 0.5, vx: Math.sign(dx) * sp, vy: 0, fx: Math.sign(dx), fy: 0 });
          emit('dive'); return;
        }
        moveTo(p, px, p.y, 1); return;
      }
    }
  }
  p.threat = false;
  if (!b.owner && inOwnBox(t, b.x, b.y) && b.z < 20) {
    const opp = nearestTo(t.opp.players, b);
    if (dist(p, b) < dist(opp, b) * 0.9 + 4) { const pt = predictBall(0.3); moveTo(p, pt.x, pt.y, 1); return; }
  }
  const vx = b.x - gx, vy = b.y - gy, d = Math.hypot(vx, vy) || 1, so = clamp(d * 0.1, 4, 24);
  const tx = clamp(gx + vx / d * so, gx - GOAL_W / 2 - 4, gx + GOAL_W / 2 + 4);
  let ty = gy + vy / d * so; ty = t.dir === -1 ? Math.min(ty, L - 3) : Math.max(ty, 3);
  moveTo(p, tx, ty, 0.85);
}

function gkCatch(p) {
  const b = G.ball, t = p.team;
  if (b.owner || G.state !== 'play' || p.missCD > 0 || b.noTouchP === p || !inOwnBox(t, p.x, p.y)) return;
  const dv = p.state === 'dive';
  if (b.z > (dv ? 24 : 28) || dist(p, b) > (dv ? 14 : 9)) return;
  const spd = Math.hypot(b.vx, b.vy);
  const pc = clamp(p.st.keeping / 100 * (1.4 - spd / 320), 0.12, 0.97);
  const r = Math.random();
  if (spd < 70 || r < pc) {
    Object.assign(b, { owner: p, lastTouch: p, after: null, vx: 0, vy: 0, vz: 0, z: 0, target: null });
    p.holdT = 0; emit('catch');
    if (G.offside && G.offside.team !== t) G.offside = null;
  } else if (r < pc + (1 - pc) * 0.65) {
    const side = Math.random() < 0.5 ? -1 : 1;
    Object.assign(b, { vx: side * rand(60, 120) + b.vx * 0.15, vy: t.dir * rand(30, 90), vz: rand(20, 70),
      lastTouch: p, noTouchP: p, noTouchT: 0.5, after: null, spin: 0, target: null });
    p.missCD = 0.6; emit('save');
  } else p.missCD = 0.6;
}

// ---------- contacts ----------
function knock(p) {
  const b = G.ball, s = Math.hypot(p.vx, p.vy) * 1.1 + 40;
  Object.assign(b, { vx: p.fx * s + rand(-15, 15), vy: p.fy * s + rand(-15, 15), vz: rand(0, 20),
    lastTouch: p, noTouchP: p, noTouchT: 0.3, after: null, spin: 0, target: null });
}

function slideContact(p) {
  const b = G.ball; if (G.state !== 'play') return;
  const d = dist(p, b);
  if (!p.slideWon && d < slideReach(p) && b.z < 8 && b.noTouchP !== p) {
    if (b.owner && b.owner.team !== p.team && b.owner.role !== 'GK') {
      b.owner.stun = 0.6; b.owner = null; knock(p); p.slideWon = true; emit('tackle'); return;
    }
    if (!b.owner) { if (offsideTouch(p)) return; knock(p); p.slideWon = true; return; }
  }
  if (p.stateT > 0.12) for (const o of p.team.opp.players) {
    if (o.state === 'ok' && dist(p, o) < 6) {
      const hadBall = b.owner === o || (b.lastTouch === o && dist(o, b) < 20);
      o.state = 'down'; o.stateT = 0.9;
      if (b.owner === o) { b.owner = null; b.vx = o.vx * 0.5; b.vy = o.vy * 0.5; }
      emit('foul');
      // took the man before the ball: a foul. From behind, or with the ball long gone, it's worse.
      if (!p.slideWon && !p._slideFoul) {
        p._slideFoul = true;
        const [sx, sy] = norm(p.vx, p.vy);
        foulCommitted(p, o, { slide: true, behind: sx * o.fx + sy * o.fy > 0.5, late: !hadBall, hadBall });
        if (G.state !== 'play') return;
      }
    }
  }
}

function steals(dt) {
  const b = G.ball; b.stealCD -= dt;
  if (!b.owner || b.stealCD > 0 || b.owner.role === 'GK') return;
  const o = b.owner, drib = (o.st.pace + o.st.passing) / 2;
  for (const q of o.team.opp.players) {
    if (q.state !== 'ok' || q.stun > 0 || dist(q, b) > 7) continue;
    const m = (o.team.human ? G.diff.stealVsHuman : 1) * (q.team.human ? G.diff.humanSteal : 1) * sty(q.team).tackle;
    if (Math.random() < dt * 1.5 * (q.st.tackling / 70) * (70 / drib) * m) {
      const [mx, my] = Math.hypot(o.vx, o.vy) > 10 ? norm(o.vx, o.vy) : [o.fx, o.fy];
      if (((o.x - q.x) * mx + (o.y - q.y) * my) / (dist(o, q) || 1) > 0.5 && Math.random() < 0.55 * sty(q.team).tackle) {
        o.state = 'down'; o.stateT = 0.8; b.owner = null; b.vx = o.vx * 0.4; b.vy = o.vy * 0.4; b.stealCD = 0.7;   // through the back of him
        emit('foul'); foulCommitted(q, o, { behind: true, hadBall: true }); break;
      }
      if (G.offside && G.offside.team !== q.team) G.offside = null;
      b.owner = q; b.lastTouch = q; b.stealCD = 0.7; b.target = null; o.stun = 0.4; q.think = rand(0.1, 0.25);
      emit('tackle'); break;
    }
  }
}

function contact() {
  const b = G.ball; if (b.owner || b.flightT > 0) return;
  let best = null, bd = 1e9, mode = null;
  for (const t of G.teams) for (const p of t.players) {
    if (p.state === 'down' || p.state === 'dive' || p === b.noTouchP) continue;
    if (p.role === 'GK' && inOwnBox(t, p.x, p.y)) continue;
    // a CPU player who was offside leaves a ball meant for a team-mate
    if (G.offside && G.offside.set.has(p) && b.target && b.target !== p && !(t.human && t.human.player === p)) continue;
    const d = dist(p, b);
    if (b.z < 8 && d < (p.state === 'slide' ? slideReach(p) : 6)) { if (d < bd) { bd = d; best = p; mode = 'foot'; } }
    else if (b.z >= 7 && b.z < (p.jump > 0 ? 30 : 22) && d < 7 && p.headCD <= 0) { if (d < bd) { bd = d; best = p; mode = 'head'; } }
  }
  if (!best) return;
  if (offsideTouch(best)) return;
  if (mode === 'foot') {
    if (best.state === 'slide') { if (!best.slideWon) { knock(best); best.slideWon = true; } return; }
    const spd = Math.hypot(b.vx, b.vy);
    if (spd > 270 && !(best.team.human && G.diff.cleanTouch) && Math.random() > best.st.passing / 140) {
      [b.vx, b.vy] = rot(b.vx * -0.25, b.vy * -0.25, rand(-1, 1));
      Object.assign(b, { vz: rand(10, 40), lastTouch: best, noTouchP: best, noTouchT: 0.3, after: null, target: null });
      emit('kick', 80); return;
    }
    const from = b.passer;
    if (G.offside && G.offside.team !== best.team) G.offside = null;
    Object.assign(b, { owner: best, lastTouch: best, after: null, stealCD: 0.35, target: null, passer: null });
    best.think = rand(0.2, 0.35);
    if (from && from !== best && from.team === best.team) received(best, from);
  } else {
    const h = best.team.human; let dx, dy;
    if (h && h.player === best) {
      if (Math.hypot(h.inp.dx, h.inp.dy) > 0.3) [dx, dy] = norm(h.inp.dx, h.inp.dy); else { dx = best.fx; dy = best.fy; }
    } else { [dx, dy] = aiHeaderDir(best); [dx, dy] = rot(dx, dy, (sty(best.team).headErr - 1) * 0.3 * rand(-1, 1)); }
    const hs = sty(best.team), atGoal = Math.hypot(W / 2 - best.x, oppGoalY(best.team) - best.y) < 140;
    kick(best, dx, dy, rand(160, 200) * hs.headPow, rand(25, 50));
    best.headCD = 0.6; best.jump = 0.25; emit('header');
    ST(best.team, 'headers');
    if (atGoal && dy * best.team.dir > 0.5) ST(best.team, 'headShots');
    // direct play gets going when it starts winning the headers up the pitch
    if (toLocal(best.team, best.x, best.y).fy > 0.5) sigEvent(best.team, 'header');
  }
}

// a completed pass: build the move, and reward a one-two with a burst of pace
function received(m, from) {
  const t = m.team, s = sty(t);
  ST(t, 'comp'); t.chain++;
  if (m._passTo === from && G.clock - m._passT < 2.5) {
    ST(t, 'oneTwos');
    if (s.oneTwo > 1) { m.boostT = 1.1; m.boost = s.oneTwo; }
  }
  if (t.chain === 8) sigEvent(t, 'chain');
}
// the ball has changed hands: this is where counter-presses and counter-attacks start
function turnover(w, who) {
  const l = w.opp, now = G.clock, b = G.ball, fy = toLocal(w, b.x, b.y).fy, s = sty(w);
  ST(w, 'won'); w._wonT = now;
  if (now - w.lostT < 5) ST(w, 'cpWins');
  l.lostT = now; l.chain = 0; w.chain = 0; l.counterT = 0;
  w.progT = now; w.progFy = fy;
  if (fy > 0.66 && who.role !== 'GK') { ST(w, 'hiTurn'); sigEvent(w, 'press'); }
  if (s.counter && fy < s.counterZone) {
    w.counterT = now + s.counter; ST(w, 'counters');
    if (s.counterBoost > 1) {   // the break: forwards and the nearest runners go flat out
      const runners = w.players.filter(q => q.role === 'FW').concat(
        w.players.filter(q => q.role === 'MF').sort((a, c) => dist(a, b) - dist(c, b)).slice(0, 2));
      for (const q of runners) { q.boostT = s.counter * 0.5; q.boost = s.counterBoost; }
      if (now - w.labelT > 15) { w.labelT = now; emit('label', 'COUNTER!'); }
    }
  }
}

function separate() {
  const all = G.teams[0].players.concat(G.teams[1].players);
  const taker = G.state === 'setpiece' ? G.sp.taker : null;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], c = all[j];
    const dx = c.x - a.x, dy = c.y - a.y, d2 = dx * dx + dy * dy;
    if (d2 >= 20 || d2 < 1e-4) continue;
    const d = Math.sqrt(d2), push = (4.5 - d) / 2, nx = dx / d, ny = dy / d;
    if (a !== taker) { a.x -= nx * push; a.y -= ny * push; }
    if (c !== taker) { c.x += nx * push; c.y += ny * push; }
  }
}

function updatePlayer(p, dt) {
  p.stun = Math.max(0, p.stun - dt); p.headCD -= dt; p.missCD -= dt; p.boostT -= dt;
  p.jump = Math.max(0, p.jump - dt); p.kickAnim = Math.max(0, p.kickAnim - dt);
  if (p.state === 'slide') {
    p.stateT -= dt; const f = Math.exp(-2.2 * dt); p.vx *= f; p.vy *= f; slideContact(p);
    if (p.stateT <= 0) { p.state = 'down'; p.stateT = 0.35; }
  } else if (p.state === 'down') {
    p.vx *= 0.8; p.vy *= 0.8; p.stateT -= dt; if (p.stateT <= 0) p.state = 'ok';
  } else if (p.state === 'dive') {
    p.stateT -= dt; const f = Math.exp(-3 * dt); p.vx *= f; p.vy *= f; gkCatch(p);
    if (p.stateT <= 0) { p.state = 'down'; p.stateT = 0.5; }
  } else {
    const h = p.team.human;
    if (G.state === 'halftime' || G.state === 'fulltime') endAI(p);
    else if (h && h.player === p && (G.state === 'play' || G.state === 'setpiece')) humanControl(h, p, dt);
    else if (p.role === 'GK') gkAI(p, dt);
    else ai(p, dt);
  }
  p.x = clamp(p.x + p.vx * dt, -15, W + 15);
  p.y = clamp(p.y + p.vy * dt, -15, L + 15);
  p.anim += Math.hypot(p.vx, p.vy) * dt;
}

// ---------- ball ----------
function updateBall(dt) {
  const b = G.ball;
  b.noTouchT -= dt; if (b.noTouchT <= 0) b.noTouchP = null;
  b.flightT -= dt;
  if (b.owner) {
    const p = b.owner;
    if (G.state === 'setpiece' && G.sp.taker === p) { b.x = G.sp.x; b.y = G.sp.y; }
    else {
      const ahead = 4.5 + Math.min(Math.hypot(p.vx, p.vy), 90) / 90 * 2.5, k = Math.min(1, dt * 20);
      b.x += (p.x + p.fx * ahead - b.x) * k; b.y += (p.y + p.fy * ahead - b.y) * k;
    }
    b.z = 0; b.vz = 0; b.spin = 0; b.vx = p.vx; b.vy = p.vy; b.lastTouch = p;
    b.roll += Math.hypot(p.vx, p.vy) * dt;
    return;
  }
  // aftertouch: sideways = bend, back = lift, forward = keep it low
  const a = b.after;
  if (a) {
    a.t -= dt;
    if (a.t <= 0 || b.lastTouch !== a.p || G.state !== 'play') b.after = null;
    else {
      const i = a.h.inp, m = Math.hypot(i.dx, i.dy);
      if (m > 0.3) {
        const ix = i.dx / m, iy = i.dy / m;
        const cross = a.kx * iy - a.ky * ix, along = a.kx * ix + a.ky * iy;
        b.spin = clamp(b.spin + cross * 900 * dt, -280, 280);
        if (along < -0.4) { b.vz += 280 * dt * -along; const f = 1 - 0.6 * dt; b.vx *= f; b.vy *= f; }
        else if (along > 0.4 && b.z > 0.5) b.vz -= 320 * dt * along;
      }
    }
  }
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > 5 && b.spin) {
    const ux = b.vx / sp, uy = b.vy / sp;
    b.vx += -uy * b.spin * dt; b.vy += ux * b.spin * dt;
    const ns = Math.hypot(b.vx, b.vy); b.vx *= sp / ns; b.vy *= sp / ns;
  }
  b.spin *= Math.exp(-(b.z > 0.5 ? 0.5 : 6) * dt);
  if (b.z > 0 || b.vz !== 0) {
    b.vz -= GRAV * dt; b.z += b.vz * dt;
    if (b.z <= 0) {
      b.z = 0;
      if (b.vz < -70) { b.vz = -b.vz * 0.45; b.vx *= 0.88; b.vy *= 0.88; emit('bounce'); } else b.vz = 0;
    }
  }
  const f = Math.exp(-(b.z > 0.5 ? AIR_FRICTION : GROUND_FRICTION) * dt);
  b.vx *= f; b.vy *= f;
  if (b.z === 0 && Math.hypot(b.vx, b.vy) < 3) { b.vx = 0; b.vy = 0; }
  if (G.state === 'halftime' || G.state === 'fulltime') { b.vx *= 0.95; b.vy *= 0.95; }
  const py = b.y, px = b.x;
  b.x += b.vx * dt; b.y += b.vy * dt; b.roll += Math.hypot(b.vx, b.vy) * dt;
  goalFrame(b, py);
  if (G.state === 'out') outOfBounds(b, px, py);
}

function goalFrame(b, py) {
  for (const gy of [0, L]) {
    if (b.z < GOAL_H) for (const px of [W / 2 - GOAL_W / 2, W / 2 + GOAL_W / 2]) {
      const dx = b.x - px, dy = b.y - gy, d = Math.hypot(dx, dy);
      if (d < 2.5 && d > 1e-3) {
        const nx = dx / d, ny = dy / d, vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= 1.6 * vn * nx; b.vy -= 1.6 * vn * ny; b.spin = 0; emit('post'); }
        b.x = px + nx * 2.5; b.y = gy + ny * 2.5;
      }
    }
    const crossed = gy === 0 ? py >= 0 && b.y < 0 : py <= L && b.y > L;
    if (crossed && Math.abs(b.x - W / 2) < GOAL_W / 2 && b.z >= GOAL_H - 1 && b.z < GOAL_H + 3) {
      b.vy = -b.vy * 0.5; b.y = gy === 0 ? 0.5 : L - 0.5;
      b.vz = b.z > GOAL_H + 0.5 ? Math.abs(b.vz) * 0.4 + 30 : -Math.abs(b.vz) * 0.3;
      emit('post');
    }
  }
  if (b.inNet) {
    const yl = b.inNet < 0 ? -GOAL_D + 1 : L + 1, yh = b.inNet < 0 ? -1 : L + GOAL_D - 1;
    const xl = W / 2 - GOAL_W / 2 + 1, xh = W / 2 + GOAL_W / 2 - 1;
    if (b.y < yl || b.y > yh) { b.y = clamp(b.y, yl, yh); b.vy *= -0.2; b.vx *= 0.5; }
    if (b.x < xl || b.x > xh) { b.x = clamp(b.x, xl, xh); b.vx *= -0.2; }
    if (b.z > GOAL_H - 1) { b.z = GOAL_H - 1; b.vz = Math.min(b.vz, 0); }
  }
}

// ---------- rules ----------
function checkRules() {
  const b = G.ball;
  if (G.state !== 'play') return;
  if ((b.y < 0 || b.y > L || b.x < 0 || b.x > W) && G.adv) {   // out of play while the ref waits on an advantage
    const a = G.adv;
    if (!a.on) { callStop('freekick', a.team, a.x, a.y, a.off, a.vic); return; }
    G.adv = null;
  }
  if (b.y < 0 || b.y > L) {
    const top = b.y < 0;
    const att = G.teams.find(t => oppGoalY(t) === (top ? 0 : L)), def = att.opp;
    if (Math.abs(b.x - W / 2) < GOAL_W / 2 && b.z < GOAL_H) { scoreGoal(att, top); return; }
    const lt = b.lastTouch ? b.lastTouch.team : att;
    if (lt === def) ballOut('corner', att, b.x < W / 2 ? 2 : W - 2, top ? 2 : L - 2);
    else ballOut('goalkick', def, W / 2 + (b.x < W / 2 ? -30 : 30), top ? SIX_D - 6 : L - SIX_D + 6);
    return;
  }
  if (b.x < 0 || b.x > W) {
    const lt = b.lastTouch ? b.lastTouch.team : G.teams[0];
    startSetPiece('throw', lt.opp, b.x < 0 ? 0 : W, clamp(b.y, 4, L - 4));
  }
}

// The ball stays live (for the eye) until it has hit the boards or landed in the crowd.
function ballOut(type, team, x, y) {
  const b = G.ball;
  G.state = 'out'; G.stateT = 0; G.pending = [type, team, x, y];
  b.owner = null; b.after = null; b.target = null; b.inCrowd = false;
  for (const h of G.humans) h.charging = false;
  emit('out', type);
}
// Advertising boards stand 10 high just behind the lines; over them is the front wall, then the crowd.
const BOARD_H = 10;
function outOfBounds(b, px, py) {
  const hit = (pos, prev, line, dir) => (dir < 0 ? pos < line && prev >= line : pos > line && prev <= line);
  if (b.inCrowd) { b.vx *= 0.8; b.vy *= 0.8; b.vz = 0; b.z = 15; return; }
  // the boards: low balls bounce back off them
  if (b.z < BOARD_H) {
    for (const [line, axis, dir] of [[-27, 'y', -1], [L + 37, 'y', 1], [-23, 'x', -1], [W + 23, 'x', 1]]) {
      const pos = b[axis], prev = axis === 'y' ? py : px;
      if (hit(pos, prev, line, dir)) {
        b[axis] = line - dir * 0.5;
        if (axis === 'y') { b.vy = -b.vy * 0.45; b.vx *= 0.8; } else { b.vx = -b.vx * 0.45; b.vy *= 0.8; }
        emit('board', Math.hypot(b.vx, b.vy));
      }
    }
  }
  // the crowd catches anything that drops among them
  const inStand = b.y < -46 || b.y > L + 46 || b.x < -31 || b.x > W + 31;
  const atBack = b.y < -102 || b.y > L + 102 || b.x < -102 || b.x > W + 102;   // the back of the stand stops anything
  if (atBack) { b.x = clamp(b.x, -102, W + 102); b.y = clamp(b.y, -102, L + 102); }
  if (inStand && ((b.z < 16 && b.vz < 0) || atBack)) { b.inCrowd = true; b.z = 15; emit('crowdball'); }
}

function scoreGoal(team, top) {
  const b = G.ball, sc = b.lastTouch;
  if (G.pen && G.pen.kicked && G.pen.taker.team === team) ST(team, 'penGoals');
  G.adv = null; G.offside = null;
  team.score++; ST(team, 'goals'); if (countering(team)) ST(team, 'cGoals');
  { const age = G.clock - (team._wonT || 0); ST(team, age < 4 ? 'gA4' : age < 10 ? 'gA10' : 'gA99'); ST(team, sc && sc.team === team && b.z > 6 ? 'gHead' : 'gFoot'); ST(team, 'gDist', sc ? Math.hypot(W / 2 - sc.x, oppGoalY(team) - sc.y) : 0); }
  G.state = 'goal'; G.stateT = 0;
  b.owner = null; b.inNet = top ? -1 : 1; b.after = null;
  G.lastGoal = { team, scorer: sc ? sc.name : '', og: !!(sc && sc.team !== team), minute: minute(),
    scorerP: sc && sc.team === team ? sc : null, end: top ? -1 : 1 };
  G.goals.push(G.lastGoal);
  emit('goal', G.lastGoal);
}

// ---------- fouls, advantage, cards, offside ----------
const TEN_YARDS = 55;
// offside line for team t: depth (along t's attack) of the second-last opponent, keeper included
function secondLast(t) {
  const ds = t.opp.players.map(q => q.y * t.dir).sort((a, c) => c - a);
  return ds.length > 1 ? ds[1] : ds.length ? ds[0] : -1e9;
}
// in the opponents' half, and beyond both the ball and the second-last opponent (level is onside)
const inOffsidePos = (q, line, ballD) => (q.y - L / 2) * q.team.dir > 0 && q.y * q.team.dir > Math.max(line, ballD) + 1;
function offsideSnapshot(p) {
  const t = p.team, line = secondLast(t), bd = G.ball.y * t.dir, set = new Map();
  for (const q of t.players) if (q !== p && q.role !== 'GK' && inOffsidePos(q, line, bd)) set.set(q, { x: q.x, y: q.y });
  G.offside = set.size ? { team: t, set, from: p, pass: !!G._passing } : null;
}
// a player who was offside when it was played gets involved: flag up
function offsideTouch(q) {
  const o = G.offside;
  if (!o || o.team !== q.team || !o.set.has(q)) return false;
  const at = o.set.get(q);
  ST(q.team, 'offsides'); ST(q.team, o.pass ? 'offPass' : o.from.role === 'GK' ? 'offGK' : 'offLoose');
  callStop('offside', q.team.opp, at.x, at.y, null, null);
  emit('offside', { x: at.x, y: at.y, team: q.team });
  return true;
}
function foulCommitted(off, vic, how) {
  if (G.state !== 'play') return;
  const F = vic.team;
  ST(off.team, 'fouls');
  const card = judgeCard(off, vic, how);
  if (card) G.pendingCards.push({ p: off, color: card });
  if (inOwnBox(off.team, vic.x, vic.y)) { ST(F, 'pens'); callStop('penalty', F, vic.x, vic.y, off, vic); return; }
  if (G.adv) { const a = G.adv; callStop('freekick', a.team, a.x, a.y, a.off, a.vic); return; }   // a second foul: enough
  // in their attacking half the ref waits a moment to see if the fouled side keeps it
  if (toLocal(F, vic.x, vic.y).fy > 0.4) { G.adv = { team: F, x: vic.x, y: vic.y, off, vic, t0: G.clock, on: false }; return; }
  callStop('freekick', F, vic.x, vic.y, off, vic);
}
function judgeCard(off, vic, how) {
  const t = off.team, dG = Math.hypot(W / 2 - vic.x, ownGoalY(t) - vic.y);
  // denying an obvious goal: he had it, he was through on goal, and nobody else was back
  const cover = t.players.some(q => q !== off && q.role !== 'GK' && (q.y - vic.y) * vic.team.dir > 0);
  const [vx, vy] = norm(vic.vx, vic.vy), [gx, gy] = norm(W / 2 - vic.x, ownGoalY(t) - vic.y);
  if (how.hadBall && dG < 180 && !cover && vx * gx + vy * gy > 0.5 && Math.random() < 0.6) return off.yellow ? 'red2' : 'red';
  let sev = rand(0, 0.35) + (how.behind ? 0.3 : 0) + (how.late ? 0.3 : 0) + (how.slide ? 0.12 : 0);
  if (t.human) sev *= G.diff.cardMul;
  if (sev > 1.04) return 'red';
  if (sev > 0.58) { if (off.yellow) return 'red2'; off.yellow = 1; return 'yellow'; }
  return null;
}
// play stops: the free kick (or penalty, or offside) is set up from the 'foul' state
function callStop(kind, team, x, y, off, vic) {
  const b = G.ball;
  G.adv = null; G.offside = null;
  G.state = 'foul'; G.stateT = 0;
  const f = G.foul = { kind, team, x: clamp(x, 3, W - 3), y: clamp(y, 3, L - 3), off, vic, indirect: kind === 'offside' };
  if (kind === 'penalty') { f.x = W / 2; f.y = oppGoalY(team) - team.dir * SPOT_D; }
  if (kind === 'freekick') f.wallSpots = pickWall(f);
  Object.assign(b, { owner: null, after: null, target: null, passer: null }); b.vx *= 0.3; b.vy *= 0.3;
  for (const h of G.humans) h.charging = false;
  ST(team, kind === 'penalty' ? 'penAwarded' : 'freekicks');
  emit('stop', f);
}
function restartFoul() {
  const f = G.foul, T = f.team; G.foul = null;
  if (f.kind === 'penalty') {
    const taker = T.players.filter(q => q.role !== 'GK').sort((a, c) => c.st.shooting - a.st.shooting)[0];
    startSetPiece('penalty', T, f.x, f.y, taker, 0, T.dir);
    G.pen = { gk: T.opp.players[0], taker, kicked: 0, dived: false };
    return;
  }
  const taker = inOwnBox(T, f.x, f.y) ? T.players[0] : null;
  const [fx, fy] = taker ? [0, T.dir] : norm(W / 2 - f.x, oppGoalY(T) - f.y);
  startSetPiece('freekick', T, f.x, f.y, taker, fx, fy);
  G.sp.indirect = f.indirect; G.sp.wallSpots = f.wallSpots;
}
// a wall in shooting range: 2-5 men, ten yards off, lined up to cover the near post
function pickWall(f) {
  const D = f.team.opp, gy = ownGoalY(D), d = Math.hypot(W / 2 - f.x, gy - f.y);
  if (d > 235 || Math.abs(f.x - W / 2) > d * 0.8) return null;
  const n = d < 130 ? 5 : d < 165 ? 4 : d < 200 ? 3 : 2;
  const ax = W / 2 + Math.sign(f.x - W / 2) * GOAL_W * 0.2, [ux, uy] = norm(ax - f.x, gy - f.y);
  const c = { x: f.x + ux * TEN_YARDS, y: f.y + uy * TEN_YARDS };
  const men = D.players.filter(q => q.role !== 'GK').sort((a, q) => dist(a, c) - dist(q, c)).slice(0, n);
  const spots = new Map();
  men.forEach((q, k) => { const o = (k - (n - 1) / 2) * 7; spots.set(q, { x: c.x - uy * o, y: c.y + ux * o }); });
  return spots;
}
// where everyone stands for a free kick or a penalty
function restartSpot(p, R) {
  const t = p.team, T = R.team, D = T.opp, kind = R.type || R.kind, ball = { x: R.x, y: R.y };
  let h = homePos(p);
  if (kind === 'penalty') {   // everyone outside the box and the D, behind the ball
    const gy = ownGoalY(D), away = gy === 0 ? 1 : -1;
    h = { x: clamp(h.x, W / 2 - 115, W / 2 + 115), y: gy + away * (BOX_D + (t === T ? 6 : 12)) };
  } else if (R.wallSpots && R.wallSpots.has(p)) return R.wallSpots.get(p);
  else if (t === T && R.wallSpots && (p.role === 'FW' || p.role === 'MF')) {   // attackers into the box, staying onside
    const k = (p.idx * 37) % 5, gy = oppGoalY(T);
    h = { x: W / 2 + (k - 2) * 22, y: gy - T.dir * (30 + (p.idx % 3) * 16) };
    const lim = secondLast(T) - 3;
    if (h.y * T.dir > lim) h.y = lim * T.dir;
  }
  if (t === D) {   // ten yards back (and out of the D for a penalty)
    const d = dist(h, ball) || 1, r = kind === 'penalty' ? TEN_YARDS + 2 : TEN_YARDS + 1;
    if (d < r) h = { x: ball.x + (h.x - ball.x) / d * r, y: ball.y + (h.y - ball.y) / d * r };
  } else if (kind === 'penalty') { const d = dist(h, ball) || 1; if (d < TEN_YARDS + 2) h = { x: ball.x + (h.x - ball.x) / d * (TEN_YARDS + 2), y: ball.y + (h.y - ball.y) / d * (TEN_YARDS + 2) }; }
  return { x: clamp(h.x, 6, W - 6), y: clamp(h.y, 6, L - 6) };
}
// cards are shown at the next stoppage: the ref walks over and holds it up; a red means off you go
const cardBusy = () => !!G.cardShow || G.pendingCards.length > 0;
function cards() {
  const cs = G.cardShow;
  if (cs && G.clock - cs.t0 > 1.8) { if (cs.color !== 'yellow') sendOff(cs.p); G.cardShow = null; }
  if (!G.cardShow && G.pendingCards.length && G.state !== 'play' && G.state !== 'halftime' && G.state !== 'fulltime') {
    const c = G.pendingCards.shift();
    if (!c.p.team.players.includes(c.p)) return;
    G.cardShow = { p: c.p, color: c.color, t0: G.clock };
    ST(c.p.team, c.color === 'yellow' ? 'yellows' : 'reds');
    emit('card', G.cardShow);
  }
}
function sendOff(p) {
  const t = p.team, i = t.players.indexOf(p);
  if (i < 0) return;
  t.players.splice(i, 1);
  Object.assign(p, { sentOff: true, state: 'ok', vx: 0, vy: 0, jump: 0 });
  G.offPitch.push(p);
  for (const h of G.humans) if (h.player === p) h.player = null;
  for (const q of t.opp.players) if (q._mark === p) q._mark = null;
  const b = G.ball;
  if (G.state === 'setpiece' && G.sp.taker === p) {
    const nt = nearestTo(t.players.filter(q => q.role !== 'GK'), G.sp) || t.players[0];
    G.sp.taker = nt; b.owner = nt; const tp = takerSpot(G.sp, nt.fx, nt.fy); nt.x = tp.x; nt.y = tp.y;
  } else if (b.owner === p) b.owner = null;
  if (G.sp && G.sp.mate === p) G.sp.mate = G.sp.taker;
  emit('sentoff', p);
}
// the advantage: if the fouled side has it within a moment, play on; if they lose it soon after, bring it back
function advantage() {
  const a = G.adv; if (!a) return;
  const age = G.clock - a.t0, o = G.ball.owner;
  if (!a.on) {
    if (o && o.team === a.team && o !== a.vic) { a.on = true; a.t0 = G.clock; ST(a.team, 'advantages'); emit('label', 'ADVANTAGE'); }
    else if ((o && o.team !== a.team) || age > 0.7) callStop('freekick', a.team, a.x, a.y, a.off, a.vic);
  } else if (o && o.team !== a.team && age < 2.5) callStop('freekick', a.team, a.x, a.y, a.off, a.vic);
  else if (age >= 2.5) G.adv = null;
}

// ---------- half time / full time ----------
// Each player gets a little plan when the whistle goes. The sim moves them; p.act tells the renderer
// what they're doing (walk, trudge, celebrate, sad, hug, shake, applaud, hips, stretch, idle).
const hrand = (p, k) => { let h = Math.imul((p.idx + 1) * 2654435761 ^ (p.team === G.teams[0] ? 0 : 0x9e37) ^ k * 40503, 1597334677); h ^= h >>> 15; return ((h >>> 0) % 1000) / 1000; };
const BENCH_X = -24;                                   // the dugouts sit just off the left touchline at halfway
const benchY = t => L / 2 + (t === G.teams[0] ? -26 : 26);
function pairUp(A, B, n) {   // pair up to n players across the teams, nearest first
  const pairs = [], free = B.filter(q => q.role !== 'GK');
  const order = A.filter(q => q.role !== 'GK').sort((a, c) => hrand(a, 7) - hrand(c, 7));
  for (const a of order) {
    if (pairs.length >= n || !free.length) break;
    const b = nearestTo(free, a); if (dist(a, b) > 170) continue;
    free.splice(free.indexOf(b), 1); pairs.push([a, b]);
  }
  for (const [a, b] of pairs) {
    // meet side by side (reads best on screen), a hand's reach apart
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, ux = b.x >= a.x ? 1 : -1;
    a.end.shake = { partner: b, x: mx - ux * 5, y: my, fx: ux, fy: 0, at: a.end.shakeAt };
    b.end.shake = { partner: a, x: mx + ux * 5, y: my, fx: -ux, fy: 0, at: a.end.shakeAt };
    b.end.shakeAt = a.end.shakeAt;
  }
}
function planEnd() {
  const [A, B] = G.teams, all = A.players.concat(B.players);
  for (const p of all) { p._arr = false; p.act = null; p.end = { delay: hrand(p, 1) * 1.4, shakeAt: 0 }; }
  if (G.state === 'halftime') {
    for (const p of all) {
      const behind = p.team.score < p.team.opp.score;
      Object.assign(p.end, { tx: BENCH_X + hrand(p, 2) * 8, ty: benchY(p.team) + (hrand(p, 3) - 0.5) * 30,
        speed: 0.28 + hrand(p, 4) * 0.1, walk: behind ? 'trudge' : 'walk',
        wait: ['hips', 'idle', 'stretch', 'tired'][Math.floor(hrand(p, 5) * 4)] });
    }
    return;
  }
  const win = A.score > B.score ? A : B.score > A.score ? B : null;
  for (const p of all) {
    p.end.kind = !win ? 'draw' : p.team === win ? 'win' : 'lose';
    p.end.shakeAt = win ? 3 + hrand(p, 6) * 2 : 0.8 + hrand(p, 6);
    p.end.sadFor = 2 + hrand(p, 8) * 2.5;
    // fans to applaud: the stand on the nearer touchline
    p.end.ax = p.x < W / 2 ? 14 : W - 14; p.end.afx = p.x < W / 2 ? -1 : 1;
  }
  pairUp(A.players, B.players, win ? 4 : 10);
}
function endAI(p) {
  const e = p.end, T = G.stateT, t = p.team;
  if (!e) return;
  if (G.state === 'halftime') {
    if (T < e.delay) { p.act = e.wait; walkTo(p, p.x, p.y, 0); return; }
    p.act = walkTo(p, e.tx, e.ty, e.speed, 1, 0) ? 'idle' : e.walk; return;
  }
  // full time
  const sh = e.shake;
  if (sh && !sh.done && T >= sh.at) {
    const there = walkTo(p, sh.x, sh.y, 0.42, sh.fx, sh.fy), q = sh.partner;
    if (there && q.end.shake && Math.hypot(q.x - q.end.shake.x, q.y - q.end.shake.y) < 6) {
      if (!sh.t0) { sh.t0 = T; q.end.shake.t0 = T; }
      p.act = 'shake'; p.fx = sh.fx; p.fy = sh.fy;
      if (T - sh.t0 > 1.5) { sh.done = true; e.after = T; }
    } else p.act = there ? 'idle' : 'walk';
    return;
  }
  const tunnel = () => { p.act = walkTo(p, BENCH_X, benchY(t), 0.24, 1, 0) ? 'idle' : 'trudge'; };
  const applaud = () => { p.act = walkTo(p, e.ax, clamp(p.y, 40, L - 40), 0.3, e.afx, 0) ? 'applaud' : 'walk'; };
  if (e.kind === 'win') {
    if (T < 2.6) {   // wheel away and pile together
      const c = t.players[t.players.length - 1]; p.act = 'celebrate';
      if (p === c) walkTo(p, p.x, p.y, 0); else walkTo(p, c.x + ((p.idx % 3) - 1) * 7, c.y + (((p.idx >> 2) % 3) - 1) * 6, 0.8);
      return;
    }
    if (T < 4.6 && !sh) { p.act = 'hug'; walkTo(p, p.x, p.y, 0); return; }
    if (p.role === 'GK' && T < 4) { p.act = 'celebrate'; walkTo(p, p.x, p.y, 0); return; }
    applaud(); return;
  }
  if (e.kind === 'lose') {
    if (T < e.sadFor && !(sh && sh.done)) { p.act = 'sad'; walkTo(p, p.x, p.y, 0); return; }
    tunnel(); return;
  }
  // draw: a moment of hands on hips, handshakes, then a clap for the fans
  if (T < 0.8) { p.act = 'hips'; walkTo(p, p.x, p.y, 0); return; }
  if (sh && sh.done && T - e.after < 0.8) { p.act = 'idle'; return; }
  if (hrand(p, 9) < 0.4) tunnel(); else applaud();
}

// possession changes, the possession clock, and match stats
function track(dt) {
  const b = G.ball, o = b.owner;
  if (o) {
    if (G._ownT && G._ownT !== o.team) turnover(o.team, o);
    G._ownT = o.team;
    const t = o.team, fy = toLocal(t, b.x, b.y).fy;
    ST(t, 'poss', dt);
    if (fy > t.progFy + 0.07 || o.role === 'GK') { t.progFy = fy; t.progT = G.clock; }
  }
  if ((G._lineT = (G._lineT || 0) - dt) <= 0) {   // where each team's back line sits, sampled when defending
    G._lineT = 0.5;
    const pt = possTeam();
    for (const t of G.teams) if (pt && pt !== t) {
      const ds = t.players.filter(q => q.role === 'DF');
      ST(t, 'lineSum', ds.reduce((a, q) => a + toLocal(t, q.x, q.y).fy, 0) / ds.length); ST(t, 'lineN');
    }
  }
}

// ---------- main step ----------
function step(inputs) {
  const dt = DT;
  G.clock += dt; G.stateT += dt;
  if (G.state === 'play' || G.state === 'setpiece' || G.state === 'out') G.time += dt;   // stoppages for fouls don't run the clock
  if (G.state === 'setpiece') G.sp.t += dt;
  for (const h of G.humans) {
    const i = (inputs && inputs[h.src]) || { dx: 0, dy: 0, fire: false };
    h.inp = { dx: i.dx, dy: i.dy, fire: i.fire, pressed: i.fire && !h.prevFire, released: !i.fire && h.prevFire };
    h.prevFire = i.fire;
    updateControl(h);
  }
  computeRoles();
  for (const t of G.teams) for (const p of t.players) updatePlayer(p, dt);
  separate();
  if (G.state === 'play') { steals(dt); contact(); }
  updateBall(dt);
  if (G.state === 'play') { track(dt); advantage(); }
  checkRules();
  cards();
  if (G.state === 'foul' && G.stateT > (G.foul.kind === 'penalty' ? 2.4 : 1.6) && !cardBusy()) restartFoul();
  if (G.pen && G.pen.kicked && (G.state !== 'play' || G.clock - G.pen.kicked > 1.5)) G.pen = null;
  for (const p of G.offPitch) {   // sent off: the long walk to the bench
    walkTo(p, BENCH_X, benchY(p.team) + 10, 0.32, 1, 0);
    p.x += p.vx * dt; p.y += p.vy * dt; p.anim += Math.hypot(p.vx, p.vy) * dt;
  }

  if (G.state === 'out' && !cardBusy() && (G.stateT > 2.4 || (G.stateT > 1.1 && (G.ball.inCrowd || (G.ball.z < 1 && Math.hypot(G.ball.vx, G.ball.vy) < 10))))) {
    const [type, team, x, y] = G.pending; G.pending = null; G.ball.inCrowd = false;
    startSetPiece(type, team, x, y);
  }
  if ((G.state === 'play' || G.state === 'setpiece' || G.state === 'out') && G.time >= G.halfLen) {
    G.state = G.half === 1 ? 'halftime' : 'fulltime'; G.stateT = 0; G.sp = null;
    // nothing carries over the whistle, except that a red card still means off
    G.adv = null; G.offside = null; G.foul = null; G.pen = null;
    if (G.cardShow && G.cardShow.color !== 'yellow') sendOff(G.cardShow.p);
    for (const c of G.pendingCards) if (c.color !== 'yellow') sendOff(c.p);
    G.cardShow = null; G.pendingCards.length = 0;
    G.ball.owner = null; G.ball.after = null;
    planEnd();
    emit(G.state);
  }
  if (G.state === 'goal' && G.stateT > 4.2) setupKickoff(G.lastGoal.team.opp);   // long enough for the batucada
  if (G.state === 'halftime' && G.stateT > HALFTIME_LEN) {
    G.half = 2; G.time = 0;
    for (const t of G.teams) t.dir *= -1;
    for (const t of G.teams) for (const p of t.players) { p.act = null; p.end = null; }
    setupKickoff(G.firstKick.opp);
    emit('secondhalf');
  }
}

root.Sim = {
  W, L, GOAL_W, GOAL_H, GOAL_D, BOX_W, BOX_D, SIX_W, SIX_D, CIRCLE_R, SPOT_D, DT, CHARGE_TIME, HALFTIME_LEN, FULLTIME_LEN,
  newMatch, step, minute, teamRating, TUNE, STYLES, styleLabel, get G() { return G; },
  rules: { callStop, sendOff },   // test hooks (headless benchmark / screenshots)
};
})(typeof window !== 'undefined' ? window : globalThis);
