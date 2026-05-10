const { rmsEnergy } = require('./audioProcessor');
const cfg = require('../config');
const logger = require('../utils/logger');

/**
 * Energy-based Voice Activity Detector.
 * Works on Twilio's 20 ms mulaw chunks (160 bytes each at 8 kHz).
 *
 * Usage:
 *   const vad = new VadDetector(session);
 *   const result = vad.process(mulawChunk);
 *   // result: { speech: bool, utteranceComplete: bool }
 */
class VadDetector {
  constructor(session) {
    this.session = session;
    this.threshold      = cfg.vad.silenceEnergyThreshold;
    this.silenceLimit   = cfg.vad.silenceChunkCount;      // consecutive quiet chunks
    this.minSpeech      = cfg.vad.minSpeechChunks;        // min speech chunks to matter

    this.speechChunks   = 0;
    this.silenceChunks  = 0;
    this.isSpeaking     = false;
  }

  /**
   * @param {Buffer} mulawChunk
   * @returns {{ isSpeech: boolean, utteranceComplete: boolean }}
   */
  process(mulawChunk) {
    const energy = rmsEnergy(mulawChunk);
    const isSpeech = energy > this.threshold;

    if (isSpeech) {
      this.speechChunks++;
      this.silenceChunks = 0;

      if (!this.isSpeaking && this.speechChunks >= 3) {
        this.isSpeaking = true;
        logger.vad(`[${this.session.callSid.slice(-6)}] speech START  energy=${energy.toFixed(0)}`);
      }
    } else {
      if (this.isSpeaking) this.silenceChunks++;
    }

    // Utterance complete when:
    //  - was speaking
    //  - enough speech collected
    //  - now silent long enough
    const utteranceComplete =
      this.isSpeaking &&
      this.speechChunks >= this.minSpeech &&
      this.silenceChunks >= this.silenceLimit;

    if (utteranceComplete) {
      logger.vad(`[${this.session.callSid.slice(-6)}] speech END    speechChunks=${this.speechChunks}  silenceChunks=${this.silenceChunks}`);
      this.reset();
      return { isSpeech: false, utteranceComplete: true };
    }

    return { isSpeech, utteranceComplete: false };
  }

  /**
   * Quick-check if current chunk has speech energy (for barge-in detection).
   */
  hasSpeechEnergy(mulawChunk) {
    return rmsEnergy(mulawChunk) > this.threshold;
  }

  reset() {
    this.speechChunks  = 0;
    this.silenceChunks = 0;
    this.isSpeaking    = false;
  }
}

module.exports = VadDetector;
