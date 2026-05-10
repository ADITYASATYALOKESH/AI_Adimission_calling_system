const logger = require('./logger');
const cfg = require('../config');

class LatencyTracker {
  constructor(callSid) {
    this.callSid = callSid;
    this.marks = new Map();
  }

  start(label) {
    this.marks.set(label, Date.now());
  }

  end(label, warnTarget = null) {
    const start = this.marks.get(label);
    if (!start) return 0;
    const elapsed = Date.now() - start;
    this.marks.delete(label);

    const target = warnTarget ?? this._defaultTarget(label);
    const ok = target == null || elapsed <= target;
    const msg = `[${this.callSid?.slice(-6) ?? '------'}] ${label}: ${elapsed}ms` +
      (target ? ` (target ${target}ms) ${ok ? '✓' : '⚠ SLOW'}` : '');

    if (!ok) logger.warn(msg);
    else logger.latency(msg);

    return elapsed;
  }

  measure(label, fn, warnTarget = null) {
    this.start(label);
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.finally(() => this.end(label, warnTarget));
    }
    this.end(label, warnTarget);
    return result;
  }

  _defaultTarget(label) {
    const map = {
      'stt':          cfg.latency.targetSttMs,
      'rag_first':    cfg.latency.targetRagFirstTokenMs,
      'sentence':     cfg.latency.targetSentenceDetectMs,
      'tts':          cfg.latency.targetTtsMs,
      'barge_in':     cfg.latency.targetBargeInMs,
    };
    for (const [key, val] of Object.entries(map)) {
      if (label.toLowerCase().includes(key)) return val;
    }
    return null;
  }
}

module.exports = LatencyTracker;
