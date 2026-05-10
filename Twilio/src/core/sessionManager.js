const { EventEmitter } = require('events');
const { StateMachine } = require('./stateMachine');
const LatencyTracker = require('../utils/latencyTracker');
const logger = require('../utils/logger');

const sessions = new Map();

class Session extends EventEmitter {
  constructor(callSid, streamSid, ws) {
    super();
    this.setMaxListeners(20);

    this.callSid   = callSid;
    this.streamSid = streamSid;
    this.ws        = ws;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();

    this.sm      = new StateMachine(callSid);
    this.latency = new LatencyTracker(callSid);

    // Conversation history [{role, content, ts}] — last 20 turns
    this.history = [];

    // Active stream controllers — cancelled on barge-in
    this.ragAbort = null;
    this.ttsAbort = null;

    this.playbackActive = false;
    this.audioQueue     = [];
    this.audioSending   = false;

    // STT accumulation
    this.sttBuffer      = [];
    this.speechDetected = false;
    this.silenceCount   = 0;

    // Sentence pipeline
    this.ragBuffer    = '';
    this.sentenceQueue = [];

    this.metrics = {
      totalUtterances: 0,
      totalBargeIns:   0,
      totalErrors:     0,
    };
  }

  addHistory(role, content) {
    this.history.push({ role, content, ts: Date.now() });
    this.updatedAt = Date.now();
    if (this.history.length > 40) this.history.splice(0, 2);
  }

  getHistoryText(maxTurns = 8) {
    return this.history
      .slice(-maxTurns * 2)
      .map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`)
      .join('\n');
  }

  cancelActiveStreams(reason = 'barge-in') {
    if (this.ragAbort) { this.ragAbort.abort(reason); this.ragAbort = null; }
    if (this.ttsAbort) { this.ttsAbort.abort(reason); this.ttsAbort = null; }
    this.ragBuffer     = '';
    this.sentenceQueue = [];
    this.playbackActive = false;
    this.audioSending   = false;
  }

  resetSttBuffer() {
    this.sttBuffer      = [];
    this.speechDetected = false;
    this.silenceCount   = 0;
  }

  toJSON() {
    return {
      callSid:      this.callSid,
      streamSid:    this.streamSid,
      state:        this.sm.current,
      createdAt:    this.createdAt,
      uptime:       Date.now() - this.createdAt,
      historyTurns: Math.floor(this.history.length / 2),
      queuedAudio:  this.audioQueue.length,
      metrics:      this.metrics,
    };
  }
}

const sessionManager = {
  create(callSid, streamSid, ws) {
    const session = new Session(callSid, streamSid, ws);
    sessions.set(callSid, session);
    logger.session(`created  callSid=${callSid}`);
    return session;
  },

  get(callSid) { return sessions.get(callSid); },

  getByStream(streamSid) {
    for (const s of sessions.values()) {
      if (s.streamSid === streamSid) return s;
    }
    return null;
  },

  remove(callSid) {
    const s = sessions.get(callSid);
    if (s) {
      s.cancelActiveStreams('session-end');
      s.removeAllListeners();
      sessions.delete(callSid);
      logger.session(`removed  callSid=${callSid}  uptime=${Date.now() - s.createdAt}ms`);
    }
  },

  all()   { return [...sessions.values()]; },
  count() { return sessions.size; },
};

module.exports = { sessionManager, Session };
