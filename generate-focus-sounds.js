// Generates three deep-focus WAV files for the Syllabus Tracker PWA
// Run once: node generate-focus-sounds.js
'use strict';
const fs = require('fs');

const SR   = 22050;  // sample rate Hz
const BITS = 16;
const MAX  = 32767;

function buildWav(channels, seconds, fillFn) {
  const nSamples = Math.floor(SR * seconds);
  const dataLen  = nSamples * channels * 2; // 2 bytes per sample (16-bit)
  const buf      = Buffer.alloc(44 + dataLen);

  // RIFF/WAVE header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  // fmt chunk
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);                         // chunk size
  buf.writeUInt16LE(1,  20);                         // PCM = 1
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * channels * 2, 28);          // byte rate
  buf.writeUInt16LE(channels * 2, 32);               // block align
  buf.writeUInt16LE(16, 34);                         // bits per sample
  // data chunk
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);

  let off = 44;
  for (let i = 0; i < nSamples; i++) {
    const t  = i / SR;
    const s  = fillFn(t, i, nSamples);
    const ch = Array.isArray(s) ? s : [s, s];
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-MAX, Math.min(MAX, Math.round(ch[c] * MAX)));
      buf.writeInt16LE(v, off);
      off += 2;
    }
  }
  return buf;
}

// ── 1. Monk Mode — 40 Hz Gamma Binaural (stereo) ─────────────
// Left ear: 200 Hz carrier | Right ear: 240 Hz carrier
// Brain perceives 40 Hz gamma beat → heightened attention & working memory
const monk = buildWav(2, 45, (t) => {
  const amp = 0.30;
  return [
    Math.sin(2 * Math.PI * 200 * t) * amp,
    Math.sin(2 * Math.PI * 240 * t) * amp,
  ];
});
fs.writeFileSync('sounds/monk-mode.wav', monk);
console.log('✓  monk-mode.wav     ', (monk.length / 1024).toFixed(0), 'KB  (40 Hz gamma binaural, stereo)');

// ── 2. Void — Pink Noise / Deep Rain simulation (mono) ────────
// Paul Kellett's pink noise algorithm — warmer than white, mimics rain/waterfall
let b = [0, 0, 0, 0, 0, 0, 0];
const dur2 = 45;
const vd = buildWav(1, dur2, (t, i, total) => {
  const w = Math.random() * 2 - 1;
  b[0] =  0.99886 * b[0] + w * 0.0555179;
  b[1] =  0.99332 * b[1] + w * 0.0750759;
  b[2] =  0.96900 * b[2] + w * 0.1538520;
  b[3] =  0.86650 * b[3] + w * 0.3104856;
  b[4] =  0.55000 * b[4] + w * 0.5329522;
  b[5] = -0.76160 * b[5] - w * 0.0168980;
  const pink = (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362) / 7;
  b[6] = w * 0.115926;
  // 80 ms fade-in & fade-out to prevent click at loop boundary
  const fadeN = Math.floor(SR * 0.08);
  const env = Math.min(1, Math.min(i, total - i - 1) / fadeN);
  return Math.max(-1, Math.min(1, pink * 3.6)) * 0.44 * env;
});
fs.writeFileSync('sounds/void.wav', vd);
console.log('✓  void.wav          ', (vd.length / 1024).toFixed(0), 'KB  (pink noise deep rain, mono)');

// ── 3. Solfeggio 528 Hz — Transformation tone (mono) ─────────
// 528 Hz fundamental + natural harmonic series + slow 0.07 Hz LFO tremolo
const sol = buildWav(1, 45, (t) => {
  const f  = Math.sin(2 * Math.PI *  528 * t);
  const h2 = Math.sin(2 * Math.PI * 1056 * t) * 0.12;
  const h3 = Math.sin(2 * Math.PI * 1584 * t) * 0.05;
  const lfo = 0.93 + 0.07 * Math.sin(2 * Math.PI * 0.07 * t);
  return (f + h2 + h3) * lfo * 0.38;
});
fs.writeFileSync('sounds/solfeggio-528.wav', sol);
console.log('✓  solfeggio-528.wav ', (sol.length / 1024).toFixed(0), 'KB  (528 Hz transformation tone, mono)');

console.log('\nAll focus intensity sounds generated successfully.');
