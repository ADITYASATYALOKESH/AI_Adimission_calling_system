'use strict';

const TERMINALS = new Set(['.', '!', '?']);
const MIN_LEN    = 10;   // minimum chars for a sentence to be emitted
const FORCE_LEN  = 250;  // force-flush buffer if no boundary found within this length

class SentenceAggregator {
  constructor() {
    this.buffer = '';
  }

  // Feed a new token chunk; returns array of complete sentences (may be empty)
  feed(chunk) {
    this.buffer += chunk;
    return this._extract();
  }

  // Call after stream ends to flush any remaining text
  flush() {
    const remaining = this.buffer.trim();
    this.buffer = '';
    return remaining.length > 0 ? [remaining] : [];
  }

  reset() {
    this.buffer = '';
  }

  _extract() {
    const out = [];

    while (true) {
      const idx = this._findBoundary();

      if (idx === -1) {
        // No sentence boundary — force-flush if buffer is very long
        if (this.buffer.length >= FORCE_LEN) {
          const cut = this.buffer.lastIndexOf(' ', FORCE_LEN);
          const at  = cut > 0 ? cut : FORCE_LEN;
          const chunk = this.buffer.slice(0, at).trim();
          this.buffer   = this.buffer.slice(at).trimStart();
          if (chunk.length >= MIN_LEN) out.push(chunk);
        }
        break;
      }

      const sentence = this.buffer.slice(0, idx + 1).trim();
      this.buffer    = this.buffer.slice(idx + 1).trimStart();
      if (sentence.length >= MIN_LEN) out.push(sentence);
    }

    return out;
  }

  _findBoundary() {
    const buf = this.buffer;
    for (let i = 0; i < buf.length; i++) {
      const ch = buf[i];
      if (!TERMINALS.has(ch)) continue;

      if (ch === '.') {
        const prev = buf[i - 1] || '';
        const next = buf[i + 1] || '';
        // Skip decimal points: 2.5, ₹2,75,000
        if (/[0-9,]/.test(prev) && /[0-9,]/.test(next)) continue;
        // Skip common abbreviations followed immediately by uppercase (Dr. Smith)
        if (/[A-Za-z]/.test(prev) && /[A-Z]/.test(next)) continue;
      }

      const after = buf[i + 1];
      if (after === undefined || after === ' ' || after === '\n' || after === '\r') {
        return i;
      }
    }
    return -1;
  }
}

module.exports = { SentenceAggregator };
