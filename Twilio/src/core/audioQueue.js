// Twilio Media Streams: μ-law 8 kHz mono
// Twilio buffers audio on their end — send in bursts, no pacing needed.
// We track playback end time by audio duration so we know when speech is "done".

const SEND_CHUNK = 3200; // 400ms per WebSocket message (reduces message count vs 160B/20ms)

class AudioQueue {
  constructor(session, onDrained = null) {
    this.session   = session;
    this.onDrained = onDrained;
    this._busy     = false;
    this._endAt    = null;   // absolute timestamp when playback ends
    this._timer    = null;
  }

  /**
   * Send μ-law audio immediately to Twilio.
   * Multiple calls extend the playback window correctly (sequential sentences).
   */
  enqueue(mulawBuffer) {
    if (!Buffer.isBuffer(mulawBuffer) || mulawBuffer.length === 0) return;

    const ws = this.session.ws;
    if (!ws || ws.readyState !== 1 /* OPEN */) return;

    const durationMs = Math.ceil(mulawBuffer.length / 160 * 20);
    const now        = Date.now();

    // Extend cumulative end time — works correctly for back-to-back sentences
    this._endAt = this._busy && this._endAt > now
      ? this._endAt + durationMs
      : now + durationMs;

    this._busy = true;
    this.session.playbackActive = true;

    // Send all bytes in one burst — Twilio buffers and plays at 8kHz
    for (let i = 0; i < mulawBuffer.length; i += SEND_CHUNK) {
      const chunk = mulawBuffer.slice(i, Math.min(i + SEND_CHUNK, mulawBuffer.length));
      try {
        ws.send(JSON.stringify({
          event:     'media',
          streamSid: this.session.streamSid,
          media:     { payload: chunk.toString('base64') },
        }));
      } catch (err) {
        this._reset();
        return;
      }
    }

    // Schedule onDrained callback at the computed audio end time
    if (this._timer) clearTimeout(this._timer);
    const delay = this._endAt - Date.now() + 300; // +300ms network buffer
    this._timer = setTimeout(() => this._handleEnd(), Math.max(0, delay));
  }

  /**
   * Cancel all pending audio (barge-in).
   * Caller is responsible for sending the Twilio "clear" WebSocket event.
   */
  clear() {
    this._reset();
  }

  /** Returns 1 if audio is currently playing, 0 otherwise. */
  get pending() { return this._busy ? 1 : 0; }

  // ─── internal ─────────────────────────────────────────────────────────────

  _handleEnd() {
    this._busy  = false;
    this._endAt = null;
    this._timer = null;
    this.session.playbackActive = false;
    if (typeof this.onDrained === 'function') this.onDrained();
  }

  _reset() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this._busy  = false;
    this._endAt = null;
    this.session.playbackActive = false;
  }
}

module.exports = AudioQueue;
