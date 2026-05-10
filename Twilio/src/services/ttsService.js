const axios = require('axios');
const cfg = require('../config');
const logger = require('../utils/logger');
const { retry } = require('../utils/retry');
const { wavToMulaw } = require('../pipeline/audioProcessor');
const { normalizeForSpeech } = require('../utils/textNormalizer');

/**
 * Sarvam AI Text-to-Speech  (model: bulbul:v2)
 *
 * We request 22050 Hz WAV from Sarvam, then downsample to 8 kHz μ-law
 * for Twilio (wavToMulaw handles the decimation automatically).
 *
 * Supported speakers (bulbul:v2, en-IN):
 *   anushka, abhilash, manisha, vidya, arya, karun, hitesh, aditya,
 *   ritu, priya, neha, rahul, pooja, rohan, simran, kavya, amit,
 *   dev, ishita, shreya, ratan, varun, manan, sumit, roopa, kabir,
 *   aayan, shubh, ashutosh, advait, anand, tanya, tarun, sunny, ...
 *
 * Auth: api-subscription-key header.
 */
const ttsService = {
  /**
   * @param  {string}          text        - Complete sentence to synthesise
   * @param  {AbortController} abortCtrl   - Cancelled on barge-in
   * @returns {Promise<Buffer>}              μ-law Buffer at 8 kHz for Twilio
   */
  async synthesise(text, abortCtrl = null) {
    if (!text || !text.trim()) throw new Error('TTS: empty text');

    // Normalize numbers/currency to spoken form before synthesis
    const spoken = normalizeForSpeech(text.trim());

    const payload = {
      inputs:               [spoken],
      target_language_code: cfg.sarvam.tts.language,   // en-IN
      speaker:              cfg.sarvam.tts.speaker,     // amit (formal)
      model:                cfg.sarvam.tts.model,       // bulbul:v2
      speech_sample_rate:   cfg.sarvam.tts.sampleRate,  // 22050
      enable_preprocessing: true,
      pitch:                0,
      pace:                 1.0,
      loudness:             1.0,
    };

    logger.tts(`synthesising: "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`);
    logger.tts(`payload: model=${payload.model}  speaker=${payload.speaker}  lang=${payload.target_language_code}  sampleRate=${payload.speech_sample_rate}`);

    return retry(
      async () => {
        const res = await axios.post(cfg.sarvam.tts.endpoint, payload, {
          headers: {
            'Content-Type':         'application/json',
            'api-subscription-key': cfg.sarvam.apiKey,
          },
          timeout: 25000,
          signal: abortCtrl?.signal,
          validateStatus: null,   // log errors ourselves
        });

        if (res.status !== 200) {
          const body = JSON.stringify(res.data);
          logger.error(`TTS HTTP ${res.status}: ${body}`);
          throw Object.assign(
            new Error(`TTS API ${res.status}: ${res.data?.error?.message || body}`),
            { response: res }
          );
        }

        // Sarvam returns { audios: ["<base64_wav>"] }
        const audios = res.data?.audios;
        if (!audios || !Array.isArray(audios) || !audios[0]) {
          logger.error(`TTS unexpected response: ${JSON.stringify(Object.keys(res.data || {}))}`);
          throw new Error('TTS: no audio in response');
        }

        const wavBuf = Buffer.from(audios[0], 'base64');
        logger.tts(`received WAV ${(wavBuf.length / 1024).toFixed(1)}KB  sampleRate=${payload.speech_sample_rate}`);

        // Downsample WAV (22050 Hz) → μ-law (8 kHz) for Twilio
        const mulaw = wavToMulaw(wavBuf);
        const durationMs = Math.round(mulaw.length / 160 * 20);
        logger.tts(`converted → μ-law ${mulaw.length}B  duration=${durationMs}ms`);

        return mulaw;
      },
      {
        maxAttempts: 3,
        baseDelayMs: 300,
        label:       'sarvam-tts',
        shouldRetry: (e) => {
          if (e.name === 'AbortError' || e.code === 'ERR_CANCELED') return false;
          const status = e.response?.status;
          if (!status) return true;      // network error
          return status >= 500;          // 4xx = fix the request, don't loop
        },
      }
    );
  },
};

module.exports = ttsService;
