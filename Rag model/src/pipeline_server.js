'use strict';

const express            = require('express');
const cors               = require('cors');
const { randomUUID }     = require('crypto');
const { runPipeline, memoryManager } = require('./pipeline');
const logger             = require('./utils/logger');

const app  = express();
const PORT = 3002;

app.use(cors());
app.use(express.json());

// ── Health ──────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', port: PORT, upstream: { rag: 3001, ollama: 11434 } });
});

// ── Session memory stats ────────────────────────────────────────────────────
app.get('/sessions', (_req, res) => {
  res.json(memoryManager.stats());
});

// ── Clear a session ─────────────────────────────────────────────────────────
app.delete('/sessions/:id', (req, res) => {
  const deleted = memoryManager.deleteSession(req.params.id);
  res.json({ deleted, sessionId: req.params.id });
});

// ── Streaming SSE chat (/chat) ───────────────────────────────────────────────
//
// Request  : POST /chat
//            Body: { "message": "...", "sessionId": "..." (optional) }
//
// Response : text/event-stream
//            data: <sentence>\n\n  — one per finalized sentence
//            data: [ERROR] ...\n\n — on error
//            data: [DONE]\n\n      — stream end
//
app.post('/chat', async (req, res) => {
  const { message, sessionId } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message (non-empty string) is required' });
  }

  const sid = (sessionId && typeof sessionId === 'string') ? sessionId : randomUUID();
  logger.server(`POST /chat — session=${sid} — "${message.slice(0, 80)}"`);

  // Open SSE immediately — browser/client sees 200 right away
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Session-Id',  sid);
  res.flushHeaders();

  const controller = new AbortController();
  req.on('close', () => {
    controller.abort();
    logger.server(`client disconnected — session=${sid}`);
  });

  try {
    for await (const event of runPipeline(message, sid, controller.signal)) {
      if (controller.signal.aborted) break;

      switch (event.type) {
        case 'token':
          res.write(`data: ${event.text}\n\n`);
          break;
        case 'error':
          res.write(`data: [ERROR] ${event.text}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        case 'done':
          res.write('data: [DONE]\n\n');
          res.end();
          return;
      }
    }
  } catch (err) {
    logger.error('server handler error:', err.message);
    if (!res.writableEnded) {
      res.write('data: [ERROR] Internal server error\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

// ── Blocking JSON chat (/chat/sync) — useful for testing ────────────────────
//
// Request  : POST /chat/sync
//            Body: { "message": "...", "sessionId": "..." (optional) }
// Response : JSON { "response": "...", "sessionId": "..." }
//
app.post('/chat/sync', async (req, res) => {
  const { message, sessionId } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message (non-empty string) is required' });
  }

  const sid = (sessionId && typeof sessionId === 'string') ? sessionId : randomUUID();
  logger.server(`POST /chat/sync — session=${sid}`);

  let fullText = '';
  try {
    for await (const event of runPipeline(message, sid, null)) {
      if (event.type === 'token') fullText += event.text;
      if (event.type === 'error') {
        return res.status(500).json({ error: event.text, sessionId: sid });
      }
    }
    res.json({ response: fullText.trim(), sessionId: sid });
  } catch (err) {
    logger.error('sync handler error:', err.message);
    res.status(500).json({ error: err.message, sessionId: sid });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.server(`Pipeline server  →  http://localhost:${PORT}`);
  logger.server('Endpoints:');
  logger.server('  POST   /chat          — streaming SSE response');
  logger.server('  POST   /chat/sync     — blocking JSON response (testing)');
  logger.server('  GET    /health        — health check');
  logger.server('  GET    /sessions      — memory stats');
  logger.server('  DELETE /sessions/:id  — clear session');
});
