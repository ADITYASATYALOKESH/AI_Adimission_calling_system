/**
 * G.711 μ-law ↔ PCM conversion utilities.
 * Twilio Media Streams: μ-law 8 kHz 8-bit mono.
 * Sarvam STT expects:   WAV (PCM 16-bit, 8 kHz).
 * Sarvam TTS returns:   WAV (PCM 16-bit, 8 kHz when requested).
 *
 * G.711 μ-law is a lossy logarithmic codec.  Round-trip error is
 * <5% for speech amplitudes — correct and expected per the ITU-T standard.
 */

// ─── Decode table (pre-computed for speed) ────────────────────────────────────
// Inverse of the encoder below: ((man | 0x10) << (exp+3)) − 132
const MULAW_DECODE = new Int16Array(256);
(function buildTable() {
  for (let i = 0; i < 256; i++) {
    const mu  = (~i) & 0xFF;
    const sign = mu & 0x80;
    const exp  = (mu >> 4) & 0x07;
    const man  = mu & 0x0F;
    const s    = ((man | 0x10) << (exp + 3)) - 132;
    MULAW_DECODE[i] = sign ? -s : s;
  }
})();

// ─── Core codec ───────────────────────────────────────────────────────────────

/** μ-law byte → 16-bit signed PCM sample */
function mulawSampleToPcm(byte) {
  return MULAW_DECODE[byte & 0xFF];
}

/** 16-bit signed PCM sample → μ-law byte */
function pcmSampleToMulaw(sample) {
  let sign = 0;
  if (sample < 0) { sign = 0x80; sample = -sample; }
  if (sample > 32635) sample = 32635;
  sample += 132;

  let exp = 7, mask = 0x4000;
  for (; (sample & mask) === 0 && exp > 0; exp--, mask >>= 1) {}

  const man = (sample >> (exp + 3)) & 0x0F;
  return (~(sign | (exp << 4) | man)) & 0xFF;
}

// ─── Buffer-level conversions ─────────────────────────────────────────────────

/**
 * Decode a Buffer of μ-law bytes → Int16Array of PCM samples (16-bit LE).
 */
function mulawToPcm(mulawBuf) {
  const out = new Int16Array(mulawBuf.length);
  for (let i = 0; i < mulawBuf.length; i++) {
    out[i] = MULAW_DECODE[mulawBuf[i]];
  }
  return out;
}

/**
 * Encode an Int16Array of PCM samples → Buffer of μ-law bytes.
 */
function pcmToMulaw(pcmSamples) {
  const out = Buffer.allocUnsafe(pcmSamples.length);
  for (let i = 0; i < pcmSamples.length; i++) {
    out[i] = pcmSampleToMulaw(pcmSamples[i]);
  }
  return out;
}

// ─── WAV helpers ──────────────────────────────────────────────────────────────

/**
 * Wrap raw 16-bit PCM data in a WAV container (ready for STT upload).
 * @param {Int16Array|Buffer} pcmData
 * @param {number}            sampleRate  default 8000
 */
function pcmToWav(pcmData, sampleRate = 8000) {
  const rawBuf = Buffer.isBuffer(pcmData)
    ? pcmData
    : Buffer.from(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(rawBuf.length + 36, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);            // fmt chunk size
  header.writeUInt16LE(1, 20);             // PCM
  header.writeUInt16LE(1, 22);             // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byteRate
  header.writeUInt16LE(2, 32);             // blockAlign
  header.writeUInt16LE(16, 34);            // bitsPerSample
  header.write('data', 36);
  header.writeUInt32LE(rawBuf.length, 40);
  return Buffer.concat([header, rawBuf]);
}

/**
 * Convert a μ-law Buffer directly to a WAV Buffer (for STT upload).
 */
function mulawToWav(mulawBuf, sampleRate = 8000) {
  return pcmToWav(mulawToPcm(mulawBuf), sampleRate);
}

/**
 * Convert a WAV Buffer → μ-law Buffer.
 * Assumes 16-bit PCM WAV (mono or stereo; takes first channel).
 * Optionally resamples from srcRate to 8000 Hz.
 */
function wavToMulaw(wavBuf) {
  if (wavBuf.length < 44 || wavBuf.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('wavToMulaw: invalid WAV buffer');
  }

  const numChannels   = wavBuf.readUInt16LE(22);
  const srcRate       = wavBuf.readUInt32LE(24);
  const bitsPerSample = wavBuf.readUInt16LE(34);
  const bytesPerSample = bitsPerSample / 8;

  // Find 'data' chunk (skip non-data chunks like 'fact', 'LIST', etc.)
  let dataOffset = 12;
  while (dataOffset + 8 <= wavBuf.length) {
    const id  = wavBuf.toString('ascii', dataOffset, dataOffset + 4);
    const len = wavBuf.readUInt32LE(dataOffset + 4);
    dataOffset += 8;
    if (id === 'data') break;
    dataOffset += len;
  }

  // Read mono samples from data chunk
  const step = numChannels * bytesPerSample;
  const samples = [];
  for (let i = dataOffset; i + step <= wavBuf.length; i += step) {
    const s = bitsPerSample === 16
      ? wavBuf.readInt16LE(i)
      : ((wavBuf[i] - 128) << 8);  // 8-bit unsigned → 16-bit
    samples.push(s);
  }

  // Downsample to 8 kHz using linear interpolation (avoids aliasing artifacts)
  let finalSamples = samples;
  if (srcRate !== 8000 && srcRate > 8000) {
    const ratio = srcRate / 8000;
    const outLen = Math.floor(samples.length / ratio);
    finalSamples = new Array(outLen);
    for (let j = 0; j < outLen; j++) {
      const pos  = j * ratio;
      const idx  = Math.floor(pos);
      const frac = pos - idx;
      const a    = samples[idx];
      const b    = idx + 1 < samples.length ? samples[idx + 1] : a;
      finalSamples[j] = Math.round(a + frac * (b - a));
    }
  }

  return pcmToMulaw(new Int16Array(finalSamples));
}

// ─── VAD helper ───────────────────────────────────────────────────────────────

/**
 * Compute RMS energy of a μ-law buffer (used by VadDetector).
 * Returns a value in roughly the same scale as decoded PCM amplitudes.
 */
function rmsEnergy(mulawBuf) {
  let sum = 0;
  for (let i = 0; i < mulawBuf.length; i++) {
    const s = MULAW_DECODE[mulawBuf[i]];
    sum += s * s;
  }
  return Math.sqrt(sum / mulawBuf.length);
}

/** Concatenate multiple μ-law Buffers into one. */
function concatMulaw(buffers) {
  return Buffer.concat(buffers);
}

/**
 * Upsample Int16Array from 8 kHz → 16 kHz using linear interpolation.
 * Sarvam STT requires at least 8 kHz; 16 kHz gives better accuracy.
 */
function upsample8kTo16k(pcm8k) {
  const len = pcm8k.length;
  const out = new Int16Array(len * 2);
  for (let i = 0; i < len - 1; i++) {
    out[i * 2]     = pcm8k[i];
    out[i * 2 + 1] = Math.round((pcm8k[i] + pcm8k[i + 1]) / 2);
  }
  // Last sample repeated
  out[(len - 1) * 2]     = pcm8k[len - 1];
  out[(len - 1) * 2 + 1] = pcm8k[len - 1];
  return out;
}

/**
 * Convert a μ-law 8kHz buffer directly to a 16kHz WAV Buffer (for STT).
 */
function mulawToWav16k(mulawBuf) {
  const pcm8k  = mulawToPcm(mulawBuf);
  const pcm16k = upsample8kTo16k(pcm8k);
  return pcmToWav(pcm16k, 16000);
}

module.exports = {
  mulawToPcm,
  pcmToMulaw,
  pcmToWav,
  mulawToWav,
  mulawToWav16k,
  upsample8kTo16k,
  wavToMulaw,
  rmsEnergy,
  concatMulaw,
  mulawSampleToPcm,
  pcmSampleToMulaw,
};
