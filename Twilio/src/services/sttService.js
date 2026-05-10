const axios = require('axios');
const FormData = require('form-data');
const cfg = require('../config');
const logger = require('../utils/logger');
const { retry } = require('../utils/retry');
const { mulawToWav16k } = require('../pipeline/audioProcessor');

/**
 * Sarvam AI Speech-to-Text  (model: saarika:v2.5)
 *
 * Twilio audio is μ-law 8 kHz → we upsample to 16 kHz PCM WAV before
 * sending to Sarvam for best accuracy.
 *
 * Auth: api-subscription-key header.
 */
const sttService = {
  /**
   * @param  {Buffer}          mulawBuf  - μ-law audio from Twilio (any length)
   * @returns {Promise<string>}            transcript (may be empty for silence)
   */
  async transcribe(mulawBuf) {
    // μ-law 8kHz → PCM 16kHz WAV (Sarvam accuracy is better at 16kHz)
    const wavBuf = mulawToWav16k(mulawBuf);
    const durationMs = Math.round(mulawBuf.length / 160 * 20);

    logger.stt(`sending ${(wavBuf.length / 1024).toFixed(1)}KB WAV  sampleRate=16000  channels=1  encoding=PCM16  duration=${durationMs}ms`);

    return retry(
      async () => {
        const form = new FormData();
        form.append('file', wavBuf, {
          filename:    'speech.wav',
          contentType: 'audio/wav',
        });
        form.append('model',         cfg.sarvam.stt.model);      // saarika:v2.5
        form.append('language_code', cfg.sarvam.stt.language);   // hi-IN or en-IN

        logger.stt(`POST ${cfg.sarvam.stt.endpoint}  model=${cfg.sarvam.stt.model}  lang=${cfg.sarvam.stt.language}`);

        const res = await axios.post(cfg.sarvam.stt.endpoint, form, {
          headers: {
            ...form.getHeaders(),
            'api-subscription-key': cfg.sarvam.apiKey,
          },
          timeout: 20000,
          validateStatus: null,   // Don't throw on 4xx — we log it ourselves
        });

        if (res.status !== 200) {
          const body = JSON.stringify(res.data);
          logger.error(`STT HTTP ${res.status}: ${body}`);
          throw Object.assign(
            new Error(`STT API ${res.status}: ${res.data?.detail || res.data?.error?.message || body}`),
            { response: res }
          );
        }

        const transcript =
          res.data?.transcript ||
          res.data?.text        ||
          res.data?.results?.[0]?.transcript ||
          '';

        logger.stt(`transcript: "${transcript || '(empty)'}"  lang_detected=${res.data?.language_code || '—'}`);
        return transcript.trim();
      },
      {
        maxAttempts: 3,
        baseDelayMs: 400,
        label:       'sarvam-stt',
        shouldRetry: (e) => {
          const status = e.response?.status;
          if (!status) return true;          // network error — retry
          return status >= 500;              // 4xx = bad request, don't retry
        },
      }
    );
  },
};

module.exports = sttService;
