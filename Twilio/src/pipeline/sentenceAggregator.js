const cfg = require('../config');

// Abbreviations whose trailing period must NOT trigger a sentence split
const ABBREV_RE = /\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|Rd|Ave|vs|etc|No|Vol|Fig|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec|B\.Tech|M\.Tech|B\.Sc|M\.Sc|B\.E|M\.E|B\.A|M\.A|Ph\.D|U\.S|U\.K|MCA|MBA)\./g;

const FILLER_RE = /^(um+|uh+|hmm+|ah+|okay+)\s*$/i;
const MIN_WORDS = 4;    // never emit fewer than this many words (avoids "Hi." alone)
const TIMER_MS  = 2500; // if stream stalls for 2.5s, flush whatever we have

/**
 * Aggregates streaming RAG tokens into complete sentences before TTS.
 *
 * Emission triggers:
 *  1. Sentence boundary — [.!?।] followed by whitespace+capital OR end-of-string
 *  2. Inactivity timer  — no new token for TIMER_MS (handles stalled/slow streams)
 *
 * The word-count overflow trigger was intentionally removed because it caused
 * mid-clause splits ("It offers MCA and PhD" // "in Computer Science...").
 * The timer handles the case where RAG sends very long unpunctuated text.
 */
class SentenceAggregator {
  constructor(onSentence) {
    this.onSentence = onSentence;
    this.buffer     = '';
    this._timer     = null;
  }

  push(chunk) {
    const text = this._clean(chunk);
    if (!text) return;

    // Smart space: don't insert a space before punctuation that joins tokens
    // e.g. "1,00" + ",000" → "1,00,000" not "1,00 ,000"
    const startsWithJoiner = /^[,.:;!?)%\]'"]/.test(text);
    const needSpace = this.buffer.length > 0 &&
                      !/\s$/.test(this.buffer) &&
                      !startsWithJoiner;

    this.buffer += (needSpace ? ' ' : '') + text;

    this._resetTimer();
    this._tryEmit();
  }

  flush() {
    this._clearTimer();
    const remaining = this.buffer.trim();
    this.buffer = '';
    if (remaining && !FILLER_RE.test(remaining)) {
      this._emit(remaining);
    }
  }

  reset() {
    this._clearTimer();
    this.buffer = '';
  }

  // ─── internal ─────────────────────────────────────────────────────────────

  _tryEmit() {
    // Mask abbreviation periods so they don't falsely trigger splits
    const safe = this.buffer.replace(ABBREV_RE, m => m.replace('.', '\x00'));

    // Sentence boundary: punctuation followed by space+capital OR end-of-string
    const re = /[.!?।](?=\s+[A-ZА-Яऀ-ॿ]|$)/g;

    const cuts = [];
    let m;
    while ((m = re.exec(safe)) !== null) cuts.push(m.index + 1);
    if (cuts.length === 0) return;

    let processed = 0;
    for (const cut of cuts) {
      const candidate = this.buffer.slice(processed, cut).trim();
      if (this._wordCount(candidate) >= MIN_WORDS) {
        this._emit(candidate);
        processed = cut;
        // Skip whitespace after punctuation
        while (processed < this.buffer.length && /\s/.test(this.buffer[processed])) {
          processed++;
        }
      }
      // Short fragment (<MIN_WORDS): leave in buffer to merge with next sentence
    }

    if (processed > 0) {
      this.buffer = this.buffer.slice(processed).trimStart();
    }
  }

  _resetTimer() {
    this._clearTimer();
    this._timer = setTimeout(() => {
      // Stream has stalled — flush partial buffer so the user hears something
      const text = this.buffer.trim();
      if (text && this._wordCount(text) >= MIN_WORDS) {
        this.buffer = '';
        this._emit(text);
      }
    }, TIMER_MS);
  }

  _clearTimer() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  _emit(text) {
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t || FILLER_RE.test(t)) return;
    this.onSentence(t);
  }

  _wordCount(text = this.buffer) {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  _clean(text) {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

module.exports = SentenceAggregator;
