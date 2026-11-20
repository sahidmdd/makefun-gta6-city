// audio.js — every sound is synthesised at run time from WebAudio oscillators and noise buffers, so
// the game loads no audio file and makes no network request.

let ac = null;
let master = null;
let noiseBuf = null;
let engineOsc = null;
let engineGain = null;
let sirenOsc = null;
let sirenGain = null;
let sirenPhase = 0;
let muted = false;

export function initAudio() {
  if (ac) {
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ac = new AC();
  master = ac.createGain();
  master.gain.value = muted ? 0 : 0.4;
  master.connect(ac.destination);

  const len = Math.floor(ac.sampleRate * 0.5);
  noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  return ac;
}

export function isMuted() {
  return muted;
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.4;
}

export function toggleMute() {
  setMuted(!muted);
  return muted;
}

// One shared noise burst builder: band-passed noise with a fast decay, the base of every impact.
function burst(t, freq, dur, vol, q) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  const f = ac.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q ?? 1.1;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// A pitched blip: the workhorse for pickups, UI clicks and the wanted-star sting.
function tone(t, type, from, to, dur, vol) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// sfx(name) — the whole soundboard: gunshot, impact, pickup, cash, siren sting, menu blip.
export function sfx(name, vol = 1) {
  if (!ac || muted) return;
  const t = ac.currentTime;
  if (name === 'shot') burst(t, 1500, 0.16, 0.42 * vol);
  else if (name === 'shot2') burst(t, 800, 0.2, 0.34 * vol);
  else if (name === 'hit') burst(t, 320, 0.14, 0.3 * vol, 0.8);
  else if (name === 'crash') {
    burst(t, 240, 0.3, 0.34 * vol, 0.6);
    tone(t, 'sine', 120, 44, 0.24, 0.16 * vol);
  } else if (name === 'pickup') {
    tone(t, 'square', 620, 900, 0.1, 0.1 * vol);
    tone(t + 0.07, 'square', 900, 1240, 0.12, 0.08 * vol);
  } else if (name === 'cash') {
    tone(t, 'triangle', 780, 1180, 0.14, 0.12 * vol);
    tone(t + 0.09, 'triangle', 1180, 1560, 0.16, 0.1 * vol);
  } else if (name === 'star') {
    tone(t, 'sawtooth', 300, 210, 0.3, 0.14 * vol);
    tone(t + 0.04, 'sawtooth', 420, 300, 0.3, 0.09 * vol);
  } else if (name === 'ui') {
    tone(t, 'square', 520, 700, 0.05, 0.06 * vol);
  } else if (name === 'fail') {
    tone(t, 'sawtooth', 260, 90, 0.5, 0.14 * vol);
  } else if (name === 'win') {
    [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.11, 'triangle', f, f, 0.2, 0.1 * vol));
  } else if (name === 'siren') {
    tone(t, 'square', 700, 940, 0.3, 0.09 * vol);
  }
}

// Engine drone: a single detuned sawtooth pair whose pitch tracks the car's speed ratio.
export function setEngine(ratio, on) {
  if (!ac) return;
  if (on && !engineOsc) {
    engineOsc = ac.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 60;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    engineGain = ac.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(f);
    f.connect(engineGain);
    engineGain.connect(master);
    engineOsc.start();
  }
  if (!engineOsc) return;
  const t = ac.currentTime;
  engineOsc.frequency.setTargetAtTime(52 + ratio * 135, t, 0.09);
  engineGain.gain.setTargetAtTime(on ? 0.022 + ratio * 0.05 : 0, t, 0.14);
}

// Police siren: a square wave that flips between two tones while the wanted level is up.
export function setSiren(on, dt) {
  if (!ac) return;
  if (on && !sirenOsc) {
    sirenOsc = ac.createOscillator();
    sirenOsc.type = 'square';
    sirenOsc.frequency.value = 700;
    sirenGain = ac.createGain();
    sirenGain.gain.value = 0;
    sirenOsc.connect(sirenGain);
    sirenGain.connect(master);
    sirenOsc.start();
  }
  if (!sirenOsc) return;
  sirenPhase += dt;
  const f = Math.floor(sirenPhase * 2) % 2 ? 690 : 950;
  sirenOsc.frequency.setTargetAtTime(f, ac.currentTime, 0.03);
  sirenGain.gain.setTargetAtTime(on ? 0.028 : 0, ac.currentTime, 0.12);
}
