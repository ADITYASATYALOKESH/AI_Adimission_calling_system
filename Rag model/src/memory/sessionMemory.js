'use strict';

const logger = require('../utils/logger');

const MAX_MESSAGES  = 20;
const MAX_CHARS     = 16000; // ~4 000 tokens at 4 chars/token
const SESSION_TTL   = 60 * 60 * 1000; // 1 hour idle → evict

class Session {
  constructor(id) {
    this.id         = id;
    this.messages   = [];       // [{ role, content }]
    this.createdAt  = Date.now();
    this.lastActive = Date.now();
  }

  push(role, content) {
    this.messages.push({ role, content });
    this.lastActive = Date.now();
    this._trim();
  }

  getHistory() {
    return this.messages.slice();
  }

  estimatedTokens() {
    const chars = this.messages.reduce((s, m) => s + m.content.length, 0);
    return Math.ceil(chars / 4);
  }

  _trim() {
    // Drop oldest messages (skip index 0 only if it's the initial user message)
    let chars = this.messages.reduce((s, m) => s + m.content.length, 0);
    while (
      (this.messages.length > MAX_MESSAGES || chars > MAX_CHARS) &&
      this.messages.length > 2
    ) {
      const dropped = this.messages.shift();
      chars -= dropped.content.length;
    }
  }

  isExpired() {
    return Date.now() - this.lastActive > SESSION_TTL;
  }
}

class MemoryManager {
  constructor() {
    this._map = new Map();
    // Cleanup idle sessions every 15 minutes
    const timer = setInterval(() => this._gc(), 15 * 60 * 1000);
    if (timer.unref) timer.unref(); // don't prevent process exit
  }

  getSession(id) {
    if (!this._map.has(id)) {
      this._map.set(id, new Session(id));
      logger.memory(`new session: ${id}`);
    }
    return this._map.get(id);
  }

  deleteSession(id) {
    const ok = this._map.delete(id);
    if (ok) logger.memory(`session deleted: ${id}`);
    return ok;
  }

  stats() {
    return {
      activeSessions: this._map.size,
      sessions: Array.from(this._map.values()).map(s => ({
        id:              s.id,
        messages:        s.messages.length,
        estimatedTokens: s.estimatedTokens(),
        lastActive:      new Date(s.lastActive).toISOString(),
      })),
    };
  }

  _gc() {
    let n = 0;
    for (const [id, s] of this._map) {
      if (s.isExpired()) { this._map.delete(id); n++; }
    }
    if (n > 0) logger.memory(`GC evicted ${n} expired sessions`);
  }
}

module.exports = { MemoryManager };
