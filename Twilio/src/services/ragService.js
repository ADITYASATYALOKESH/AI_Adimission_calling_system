const cfg = require('../config');
const logger = require('../utils/logger');
const http = require('http');
const https = require('https');

/**
 * Streaming RAG Service — consumes http://localhost:3001/ask
 *
 * The endpoint may return:
 *   - Server-Sent Events (text/event-stream)
 *   - Newline-delimited JSON  (application/x-ndjson)
 *   - Chunked plain text      (text/plain)
 *
 * We detect and handle all three formats.
 * Chunks are streamed to an onChunk callback for sentence aggregation.
 */
const ragService = {
  /**
   * @param {string}   query      - User's transcript
   * @param {string}   context    - Conversation history text
   * @param {Function} onChunk    - (chunk: string) => void  — called per text fragment
   * @param {Function} onDone     - () => void               — called when stream ends
   * @param {AbortController} abortCtrl
   */
  stream(query, context, onChunk, onDone, abortCtrl = new AbortController()) {
    const url = new URL(cfg.rag.endpoint);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const body = JSON.stringify({ message: query });

    const options = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Accept':         'text/event-stream, application/x-ndjson, text/plain',
      },
      timeout: cfg.rag.timeoutMs,
    };

    logger.rag(`streaming query: "${query.slice(0, 80)}"  payload=${body}`);
    const startTs = Date.now();
    let firstChunk = true;

    const FALLBACK = "I'm sorry, I couldn't find that information right now. Could you please ask me something else?";

    const req = transport.request(options, (res) => {
      const contentType = res.headers['content-type'] || '';

      if (res.statusCode !== 200) {
        logger.error(`RAG HTTP ${res.statusCode} — consuming error body`);
        let errBody = '';
        res.on('data', (d) => { errBody += d.toString('utf8'); });
        res.on('end', () => {
          logger.error(`RAG error body: ${errBody.slice(0, 200)}`);
          onChunk(FALLBACK);
          onDone();
        });
        return;
      }

      res.on('data', (rawChunk) => {
        if (abortCtrl.signal.aborted) { req.destroy(); return; }

        if (firstChunk) {
          firstChunk = false;
          logger.rag(`first chunk in ${Date.now() - startTs}ms  contentType=${contentType}`);
        }

        const text = rawChunk.toString('utf8');
        const chunks = parseChunks(text, contentType);

        for (const chunk of chunks) {
          if (chunk) {
            logger.rag(`chunk: "${chunk.slice(0, 60)}"`);
            onChunk(chunk);
          }
        }
      });

      res.on('end', () => {
        logger.rag(`stream complete in ${Date.now() - startTs}ms`);
        onDone();
      });

      res.on('error', (err) => {
        logger.error(`RAG stream response error: ${err.message}`);
        onChunk(FALLBACK);
        onDone();
      });
    });

    req.on('error', (err) => {
      if (abortCtrl.signal.aborted) return;
      logger.error(`RAG request error: ${err.message}`);
      onChunk(FALLBACK);
      onDone();
    });

    req.on('timeout', () => {
      logger.error(`RAG request timeout after ${cfg.rag.timeoutMs}ms`);
      req.destroy();
      onChunk(FALLBACK);
      onDone();
    });

    abortCtrl.signal.addEventListener('abort', () => {
      logger.rag('stream aborted (barge-in or session end)');
      req.destroy();
    });

    req.write(body);
    req.end();

    return req;
  },
};

/**
 * Parse raw stream chunk text into text fragments based on content type.
 */
function parseChunks(raw, contentType) {
  const results = [];

  // Server-Sent Events: "data: <payload>\n\n"
  if (contentType.includes('event-stream')) {
    const lines = raw.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]' || !payload) continue;
      const text = extractText(payload);
      if (text) results.push(text);
    }
    return results;
  }

  // Newline-delimited JSON: each line is a JSON object
  if (contentType.includes('ndjson') || contentType.includes('jsonl')) {
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const text = extractText(t);
      if (text) results.push(text);
    }
    return results;
  }

  // Plain text / unknown — treat entire chunk as text
  if (raw.trim()) results.push(raw.trim());
  return results;
}

function extractText(payload) {
  try {
    const obj = JSON.parse(payload);
    // Discard error objects — never send {"error":...} to TTS
    if (obj.error != null || obj.detail != null) return '';
    // OpenAI-compatible: choices[0].delta.content or choices[0].text
    if (obj.choices?.[0]?.delta?.content != null) return obj.choices[0].delta.content;
    if (obj.choices?.[0]?.text           != null) return obj.choices[0].text;
    // Simple { text } or { answer } or { response }
    if (obj.text     != null) return String(obj.text);
    if (obj.answer   != null) return String(obj.answer);
    if (obj.response != null) return String(obj.response);
    if (obj.content  != null) return String(obj.content);
    if (obj.chunk    != null) return String(obj.chunk);
  } catch (_) {
    // Not JSON — return as-is if it looks like plain text
    if (!payload.startsWith('{') && !payload.startsWith('[')) return payload;
  }
  return '';
}

module.exports = ragService;
