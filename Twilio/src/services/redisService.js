const Redis = require('ioredis');
const cfg = require('../config');
const logger = require('../utils/logger');

let client  = null;
let healthy = false;   // flips true on first successful connect

function getClient() {
  if (client) return client;

  client = new Redis(cfg.redis.url, {
    lazyConnect:          true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue:   false,
    retryStrategy:        (times) => {
      // After 3 failed reconnects, stop retrying silently
      if (times > 3) return null;
      return Math.min(times * 500, 2000);
    },
  });

  client.on('connect', () => { healthy = true; logger.redis('connected'); });
  client.on('error',   (e) => {
    // Only log the first error — subsequent reconnect noise is suppressed
    if (healthy || !client._suppressedError) {
      client._suppressedError = true;
      logger.warn(`Redis unavailable: ${e.message}`);
    }
  });
  client.on('close', () => { if (healthy) logger.redis('connection closed'); });

  return client;
}

const redisService = {
  async connect() {
    try {
      await getClient().connect();
    } catch (e) {
      logger.warn(`Redis unavailable — running without persistence: ${e.message}`);
    }
  },

  async saveSession(callSid, data) {
    try {
      await getClient().setex(
        `session:${callSid}`,
        cfg.redis.ttlSeconds,
        JSON.stringify(data)
      );
    } catch (_) { /* non-fatal */ }
  },

  async getSession(callSid) {
    try {
      const raw = await getClient().get(`session:${callSid}`);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  },

  async saveHistory(callSid, history) {
    try {
      await getClient().setex(
        `history:${callSid}`,
        cfg.redis.ttlSeconds,
        JSON.stringify(history)
      );
    } catch (_) { /* non-fatal */ }
  },

  async getHistory(callSid) {
    try {
      const raw = await getClient().get(`history:${callSid}`);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  },

  async deleteSession(callSid) {
    try {
      await getClient().del(`session:${callSid}`, `history:${callSid}`);
    } catch (_) { /* non-fatal */ }
  },

  async listActiveSessions() {
    try {
      const keys = await getClient().keys('session:*');
      const data = [];
      for (const key of keys) {
        const raw = await getClient().get(key);
        if (raw) data.push(JSON.parse(raw));
      }
      return data;
    } catch (_) { return []; }
  },

  async disconnect() {
    if (client) {
      await client.quit().catch(() => {});
      client = null;
    }
  },
};

module.exports = redisService;
