require('dotenv').config();

const express    = require('express');
const http       = require('http');
const cfg        = require('./config');
const logger     = require('./utils/logger');
const wsManager  = require('./websocket/wsManager');
const twilioService = require('./services/twilioService');
const redisService  = require('./services/redisService');
const { sessionManager } = require('./core/sessionManager');

// ─── App setup ───────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Trust proxy — needed when behind ngrok/load balancer for correct IP/host
app.set('trust proxy', true);

// ─── Request logger middleware ───────────────────────────────────────────────

app.use((req, _res, next) => {
  logger.server(`${req.method} ${req.path}`);
  next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * POST /voice
 * Twilio calls this when a call connects (both inbound and outbound).
 * Returns TwiML that opens a Media Stream WebSocket.
 */
app.post('/voice', (req, res) => {
  const callSid = req.body?.CallSid || 'unknown';
  logger.call(`/voice webhook  CallSid=${callSid}  From=${req.body?.From}  To=${req.body?.To}`);

  const twiml = twilioService.generateStreamTwiml();
  res.set('Content-Type', 'text/xml');
  res.send(twiml);

  logger.ws(`TwiML sent — waiting for WS upgrade on /twilio-stream`);
});

/**
 * POST /call-status
 * Twilio status callback for call lifecycle events.
 */
app.post('/call-status', (req, res) => {
  const { CallSid, CallStatus, Duration } = req.body;
  logger.call(`status  SID=${CallSid}  status=${CallStatus}  duration=${Duration || 0}s`);

  if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(CallStatus)) {
    const session = sessionManager.get(CallSid);
    if (session) sessionManager.remove(CallSid);
  }

  res.sendStatus(200);
});

/**
 * POST /call/outbound
 * Console-triggered: initiate an outbound call.
 * Body: { to: "+91XXXXXXXXXX" }
 */
app.post('/call/outbound', async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'to is required' });

  try {
    const call = await twilioService.makeCall(to);
    res.json({ success: true, callSid: call.sid, status: call.status });
  } catch (err) {
    logger.error(`Outbound call failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /status
 * Monitor active sessions and WS connections.
 */
app.get('/status', (req, res) => {
  const sessions = sessionManager.all().map(s => s.toJSON());
  res.json({
    uptime:      process.uptime(),
    sessions:    sessions.length,
    wsClients:   wsManager.stats().clients,
    activeCalls: sessions,
    memory:      process.memoryUsage(),
    timestamp:   new Date().toISOString(),
  });
});

/**
 * GET /health
 * Simple liveness check.
 */
app.get('/health', (_req, res) => res.json({ ok: true }));

// ─── 404 handler ─────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: `No route: ${req.method} ${req.path}` });
});

// ─── Error handler ───────────────────────────────────────────────────────────

app.use((err, req, res, _next) => {
  logger.error(`Unhandled error on ${req.path}: ${err.message}`);
  res.status(500).json({ error: err.message });
});

// ─── WebSocket attachment ─────────────────────────────────────────────────────

wsManager.attach(server);

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function start() {
  logger.banner();

  // Redis (non-fatal if unavailable)
  await redisService.connect();

  const PORT = cfg.server.port;
  server.listen(PORT, () => {
    logger.server(`listening on port ${PORT}`);
    logger.server(`Twilio webhook URL : ${cfg.server.url}/voice`);
    logger.server(`WS stream URL      : ${cfg.server.url.replace(/^http/, 'ws')}/twilio-stream`);
    logger.server(`Status             : ${cfg.server.url}/status`);
    logger.server(`Outbound call API  : POST ${cfg.server.url}/call/outbound`);
    logger.server(`\nReady — waiting for calls.\n`);
  });
}

// ─── Graceful shutdown ───────────────────────────────────────────────────────

async function shutdown(signal) {
  logger.server(`\nReceived ${signal} — shutting down gracefully…`);

  // Close WebSocket server
  await wsManager.close();

  // Disconnect Redis
  await redisService.disconnect();

  // Close HTTP server
  server.close(() => {
    logger.server('HTTP server closed.');
    process.exit(0);
  });

  // Force exit after 10s
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
  logger.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason}`);
});

start().catch((err) => {
  logger.error(`Startup failed: ${err.message}`);
  process.exit(1);
});

module.exports = { app, server };
