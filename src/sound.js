// Small synthesized sound set, so the game ships no audio files.
// Browsers only allow audio after a click or key press, so call unlock() from one.

let ctx = null;
let master = null;
let rainGain = null;
let muted = false;
try { muted = localStorage.getItem('flood-rise-muted') === '1'; } catch { /* storage blocked */ }

function noiseBuffer(seconds) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export function unlock() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.8;
  master.connect(ctx.destination);

  // steady rain: looped noise through a band-pass
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(2);
  src.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 2400;
  band.Q.value = 0.6;
  rainGain = ctx.createGain();
  rainGain.gain.value = 0.12;
  src.connect(band).connect(rainGain).connect(master);
  src.start();
}

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('flood-rise-muted', muted ? '1' : '0'); } catch { /* storage blocked */ }
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.05);
  return muted;
}

function tone(freq, to, duration, type = 'sine', volume = 0.25) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + duration);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + duration);
}

function burst(duration, freq, volume, type = 'lowpass') {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(duration);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  src.connect(filter).connect(gain).connect(master);
  src.start(t);
}

export const sfx = {
  jump: () => tone(320, 620, 0.16, 'square', 0.08),
  land: () => burst(0.08, 600, 0.12),
  sachet: () => { tone(880, 1320, 0.09, 'sine', 0.18); setTimeout(() => tone(1320, 1760, 0.12, 'sine', 0.15), 70); },
  splash: () => { burst(0.9, 900, 0.6); tone(300, 60, 0.6, 'sine', 0.2); },
  thunder: () => burst(2.2, 180, 0.5),
  warn: () => tone(220, 180, 0.25, 'triangle', 0.12),
};
