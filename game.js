/* Linafa 27 — input, sound, menus, main loop. */
'use strict';
(function () {
const S = window.Sim;
const { W, L, GOAL_W, GOAL_H, GOAL_D, BOX_W, BOX_D, SIX_W, SIX_D, CIRCLE_R, SPOT_D, DT } = S;
const HUMAN_COLORS = { p1: '#ffe14a', p2: '#5ce1ff' };

const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
cv.width = window.Render.CW; cv.height = window.Render.CH;
ctx.imageSmoothingEnabled = false;

function fit() {
  // scale the 640x400 canvas to the window; snap to half steps above 1x to keep pixels even
  const R = window.Render;
  let s = Math.min(innerWidth / R.CW, (innerHeight - 8) / R.CH);
  if (s >= 1) s = Math.floor(s * 2) / 2;
  $('wrap').style.width = Math.round(R.CW * s) + 'px';
  $('wrap').style.height = Math.round(R.CH * s) + 'px';
  document.documentElement.style.setProperty('--px', (s * R.RS) + 'px');   // HUD sizes are in 320-wide units
}
addEventListener('resize', fit); fit();

// ---------- render ----------
const R = window.Render;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// ` toggles a frame-rate readout (frames per second and the slowest frame in the last second)
let showFps = false, fpsN = 0, fpsT = 0, fpsWorst = 0, fpsText = '';
function render(el) {
  R.draw(ctx, S.G, HUMAN_COLORS);
  if (!showFps) return;
  fpsN++; fpsT += el; fpsWorst = Math.max(fpsWorst, el);
  if (fpsT >= 1) { fpsText = `${Math.round(fpsN / fpsT)} FPS  WORST ${Math.round(fpsWorst * 1000)}MS`; fpsN = 0; fpsT = 0; fpsWorst = 0; }
  R.drawText(ctx, fpsText, 230, 14, { sc: 1, col: '#7dff7a', out: '#000000' });
}

// ---------- input ----------
const keys = new Set();
const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft',
  'KeyI', 'KeyJ', 'KeyK', 'KeyL', 'KeyQ', 'KeyE'];
addEventListener('keydown', e => {
  if (!running) { menuMusic(); if (e.code === 'KeyM' && e.target.tagName !== 'SELECT') Snd.toggle(); return; }
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
  if (e.code === 'KeyM') Snd.toggle();
  if (e.code === 'KeyC') toggleCrt();
  if (e.code === 'Backquote') showFps = !showFps;
  if (e.code === 'KeyQ' && paused) quitToMenu();   // (Q is switch player in play; it only quits from the pause screen)
});
addEventListener('keyup', e => keys.delete(e.code));
// The menu music tries to start straight away. Most browsers block sound until the page has had a click or
// a key press, so then it starts on the first one (anywhere), and a hint says so until it does.
for (const ev of ['pointerdown', 'touchstart']) addEventListener(ev, () => { if (!running) menuMusic(); }, { passive: true });
function menuMusic() {
  Snd.init(); if (!Snd.ctx) return;
  if (!Snd.ctx._hint) {
    Snd.ctx._hint = true;
    const upd = () => $('sndhint').classList.toggle('off', Snd.ctx.state === 'running');
    Snd.ctx.addEventListener('statechange', upd); upd();
  }
  if (Snd.ctx.state === 'suspended') Snd.ctx.resume().catch(() => {});
  if (!running) Music.start();
}
function toggleCrt(on) {
  const v = on === undefined ? !document.body.classList.contains('crt') : on;
  document.body.classList.toggle('crt', v);
  try { localStorage.setItem('linafa27.crt', v ? '1' : '0'); } catch (e) {}
}
// settings saved before the rename (as 'kickabout.*') still count
const stored = k => localStorage.getItem('linafa27.' + k) ?? localStorage.getItem('kickabout.' + k);
toggleCrt((() => { try { return stored('crt') !== '0'; } catch (e) { return true; } })());
addEventListener('blur', () => keys.clear());

// Controller first. Pad 1 plays for P1 and pad 2 for P2. The keyboard is one more controller: it plays for the
// first player without a pad (P2 once a pad is plugged in, P1 otherwise), and joins in for P1 in a one-player game.
// Standard gamepad mapping: 0 Cross/A, 1 Circle/B, 2 Square/X, 3 Triangle/Y, 4 L1/LB, 5 R1/RB, 6 L2/LT, 7 R2/RT,
// 8 Share/Back, 9 Options/Start, 12-15 d-pad. Keyboard: WASD (or arrows) to move, IJKL laid out like the pad's buttons.
const PAD_MAP = { pass: [0], shoot: [1], lob: [2], thru: [3], sw: [4], press: [5], sprint: [7, 6] };
const KEY_MAP = { pass: ['KeyK'], shoot: ['KeyL'], lob: ['KeyJ'], thru: ['KeyI'], sw: ['KeyQ'], press: ['KeyE'], sprint: ['ShiftLeft', 'Space'] };
const ACTIONS = Object.keys(PAD_MAP);
const padBtn = (pad, i) => { const b = pad.buttons[i]; return !!b && (b.pressed || b.value > 0.4); };
const getPads = () => (navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(p => p && p.connected !== false) : []);

function padInput(pad) {
  const o = { dx: 0, dy: 0 };
  if (!pad) return o;
  const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
  if (Math.hypot(ax, ay) > 0.35) { o.dx = ax; o.dy = ay; }
  if (padBtn(pad, 12)) o.dy = -1; if (padBtn(pad, 13)) o.dy = 1; if (padBtn(pad, 14)) o.dx = -1; if (padBtn(pad, 15)) o.dx = 1;
  for (const a of ACTIONS) o[a] = PAD_MAP[a].some(i => padBtn(pad, i));
  return o;
}
function keyInput() {
  const k = c => (keys.has(c) ? 1 : 0);
  const o = { dx: (k('KeyD') || k('ArrowRight')) - (k('KeyA') || k('ArrowLeft')), dy: (k('KeyS') || k('ArrowDown')) - (k('KeyW') || k('ArrowUp')) };
  for (const a of ACTIONS) o[a] = KEY_MAP[a].some(c => keys.has(c));
  return o;
}
function merge(a, b) {
  const o = { dx: a.dx || b.dx, dy: a.dy || b.dy };
  for (const k of ACTIONS) o[k] = !!(a[k] || b[k]);
  return o;
}
let inputGate = false;   // set at kick-off: ignore buttons still held from the menu until they're let go
function readInputs() {
  const pads = getPads(), two = S.G && S.G.humans.length > 1;
  if (inputGate) {
    if (pads.some(p => p.buttons.some((b, i) => padBtn(p, i))) || [...keys].some(c => ACTIONS.some(a => KEY_MAP[a].includes(c)))) return {};
    inputGate = false;
  }
  const out = { p1: padInput(pads[0]), p2: padInput(pads[1]) };
  const kb = !two ? 'p1' : pads[0] ? 'p2' : 'p1';
  out[kb] = merge(out[kb], keyInput());
  return out;
}

// Start/Options pauses, Share/Back quits from the pause screen; in the menu the d-pad or stick moves between
// the options (left/right changes one) and Cross/A or Start kicks off.
const padPrev = new Map();
let navDir = null, navT = 0;
function pollPads(el) {
  const pads = getPads(), edge = i => pads.some(p => { const pr = padPrev.get(p.index) || []; return padBtn(p, i) && !pr[i]; });
  const start = edge(9), back = edge(8), cross = edge(0);
  let dir = null;
  for (const p of pads) {
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    if (padBtn(p, 12) || ay < -0.6) dir = 'up'; else if (padBtn(p, 13) || ay > 0.6) dir = 'down';
    else if (padBtn(p, 14) || ax < -0.6) dir = 'left'; else if (padBtn(p, 15) || ax > 0.6) dir = 'right';
    if (dir) break;
  }
  for (const p of pads) padPrev.set(p.index, p.buttons.map((b, i) => padBtn(p, i)));
  let nav = null;   // held directions repeat after a short delay
  if (dir !== navDir) { navDir = dir; navT = 0.4; nav = dir; } else if (dir && (navT -= el) <= 0) { navT = 0.13; nav = dir; }
  if (running) {
    if (start) togglePause();
    if (paused && back) quitToMenu();
    return;
  }
  if (start) { startMatch(); return; }
  const ids = ['home', 'away', 'p2', 'diff', 'len', 'start'];
  let i = ids.indexOf(document.activeElement && document.activeElement.id); if (i < 0) i = ids.length - 1;
  if (cross) { if (ids[i] === 'start') startMatch(); else $(ids[i + 1]).focus(); return; }
  if (nav === 'up' || nav === 'down') $(ids[clamp(i + (nav === 'up' ? -1 : 1), 0, ids.length - 1)]).focus();
  else if (nav && ids[i] !== 'start') {
    const sel = $(ids[i]);
    sel.selectedIndex = clamp(sel.selectedIndex + (nav === 'left' ? -1 : 1), 0, sel.options.length - 1);
    sel.dispatchEvent(new Event('change'));
  }
  if (nav) menuMusic();
}
// which controller plays for whom, shown in the menu
function padInfo() {
  const n = getPads().length, two = $('p2').value === 'p2';
  const t = !two ? (n ? 'P1: controller (keyboard works too)' : 'P1: keyboard — plug in a controller to play with one')
    : n >= 2 ? 'P1: controller 1 · P2: controller 2 (or keyboard)' : n === 1 ? 'P1: controller · P2: keyboard'
    : 'Two players need at least one controller (P2 can use the keyboard)';
  const odd = getPads().some(p => p.mapping !== 'standard') ? ' · controller layout not recognised: buttons may be mixed up' : '';
  const el = $('padinfo'); if (el.textContent !== t + odd) el.textContent = t + odd;
}

// ---------- sound (all synthesised) ----------
const Snd = {
  ctx: null, out: null, crowd: null, muted: false,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.out = c.createGain(); this.out.gain.value = 0.6; this.out.connect(c.destination);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6;
    this.crowd = c.createGain(); this.crowd.gain.value = 0.05;
    src.connect(bp).connect(this.crowd).connect(this.out); src.start();
  },
  toggle() { this.muted = !this.muted; if (this.out) this.out.gain.value = this.muted ? 0 : 0.6; },
  burst(freq, dur, vol, type, at) {
    const c = this.ctx; if (!c) return;
    const t = at || c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.out); s.start(t, Math.random()); s.stop(t + dur);
  },
  thump(freq, dur, vol) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + dur);
  },
  kick(spd) { const v = clamp(spd / 350, 0.15, 1); this.burst(1400, 0.05, 0.35 * v); this.thump(140, 0.08, 0.5 * v); },
  whistle(n, long, at) {
    const c = this.ctx; if (!c) return;
    let t = at || c.currentTime;
    for (let i = 0; i < n; i++) {
      const d = long && i === n - 1 ? 0.7 : 0.22;
      const o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = 2300; lfo.frequency.value = 32; lg.gain.value = 120;
      lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.02);
      g.gain.setValueAtTime(0.12, t + d - 0.03); g.gain.linearRampToValueAtTime(0, t + d);
      o.connect(g).connect(this.out); o.start(t); lfo.start(t); o.stop(t + d); lfo.stop(t + d);
      t += d + 0.12;
    }
  },
  // The goal sting, after the old TV one: four laser "piew"s. The batucada (GoalSamba) takes over after.
  lasers(t0) {
    const c = this.ctx; if (!c) return;
    for (let i = 0; i < 4; i++) {
      const t = t0 + i * 0.2;
      for (const [type, mul, vol] of [['square', 1, 0.07], ['sawtooth', 0.5, 0.035]]) {
        const o = c.createOscillator(), g = c.createGain(); o.type = type;
        o.frequency.setValueAtTime(2100 * mul, t); o.frequency.exponentialRampToValueAtTime(240 * mul, t + 0.17);
        g.gain.setValueAtTime(vol, t); g.gain.linearRampToValueAtTime(vol * 0.6, t + 0.12); g.gain.linearRampToValueAtTime(0, t + 0.18);
        o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.2);
      }
    }
  },
  swell(peak, dur) {
    if (!this.crowd) return;
    const g = this.crowd.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(peak, t + 0.25); g.linearRampToValueAtTime(0.05, t + dur);
  },
};

// ---------- chip instruments, shared by the menu music and the goal batucada ----------
function chipKit(ctx, dest, noise) {
  const pulse = duty => {   // band-limited pulse wave of the given duty cycle
    const n = 32, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) { re[k] = Math.sin(2 * Math.PI * k * duty) / (Math.PI * k); im[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (Math.PI * k); }
    return ctx.createPeriodicWave(re, im);
  };
  const waves = { p50: pulse(0.5), p25: pulse(0.25), p12: pulse(0.125) };
  function tone(wave, f, t, dur, vol, opts) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    if (typeof wave === 'string') o.type = wave; else o.setPeriodicWave(wave);
    o.frequency.setValueAtTime(f, t);
    if (opts && opts.slide) o.frequency.exponentialRampToValueAtTime(opts.slide, t + dur);
    if (opts && opts.vib) {   // a little vibrato on held notes, delayed like a chip tracker
      const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 6; lg.gain.setValueAtTime(0, t);
      lg.gain.setValueAtTime(f * 0.012, t + 0.12); l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur + 0.05);
    }
    g.gain.setValueAtTime(vol, t);
    g.gain.setValueAtTime(vol, t + Math.max(0.01, dur - 0.03));
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }
  function hiss(t, dur, vol, type, freq, q) {
    const s = ctx.createBufferSource(); s.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.connect(f).connect(g).connect(dest); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.02);
  }
  const surdo = (t, vol, f = 110, to = 48) => tone('sine', f, t, 0.22, vol, { slide: to });
  function apito(t, dur) {   // samba whistle: a trilled blast
    const o = ctx.createOscillator(), l = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = 2350; l.frequency.value = 38; lg.gain.value = 140;
    l.connect(lg).connect(o.frequency);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.035, t + 0.015);
    g.gain.setValueAtTime(0.035, t + dur - 0.02); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(dest); o.start(t); l.start(t); o.stop(t + dur + 0.02); l.stop(t + dur + 0.02);
  }
  return { waves, tone, hiss, surdo, apito };
}

// ---------- goal batucada: percussion-only samba until the kick-off whistle ----------
// Starts as the lasers finish, with a repinique call, then the full bateria: three surdos answering each
// other, caixa, repinique, tamborim, agogô, chocalho and a cuíca squeak. It grooves through the
// celebration; when the kick-off is set, the band stops dead on one big hit and the ref blows to restart.
const GoalSamba = (() => {
  const BPM = 138, STEP = 60 / BPM / 4;
  const CALL = { 0: 1, 2: 1, 4: 1.4, 6: 1.4 };                          // the repinique's chamada: ta ta TA TA
  const REPI = { 0: 1, 3: 0.7, 6: 0.8, 10: 0.7, 12: 1, 14: 0.6 };
  const TAMB = [0, 2, 5, 7, 10, 12, 14];
  const AGOGO = { 0: 1, 2: 0, 3: 1, 6: 0, 8: 1, 10: 0, 11: 1, 14: 0 };
  const CAIXA = [0.05, 0.035, 0.08, 0.05];
  let ctx = null, bus = null, kit = null, timer = null, step = 0, next = 0, on = false, endAt = -1, onEnd = null;
  function play(i, t) {
    const { tone, hiss, surdo, waves } = kit;
    if (i < 8) {   // the call, before everyone comes in
      if (i in CALL) { tone(waves.p50, 560, t, 0.07, 0.08 * CALL[i], { slide: 380 }); hiss(t, 0.04, 0.08 * CALL[i], 'highpass', 3000); }
      return;
    }
    const s = (i - 8) % 16, bar = Math.floor((i - 8) / 16);
    // surdos: segunda on beat 1, primeira (deepest, loudest) answers on beat 2, terceira cuts across
    if (s === 0 || s === 8) surdo(t, 0.3, 135, 60);
    if (s === 4 || s === 12) surdo(t, 0.5, 100, 42);
    if (s === 6 || s === 11 || s === 14) surdo(t, 0.18, 165, 80);
    hiss(t, 0.05, CAIXA[s % 4], 'bandpass', 1900, 0.9);                       // caixa
    hiss(t, 0.03, [0.05, 0.02, 0.035, 0.06][s % 4], 'highpass', 7500);         // chocalho
    if (s in REPI) { tone(waves.p50, 520, t, 0.06, 0.06 * REPI[s], { slide: 400 }); hiss(t, 0.03, 0.05 * REPI[s], 'highpass', 3200); }
    if (TAMB.includes(s)) tone(waves.p50, 1250, t, 0.035, 0.035);
    if (s in AGOGO) tone('triangle', AGOGO[s] ? 1568 : 1175, t, 0.07, 0.06);
    if (bar % 2 && (s === 7 || s === 15)) {   // cuíca: ooh-AH
      tone('triangle', 380, t, STEP * 0.9, 0.07, { slide: 820 });
      tone('triangle', 820, t + STEP, STEP * 0.9, 0.06, { slide: 420 });
    }
  }
  function finale(t) {   // everyone, one last hit, then silence for the whistle
    const { tone, hiss, surdo, waves } = kit;
    surdo(t, 0.55, 100, 40); surdo(t, 0.35, 140, 55);
    hiss(t, 0.16, 0.16, 'bandpass', 1900, 0.8); hiss(t, 0.08, 0.1, 'highpass', 5000);
    tone(waves.p50, 560, t, 0.08, 0.09, { slide: 360 }); tone('triangle', 1568, t, 0.1, 0.07);
  }
  function tick() {
    if (!on) return;
    const now = ctx.currentTime;
    if (next < now) next = now + 0.02;
    while (next < now + 0.12) {
      if (endAt >= 0 && step >= endAt) {
        finale(next); on = false; clearInterval(timer);
        if (onEnd) onEnd(next + 0.35);
        return;
      }
      play(step++, next); next += STEP;
    }
  }
  return {
    get playing() { return on; },
    start(at) {
      ctx = Snd.ctx; if (!ctx) return;
      if (!bus) { bus = ctx.createGain(); bus.gain.value = 0.85; bus.connect(Snd.out); kit = chipKit(ctx, bus, Snd.noise); }
      clearInterval(timer);
      on = true; step = 0; endAt = -1; next = at || ctx.currentTime;
      timer = setInterval(tick, 20); tick();
    },
    // finish on the next beat with one hit; whistle(t) gets the time to blow
    end(whistle) { if (!on) return; endAt = Math.max(step + 1, Math.ceil(step / 4) * 4); onEnd = whistle; },
    stop() { on = false; clearInterval(timer); },
  };
})();

// ---------- menu music: "Golazo", a fast 8-bit samba ----------
// A 16-step-per-bar sequencer scheduled ahead on the audio clock. Voices are NES-style: pulse-wave lead
// with a quieter echo, a 12.5% pulse arpeggio, a triangle bass, and a noise/blip samba batucada
// (surdo, ganzá, tamborim, agogô, and the apito whistle at the break).
const Music = (() => {
  const BPM = 150, STEP = 60 / BPM / 4;
  const N = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  const midi = s => { const m = /^([A-G][#b]?)(\d)$/.exec(s); return 12 * (+m[2] + 1) + N[m[1]]; };
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  // chords per bar (tones as MIDI, around middle C): I - VI7 - ii7 - V7 turnarounds, then the bridge
  const CH = {
    C6: ['C4', 'E4', 'G4', 'A4'], A7: ['A3', 'C#4', 'E4', 'G4'], Dm7: ['D4', 'F4', 'A4', 'C5'], G7: ['G3', 'B3', 'D4', 'F4'],
    F: ['F3', 'A3', 'C4', 'F4'], Fdim: ['F#3', 'A3', 'C4', 'D#4'], CG: ['G3', 'C4', 'E4', 'G4'],
  };
  const PROG = ['C6', 'C6', 'A7', 'A7', 'Dm7', 'G7', 'C6', 'G7', 'F', 'Fdim', 'CG', 'A7', 'Dm7', 'G7', 'C6', 'C6'];
  // the tune: 16 sixteenths per bar. Note = attack, '-' = hold, '.' = rest
  const TUNE = [
    'E5 . G5 C6 . A5 . G5 . E5 G5 . A5 . G5 .',
    'E5 - - - D5 . E5 G5 - - . . . . . .',
    'C#6 . A5 E5 . A5 . C#6 . E6 C#6 . A5 . G5 .',
    'A5 - - - G5 . E5 C#5 - - . . . . . .',
    'D5 . F5 A5 . C6 . A5 . F5 A5 . C6 . D6 .',
    'D6 - B5 - G5 . F5 . D5 . F5 G5 - - . .',
    'E5 . G5 C6 . E6 . D6 . C6 A5 . G5 . E5 .',
    'G5 - - - . . A5 B5 - D6 - . . . . .',
    'A5 - C6 - F6 - - . E6 . D6 C6 - - A5 .',
    'A5 - C6 - D#6 - - . C6 . A5 F#5 - - . .',
    'G5 . C6 E6 . G6 . E6 . C6 E6 . G6 - - .',
    'E6 - C#6 - A5 . G5 . E5 . G5 A5 - - . .',
    'F5 . A5 D6 . F6 . D6 . A5 F5 . D6 - - .',
    'B5 . D6 F6 . D6 . B5 . G5 F5 . D5 - - .',
    'C6 . . G5 . . E5 . C6 . . G5 . E5 . C6',
    '- - - . . . . . . . . . . . . .',
  ].map(bar => {
    const tk = bar.split(' '), out = [];
    tk.forEach((x, i) => { if (x === '-' || x === '.') return; let len = 1; while (tk[i + len] === '-') len++; out[i] = [midi(x), len]; });
    return out;
  });
  const TAMBORIM = [0, 2, 5, 7, 10, 12, 14];                          // telecoteco
  const AGOGO = { 0: 1, 3: 0, 4: 1, 6: 0, 8: 1, 11: 0, 12: 1, 14: 0 };   // 1 = high bell
  const SHAKE = [0.06, 0.025, 0.04, 0.07];
  let ctx = null, bus = null, waves = null, noise = null, timer = null, step = 0, next = 0, on = false;

  let kit = null;
  const tone = (...a) => kit.tone(...a), hiss = (...a) => kit.hiss(...a), surdo = (...a) => kit.surdo(...a), apito = (...a) => kit.apito(...a);
  function setup() {
    ctx = Snd.ctx; if (!ctx || bus) return;
    bus = ctx.createGain(); bus.gain.value = 0; bus.connect(Snd.out);
    kit = chipKit(ctx, bus, Snd.noise); waves = kit.waves;
  }

  function play(i, t) {
    const bar = Math.floor(i / 16) % 16, s = i % 16, loop = Math.floor(i / 256);
    const ch = CH[PROG[bar]].map(midi), brk = bar === 15;
    // lead and its echo three steps behind
    const n = TUNE[bar][s];
    if (n) {
      const d = n[1] * STEP;
      tone(waves.p25, hz(n[0]), t, d * 0.92, 0.075, { vib: n[1] >= 3 });
      tone(waves.p50, hz(n[0]), t + 3 * STEP, d * 0.8, 0.022);
    }
    if (brk) {   // the break: everything drops out for the whistle, the surdo calls them back in
      if (s === 2 || s === 4) apito(t, STEP * 0.8);
      if (s === 6) apito(t, STEP * 4.5);
      if (s >= 12) { surdo(t, 0.3); hiss(t, 0.06, 0.12, 'bandpass', 1800, 1.2); }
      return;
    }
    // arpeggio: up and down the chord, an octave up every other beat
    const up = [0, 1, 2, 3, 2, 1][s % 6], oct = (s >> 2) % 2 ? 12 : 0;
    tone(waves.p12, hz(ch[up] + oct), t, STEP * 0.6, 0.03);
    // bass: boom - ba - boom - ba (root, root, fifth, fifth) on each half bar
    const r = ch[0] - 12, five = ch[2] - 12, h = s % 8;
    if (h === 0) tone('triangle', hz(r), t, STEP * 2.6, 0.22);
    if (h === 3) tone('triangle', hz(r + 12), t, STEP * 0.9, 0.16);
    if (h === 4) tone('triangle', hz(five), t, STEP * 2.6, 0.22);
    if (h === 7) tone('triangle', hz(five - (bar % 2 ? 2 : 0)), t, STEP * 0.9, 0.16);
    // batucada
    if (h === 4) surdo(t, 0.42); else if (h === 0) surdo(t, 0.14);
    hiss(t, 0.035, SHAKE[s % 4], 'highpass', 7000);
    if (TAMBORIM.includes(s) && bar < 8) tone(waves.p50, 1250, t, 0.035, 0.035);
    if (s in AGOGO && bar >= 8) tone('triangle', AGOGO[s] ? 1568 : 1175, t, 0.07, 0.07);
    if (s === 15 && bar % 4 === 3) hiss(t, 0.12, 0.1, 'bandpass', 2200, 1);   // caixa roll into the next phrase
    if (bar === 0 && s === 0 && loop === 0) apito(t, STEP * 1.5);
  }
  function tick() {
    if (!on) return;
    const now = ctx.currentTime;
    if (next < now) next = now + 0.05;   // tab was in the background: skip ahead rather than cram
    while (next < now + 0.15) { play(step++, next); next += STEP; }
  }
  return {
    start() {
      if (!Snd.ctx) return; setup(); if (on) return;
      on = true; step = 0; next = ctx.currentTime + 0.1;
      bus.gain.cancelScheduledValues(ctx.currentTime); bus.gain.setValueAtTime(bus.gain.value, ctx.currentTime);
      bus.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 0.3);
      timer = setInterval(tick, 25); tick();
    },
    stop() {
      if (!on) return; on = false; clearInterval(timer);
      const t = ctx.currentTime;
      bus.gain.cancelScheduledValues(t); bus.gain.setValueAtTime(bus.gain.value, t); bus.gain.linearRampToValueAtTime(0, t + 0.4);
    },
  };
})();

// ---------- events ----------
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const surname = n => n.split(' ').slice(-1)[0].toUpperCase();
const scoreline = G => `${esc(G.teams[0].name)} ${G.teams[0].score} - ${G.teams[1].score} ${esc(G.teams[1].name)}`;

function handleEvents(silent) {
  const G = S.G;
  for (const e of G.events) {
    R.event(e, G);
    if (silent) continue;
    switch (e.type) {
      case 'kick': Snd.kick(e.data); break;
      case 'header': Snd.thump(220, 0.06, 0.3); break;
      case 'bounce': Snd.thump(90, 0.05, 0.15); break;
      case 'throwin': Snd.thump(240, 0.03, 0.12); break;
      case 'board': Snd.thump(130, 0.1, Math.min(0.45, 0.1 + e.data / 400)); break;
      case 'crowdball': Snd.swell(0.15, 1.0); break;
      case 'post': Snd.thump(600, 0.15, 0.4); Snd.burst(3000, 0.1, 0.2, 'highpass'); Snd.swell(0.2, 1.5); break;
      case 'tackle': case 'foul': Snd.burst(500, 0.08, 0.25); break;
      case 'stop':
        if (e.data.kind === 'penalty') { Snd.whistle(1, true); Snd.swell(0.4, 2.5); }
        else { Snd.whistle(1); Snd.swell(0.14, 1.0); }
        break;
      case 'card': Snd.swell(e.data.color === 'yellow' ? 0.2 : 0.32, 1.8); break;
      case 'save': case 'catch': Snd.thump(160, 0.08, 0.35); if (e.type === 'save') Snd.swell(0.18, 1.2); break;
      case 'shot': Snd.swell(0.12, 1.0); break;
      case 'hot': Snd.swell(0.22, 2.0); break;
      case 'label': Snd.swell(0.16, 1.2); break;
      case 'skill': Snd.burst(2600, 0.06, 0.12, 'highpass'); Snd.swell(0.1, 0.8); break;
      case 'setpiece':
        if (GoalSamba.playing) GoalSamba.end(t => Snd.whistle(1, false, t));   // the band stops, the ref restarts play
        else Snd.whistle(1);
        break;
      case 'goal': {
        Snd.swell(0.45, 3.5);
        if (!Snd.ctx) break;
        const t0 = Snd.ctx.currentTime + 0.05;
        Snd.lasers(t0); GoalSamba.start(t0 + 0.85);
        break;
      }
      case 'halftime': Snd.whistle(2, true); break;
      case 'fulltime':
        Snd.whistle(3, true);
        break;
    }
  }
  G.events.length = 0;
}

// ---------- menu / loop ----------
let running = false, paused = false, demo = false, acc = 0, last = performance.now();
const SPEED = 0.8;   // game runs at 80% of real time: a touch slower, more deliberate

function fillMenu() {
  const opts = TEAMS.map((t, i) => `<option value="${i}">${esc(t.name)} (${S.teamRating(t)}) · ${esc(S.styleLabel(t).toLowerCase())}</option>`).join('');
  $('home').innerHTML = opts; $('away').innerHTML = opts;
  $('away').value = TEAMS.length > 1 ? 1 : 0;
  try {
    const saved = JSON.parse(stored('menu') || 'null');
    if (saved) MENU_IDS.forEach((id, i) => { if ([...$(id).options].some(o => o.value === saved[i])) $(id).value = saved[i]; });
  } catch (e) {}
}
const MENU_IDS = ['home', 'away', 'p2', 'diff', 'len'];

function startMatch() {
  Snd.init(); if (Snd.ctx && Snd.ctx.state === 'suspended') Snd.ctx.resume();
  Music.stop();
  const home = TEAMS[+$('home').value], away = TEAMS[+$('away').value];
  S.newMatch(home, away, { halfMinutes: +$('len').value * SPEED, p2: $('p2').value === 'p2', difficulty: $('diff').value });
  try { localStorage.setItem('linafa27.menu', JSON.stringify(MENU_IDS.map(id => $(id).value))); } catch (e) {}
  R.resetCam();
  $('menu').classList.add('hidden'); $('pause').classList.add('hidden');
  running = true; demo = false; paused = false; acc = 0; keys.clear(); inputGate = true;
  cv.focus();
}

function togglePause() {
  paused = !paused;
  if (paused) GoalSamba.stop();
  $('pause').classList.toggle('hidden', !paused);
}

function quitToMenu(finished) {
  GoalSamba.stop();
  const G = S.G;
  running = false; paused = false;
  $('pause').classList.add('hidden');
  $('result').innerHTML = finished && G ? `Last match: ${scoreline(G)}` +
    (G.goals.length ? `<br><small>${G.goals.map(g => `${esc(surname(g.scorer))}${g.og ? ' (og)' : ''} ${g.minute}'`).join(', ')}</small>` : '') : '';
  $('menu').classList.remove('hidden');
  $('start').focus();
  if (Snd.ctx) Music.start();
  startDemo();
}

// attract mode: a CPU match plays behind the menu
function startDemo() {
  const a = Math.floor(Math.random() * TEAMS.length);
  let b = Math.floor(Math.random() * (TEAMS.length - 1)); if (b >= a) b++;
  S.newMatch(TEAMS[a], TEAMS[b === a ? (a + 1) % TEAMS.length : b], { p1: false, halfMinutes: 20, difficulty: 'normal' });
  R.resetCam(); demo = true; acc = 0;
}

$('start').addEventListener('click', startMatch);
fillMenu();
menuMusic();
$('start').focus();
startDemo();
const logo = $('logo');

function frame(now) {
  requestAnimationFrame(frame);
  const el = Math.min(0.1, (now - last) / 1000); last = now;
  pollPads(el);
  if (!running) padInfo();
  if ((running && !paused) || demo) {
    acc += el * SPEED;
    const inp = demo ? {} : readInputs();
    while (acc >= DT) { S.step(inp); acc -= DT; handleEvents(demo); }
    if (S.G.state === 'fulltime' && S.G.stateT > S.FULLTIME_LEN) { if (demo) startDemo(); else if (running) quitToMenu(true); }
  }
  render(el);
  if (!running && logo) R.drawLogo(logo, now / 1000);
}
requestAnimationFrame(frame);
})();
