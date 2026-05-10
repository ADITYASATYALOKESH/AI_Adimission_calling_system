const { EventEmitter } = require('events');
const logger = require('../utils/logger');

const STATES = {
  IDLE:                'IDLE',
  LISTENING:           'LISTENING',
  PROCESSING:          'PROCESSING',
  RAG_STREAMING:       'RAG_STREAMING',
  SENTENCE_AGGREGATION:'SENTENCE_AGGREGATION',
  TTS_GENERATION:      'TTS_GENERATION',
  PLAYBACK:            'PLAYBACK',
  INTERRUPTED:         'INTERRUPTED',
  ERROR:               'ERROR',
};

// Strict allowed transitions — barge-in uses forceTransition() and bypasses this table.
// INTERRUPTED is only reachable from PLAYBACK (barge-in), not from earlier states.
const TRANSITIONS = {
  IDLE:                ['LISTENING', 'ERROR'],
  LISTENING:           ['PROCESSING', 'ERROR'],
  PROCESSING:          ['RAG_STREAMING', 'LISTENING', 'ERROR'],
  RAG_STREAMING:       ['SENTENCE_AGGREGATION', 'LISTENING', 'ERROR'],
  SENTENCE_AGGREGATION:['TTS_GENERATION', 'LISTENING', 'ERROR'],
  TTS_GENERATION:      ['PLAYBACK', 'LISTENING', 'ERROR'],
  PLAYBACK:            ['LISTENING', 'TTS_GENERATION', 'INTERRUPTED', 'ERROR'],
  INTERRUPTED:         ['LISTENING', 'ERROR'],
  ERROR:               ['LISTENING'],
};

class StateMachine extends EventEmitter {
  constructor(sessionId) {
    super();
    this.sessionId  = sessionId;
    this.state      = STATES.IDLE;
    this.prevState  = null;
    this.enteredAt  = Date.now();
  }

  get current() { return this.state; }

  is(state) { return this.state === state; }

  canTransition(target) {
    const allowed = TRANSITIONS[this.state];
    return allowed && allowed.includes(target);
  }

  transition(target, reason = '') {
    if (!STATES[target]) {
      logger.error(`[SM:${this.sessionId}] Unknown state: ${target}`);
      return false;
    }
    if (!this.canTransition(target)) {
      logger.warn(`[SM:${this.sessionId}] Invalid transition ${this.state} → ${target} (${reason})`);
      return false;
    }

    const from = this.state;
    this.prevState = from;
    this.state     = target;
    this.enteredAt = Date.now();

    logger.state(`[${this.sessionId.slice(-6)}] ${from} → ${target}${reason ? ` (${reason})` : ''}`);
    this.emit('transition', { from, to: target, reason });
    this.emit(target, { from, reason });
    return true;
  }

  // Bypass guards — used only for barge-in (PLAYBACK → INTERRUPTED → LISTENING)
  forceTransition(target, reason = '') {
    const from = this.state;
    this.prevState = from;
    this.state     = target;
    this.enteredAt = Date.now();
    logger.state(`[${this.sessionId.slice(-6)}] ${from} → ${target} [FORCED]${reason ? ` (${reason})` : ''}`);
    this.emit('transition', { from, to: target, reason, forced: true });
    this.emit(target, { from, reason });
  }

  timeInCurrentState() {
    return Date.now() - this.enteredAt;
  }
}

module.exports = { StateMachine, STATES };
