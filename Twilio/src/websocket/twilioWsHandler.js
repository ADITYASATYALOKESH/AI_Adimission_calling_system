const { sessionManager } = require('../core/sessionManager');
const StreamOrchestrator = require('../pipeline/streamOrchestrator');
const { STATES } = require('../core/stateMachine');
const redisService = require('../services/redisService');
const logger = require('../utils/logger');

const PING_INTERVAL_MS = 25000; // Twilio disconnects idle WS after 30s

/**
 * Handles a single Twilio Media Stream WebSocket connection.
 * Called once per WS upgrade in wsManager.
 */
function handleTwilioWebSocket(ws, req) {
  let session      = null;
  let orchestrator = null;
  let pingTimer    = null;
  let callSid      = null;

  logger.ws(`new connection  ip=${req.socket.remoteAddress}`);

  // ─── Keepalive ping ──────────────────────────────────────────────────────
  pingTimer = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.ping();
      logger.audio('ping sent');
    }
  }, PING_INTERVAL_MS);

  ws.on('pong', () => logger.audio('pong received'));

  // ─── Incoming Twilio messages ────────────────────────────────────────────
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      logger.warn(`WS non-JSON message: ${data}`);
      return;
    }

    switch (msg.event) {
      case 'connected':
        onConnected(msg);
        break;

      case 'start':
        onStart(msg);
        break;

      case 'media':
        onMedia(msg);
        break;

      case 'stop':
        onStop(msg);
        break;

      case 'mark':
        onMark(msg);
        break;

      default:
        logger.audio(`unknown event: ${msg.event}`);
    }
  });

  ws.on('close', (code, reason) => {
    logger.ws(`closed  code=${code}  reason=${reason || '—'}  callSid=${callSid}`);
    cleanup();
  });

  ws.on('error', (err) => {
    logger.error(`WS error: ${err.message}`);
    cleanup();
  });

  // ─── Event handlers ──────────────────────────────────────────────────────

  function onConnected(msg) {
    logger.ws(`protocol=${msg.protocol}  version=${msg.version}`);
  }

  function onStart(msg) {
    callSid           = msg.start?.callSid;
    const streamSid   = msg.streamSid;
    const customParams = msg.start?.customParameters || {};

    logger.call(`stream START  callSid=${callSid}  streamSid=${streamSid}`);

    // Create session and orchestrator
    session      = sessionManager.create(callSid, streamSid, ws);
    orchestrator = new StreamOrchestrator(session);

    // Hand off to orchestrator: it transitions state, plays greeting, and enables VAD
    orchestrator.onStreamStart();

    // Persist session metadata to Redis
    redisService.saveSession(callSid, session.toJSON()).catch(() => {});

    logger.call(`ready  callSid=${callSid}`);
  }

  function onMedia(msg) {
    if (!session || !orchestrator) return;

    const payload = msg.media?.payload;
    if (!payload) return;

    const mulawBuf = Buffer.from(payload, 'base64');
    orchestrator.onAudioChunk(mulawBuf);
  }

  function onStop(msg) {
    logger.call(`stream STOP  callSid=${callSid}  streamSid=${msg.streamSid}`);
    cleanup();
  }

  function onMark(msg) {
    const name = msg.mark?.name;
    logger.playback(`mark received: ${name}`);

    // When we see our "end-of-response" mark, transition to LISTENING
    if (name === 'response-end' && session) {
      if (session.sm.current === STATES.PLAYBACK) {
        session.sm.transition(STATES.LISTENING, 'mark: response-end');
      }
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  function cleanup() {
    clearInterval(pingTimer);

    if (orchestrator) {
      orchestrator.destroy();
      orchestrator = null;
    }

    if (callSid) {
      const s = sessionManager.get(callSid);
      if (s) {
        // Persist final history
        redisService.saveHistory(callSid, s.history).catch(() => {});
        sessionManager.remove(callSid);
      }
    }

    try { ws.terminate(); } catch (err) { logger.error(`WS terminate error: ${err.message}`); throw err; }
  }
}

module.exports = { handleTwilioWebSocket };
