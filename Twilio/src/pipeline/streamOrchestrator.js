const { STATES } = require('../core/stateMachine');
const AudioQueue = require('../core/audioQueue');
const VadDetector = require('./vadDetector');
const SentenceAggregator = require('./sentenceAggregator');
const sttService = require('../services/sttService');
const ttsService = require('../services/ttsService');
const ragService = require('../services/ragService');
const ollamaService = require('../services/ollamaService');
const twilioService = require('../services/twilioService');
const redisService = require('../services/redisService');
const { concatMulaw } = require('./audioProcessor');
const logger = require('../utils/logger');

const GREETING = 'Hello! Welcome to Aditya University. How can I help you today?';

// Minimum consecutive speech chunks before barge-in fires (5 × 20ms = 100ms)
const BARGE_IN_MIN_CHUNKS = 5;

class StreamOrchestrator {
  constructor(session) {
    this.session = session;
    this.sm      = session.sm;
    this.vad     = new VadDetector(session);

    this.audioQ = new AudioQueue(session, () => this._onQueueDrained());

    this.aggregator = new SentenceAggregator((sentence) =>
      this._onSentenceReady(sentence)
    );

    this._ttsQueue      = [];
    this._ttsRunning    = false;
    this._bargeInChunks = 0;

    this._greetingSynthesising = false;
    this._greetingEndsAt = Date.now() + 8000;

    this._destroyed = false;
  }

  // ─── Entry points from twilioWsHandler ───────────────────────────────────────

  onStreamStart() {
    this.sm.transition(STATES.LISTENING, 'stream started');
    this._greetingSynthesising = true;
    this._playGreeting();
  }

  onAudioChunk(mulawBuf) {
    if (this._destroyed) return;
    if (this._greetingSynthesising) return;

    const state = this.sm.current;
    const now   = Date.now();

    // ── BARGE-IN ─────────────────────────────────────────────────────────────
    // ONLY trigger during PLAYBACK, ONLY after greeting has finished,
    // AND only when speech is sustained for ≥100ms (prevents echo/noise triggers).
    if (state === STATES.PLAYBACK &&
        now >= this._greetingEndsAt &&
        this.audioQ.pending > 0) {

      if (this.vad.hasSpeechEnergy(mulawBuf)) {
        this._bargeInChunks++;
        if (this._bargeInChunks >= BARGE_IN_MIN_CHUNKS) {
          this._bargeInChunks = 0;
          this._handleBargeIn();
        }
      } else {
        this._bargeInChunks = 0;
      }
      return; // During PLAYBACK: only check barge-in, ignore for VAD
    }

    // Reset counter when outside PLAYBACK state
    this._bargeInChunks = 0;

    // ── USER SPEECH ──────────────────────────────────────────────────────────
    // Only accumulate speech when LISTENING and bot is silent
    if (state !== STATES.LISTENING || this.audioQ.pending > 0) return;

    const { isSpeech, utteranceComplete } = this.vad.process(mulawBuf);

    if (isSpeech || this.session.speechDetected) {
      this.session.speechDetected = true;
      this.session.sttBuffer.push(mulawBuf);
    }

    if (utteranceComplete && this.session.sttBuffer.length > 0) {
      this._processUtterance();
    }
  }

  // ─── Greeting ────────────────────────────────────────────────────────────────

  async _playGreeting() {
    logger.ai(`greeting: "${GREETING}"`);
    try {
      const mulaw = await ttsService.synthesise(GREETING, null);
      if (this._destroyed) return;
      const durationMs = Math.ceil(mulaw.length / 160 * 20);
      this._greetingEndsAt = Date.now() + durationMs + 600;
      this.audioQ.enqueue(mulaw);
      logger.playback(`greeting enqueued (${mulaw.length}B  ~${durationMs}ms)`);
    } catch (err) {
      logger.error(`Greeting TTS failed: ${err.message}`);
      this._greetingEndsAt = Date.now();
    } finally {
      this._greetingSynthesising = false;
    }
  }

  // ─── STT ─────────────────────────────────────────────────────────────────────

  async _processUtterance() {
    const buffers = [...this.session.sttBuffer];
    this.session.resetSttBuffer();
    this.vad.reset();

    if (!this.sm.transition(STATES.PROCESSING, 'utterance complete')) return;

    this.session.latency.start('stt');
    let transcript = '';
    try {
      transcript = await sttService.transcribe(concatMulaw(buffers));
      this.session.latency.end('stt');
    } catch (err) {
      logger.error(`STT failed: ${err.message}`);
      this.session.metrics.totalErrors++;
      this.sm.transition(STATES.LISTENING, 'stt-error');
      return;
    }

    if (!transcript.trim()) {
      logger.stt('empty transcript — back to LISTENING');
      this.sm.transition(STATES.LISTENING, 'empty-transcript');
      return;
    }

    logger.user(`"${transcript}"`);
    this.session.addHistory('user', transcript);
    this.session.metrics.totalUtterances++;
    redisService.saveHistory(this.session.callSid, this.session.history).catch(() => {});

    this._streamRAG(transcript);
  }

  // ─── RAG streaming ───────────────────────────────────────────────────────────

  _streamRAG(query) {
    if (!this.sm.transition(STATES.RAG_STREAMING, 'transcript-ready')) return;

    this.aggregator.reset();
    this._ttsQueue   = [];
    this._ttsRunning = false;

    const ragAbort = new AbortController();
    this.session.ragAbort = ragAbort;

    this.session.latency.start('rag_first');
    let firstChunk  = true;
    let gotAnyChunk = false;

    this.sm.transition(STATES.SENTENCE_AGGREGATION, 'rag-started');
    logger.rag(`streaming: "${query.slice(0, 80)}"`);

    ragService.stream(
      query,
      this.session.getHistoryText(),
      (chunk) => {
        if (ragAbort.signal.aborted) return;
        if (firstChunk) {
          firstChunk = false;
          this.session.latency.end('rag_first');
          logger.rag('first token ✓');
        }
        gotAnyChunk = true;
        this.aggregator.push(chunk);
      },
      () => {
        this.session.ragAbort = null;
        this.aggregator.flush();
        if (!gotAnyChunk) {
          logger.warn('RAG returned nothing — falling back to Ollama');
          this._streamOllama(query);
        }
      },
      ragAbort
    );
  }

  // ─── Ollama fallback ─────────────────────────────────────────────────────────

  _streamOllama(query) {
    const abort = new AbortController();
    this.session.ragAbort = abort;
    logger.rag('[Ollama] fallback started');
    ollamaService.stream(
      query,
      this.session.getHistoryText(),
      (chunk) => { if (!abort.signal.aborted) this.aggregator.push(chunk); },
      () => {
        this.session.ragAbort = null;
        this.aggregator.flush();
      },
      abort
    );
  }

  // ─── TTS queue — SEQUENTIAL, one sentence at a time ─────────────────────────
  //
  // Each sentence's TTS starts only after the previous sentence's audio is
  // enqueued. This avoids race conditions and overlapping synthesis.
  // Because AudioQueue burst-sends to Twilio, sentence N's audio plays while
  // sentence N+1's TTS is running — no perceptible gap on typical responses.

  _onSentenceReady(sentence) {
    if (!sentence || this._destroyed) return;
    logger.ai(`sentence: "${sentence.slice(0, 80)}"`);

    const abortCtrl = new AbortController();
    this.session.ttsAbort = abortCtrl;
    this._ttsQueue.push({ sentence, abortCtrl });

    if (!this._ttsRunning) this._drainTtsQueue();
  }

  async _drainTtsQueue() {
    if (this._ttsRunning) return; // guard against re-entrant calls
    this._ttsRunning = true;

    while (this._ttsQueue.length > 0 && !this._destroyed) {
      const { sentence, abortCtrl } = this._ttsQueue.shift();
      if (abortCtrl.signal.aborted) continue;

      // State transition: allow from SENTENCE_AGGREGATION or mid-PLAYBACK
      const cur = this.sm.current;
      if (cur === STATES.SENTENCE_AGGREGATION || cur === STATES.PLAYBACK) {
        this.sm.transition(STATES.TTS_GENERATION, 'sentence-ready');
      }

      try {
        this.session.latency.start('tts');
        const mulaw = await ttsService.synthesise(sentence, abortCtrl);
        this.session.latency.end('tts');

        if (abortCtrl.signal.aborted || this._destroyed) continue;

        this.sm.transition(STATES.PLAYBACK, 'tts-done');
        this.audioQ.enqueue(mulaw);
        this.session.addHistory('assistant', sentence);

        logger.playback(`enqueued ${mulaw.length}B  ~${Math.round(mulaw.length / 160 * 20)}ms`);
      } catch (err) {
        if (err.name !== 'AbortError' && err.code !== 'ERR_CANCELED') {
          logger.error(`TTS error: ${err.message}`);
          this.session.metrics.totalErrors++;
        }
      }
    }

    this._ttsRunning = false;

    if (!this.audioQ.pending && this.sm.current !== STATES.LISTENING) {
      this._returnToListening('tts-queue-empty');
    }
  }

  // ─── AudioQueue drain callback ────────────────────────────────────────────────

  _onQueueDrained() {
    if (this._destroyed) return;
    if (!this._ttsRunning && this._ttsQueue.length === 0) {
      this._returnToListening('audio-drained');
    }
  }

  _returnToListening(reason) {
    const cur = this.sm.current;
    if (cur === STATES.PLAYBACK ||
        cur === STATES.TTS_GENERATION ||
        cur === STATES.SENTENCE_AGGREGATION) {
      this.sm.transition(STATES.LISTENING, reason);
      logger.playback(`done → LISTENING (${reason})`);
    }
  }

  // ─── Barge-in ─────────────────────────────────────────────────────────────────

  _handleBargeIn() {
    const t0 = Date.now();
    logger.bargeIn(`detected  state=${this.sm.current}`);
    this.session.metrics.totalBargeIns++;

    // 1. Stop Twilio playback
    twilioService.clearPlayback(this.session.ws, this.session.streamSid);

    // 2. Cancel active RAG/TTS streams
    this.session.cancelActiveStreams('barge-in');

    // 3. Abort and clear TTS queue
    for (const item of this._ttsQueue) item.abortCtrl.abort();
    this._ttsQueue   = [];
    this._ttsRunning = false;

    // 4. Clear audio queue and aggregator
    this.audioQ.clear();
    this.aggregator.reset();

    // 5. Force to LISTENING — safe because barge-in only fires from PLAYBACK
    this.sm.forceTransition(STATES.INTERRUPTED, 'barge-in');
    this.sm.forceTransition(STATES.LISTENING,   'ready-for-speech');

    // 6. Reset user speech state
    this.session.resetSttBuffer();
    this.session.speechDetected = true;
    this.vad.reset();

    logger.latency(`barge-in handled in ${Date.now() - t0}ms`);
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────────

  destroy() {
    this._destroyed = true;
    this.session.cancelActiveStreams('destroy');
    for (const item of this._ttsQueue) item.abortCtrl.abort();
    this._ttsQueue = [];
    this.audioQ.clear();
    this.aggregator.reset();
  }
}

module.exports = StreamOrchestrator;
