'use strict';

const axios  = require('axios');
const logger = require('../utils/logger');

const OLLAMA_URL  = 'http://localhost:11434/api/chat';
const MODEL       = 'admissionmodel';
const TIMEOUT_MS  = 120000; // 2 min — large model can be slow on CPU

const SYSTEM_PROMPT = `You are a warm, knowledgeable university admission counselor for Aditya University.

Rules:
- Be conversational, concise, and human-like
- Always state exact figures from the provided context (never use placeholders)
- Keep answers to 2-3 sentences
- Do not repeat information already discussed
- Do not add disclaimers or suggest checking brochures`;

// Async generator: yields { token, done } from Ollama's streaming chat API
async function* streamOllamaResponse(messages, signal) {
  const payload = {
    model:    MODEL,
    messages,
    stream:   true,
    options: {
      temperature: 0.7,
      num_predict: 300,
      stop:        ['\n\n', 'User:', 'Human:'],
    },
  };

  logger.ollama('streaming started', {
    model:     MODEL,
    messages:  messages.length,
    tokensEst: Math.ceil(messages.reduce((s, m) => s + m.content.length, 0) / 4),
  });

  const res = await axios.post(OLLAMA_URL, payload, {
    responseType: 'stream',
    timeout:      TIMEOUT_MS,
    signal,
  });

  let buf        = '';
  let tokenCount = 0;

  for await (const raw of res.data) {
    buf += raw.toString();
    const lines = buf.split('\n');
    buf = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        logger.error(`Ollama — unparseable line: ${line}, error: ${err.message}`);
        throw err;
      }

      const token = parsed.message?.content || parsed.response || '';
      if (token) {
        tokenCount++;
        logger.ollama('chunk:', token);
        yield { token, done: false };
      }
      if (parsed.done) {
        logger.ollama(`stream complete — ${tokenCount} tokens`);
        yield { token: '', done: true };
        return;
      }
    }
  }

  yield { token: '', done: true };
}

module.exports = { streamOllamaResponse, SYSTEM_PROMPT };
