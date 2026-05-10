'use strict';

const axios  = require('axios');
const logger = require('../utils/logger');

const RAG_URL     = 'http://localhost:3001/ask';
const TIMEOUT_MS  = 20000; // 20 s — fail fast so Ollama can still answer
const MAX_RETRIES = 2;

// Async generator: yields raw SSE tokens from the RAG endpoint
async function* _streamRAG(message, signal) {
  const res = await axios.post(
    RAG_URL,
    { message },
    { responseType: 'stream', timeout: TIMEOUT_MS, signal }
  );

  let buf = '';
  for await (const raw of res.data) {
    buf += raw.toString();
    const lines = buf.split('\n');
    buf = lines.pop(); // last (possibly incomplete) line stays in buffer

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      yield line.slice(6); // raw token string
    }
  }

  // Flush any remaining buffer line
  if (buf.startsWith('data: ')) yield buf.slice(6);
}

// Fully aggregates the RAG stream and returns the context string
async function fetchRAGContext(userMessage, signal) {
  const t0 = Date.now();
  logger.rag('payload:', { message: userMessage });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      logger.rag(`retry ${attempt}/${MAX_RETRIES}…`);
      await new Promise(r => setTimeout(r, 400 * attempt));
    }

    try {
      let context = '';
      let chunks  = 0;
      let firstMs = null;

      for await (const token of _streamRAG(userMessage, signal)) {
        if (token === '[DONE]')              break;
        if (token.startsWith('[ERROR]')) { logger.error('RAG error token:', token); break; }

        if (firstMs === null) {
          firstMs = Date.now() - t0;
          logger.timing('RAG first chunk', firstMs);
        }

        logger.rag('chunk:', token);
        context += token;
        chunks++;
      }

      logger.timing('RAG total',    Date.now() - t0);
      logger.rag(`context ready — ${chunks} chunks, ${context.length} chars`);
      return context.trim();

    } catch (err) {
      const cancelled = err.code === 'ERR_CANCELED' || err.name === 'CanceledError';
      if (cancelled || signal?.aborted) {
        logger.rag('request cancelled');
        return '';
      }
      const timedOut = err.code === 'ECONNABORTED' || /timeout/i.test(err.message);
      logger.error(`RAG attempt ${attempt} failed — ${timedOut ? 'timeout' : err.message}`);

      if (attempt === MAX_RETRIES) break;
    }
  }

  logger.error('RAG unavailable — proceeding without context');
  return '';
}

module.exports = { fetchRAGContext };
