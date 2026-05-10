const http = require('http');
const cfg = require('../config');
const logger = require('../utils/logger');

/**
 * Ollama Local LLM Service — streaming chat via /api/chat.
 * Used as RAG fallback when the RAG endpoint returns nothing.
 */
const ollamaService = {
  stream(prompt, context, onChunk, onDone, abortCtrl = new AbortController()) {
    const messages = buildMessages(prompt, context);
    const url = new URL(`${cfg.ollama.host}/api/chat`);

    const body = JSON.stringify({
      model:    cfg.ollama.model,
      messages,
      stream:   true,
      options: {
        temperature:    0.7,
        top_p:          0.9,
        repeat_penalty: 1.1,
        num_predict:    200,
      },
    });

    const options = {
      hostname: url.hostname,
      port:     url.port || 11434,
      path:     url.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: cfg.ollama.timeoutMs,
    };

    logger.rag(`[Ollama] chat: "${prompt.slice(0, 60)}"`);
    let partial = '';

    const req = http.request(options, (res) => {
      if (res.statusCode !== 200) {
        logger.error(`[Ollama] HTTP ${res.statusCode}`);
        onDone();
        return;
      }

      res.on('data', (chunk) => {
        if (abortCtrl.signal.aborted) { req.destroy(); return; }

        partial += chunk.toString('utf8');
        const lines = partial.split('\n');
        partial = lines.pop(); // keep incomplete last line

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            // /api/chat response: { message: { content: "..." }, done: bool }
            const text = obj.message?.content || obj.response || '';
            if (text) onChunk(text);
            if (obj.done) { onDone(); return; }
          } catch (err) {
            logger.error(`[Ollama] stream JSON parse error: ${err.message}`);
            throw err;
          }
        }
      });

      res.on('end', () => {
        // Flush any remaining partial line
        if (partial.trim()) {
          try {
            const obj = JSON.parse(partial);
            const text = obj.message?.content || obj.response || '';
            if (text) onChunk(text);
          } catch (err) {
            logger.error(`[Ollama] stream flush JSON parse error: ${err.message}`);
            throw err;
          }
        }
        onDone();
      });

      res.on('error', (err) => {
        logger.error(`[Ollama] stream error: ${err.message}`);
        onDone();
      });
    });

    req.on('error', (err) => {
      if (!abortCtrl.signal.aborted) {
        logger.error(`[Ollama] request error: ${err.message}`);
      }
      onDone();
    });

    req.on('timeout', () => {
      logger.error(`[Ollama] timeout after ${cfg.ollama.timeoutMs}ms`);
      req.destroy();
      onDone();
    });

    abortCtrl.signal.addEventListener('abort', () => req.destroy());

    req.write(body);
    req.end();
    return req;
  },

  async isHealthy() {
    return new Promise((resolve) => {
      const url = new URL(`${cfg.ollama.host}/api/tags`);
      const req = http.get(
        { hostname: url.hostname, port: url.port || 11434, path: '/api/tags', timeout: 3000 },
        (res) => resolve(res.statusCode === 200)
      );
      req.on('error', () => resolve(false));
    });
  },
};

function buildMessages(prompt, context) {
  const messages = [
    {
      role:    'system',
      content: [
        'You are an admissions counselor at Aditya University on a phone call.',
        'Rules: answer in 1-2 short sentences only. No filler. No greetings. No motivational talk.',
        'Give the direct factual answer, then ask ONE follow-up question if needed.',
        'Never hallucinate. Never repeat what you already said.',
      ].join(' '),
    },
  ];

  // Add conversation history
  if (context) {
    for (const line of context.split('\n').filter(Boolean)) {
      if (line.startsWith('User: ')) {
        messages.push({ role: 'user',      content: line.slice(6).trim() });
      } else if (line.startsWith('Assistant: ')) {
        messages.push({ role: 'assistant', content: line.slice(11).trim() });
      }
    }
  }

  messages.push({ role: 'user', content: prompt });
  return messages;
}

module.exports = ollamaService;
